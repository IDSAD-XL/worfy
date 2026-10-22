// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh, ticket worfy-harness/02)
// run here, one case per file, so they run in `pnpm test`: in CI on Linux and in the gate.
// Each file runs as `bash <file>` with HOME in a fresh empty temporary directory, so no test can
// read or write the owner's real ~/.claude (USERPROFILE is the same folder: a Node script on
// Windows takes the home folder from it, not from HOME); the test finds the script it checks next to itself
// (harness/), not under $HOME/.claude. Git in an empty HOME has no identity, so the author and
// committer come from the environment.
// On Windows `bash` is Git Bash, found explicitly (test/git-bash.ts): the first bash.exe on the PATH
// may be the WSL launcher.
//
// The files run a few at a time (it.concurrent), not one after another. vitest runs files in
// parallel but the tests of one file in sequence, so the serial loop made this one file take the
// whole wall time of `pnpm test` (517 s of 519 s on the Mac, 2026-10-20). How many run at once is
// the `maxConcurrency` of the contract project (vitest.config.ts); a waiting case has not started,
// so its time limit counts from its own start, not from the start of the file.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { gitBash } from '../git-bash'
import { removeTestTree } from '../remove'
import { timeScale } from '../time-scale'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const TEST_DIRS = [join(HARNESS, 'bin', 'tests'), join(HARNESS, 'hooks', 'tests')]

// The ticket imports 5 tests under bin/tests and 3 under hooks/tests.
const MIN_TESTS = 8
const WINDOWS = process.platform === 'win32'
// The limit is for a test that hangs (a script waiting on stdin). On Windows every process start is
// slow: alone on the owner's PC wave-gate.test.sh takes 269-317 s, profile and skill-blocks 140-170 s,
// and five files at once take longer, so 300 s cut off wave-gate.test.sh there (2026-10-21).
// With the lock-takeover cases wave-gate.test.sh takes 348 s alone and went past 600 s in a full
// run (2026-10-22), hence 900 s. The cost: a hanging .test.sh on Windows is cut off 5 min later.
const FILE_TIMEOUT_MS = WINDOWS ? 900_000 : 120_000

