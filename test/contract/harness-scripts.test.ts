// The shell tests of the Harness (harness/{bin,hooks}/tests/*.test.sh, ticket worfy-harness/02)
// run here, one case per file, so they run in `pnpm test`: in CI on Linux and in the gate.
// Each file runs as `bash <file>` with HOME in a fresh empty temporary directory, so no test can
// read or write the owner's real ~/.claude (USERPROFILE is the same folder: a Node script on
// Windows takes the home folder from it, not from HOME); the test finds the script it checks next to itself
// (harness/), not under $HOME/.claude. Git in an empty HOME has no identity, so the author and
// committer come from the environment.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const TEST_DIRS = [join(HARNESS, 'bin', 'tests'), join(HARNESS, 'hooks', 'tests')]

// The ticket imports 5 tests under bin/tests and 3 under hooks/tests.
const MIN_TESTS = 8
// One file takes a few seconds; the limit is for a test that hangs (a script waiting on stdin).
const FILE_TIMEOUT_MS = 120_000

const testFiles = TEST_DIRS.flatMap((dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.test.sh'))
        .sort()
        .map((name) => join(dir, name))
    : [],
)

const tail = (text: string, lines: number): string => text.split('\n').slice(-lines).join('\n')

describe('harness shell tests', () => {
  it(`finds at least ${MIN_TESTS} test files under harness/{bin,hooks}/tests`, () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(MIN_TESTS)
  })

  // Commands the Harness scripts need. The shell tests do not skip a check when one is missing,
  // they fail on it; this case names the missing command directly (ubuntu-latest has no zsh).
  it.each(['bash', 'zsh', 'jq', 'git', 'node'])('%s is on PATH', (command) => {
    const found = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' })
    expect(found.status, `${command} is not installed`).toBe(0)
  })

  it.each(testFiles.map((file) => [file.slice(HARNESS.length + 1), file]))(
    '%s exits 0 with an empty HOME',
    (_name, file) => {
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
        const run = spawnSync('bash', [file], {
          cwd: home,
          env,
          encoding: 'utf8',
          input: '',
          timeout: FILE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        })
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
        expect(run.error, `${file} did not finish: ${String(run.error)}\n${tail(output, 40)}`).toBeUndefined()
        expect(run.status, `${file} exited ${String(run.status)}:\n${tail(output, 40)}`).toBe(0)
      } finally {
        removeTestTree(home)
      }
    },
    FILE_TIMEOUT_MS + 10_000,
  )
})
