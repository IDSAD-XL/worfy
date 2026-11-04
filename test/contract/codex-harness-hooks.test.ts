// Whether Codex runs the Harness's hooks (worfy-multi-vendor ticket 39; src/main/vendors/codex/harness-hooks.ts):
// `hooks/list` of the app-server read for the hooks of the plugin worfy@worfy-harness. Read against the
// live recordings of the pinned Codex (test/fixtures/codex-messages/hooks*.jsonl), against answers of the
// protocol's shape that worfy may or may not know, and end to end against the fake app-server, whose
// `hooks/list` lists the plugins of its CODEX_HOME with the trust config.toml gives them; a test approves
// them with approvePluginHooks, as a user's /hooks would. The Run itself (refused, started, Claude Code
// unchecked) is in codex-orchestrator.test.ts. The fake runs under scriptNode(); the real Codex never starts.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { HARNESS_PLUGIN_ID } from '../../src/main/harness/install'
import { claudeDriver } from '../../src/main/vendors/claude'
import { codexDriver } from '../../src/main/vendors/codex'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import {
  CODEX_HOOKS_REFUSAL,
  codexHarnessHooks,
  codexHarnessHooksPart,
  declaredHooks,
  HARNESS_PLUGIN,
  harnessHooksTrustOf,
  readCodexHooksTrust,
  REQUIRED_FALLBACK,
} from '../../src/main/vendors/codex/harness-hooks'
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
function fakeStarter(script = 'turn', env: Record<string, string> = {}): StartCodex {
  return codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd: join(scratch, 'ask'),
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log, ...env },
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
    // Hooks of another plugin do not count either way (index 1 is the recording's PostToolUse, which the Harness does not need).
    const mixed = asHarness((index) => (index === 1 ? { pluginId: 'other@market', trustStatus: 'untrusted' } : { trustStatus: 'trusted' }))
    expect(harnessHooksTrustOf(mixed)).toBe('approved')
  })

  it('approved needs every hook the Harness declares: a hook Codex does not list makes it unknown', () => {
    const trusted = asHarness(() => ({ trustStatus: 'trusted' })) as { data: { hooks: { eventName: string }[] }[] }
    const without = (event: string): unknown => ({ data: trusted.data.map((entry) => ({ ...entry, hooks: entry.hooks.filter((hook) => hook.eventName !== event) })) })
    // The recording's hooks.json is not on this disk: the hooks every guarantee rests on are needed.
    expect(Object.keys(REQUIRED_FALLBACK).sort()).toEqual(['preToolUse', 'stop', 'subagentStop'])
    for (const event of Object.keys(REQUIRED_FALLBACK)) expect(harnessHooksTrustOf(without(event)), event).toBe('unknown')
    expect(harnessHooksTrustOf(without('postToolUse'))).toBe('approved')
    // What the Harness's hooks.json declares counts, handler by handler.
    expect(harnessHooksTrustOf(trusted, () => ({ preToolUse: 1, sessionEnd: 1 }))).toBe('approved')
    expect(harnessHooksTrustOf(trusted, () => ({ preToolUse: 2 }))).toBe('unknown')
    expect(harnessHooksTrustOf(trusted, () => ({ interrupt: 1 }))).toBe('unknown')
    const asked: string[] = []
    harnessHooksTrustOf(trusted, (path) => (asked.push(path), {}))
    expect(asked).toEqual(['/capture/codex-home/hooks.json'])
    // A hooks.json that cannot be read falls back to the hooks the guarantees rest on.
    expect(harnessHooksTrustOf(without('stop'), () => null)).toBe('unknown')
  })

  it("an error Codex reports for a file of the Harness's plugin folder is unknown; one elsewhere does not count", () => {
    const trusted = asHarness(() => ({ trustStatus: 'trusted' })) as { data: Record<string, unknown>[] }
    const withErrors = (...paths: string[]): unknown => ({ data: trusted.data.map((entry) => ({ ...entry, errors: paths.map((path) => ({ path, message: 'broken' })) })) })
    // The recording's hooks sit at /capture/codex-home/hooks.json: their plugin folder is /capture.
    expect(harnessHooksTrustOf(withErrors('/capture/codex-home/hooks.json'))).toBe('unknown')
    expect(harnessHooksTrustOf(withErrors('/capture/codex-home/agents/x.toml'))).toBe('unknown')
    expect(harnessHooksTrustOf(withErrors('/capture'))).toBe('unknown')
    expect(harnessHooksTrustOf(withErrors('/elsewhere/hooks.json'))).toBe('approved')
    expect(harnessHooksTrustOf(withErrors('/capture-other/hooks.json'))).toBe('approved')
    expect(harnessHooksTrustOf({ data: trusted.data.map((entry) => ({ ...entry, errors: [{ message: 'no path' }] })) })).toBe('unknown')
  })

  it("the Harness's hooks.json declares its command hooks on the events Codex runs, by Codex's names", () => {
    const declared = declaredHooks(readFileSync(join(REPO, 'harness', 'hooks', 'hooks.json'), 'utf8'))
    expect(declared).toMatchObject({ preToolUse: expect.any(Number), stop: expect.any(Number), subagentStop: expect.any(Number) })
    expect(Object.keys(declared!).every((event) => KNOWN_EVENTS.includes(`${event.charAt(0).toUpperCase()}${event.slice(1)}`))).toBe(true)
    expect(declaredHooks(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command' }, { type: 'prompt' }] }], TaskCompleted: [{ hooks: [{ type: 'command' }] }] } }))).toEqual({ stop: 1 })
    for (const text of ['', 'not json', '[]', '{}', JSON.stringify({ hooks: { Stop: {} } }), JSON.stringify({ hooks: { Stop: [{}] } })]) expect(declaredHooks(text), text).toBeNull()
  })

  it('the id the driver lists the Harness under is the installer\'s', () => {
    expect(HARNESS_PLUGIN).toBe(HARNESS_PLUGIN_ID)
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

  it('a Codex that never answers hooks/list: unknown once the timeout passes', async () => {
    installHarness()
    approvePluginHooks(codexHome)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const started = Date.now()
    await expect(readCodexHooksTrust('/projects/demo', { start: fakeStarter('turn', { WORFY_CODEX_HOOKS_SILENT: '1' }), timeoutMs: 300 })).resolves.toBe('unknown')
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(sent().filter((each) => each.method === 'hooks/list')).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the Harness of this repository, approved in the fake, is approved: every hook its hooks.json declares is listed', async () => {
    const plugin = installHarness()
    approvePluginHooks(codexHome)
    const answer = hooksList(codexHome, ['/projects/demo'])
    expect(answer.data[0]!.hooks.every((hook) => hook.sourcePath === join(plugin, 'hooks', 'hooks.json'))).toBe(true)
    expect(harnessHooksTrustOf(answer)).toBe('approved')
    // Codex leaves out a hook the hooks.json declares: not every guarantee holds.
    const stop = answer.data[0]!.hooks.findIndex((hook) => hook.eventName === 'stop')
    expect(harnessHooksTrustOf({ data: [{ ...answer.data[0]!, hooks: answer.data[0]!.hooks.filter((_, index) => index !== stop) }] })).toBe('unknown')
  })
})

describe("the drivers' part", () => {
  it("Codex's driver checks the hooks with the refusal of the ticket; Claude Code's has no such part", () => {
    expect(codexDriver().harnessHooks).toBe(codexHarnessHooks)
    expect(codexHarnessHooks.refusal).toBe('The Harness hooks are not approved in Codex. Approve them in /hooks and start again.')
    expect(codexHarnessHooksPart().refusal).toBe(CODEX_HOOKS_REFUSAL)
    expect(claudeDriver().harnessHooks).toBeUndefined()
  })

  it('the check is the Codex driver\'s: the Harness installer does not import it or the Codex protocol, it imports no Harness module, and the toolbar channel asks the driver', () => {
    /** The repository files `file` names in an import, export or import() of any kind. */
    const importsOf = (file: string): string[] =>
      [...readFileSync(join(REPO, file), 'utf8').matchAll(/(?:\bfrom|\bimport\s*\(?)\s*['"](\.[^'"]+)['"]/g)].map((match) => relative(REPO, resolve(dirname(join(REPO, file)), match[1]!)).split(sep).join('/'))
    const harnessFiles = readdirSync(join(REPO, 'src', 'main', 'harness'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `src/main/harness/${name.split(sep).join('/')}`)
    expect(harnessFiles.length).toBeGreaterThan(5)
    for (const file of harnessFiles) {
      for (const name of importsOf(file)) {
        expect(name, `${file} imports ${name}`).not.toMatch(/^src\/main\/vendors\/codex\/(account|protocol\/|harness-hooks)/)
      }
    }
    const part = 'src/main/vendors/codex/harness-hooks.ts'
    expect(importsOf(part).length).toBeGreaterThan(3)
    expect(importsOf(part).filter((name) => name.startsWith('src/main/harness/'))).toEqual([])
    const channel = importsOf('src/main/ipc/harness.ts')
    expect(channel).toContain('src/main/vendors/registry')
    expect(channel.filter((name) => name.startsWith('src/main/vendors/codex/harness-hooks'))).toEqual([])
  })
})
