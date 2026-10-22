// The Terminal through the `terminal.*` IPC channels, on a real pseudo-terminal (node-pty under
// Electron's Node, ELECTRON_RUN_AS_NODE=1): open, input, output, resize, close, and that no shell
// process outlives its Node, its window or the app.
import { realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findGitBash } from '../../src/main/agent/env'
import { closeRemovedNode, closeRemovedProjects, QUIT_WAIT_MS, terminalKey, WINDOWS_QUIT_WAIT_MS, wireRegistry } from '../../src/main/ipc/terminal'
import {
  clampSize,
  ReplayBuffer,
  REPLAY_LIMIT,
  terminalEnv,
  TerminalRegistry,
  WINDOWS_CLOSE_BOUND_MS,
  type PtyProcess,
  type SpawnPty,
  type TerminalSink,
} from '../../src/main/terminal/pty'
import { alive, folderLine, harness, home, IGNORE_HANGUP, needsWindowsPowerShellOffRunner, NODE, PROJECT, root, say, SAY_THE_FOLDER, sayTheSize, SHELL_NAME, SYSTEM_ROOT, useTerminalScratch, WINDOWS, windowsEnv, type OpenResult, type Window } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

/** The stand-in tools of the first-run screen; its `gh auth login` prints one line (worfy-harness ticket 19). */
const TOOLS = join(import.meta.dirname, '..', 'fixtures', 'first-run-tools')

// The harness, the wording of what the tests type and the folders of each test are in
// terminal-harness.ts; the tests that run only on Windows, on a real pseudo-console, in
// terminal-windows.test.ts (worfy-windows ticket 22).
useTerminalScratch()

