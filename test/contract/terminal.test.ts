// The Terminal through the `terminal.*` IPC channels, on a real pseudo-terminal (node-pty under
// Electron's Node, ELECTRON_RUN_AS_NODE=1): open, input, output, resize, close, and that no shell
// process outlives its Node, its window or the app.
import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH } from '../../src/main/agent/env'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { closeRemovedNode, closeRemovedProjects, terminalHandlers, terminalKey, wireRegistry } from '../../src/main/ipc/terminal'
import { clampSize, ReplayBuffer, REPLAY_LIMIT, terminalEnv, TerminalRegistry } from '../../src/main/terminal/pty'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-00000001'
const NODE = 'node-1'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
interface OpenResult {
  pid: number
  shell: string
  replay: string
  end: number
  started: boolean
  exited: { exitCode: number; signal: number | null } | null
}
interface Output {
  projectId: string
  nodeId: string
  data: string
  end: number
}
interface Exit {
  projectId: string
  nodeId: string
  exitCode: number
  signal: number | null
}

let root: string
let home: string
const registries: TerminalRegistry[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'worfy-terminal-project-')))
  home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-terminal-home-')))
})

afterEach(async () => {
  // A failed test must not leave shells behind either.
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** True while a process with this pid exists (a reaped child is gone). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function harness(options: { killGraceMs?: number; nodes?: string[] } = {}) {
  const registry = new TerminalRegistry({
    // /bin/sh with an empty HOME: no rc file of the machine running the tests takes part.
    env: () => Promise.resolve({ SHELL: '/bin/sh', PATH: SYSTEM_PATH, HOME: home, PS1: '$ ', PWD: '/somewhere/else', SHLVL: '3' }),
    killGraceMs: options.killGraceMs ?? 1000,
  })
  registries.push(registry)
  const nodes = new Set(options.nodes ?? [NODE])
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const projectRoot = vi.fn((projectId: string) => {
    if (projectId !== PROJECT) throw new Error(`No Project with id ${projectId}`)
    return root
  })
  await registerIpc(ipc, {
    modules: {
      './terminal.ts': () =>
        Promise.resolve(terminalHandlers({ registry: () => registry, projectRoot, isTerminalNode: (projectId, nodeId) => projectId === PROJECT && nodes.has(nodeId) })),
    },
    isTrustedSender: (url) => url === APP_URL,
  })

  const outputs: Output[] = []
  const exits: Exit[] = []
  const makeWindow = () => {
    const window = Object.assign(new EventEmitter(), {
      destroyed: false,
      isDestroyed: () => window.destroyed,
      send: (channel: string, payload: unknown) => {
        if (channel === `${IPC_CHANNEL_PREFIX}terminal.output`) outputs.push(payload as Output)
        else if (channel === `${IPC_CHANNEL_PREFIX}terminal.exit`) exits.push(payload as Exit)
        else throw new Error(`unexpected event ${channel}`)
      },
      destroy: () => {
        window.destroyed = true
        window.emit('destroyed')
      },
    })
    return window
  }
  const sender = makeWindow()
  const call = async (channel: string, input?: unknown, from: ReturnType<typeof makeWindow> = sender): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown, from?: ReturnType<typeof makeWindow>): Promise<T> => {
    const result = await call(channel, input, from)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  const text = (nodeId = NODE) =>
    outputs
      .filter((o) => o.nodeId === nodeId)
      .map((o) => o.data)
      .join('')
  const open = (nodeId = NODE, size: { cols: number; rows: number; restart?: boolean } = { cols: 80, rows: 24 }, from?: ReturnType<typeof makeWindow>) =>
    ok<OpenResult>('terminal.open', { projectId: PROJECT, nodeId, ...size }, from)
  const type = (data: string, nodeId = NODE) => ok('terminal.input', { projectId: PROJECT, nodeId, data })
  /** Runs a command and waits for the line its output starts with. */
  const run = async (command: string, expected: RegExp, nodeId = NODE) => {
    await type(`${command}\r`, nodeId)
    await vi.waitFor(() => expect(text(nodeId)).toMatch(expected), { timeout: 5000 })
  }
  return { registry, call, ok, open, type, run, text, outputs, exits, sender, makeWindow, nodes, projectRoot }
}

describe('terminal channels on a real pty', () => {
  it('terminal.close ends the shell with SIGHUP: its pid is gone and an exit event follows', async () => {
    // A SIGKILL grace far longer than the wait below: only SIGHUP can end the shell in time.
    const h = await harness({ killGraceMs: 60_000 })
    const { pid } = await h.open()
    expect(alive(pid)).toBe(true)

    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 })
    await vi.waitFor(() => expect(h.exits).toHaveLength(1))
    expect(h.exits[0]).toMatchObject({ projectId: PROJECT, nodeId: NODE, signal: 1 })
    expect(h.registry.has(terminalKey(PROJECT, NODE))).toBe(false)
    // A shell ended by close is not kept as exited: the next open starts a new one. Checked before
    // the second close below, which would forget a kept exit anyway.
    expect(h.registry.hasExited(terminalKey(PROJECT, NODE))).toBe(false)
    const reopened = await h.open()
    expect(reopened).toMatchObject({ started: true, exited: null, replay: '' })
    expect(reopened.pid).not.toBe(pid)
    // Closing again, and once more after that, is not an error.
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
  })

  it('open starts $SHELL -l in the Project root with TERM_PROGRAM=worfy; input reaches it, output comes back', async () => {
    const h = await harness()
    const opened = await h.open()
    expect(opened).toStrictEqual({ pid: opened.pid, shell: 'sh', replay: '', end: 0, started: true, exited: null })

    await h.run('echo "cwd=$(pwd)"', new RegExp(`cwd=${root}\\r?\\n`))
    await h.run('echo "tp=$TERM_PROGRAM term=$TERM"', /tp=worfy term=xterm-256color\r?\n/)
    // An interactive login shell: started as `$SHELL -l` on a terminal.
    await h.run('echo "args=$(ps -o args= -p $$)"', /args=\/bin\/sh -l\r?\n/)
    await h.run('case $- in *i*) echo interactive=yes;; esac', /interactive=yes\r?\n/)
    await h.run('echo "pwdvar=$PWD shlvl=$SHLVL"', new RegExp(`pwdvar=${root} shlvl=1\\r?\\n`))
    // Every chunk carries the running length of all output.
    let total = 0
    for (const output of h.outputs) {
      total += output.data.length
      expect(output.end).toBe(total)
    }
  })

  it('resize changes the size of the pty, clamped to 20–500 columns and 5–300 rows', async () => {
    const h = await harness()
    await h.open(NODE, { cols: 90, rows: 30 })
    await h.run('echo "size=$(tput cols)x$(tput lines)"', /size=90x30\r?\n/)

    await h.ok('terminal.resize', { projectId: PROJECT, nodeId: NODE, cols: 132, rows: 40 })
    await h.run('echo "after=$(tput cols)x$(tput lines)"', /after=132x40\r?\n/)

    await h.ok('terminal.resize', { projectId: PROJECT, nodeId: NODE, cols: 3, rows: 1 })
    await h.run('echo "small=$(tput cols)x$(tput lines)"', /small=20x5\r?\n/)
  })

  it('a second open attaches to the running shell and replays its output', async () => {
    const h = await harness()
    const first = await h.open()
    await h.run('echo mark""er-one', /marker-one\r?\n/)

    const other = h.makeWindow()
    const second = await h.open(NODE, { cols: 80, rows: 24 }, other)
    expect(second.started).toBe(false)
    expect(second.pid).toBe(first.pid)
    expect(second.replay).toContain('marker-one')
    expect(second.end).toBe(h.outputs.at(-1)?.end)
    expect(second.replay).toBe(h.text())
    expect(second.exited).toBeNull()
  })

  it('the window that opened a terminal going away ends its shell', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const window = h.makeWindow()
    const { pid } = await h.open(NODE, { cols: 80, rows: 24 }, window)
    const { pid: otherPid } = await h.open('node-2')

    window.destroy()

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
    expect(alive(otherPid)).toBe(true)
    // The registry forgets the shell when its exit is reported, which can come after the pid is gone.
    await vi.waitFor(() => expect(h.registry.has(terminalKey(PROJECT, NODE))).toBe(false))
    // Ended because its window went away, not on its own: not kept as exited, the next open starts a new shell.
    expect(h.registry.hasExited(terminalKey(PROJECT, NODE))).toBe(false)
    const reopened = await h.open()
    expect(reopened).toMatchObject({ started: true, exited: null, replay: '' })
    expect(reopened.pid).not.toBe(pid)
  })

  it('a Terminal Node removed from the Layout, or its Project removed from the list, ends its shell', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const { pid } = await h.open()
    const { pid: otherPid } = await h.open('node-2')

    await closeRemovedNode(h.registry, { projectId: PROJECT, op: { op: 'move', id: NODE, x: 1, y: 1 } })
    await closeRemovedNode(h.registry, { projectId: 'other-00000002', op: { op: 'remove', id: NODE } })
    expect([alive(pid), alive(otherPid)]).toEqual([true, true])

    await closeRemovedNode(h.registry, { projectId: PROJECT, op: { op: 'remove', id: NODE } })
    expect([alive(pid), alive(otherPid)]).toEqual([false, true])

    await closeRemovedProjects(h.registry, new Set([PROJECT]))
    expect(alive(otherPid)).toBe(true)
    await closeRemovedProjects(h.registry, new Set(['other-00000002']))
    expect(alive(otherPid)).toBe(false)
    expect(h.registry.size).toBe(0)
  })

  it('closeAll (the app quitting) ends every shell and resolves once they are gone', async () => {
    const h = await harness({ nodes: ['a', 'b', 'c'] })
    const pids = await Promise.all(['a', 'b', 'c'].map(async (id) => (await h.open(id)).pid))
    expect(pids.every(alive)).toBe(true)

    await h.registry.closeAll()

    expect(pids.map(alive)).toEqual([false, false, false])
    expect(h.registry.size).toBe(0)
  })

  it('a shell that ignores SIGHUP is killed after the grace period', async () => {
    const h = await harness({ killGraceMs: 300 })
    const { pid } = await h.open()
    await h.run(`trap '' HUP; echo trap""ped`, /trapped\r?\n/)

    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
  })

  it('the shell exiting on its own reports its exit code and stays exited until open asks for a restart', async () => {
    const h = await harness()
    const { pid } = await h.open()
    await h.run('echo be""fore-exit', /before-exit\r?\n/)
    await h.type('exit 3\r')
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 3, signal: null }]), { timeout: 5000 })
    expect(alive(pid)).toBe(false)
    expect(h.registry.size).toBe(0)

    // A view coming back (remount, reload) sees the exit and the last output; nothing is started.
    const back = await h.open()
    expect(back).toStrictEqual({ pid, shell: 'sh', replay: h.text(), end: h.outputs.at(-1)?.end, started: false, exited: { exitCode: 3, signal: null } })
    expect(back.replay).toContain('before-exit')
    expect(h.registry.size).toBe(0)
    // A plain open with restart: false is the same.
    expect((await h.open(NODE, { cols: 80, rows: 24, restart: false })).exited).toEqual({ exitCode: 3, signal: null })
    expect(h.registry.size).toBe(0)

    // Restart starts a new shell.
    const again = await h.open(NODE, { cols: 80, rows: 24, restart: true })
    expect(again).toMatchObject({ started: true, exited: null, replay: '', end: 0 })
    expect(again.pid).not.toBe(pid)
    expect(alive(again.pid)).toBe(true)
  })

  it('closing a Node whose shell exited forgets the exit: the next open starts a new shell', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const { pid } = await h.open()
    const { pid: otherPid } = await h.open('node-2')
    await h.type('exit 4\r')
    await h.type('exit 5\r', 'node-2')
    await vi.waitFor(() => expect(h.exits).toHaveLength(2), { timeout: 5000 })
    expect([alive(pid), alive(otherPid)]).toEqual([false, false])

    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(h.registry.hasExited(terminalKey(PROJECT, NODE))).toBe(false)
    const fresh = await h.open()
    expect(fresh).toMatchObject({ started: true, exited: null })

    // A removed Project forgets the exits of its Nodes too.
    expect(h.registry.hasExited(terminalKey(PROJECT, 'node-2'))).toBe(true)
    await closeRemovedProjects(h.registry, new Set())
    expect(h.registry.hasExited(terminalKey(PROJECT, 'node-2'))).toBe(false)
    expect(alive(fresh.pid)).toBe(false)
  })
})

