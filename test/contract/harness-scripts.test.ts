// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh, ticket worfy-harness/02)
// run here, one case per file, so they run in `pnpm test`: in CI on Linux and in the gate.
// Each file runs as `bash <file>` with HOME in a fresh empty temporary directory, so no test can
// read or write the owner's real ~/.claude (USERPROFILE is the same folder: a Node script on
// Windows takes the home folder from it, not from HOME); the test finds the script it checks next to itself
// (harness/), not under $HOME/.claude. Git in an empty HOME has no identity, so the author and
// committer come from the environment.
// On Windows `bash` is Git Bash, found explicitly (test/git-bash.ts): the first bash.exe on the PATH
// may be the WSL launcher.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

const tail = (text: string, lines: number): string => text.split('\n').slice(-lines).join('\n')

// What a red shell test printed, bounded: every "FAIL <check>" line its bad() wrote (the first 30), then the
// last 20 lines. The tail alone can miss the failed check: a file prints its FAIL lines where the check runs,
// and later cases fill the tail.
const MAX_FAIL_LINES = 30
const TAIL_LINES = 20
const failureReport = (output: string): string => {
  const failed = output.split('\n').filter((line) => line.startsWith('FAIL '))
  const shown = failed.slice(0, MAX_FAIL_LINES)
  if (failed.length > shown.length) shown.push(`... and ${failed.length - shown.length} more FAIL lines`)
  const head = shown.length ? shown.join('\n') : '(no FAIL line)'
  return `${head}\n--- last ${TAIL_LINES} lines:\n${tail(output, TAIL_LINES)}`
}

// The qmd scripts of the Harness and their test are zsh scripts; Windows has no zsh.
const NO_ZSH_UNTIL_TICKET_15 = 'qmd scripts are zsh until worfy-windows ticket 15'
const ZSH_ONLY = new Set([join(HARNESS, 'bin', 'tests', 'qmd.test.sh')])

describe('harness shell tests', () => {
  it(`finds at least ${MIN_TESTS} test files under harness/{bin,hooks}/tests`, () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(MIN_TESTS)
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
  })

  // Commands the Harness scripts need. The shell tests do not skip a check when one is missing,
  // they fail on it; this case names the missing command directly (ubuntu-latest has no zsh).
  it.for(['bash', 'zsh', 'jq', 'git', 'node'])('%s is on PATH', (command, context) => {
    context.skip(WINDOWS && command === 'zsh', NO_ZSH_UNTIL_TICKET_15)
    const found = spawnSync(WINDOWS ? gitBash() : 'sh', ['-c', `command -v ${command}`], { encoding: 'utf8' })
    expect(found.status, `${command} is not installed`).toBe(0)
  })

  it.for(testFiles.map((file): [string, string] => [file.slice(HARNESS.length + 1), file]))(
    '%s exits 0 with an empty HOME',
    { timeout: FILE_TIMEOUT_MS + 10_000 },
    ([, file], context) => {
      context.skip(WINDOWS && ZSH_ONLY.has(file), NO_ZSH_UNTIL_TICKET_15)
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
        const run = spawnSync(gitBash(), [file], {
          cwd: home,
          env,
          encoding: 'utf8',
          input: '',
          timeout: FILE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        })
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
        expect(run.error, `${file} did not finish: ${String(run.error)}\n${failureReport(output)}`).toBeUndefined()
        expect(run.status, `${file} exited ${String(run.status)}:\n${failureReport(output)}`).toBe(0)
      } finally {
        removeTestTree(home)
      }
    },
  )
})