describe('terminal channels on a real pty', () => {
  it('terminal.close ends the shell with SIGHUP: its pid is gone and an exit event follows', async () => {
    // A SIGKILL grace far longer than the wait below: only SIGHUP can end the shell in time.
    const h = await harness({ killGraceMs: 60_000 })
    const { pid } = await h.open()
    expect(alive(pid)).toBe(true)

    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 })
    await vi.waitFor(() => expect(h.exits).toHaveLength(1))
    // Windows has no signal to name: the process tree of the shell is ended.
    expect(h.exits[0]).toMatchObject({ projectId: PROJECT, nodeId: NODE, signal: WINDOWS ? null : 1 })
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

  // macOS login-shell behaviour; on the Linux CI runner /bin/sh is dash. Windows has no $SHELL and
  // no login shell: the Terminal starts PowerShell there, and 'open starts Windows PowerShell …' in
  // terminal-windows.test.ts checks the same for it. The Mac runs this in every gate.
  it.skipIf(process.platform !== 'darwin')('open starts $SHELL -l in the Project root with TERM_PROGRAM=worfy; input reaches it, output comes back', async () => {
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

  // On Windows the console asks for the cursor position after a resize, and PowerShell echoes
  // nothing more until it is answered: main answers (cursor-answers.ts). The harness's screen
  // answers too, marked as an answer, and main drops that (worfy-windows ticket 39).
  it('resize changes the size of the pty, clamped to 20–500 columns and 5–300 rows', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    await h.open(NODE, { cols: 90, rows: 30 })
    await h.run(sayTheSize('size'), /size=90x30\r?\n/)

    await h.ok('terminal.resize', { projectId: PROJECT, nodeId: NODE, cols: 132, rows: 40 })
    await h.run(sayTheSize('after'), /after=132x40\r?\n/)

    await h.ok('terminal.resize', { projectId: PROJECT, nodeId: NODE, cols: 3, rows: 1 })
    await h.run(sayTheSize('small'), /small=20x5\r?\n/)
  })

  it('a second open attaches to the running shell and replays its output', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const first = await h.open()
    await h.run(say('mark', 'er-one'), /marker-one\r?\n/)

    const other = h.makeWindow()
    const second = await h.open(NODE, { cols: 80, rows: 24 }, other)
    expect(second.started).toBe(false)
    expect(second.pid).toBe(first.pid)
    expect(second.replay).toContain('marker-one')
    expect(second.end).toBe(h.outputs.at(-1)?.end)
    expect(second.replay).toBe(h.text())
    expect(second.exited).toBeNull()
  })

  it('the only client that opened a terminal going away ends its shell (the last subscriber left)', async () => {
    const h = await harness({ nodes: [NODE, 'node-2'] })
    const window = h.makeWindow()
    const { pid } = await h.open(NODE, { cols: 80, rows: 24 }, window)
    const { pid: otherPid } = await h.open('node-2')

    window.destroy()

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
    expect(alive(otherPid)).toBe(true)
    // The registry forgets the shell when its exit is reported, which can come after the pid is gone:
    // on Windows about a second after it (node-pty waits for the rest of the output).
    await vi.waitFor(() => expect(h.registry.has(terminalKey(PROJECT, NODE))).toBe(false), { timeout: 5000 })
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

  // Windows has no SIGHUP to ignore: close ends the process tree at once (the cases "on Windows" in terminal-windows.test.ts).
  it.skipIf(WINDOWS)('a shell that ignores SIGHUP is killed after the grace period', async () => {
    const h = await harness({ killGraceMs: 300 })
    const { pid } = await h.open()
    await h.run(IGNORE_HANGUP, /trapped\r?\n/)

    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
  })

  it('the shell exiting on its own reports its exit code and stays exited until open asks for a restart', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const { pid } = await h.open()
    await h.run(say('be', 'fore-exit'), /before-exit\r?\n/)
    await h.type('exit 3\r')
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 3, signal: null }]), { timeout: 5000 })
    expect(alive(pid)).toBe(false)
    expect(h.registry.size).toBe(0)

    // A view coming back (remount, reload) sees the exit and the last output; nothing is started.
    const back = await h.open()
    expect(back).toStrictEqual({ pid, shell: SHELL_NAME, replay: h.text(), end: h.outputs.at(-1)?.end, started: false, exited: { exitCode: 3, signal: null } })
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

/** The text of the output a window got for a Node, and the check that its `end`s run without a gap. */
function received(window: Window, nodeId = NODE): string {
  return window.outputs
    .filter((o) => o.nodeId === nodeId)
    .map((o) => o.data)
    .join('')
}

describe('one Terminal on several screens (worfy-link ticket 05, ADR-0053)', () => {
  it('two clients that opened one Terminal both get every chunk with the same end; the second open does not take the output from the first', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const a = h.makeWindow()
    const b = h.makeWindow()
    const first = await h.open(NODE, { cols: 80, rows: 24 }, a)
    const second = await h.open(NODE, { cols: 80, rows: 24 }, b)
    expect(second).toMatchObject({ pid: first.pid, started: false })

    await h.run(say('two', '-screens'), /two-screens\r?\n/, NODE, a)
    await vi.waitFor(() => expect(received(a)).toMatch(/two-screens\r?\n/), { timeout: 2000 })
    await vi.waitFor(() => expect(received(b)).toMatch(/two-screens\r?\n/), { timeout: 2000 })

    // B got every chunk printed after it attached, with the end A got for the same chunk.
    const afterAttach = a.outputs.filter((o) => o.end > second.end)
    expect(b.outputs).toEqual(afterAttach)
    expect(afterAttach.length).toBeGreaterThan(0)
  })

  it('a client that attaches to a running shell gets the replay and its end; the chunks after it do not repeat the replay', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const a = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, a)
    await h.run(say('be', 'fore'), /before\r?\n/, NODE, a)

    const b = h.makeWindow()
    const attached = await h.open(NODE, { cols: 80, rows: 24 }, b)
    expect(attached.replay).toBe(received(a))
    expect(attached.end).toBe(a.outputs.at(-1)?.end)

    await h.run(say('af', 'ter'), /after\r?\n/, NODE, b)
    await vi.waitFor(() => expect(received(b)).toMatch(/after\r?\n/), { timeout: 5000 })
    // The live chunks start where the replay ended: replay + chunks is the whole output, once.
    expect(b.outputs[0]?.end).toBe(attached.end + (b.outputs[0]?.data.length ?? 0))
    expect(attached.replay + received(b)).toBe(received(a))
    expect(received(b)).not.toContain('before')
  })

  it('one of two clients destroyed: the shell lives on and the other gets its output; the last one destroyed: the shell is closed, not kept as exited', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const a = h.makeWindow()
    const b = h.makeWindow()
    const { pid } = await h.open(NODE, { cols: 80, rows: 24 }, a)
    await h.open(NODE, { cols: 80, rows: 24 }, b)

    // B opened last, so it is the one that took the output before: it goes first.
    b.destroy()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(alive(pid)).toBe(true)
    await h.run(say('still', '-here'), /still-here\r?\n/, NODE, a)
    await vi.waitFor(() => expect(received(a)).toMatch(/still-here\r?\n/), { timeout: 2000 })
    expect(received(b)).not.toContain('still-here')

    a.destroy()
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
    await vi.waitFor(() => expect(h.registry.has(terminalKey(PROJECT, NODE))).toBe(false), { timeout: 5000 })
    expect(h.registry.hasExited(terminalKey(PROJECT, NODE))).toBe(false)
  })

  it('a client destroyed before its open is handled starts nothing; one destroyed while its open is on the way does not keep the shell running', async () => {
    const h = await harness()
    const gone = h.makeWindow()
    gone.destroy()
    const refused = await h.call('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 }, gone)
    expect(!refused.ok && refused.error).toMatch(/client is gone/)
    expect(h.registry.size).toBe(0)

    // Destroyed after the handler checked it, while the shell starts.
    const a = h.makeWindow()
    h.projectRoot.mockImplementationOnce(() => {
      a.destroy()
      return root
    })
    const { pid } = await h.open(NODE, { cols: 80, rows: 24 }, a)
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 })
    await vi.waitFor(() => expect(h.registry.size).toBe(0), { timeout: 5000 })
    expect(h.registry.hasExited(terminalKey(PROJECT, NODE))).toBe(false)
  })

  it('Restart from A: B gets terminal.started with the new pid, and an open from B attaches to the new shell', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const a = h.makeWindow()
    const b = h.makeWindow()
    const { pid } = await h.open(NODE, { cols: 80, rows: 24 }, a)
    await h.open(NODE, { cols: 80, rows: 24 }, b)
    await h.type('exit 3\r', NODE, a)
    await vi.waitFor(() => expect(b.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 3, signal: null }]), { timeout: 5000 })
    expect(a.exits).toEqual(b.exits)

    const again = await h.open(NODE, { cols: 80, rows: 24, restart: true }, a)
    expect(again.started).toBe(true)
    expect(again.pid).not.toBe(pid)
    expect(b.starts).toEqual([{ projectId: PROJECT, nodeId: NODE, pid: again.pid }])

    const back = await h.open(NODE, { cols: 80, rows: 24 }, b)
    expect(back).toMatchObject({ pid: again.pid, started: false, exited: null })
    await h.run(say('new', '-shell'), /new-shell\r?\n/, NODE, b)
    await vi.waitFor(() => expect(received(a)).toMatch(/new-shell\r?\n/), { timeout: 5000 })
  })
})

