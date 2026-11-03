// The Vendor of a Session Node and of a Project (worfy-multi-vendor ticket 23), over the real Layout
// store, Session registry and Node Sessions, with Claude Code on the fake agent and Codex on the fake
// app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets):
// - a Node saved without a Vendor starts Claude Code;
// - `sessions.new` with `vendor: 'codex'` starts Codex and saves the Vendor in the Node's data;
// - Start of a Codex Node with a saved thread resumes it on the Codex driver;
// - without a Vendor, New session takes the Project's `defaultVendor` from its settings.json;
// - a `defaultVendor` this build does not know reads as not chosen, and the rest of the file stays;
// - a Vendor this build does not run, or one nobody is signed in to, is refused with the reason before
//   any Node is made.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { NodeSessions, signInRefusal, type KnownSessions } from '../../src/main/agent/node-sessions'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import { readProjectSettings, writeProjectSettings } from '../../src/main/projects/settings'
import type { AccountConnection } from '../../src/main/vendors/account'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import type { VendorId } from '../../src/shared/vendors/vendor'
import type { LayoutNode } from '../../src/shared/layout/types'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENT_SCRIPTS = join(REPO, 'test', 'fixtures', 'agent-scripts')
const PROJECT = 'demo-0000000d'
/** The thread every script of the fake app-server starts or resumes. */
const THREAD = 'thr_fake_1'
/** How long the fakes may take to answer. */
const ANSWER_MS = ms(10_000)

let scratch: string
let repo: string
let registries: SessionRegistry[] = []
/** Every process the Codex spawn stand-in started: one a test left running is killed. */
let children: ChildProcess[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-sessions-vendor-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo, { recursive: true })
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  // Claude Code's user model and effort come from <Claude home>/settings.json: an empty home of the test's own.
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const child of children) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.kill('SIGKILL')
    await exited
  }
  children = []
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

interface Logged {
  method?: string
  params?: Record<string, unknown>
}

interface Options {
  /** The script of the fake app-server: `turn` by default. */
  codexScript?: string
  /** What the Codex home knows of the Project's threads. */
  codexThreads?: KnownSessions['history']
  vendorRefusal?: (vendor: VendorId) => Promise<string | null>
}

/** One run of the app: the Layout store, a registry with both Vendors on their fakes, the Node Sessions over the Project's settings. */
function harness(options: Options = {}) {
  const dataDir = join(scratch, 'data', PROJECT)
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const claudeRequests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'turn' })
  const claude = claudeSessions((request) => {
    claudeRequests.push(request)
    return fake(request)
  })
  const log = join(scratch, 'codex.log')
  const codex = codexSessions(() =>
    Promise.resolve({
      runtime: { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch },
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: options.codexScript ?? 'turn', WORFY_CODEX_LOG: log },
      spawnProcess: (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), args, spawnOptions)
        children.push(child)
        return child
      },
      log: () => undefined,
    }),
  )
  const asked: VendorId[] = []
  const registry = new SessionRegistry({
    sessionsOf: (vendor) => {
      asked.push(vendor)
      return vendor === 'claude' ? claude : codex
    },
  })
  registries.push(registry)
  const sessions = new NodeSessions({
    layout,
    projectPath: () => repo,
    // As the app reads it (app-node-sessions.ts): the Project's settings.json.
    defaultVendor: () => readProjectSettings(dataDir, 'plugin').defaultVendor,
    ...(options.vendorRefusal === undefined ? {} : { vendorRefusal: options.vendorRefusal }),
    vendorSessions: (vendor) => Promise.resolve(vendor === 'codex' ? { live: [], history: options.codexThreads ?? [] } : { live: [], history: [] }),
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    claude: () => Promise.resolve({ live: [], history: [] }),
    isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const node = (id: string): LayoutNode => {
    const found = layout.get(PROJECT).layout.nodes.find((each) => each.id === id)
    if (!found) throw new Error(`no Node ${id}`)
    return found
  }
  const view = (nodeId: string): SessionNodeView => {
    const found = sessions.list(PROJECT).find((each) => each.nodeId === nodeId)
    if (!found) throw new Error(`no view of ${nodeId}`)
    return found
  }
  const until = (nodeId: string, state: SessionNodeView['state']) => vi.waitFor(() => expect(view(nodeId).state).toBe(state), { timeout: ANSWER_MS })
  const codexLog = (): Logged[] => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Logged)
    } catch {
      return []
    }
  }
  return { layout, registry, sessions, dataDir, asked, claudeRequests, codexLog, node, view, until, nodes: () => layout.get(PROJECT).layout.nodes }
}