const testFiles = TEST_DIRS.flatMap((dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.test.sh'))
        .sort()
        .map((name) => join(dir, name))
    : [],
)

const relative = (file: string): string => file.slice(HARNESS.length + 1).replaceAll('\\', '/')

// The longest files start first, so the last ones to finish are short. Alone on the Mac
// (2026-10-20, one at a time under `nice -n 10`) each of these took 20 s or more, longest first:
// 80, 59, 54, 45, 37, 27, 25 and 23 s; the 30 others took 19 s or less, 478 s for all 38. Five at a
// time in this order the 38 files take about 98 s, in name order about 120 s. A file not listed
// starts after them in name order; a name listed here must exist (a case below checks it).
// shortcut: the list is a measured snapshot and does not follow a file that grows slower, redo it
// when this file runs longer than the longest single shell test plus a few seconds.
const RUN_FIRST = [
  'bin/tests/wave-gate.test.sh',
  'bin/tests/wave-gate-lock.test.sh',
  'hooks/tests/guard-silent.test.sh',
  'bin/tests/skill-blocks.test.sh',
  'bin/tests/profile.test.sh',
  'hooks/tests/gate-verdict.test.sh',
  'bin/tests/silent-mode.test.sh',
  'bin/tests/qmd-collections.test.sh',
  'bin/tests/preflight.test.sh',
]

/** The files in the order they start: the names of `first` that are among them, then the rest. */
function runOrder(files: readonly string[], first: readonly string[], name: (file: string) => string): string[] {
  const head = [...new Set(first)].flatMap((wanted) => files.filter((file) => name(file) === wanted))
  return [...head, ...files.filter((file) => !head.includes(file))]
}

const ordered = runOrder(testFiles, RUN_FIRST, relative)

const tail = (text: string, lines: number): string => text.split('\n').slice(-lines).join('\n')

// What a red shell test printed, bounded: every "FAIL <check>" line its bad() wrote (the first 30), then the
// last 20 lines; with no FAIL line, the last 40 lines. The tail alone can miss the failed check: a file prints its FAIL lines where the check runs,
// and later cases fill the tail.
const MAX_FAIL_LINES = 30
const TAIL_LINES = 20
const failureReport = (output: string): string => {
  const failed = output.split('\n').filter((line) => line.startsWith('FAIL '))
  const shown = failed.slice(0, MAX_FAIL_LINES)
  if (failed.length > shown.length) shown.push(`... and ${failed.length - shown.length} more FAIL lines`)
  if (!shown.length) return tail(output, 40)
  return `${shown.join('\n')}\n--- last ${TAIL_LINES} lines:\n${tail(output, TAIL_LINES)}`
}

// The qmd scripts of the Harness and their test are zsh scripts; Windows has no zsh.
const NO_ZSH_UNTIL_TICKET_15 = 'qmd scripts are zsh until worfy-windows ticket 15'
const ZSH_ONLY = new Set([join(HARNESS, 'bin', 'tests', 'qmd.test.sh')])

type Run = {
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error
  timedOut: boolean
  output: string
  /** The pid of bash; on macOS and Linux also the id of the process group of the run. */
  pid?: number
}

// How long the output may stay open after bash has exited: a process the script started in the
// background holds it open. Past that the case returns; on macOS and Linux the run's process group
// is killed first.
const CLOSE_GRACE_MS = 2_000

/** Kills bash and every process it started: its process group (POSIX), its process tree (Windows). */
function killRun(pid: number): void {
  try {
    if (WINDOWS) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(-pid, 'SIGKILL')
  } catch {
    // The group is already gone.
  }
}

// Runs that have not returned yet, by the pid of their bash. An interrupted or ending worker kills
// them, so a stopped test run leaves no Harness process behind: bash is in a group of its own, out
// of reach of the signal that stops the worker, and the timer that would kill it dies with the
// worker. On Windows a pid leaves the set when bash exits: Windows may give it to another process.
const liveRuns = new Set<number>()
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** Kills every run that has not returned. */
function killLiveRuns(): void {
  for (const pid of liveRuns) killRun(pid)
  liveRuns.clear()
}

function stopOnSignal(signal: NodeJS.Signals): void {
  killLiveRuns()
  unwatchStops()
  // The worker still ends by the signal it got.
  process.kill(process.pid, signal)
}

function watchStops(): void {
  if (process.listeners('exit').includes(killLiveRuns)) return
  process.on('exit', killLiveRuns)
  for (const signal of STOP_SIGNALS) process.once(signal, stopOnSignal)
}

function unwatchStops(): void {
  process.off('exit', killLiveRuns)
  for (const signal of STOP_SIGNALS) process.off(signal, stopOnSignal)
}

/**
 * Runs `bash <file>` with an empty stdin. A run past `timeoutMs` is killed with everything it
 * started, not bash alone: a child that outlived bash kept the output open and the case waited for
 * it up to vitest's own limit, without the output and without removing its HOME (review of #626).
 * On macOS and Linux bash leads a process group of its own (`detached`), and the kill goes to the
 * group, so it reaches children that bash no longer parents. Resolves when the output closes, or
 * CLOSE_GRACE_MS after bash exited if something still holds it. A bash that exited before its limit
 * is judged by its exit code, even if a child it left kept the output open past the limit.
 */
function runShellTest(bash: string, file: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let error: Error | undefined
    let settled = false
    let grace: NodeJS.Timeout | undefined
    const child = spawn(bash, [file], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: !WINDOWS, windowsHide: true })
    const pid = child.pid
    if (pid !== undefined) {
      watchStops()
      liveRuns.add(pid)
    }
    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      if (pid !== undefined) liveRuns.delete(pid)
      child.stdout.destroy()
      child.stderr.destroy()
      const output = `${Buffer.concat(stdout).toString('utf8')}${Buffer.concat(stderr).toString('utf8')}`
      // A bash that exited 0 just as the limit came was not killed by it.
      resolve({ status, signal, error, timedOut: timedOut && status !== 0, output, pid })
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (pid !== undefined) killRun(pid)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    // A script that exits without reading stdin closes the pipe under the write: not a failure.
    child.stdin.on('error', () => {})
    child.stdin.end()
    child.on('error', (spawnError) => {
      error = spawnError
      // bash did not start: no exit and no output will come.
      if (pid === undefined) finish(null, null)
    })
    child.on('exit', (status, signal) => {
      // bash is gone: its limit no longer applies, the grace below takes over.
      clearTimeout(timer)
      if (WINDOWS && pid !== undefined) liveRuns.delete(pid)
      grace = setTimeout(() => {
        // On Windows the pid of an exited bash may already belong to another process, and its
        // tree no longer leads to the child it left: the case only stops waiting for the output.
        if (!WINDOWS && pid !== undefined) killRun(pid)
        finish(status, signal)
      }, CLOSE_GRACE_MS)
    })
    child.on('close', finish)
  })
}

