// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh, ticket worfy-harness/02)
// run here, one case per file, so they run in `pnpm test`: in CI on Linux and in the gate. The test
// files test/contract/harness-scripts-<n>.test.ts call harnessScripts(n), and each runs its own share
// of the shell tests (inFile, test/harness-shell-tests.ts). As one file they took most of the wall
// time of a full run on their own at its end: 1367 s of 1542 s on the owner's Windows PC (2026-10-29),
// while the other workers stood idle. vitest runs the files on workers of their own.
// Each file runs as `bash <file>` with HOME in a fresh empty temporary directory, so no test can
// read or write the owner's real ~/.claude (USERPROFILE is the same folder: a Node script on
// Windows takes the home folder from it, not from HOME); the test finds the script it checks next to itself
// (harness/), not under $HOME/.claude. Git in an empty HOME has no identity, so the author and
// committer come from the environment.
// On Windows `bash` is Git Bash, found explicitly (test/git-bash.ts): the first bash.exe on the PATH
// may be the WSL launcher.
//
// Inside a file the shell tests run a few at a time (it.concurrent), not one after another. vitest
// runs files in parallel but the tests of one file in sequence, so the serial loop made the one file
// take the whole wall time of `pnpm test` (517 s of 519 s on the Mac, 2026-10-20). How many run at
// once is the `maxConcurrency` of the contract project (vitest.config.ts), per file; a waiting case
// has not started, so its time limit counts from its own start, not from the start of the file.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi, type TestContext } from 'vitest'
import { CI_RETRIES } from './flaky'
import { gitBash } from './git-bash'
import { HARNESS_SCRIPTS_FILES, inFile, inPart, MEASURED_SECONDS, parsePart, shareOf, shellTests, startOrder } from './harness-shell-tests'
import { removeTestTree } from './remove'
import { timeScale } from './time-scale'

const REPO = join(__dirname, '..')
const HARNESS = join(REPO, 'harness')

// The ticket imports 5 tests under bin/tests and 3 under hooks/tests.
const MIN_TESTS = 8
const WINDOWS = process.platform === 'win32'
// The limit is for a test that hangs (a script waiting on stdin). On Windows every process start is
// slow: alone on the owner's PC wave-gate.test.sh takes 269-317 s, profile and skill-blocks 140-170 s,
// and five files at once take longer, so 300 s cut off wave-gate.test.sh there (2026-10-21).
// With the lock-takeover cases wave-gate.test.sh takes 348 s alone and went past 600 s in a full
// run (2026-10-22), hence 900 s. The cost: a hanging .test.sh on Windows is cut off 5 min later.
// On the GitHub macOS runner profile.test.sh (56-116 s) and skill-blocks.test.sh (71-113 s) were cut
// off at 120 s (CI runs 40602360006 and 40606566772, 2026-10-28); they are split by theme since, as
// wave-gate.test.sh was, and the limit stays.
const FILE_TIMEOUT_MS = WINDOWS ? 900_000 : 120_000

const names = shellTests(HARNESS)
const MEASURED = MEASURED_SECONDS[WINDOWS ? 'windows' : 'other']

/** The shell tests file `file` of HARNESS_SCRIPTS_FILES runs: see shareOf. A misspelt part throws here, and the file fails. */
const shareOfFile = (file: number): string[] =>
  shareOf(names, file, HARNESS_SCRIPTS_FILES.length, parsePart(process.env.HARNESS_SCRIPTS_PART), MEASURED)

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
const ZSH_ONLY = new Set(['bin/tests/qmd.test.sh'])

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

/**
 * The environment of a shell test file run in the empty `home`. The temporary folder is the
 * system one under all three names: without TEMP and TMP, Windows takes the temp folder of Git
 * Bash and of every Windows program it starts from USERPROFILE, which is `home`, removed when the
 * run returns. A Git Bash started first in the run would then mount /tmp there for every other one
 * (test/global-setup-git-bash.ts).
 */
