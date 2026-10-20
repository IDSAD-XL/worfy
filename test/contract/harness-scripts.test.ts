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
import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBash } from '../git-bash'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const TEST_DIRS = [join(HARNESS, 'bin', 'tests'), join(HARNESS, 'hooks', 'tests')]

// The ticket imports 5 tests under bin/tests and 3 under hooks/tests.
const MIN_TESTS = 8
const WINDOWS = process.platform === 'win32'
// One file takes a few seconds; the limit is for a test that hangs (a script waiting on stdin).
// On Windows every process start is slow: profile.test.sh and skill-blocks.test.sh alone take
// 140-170 s there, so 120 s cut off files that would pass.
const FILE_TIMEOUT_MS = WINDOWS ? 300_000 : 120_000

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

// The qmd scripts of the Harness and their test are zsh scripts; Windows has no zsh.
const NO_ZSH_UNTIL_TICKET_15 = 'qmd scripts are zsh until worfy-windows ticket 15'
const ZSH_ONLY = new Set([join(HARNESS, 'bin', 'tests', 'qmd.test.sh')])

type Run = { status: number | null; signal: NodeJS.Signals | null; error?: Error; timedOut: boolean; output: string }

/**
 * Runs `bash <file>` and resolves when it has exited and closed its output, as spawnSync returned
 * before: stdin is empty, a run past `timeoutMs` is killed with SIGKILL.
 */
function runShellTest(bash: string, file: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let error: Error | undefined
    const child = spawn(bash, [file], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    // A script that exits without reading stdin closes the pipe under the write: not a failure.
    child.stdin.on('error', () => {})
    child.stdin.end()
    child.on('error', (spawnError) => {
      error = spawnError
    })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      const output = `${Buffer.concat(stdout).toString('utf8')}${Buffer.concat(stderr).toString('utf8')}`
      resolve({ status, signal, error, timedOut, output })
    })
  })
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
        const run = await runShellTest(gitBash(), file, home, env, FILE_TIMEOUT_MS)
        const ended = run.timedOut ? `was killed after ${FILE_TIMEOUT_MS / 1000} s` : `exited ${String(run.status)}`
        context.expect(run.error, `${file} did not start: ${String(run.error)}\n${tail(run.output, 40)}`).toBeUndefined()
        context.expect(run.timedOut, `${file} did not finish: it ${ended}\n${tail(run.output, 40)}`).toBe(false)
        context.expect(run.status, `${file} ${ended}${run.signal ? ` (${run.signal})` : ''}:\n${tail(run.output, 40)}`).toBe(0)
      } finally {
        removeTestTree(home)
      }
    },
  )

  afterAll(() => {
    const repeated = [...starts].filter(([, count]) => count > 1).map(([name]) => name)
    expect(repeated, 'shell test files started more than once in this run').toEqual([])
  })
})
