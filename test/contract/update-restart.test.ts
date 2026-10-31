// "Restart now", "Restart when idle" and the roll back (worfy-update ticket 04, spec R5–R8, ADR-0089
// points 4 and 5) over a temporary data folder: spawn, app.quit and the dialog are stand-ins, the
// Stable copy is a folder in the temporary folder (assertTemporaryStableCopy), and no test quits an
// app or runs the real helper. One test starts a real detached node with a stand-in helper that only
// writes down what it got, to show the arguments and the folder reach it as given on each system.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/ipc/update'
import { UpdateService } from '../../src/main/ipc/update'
import type { UpdateGitHub } from '../../src/main/update/check'
import { IdleWatch, type IdleSignal } from '../../src/main/update/idle'
import { helperScript, helperStart, NODE_MISSING, NODE_NOT_EXE, previousPaths, restartFile, Restarts, resultFile, settleLastRestart, type SpawnDetached } from '../../src/main/update/restart'
import { changeUpdateState, readUpdateState } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { findScriptNode } from '../script-node'
import { ms } from '../time-scale'
import { assertTemporaryStableCopy } from '../update-stub'

vi.mock('electron', () => ({ app: {}, shell: { openPath: () => Promise.resolve('') }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))

const WINDOWS = process.platform === 'win32'
/** The tests' node, asked for on first use: never while the file loads. */
let scriptNode: string | undefined
const node = (): string => (scriptNode ??= findScriptNode(process.env))

const BUILT_SHA = 'b'.repeat(40)
const RUNNING_SHA = 'a'.repeat(40)
const PREVIOUS_SHA = 'c'.repeat(40)
const PID = 4242

/** An idle signal the test sets. */
class FakeIdle implements IdleSignal {
  private listeners = new Set<(idle: boolean) => void>()
  constructor(public idle: boolean) {}
  recheck(): boolean {
    return this.idle
  }
  subscribe(listener: (idle: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  set(idle: boolean): void {
    if (idle === this.idle) return
    this.idle = idle
    for (const listener of [...this.listeners]) listener(idle)
  }
}

interface Spawned {
  file: string
  args: readonly string[]
  options: Parameters<SpawnDetached>[2]
}

let root: string
let dir: string
let target: string
let appPath: string
let stateFile: string
let calls: string[]
let spawned: Spawned[]

/** The environment the helper's node is found in: the folder of the tests' node, and a token that must not reach the helper. */
const shellEnv = (): Record<string, string> => ({
  PATH: dirname(node()),
  GH_TOKEN: 'gh-secret-not-for-the-helper',
  ...(WINDOWS ? { PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}),
})

/** A spawn that notes what it was asked and answers a started child. */
const fakeSpawn: SpawnDetached = (file, args, options) => {
  calls.push('spawn')
  spawned.push({ file, args, options })
  return { pid: 777, on: () => undefined, unref: () => undefined }
}

function restarts(idle: IdleSignal, overrides: Partial<ConstructorParameters<typeof Restarts>[0]> = {}): { restarts: Restarts; quit: ReturnType<typeof vi.fn> } {
  const quit = vi.fn(() => calls.push('quit'))
  return {
    quit,
    restarts: new Restarts({
      dir,
      stateFile: () => stateFile,
      target: () => target,
      pid: PID,
      env: () => Promise.resolve(shellEnv()),
      running: () => ({ commit: RUNNING_SHA, version: '0.5.0+aaaaaaa' }),
      idle,
      quit,
      spawn: fakeSpawn,
      now: () => new Date('2026-10-31T10:00:00.000Z'),
      ...overrides,
    }),
  }
}

/** A build of ticket 03 that is ready. */
function readyBuild(): void {
  mkdirSync(appPath, { recursive: true })
  changeUpdateState((state) => ({ ...state, build: { phase: 'ready', sha: BUILT_SHA, version: '0.6.0+bbbbbbb', appPath, log: 'build.log' } }), stateFile)
}

/** A previous copy kept by --keep-previous, with its file. */
function previousCopy(commit = PREVIOUS_SHA): void {
  const paths = previousPaths(process.platform, target)
  mkdirSync(paths.copy, { recursive: true })
  writeFileSync(paths.metadata, JSON.stringify({ commit, dirty: false }))
}

/** A promise and its resolve, to hold a step of a restart while the test changes the world. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

beforeEach(() => {
  // A space in the path: the arguments must reach the helper whole on either system.
  root = mkdtempSync(join(tmpdir(), 'worfy update restart '))
  dir = join(root, 'data', 'update')
  target = join(root, 'Applications', WINDOWS ? 'worfy-stable' : 'worfy-stable.app')
  assertTemporaryStableCopy(target)
  appPath = join(dir, 'repo', 'dist', WINDOWS ? 'win-unpacked' : join('mac-arm64', 'worfy.app'))
  stateFile = join(dir, 'state.json')
  mkdirSync(dirname(helperScript(dir)), { recursive: true })
  writeFileSync(helperScript(dir), '// stands in for scripts/install-stable.mjs; never run by these tests\n')
  calls = []
  spawned = []
})

afterEach(() => {
  removeTestTree(root)
})

describe('Restart now', () => {
  it('starts the helper with the system node, detached, and only then quits', async () => {
    readyBuild()
    const { restarts: subject, quit } = restarts(new FakeIdle(true))

    expect(await subject.restart('now')).toEqual({ outcome: 'quitting' })

    expect(spawned).toHaveLength(1)
    const [call] = spawned as [Spawned]
    expect(call.file).toBe(WINDOWS ? join(dirname(node()), 'node.exe') : 'node')
    expect(call.args).toEqual([helperScript(dir), target, '--wait-pid', String(PID), '--keep-previous', '--relaunch', '--result', resultFile(dir)])
    expect(call.options).toMatchObject({ detached: true, windowsHide: true, cwd: dir })
    expect(call.options.env.WORFY_STABLE_PREBUILT).toBe(appPath)
    expect(call.options.env.GH_TOKEN).toBeUndefined()
    expect(calls).toEqual(['spawn', 'quit'])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(restartFile(dir), 'utf8'))).toEqual({
      action: 'install',
      version: '0.6.0+bbbbbbb',
      sha: BUILT_SHA,
      from: { sha: RUNNING_SHA, version: '0.5.0+aaaaaaa' },
      harness: true,
      at: '2026-10-31T10:00:00.000Z',
    })
  })

  it('is refused without a ready build: nothing started, nothing written, no quit', async () => {
    const { restarts: subject, quit } = restarts(new FakeIdle(true))
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'no Update is built and ready' })
    changeUpdateState((state) => ({ ...state, build: { phase: 'building', sha: BUILT_SHA } }), stateFile)
    expect(await subject.restart('now')).toMatchObject({ outcome: 'refused' })
    // Ready in the file, but its app is gone.
    changeUpdateState((state) => ({ ...state, build: { phase: 'ready', sha: BUILT_SHA, version: '0.6.0+bbbbbbb', appPath } }), stateFile)
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: `the built app is gone: ${appPath}` })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('is refused while something works: nothing started, no quit', async () => {
    readyBuild()
    const { restarts: subject, quit } = restarts(new FakeIdle(false))
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'a Session is working or Autopilot runs', busy: true })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('is refused when the clone has no helper', async () => {
    readyBuild()
    removeTestTree(join(dir, 'repo', 'scripts'))
    const { restarts: subject } = restarts(new FakeIdle(true))
    expect(await subject.restart('now')).toMatchObject({ outcome: 'refused' })
    expect(spawned).toEqual([])
  })

  it('is refused when node is not on the PATH', async () => {
    readyBuild()
    const empty = mkdtempSync(join(root, 'no-node-'))
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { env: () => Promise.resolve({ PATH: empty, PATHEXT: '.EXE' }) })
    expect(await subject.restart('now')).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('node was not found') })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('looks at Autopilot afresh right before the helper starts, not as the last look every 2 s saw it', async () => {
    readyBuild()
    let autopilot = false
    const watch = new IdleWatch({ sources: { sessions: () => [], autopilotRunning: () => autopilot }, observe: () => () => undefined })
    const stopWatch = watch.start()
    try {
      const env = deferred<Record<string, string>>()
      const { restarts: subject, quit } = restarts(watch, { env: () => env.promise })
      const answer = subject.restart('now')
      // An Autopilot run starts; the next look of the watch would be up to 2 s later.
      autopilot = true
      env.resolve(shellEnv())
      expect(await answer).toEqual({ outcome: 'refused', reason: 'a Session is working or Autopilot runs', busy: true })
      expect(spawned).toEqual([])
      expect(quit).not.toHaveBeenCalled()
      expect(watch.idle).toBe(false)
    } finally {
      stopWatch()
    }
  })

  it('a helper that does not start puts back the restart.json of the restart before', async () => {
    readyBuild()
    const earlier = `${JSON.stringify({ action: 'install', version: '0.5.0+aaaaaaa', sha: RUNNING_SHA, from: { sha: PREVIOUS_SHA, version: '0.4.0+ccccccc' }, harness: true, at: '2026-10-30T10:00:00.000Z' })}\n`
    writeFileSync(restartFile(dir), earlier)
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { spawn: () => ({ pid: undefined, on: () => undefined, unref: () => undefined }) })
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'node could not be started' })
    expect(readFileSync(restartFile(dir), 'utf8')).toBe(earlier)
    expect(quit).not.toHaveBeenCalled()
  })

  it('removes the result of an earlier restart before the helper starts', async () => {
    readyBuild()
    writeFileSync(resultFile(dir), JSON.stringify({ ok: false, action: 'install', commit: null, previous: null, reason: 'an earlier run', notes: [] }))
    const { restarts: subject } = restarts(new FakeIdle(true))
    expect(await subject.restart('now')).toEqual({ outcome: 'quitting' })
    expect(existsSync(resultFile(dir))).toBe(false)
  })

  it('lets the started helper go (unref) and hears its late error without failing', async () => {
    readyBuild()
    const child = Object.assign(new EventEmitter(), { pid: 778, unref: vi.fn() })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { restarts: subject, quit } = restarts(new FakeIdle(true), { spawn: () => child })
      expect(await subject.restart('now')).toEqual({ outcome: 'quitting' })
      expect(child.unref).toHaveBeenCalledTimes(1)
      expect(quit).toHaveBeenCalledTimes(1)
      // Without a listener an 'error' event would throw here.
      child.emit('error', new Error('spawn node ENOENT'))
      expect(warn).toHaveBeenCalledWith('[update] the restart helper failed', expect.any(Error))
    } finally {
      warn.mockRestore()
    }
  })

  it('starts node.exe of the Path on Windows and refuses a node.cmd', () => {
    const env = { PATH: 'C:\\tools;C:\\node', PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: 'C:\\Windows' }
    const args = ['C:\\data\\update\\repo\\scripts\\install-stable.mjs', 'C:\\Users\\me me\\AppData\\Local\\worfy-stable']
    expect(helperStart(args, env, 'win32', (path) => path === 'C:\\node\\node.exe')).toEqual({ file: 'C:\\node\\node.exe', args })
    // A node.cmd earlier on the Path is what a terminal would run: refused, not glued into a cmd.exe line.
    expect(helperStart(args, env, 'win32', (path) => path === 'C:\\tools\\node.cmd' || path === 'C:\\node\\node.exe')).toBe(NODE_NOT_EXE)
    expect(helperStart(args, env, 'win32', () => false)).toBe(NODE_MISSING)
  })

  it.runIf(WINDOWS)('refuses a node.cmd on Windows: no cmd.exe, no command line glued from the paths', async () => {
    readyBuild()
    const bin = mkdtempSync(join(root, 'node-cmd-'))
    writeFileSync(join(bin, 'node.cmd'), '@echo off\r\n')
    const { restarts: subject, quit } = restarts(new FakeIdle(true), {
      platform: 'win32',
      env: () => Promise.resolve({ PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: 'C:\\Windows' }),
    })
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: NODE_NOT_EXE })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('a helper that does not start leaves no restart.json and does not quit', async () => {
    readyBuild()
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { spawn: () => ({ pid: undefined, on: () => undefined, unref: () => undefined }) })
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'node could not be started' })
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
    const throwing = restarts(new FakeIdle(true), {
      spawn: () => {
        throw new Error('spawn EACCES')
      },
    })
    expect(await throwing.restarts.restart('now')).toEqual({ outcome: 'refused', reason: 'node could not be started (spawn EACCES)' })
    expect(throwing.quit).not.toHaveBeenCalled()
  })

  it('two presses start one helper and quit once', async () => {
    readyBuild()
    const { restarts: subject, quit } = restarts(new FakeIdle(true))
    const answers = await Promise.all([subject.restart('now'), subject.restart('now'), subject.restart('idle')])
    expect(answers).toEqual([{ outcome: 'quitting' }, { outcome: 'quitting' }, { outcome: 'quitting' }])
    expect(spawned).toHaveLength(1)
    expect(quit).toHaveBeenCalledTimes(1)
    // Once worfy quits, a press is refused.
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'worfy is quitting' })
    expect(spawned).toHaveLength(1)
  })

  it('a Session that begins a turn while the restart is asked for stops it', async () => {
    readyBuild()
    const idle = new FakeIdle(true)
    const env = deferred<Record<string, string>>()
    const { restarts: subject, quit } = restarts(idle, { env: () => env.promise })
    const answer = subject.restart('now')
    idle.set(false)
    env.resolve(shellEnv())
    expect(await answer).toEqual({ outcome: 'refused', reason: 'a Session is working or Autopilot runs', busy: true })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('a cancel while the restart is asked for stops it', async () => {
    readyBuild()
    const env = deferred<Record<string, string>>()
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { env: () => env.promise })
    const answer = subject.restart('now')
    expect(await subject.restart('cancel')).toEqual({ outcome: 'cancelled' })
    env.resolve(shellEnv())
    expect(await answer).toEqual({ outcome: 'cancelled' })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
  })

  it('worfy quitting while the restart is asked for stops it', async () => {
    readyBuild()
    const env = deferred<Record<string, string>>()
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { env: () => env.promise })
    const answer = subject.restart('now')
    subject.quitting()
    env.resolve(shellEnv())
    expect(await answer).toEqual({ outcome: 'refused', reason: 'worfy is quitting' })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
  })
})

describe('Restart when idle', () => {
  it('pressed when all is quiet, keeps waiting when a Session begins a turn while the restart is asked for', async () => {
    readyBuild()
    const idle = new FakeIdle(true)
    const env = deferred<Record<string, string>>()
    const { restarts: subject, quit } = restarts(idle, { env: () => env.promise })
    const answer = subject.restart('idle')
    idle.set(false)
    env.resolve(shellEnv())
    expect(await answer).toEqual({ outcome: 'waiting' })
    expect(subject.pending).toBe(true)
    expect(quit).not.toHaveBeenCalled()
    // The turn ends: the restart the wish kept goes now.
    idle.set(true)
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(spawned).toHaveLength(1)
    expect(subject.pending).toBe(false)
  })

  it('pressed when all is quiet, answers the refusal that is not about work, and keeps no wish', async () => {
    const { restarts: subject } = restarts(new FakeIdle(true))
    expect(await subject.restart('idle')).toEqual({ outcome: 'refused', reason: 'no Update is built and ready' })
    expect(subject.pending).toBe(false)
  })

  it('waits while something works, restarts once all is quiet, and a press of Restart now drops the wish', async () => {
    readyBuild()
    const idle = new FakeIdle(false)
    const changes = vi.fn()
    const { restarts: subject, quit } = restarts(idle, { onChange: changes })

    expect(await subject.restart('idle')).toEqual({ outcome: 'waiting' })
    expect(subject.pending).toBe(true)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(spawned).toEqual([])

    // "Restart now" pressed while something works: refused, and the wish is gone.
    expect(await subject.restart('now')).toMatchObject({ outcome: 'refused', busy: true })
    expect(subject.pending).toBe(false)
    idle.set(true)
    await vi.waitFor(() => expect(subject.pending).toBe(false))
    expect(spawned).toEqual([])

    // Armed again, it restarts on the next quiet.
    idle.set(false)
    await subject.restart('idle')
    idle.set(true)
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(spawned).toHaveLength(1)
    expect(subject.pending).toBe(false)
  })

  it('restarts at once when all is quiet already', async () => {
    readyBuild()
    const { restarts: subject, quit } = restarts(new FakeIdle(true))
    expect(await subject.restart('idle')).toEqual({ outcome: 'quitting' })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('a cancel before the quiet: no restart', async () => {
    readyBuild()
    const idle = new FakeIdle(false)
    const { restarts: subject, quit } = restarts(idle)
    await subject.restart('idle')
    expect(await subject.restart('cancel')).toEqual({ outcome: 'cancelled' })
    idle.set(true)
    await new Promise((done) => setImmediate(done))
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
  })

  it('a cancel that comes while the quiet starts the restart wins', async () => {
    readyBuild()
    const idle = new FakeIdle(false)
    const env = deferred<Record<string, string>>()
    const { restarts: subject, quit } = restarts(idle, { env: () => env.promise })
    await subject.restart('idle')
    idle.set(true)
    expect(await subject.restart('cancel')).toEqual({ outcome: 'cancelled' })
    env.resolve(shellEnv())
    await new Promise((done) => setImmediate(done))
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(subject.pending).toBe(false)
  })

  it('a quit of worfy with the wish pending restarts nothing, also when the Sessions then close', async () => {
    readyBuild()
    const idle = new FakeIdle(false)
    const { restarts: subject, quit } = restarts(idle)
    await subject.restart('idle')
    subject.quitting()
    expect(subject.pending).toBe(false)
    idle.set(true)
    await new Promise((done) => setImmediate(done))
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(await subject.restart('idle')).toEqual({ outcome: 'refused', reason: 'worfy is quitting' })
  })
})

describe('Roll back', () => {
  it('does nothing when the dialog says Cancel', async () => {
    previousCopy()
    const { restarts: subject, quit } = restarts(new FakeIdle(true))
    const confirm = vi.fn(() => Promise.resolve(false))
    expect(await subject.rollback(confirm)).toEqual({ outcome: 'cancelled' })
    expect(confirm).toHaveBeenCalledWith(PREVIOUS_SHA.slice(0, 7))
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    expect(existsSync(restartFile(dir))).toBe(false)
  })

  it('runs the helper with --rollback and no build when the dialog says Roll back', async () => {
    previousCopy()
    // The restart that kept this copy named its version.
    writeFileSync(restartFile(dir), JSON.stringify({ action: 'install', version: '0.5.0+aaaaaaa', sha: RUNNING_SHA, from: { sha: PREVIOUS_SHA, version: '0.4.0+ccccccc' }, harness: true, at: '2026-10-30T10:00:00.000Z' }))
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { env: () => Promise.resolve({ ...shellEnv(), WORFY_STABLE_PREBUILT: '/somewhere' }) })
    const confirm = vi.fn(() => Promise.resolve(true))

    expect(await subject.rollback(confirm)).toEqual({ outcome: 'quitting' })

    expect(confirm).toHaveBeenCalledWith('0.4.0+ccccccc')
    const [call] = spawned as [Spawned]
    expect(call.args).toEqual([helperScript(dir), target, '--wait-pid', String(PID), '--rollback', '--relaunch', '--result', resultFile(dir)])
    expect(call.args).not.toContain('--keep-previous')
    expect(call.options.env.WORFY_STABLE_PREBUILT).toBeUndefined()
    expect(calls).toEqual(['spawn', 'quit'])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(restartFile(dir), 'utf8'))).toMatchObject({
      action: 'rollback',
      version: '0.4.0+ccccccc',
      sha: PREVIOUS_SHA,
      from: { sha: RUNNING_SHA, version: '0.5.0+aaaaaaa' },
      harness: true,
    })
  })

  it('is refused without a previous copy, before any dialog', async () => {
    const { restarts: subject } = restarts(new FakeIdle(true))
    const confirm = vi.fn(() => Promise.resolve(true))
    expect(await subject.rollback(confirm)).toEqual({ outcome: 'refused', reason: 'no previous version is kept' })
    // A file with the name of the copy, next to its metadata, is no copy.
    const paths = previousPaths(process.platform, target)
    mkdirSync(dirname(paths.copy), { recursive: true })
    writeFileSync(paths.copy, 'not a copy')
    writeFileSync(paths.metadata, JSON.stringify({ commit: PREVIOUS_SHA }))
    expect(await subject.rollback(confirm)).toEqual({ outcome: 'refused', reason: 'no previous version is kept' })
    removeTestTree(paths.copy)
    removeTestTree(paths.metadata)
    // A folder without its file is no copy either.
    mkdirSync(paths.copy, { recursive: true })
    expect(await subject.rollback(confirm)).toEqual({ outcome: 'refused', reason: 'no previous version is kept' })
    expect(confirm).not.toHaveBeenCalled()
    expect(spawned).toEqual([])
  })

  it('is refused while something works, before the dialog and after it', async () => {
    previousCopy()
    const idle = new FakeIdle(false)
    const { restarts: subject, quit } = restarts(idle)
    const confirm = vi.fn(() => Promise.resolve(true))
    expect(await subject.rollback(confirm)).toMatchObject({ outcome: 'refused', busy: true })
    expect(confirm).not.toHaveBeenCalled()

    idle.set(true)
    const asked = deferred<boolean>()
    const answer = subject.rollback(() => asked.promise)
    // A second press while the dialog is open is refused; so is a restart.
    expect(await subject.rollback(confirm)).toEqual({ outcome: 'refused', reason: 'a restart is under way' })
    expect(await subject.restart('now')).toEqual({ outcome: 'refused', reason: 'a roll back is under way' })
    idle.set(false)
    asked.resolve(true)
    expect(await answer).toMatchObject({ outcome: 'refused', busy: true })
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
  })
})

describe('At the start', () => {
  const settle = (): void => settleLastRestart({ dir, stateFile, target, platform: process.platform })

  it('a result file gives lastRestart and is removed; restart.json stays', () => {
    readyBuild()
    changeUpdateState((state) => ({ ...state, available: { sha: BUILT_SHA, version: '0.6.0+bbbbbbb', quiet: false } }), stateFile)
    previousCopy(RUNNING_SHA)
    writeFileSync(restartFile(dir), JSON.stringify({ action: 'install', version: '0.6.0+bbbbbbb', sha: BUILT_SHA, from: { sha: RUNNING_SHA, version: '0.5.0+aaaaaaa' }, harness: true, at: '2026-10-31T10:00:00.000Z' }))
    writeFileSync(resultFile(dir), JSON.stringify({ ok: true, action: 'install', commit: BUILT_SHA, previous: previousPaths(process.platform, target).copy, notes: [] }))

    settle()

    const state = readUpdateState(stateFile)
    expect(state.lastRestart).toEqual({ ok: true, action: 'install', version: '0.6.0+bbbbbbb' })
    expect(state.previous).toEqual({ version: '0.5.0+aaaaaaa' })
    // The build installed is no Update to restart into any more.
    expect(state.build).toEqual({ phase: 'idle' })
    expect(state.available).toBeNull()
    expect(existsSync(resultFile(dir))).toBe(false)
    expect(existsSync(restartFile(dir))).toBe(true)
  })

  it('a refusal of the helper gives ok: false with its reason, and the build stays ready', () => {
    readyBuild()
    writeFileSync(restartFile(dir), JSON.stringify({ action: 'install', version: '0.6.0+bbbbbbb', sha: BUILT_SHA, from: { sha: RUNNING_SHA, version: '0.5.0+aaaaaaa' }, harness: true, at: '2026-10-31T10:00:00.000Z' }))
    writeFileSync(resultFile(dir), JSON.stringify({ ok: false, action: 'install', commit: null, previous: null, reason: 'process 4242 is still running after 120 s: nothing was changed', notes: [] }))

    settle()

    const state = readUpdateState(stateFile)
    expect(state.lastRestart).toEqual({ ok: false, action: 'install', version: '0.6.0+bbbbbbb', reason: 'process 4242 is still running after 120 s: nothing was changed' })
    expect(state.build.phase).toBe('ready')
    expect(state.previous).toBeNull()
    expect(existsSync(resultFile(dir))).toBe(false)
  })

  it('a result that does not read is a failed restart', () => {
    writeFileSync(resultFile(dir), '{ half a')
    settle()
    expect(readUpdateState(stateFile).lastRestart).toMatchObject({ ok: false, action: 'install', reason: expect.stringContaining('could not be read') })
    expect(existsSync(resultFile(dir))).toBe(false)
  })

  it('a roll back names the commit it left (rolledBackFrom), which goes quiet; no previous copy is left', () => {
    readyBuild()
    changeUpdateState((state) => ({ ...state, available: { sha: BUILT_SHA, version: '0.6.0+bbbbbbb', quiet: false } }), stateFile)
    writeFileSync(restartFile(dir), JSON.stringify({ action: 'rollback', version: '0.5.0+aaaaaaa', sha: RUNNING_SHA, from: { sha: BUILT_SHA, version: '0.6.0+bbbbbbb' }, harness: true, at: '2026-10-31T10:00:00.000Z' }))
    writeFileSync(resultFile(dir), JSON.stringify({ ok: true, action: 'rollback', commit: RUNNING_SHA, previous: null, notes: [] }))

    settle()

    const state = readUpdateState(stateFile)
    expect(state.lastRestart).toEqual({ ok: true, action: 'rollback', version: '0.5.0+aaaaaaa' })
    expect(state.rolledBackFrom).toBe(BUILT_SHA)
    expect(state.available).toEqual({ sha: BUILT_SHA, version: '0.6.0+bbbbbbb', quiet: true })
    expect(state.build).toEqual({ phase: 'idle' })
    expect(state.previous).toBeNull()
  })

  it('without a result file only previous is read', () => {
    previousCopy()
    settle()
    const state = readUpdateState(stateFile)
    expect(state.lastRestart).toBeNull()
    expect(state.previous).toEqual({ version: PREVIOUS_SHA.slice(0, 7) })
  })
})

describe('The service', () => {
  const client: UpdateGitHub = {
    headOfMain: () => Promise.resolve({ ok: false, reason: 'offline' }),
    ciOk: () => Promise.resolve({ ok: false, reason: 'offline' }),
    compare: () => Promise.resolve({ ok: false, reason: 'offline' }),
    packageVersion: () => Promise.resolve({ ok: false, reason: 'offline' }),
  }

  it('off, refuses a restart and a roll back', async () => {
    const service = new UpdateService({ enabled: false, running: () => ({ commit: '', version: '' }), client, stateFile: () => stateFile, broadcast: () => undefined })
    const off = { outcome: 'refused', reason: 'Update is off in this copy of worfy' }
    expect(await service.restart('now')).toEqual(off)
    expect(await service.rollback(() => Promise.resolve(true))).toEqual(off)
    expect(service.snapshot().restartWhenIdle).toBe(false)
  })

  it('keeps idle in the state, reads the last restart at the start and shows the wish in the snapshot', async () => {
    readyBuild()
    writeFileSync(resultFile(dir), JSON.stringify({ ok: true, action: 'install', commit: BUILT_SHA, previous: null, notes: [] }))
    let busy = true
    const listeners = new Set<() => void>()
    const watch = new IdleWatch({
      sources: { sessions: () => (busy ? [{ state: 'busy', backgroundTasks: 0 }] : []), autopilotRunning: () => false },
      observe: (listener) => {
        const each = (): void => listener('s1', { type: 'state', state: busy ? 'busy' : 'idle', error: null })
        listeners.add(each)
        return () => listeners.delete(each)
      },
    })
    const sent: UpdateSnapshot[] = []
    const { restarts: subject, quit } = restarts(watch)
    const service = new UpdateService({ enabled: true, running: () => ({ commit: RUNNING_SHA, version: '0.5.0+aaaaaaa' }), client, stateFile: () => stateFile, broadcast: (snapshot) => sent.push(snapshot), idle: watch, restarts: subject })
    const stop = service.start()
    try {
      expect(readUpdateState(stateFile).idle).toBe(false)
      expect(readUpdateState(stateFile).lastRestart).toMatchObject({ ok: true, action: 'install' })
      expect(existsSync(resultFile(dir))).toBe(false)

      expect(await service.restart('idle')).toEqual({ outcome: 'waiting' })
      expect(service.snapshot().restartWhenIdle).toBe(true)

      busy = false
      for (const each of listeners) each()
      await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
      expect(readUpdateState(stateFile).idle).toBe(true)
      expect(sent.at(-1)?.idle).toBe(true)
      expect(service.snapshot().restartWhenIdle).toBe(false)
    } finally {
      stop()
    }
    // Stopped, the watch follows nothing.
    expect(listeners.size).toBe(0)
  })
})

describe('The helper process', () => {
  it('gets its arguments whole and runs in the folder of Update, detached, after worfy quits', async () => {
    readyBuild()
    const seen = join(root, 'seen by the helper.json')
    // The stand-in helper writes down what it got, once, and ends.
    writeFileSync(
      helperScript(dir),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), prebuilt: process.env.WORFY_STABLE_PREBUILT ?? null, token: process.env.GH_TOKEN ?? null }))\n`,
    )
    const { restarts: subject, quit } = restarts(new FakeIdle(true), { spawn: undefined })

    expect(await subject.restart('now')).toEqual({ outcome: 'quitting' })
    expect(quit).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(existsSync(seen)).toBe(true), { timeout: ms(10_000), interval: 50 })
    // Written whole under one name: read once it is there.
    await vi.waitFor(() => JSON.parse(readFileSync(seen, 'utf8')) as unknown, { timeout: ms(5_000), interval: 50 })
    const got = JSON.parse(readFileSync(seen, 'utf8')) as { args: string[]; cwd: string; prebuilt: string | null; token: string | null }
    expect(got.args).toEqual([target, '--wait-pid', String(PID), '--keep-previous', '--relaunch', '--result', resultFile(dir)])
    const real = (path: string): string => realpathSync.native(path).toLowerCase()
    expect(real(got.cwd)).toBe(real(dir))
    expect(got.prebuilt).toBe(appPath)
    expect(got.token).toBeNull()
  })
})