/** The Layout, the Projects and the app as wireRegistry sees them, driven by the test. */
function wiring(projectIds: string[]) {
  const layoutListeners: ((change: { projectId: string; op: { op: 'remove'; id: string } | { op: 'move'; id: string; x: number; y: number } }) => void)[] = []
  const projectListeners: (() => void)[] = []
  const quitListeners: ((event: { preventDefault(): void }) => void)[] = []
  let projects = projectIds.map((id) => ({ id }))
  const quit = vi.fn()
  return {
    layout: { onChange: (listener: (typeof layoutListeners)[number]) => layoutListeners.push(listener) },
    projects: { onChange: (listener: () => void) => projectListeners.push(listener), list: () => projects },
    app: { on: (_event: 'will-quit', listener: (typeof quitListeners)[number]) => quitListeners.push(listener), quit },
    quit,
    removeNode: (projectId: string, id: string) => layoutListeners.forEach((listener) => listener({ projectId, op: { op: 'remove', id } })),
    moveNode: (projectId: string, id: string) => layoutListeners.forEach((listener) => listener({ projectId, op: { op: 'move', id, x: 5, y: 5 } })),
    setProjects: (ids: string[]) => {
      projects = ids.map((id) => ({ id }))
      projectListeners.forEach((listener) => listener())
    },
    /** Fires will-quit; returns whether it was deferred. */
    willQuit: () => {
      const event = { preventDefault: vi.fn() }
      quitListeners.forEach((listener) => listener(event))
      return event.preventDefault
    },
  }
}

