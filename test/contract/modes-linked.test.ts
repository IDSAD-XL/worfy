// The Orchestrator modes from a Linked machine (worfy-retry ticket 13; spec of worfy-retry, Q15–Q18).
// Two Machines on the link bench (test/contract/link-bench.ts): A calls, B owns the Project. A's window
// goes through A's real `linked.invoke` (src/main/ipc/linked.ts) over A's real RemoteCalls; B serves
// the real handlers of Eco mode (over the real harness/bin/profile-set in a temporary Harness home),
// Auto-approval and Auto-continue (over an AppSettingsStore in a temporary folder). B's own window is a
// client of B's main (src/main/broadcast.ts) that records what it hears.
//
// Full access changes all three modes, and every write lands on B; read-only access sees them and is
// refused before a handler runs; a change on one Machine reaches the other at once (Q18). The five
// risks of the ticket: the link dropping in the middle of a write, the access level changing in the
// middle of a write, both Machines writing at once, a read-only Machine writing past its window, and a
// debugging port open on the calling Machine.
//
// Never run here: a real Claude Code or Agent SDK, Bonjour, the network beyond 127.0.0.1, the
// machine's own Harness home, registry or profiles.
import { execFileSync, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addClient } from '../../src/main/broadcast'
import { autoApprovalHandlers } from '../../src/main/ipc/auto-approve'
import { autoContinueHandlers } from '../../src/main/ipc/auto-continue'
import { ecoModeHandlers } from '../../src/main/ipc/eco-mode'
import { registerIpc, type HandlerModule, type ModuleLoader } from '../../src/main/ipc/index'
import { readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { RemoteCalls } from '../../src/main/link/remote-calls'
import { AppSettingsStore } from '../../src/main/settings/store'
import type { ProfileRun } from '../../src/main/workflow/profile'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AccessLevel } from '../../src/shared/ipc/link'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'
import { LinkBench, type BenchMachine } from './link-bench'

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-modes-linked-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude-home')
  return { scratch }
})

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

/** Why A's worfy runs with a debugging port open; null — it does not. B's handlers take their own. */
const debug = vi.hoisted(() => ({ reason: null as string | null }))
vi.mock('../../src/main/settings/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/settings/store')>()),
  debugAccess: () => debug.reason,
}))

/** A's RemoteCalls, made over the bench's A for each test: what the app's would be. */
const remote = vi.hoisted(() => ({ calls: undefined as unknown }))
vi.mock('../../src/main/link/remote-calls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/remote-calls')>()),
  appRemoteCalls: () => remote.calls,
}))

const PROJECT = 'demo-0a1b2c3d'
const DEBUG = 'worfy runs with a debugging port open (--remote-debugging-port)'

const scratch = env.scratch
const harnessHome = join(scratch, 'hh')
const repo = join(scratch, 'r', 'demo')
const profileJson = join(harnessHome, 'projects', 'demo', 'profile.json')
const settingsFile = join(scratch, 'b-data', 'app-settings.json')

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

const PROFILE = { schema: 2, name: 'demo', mode: 'full', commands: { test: 'make test' }, workflow: { ci: 'pr' } }
mkdirSync(join(scratch, 'home'), { recursive: true })
mkdirSync(join(harnessHome, 'gate'), { recursive: true })
mkdirSync(join(harnessHome, 'projects', 'demo'), { recursive: true })
mkdirSync(repo, { recursive: true })
mkdirSync(join(scratch, 'b-data'), { recursive: true })
git(repo, 'init', '-q')
writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo' }] }))
writeFileSync(join(harnessHome, 'projects', 'demo', 'rules.md'), '# demo rules\n')
writeFileSync(profileJson, `${JSON.stringify(PROFILE, null, 2)}\n`)
git(harnessHome, 'init', '-q')
git(harnessHome, 'add', '-A')
git(harnessHome, 'commit', '-q', '-m', 'init')
const profileBefore = readFileSync(profileJson, 'utf8')

// ---- B: the Machine of the Project --------------------------------------------------------------