describe('the output of one Terminal on one and on two screens, measured (worfy-link ticket 05)', () => {
  // The numbers are always printed; WORFY_PERF=1 checks them, as test/e2e/epic-frame.spec.ts does.
  const enforce = process.env.WORFY_PERF === '1'
  const BYTES = 10_000_000

  /** The last few chunks a window got: cheap to look at while 10 MB come in. */
  const tail = (window: Window) =>
    window.outputs
      .slice(-5)
      .map((o) => o.data)
      .join('')

  async function measure(screens: number) {
    const h = await harness()
    const windows = Array.from({ length: screens }, () => h.makeWindow())
    for (const window of windows) await h.open(NODE, { cols: 80, rows: 24 }, window)
    const [typing] = windows
    if (typing === undefined) throw new Error('no window')
    await h.run(say('rea', 'dy'), /ready\r?\n/, NODE, typing)
    const before = windows.map((window) => window.outputs.length)
    const loop = monitorEventLoopDelay({ resolution: 10 })
    loop.enable()
    const started = performance.now()
    await h.type(`head -c ${BYTES} /dev/zero | tr '\\0' a; echo; echo DONE""-MARK\r`, NODE, typing)
    await vi.waitFor(
      () => {
        for (const window of windows) expect(tail(window)).toMatch(/DONE-MARK/)
      },
      { timeout: 60_000, interval: 10 },
    )
    const ms = Math.round(performance.now() - started)
    loop.disable()
    const got = windows.map((window, index) => window.outputs.slice(before[index]))
    const events = got[0]?.length ?? 0
    const bytes = (got[0] ?? []).reduce((sum, o) => sum + o.data.length, 0)
    expect(bytes).toBeGreaterThanOrEqual(BYTES)
    // Every screen got the same chunks, with the same ends.
    for (const each of got) expect(each.map((o) => o.end)).toEqual(got[0]?.map((o) => o.end))
    const p99 = Math.round(loop.percentile(99) / 1e6)
    const max = Math.round(loop.max / 1e6)
    await h.registry.closeAll()
    return { ms, events, bytes, p99, max }
  }

  // A measurement of the pipeline on macOS, with the tools of /bin/sh; ConPTY redraws the stream in its own way.
  it.skipIf(WINDOWS)('10 MB of output: the number of terminal.output events, the time to the last byte and the p99 delay of the event loop', { timeout: 180_000 }, async () => {
    const one = await measure(1)
    const two = await measure(2)
    for (const [name, m] of [
      ['one screen', one],
      ['two screens', two],
    ] as const) {
      console.log(`terminal 10 MB, ${name}: ${m.events} terminal.output events per screen, ${m.bytes} characters, last byte after ${m.ms} ms, event loop delay p99 ${m.p99} ms, max ${m.max} ms`)
    }
    // Merging chunks is needed only when two screens are more than twice as slow as one, or the event
    // loop of main waits more than 100 ms at p99 (worfy-link ticket 05, "What we do", point 7).
    if (enforce) {
      expect(two.ms).toBeLessThanOrEqual(2 * one.ms)
      expect(two.p99).toBeLessThanOrEqual(100)
    }
  })
})