describe('wireRegistry: the shells follow the Layout, the Projects and quitting', () => {
  it('a Terminal Node removed from the Layout by any route ends its shell; other ops and other Nodes do not', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const w = wiring([PROJECT])
    wireRegistry(h.registry, w)
    const { pid } = await h.open()
    const { pid: otherPid } = await h.open('node-2')

    w.moveNode(PROJECT, NODE)
    w.removeNode('other-00000002', NODE)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect([alive(pid), alive(otherPid)]).toEqual([true, true])

    w.removeNode(PROJECT, NODE)
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 })
    expect(alive(otherPid)).toBe(true)
  })

  it('a Project removed from the list ends its shells; a change that keeps it does not', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const w = wiring([PROJECT, 'other-00000002'])
    wireRegistry(h.registry, w)
    const pids = [(await h.open()).pid, (await h.open('node-2')).pid]

    w.setProjects([PROJECT, 'other-00000002', 'third-00000003'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(pids.map(alive)).toEqual([true, true])

    w.setProjects(['other-00000002'])
    await vi.waitFor(() => expect(pids.map(alive)).toEqual([false, false]), { timeout: 3000 })
    // node-pty reaps a shell before it reports the exit: the registry forgets it a moment later.
    await vi.waitFor(() => expect(h.registry.size).toBe(0), { timeout: 3000 })
  })

  it('will-quit waits for every shell, even one that ignores SIGHUP, then quits again', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'], killGraceMs: 300 })
    const w = wiring([PROJECT])
    wireRegistry(h.registry, { ...w, quitWaitMs: 10_000 })
    const { pid } = await h.open()
    const { pid: otherPid } = await h.open('node-2')
    await h.run(`trap '' HUP; echo trap""ped`, /trapped\r?\n/, 'node-2')

    const preventDefault = w.willQuit()

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(w.quit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(w.quit).toHaveBeenCalledOnce(), { timeout: 5000 })
    expect([alive(pid), alive(otherPid)]).toEqual([false, false])
    expect(h.registry.size).toBe(0)

    // The second will-quit, with no shell left, lets the app quit.
    expect(w.willQuit()).not.toHaveBeenCalled()
    expect(w.quit).toHaveBeenCalledOnce()
  })

  it('will-quit gives up waiting after quitWaitMs and quits anyway', async () => {
    const w = wiring([])
    const stuck = { size: 1, closeAll: () => new Promise<void>(() => undefined) } as unknown as TerminalRegistry
    wireRegistry(stuck, { ...w, quitWaitMs: 50 })
    expect(w.willQuit()).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(w.quit).toHaveBeenCalledOnce(), { timeout: 2000 })
  })
})