/** The temporary homes, and nothing of the machine's registry or profiles. */
function harnessEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), HARNESS_HOME: harnessHome }
  delete out.CLAUDE_GATE_CONFIG
  delete out.CLAUDE_PROFILES_DIR
  delete out.EVAL_HARNESS_HOME
  delete out.ELECTRON_RUN_AS_NODE
  return out
}

/** The arguments of every run of bin/profile-set on B. */
const profileSetRuns: string[][] = []
/** Awaited after a run of bin/profile-set wrote and before B answers: a test holds a write there. */
let afterProfileSet: (() => Promise<void>) | null = null

/** The real bin/profile-set of this repository, in the temporary Harness home. */
async function profileSet(args: readonly string[], stdin?: string): Promise<ProfileRun> {
  profileSetRuns.push([...args])
  const run = await new Promise<ProfileRun>((done, fail) => {
    const child = spawn(NODE, [join(process.cwd(), 'harness', 'bin', 'profile-set'), ...args], { env: harnessEnv(), windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', fail)
    child.on('close', (code, signal) => done({ code, signal, stdout, stderr }))
    child.stdin.end(stdin ?? '')
  })
  if (afterProfileSet !== null && !args.includes('--read')) await afterProfileSet()
  return run
}

/** B's settings store; `beforeWrite` runs before each write of a mode and may throw to stop it. */
class BenchStore extends AppSettingsStore {
  beforeWrite: (() => void) | null = null
  afterWrite: (() => void) | null = null
  writes = 0
  override setAutoApproval(projectId: string, mode: AutoApprovalMode) {
    this.beforeWrite?.()
    this.writes += 1
    const done = super.setAutoApproval(projectId, mode)
    this.afterWrite?.()
    return done
  }
  override setAutoContinue(projectId: string, on: boolean) {
    this.beforeWrite?.()
    this.writes += 1
    const done = super.setAutoContinue(projectId, on)
    this.afterWrite?.()
    return done
  }
}

let store = new BenchStore(settingsFile)
const projects = () => [{ id: PROJECT, path: repo }]
const bHandlers = {
  eco: ecoModeHandlers({ projects, profileSet }),
  auto: autoApprovalHandlers({ projects, store: () => store, debugAccess: () => null }),
  cont: autoContinueHandlers({ projects, store: () => store }),
}

const modules: Record<string, ModuleLoader> = {
  './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
  './eco-mode.ts': async () => bHandlers.eco,
  './auto-approve.ts': async () => bHandlers.auto,
  './auto-continue.ts': async () => bHandlers.cont,
}

/** B's own window: what B's main sends it, by channel. */
class BWindow extends EventEmitter {
  readonly id = 'window:beta'
  readonly heard: { channel: string; payload: unknown }[] = []
  private gone = false
  send(channel: string, payload: unknown): void {
    this.heard.push({ channel: channel.startsWith(IPC_CHANNEL_PREFIX) ? channel.slice(IPC_CHANNEL_PREFIX.length) : channel, payload })
  }
  isDestroyed(): boolean {
    return this.gone
  }
  close(): void {
    this.gone = true
    this.emit('destroyed')
  }
  last(channel: string): unknown {
    return this.heard.filter((event) => event.channel === channel).at(-1)?.payload
  }
}

/** A call of B's own window: the handler of `channel` on B, as B's main runs it for its window. */
async function bWindowCall(channel: string, input: unknown): Promise<unknown> {
  const handler = [...bHandlers.eco, ...bHandlers.auto, ...bHandlers.cont].find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel} on B`)
  return handler.handle(input as never, {} as never)
}

// ---- A: the calling Machine ---------------------------------------------------------------------

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
const aMain = new Map<string, Listener>()
/** A's own handlers of Auto-approval: only `autoApproval.blockedHere` is asked here. */
const aAuto: HandlerModule = autoApprovalHandlers({ projects: () => [], store: () => new AppSettingsStore(join(scratch, 'a-data', 'app-settings.json')) })
await registerIpc(
  { handle: (channel, listener) => aMain.set(channel, listener as Listener) },
  {
    modules: { './linked.ts': () => import('../../src/main/ipc/linked').then((module) => module.default), './auto-approve.ts': async () => aAuto },
    isTrustedSender: () => true,
  },
)

/** A's window on Machine B. */
const aWindow = Object.assign(new EventEmitter(), { id: 7 })

/** A call of A's main from its window. */
async function aCall(channel: string, input: unknown): Promise<IpcResult<unknown>> {
  const listener = aMain.get(IPC_CHANNEL_PREFIX + channel)
  if (listener === undefined) throw new Error(`no handler for ${channel} on A`)
  return (await listener({ senderFrame: { url: 'file:///index.html' }, sender: aWindow } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
}

/** A's window calls `channel` of B, as the routed bridge of a window on B does (src/renderer/ipc.ts). */
async function onB(channel: string, input: unknown): Promise<IpcResult<unknown>> {
  const outer = await aCall('linked.invoke', { machine: bId, channel, input })
  return outer.ok ? (outer.value as IpcResult<unknown>) : outer
}

// ---- the bench ----------------------------------------------------------------------------------

let bench: LinkBench | undefined
let a: BenchMachine
let b: BenchMachine
let bId: string
let aCalls: RemoteCalls
let bWindow: BWindow
/** The events of B that A's main passed on to its windows. */
let aHeard: { channel: string; payload: unknown }[]

beforeEach(async () => {
  writeFileSync(profileJson, profileBefore)
  store = new BenchStore(settingsFile)
  writeFileSync(settingsFile, '{}\n')
  debug.reason = null
  afterProfileSet = null
  profileSetRuns.length = 0
  bench = new LinkBench({ ipcModules: modules, addClient })
  a = await bench.machine('alpha')
  b = await bench.machine('beta')
  await bench.link(a, b)
  bId = b.service.machine.id
  await a.service.connect(bId)
  aCalls = new RemoteCalls(a.service, { warn: () => undefined })
  // B tells A its level, as B's app does: A's windows follow it (useReadOnly).
  new RemoteCalls(b.service, { warn: () => undefined })
  remote.calls = aCalls
  aHeard = []
  aCalls.on('event', ({ machine, channel, payload }) => {
    if (machine === bId) aHeard.push({ channel, payload })
  })
  bWindow = new BWindow()
  addClient(bWindow)
})

afterEach(async () => {
  bWindow.close()
  const current = bench
  bench = undefined
  if (current === undefined) return
  const leaks = current.leakedSecrets()
  await current.close()
  expect(leaks).toEqual([])
})

afterAll(() => {
  removeTestTree(scratch)
})

/** B's access for A, as B's switch and level set it. */
function setAccess(level: AccessLevel): void {
  b.service.settings.set({ projectsAccess: level !== 'off', machines: { [a.service.machine.id]: level } })
}

/** Polls until `done` holds or `limit` ms pass. */
async function until(done: () => boolean, limit = 5000): Promise<void> {
  const deadline = Date.now() + ms(limit)
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
}

const settingsOnB = (): { autoApproval?: Record<string, string>; autoContinue?: Record<string, boolean> } =>
  JSON.parse(readFileSync(settingsFile, 'utf8')) as { autoApproval?: Record<string, string>; autoContinue?: Record<string, boolean> }
const agentsOnB = (): unknown => (JSON.parse(readFileSync(profileJson, 'utf8')) as { workflow?: { agents?: unknown } }).workflow?.agents
const lastOnA = (channel: string): unknown => aHeard.filter((event) => event.channel === channel).at(-1)?.payload

type EcoRead = { available: true; on: boolean; fingerprint: string }
async function ecoOnB(): Promise<EcoRead> {
  const read = await onB('ecoMode.read', { root: repo })
  if (!read.ok) throw new Error(read.error)
  return read.value as EcoRead
}

// ---- the tests ----------------------------------------------------------------------------------

describe('full access', () => {
  it('A reads all three modes of a Project of B, not "not open to Linked machines"', async () => {
    setAccess('all')
    expect(await onB('autoApproval.read', { projectId: PROJECT })).toEqual({ ok: true, value: { mode: 'off', saved: 'off', blocked: null } })
    expect(await onB('autoContinue.read', { projectId: PROJECT })).toEqual({ ok: true, value: { on: false } })
    expect(await ecoOnB()).toMatchObject({ available: true, on: false })
  })

  it('A changes all three; every write lands on B, none on A', async () => {
    setAccess('all')
    const { fingerprint } = await ecoOnB()
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'on' })).toEqual({ ok: true, value: { mode: 'on', saved: 'on', blocked: null } })
    expect(await onB('autoContinue.set', { projectId: PROJECT, on: true })).toEqual({ ok: true, value: { on: true } })
    expect(await onB('ecoMode.set', { root: repo, on: true, expected: fingerprint })).toMatchObject({ ok: true, value: { status: 'saved', on: true } })
    expect(settingsOnB()).toMatchObject({ autoApproval: { [PROJECT]: 'on' }, autoContinue: { [PROJECT]: true } })
    expect(agentsOnB()).toBe('eco')
    // A's own settings: neither the app's store nor A's data folder got a file.
    expect(existsSync(join(process.env.WORFY_DATA_DIR ?? '', 'app-settings.json'))).toBe(false)
    expect(existsSync(join(a.dataDir, 'app-settings.json'))).toBe(false)
    expect(existsSync(join(scratch, 'a-data', 'app-settings.json'))).toBe(false)
    // What A reads back is B's.
    expect(await onB('autoApproval.read', { projectId: PROJECT })).toMatchObject({ ok: true, value: { mode: 'on' } })
    expect(await onB('autoContinue.read', { projectId: PROJECT })).toEqual({ ok: true, value: { on: true } })
    expect(await ecoOnB()).toMatchObject({ on: true })
  })
})

describe('read-only access (risk 4: a read-only Machine writing past its window)', () => {
  it('A sees the three modes; every set is refused before its handler runs, and nothing on B changes', async () => {
    store.setAutoApproval(PROJECT, 'shadow')
    store.setAutoContinue(PROJECT, true)
    const writes = store.writes
    const settingsBefore = readFileSync(settingsFile, 'utf8')
    setAccess('read')
    expect(await onB('autoApproval.read', { projectId: PROJECT })).toEqual({ ok: true, value: { mode: 'shadow', saved: 'shadow', blocked: null } })
    expect(await onB('autoContinue.read', { projectId: PROJECT })).toEqual({ ok: true, value: { on: true } })
    const { fingerprint } = await ecoOnB()
    const refused = { ok: false, error: readOnlyRefusal('beta') }
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'off' })).toEqual(refused)
    expect(await onB('autoContinue.set', { projectId: PROJECT, on: false })).toEqual(refused)
    expect(await onB('ecoMode.set', { root: repo, on: true, expected: fingerprint })).toEqual(refused)
    // Refused before the input is parsed: an input outside the schema gets the same answer.
    expect(await onB('autoContinue.set', { not: 'an input' })).toEqual(refused)
    expect(store.writes).toBe(writes)
    expect(readFileSync(settingsFile, 'utf8')).toBe(settingsBefore)
    expect(readFileSync(profileJson, 'utf8')).toBe(profileBefore)
    expect(profileSetRuns.filter((args) => !args.includes('--read'))).toEqual([])
  })
})

describe('a change on one Machine shows on the other at once (Q18)', () => {
  it("a write from A reaches B's window, and one in B's window reaches A, with full and with read-only access", async () => {
    setAccess('all')
    const { fingerprint } = await ecoOnB()
    await onB('autoContinue.set', { projectId: PROJECT, on: true })
    await onB('autoApproval.set', { projectId: PROJECT, mode: 'shadow' })
    const eco = await onB('ecoMode.set', { root: repo, on: true, expected: fingerprint })
    const written = (eco as { value: { fingerprint: string } }).value.fingerprint
    expect(bWindow.last('autoContinue.changed')).toEqual({ projectId: PROJECT, on: true })
    expect(bWindow.last('autoApproval.changed')).toEqual({ projectId: PROJECT, state: { mode: 'shadow', saved: 'shadow', blocked: null } })
    expect(bWindow.last('ecoMode.changed')).toEqual({ root: repo, on: true, fingerprint: written })
    // A hears its own writes too: another window of A on B shows them.
    await until(() => lastOnA('ecoMode.changed') !== undefined)
    expect(lastOnA('autoContinue.changed')).toEqual({ projectId: PROJECT, on: true })

    setAccess('read')
    aHeard.length = 0
    await bWindowCall('autoContinue.set', { projectId: PROJECT, on: false })
    await bWindowCall('autoApproval.set', { projectId: PROJECT, mode: 'off' })
    await bWindowCall('ecoMode.set', { root: repo, on: false, expected: written })
    await until(() => lastOnA('ecoMode.changed') !== undefined && lastOnA('autoApproval.changed') !== undefined && lastOnA('autoContinue.changed') !== undefined)
    expect(lastOnA('autoContinue.changed')).toEqual({ projectId: PROJECT, on: false })
    expect(lastOnA('autoApproval.changed')).toEqual({ projectId: PROJECT, state: { mode: 'off', saved: 'off', blocked: null } })
    expect(lastOnA('ecoMode.changed')).toMatchObject({ root: repo, on: false })
  })

  it('a write that changes nothing sends no change', async () => {
    setAccess('all')
    await onB('autoContinue.set', { projectId: PROJECT, on: false })
    await onB('autoApproval.set', { projectId: PROJECT, mode: 'off' })
    expect(bWindow.heard.map((event) => event.channel)).toEqual([])
  })
})

describe('risk 1: the link drops in the middle of a write', () => {
  it('the write went through and the answer was lost: A gets "unreachable"; once connected again it reads what was written', async () => {
    setAccess('all')
    // B writes, then its end of the connection closes before the answer goes.
    store.afterWrite = () => b.service.connectionTo(a.service.machine.id)?.close()
    const result = await onB('autoContinue.set', { projectId: PROJECT, on: true })
    expect(result).toEqual({ ok: false, error: 'autoContinue.set: beta is unreachable' })
    store.afterWrite = null
    expect(settingsOnB().autoContinue).toEqual({ [PROJECT]: true })
    await until(() => !a.service.isConnected(bId))
    await a.service.connect(bId)
    await until(() => a.service.isConnected(bId))
    expect(await onB('autoContinue.read', { projectId: PROJECT })).toEqual({ ok: true, value: { on: true } })
  })

  it('the write did not go through: A gets "unreachable"; once connected again it reads the value before', async () => {
    setAccess('all')
    store.beforeWrite = () => {
      b.service.connectionTo(a.service.machine.id)?.close()
      throw new Error('the connection closed')
    }
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'on' })).toEqual({ ok: false, error: 'autoApproval.set: beta is unreachable' })
    store.beforeWrite = null
    expect(settingsOnB().autoApproval).toBeUndefined()
    await until(() => !a.service.isConnected(bId))
    await a.service.connect(bId)
    await until(() => a.service.isConnected(bId))
    expect(await onB('autoApproval.read', { projectId: PROJECT })).toMatchObject({ ok: true, value: { saved: 'off' } })
  })
})

describe('risk 2: the access level changes in the middle of a write', () => {
  it('the write already running finishes; the next one is refused, and A learns the level without loading again', async () => {
    setAccess('all')
    const { fingerprint } = await ecoOnB()
    let release: () => void = () => undefined
    let entered = false
    afterProfileSet = () => {
      entered = true
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const running = onB('ecoMode.set', { root: repo, on: true, expected: fingerprint })
    await until(() => entered)
    setAccess('read')
    release()
    expect(await running).toMatchObject({ ok: true, value: { status: 'saved', on: true } })
    expect(agentsOnB()).toBe('eco')
    afterProfileSet = null
    const now = await ecoOnB()
    expect(await onB('ecoMode.set', { root: repo, on: false, expected: now.fingerprint })).toEqual({ ok: false, error: readOnlyRefusal('beta') })
    expect(agentsOnB()).toBe('eco')
    // What A's windows follow (linked.state, useReadOnly): B is read-only now.
    await until(() => aCalls.machines().find((machine) => machine.id === bId)?.readOnly === true)
    expect(aCalls.machines().find((machine) => machine.id === bId)?.readOnly).toBe(true)
  })
})

describe('risk 3: both Machines write at once', () => {
  it('Eco mode: the second write with the fingerprint both read gets `conflict`, nothing is overwritten', async () => {
    setAccess('all')
    const { fingerprint } = await ecoOnB()
    expect(await onB('ecoMode.set', { root: repo, on: true, expected: fingerprint })).toMatchObject({ ok: true, value: { status: 'saved' } })
    expect(await bWindowCall('ecoMode.set', { root: repo, on: false, expected: fingerprint })).toEqual({ status: 'conflict' })
    expect(agentsOnB()).toBe('eco')
    // Both read the same now.
    const onA = await ecoOnB()
    expect(await bWindowCall('ecoMode.read', { root: repo })).toEqual(onA)
  })

  it('Auto-approval and Auto-continue: the last write on B wins, and the changes bring both menus to it', async () => {
    setAccess('all')
    await Promise.all([onB('autoApproval.set', { projectId: PROJECT, mode: 'on' }), bWindowCall('autoApproval.set', { projectId: PROJECT, mode: 'shadow' })])
    await Promise.all([onB('autoContinue.set', { projectId: PROJECT, on: true }), bWindowCall('autoContinue.set', { projectId: PROJECT, on: false })])
    const saved = settingsOnB().autoApproval?.[PROJECT] ?? 'off'
    const on = settingsOnB().autoContinue?.[PROJECT] === true
    expect((bWindow.last('autoApproval.changed') as { state: { saved: string } }).state.saved).toBe(saved)
    expect(bWindow.last('autoContinue.changed')).toEqual({ projectId: PROJECT, on })
    await until(() => (lastOnA('autoApproval.changed') as { state: { saved: string } } | undefined)?.state.saved === saved && (lastOnA('autoContinue.changed') as { on: boolean } | undefined)?.on === on)
    expect((lastOnA('autoApproval.changed') as { state: { saved: string } }).state.saved).toBe(saved)
    expect(lastOnA('autoContinue.changed')).toEqual({ projectId: PROJECT, on })
    expect(await onB('autoApproval.read', { projectId: PROJECT })).toMatchObject({ ok: true, value: { saved } })
    expect(await onB('autoContinue.read', { projectId: PROJECT })).toEqual({ ok: true, value: { on } })
  })
})

describe('risk 5: a debugging port open on the calling Machine', () => {
  it('A refuses Shadow and On before they leave it, with the text B gives; Off goes through; the mode on B stays', async () => {
    setAccess('all')
    store.setAutoApproval(PROJECT, 'on')
    const writes = store.writes
    debug.reason = DEBUG
    const refused = { ok: false, error: `autoApproval.set failed: Auto-approval stays off: ${DEBUG}, so any program on this Machine could call this channel` }
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'on' })).toEqual(refused)
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'shadow' })).toEqual(refused)
    // An input A cannot read is refused too: only a plain Off passes.
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'Off' })).toEqual(refused)
    expect(await onB('autoApproval.set', { projectId: PROJECT })).toEqual(refused)
    expect(store.writes).toBe(writes)
    expect(settingsOnB().autoApproval).toEqual({ [PROJECT]: 'on' })
    expect(await onB('autoApproval.set', { projectId: PROJECT, mode: 'off' })).toEqual({ ok: true, value: { mode: 'off', saved: 'off', blocked: null } })
    expect(settingsOnB().autoApproval).toBeUndefined()
    // The other modes go through: a debugging port holds only Auto-approval.
    expect(await onB('autoContinue.set', { projectId: PROJECT, on: true })).toEqual({ ok: true, value: { on: true } })
  })

  it("A's window learns why from A's main (`autoApproval.blockedHere`), and nothing is blocked without the port", async () => {
    expect(await aCall('autoApproval.blockedHere', undefined)).toEqual({ ok: true, value: { blocked: null } })
    debug.reason = DEBUG
    expect(await aCall('autoApproval.blockedHere', undefined)).toEqual({ ok: true, value: { blocked: DEBUG } })
  })
})