/** A pty that records its resizes and writes in one list, in the order they came. */
class SizePty implements PtyProcess {
  static all: SizePty[] = []
  // No process has this pid: closing the registry signals it, and the signal must reach nobody.
  readonly pid = 999_999_999
  readonly calls: (['resize', number, number] | ['write', string])[] = []
  readonly resize = vi.fn((cols: number, rows: number) => {
    this.calls.push(['resize', cols, rows])
    this.size = { cols, rows }
  })
  private exit: ((event: { exitCode: number; signal?: number }) => void)[] = []
  private ended = false
  constructor(public size: { cols: number; rows: number }) {
    SizePty.all.push(this)
  }
  onData(): void {}
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
    this.exit.push(listener)
  }
  write(data: string): void {
    this.calls.push(['write', data])
  }
  /** Ends the stand-in shell, once: SIGHUP from close() reaches no process here. */
  kill(): void {
    if (this.ended) return
    this.ended = true
    for (const listener of this.exit) listener({ exitCode: 0 })
  }
}

describe('the size of a Terminal on several screens: the screen that typed or clicked last (Q14)', () => {
  const spawn: SpawnPty = (_file, _args, { cols, rows }) => new SizePty({ cols, rows })
  const ref = { projectId: PROJECT, nodeId: NODE }
  // Before the registries are closed: a stand-in shell exits only when killed.
  afterEach(() => SizePty.all.splice(0).forEach((pty) => pty.kill()))

  it('typing, clicking, resizing and opening from different clients, and the owner going away', async () => {
    // The pty never exits on SIGHUP here: close it through kill at the end.
    const h = await harness({ spawn })
    const a = h.makeWindow()
    const b = h.makeWindow()
    const c = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, a)
    const pty = SizePty.all[0]
    if (pty === undefined) throw new Error('no pty')
    expect(pty.size).toEqual({ cols: 80, rows: 24 })

    // B attaches with its own size: A sized the pty, B's size is only remembered.
    await h.open(NODE, { cols: 100, rows: 30 }, b)
    expect(pty.size).toEqual({ cols: 80, rows: 24 })

    // A types: the pty keeps A's size.
    await h.type('a', NODE, a)
    expect(pty.size).toEqual({ cols: 80, rows: 24 })

    // A resize from B, who does not own the size, is only remembered.
    await h.ok('terminal.resize', { ...ref, cols: 120, rows: 40 }, b)
    expect(pty.size).toEqual({ cols: 80, rows: 24 })

    // B types: the pty takes B's last size before the keys are written.
    pty.calls.length = 0
    await h.type('b', NODE, b)
    expect(pty.calls).toEqual([
      ['resize', 120, 40],
      ['write', 'b'],
    ])

    // A resize from the owner applies at once.
    await h.ok('terminal.resize', { ...ref, cols: 110, rows: 35 }, b)
    expect(pty.size).toEqual({ cols: 110, rows: 35 })

    // A click in A's terminal: the pty takes A's size.
    await h.ok('terminal.takeSize', { ...ref, cols: 81, rows: 25 }, a)
    expect(pty.size).toEqual({ cols: 81, rows: 25 })

    // Typing again from the owner with the size it has: no resize.
    pty.calls.length = 0
    await h.type('x', NODE, a)
    expect(pty.calls).toEqual([['write', 'x']])

    // A third client opening does not change the size.
    await h.open(NODE, { cols: 60, rows: 20 }, c)
    expect(pty.size).toEqual({ cols: 81, rows: 25 })

    // The owner goes: the size goes to the client that typed last (B), not to C, whose size came later.
    a.destroy()
    await vi.waitFor(() => expect(pty.size).toEqual({ cols: 110, rows: 35 }))

    // B goes too: C, which never typed, sent its size last.
    b.destroy()
    await vi.waitFor(() => expect(pty.size).toEqual({ cols: 60, rows: 20 }))
  })

  it('without another owner an open sizes the pty, as with one window (a reload of the same window)', async () => {
    const h = await harness({ spawn })
    const a = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, a)
    const pty = SizePty.all[0]
    if (pty === undefined) throw new Error('no pty')
    await h.open(NODE, { cols: 90, rows: 30 }, a)
    expect(pty.size).toEqual({ cols: 90, rows: 30 })
    await h.ok('terminal.resize', { ...ref, cols: 3, rows: 1 }, a)
    expect(pty.size).toEqual({ cols: 20, rows: 5 })
  })

  it('takeSize to a terminal that is not running is refused, and from a client that did not open it does nothing', async () => {
    const h = await harness({ spawn })
    const refused = await h.call('terminal.takeSize', { ...ref, cols: 80, rows: 24 })
    expect(!refused.ok && refused.error).toMatch(/not running/)

    const a = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, a)
    const pty = SizePty.all[0]
    if (pty === undefined) throw new Error('no pty')
    await h.ok('terminal.takeSize', { ...ref, cols: 99, rows: 33 }, h.makeWindow())
    await h.ok('terminal.resize', { ...ref, cols: 99, rows: 33 }, h.makeWindow())
    expect(pty.size).toEqual({ cols: 80, rows: 24 })
  })

  it('an answer of a screen to the program (`reply`) reaches the shell and leaves the size; the same bytes typed take it (worfy-windows ticket 39)', async () => {
    const h = await harness({ spawn })
    const a = h.makeWindow()
    const b = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, a)
    await h.open(NODE, { cols: 120, rows: 40 }, b)
    const pty = SizePty.all[0]
    if (pty === undefined) throw new Error('no pty')
    pty.calls.length = 0

    await h.ok('terminal.input', { ...ref, data: '\x1b[?1;2c', reply: true }, b)
    await h.ok('terminal.input', { ...ref, data: '\x1b[O', reply: true }, b)
    expect(pty.calls).toEqual([
      ['write', '\x1b[?1;2c'],
      ['write', '\x1b[O'],
    ])

    // `reply: false`, or none, is typing, as before the mark was there.
    await h.ok('terminal.input', { ...ref, data: '\x1b[O', reply: false }, b)
    expect(pty.calls.slice(2)).toEqual([
      ['resize', 120, 40],
      ['write', '\x1b[O'],
    ])
    const refused = await h.call('terminal.input', { ...ref, data: 'x', reply: 'yes' }, a)
    expect(refused.ok).toBe(false)
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

describe('terminal.open with a command (worfy-harness ticket 19)', () => {
  it('the new shell gets `gh auth login` typed once it has started, and runs it; a shell opened without one gets nothing', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    // The stand-ins go first on the PATH through $HOME/.profile, which a login shell reads after
    // /etc/profile: on macOS /etc/profile (path_helper) moves the system folders, Homebrew's
    // included, before what the PATH had, and a real gh would win.
    if (!WINDOWS) await writeFile(join(home, '.profile'), `PATH="${TOOLS}:$PATH"; export PATH\n`)
    // On Windows the stand-ins of TOOLS are scripts of /bin/sh: a gh.cmd of one line stands in there.
    if (WINDOWS) await writeFile(join(home, 'gh.cmd'), '@echo fake gh: auth login started\r\n')
    const h = await harness({ nodes: [NODE, 'node-2'], path: [home] })
    const opened = await h.open(NODE, { cols: 80, rows: 24, command: 'gh auth login' })
    expect(opened.started).toBe(true)
    // The stand-in gh prints this line: the command reached the shell and ran there.
    await vi.waitFor(() => expect(h.text()).toContain('fake gh: auth login started'), { timeout: 4000 }).catch((error: unknown) => {
      throw new Error(`${String(error)}\n--- output:\n${h.text()}`)
    })

    // Without a command, as before: nothing is typed.
    await h.open('node-2')
    await h.run(say('mark', 'er-two'), /marker-two\r?\n/, 'node-2')
    expect(h.text('node-2')).not.toContain('gh auth login')
    expect(h.text('node-2')).not.toContain('fake gh')
  })

  it('refuses a command outside the list and starts nothing', async () => {
    const h = await harness()
    for (const command of ['rm -rf ~', 'gh auth login; rm -rf ~', '']) {
      const result = await h.call('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24, command })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/invalid input/)
    }
    expect(h.registry.size).toBe(0)
  })
})

describe('the command typed into a new shell, on a stand-in pty', () => {
  class FakePty implements PtyProcess {
    static last: FakePty | null = null
    readonly pid = 4242
    readonly writes: string[] = []
    private data: ((data: string) => void)[] = []
    private exit: ((event: { exitCode: number; signal?: number }) => void)[] = []
    constructor() {
      FakePty.last = this
    }
    onData(listener: (data: string) => void): void {
      this.data.push(listener)
    }
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
      this.exit.push(listener)
    }
    write(data: string): void {
      this.writes.push(data)
    }
    resize(): void {}
    kill(): void {
      this.end(0)
    }
    print(data: string): void {
      for (const listener of this.data) listener(data)
    }
    end(exitCode: number): void {
      for (const listener of this.exit) listener({ exitCode })
    }
  }
  const sink: TerminalSink = { output: () => undefined, exit: () => undefined, started: () => undefined }
  const request = { cwd: '/tmp', cols: 80, rows: 24 }
  const registry = (commandDelayMs = 60_000) =>
    // The Enter of macOS on any system; the Enter of Windows is in test/unit/terminal-shell.test.ts.
    new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => new FakePty(), commandDelayMs, killGraceMs: 10, platform: 'darwin' })
  const pty = (): FakePty => {
    if (FakePty.last === null) throw new Error('no pty')
    return FakePty.last
  }

  it('types the command and a newline after the first output, once', async () => {
    const r = registry()
    await r.open('k', { ...request, command: 'gh auth login' }, sink, sink)
    expect(pty().writes).toEqual([])
    pty().print('$ ')
    expect(pty().writes).toEqual(['gh auth login\n'])
    pty().print('more output\r\n$ ')
    expect(pty().writes).toEqual(['gh auth login\n'])
  })

  it('types it after the delay when the shell prints nothing', async () => {
    const r = registry(20)
    await r.open('k', { ...request, command: 'gh auth login' }, sink, sink)
    await vi.waitFor(() => expect(pty().writes).toEqual(['gh auth login\n']))
    pty().print('$ ')
    expect(pty().writes).toEqual(['gh auth login\n'])
  })

  it('without a command types nothing, as before', async () => {
    const r = registry(20)
    await r.open('k', request, sink, sink)
    pty().print('$ ')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(pty().writes).toEqual([])
  })

  it('attaching to a running shell with a command types nothing into it', async () => {
    const r = registry()
    await r.open('k', request, sink, sink)
    pty().print('$ ')
    const attached = await r.open('k', { ...request, command: 'gh auth login' }, sink, sink)
    expect(attached.started).toBe(false)
    pty().print('$ ')
    expect(pty().writes).toEqual([])
  })

  it('a shell that exits before its first output gets nothing typed', async () => {
    const r = registry(20)
    await r.open('k', { ...request, command: 'gh auth login' }, sink, sink)
    const first = pty()
    first.end(1)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(first.writes).toEqual([])
  })
})

