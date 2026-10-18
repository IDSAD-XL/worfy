// What the console of the node-pty package brought into the registry (worfy-windows ticket 22,
// review of PR #280): the shell is started through node-pty with that console, and an exit that
// node-pty knows of and has not reported is reported by the registry. node-pty is a recorder
// here and the ptys are stand-ins, so every case runs on any system.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakePty, OPEN, SINK, WIN_ENV, WINDOWS_POWERSHELL, winEnv } from './terminal-fake-pty'

/** node-pty, as a recorder: what a registry without a spawn of its own asks of it. No test here starts a real shell. */
const nodePty = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; options: Record<string, unknown> }[],
  exits: [] as (() => void)[],
  /** The input socket of each pty made, as node-pty has it: an emitter with no listener of its own. */
  inputs: [] as { emit: (event: string, ...args: unknown[]) => boolean; listenerCount: (event: string) => number }[],
}))
vi.mock('node-pty', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: (file: string, args: string[], options: Record<string, unknown>) => {
      nodePty.calls.push({ file, args, options })
      let exited: (event: { exitCode: number }) => void = () => undefined
      // The shell of this stand-in exits when the test says so, or at kill().
      nodePty.exits.push(() => exited({ exitCode: 0 }))
      const inSocket = new EventEmitter()
      nodePty.inputs.push(inSocket)
      return {
        pid: 999_992_000 + nodePty.calls.length,
        onData: () => undefined,
        onExit: (listener: typeof exited) => void (exited = listener),
        write: () => undefined,
        resize: () => undefined,
        kill: () => exited({ exitCode: 0 }),
        _agent: { inSocket },
      }
    },
  }
})

const { EXIT_GRACE_MS, EXIT_POLL_MS, PID_POLL_MS, PID_WAIT_MS, TerminalRegistry, WINDOWS_CLOSE_BOUND_MS } = await import('../../src/main/terminal/pty')
type SpawnPty = import('../../src/main/terminal/pty').SpawnPty
type StartedShell = import('../../src/main/terminal/pty').StartedShell

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// worfy-windows ticket 22, review of PR #280. Every other test gives the registry a spawn of its
// own, so nothing else fails when the registry stops starting shells the way the app must.
describe('TerminalRegistry without a spawn of its own: node-pty as the app starts a shell', () => {
  const realPlatform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    nodePty.calls.length = 0
    nodePty.exits.length = 0
    nodePty.inputs.length = 0
  })

  it('on Windows asks node-pty for the console of its package (useConptyDll), with the size, the folder and the name of the terminal', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: winEnv, platform: 'win32', endDescendants: () => undefined })
    await registry.open('a', OPEN, {}, SINK)
    expect(nodePty.calls).toHaveLength(1)
    const [{ file, args, options }] = nodePty.calls as [(typeof nodePty.calls)[number]]
    expect([file, args]).toEqual([WINDOWS_POWERSHELL, ['-NoLogo']])
    expect(options).toEqual({ name: 'xterm-256color', cols: 80, rows: 24, cwd: 'C:\\p\\repo', env: expect.any(Object), useConptyDll: true })
    await registry.closeAll()
  })

  // Measured on the PC: one write a millisecond across the exit of a shell ends as an `error`
  // (EAGAIN) of node-pty's input socket in 10 of 10 shells on the console of the package. node-pty
  // gives that socket no listener, and an `error` nobody listens to is an uncaught exception.
  it('on Windows listens for an error of the input socket of node-pty and says it once for a shell', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: winEnv, platform: 'win32', endDescendants: () => undefined })
    const { pid } = await registry.open('a', OPEN, {}, SINK)
    const [input] = nodePty.inputs as [(typeof nodePty.inputs)[number]]
    expect(input.listenerCount('error')).toBe(1)
    const failure = Object.assign(new Error('write EAGAIN'), { code: 'EAGAIN' })
    // With no listener emit would throw: that is the uncaught exception.
    expect(() => input.emit('error', failure)).not.toThrow()
    input.emit('error', failure)
    expect(warn.mock.calls).toEqual([[`[terminal] a write to the shell ${pid} failed: the shell is going or gone`, failure]])
    await registry.closeAll()
  })

  it.each(['darwin', 'linux'] as const)('on %s gives node-pty the same options as before, with no word of a console', async (platform) => {
    Object.defineProperty(process, 'platform', { value: platform })
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), platform })
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, {}, SINK)
    expect(nodePty.calls).toHaveLength(1)
    const [{ file, args, options }] = nodePty.calls as [(typeof nodePty.calls)[number]]
    expect([file, args]).toEqual(['/bin/sh', ['-l']])
    expect(Object.keys(options).sort()).toEqual(['cols', 'cwd', 'env', 'name', 'rows'])
    expect(options).toMatchObject({ name: 'xterm-256color', cols: 80, rows: 24, cwd: '/p/repo' })
    // Nothing of node-pty is reached into there.
    expect(nodePty.inputs[0]?.listenerCount('error')).toBe(0)
    // Off Windows a close signals the shell and waits for its exit.
    const closed = registry.closeAll()
    for (const exit of nodePty.exits) exit()
    await closed
  })
})

