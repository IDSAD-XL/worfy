// The failure records the reporters write for the Harness gate (test/failure-records.ts): the vitest
// reporter (test/failures-reporter.ts) and the Playwright reporter (test/e2e/failures-reporter.ts), fed
// with fake test results, each with a temporary file as GATE_FAILURES_FILE.
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import { checkRunRecord } from '../../harness/hooks/gate-failures.mjs'
import PlaywrightFailuresReporter, { failureRecords as playwrightRecords, playwrightCli } from '../e2e/failures-reporter'
import { ERROR_CHARS, writeFailureRecords, type FailureRecord } from '../failure-records'
import VitestFailuresReporter, { VITEST_SCRIPT, vitestRerun } from '../failures-reporter'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-failures-report-')))
  dirs.push(dir)
  return dir
}

/** A temporary GATE_FAILURES_FILE, set for this test; never the gate's own file of the run. */
function recordsFile(): string {
  const file = join(tempDir(), 'run.failures.jsonl')
  vi.stubEnv('GATE_FAILURES_FILE', file)
  return file
}
const readRecords = (file: string): FailureRecord[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FailureRecord)
    : []

/** What was written on stdout and on stderr while `run` ran. */
function output(run: () => void): { stdout: string; stderr: string } {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => out.push(String(chunk)) > 0)
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => err.push(String(chunk)) > 0)
  try {
    run()
  } finally {
    vi.restoreAllMocks()
  }
  return { stdout: out.join(''), stderr: err.join('') }
}

/** The run file the gate makes of the lines: each line with its step must pass the gate's own check. */
function asRunFile(records: FailureRecord[]): Record<string, unknown> {
  return {
    version: 1,
    kind: 'run',
    run: '1a2b3c4d/2026-11-04T10-00-00Z-4242',
    at: '2026-11-04T10:00:00Z',
    key: 'worfy',
    profile: 'full',
    head: 'abc1234',
    outcome: 'red',
    computer: { id: '0a1b2c3d', name: 'mac', platform: 'darwin' },
    dirty: false,
    failures: records.map((record) => ({ step: 'worfy/.:test', ...record })),
  }
}

// An error as vitest serializes it: coloured, with a stack of paths in the home folder below the first line.
const HOME = homedir()
const ERROR = {
  name: 'AssertionError',
  message: '\u001b[31mexpected 1 to be 2\u001b[39m // Object.is equality\n\n- Expected\n+ Received',
  stack: `AssertionError: expected 1 to be 2\n    at ${join(HOME, 'project', 'test', 'unit', 'a.test.ts')}:13:5`,
}

interface FakeTest {
  fullName: string
  line?: number
  state: 'passed' | 'failed' | 'skipped'
  retryCount?: number
  flaky?: boolean
  duration?: number
}

/** A vitest test file with these tests and, when given, the errors of the file itself (an import that threw). */
function vitestModule(file: string, tests: FakeTest[], moduleErrors: unknown[] = []): TestModule {
  const cases = tests.map(({ fullName, line, state, retryCount, flaky, duration }) => ({
    fullName,
    location: line === undefined ? undefined : { line, column: 3 },
    diagnostic: () => (state === 'skipped' ? undefined : { retryCount: retryCount ?? 0, flaky: flaky ?? false, duration: duration ?? 1 }),
    result: () => (state === 'failed' ? { state, errors: [ERROR] } : { state, errors: undefined }),
  }))
  return { relativeModuleId: file, children: { allTests: () => cases.values() }, errors: () => moduleErrors } as unknown as TestModule
}