function savedLayout(nodes: Record<string, unknown>[]): void {
  writeFileSync(join(scratch, 'data', PROJECT, 'layout.json'), JSON.stringify({ nodes }))
}

function savedSettings(settings: Record<string, unknown>): void {
  writeFileSync(join(scratch, 'data', PROJECT, 'settings.json'), JSON.stringify(settings))
}

describe('the Vendor of a Session Node', () => {
  it('a Node saved without a Vendor starts Claude Code', async () => {
    savedLayout([{ id: 'fresh', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy' } }])
    const h = harness()
    const started = await h.sessions.start(PROJECT, 'fresh')
    expect(started.vendor).toBe('claude')
    expect(h.asked).toEqual(['claude'])
    expect(h.claudeRequests).toMatchObject([{ cwd: repo, resume: undefined }])
    await h.until('fresh', 'idle')
    expect(h.codexLog()).toEqual([])
  })

  it('sessions.new with vendor codex starts Codex on its fake and saves the Vendor in the Node', async () => {
    const h = harness()
    const created = await h.sessions.open(PROJECT, 'codex')
    expect(created.vendor).toBe('codex')
    expect(h.node(created.nodeId).data).toStrictEqual({ origin: 'worfy', vendor: 'codex' })
    expect(h.asked).toEqual(['codex'])
    await h.until(created.nodeId, 'idle')
    expect(h.codexLog().filter((each) => each.method === 'thread/start')).toHaveLength(1)
    expect(h.claudeRequests).toEqual([])

    // The thread Codex reported is the Node's session, next to its Vendor (identifiers only, ADR-0010).
    h.registry.get(h.view(created.nodeId).sessionId).send('hello')
    await vi.waitFor(() => expect(h.node(created.nodeId).data).toStrictEqual({ origin: 'worfy', vendor: 'codex', sessionId: THREAD }), { timeout: ANSWER_MS })
  })

  it('Start of a Codex Node with a saved thread resumes it on the Codex driver', async () => {
    savedLayout([{ id: 'codex-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', vendor: 'codex', sessionId: THREAD } }])
    const h = harness({ codexScript: 'resume', codexThreads: [{ sessionId: THREAD, cwd: repo }] })
    const resumed = await h.sessions.start(PROJECT, 'codex-1')
    expect(resumed).toMatchObject({ vendor: 'codex', sdkSessionId: THREAD, cwd: repo })
    expect(h.asked).toEqual(['codex'])
    await h.until('codex-1', 'idle')
    expect(h.codexLog().filter((each) => each.method === 'thread/resume').map((each) => each.params?.threadId)).toEqual([THREAD])
    expect(h.claudeRequests).toEqual([])
    expect(h.node('codex-1').data).toStrictEqual({ origin: 'worfy', vendor: 'codex', sessionId: THREAD })
  })

  it('a Codex thread its Vendor does not know is refused by the rule of Resume, and nothing starts', async () => {
    savedLayout([{ id: 'codex-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', vendor: 'codex', sessionId: THREAD } }])
    const h = harness({ codexThreads: [] })
    await expect(h.sessions.start(PROJECT, 'codex-1')).rejects.toThrow('No transcript of this Session')
    expect(h.asked).toEqual([])
  })

  it('a Vendor this build does not run is refused with the reason: on New session before any Node, on a saved Node before any start', async () => {
    const h = harness()
    await expect(h.sessions.open(PROJECT, 'gemini')).rejects.toThrow('gemini is not a Vendor this build of worfy runs')
    expect(h.nodes()).toEqual([])

    savedLayout([{ id: 'later', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', vendor: 'gemini', sessionId: THREAD } }])
    const next = harness()
    await expect(next.sessions.start(PROJECT, 'later')).rejects.toThrow('The Session of later cannot start: gemini is not a Vendor this build of worfy runs')
    expect(next.asked).toEqual([])
    // The Vendor of a later build stays in the Node as it was saved.
    expect(next.node('later').data).toStrictEqual({ origin: 'worfy', vendor: 'gemini', sessionId: THREAD })
  })

  it('a Vendor nobody is signed in to is refused with the reason before any Node is made', async () => {
    const connections: Record<VendorId, AccountConnection[]> = {
      claude: [{ provider: 'anthropic', signedIn: true, email: null, plan: null }],
      codex: [{ provider: 'openai', signedIn: false, email: null, plan: null }],
    }
    const h = harness({ vendorRefusal: signInRefusal((vendor) => ({ check: () => Promise.resolve(connections[vendor]) })) })
    await expect(h.sessions.open(PROJECT, 'codex')).rejects.toThrow('Nobody is signed in to Codex: sign in to it first')
    expect(h.nodes()).toEqual([])
    expect(h.asked).toEqual([])

    const created = await h.sessions.open(PROJECT, 'claude')
    expect(created.vendor).toBe('claude')
    await h.until(created.nodeId, 'idle')
  })
})

describe('the sign-in check of New session', () => {
  const signedIn = (yes: boolean): AccountConnection[] => [{ provider: 'openai', signedIn: yes, email: null, plan: null }]

  it('asks a Vendor once it is found signed in, and never a trusted one', async () => {
    const check = vi.fn(() => Promise.resolve(signedIn(true)))
    const refusal = signInRefusal(() => ({ check }), { trusted: new Set<VendorId>(['claude']) })
    expect(await refusal('claude')).toBeNull()
    expect(check).not.toHaveBeenCalled()
    expect(await refusal('codex')).toBeNull()
    expect(await refusal('codex')).toBeNull()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('asks again after a refusal: the user may sign in meanwhile', async () => {
    const check = vi.fn().mockResolvedValueOnce(signedIn(false)).mockResolvedValueOnce(signedIn(true))
    const refusal = signInRefusal(() => ({ check }))
    expect(await refusal('codex')).toBe('Nobody is signed in to Codex: sign in to it first')
    expect(await refusal('codex')).toBeNull()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('a check that fails or does not answer in time refuses nothing: the Session says the Vendor\'s own error', async () => {
    const log = vi.fn()
    const failing = signInRefusal(() => ({ check: () => Promise.reject(new Error('codex did not start')) }), { log })
    expect(await failing('codex')).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not check the sign-in to codex'), expect.any(Error))

    const hanging = signInRefusal(
      () => ({ check: (signal) => new Promise<AccountConnection[]>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason as Error))) }),
      { timeoutMs: 20, log },
    )
    expect(await hanging('codex')).toBeNull()
  })
})

describe('the default Vendor of a Project', () => {
  it('New session without a Vendor takes the Project\'s defaultVendor; without one, Claude Code', async () => {
    const h = harness()
    const plain = await h.sessions.open(PROJECT)
    expect(plain.vendor).toBe('claude')
    expect(h.node(plain.nodeId).data).toStrictEqual({ origin: 'worfy', vendor: 'claude' })
    await h.until(plain.nodeId, 'idle')

    savedSettings({ ...defaultProjectSettings('plugin'), defaultVendor: 'codex' })
    const chosen = await h.sessions.open(PROJECT)
    expect(chosen.vendor).toBe('codex')
    expect(h.node(chosen.nodeId).data).toStrictEqual({ origin: 'worfy', vendor: 'codex' })
    expect(h.asked).toEqual(['claude', 'codex'])
    await h.until(chosen.nodeId, 'idle')

    // A Vendor named on New session wins over the Project's.
    const named = await h.sessions.open(PROJECT, 'claude')
    expect(named.vendor).toBe('claude')
    await h.until(named.nodeId, 'idle')
  })

  it('a defaultVendor this build does not know reads as not chosen, and the rest of the file stays', async () => {
    const saved = { ...defaultProjectSettings('plugin'), terminalShell: 'git-bash', defaultVendor: 'gemini' }
    savedSettings(saved)
    const h = harness()
    const read = readProjectSettings(h.dataDir, 'plugin')
    expect(read.defaultVendor).toBeUndefined()
    expect(read).toEqual({ actionTemplates: saved.actionTemplates, terminalShell: 'git-bash' })
    // Reading wrote nothing: the file keeps the later build's value.
    expect(JSON.parse(readFileSync(join(h.dataDir, 'settings.json'), 'utf8'))).toStrictEqual(saved)

    const created = await h.sessions.open(PROJECT)
    expect(created.vendor).toBe('claude')
    await h.until(created.nodeId, 'idle')
  })

  it('a save of the settings without defaultVendor keeps the saved one; one with it changes it', () => {
    const dataDir = join(scratch, 'data', PROJECT)
    savedSettings({ ...defaultProjectSettings('plugin'), defaultVendor: 'codex' })
    // The settings dialog saves the templates and the shell only (it offers no Vendor before ticket 24).
    const kept = writeProjectSettings(dataDir, { actionTemplates: defaultProjectSettings('plugin').actionTemplates, terminalShell: 'powershell' }, 'plugin')
    expect(kept).toMatchObject({ terminalShell: 'powershell', defaultVendor: 'codex' })
    const changed = writeProjectSettings(dataDir, { ...defaultProjectSettings('plugin'), defaultVendor: 'claude' }, 'plugin')
    expect(changed.defaultVendor).toBe('claude')
    expect(readProjectSettings(dataDir, 'plugin').defaultVendor).toBe('claude')
  })
})