// worfy-windows ticket 22, review of PR #280. On the console of the node-pty package the exit
// event waits for the output of the console to close, and the console lives while any process is
// attached to it: a shell that left a program behind was reported 30 s late on the PC.
describe('TerminalRegistry on Windows: an exit that node-pty knows of and has not reported', () => {
  const windows = (spawn: SpawnPty): InstanceType<typeof TerminalRegistry> => new TerminalRegistry({ env: winEnv, spawn, platform: 'win32', endDescendants: () => undefined })

  it('reports the exit itself a moment after node-pty has the exit code, takes the pty apart, and stops looking; node-pty\'s late event changes nothing', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_994_281, { deaf: true })
    // What node-pty answers for the exit code, and how often it is asked.
    let code: number | undefined = undefined
    let asked = 0
    Object.defineProperty(fake.agent, 'exitCode', {
      get: () => {
        asked += 1
        return code
      },
    })
    const exits: [number, number | null][] = []
    const registry = windows(() => fake.pty)
    await registry.open('a', OPEN, {}, { ...SINK, exit: (exitCode, signal) => exits.push([exitCode, signal]) })
    await vi.advanceTimersByTimeAsync(10_000)
    // Asked every half second; while the shell runs nothing is reported.
    expect(asked).toBe(10_000 / EXIT_POLL_MS)
    expect(exits).toEqual([])

    // The shell is gone, and another process holds its console: no exit event.
    code = 3
    await vi.advanceTimersByTimeAsync(EXIT_POLL_MS + EXIT_GRACE_MS - 1)
    expect(exits).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([[3, null]])
    expect(registry.hasExited('a')).toBe(true)
    expect(fake.kills).toEqual([undefined])
    expect(fake.stops).toEqual([1])
    // One look found the code; none came after it.
    expect(asked).toBe(10_000 / EXIT_POLL_MS + 1)
    const looks = asked
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toBe(looks)
    // The program that held the console ends half a minute later: node-pty's own event.
    fake.exit(3)
    expect(exits).toEqual([[3, null]])
    expect({ EXIT_POLL_MS, EXIT_GRACE_MS }).toEqual({ EXIT_POLL_MS: 500, EXIT_GRACE_MS: 1000 })
    await registry.closeAll()
  })

  // Review round 2 of PR #280. The look ends a Terminal that is not closing while node-pty still
  // reads its console, and kill() does not stop that output. An output event names no shell: after
  // a Restart a late line of the old console reached the screens and the kept output of the new shell.
  it('after it has reported the exit itself, nothing more of that pty is delivered — not to the screens, and not to a shell started in its place', async () => {
    vi.useFakeTimers()
    const old = fakePty(999_994_287, { deaf: true })
    const next = fakePty(999_994_288)
    const ptys = [old.pty, next.pty]
    const registry = windows(() => ptys.shift()!)
    /** What the screen is told, in order: an output with the offset of its end, or the exit. */
    const told: (string | number | null)[][] = []
    const sink = { ...SINK, output: (data: string, end: number) => void told.push(['output', data, end]), exit: (exitCode: number, signal: number | null) => void told.push(['exit', exitCode, signal]) }
    const answers: string[] = []
    old.pty.write = (data) => void answers.push(data)
    const client = {}
    await registry.open('a', OPEN, client, sink)
    old.print('PS C:\\old> ')
    // A plain `exit`: the code is 0, and a program the shell left behind holds the console.
    old.agent.exitCode = 0
    await vi.advanceTimersByTimeAsync(EXIT_POLL_MS + EXIT_GRACE_MS - 10)
    // Just before the exit is reported: the end of this chunk may be the start of a request and is held back.
    old.print('bye\x1b')
    await vi.advanceTimersByTimeAsync(10)
    // What was read before the exit is told before it, the held end included.
    expect(told).toEqual([
      ['output', 'PS C:\\old> ', 11],
      ['output', 'bye', 14],
      ['output', '\x1b', 15],
      ['exit', 0, null],
    ])

    // The program left on the console prints on: the Terminal that has exited shows and keeps none of it.
    old.print('old leftover 1\r\n')
    expect(told).toHaveLength(4)
    expect(await registry.open('a', OPEN, {}, SINK)).toMatchObject({ replay: 'PS C:\\old> bye\x1b', started: false })

    // Restart: a new shell under the same key.
    expect(await registry.open('a', { ...OPEN, restart: true }, client, sink)).toMatchObject({ pid: 999_994_288, started: true, replay: '' })
    next.print('PS C:\\new> ')
    old.print('old leftover 2\r\n')
    next.print('dir\r\n')
    // A request of the old console is not answered, and its held end is not sent a moment later.
    old.print('\x1b[c\x1b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(told.slice(4)).toEqual([
      ['output', 'PS C:\\new> ', 11],
      ['output', 'dir\r\n', 16],
    ])
    expect(answers).toEqual([])
    expect(await registry.open('a', OPEN, {}, SINK)).toMatchObject({ replay: 'PS C:\\new> dir\r\n' })
    await registry.closeAll()
  })

  it('node-pty\'s own exit event first: the exit is reported once, with the code of the event, and nothing looks any more', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_994_282, { deaf: true })
    let asked = 0
    Object.defineProperty(fake.agent, 'exitCode', {
      get: () => {
        asked += 1
        return 7
      },
    })
    const exits: [number, number | null][] = []
    const registry = windows(() => fake.pty)
    await registry.open('a', OPEN, {}, { ...SINK, exit: (exitCode, signal) => exits.push([exitCode, signal]) })
    // Before the first look, and inside the moment after a look as well.
    fake.exit(4)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(exits).toEqual([[4, null]])
    expect(asked).toBe(0)

    const second = fakePty(999_994_283, { deaf: true })
    second.agent.exitCode = 9
    const later: [number, number | null][] = []
    const other = windows(() => second.pty)
    await other.open('b', OPEN, {}, { ...SINK, exit: (exitCode, signal) => later.push([exitCode, signal]) })
    await vi.advanceTimersByTimeAsync(EXIT_POLL_MS)
    second.exit(5)
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 3)
    expect(later).toEqual([[5, null]])
    await registry.closeAll()
    await other.closeAll()
  })

  it('an exit code that is not a number — not node-pty as 1.1.0 builds it — is no exit', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_994_286, { deaf: true })
    Object.assign(fake.agent, { exitCode: 'gone' })
    const exits: [number, number | null][] = []
    const registry = windows(() => fake.pty)
    await registry.open('a', OPEN, {}, { ...SINK, exit: (exitCode, signal) => exits.push([exitCode, signal]) })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(exits).toEqual([])
    expect(registry.has('a')).toBe(true)
    fake.exit(2)
    expect(exits).toEqual([[2, null]])
  })

  it('a close does not wait for node-pty\'s event either: the exit it knows of ends the close', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_994_284, { deaf: true })
    const registry = windows(() => fake.pty)
    await registry.open('a', OPEN, {}, SINK)
    let closed = false
    const closing = registry.close('a').then(() => (closed = true))
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.kills).toEqual([undefined])
    // kill() ended the shell; the console is still held by something else.
    fake.agent.exitCode = 1
    await vi.advanceTimersByTimeAsync(EXIT_POLL_MS + EXIT_GRACE_MS)
    await closing
    expect(closed).toBe(true)
    expect(registry.size).toBe(0)
    // Well inside the bound of a close, which had nothing to do.
    expect(EXIT_POLL_MS + EXIT_GRACE_MS).toBeLessThan(WINDOWS_CLOSE_BOUND_MS)
  })

  it('a resize that node-pty refuses — it knows the shell is gone — does not throw, and is said with the pid and the size', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fake = fakePty(999_994_285)
    const refused = new Error('Cannot resize a pty that has already exited')
    const sizes: [number, number][] = []
    fake.pty.resize = (cols, rows) => {
      sizes.push([cols, rows])
      throw refused
    }
    const registry = windows(() => fake.pty)
    const client = {}
    await registry.open('a', OPEN, client, SINK)
    expect(() => registry.resize('a', 100, 30, client)).not.toThrow()
    expect(sizes).toEqual([[100, 30]])
    expect(warn.mock.calls).toEqual([['[terminal] the pty of the shell 999994285 could not be resized to 100x30', refused]])
    // The size was not taken: the same size is asked of the pty again.
    registry.resize('a', 100, 30, client)
    expect(sizes).toEqual([
      [100, 30],
      [100, 30],
    ])
    await registry.closeAll()
  })

  it.each(['darwin', 'linux'] as const)('on %s node-pty is never asked for an exit code: the exit is its event, as before', async (platform) => {
    vi.useFakeTimers()
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const fake = fakePty(platform === 'darwin' ? 999_995_461 : 999_995_463, { deaf: true })
    let asked = 0
    Object.defineProperty(fake.agent, 'exitCode', {
      get: () => {
        asked += 1
        return 3
      },
    })
    const exits: [number, number | null][] = []
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform })
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, {}, { ...SINK, exit: (exitCode, signal) => exits.push([exitCode, signal]) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toBe(0)
    expect(exits).toEqual([])
    fake.exit(2)
    expect(exits).toEqual([[2, null]])
  })
})