describe('terminal channels at the IPC boundary', () => {
  it('refuses input of the wrong type and starts nothing', async () => {
    const h = await harness()
    for (const input of [
      { projectId: PROJECT, nodeId: NODE, cols: '80', rows: 24 },
      { projectId: PROJECT, nodeId: NODE, cols: 80.5, rows: 24 },
      { projectId: PROJECT, nodeId: 7, cols: 80, rows: 24 },
      { projectId: PROJECT, cols: 80, rows: 24 },
      { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24, restart: 'yes' },
    ]) {
      const result = await h.call('terminal.open', input)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/invalid input/)
    }
    expect(h.registry.size).toBe(0)
    expect(h.projectRoot).not.toHaveBeenCalled()

    const input = await h.call('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 42 })
    expect(input.ok).toBe(false)
    const resize = await h.call('terminal.resize', { projectId: PROJECT, nodeId: NODE, cols: -1, rows: 10 })
    expect(resize.ok).toBe(false)
  })

  it('drops keys the contract does not declare: a `cwd` from the renderer does not move the shell', async () => {
    const h = await harness()
    const elsewhere = await realpath(tmpdir())
    const opened = await h.ok<OpenResult>('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24, cwd: elsewhere, shell: '/bin/bash' })
    expect(Object.keys(opened).sort()).toEqual(['end', 'exited', 'pid', 'replay', 'shell', 'started'])
    expect(opened.shell).toBe('sh')
    await h.run('echo "cwd=$(pwd)"', new RegExp(`cwd=${root}\\r?\\n`))
    for (const output of h.outputs) expect(Object.keys(output).sort()).toEqual(['data', 'end', 'nodeId', 'projectId'])
  })

  it('refuses a Node that is not a Terminal Node of the Project, and an unknown Project', async () => {
    const h = await harness()
    const notTerminal = await h.call('terminal.open', { projectId: PROJECT, nodeId: 'note-1', cols: 80, rows: 24 })
    expect(!notTerminal.ok && notTerminal.error).toMatch(/not a Terminal Node/)
    const unknown = await h.call('terminal.open', { projectId: 'other-00000002', nodeId: NODE, cols: 80, rows: 24 })
    expect(!unknown.ok && unknown.error).toMatch(/No Project/)
    expect(h.registry.size).toBe(0)
  })

  it('input to a terminal that is not running is refused', async () => {
    const h = await harness()
    const result = await h.call('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'ls\r' })
    expect(!result.ok && result.error).toMatch(/not running/)
  })
})

describe('pty helpers', () => {
  it('clampSize keeps the size within 20–500 × 5–300', () => {
    expect(clampSize(1, 1)).toEqual({ cols: 20, rows: 5 })
    expect(clampSize(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(clampSize(9000, 9000)).toEqual({ cols: 500, rows: 300 })
  })

  it('ReplayBuffer keeps the last 256 KB and the running length', () => {
    const buffer = new ReplayBuffer()
    buffer.push('a'.repeat(REPLAY_LIMIT - 10))
    buffer.push('b'.repeat(20))
    expect(buffer.end).toBe(REPLAY_LIMIT + 10)
    const kept = buffer.text()
    expect(kept).toHaveLength(REPLAY_LIMIT)
    expect(kept.endsWith('b'.repeat(20))).toBe(true)
    expect(kept.startsWith('a')).toBe(true)
  })

  it('terminalEnv keeps the login shell environment, sets the terminal variables and the Project root', () => {
    const env = terminalEnv({ PATH: '/opt/bin:/usr/bin', HOME: '/Users/u', PWD: '/old', OLDPWD: '/older', SHLVL: '2', _: '/usr/bin/env', MY_VAR: 'x' }, '/repo')
    expect(env).toStrictEqual({
      PATH: '/opt/bin:/usr/bin',
      HOME: '/Users/u',
      MY_VAR: 'x',
      PWD: '/repo',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'worfy',
      LANG: 'en_US.UTF-8',
    })
    expect(terminalEnv({ LANG: 'ru_RU.UTF-8' }, '/repo').LANG).toBe('ru_RU.UTF-8')
  })
})
