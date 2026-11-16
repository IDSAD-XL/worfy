// When the main branch is fetched (src/main/workflow/fetch.ts; worfy-polish ticket 118): at the start, every
// 2 minutes, and at a window's focus no more than once in 30 s; one at a time; nothing after close. Fake clocks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FETCH_CONFIG, FETCH_EVERY_MS, FETCH_FOCUS_MIN_MS, FetchSchedule, fetchEnv, type FetchStatus } from '../../src/main/workflow/fetch'
import { sourceView, type MainRef } from '../../src/main/workflow/main-ref'

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})

afterEach(() => {
  vi.useRealTimers()
})

/** A schedule whose fetch ends at once with `outcome()`; counts the fetches and keeps each status it reported. */
function schedule(outcome: () => Promise<void> = () => Promise.resolve()) {
  const done: FetchStatus[] = []
  const fetch = vi.fn<(signal: AbortSignal) => Promise<void>>(() => outcome())
  const fetches = new FetchSchedule({ fetch, onDone: (status) => done.push(status) })
  return { fetches, fetch, done }
}

describe('the fetch schedule', () => {
  it('fetches at the start and every 2 minutes after', async () => {
    const { fetches, fetch } = schedule()
    fetches.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS - 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
    await fetches.close()
  })

  it('a focus fetches only when the last fetch began at least 30 s ago', async () => {
    const { fetches, fetch } = schedule()
    fetches.start()
    await vi.advanceTimersByTimeAsync(FETCH_FOCUS_MIN_MS - 1)
    fetches.focus()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    fetches.focus()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    // A second focus right after: within 30 s of that fetch, nothing.
    fetches.focus()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    await fetches.close()
  })

  it('runs one fetch at a time: a focus while one runs is dropped', async () => {
    let finish: () => void = () => undefined
    const { fetches, fetch } = schedule(() => new Promise<void>((done) => (finish = done)))
    fetches.start()
    await vi.advanceTimersByTimeAsync(FETCH_FOCUS_MIN_MS * 3)
    fetches.focus()
    expect(fetch).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    fetches.focus()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    // The second fetch ends too: close waits for the one that runs.
    finish()
    await fetches.close()
  })

  it('keeps when fetching began to fail and when it last worked', async () => {
    let fail = true
    const { fetches, done } = schedule(() => (fail ? Promise.reject(new Error('Could not resolve host: github.com')) : Promise.resolve()))
    fetches.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(done.at(-1)).toEqual({ lastOk: null, failingSince: 1_000_000, error: 'Could not resolve host: github.com' })
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS)
    // Still failing: the first failure's time stays.
    expect(done.at(-1)?.failingSince).toBe(1_000_000)
    fail = false
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS)
    expect(done.at(-1)).toEqual({ lastOk: 1_000_000 + 2 * FETCH_EVERY_MS, failingSince: null, error: null })
    await fetches.close()
  })

  it('close stops the timer and the fetch that runs, and nothing is fetched after it', async () => {
    let aborted = false
    const { fetches, fetch } = schedule()
    fetch.mockImplementationOnce(
      (signal: AbortSignal) =>
        new Promise<void>((done) =>
          signal.addEventListener('abort', () => {
            aborted = true
            done()
          }),
        ),
    )
    fetches.start()
    await fetches.close()
    expect(aborted).toBe(true)
    fetches.focus()
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS * 5)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the "As of" notice', () => {
  const ref: MainRef = { kind: 'ref', ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40), committedAt: 0, top: '/p', ticketsRel: '.scratch', rootRel: '', fetchBranch: 'main' }

  it('shows once fetch has failed for 10 minutes, not before', () => {
    const failing: FetchStatus = { lastOk: 500_000, failingSince: 1_000_000, error: 'Could not resolve host: github.com' }
    // Before the notice the model carries no time of a fetch: a fetch that worked or failed changes nothing in it.
    expect(sourceView(ref, failing, 1_000_000 + 10 * 60_000 - 1)).toEqual({ ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40), updatedAt: null, notice: null })
    expect(sourceView(ref, { lastOk: 1_500_000, failingSince: null, error: null }, 1_600_000)).toEqual(sourceView(ref, { lastOk: 900_000, failingSince: null, error: null }, 1_600_000))
    expect(sourceView(ref, failing, 1_000_000 + 10 * 60_000)).toEqual({
      ref: 'refs/remotes/origin/main',
      sha: 'a'.repeat(40),
      updatedAt: new Date(500_000).toISOString(),
      notice: 'git fetch origin has failed for 10 min: Could not resolve host: github.com',
    })
  })

  it('says nothing for the working tree that is the truth, and the reason for one read in place of the main branch', () => {
    expect(sourceView({ kind: 'tree', reason: null, sha: null, fetchBranch: null })).toBeNull()
    expect(sourceView({ kind: 'tree', reason: 'no origin', sha: 'b'.repeat(40), fetchBranch: null })).toEqual({ ref: null, sha: 'b'.repeat(40), updatedAt: null, notice: 'no origin' })
  })
})

describe('nothing in a fetch asks the user anything', () => {
  it('turns off the credential window, the terminal prompt and every ssh question', () => {
    expect(FETCH_CONFIG).toEqual(expect.arrayContaining(['credential.interactive=false']))
    const env = fetchEnv({ PATH: '/bin', GIT_DIR: '/elsewhere' }, null)
    expect(env).toMatchObject({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' })
    expect(env.GIT_DIR).toBeUndefined()
  })

  it('keeps the ssh command git would run, in its order: GIT_SSH_COMMAND, core.sshCommand, then ssh', () => {
    expect(fetchEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }, 'C:/Windows/System32/OpenSSH/ssh.exe').GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
    expect(fetchEnv({}, 'C:/Windows/System32/OpenSSH/ssh.exe').GIT_SSH_COMMAND).toBe('C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes')
    // A program in GIT_SSH alone (plink) takes no ssh options: it is left as it is.
    expect(fetchEnv({ GIT_SSH: 'C:/PuTTY/plink.exe' }, null)).toMatchObject({ GIT_SSH: 'C:/PuTTY/plink.exe', GCM_INTERACTIVE: 'never' })
    expect(fetchEnv({ GIT_SSH: 'C:/PuTTY/plink.exe' }, null).GIT_SSH_COMMAND).toBeUndefined()
  })
})
