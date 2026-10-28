// When a Session hears that its Claude Code process has exited (src/main/agent/session/process.ts):
// at Node's `exit` event, or, while exited() waits (waitForExit), as soon as the system runs no
// process with its pid. On the Windows runner Node's event came up to 1.7 s, once more than 7 s,
// after the system reported the exit code (CI run 40651661632).
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exitOf, stopWaiting, waitForExit } from '../../src/main/agent/session/process'
import type { ClaudeCodeProcess } from '../../src/main/agent/session/types'

const PID = 4242

/** A process as a Session sees it; `exit()` is Node's exit event. */
function fakeChild(): ClaudeCodeProcess & { exit: () => void } {
  const events = new EventEmitter()
  const child = {
    pid: PID,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: () => true,
    once: (event: 'exit', listener: () => void) => events.once(event, listener),
    exit: () => {
      child.signalCode = 'SIGTERM'
      events.emit('exit', null, 'SIGTERM')
    },
  }
  return child
}

/** process.kill(pid, 0) for PID: `runs` while the system runs it, then ESRCH; other pids are not asked. */
function systemRuns(runs: () => boolean) {
  return vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    expect([pid, signal]).toEqual([PID, 0])
    if (runs()) return true
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
  })
}

const settledNow = async (promise: Promise<void>): Promise<boolean> => {
  let settled = false
  void promise.then(() => (settled = true))
  await vi.advanceTimersByTimeAsync(0)
  return settled
}

describe('exitOf and waitForExit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('exitOf alone asks the system nothing: it settles at the exit event', async () => {
    const kill = systemRuns(() => false)
    const child = fakeChild()
    const exit = exitOf(child)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settledNow(exit)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
    child.exit()
    expect(await settledNow(exit)).toBe(true)
  })

  it('waitForExit settles once the system runs no process with the pid, before the exit event', async () => {
    let runs = true
    systemRuns(() => runs)
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(500)
    expect(await settledNow(exit)).toBe(false)
    runs = false
    await vi.advanceTimersByTimeAsync(100)
    expect(await settledNow(exit)).toBe(true)
  })

  it('one promise per process: whoever asked exitOf first hears of the exit first, also when waitForExit found it', async () => {
    let runs = true
    systemRuns(() => runs)
    const child = fakeChild()
    const heard: string[] = []
    void exitOf(child).then(() => heard.push('first'))
    void waitForExit(child).then(() => heard.push('second'))
    expect(exitOf(child)).toBe(waitForExit(child))
    runs = false
    await vi.advanceTimersByTimeAsync(100)
    expect(heard).toEqual(['first', 'second'])
  })

  it('keeps waiting while the pid runs, also when only EPERM says so (a pid handed to another process)', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    })
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settledNow(exit)).toBe(false)
    expect(kill).toHaveBeenCalled()
    child.exit()
    expect(await settledNow(exit)).toBe(true)
  })

  it.each(['EINVAL', 'ENOSYS', 'UNKNOWN'])('keeps waiting while kill(pid, 0) fails with %s: only ESRCH says the pid is gone', async (code) => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error(`kill ${code}`), { code })
    })
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settledNow(exit)).toBe(false)
    child.exit()
    expect(await settledNow(exit)).toBe(true)
  })

  it('stopWaiting ends the asking for a process given up on; its exit event still settles it', async () => {
    const kill = systemRuns(() => true)
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(200)
    stopWaiting(child)
    const asked = kill.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(kill.mock.calls.length).toBe(asked)
    child.exit()
    expect(await settledNow(exit)).toBe(true)
  })

  it('waitForExit after stopWaiting asks the system again, and settles once the pid is gone', async () => {
    let runs = true
    const kill = systemRuns(() => runs)
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(200)
    stopWaiting(child)
    const asked = kill.mock.calls.length
    expect(waitForExit(child)).toBe(exit)
    await vi.advanceTimersByTimeAsync(200)
    expect(kill.mock.calls.length).toBeGreaterThan(asked)
    expect(await settledNow(exit)).toBe(false)
    runs = false
    await vi.advanceTimersByTimeAsync(100)
    expect(await settledNow(exit)).toBe(true)
  })

  it('asks the system nothing more once the process has exited', async () => {
    const kill = systemRuns(() => true)
    const child = fakeChild()
    const exit = waitForExit(child)
    await vi.advanceTimersByTimeAsync(200)
    child.exit()
    expect(await settledNow(exit)).toBe(true)
    const asked = kill.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(kill.mock.calls.length).toBe(asked)
  })

  it('settles at once for a process that has already exited, and asks nothing', async () => {
    const kill = systemRuns(() => true)
    const child = fakeChild()
    child.exit()
    expect(await settledNow(waitForExit(child))).toBe(true)
    expect(kill).not.toHaveBeenCalled()
  })
})