/** Runs one shell test file as the cases do: in a new empty HOME, removed when the run returns. */
async function runInEmptyHome(file: string, timeoutMs: number): Promise<{ run: Run; home: string }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-home-')))
  try {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      // epic-status falls back to en_US.UTF-8, which a minimal Linux image may lack; the
      // warning about it would land in the output the test compares.
      LANG: process.env.LANG ?? 'C.UTF-8',
      GIT_AUTHOR_NAME: 'Harness Test',
      GIT_AUTHOR_EMAIL: 'harness-test@example.invalid',
      GIT_COMMITTER_NAME: 'Harness Test',
      GIT_COMMITTER_EMAIL: 'harness-test@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
    }
    return { run: await runShellTest(gitBash(), file, home, env, timeoutMs), home }
  } finally {
    removeTestTree(home)
  }
}

/** Why the run failed, with failureReport of its output; null when it exited 0. */
function failure(file: string, run: Run, timeoutMs: number): string | null {
  const output = failureReport(run.output)
  if (run.error !== undefined) return `${file} did not start: ${String(run.error)}\n${output}`
  if (run.timedOut) return `${file} did not finish: it was killed after ${timeoutMs / 1000} s\n${output}`
  if (run.status !== 0) return `${file} exited ${String(run.status)}${run.signal ? ` (${run.signal})` : ''}:\n${output}`
  return null
}

// How many times each file started in this run: every file once, and a retry counts as a second
// start (afterAll below fails on it).
const starts = new Map<string, number>()