// The setting of the Project reaches the registry, and nothing else does: a stand-in pty under the
// rules of each system, so these run on any machine (worfy-windows ticket 10, review round 1).
describe('terminal.open and the shell setting of the Project, on a stand-in pty', () => {
  const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const POWERSHELL = win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const exists = (path: string) => path === GIT_BASH
  function standIn() {
    const started: { file: string; args: string[] }[] = []
    const exits: ((event: { exitCode: number }) => void)[] = []
    const spawn: SpawnPty = (file, args) => {
      started.push({ file, args })
      let exit: (event: { exitCode: number }) => void = () => undefined
      exits.push((event) => exit(event))
      return { pid: 4001 + started.length * 2, onData: () => undefined, onExit: (listener) => void (exit = listener), write: () => undefined, resize: () => undefined, kill: () => exit({ exitCode: 0 }) }
    }
    /** Every stand-in shell exits on its own: nothing is left for the registry to end. */
    const endAll = () => exits.forEach((exit) => exit({ exitCode: 0 }))
    return { started, spawn, endAll }
  }

  it('on Windows the shell the settings of the Project name is the one that starts; the setting is asked once, for that Project', async () => {
    const { started, spawn } = standIn()
    const h = await harness({ platform: 'win32', spawn, exists, shellSetting: (projectId) => (projectId === PROJECT ? 'git-bash' : undefined) })
    const opened = await h.open()
    expect(started).toEqual([{ file: GIT_BASH, args: ['--login', '-i'] }])
    expect(opened.shell).toBe('bash.exe')
    expect(h.shellSetting.mock.calls).toEqual([[PROJECT]])
    // A second screen attaches to the running shell: the settings are not read again.
    const attached = await h.open(NODE, { cols: 80, rows: 24 }, h.makeWindow())
    expect(attached.started).toBe(false)
    expect(h.shellSetting).toHaveBeenCalledTimes(1)
  })

  it('on Windows a Project whose settings name no shell gets PowerShell, whatever the renderer sends as `shell`', async () => {
    const { started, spawn } = standIn()
    const h = await harness({ platform: 'win32', spawn, exists, shellSetting: () => undefined })
    for (const shell of ['git-bash', GIT_BASH, 'cmd.exe']) {
      const opened = await h.ok<OpenResult>('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24, restart: true, shell })
      expect(opened.shell, shell).toBe('powershell.exe')
      await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    }
    expect(started).toEqual(Array.from({ length: 3 }, () => ({ file: POWERSHELL, args: ['-NoLogo'] })))
  })

  it('on Windows settings that cannot be read do not stop the Terminal: PowerShell starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { started, spawn } = standIn()
    const h = await harness({
      platform: 'win32',
      spawn,
      exists,
      shellSetting: () => {
        throw Object.assign(new Error('EACCES: permission denied, open settings.json'), { code: 'EACCES' })
      },
    })
    expect((await h.open()).shell).toBe('powershell.exe')
    expect(started).toEqual([{ file: POWERSHELL, args: ['-NoLogo'] }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.any(Error))
  })

  it.each(['darwin', 'linux'] as const)('on %s terminal.open does not read the settings of the Project at all, as before the setting was there', async (platform) => {
    const { started, spawn, endAll } = standIn()
    const h = await harness({
      platform,
      spawn,
      shellSetting: () => {
        throw new Error('settings.json cannot be read')
      },
    })
    try {
      const opened = await h.open()
      expect(opened).toMatchObject({ shell: 'sh', started: true })
      expect(started).toEqual([{ file: '/bin/sh', args: ['-l'] }])
      await h.open(NODE, { cols: 80, rows: 24 }, h.makeWindow())
      expect(h.shellSetting).not.toHaveBeenCalled()
    } finally {
      // The pid of a stand-in is the pid of no shell: the registry must have nothing to signal when the test ends.
      endAll()
    }
    expect(h.registry.size).toBe(0)
  })
})

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

  it('will-quit waits for every shell, even one that ignores SIGHUP, then quits again', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness({ nodes: [NODE, 'node-2'], killGraceMs: 300 })
    const w = wiring([PROJECT])
    wireRegistry(h.registry, { ...w, quitWaitMs: 10_000 })
    const { pid } = await h.open()
    const { pid: otherPid } = await h.open('node-2')
    await h.run(IGNORE_HANGUP, /trapped\r?\n/, 'node-2')

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

  it('will-quit gives up waiting after quitWaitMs and quits anyway: the quit that follows is not held back by a shell that is still closing', async () => {
    const w = wiring([])
    const closeAll = vi.fn(() => new Promise<void>(() => undefined))
    const stuck = { size: 1, closeAll } as unknown as TerminalRegistry
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    wireRegistry(stuck, { ...w, quitWaitMs: 50 })
    expect(w.willQuit()).toHaveBeenCalledOnce()
    // A will-quit that comes during the wait is held back too, and starts no second wait.
    expect(w.willQuit()).toHaveBeenCalledOnce()
    expect(w.quit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(w.quit).toHaveBeenCalledOnce(), { timeout: 2000 })
    // The wait was cut: what the shells started may be left running, and the log says so.
    expect(warn.mock.calls).toEqual([['[terminal] quitting after 50 ms with 1 shells still closing: what they started may be left running']])
    // The registry still holds the shell. The quit worfy asked for goes through all the same.
    expect(w.willQuit()).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(w.quit).toHaveBeenCalledOnce()
    expect(closeAll).toHaveBeenCalledOnce()
    // That one quit only: when worfy is still there afterwards, the next quit waits for the shells again.
    expect(w.willQuit()).toHaveBeenCalledOnce()
    expect(closeAll).toHaveBeenCalledTimes(2)
    // Let that second wait end inside this test.
    await vi.waitFor(() => expect(w.quit).toHaveBeenCalledTimes(2), { timeout: 2000 })
    warn.mockRestore()
  })

  it('a wait that was not cut logs nothing, and the quit after it goes through once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const w = wiring([])
    let size = 1
    const closing = { size: 0, closeAll: () => undefined } as unknown as TerminalRegistry
    Object.defineProperty(closing, 'size', { get: () => size })
    ;(closing as unknown as { closeAll: () => Promise<void> }).closeAll = () => {
      size = 0
      return Promise.resolve()
    }
    wireRegistry(closing, { ...w, quitWaitMs: 5000 })
    expect(w.willQuit()).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(w.quit).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(w.willQuit()).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the wait of a quit is longer than what closing a Terminal may take: 3 s, and on Windows 6 s, a second past the bound of a close there', async () => {
    expect({ QUIT_WAIT_MS, WINDOWS_QUIT_WAIT_MS, WINDOWS_CLOSE_BOUND_MS }).toEqual({ QUIT_WAIT_MS: 3000, WINDOWS_QUIT_WAIT_MS: 6000, WINDOWS_CLOSE_BOUND_MS: 5000 })
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const waits: Record<string, number> = {}
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        const w = wiring([])
        const stuck = { size: 1, closeAll: () => new Promise<void>(() => undefined) } as unknown as TerminalRegistry
        wireRegistry(stuck, { ...w, platform })
        const started = Date.now()
        w.willQuit()
        w.quit.mockImplementation(() => (waits[platform] = Date.now() - started))
        await vi.advanceTimersByTimeAsync(10_000)
      }
      expect(waits).toEqual({ win32: 6000, darwin: 3000, linux: 3000 })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
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

  it('drops keys the contract does not declare: a `cwd` from the renderer does not move the shell', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    const elsewhere = await realpath(tmpdir())
    const opened = await h.ok<OpenResult>('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24, cwd: elsewhere, shell: '/bin/bash' })
    expect(Object.keys(opened).sort()).toEqual(['end', 'exited', 'pid', 'replay', 'shell', 'started'])
    expect(opened.shell).toBe(SHELL_NAME)
    await h.run(SAY_THE_FOLDER, folderLine(root))
    for (const output of h.outputs) expect(Object.keys(output).sort()).toEqual(['data', 'end', 'nodeId', 'projectId'])
  })

  it('terminal.shells lists the shells of this Machine: none where the shell is $SHELL; PowerShell and Git Bash on Windows', async () => {
    const h = await harness()
    const shells = await h.ok<{ id: string; label: string; found: boolean }[]>('terminal.shells')
    if (!WINDOWS) expect(shells).toEqual([])
    else {
      // The Path of the harness has the system folders alone: Windows PowerShell.
      expect(shells).toEqual([
        { id: 'powershell', label: 'Windows PowerShell', found: true },
        { id: 'git-bash', label: 'Git Bash', found: findGitBash(windowsEnv(home)) !== null },
      ])
    }
    // Asking starts nothing.
    expect(h.registry.size).toBe(0)
  })

  it('terminal.shells answers what the Machine gives, an empty list when it gives nothing, and refuses an answer outside the contract', async () => {
    const list = [
      { id: 'powershell', label: 'PowerShell (pwsh)', found: true },
      { id: 'git-bash', label: 'Git Bash', found: false },
    ]
    expect(await (await harness({ shells: () => Promise.resolve(list) })).ok('terminal.shells')).toEqual(list)
    expect(await (await harness({ shells: null })).ok('terminal.shells')).toEqual([])
    for (const wrong of [[{ id: 'wsl', label: 'WSL', found: true }], [{ id: 'git-bash', label: '', found: true }], [{ id: 'git-bash', label: 'Git Bash' }], [{ id: 'git-bash', label: 'Git Bash', found: 'yes' }], { id: 'git-bash' }]) {
      const h = await harness({ shells: () => Promise.resolve(wrong as unknown[]) })
      expect((await h.call('terminal.shells')).ok, JSON.stringify(wrong)).toBe(false)
    }
    // Input is not taken.
    const h = await harness({ shells: () => Promise.resolve(list) })
    expect((await h.call('terminal.shells', { projectId: PROJECT })).ok).toBe(false)
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
    // LANG by the system is in test/unit/terminal-shell.test.ts; here the rules of macOS.
    const env = terminalEnv({ PATH: '/opt/bin:/usr/bin', HOME: '/Users/u', PWD: '/old', OLDPWD: '/older', SHLVL: '2', _: '/usr/bin/env', MY_VAR: 'x' }, '/repo', 'darwin')
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
    expect(terminalEnv({ LANG: 'ru_RU.UTF-8' }, '/repo', 'darwin').LANG).toBe('ru_RU.UTF-8')
  })
})