// worfy-windows ticket 40. node-pty 1.2.0-beta.15 on Windows creates the shell only once its thread
// that reads the output is connected (lib/windowsPtyAgent.js, connect() in the worker's onReady):
// until then pty.pid is 0, and the shell is created after spawn has returned. The IPC answer of
// terminal.open takes a positive pid only.
describe('TerminalRegistry on Windows: a shell whose pid node-pty gives a moment after the start', () => {
  it('open waits for the pid and answers with it; the shell counts as started from the moment the pid came', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0)
    const shells: StartedShell[] = []
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: (shell) => void shells.push(shell) })
    const started: number[] = []
    let opened: { pid: number } | undefined
    void registry.open('a', OPEN, {}, { ...SINK, started: (pid) => started.push(pid) }).then((result) => (opened = result))
    await vi.advanceTimersByTimeAsync(300)
    expect(opened).toBeUndefined()
    expect(started).toEqual([])

    ;(fake.pty as { pid: number }).pid = 999_994_401
    const known = Date.now()
    await vi.advanceTimersByTimeAsync(PID_POLL_MS)
    expect(opened?.pid).toBe(999_994_401)
    expect(started).toEqual([999_994_401])

    // The look stops once the pid came: later moments would let the helper of the close take a
    // process that got the pid of the shell afterwards for the shell.
    await vi.advanceTimersByTimeAsync(1000)
    await registry.close('a')
    expect(shells.map((shell) => shell.pid)).toEqual([999_994_401])
    // Not the moment spawn returned: the helper would take the shell for another process.
    expect(shells[0]?.startedBy).toBeGreaterThanOrEqual(known)
    expect(shells[0]?.startedBy).toBeLessThanOrEqual(known + PID_POLL_MS)
  })

  it('a shell that ends before node-pty gave its pid does not open: open fails, and nothing is kept of it', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    const failed = expect(registry.open('a', OPEN, {}, SINK)).rejects.toThrow('the shell of a ended while node-pty was starting it')
    await vi.advanceTimersByTimeAsync(100)
    // node-pty 1.2 sends the exit itself when it could not connect the shell (code -1).
    fake.exit(-1)
    await vi.advanceTimersByTimeAsync(PID_POLL_MS)
    await failed
    expect(registry.has('a')).toBe(false)
    expect(registry.hasExited('a')).toBe(false)
    // No look left behind.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a shell that got its pid and exited before the registry looked does not open either: no running Terminal that has ended', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    const failed = expect(registry.open('a', OPEN, {}, SINK)).rejects.toThrow('the shell of a ended while node-pty was starting it')
    await vi.advanceTimersByTimeAsync(PID_POLL_MS)
    ;(fake.pty as { pid: number }).pid = 999_994_403
    fake.exit(0)
    await vi.advanceTimersByTimeAsync(PID_POLL_MS)
    await failed
    expect(registry.has('a')).toBe(false)
    expect(registry.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('has an upper bound: with neither a pid nor an exit within PID_WAIT_MS the pty is asked to close and open fails', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0, { deaf: true })
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    const failed = expect(registry.open('a', OPEN, {}, SINK)).rejects.toThrow(`node-pty gave no pid for the shell of a within ${PID_WAIT_MS} ms`)
    await vi.advanceTimersByTimeAsync(PID_WAIT_MS - PID_POLL_MS)
    expect(fake.kills).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * PID_POLL_MS)
    await failed
    expect(fake.kills).toEqual([undefined])
    expect(registry.has('a')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // node-pty gives up after 5 s itself (CONNECTION_TIMEOUT): the bound is past that.
    expect({ PID_POLL_MS, PID_WAIT_MS }).toEqual({ PID_POLL_MS: 10, PID_WAIT_MS: 10_000 })
  })

  // Review round 1 of PR #498. On Windows the quit waits for the shells WINDOWS_QUIT_WAIT_MS (6 s):
  // a close that first waited for the pid (up to PID_WAIT_MS) and then closed could outlast it.
  it('a close while node-pty starts the shell takes the pty apart at once; open fails, and nothing waits any more', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0, { deaf: true })
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    const failed = expect(registry.open('a', OPEN, {}, SINK)).rejects.toThrow('the shell of a was closed while node-pty was starting it')
    await vi.advanceTimersByTimeAsync(100)
    let closed = false
    const closing = registry.close('a').then(() => (closed = true))
    expect(fake.kills).toEqual([undefined])
    await failed
    // Without a timer moving: the close does not wait for the pid, nor for an exit.
    await vi.advanceTimersByTimeAsync(0)
    expect(closed).toBe(true)
    await closing
    expect(registry.has('a')).toBe(false)
    expect(registry.hasExited('a')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a close that comes before the shell is spawned takes it apart as soon as the wait for its pid begins', async () => {
    vi.useFakeTimers()
    const fake = fakePty(0, { deaf: true })
    const next = fakePty(0)
    const ptys = [fake.pty, next.pty]
    let giveEnv: (env: Record<string, string>) => void = () => undefined
    // The first start waits for its environment; the second has it at once.
    const envs = [new Promise<Record<string, string>>((resolve) => (giveEnv = resolve))]
    const env = () => envs.shift() ?? winEnv()
    const registry = new TerminalRegistry({ env, spawn: () => ptys.shift()!, platform: 'win32', endDescendants: () => undefined })
    const failed = expect(registry.open('a', OPEN, {}, SINK)).rejects.toThrow('the shell of a was closed while node-pty was starting it')
    await vi.advanceTimersByTimeAsync(0)
    let closed = false
    const closing = registry.close('a').then(() => (closed = true))
    expect(fake.kills).toEqual([])
    giveEnv({ ...WIN_ENV })
    await failed
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.kills).toEqual([undefined])
    expect(closed).toBe(true)
    await closing
    expect(registry.has('a')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // The mark does not outlive that start: the next open of the key waits for its pid as usual.
    let opened: { pid: number } | undefined
    void registry.open('a', OPEN, {}, SINK).then((result) => (opened = result))
    await vi.advanceTimersByTimeAsync(100)
    expect(next.kills).toEqual([])
    ;(next.pty as { pid: number }).pid = 999_994_404
    await vi.advanceTimersByTimeAsync(PID_POLL_MS)
    expect(opened?.pid).toBe(999_994_404)
    await registry.closeAll()
  })

  it('a pid that is there at spawn, as node-pty 1.1.0 and the stand-ins give it, is not waited for', async () => {
    const fake = fakePty(999_994_402)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    expect((await registry.open('a', OPEN, {}, SINK)).pid).toBe(999_994_402)
    await registry.closeAll()
  })
})