describe('harness shell tests', () => {
  it(`finds at least ${MIN_TESTS} test files under harness/{bin,hooks}/tests`, () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(MIN_TESTS)
  })

  it('gives every shell test file exactly one case', () => {
    expect(ordered).toHaveLength(testFiles.length)
    expect(new Set(ordered).size).toBe(ordered.length)
    expect([...ordered].sort()).toEqual([...testFiles].sort())
  })

  it('lists in RUN_FIRST only files that exist', () => {
    const names = testFiles.map(relative)
    expect(RUN_FIRST.filter((name) => !names.includes(name))).toEqual([])
  })

  it('orders files without losing or repeating one', () => {
    const files = ['a', 'b', 'c', 'd']
    expect(runOrder(files, ['c', 'gone', 'c', 'a'], (file) => file)).toEqual(['c', 'a', 'b', 'd'])
    expect(runOrder(files, [], (file) => file)).toEqual(files)
    expect(runOrder([], ['a'], (file) => file)).toEqual([])
  })

  // The bash in the test's name, so the run's output shows which one ran the files.
  let shown: string
  try {
    shown = gitBash()
  } catch (error) {
    shown = String(error)
  }
  it(`runs the shell tests with ${shown}`, () => {
    const bash = gitBash()
    if (WINDOWS) expect(bash.toLowerCase()).not.toContain('\\system32\\')
    else expect(bash).toBe('bash')
  })

  it('the message of a red shell test names its FAIL lines before the tail', () => {
    const lines = ['ok   one', 'FAIL two: exit 1', ...Array.from({ length: 50 }, (_, i) => `ok   later ${i}`), 'passed 51, failed 1']
    const report = failureReport(lines.join('\n'))
    expect(report.startsWith('FAIL two: exit 1\n')).toBe(true)
    expect(report).toContain('passed 51, failed 1')
    expect(report.split('\n').length).toBeLessThanOrEqual(MAX_FAIL_LINES + TAIL_LINES + 2)
    const many = Array.from({ length: 40 }, (_, i) => `FAIL check ${i}`).join('\n')
    expect(failureReport(many)).toContain('... and 10 more FAIL lines')
    expect(failureReport('ok   one\npassed 1, failed 0')).toBe('ok   one\npassed 1, failed 0')
  })

  // Commands the Harness scripts need. The shell tests do not skip a check when one is missing,
  // they fail on it; this case names the missing command directly (ubuntu-latest has no zsh).
  it.for(['bash', 'zsh', 'jq', 'git', 'node'])('%s is on PATH', (command, context) => {
    context.skip(WINDOWS && command === 'zsh', NO_ZSH_UNTIL_TICKET_15)
    const found = spawnSync(WINDOWS ? gitBash() : 'sh', ['-c', `command -v ${command}`], { encoding: 'utf8' })
    expect(found.status, `${command} is not installed`).toBe(0)
  })

  it.concurrent.for(ordered.map((file): [string, string] => [relative(file), file]))(
    '%s exits 0 with an empty HOME',
    { timeout: FILE_TIMEOUT_MS + 10_000 },
    async ([name, file], context) => {
      context.skip(WINDOWS && ZSH_ONLY.has(file), NO_ZSH_UNTIL_TICKET_15)
      starts.set(name, (starts.get(name) ?? 0) + 1)
      const { run } = await runInEmptyHome(file, FILE_TIMEOUT_MS)
      const problem = failure(file, run, FILE_TIMEOUT_MS)
      context.expect(problem === null, problem ?? '').toBe(true)
    },
  )

  it('kills a file past its limit with every process it started, and removes its HOME', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-hang-')))
    try {
      // A child in the background and one in the front, both holding the output open.
      const script = join(dir, 'hang.test.sh')
      writeFileSync(script, 'echo started\nsleep 30 &\nsleep 30\n')
      const begun = Date.now()
      const { run, home } = await runInEmptyHome(script, 1_000)
      expect(Date.now() - begun).toBeLessThan((1_000 + CLOSE_GRACE_MS + 3_000) * timeScale)
      expect(failure(script, run, 1_000)).toMatch(/did not finish: it was killed after 1 s\nstarted/)
      expect(existsSync(home)).toBe(false)
      expect(run.pid).toBeDefined()
      // No process of the run's group is left: signal 0 to the group fails with ESRCH.
      if (!WINDOWS) expect(() => process.kill(-(run.pid ?? 0), 0)).toThrow()
    } finally {
      removeTestTree(dir)
    }
  })

  it('judges a file that exited 0 before its limit by its exit code, and ends the child it left', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-left-')))
    try {
      // bash exits at once; the child holds the output past the 1 s limit, until the grace ends.
      const script = join(dir, 'left.test.sh')
      writeFileSync(script, 'echo done\nsleep 30 &\nexit 0\n')
      const begun = Date.now()
      const { run } = await runInEmptyHome(script, 1_000)
      const took = Date.now() - begun
      // The 1 s limit stopped counting when bash exited; the case waited out the grace instead.
      expect(took).toBeGreaterThanOrEqual(CLOSE_GRACE_MS - 100)
      expect(took).toBeLessThan((CLOSE_GRACE_MS + 3_000) * timeScale)
      expect(failure(script, run, 1_000)).toBeNull()
      expect(run.output).toContain('done')
      if (!WINDOWS) expect(() => process.kill(-(run.pid ?? 0), 0)).toThrow()
    } finally {
      removeTestTree(dir)
    }
  })

  it('kills the runs that have not returned when the worker stops', async () => {
    // Every shell test case has returned by now: the kill below reaches only this run.
    expect(liveRuns.size).toBe(0)
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-stop-')))
    try {
      const started = join(dir, 'started')
      const script = join(dir, 'stop.test.sh')
      writeFileSync(script, `sleep 30 &\n: > '${started.replaceAll('\\', '/')}'\nsleep 30\n`)
      const running = runInEmptyHome(script, 60_000)
      await vi.waitFor(() => expect(existsSync(started)).toBe(true), { timeout: 10_000 * timeScale })
      const begun = Date.now()
      killLiveRuns()
      const { run, home } = await running
      expect(Date.now() - begun).toBeLessThan(3_000 * timeScale)
      expect(run.timedOut).toBe(false)
      expect(run.status).not.toBe(0)
      expect(liveRuns.size).toBe(0)
      expect(existsSync(home)).toBe(false)
      if (!WINDOWS) expect(() => process.kill(-(run.pid ?? 0), 0)).toThrow()
    } finally {
      removeTestTree(dir)
    }
  })

  afterAll(() => {
    killLiveRuns()
    unwatchStops()
    const repeated = [...starts].filter(([, count]) => count > 1).map(([name]) => name)
    expect(repeated, 'shell test files started more than once in this run').toEqual([])
  })
})
