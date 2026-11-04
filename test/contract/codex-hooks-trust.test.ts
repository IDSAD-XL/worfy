// Whether Codex runs the Harness's hooks (worfy-multi-vendor ticket 39; src/main/harness/codex-hooks-trust.ts):
// `hooks/list` of the app-server read for the hooks of the plugin worfy@worfy-harness. Read against the
// live recordings of the pinned Codex (test/fixtures/codex-messages/hooks*.jsonl), against answers of the
// protocol's shape that worfy may or may not know, and end to end against the fake app-server, whose
// `hooks/list` lists the plugins of its CODEX_HOME with the trust config.toml gives them; a test approves
// them with approvePluginHooks, as a user's /hooks would. The Run itself (refused, started, Claude Code
// unchecked) is in codex-orchestrator.test.ts. The fake runs under scriptNode(); the real Codex never starts.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { CODEX_HOOKS_REFUSAL, codexHarnessHooks, codexHarnessHooksPart, harnessHooksTrustOf, readCodexHooksTrust } from '../../src/main/harness/codex-hooks-trust'
import { HARNESS_PLUGIN_ID } from '../../src/main/harness/install'
import { claudeDriver } from '../../src/main/vendors/claude'
import { codexDriver } from '../../src/main/vendors/codex'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexSchemaCheck } from '../../src/main/vendors/codex/rpc'
import { approvePluginHooks, hooksList, KNOWN_EVENTS } from '../fixtures/codex-app-server/hook-runner.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', getVersion: () => '9.9.9', getPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const REPO = join(import.meta.dirname, '..', '..')
const RECORDINGS = join(REPO, 'test', 'fixtures', 'codex-messages')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

let scratch: string
let codexHome: string
let log: string
const children: ChildProcess[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-codex-hooks-trust-')))
  codexHome = join(scratch, 'codex-home')
  log = join(scratch, 'codex.log')
  mkdirSync(join(scratch, 'ask'))
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  removeTestTree(scratch)
})

/** The Harness of this repository installed in CODEX_HOME as Codex keeps a plugin of a local marketplace. */
function installHarness(): string {
  const plugin = join(codexHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local')
  mkdirSync(join(plugin, 'hooks'), { recursive: true })
  cpSync(join(REPO, 'harness', '.claude-plugin'), join(plugin, '.claude-plugin'), { recursive: true })
  cpSync(join(REPO, 'harness', 'hooks', 'hooks.json'), join(plugin, 'hooks', 'hooks.json'))
  return plugin
}

/** A starter of the fake app-server over CODEX_HOME, on `script`, logging what worfy sends. */
function fakeStarter(script = 'turn'): StartCodex {
  return codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd: join(scratch, 'ask'),
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
    spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
      const child = spawn(scriptNode(), [...args], options)
      children.push(child)
      return child
    },
    log: () => undefined,
  })
}

const sent = (): { method?: string; params?: unknown }[] =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { method?: string; params?: unknown })

/** The result of `hooks/list` in a recording of the pinned Codex. */
function recorded(name: string): { data: { hooks: Record<string, unknown>[] }[] } {
  const line = readFileSync(join(RECORDINGS, name), 'utf8')
    .split('\n')
    .map((each) => (each.trim() === '' ? null : (JSON.parse(each) as { expect?: string; result?: unknown })))
    .find((each) => each?.expect === 'hooks/list')
  return line!.result as { data: { hooks: Record<string, unknown>[] }[] }
}

/** The recorded answer with its hooks made the Harness's own (source plugin, its id), each with `fields`. */
function asHarness(fields: (index: number) => Record<string, unknown>): unknown {
  const answer = recorded('hooks.jsonl')
  return { data: answer.data.map((entry) => ({ ...entry, hooks: entry.hooks.map((hook, index) => ({ ...hook, source: 'plugin', pluginId: HARNESS_PLUGIN_ID, ...fields(index) })) })) }
}