describe('the vitest failures reporter', () => {
  it('writes one record for the failed test, none for the passed and the flaky one', () => {
    const file = recordsFile()
    const modules = [
      vitestModule('test\\unit\\a.test.ts', [
        { fullName: 'group > fails', line: 12, state: 'failed', duration: 41.6 },
        { fullName: 'group > passes', line: 20, state: 'passed' },
        { fullName: 'group > passed on the retry', line: 30, state: 'passed', retryCount: 1, flaky: true },
      ]),
    ]
    expect(output(() => new VitestFailuresReporter().onTestRunEnd(modules, []))).toEqual({ stdout: '', stderr: '' })
    const records = readRecords(file)
    expect(records).toEqual([
      {
        runner: 'vitest',
        file: 'test/unit/a.test.ts',
        line: 12,
        name: 'group > fails',
        test: 'vitest test/unit/a.test.ts > group > fails',
        ms: 42,
        error: 'AssertionError: expected 1 to be 2 // Object.is equality',
        attempt: 1,
        rerun: ['node', 'scripts/vitest-electron.mjs', 'test/unit/a.test.ts', '-t', '^group > fails$'],
      },
    ])
    expect(records[0]!.error).not.toContain(HOME)
    expect(checkRunRecord(asRunFile(records))).toBeNull()
  })

  it('a file that failed to import gives a record with name null that reruns the whole file', () => {
    const file = recordsFile()
    const modules = [vitestModule('test/unit/broken.test.ts', [], [{ name: 'SyntaxError', message: 'Unexpected token (3:7)\n  at …' }])]
    new VitestFailuresReporter().onTestRunEnd(modules, [])
    const records = readRecords(file)
    expect(records).toEqual([
      {
        runner: 'vitest',
        file: 'test/unit/broken.test.ts',
        line: null,
        name: null,
        test: null,
        ms: null,
        error: 'SyntaxError: Unexpected token (3:7)',
        attempt: 1,
        rerun: ['node', 'scripts/vitest-electron.mjs', 'test/unit/broken.test.ts'],
      },
    ])
    expect(checkRunRecord(asRunFile(records))).toBeNull()
  })

  it('errors of the run outside every file give one record with file null and no rerun', () => {
    const file = recordsFile()
    const modules = [vitestModule('test/unit/a.test.ts', [{ fullName: 'passes', state: 'passed' }])]
    const unhandled = [
      { name: 'Error', message: 'Unhandled rejection: boom' },
      { name: 'Error', message: 'another' },
    ]
    new VitestFailuresReporter().onTestRunEnd(modules, unhandled as never)
    const records = readRecords(file)
    expect(records).toMatchObject([{ runner: 'vitest', file: null, name: null, test: null, error: 'Unhandled rejection: boom', rerun: null }])
    expect(checkRunRecord(asRunFile(records))).toBeNull()
  })

  it('the attempt of a test CI retried is one more than its retries', () => {
    const file = recordsFile()
    new VitestFailuresReporter().onTestRunEnd([vitestModule('test/unit/a.test.ts', [{ fullName: 'fails twice', line: 3, state: 'failed', retryCount: 1 }])], [])
    expect(readRecords(file).map((r) => r.attempt)).toEqual([2])
  })

  it('escapes the name for the regular expression of -t and anchors it', () => {
    expect(vitestRerun('test/unit/a.test.ts', 'opens (the) [file] a.b *+? $1 ^x | y \\ z')).toEqual([
      'node',
      VITEST_SCRIPT,
      'test/unit/a.test.ts',
      '-t',
      '^opens \\(the\\) \\[file\\] a\\.b \\*\\+\\? \\$1 \\^x \\| y \\\\ z$',
    ])
    const pattern = new RegExp(vitestRerun('f', 'a (b)')[4]!)
    expect(pattern.test('a (b)')).toBe(true)
    expect(pattern.test('a (b) c')).toBe(false)
  })
})

/** A Playwright test ending with these attempts (statuses); its outcome as Playwright would compute it. */
interface FakeSpec {
  title: string
  describe?: string
  outcome: ReturnType<TestCase['outcome']>
  statuses: TestResult['status'][]
  tags?: string[]
}

function playwrightRoot(cwd: string, tests: FakeSpec[]): Suite {
  const root = { type: 'root', title: '' } as Suite
  const project = { type: 'project', title: '', parent: root } as Suite
  const file = { type: 'file', title: 'test/e2e/a.spec.ts', parent: project } as Suite
  const cases = tests.map(({ title, describe: block, outcome, statuses, tags }, index) => ({
    title,
    parent: block === undefined ? file : ({ type: 'describe', title: block, parent: file } as Suite),
    location: { file: join(cwd, 'test', 'e2e', 'a.spec.ts'), line: 10 + index, column: 3 },
    expectedStatus: 'passed',
    tags: tags ?? [],
    outcome: () => outcome,
    results: statuses.map((status, retry) => ({
      retry,
      status,
      duration: 1000 * (retry + 1) + 0.4,
      error: status === 'passed' || status === 'skipped' ? undefined : { message: `\u001b[31mattempt ${retry + 1} failed\u001b[39m\n    at ${join(HOME, 'x.ts')}:1:1` },
      errors: [],
    })),
  }))
  return Object.assign(root, { allTests: () => cases as unknown as TestCase[] })
}

function runPlaywrightReporter(root: Suite, cwd: string): { stdout: string; stderr: string } {
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  const reporter = new PlaywrightFailuresReporter()
  return output(() => {
    reporter.onBegin({} as never, root)
    reporter.onEnd()
  })
}

