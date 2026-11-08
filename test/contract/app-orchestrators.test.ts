// The app's wiring of the Orchestrators (src/main/agent/app-orchestrators.ts, worfy-multi-vendor ticket
// 37): the Vendor is the `defaultVendor` of the Project's settings.json in worfy's data folder, the
// transcript of a saved Claude Code session is read from the Claude home, a Codex thread's is not, and
// Autopilot's refusal comes from the Vendor's real driver: its capabilities and, for Codex, its check of
// the Harness hooks (ticket 39). Only the Session registry stands in
// (its Sessions on the fakes: Claude Code's fake agent, the fake Codex app-server under scriptNode()),
// so no Codex process starts through the app's own options (MCP servers, gh).
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, STATIC_CLAUDE_PARTS } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { projectDirName } from '../../src/main/claude-home/registry'
import { CODEX_HOOKS_REFUSAL } from '../../src/main/vendors/codex/harness-hooks'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CODEX_CAPABILITIES } from '../../src/main/vendors/codex/capabilities'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
}))

/** The registry the app's Orchestrators run their Sessions in, made by each test. */
const stand = vi.hoisted(() => ({ registry: null as unknown }))
vi.mock('../../src/main/agent/app-registry', async (original) => ({ ...(await original<object>()), sharedRegistry: () => stand.registry }))

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const PROJECT = 'demo-00000037'
const CLAUDE_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let scratch: string
let repo: string
let data: string
let log: string
const children: ChildProcess[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-app-orchestrators-')))
  repo = join(scratch, 'repo')
  data = join(scratch, 'data')
  log = join(scratch, 'codex.log')
  mkdirSync(repo)
  mkdirSync(join(data, PROJECT), { recursive: true })
  writeFileSync(join(data, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'repo', path: repo }], activeId: PROJECT }))
  // A Claude Code transcript of the session the Node saved: its last answer names the model.
  const home = join(scratch, 'claude-home')
  const dir = join(home, 'projects', projectDirName(repo))
  mkdirSync(dir, { recursive: true })
  const lines = [
    { type: 'user', cwd: repo, sessionId: CLAUDE_SESSION, isSidechain: false, message: { role: 'user', content: 'hello' } },
    { type: 'assistant', cwd: repo, sessionId: CLAUDE_SESSION, isSidechain: false, message: { model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] } },
  ]
  writeFileSync(join(dir, `${CLAUDE_SESSION}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  vi.stubEnv('WORFY_DATA_DIR', data)
  vi.stubEnv('WORFY_CLAUDE_HOME', home)
  const codex = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: 'turn', WORFY_CODEX_LOG: log },
      spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], options)
        children.push(child)
        return child
      },
      log: () => undefined,
    }),
  )
  const claude = claudeSessions(fakeQueryFactory({ scriptsDir: join(REPO, 'test', 'fixtures', 'agent-scripts'), script: 'orchestrator' }), { model: () => null, effort: () => null })
  stand.registry = new SessionRegistry({ sessionsOf: (vendor) => (vendor === 'codex' ? codex : claude), partsOf: () => STATIC_CLAUDE_PARTS })
})

afterEach(async () => {
  ;(stand.registry as SessionRegistry).closeAll()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

/**
 * How long a test waits for the fake Codex app-server to answer: the contract test's own limit, so the
 * wait gives up only with the test. vi.waitFor's default is 1 s, outside the run's multiplier, and the
 * fake app-server is a new node process: under the load of a full run it started later than that.
 */
const UNTIL_CODEX = { timeout: ms(15_000), interval: 20 }

/** The Project's settings.json as worfy writes it, with `defaultVendor` when given. */
function writeSettings(defaultVendor?: string): void {
  writeFileSync(join(data, PROJECT, 'settings.json'), JSON.stringify({ actionTemplates: DEFAULT_ACTION_TEMPLATES, ...(defaultVendor === undefined ? {} : { defaultVendor }) }))
}

const threadStarts = (): number => {
  try {
    return readFileSync(log, 'utf8').split('\n').filter((line) => line.includes('"method":"thread/start"')).length
  } catch {
    return 0
  }
}

describe("the app's Orchestrators run on the Project's defaultVendor (worfy-multi-vendor ticket 37)", () => {
  it("reads the Claude Code transcript of the saved session, then moves to Codex at New conversation once settings.json names it; Autopilot's refusal is Codex's own", async () => {
    vi.resetModules()
    const { sharedOrchestrators } = await import('../../src/main/agent/app-orchestrators')
    const { layoutStore } = await import('../../src/main/layout/store')
    layoutStore().apply(PROJECT, { op: 'create', node: { kind: 'orchestrator', x: 40, y: 40, w: 360, h: 200, locked: true, data: { sessionId: CLAUDE_SESSION, costUsd: 1 } } })
    writeSettings()

    // No defaultVendor: Claude Code, resuming the saved session with what its transcript tells.
    const onClaude = await sharedOrchestrators().open(PROJECT)
    expect(onClaude).toMatchObject({ vendor: 'claude', model: 'claude-sonnet-5', costUsd: 1 })
    await expect(sharedOrchestrators().unattendedRefusal(PROJECT)).resolves.toBeNull()
    expect(threadStarts()).toBe(0)

    // "Default vendor: Codex" applies at the next start of the Orchestrator.
    writeSettings('codex')
    const onCodex = await sharedOrchestrators().newConversation(PROJECT)
    expect(onCodex).toMatchObject({ vendor: 'codex', model: null })
    await vi.waitFor(() => expect(threadStarts()).toBe(1), UNTIL_CODEX)
    // Codex has the Harness (ticket 39), and its driver asks whether the hooks are approved: no app-server
    // starts through the app's own options here, so that is unknown, and unknown refuses.
    expect(CODEX_CAPABILITIES.harness).toBe(true)
    await expect(sharedOrchestrators().unattendedRefusal(PROJECT)).resolves.toBe(CODEX_HOOKS_REFUSAL)
  })

  it('opens on Codex when settings.json names it, without reading a transcript for the Codex thread', async () => {
    vi.resetModules()
    const { sharedOrchestrators } = await import('../../src/main/agent/app-orchestrators')
    const { layoutStore } = await import('../../src/main/layout/store')
    layoutStore().apply(PROJECT, { op: 'create', node: { kind: 'orchestrator', x: 40, y: 40, w: 360, h: 200, locked: true, data: { sessionId: 'thr_fake_1', costUsd: 0, vendor: 'codex' } } })
    writeSettings('codex')
    // The saved thread is resumed. Claude Code's reader would find no transcript for it, and the
    // Orchestrator would forget the thread and send thread/start instead.
    const view = await sharedOrchestrators().open(PROJECT)
    expect(view).toMatchObject({ vendor: 'codex', model: null, statusBlock: null })
    await vi.waitFor(() => expect(readFileSync(log, 'utf8')).toContain('"method":"thread/resume"'), UNTIL_CODEX)
    expect(threadStarts()).toBe(0)
  })
})