describe('reading hooks/list for the Harness (harnessHooksTrustOf)', () => {
  it('the recordings of the pinned Codex list hooks of the user, not of the Harness: unknown, whatever their trust', () => {
    expect(harnessHooksTrustOf(recorded('hooks.jsonl'))).toBe('unknown')
    expect(harnessHooksTrustOf(recorded('hooks-approved.jsonl'))).toBe('unknown')
  })

  it('every hook of the Harness enabled and trusted (or managed) is approved; any of them untrusted, modified or off is not', () => {
    expect(harnessHooksTrustOf(asHarness(() => ({ trustStatus: 'trusted' })))).toBe('approved')
    expect(harnessHooksTrustOf(asHarness((index) => ({ trustStatus: index === 0 ? 'managed' : 'trusted' })))).toBe('approved')
    expect(harnessHooksTrustOf(asHarness(() => ({ trustStatus: 'untrusted' })))).toBe('not-approved')
    expect(harnessHooksTrustOf(asHarness((index) => ({ trustStatus: index === 2 ? 'untrusted' : 'trusted' })))).toBe('not-approved')
    expect(harnessHooksTrustOf(asHarness((index) => ({ trustStatus: index === 1 ? 'modified' : 'trusted' })))).toBe('not-approved')
    expect(harnessHooksTrustOf(asHarness((index) => ({ trustStatus: 'trusted', enabled: index !== 0 })))).toBe('not-approved')
    // Hooks of another plugin do not count either way.
    const mixed = asHarness((index) => (index === 0 ? { pluginId: 'other@market', trustStatus: 'untrusted' } : { trustStatus: 'trusted' }))
    expect(harnessHooksTrustOf(mixed)).toBe('approved')
  })

  it('an answer worfy does not know is unknown, never approved', () => {
    expect(harnessHooksTrustOf(asHarness((index) => ({ trustStatus: index === 0 ? 'approvedByPolicy' : 'trusted' })))).toBe('unknown')
    expect(harnessHooksTrustOf(asHarness((index) => (index === 0 ? { trustStatus: 'trusted', enabled: 'yes' } : { trustStatus: 'trusted' })))).toBe('unknown')
    expect(harnessHooksTrustOf(asHarness((index) => (index === 0 ? { trustStatus: 1 } : { trustStatus: 'trusted' })))).toBe('unknown')
    expect(harnessHooksTrustOf(asHarness(() => ({ trustStatus: 'trusted', pluginId: undefined })))).toBe('unknown')
    for (const answer of [null, undefined, 'trusted', [], {}, { data: {} }, { data: [{}] }, { data: [{ hooks: [null] }] }, { data: [] }, { data: [{ cwd: '/p', hooks: [], warnings: [], errors: [] }] }]) {
      expect(harnessHooksTrustOf(answer), JSON.stringify(answer)).toBe('unknown')
    }
  })
})

describe('asking Codex (readCodexHooksTrust over the fake app-server)', () => {
  it('after an install the hooks wait: not approved; approved as /hooks approves them; an update after that: not approved again', async () => {
    const plugin = installHarness()
    await expect(readCodexHooksTrust('/projects/demo', { start: fakeStarter() })).resolves.toBe('not-approved')
    expect(sent().filter((each) => each.method === 'hooks/list')).toEqual([expect.objectContaining({ params: { cwds: ['/projects/demo'] } })])
    approvePluginHooks(codexHome)
    await expect(readCodexHooksTrust('/projects/demo', { start: fakeStarter() })).resolves.toBe('approved')
    // Another version of the folder: the approval was of the old one's hash.
    appendFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '\n')
    await expect(readCodexHooksTrust(undefined, { start: fakeStarter() })).resolves.toBe('not-approved')
    expect(sent().filter((each) => each.method === 'hooks/list').at(-1)?.params).toEqual({})
  })

  it("the fake's answer passes the JSON Schema of the pinned Codex, and lists each hook of the Harness's hooks.json", () => {
    installHarness()
    const before = hooksList(codexHome, ['/projects/demo'])
    expect(codexSchemaCheck().result(before, 'hooks/list')).toEqual([])
    const hooks = before.data[0]!.hooks
    const declared = JSON.parse(readFileSync(join(REPO, 'harness', 'hooks', 'hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> }
    // Events the pinned Codex does not know (TaskCompleted, TeammateIdle) are skipped, as Codex skips them.
    const known = Object.entries(declared.hooks).filter(([event]) => KNOWN_EVENTS.includes(event))
    expect(known.length).toBeLessThan(Object.keys(declared.hooks).length)
    const count = known.reduce((sum, [, groups]) => sum + groups.reduce((inner, group) => inner + group.hooks.length, 0), 0)
    expect(hooks).toHaveLength(count)
    expect(hooks.every((hook) => hook.source === 'plugin' && hook.pluginId === HARNESS_PLUGIN_ID && hook.trustStatus === 'untrusted')).toBe(true)
    approvePluginHooks(codexHome)
    const after = hooksList(codexHome, ['/projects/demo'])
    expect(codexSchemaCheck().result(after, 'hooks/list')).toEqual([])
    expect(after.data[0]!.hooks.every((hook) => hook.trustStatus === 'trusted')).toBe(true)
  })

  it('no Harness in Codex, or no app-server at all: unknown; the fake answers on any script', async () => {
    await expect(readCodexHooksTrust('/projects/demo', { start: fakeStarter() })).resolves.toBe('unknown')
    // The fake answers hooks/list outside its script, whatever request the script waits for.
    installHarness()
    approvePluginHooks(codexHome)
    await expect(readCodexHooksTrust('/projects/demo', { start: fakeStarter('account-plus') })).resolves.toBe('approved')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(readCodexHooksTrust('/projects/demo', { start: () => Promise.reject(new Error('no Codex for this platform')) })).resolves.toBe('unknown')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("the drivers' part", () => {
  it("Codex's driver checks the hooks with the refusal of the ticket; Claude Code's has no such part", () => {
    expect(codexDriver().harnessHooks).toBe(codexHarnessHooks)
    expect(codexHarnessHooks.refusal).toBe('The Harness hooks are not approved in Codex. Approve them in /hooks and start again.')
    expect(codexHarnessHooksPart().refusal).toBe(CODEX_HOOKS_REFUSAL)
    expect(claudeDriver().harnessHooks).toBeUndefined()
  })
})