function emptyHomeEnv(home: string): NodeJS.ProcessEnv {
  const tmp = process.env.TMPDIR ?? tmpdir()
  return {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    // epic-status falls back to en_US.UTF-8, which a minimal Linux image may lack; the
    // warning about it would land in the output the test compares.
    LANG: process.env.LANG ?? 'C.UTF-8',
    GIT_AUTHOR_NAME: 'Harness Test',
    GIT_AUTHOR_EMAIL: 'harness-test@example.invalid',
    GIT_COMMITTER_NAME: 'Harness Test',
    GIT_COMMITTER_EMAIL: 'harness-test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

/** Runs one shell test file as the cases do: in a new empty HOME, removed when the run returns. */
async function runInEmptyHome(file: string, timeoutMs: number): Promise<{ run: Run; home: string }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-home-')))
  try {
    return { run: await runShellTest(gitBash(), file, home, emptyHomeEnv(home), timeoutMs), home }
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

// How long a case waits for the process group of a killed run to end. The kill is a SIGKILL to the
// group: it cannot be caught, so the wait is for the kernel, not for the script.
const GROUP_END_MS = 2_000

/** The members of process group `pgid` that still run: their pid and state from /proc (Linux only). */
function runningMembers(pgid: number): string[] {
  const running: string[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    let stat: string
    try {
      stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
    } catch {
      continue // The process ended between the listing and the read.
    }
    // After the command name in parentheses: state, ppid, pgrp, ...
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (Number(pgrp) === pgid && state !== 'Z') running.push(`${entry} (${state})`)
  }
  return running
}

/**
 * Waits until no process of the run's group runs any more (macOS and Linux); fails naming what
 * still runs. Signal 0 to the group fails with ESRCH once every member is gone. Right after the
 * SIGKILL it can still succeed: on Linux a killed member keeps running until the kernel schedules
 * its exit, and then stays a zombie until its new parent (pid 1 or a subreaper) reaps it. Under
 * load either takes long enough for an immediate probe to see the group (CI runs 39867148919).
 * A zombie runs nothing, so on Linux a group of zombies alone has ended too.
 */
async function expectGroupEnded(pgid: number): Promise<void> {
  // Group 0 is the caller's own group: a run without a pid has no group to check.
  expect(pgid).toBeGreaterThan(0)
  await vi.waitFor(
    () => {
      try {
        process.kill(-pgid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
        throw error
      }
      const running = process.platform === 'linux' ? runningMembers(pgid) : ['the group answers signal 0']
      expect(running, `processes of the run's group ${pgid} still run`).toEqual([])
    },
    { timeout: GROUP_END_MS * timeScale, interval: 10 },
  )
}

/**
 * The cases of test file `file` (from 1) of HARNESS_SCRIPTS_FILES: its share of the shell tests, and in
 * file 1 also the cases that check this runner.
 */
export function harnessScripts(file: number): void {
  const toRun = shareOfFile(file)
  const count = HARNESS_SCRIPTS_FILES.length
  // How many times each shell test of this file started in this run: every one once, and once more for
  // each retry CI allows (CI_RETRIES, test/flaky.ts; afterAll below fails on any further start). A
  // retried one is printed as FLAKY when it passes, and it may take FILE_TIMEOUT_MS twice: 120 s more
  // on Linux and macOS, 900 s more on Windows.
  const starts = new Map<string, number>()

  describe(`harness shell tests, file ${file} of ${count}`, () => {
    it(`runs its share of the shell tests (part ${process.env.HARNESS_SCRIPTS_PART || 'none'}), in the start order`, () => {
      expect(Number.isInteger(file) && file >= 1 && file <= count, `file ${file} of ${count}`).toBe(true)
      const part = parsePart(process.env.HARNESS_SCRIPTS_PART)
      const expected = part ? (file === 1 ? inPart(names, part) : []) : inFile(names, file, count, MEASURED)
      expect([...toRun].sort()).toEqual([...expected].sort())
      expect(toRun).toEqual(startOrder(toRun, MEASURED))
      // A file meant to run shell tests runs at least one, so a Windows job of a part (file 1 with
      // HARNESS_SCRIPTS_PART) that would run none is red, not green with only these cases passing.
      if (!part || file === 1) expect(toRun.length, `shell tests of file ${file}, part ${process.env.HARNESS_SCRIPTS_PART || 'none'}`).toBeGreaterThan(0)
    })

    // The cases that check this runner, not a shell test: file 1 holds them, once per run.
    const runnerCases = (): void => {
      it(`finds at least ${MIN_TESTS} test files under harness/{bin,hooks}/tests`, () => {
        expect(names.length).toBeGreaterThanOrEqual(MIN_TESTS)
      })

      it(`gives every shell test file exactly one case in the ${count} files, with and without a part`, () => {
        for (const part of [undefined, { index: 1, count: 2 }, { index: 2, count: 2 }]) {
          const all = Array.from({ length: count }, (_, at) => shareOf(names, at + 1, count, part, MEASURED)).flat()
          expect(new Set(all).size, JSON.stringify(part)).toBe(all.length)
          expect([...all].sort(), JSON.stringify(part)).toEqual(part ? inPart(names, part) : names)
        }
      })

      it('the files test/contract/harness-scripts-<n>.test.ts are HARNESS_SCRIPTS_FILES, and each runs its own share', () => {
        const found = readdirSync(join(REPO, 'test', 'contract')).filter((name) => /^harness-scripts.*\.test\.ts$/.test(name))
        expect(found.map((name) => `test/contract/${name}`).sort()).toEqual([...HARNESS_SCRIPTS_FILES].sort())
        HARNESS_SCRIPTS_FILES.forEach((path, at) => {
          expect(readFileSync(join(REPO, path), 'utf8'), path).toContain(`\nharnessScripts(${at + 1})\n`)
        })
      })

      it('measures only shell tests that exist', () => {
        for (const measured of Object.values(MEASURED_SECONDS)) expect(Object.keys(measured).filter((name) => !names.includes(name))).toEqual([])
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

      it('gives a shell test the system temp folder as TMPDIR, TEMP and TMP, outside the HOME it removes', () => {
        const home = join(tmpdir(), 'worfy-harness-home-x')
        const env = emptyHomeEnv(home)
        expect(env.TMPDIR).toBe(process.env.TMPDIR ?? tmpdir())
        expect(env.TEMP).toBe(env.TMPDIR)
        expect(env.TMP).toBe(env.TMPDIR)
        expect(env.TEMP?.startsWith(home)).toBe(false)
      })

      // Git Bash mounts /tmp once for all its processes, on the temp folder of the first one; the
      // globalSetup test/global-setup-git-bash.ts starts that first one with the system temp folder.
      it('Git Bash mounts /tmp on the system temp folder even when its TEMP and TMP name another one', (context) => {
        context.skip(!WINDOWS, 'the /tmp mount of Git Bash exists on Windows only')
        const home = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-home-')))
        try {
          const other = join(home, 'other-temp')
          const run = spawnSync(gitBash(), ['-c', 'cygpath -w /tmp'], { encoding: 'utf8', env: { ...emptyHomeEnv(home), TEMP: other, TMP: other } })
          expect(run.stderr).not.toContain('could not find /tmp')
          expect(run.status).toBe(0)
          const spelled = (path: string): string => realpathSync.native(path.trim().replace(/[\\/]+$/, '')).toLowerCase()
          expect(spelled(run.stdout)).toBe(spelled(tmpdir()))
        } finally {
          removeTestTree(home)
        }
      })

      // Commands the Harness scripts need. The shell tests do not skip a check when one is missing,
      // they fail on it; this case names the missing command directly (ubuntu-latest has no zsh).
      it.for(['bash', 'zsh', 'jq', 'git', 'node'])('%s is on PATH', (command, context) => {
        context.skip(WINDOWS && command === 'zsh', NO_ZSH_UNTIL_TICKET_15)
        const found = spawnSync(WINDOWS ? gitBash() : 'sh', ['-c', `command -v ${command}`], { encoding: 'utf8' })
        expect(found.status, `${command} is not installed`).toBe(0)
      })
    }
    if (file === 1) runnerCases()

    const runFile = async (name: string, context: TestContext): Promise<void> => {
      context.skip(WINDOWS && ZSH_ONLY.has(name), NO_ZSH_UNTIL_TICKET_15)
      starts.set(name, (starts.get(name) ?? 0) + 1)
      const path = join(HARNESS, name)
      const { run } = await runInEmptyHome(path, FILE_TIMEOUT_MS)
      const problem = failure(path, run, FILE_TIMEOUT_MS)
      // vitest prints a test's error only when its retry in CI fails too: a failed first try and a passed retry
      // leave a FLAKY line alone (test/flaky.ts), with no word of the check that failed. A failed try that a retry
      // follows is in the log here, written directly, as test/quarantine.ts writes its lines; the last try's error
      // vitest prints itself.
      const tried = starts.get(name) ?? 1
      if (problem !== null && tried <= CI_RETRIES) process.stderr.write(`[harness-scripts] ${name}, try ${tried} of ${CI_RETRIES + 1}, failed: ${problem}\n`)
      context.expect(problem === null, problem ?? '').toBe(true)
    }
    it.concurrent.for(toRun)(
      '%s exits 0 with an empty HOME',
      { timeout: FILE_TIMEOUT_MS + 10_000 },
      (name, context) => runFile(name, context),
    )

    // After the shell tests of the file: the last of these needs every run of the file to have returned.
    const runnerCasesAfter = (): void => {
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
          // No process of the run's group is left running.
          if (!WINDOWS) await expectGroupEnded(run.pid ?? 0)
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
          if (!WINDOWS) await expectGroupEnded(run.pid ?? 0)
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
          if (!WINDOWS) await expectGroupEnded(run.pid ?? 0)
        } finally {
          removeTestTree(dir)
        }
      })
    }
    if (file === 1) runnerCasesAfter()

    afterAll(() => {
      killLiveRuns()
      unwatchStops()
      const repeated = [...starts].filter(([, count]) => count > 1 + CI_RETRIES).map(([name]) => name)
      expect(repeated, 'shell test files started more than once in this run').toEqual([])
    })
  })
}