describe('the Playwright failures reporter', () => {
  it('writes one record for the unexpected test, with the attempt and time of its last attempt', () => {
    const file = recordsFile()
    const root = playwrightRoot(REPO, [
      { title: 'opens the canvas', describe: 'Canvas', outcome: 'unexpected', statuses: ['failed', 'timedOut'] },
      { title: 'passed on the retry', outcome: 'flaky', statuses: ['failed', 'passed'] },
      { title: 'quarantined', outcome: 'skipped', statuses: ['skipped'] },
    ])
    expect(runPlaywrightReporter(root, REPO)).toEqual({ stdout: '', stderr: '' })
    const records = readRecords(file)
    expect(records).toEqual([
      {
        runner: 'playwright',
        file: 'test/e2e/a.spec.ts',
        line: 10,
        name: 'Canvas > opens the canvas',
        test: 'playwright test/e2e/a.spec.ts > Canvas > opens the canvas',
        ms: 2000,
        error: 'attempt 2 failed',
        attempt: 2,
        rerun: ['node', expect.any(String), 'test', 'test/e2e/a.spec.ts:10'],
      },
    ])
    expect(checkRunRecord(asRunFile(records))).toBeNull()
  })

  it('reruns a @packaged test with the flags of pnpm test:package', () => {
    const root = playwrightRoot(REPO, [{ title: 'starts', outcome: 'unexpected', statuses: ['failed'], tags: ['@packaged'] }])
    expect(playwrightRecords(root, REPO, join(REPO, 'cli.js'))[0]!.rerun).toEqual([
      'node',
      'cli.js',
      'test',
      'test/e2e/a.spec.ts:10',
      '--output',
      'test-results/package',
      '--grep',
      '@packaged',
      '--workers=1',
    ])
  })
})

describe('the rerun argv', () => {
  const vitestArgv = () => vitestRerun('test/unit/a.test.ts', 'a')
  const playwrightArgv = () => playwrightRecords(playwrightRoot(REPO, [{ title: 'a', outcome: 'unexpected', statuses: ['failed'] }]), REPO)[0]!.rerun!

  it('starts with node, then a file of the repository', () => {
    for (const argv of [vitestArgv(), playwrightArgv()]) {
      expect(argv[0]).toBe('node')
      expect(argv[1]).not.toMatch(/^(\.\.|\/)|\\/)
      expect(existsSync(join(REPO, argv[1]!)), argv[1]).toBe(true)
    }
    expect(join(REPO, playwrightArgv()[1]!)).toBe(playwrightCli())
  })

  it('is the same on win32: no shell, nothing a shell would have to read', () => {
    const before = [vitestArgv(), playwrightArgv()]
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect([vitestArgv(), playwrightArgv()]).toEqual(before)
  })
})

describe('without GATE_FAILURES_FILE', () => {
  it('neither reporter writes or prints anything', () => {
    const dir = tempDir()
    vi.stubEnv('GATE_FAILURES_FILE', undefined)
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    const vitest = output(() => new VitestFailuresReporter().onTestRunEnd([vitestModule('test/unit/a.test.ts', [{ fullName: 'fails', state: 'failed' }])], []))
    const playwright = runPlaywrightReporter(playwrightRoot(dir, [{ title: 'fails', outcome: 'unexpected', statuses: ['failed'] }]), dir)
    expect({ vitest, playwright }).toEqual({ vitest: { stdout: '', stderr: '' }, playwright: { stdout: '', stderr: '' } })
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('the failure records file', () => {
  it('a file that cannot be written is one line on stderr and does not fail the run', () => {
    const file = join(tempDir(), 'missing', 'run.failures.jsonl')
    vi.stubEnv('GATE_FAILURES_FILE', file)
    const { stdout, stderr } = output(() =>
      new VitestFailuresReporter().onTestRunEnd([vitestModule('test/unit/a.test.ts', [{ fullName: 'fails', state: 'failed' }])], []),
    )
    expect(stdout).toBe('')
    expect(stderr).toMatch(/^failure records: .*run\.failures\.jsonl was not written: [^\n]+\n$/)
  })

  it('appends to what an earlier script wrote', () => {
    const file = recordsFile()
    const record = (error: string): FailureRecord => ({ runner: 'vitest', file: 'f', line: 1, name: 'n', test: 'vitest f > n', ms: 1, error, attempt: 1, rerun: null })
    writeFailureRecords([record('first')])
    writeFailureRecords([record('second')])
    expect(readRecords(file).map((r) => r.error)).toEqual(['first', 'second'])
  })

  it('cuts a long error to the length the gate keeps', () => {
    const file = recordsFile()
    const modules = [vitestModule('test/unit/a.test.ts', [], [{ name: 'Error', message: 'y'.repeat(500) }])]
    new VitestFailuresReporter().onTestRunEnd(modules, [])
    const error = readRecords(file)[0]!.error
    expect([...error]).toHaveLength(ERROR_CHARS)
    expect(error.endsWith('…')).toBe(true)
  })
})
