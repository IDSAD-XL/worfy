// The FLAKY report of a test that passed only on the retry CI allows (test/flaky.ts): the vitest
// reporter (test/flaky-reporter.ts) and the Playwright reporter (test/e2e/flaky-reporter.ts), fed
// with fake test results.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Suite, TestCase } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule } from 'vitest/node'
import PlaywrightFlakyReporter from '../e2e/flaky-reporter'
import VitestFlakyReporter from '../flaky-reporter'
import { flakyLine } from '../flaky'
import { removeTestTree } from '../remove'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-flaky-report-')))
  dirs.push(dir)
  return dir
}

/** What the reporter wrote on stdout and on stderr while `run` ran. */
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

/** A vitest test file whose tests have these full names and diagnostics (undefined: not run). */
function vitestModule(file: string, tests: { fullName: string; line?: number; retryCount?: number; flaky?: boolean }[]): TestModule {
  const cases = tests.map(({ fullName, line, retryCount, flaky }) => ({
    fullName,
    location: line === undefined ? undefined : { line, column: 3 },
    diagnostic: () => (flaky === undefined ? undefined : { retryCount: retryCount ?? 0, flaky }),
  }))
  return { relativeModuleId: file, children: { allTests: () => cases.values() } } as unknown as TestModule
}

describe('retries of vitest.config.ts', () => {
  it('retries a failed test CI_RETRIES times and reports the flaky ones, next to the default reporters', () => {
    const config = readFileSync(join(import.meta.dirname, '..', '..', 'vitest.config.ts'), 'utf8')
    expect(config).toMatch(/reporters: \[\.\.\.configDefaults\.reporters, .*'\.\/test\/flaky-reporter\.ts'\]/)
    expect(config).toContain('    retry: CI_RETRIES,\n')
    // The FLAKY line names the line of the test: vitest collects it only with includeTaskLocation.
    expect(config).toContain('    includeTaskLocation: true,\n')
  })

  it('CI_RETRIES is 1 in CI and 0 outside it', async () => {
    const load = async (ci: string | undefined) => {
      vi.stubEnv('CI', ci)
      vi.resetModules()
      return ((await import('../flaky')) as typeof import('../flaky')).CI_RETRIES
    }
    expect(await load('true')).toBe(1)
    expect(await load(undefined)).toBe(0)
  })
})

describe('the vitest flaky reporter', () => {
  it('prints a FLAKY line for a test that passed on the retry, and nothing for the others', () => {
    const modules = [
      vitestModule('test\\unit\\a.test.ts', [
        { fullName: 'group > retried and passed', line: 12, retryCount: 1, flaky: true },
        { fullName: 'group > passed at once', retryCount: 0, flaky: false },
        { fullName: 'group > retried and failed', retryCount: 1, flaky: false },
        { fullName: 'skipped' },
      ]),
      vitestModule('test/contract/b.test.ts', [{ fullName: 'passed at once', retryCount: 0, flaky: false }]),
    ]
    const { stdout } = output(() => new VitestFlakyReporter().onTestRunEnd(modules))
    expect(stdout.split('\n').filter(Boolean)).toEqual(['FLAKY vitest test/unit/a.test.ts:12 > group > retried and passed'])
  })

  it('prints nothing and writes no summary when no test needed the retry', () => {
    const summary = join(tempDir(), 'summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const modules = [vitestModule('test/unit/a.test.ts', [{ fullName: 'passed at once', retryCount: 0, flaky: false }])]
    expect(output(() => new VitestFlakyReporter().onTestRunEnd(modules))).toEqual({ stdout: '', stderr: '' })
    expect(existsSync(summary)).toBe(false)
  })

  it('leaves the job summary to vitest: a flaky test is not written there twice', () => {
    const summary = join(tempDir(), 'summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const modules = [vitestModule('test/unit/a.test.ts', [{ fullName: 'retried and passed', line: 4, retryCount: 1, flaky: true }])]
    expect(output(() => new VitestFlakyReporter().onTestRunEnd(modules)).stdout).toContain('FLAKY vitest test/unit/a.test.ts:4 > retried and passed')
    expect(existsSync(summary)).toBe(false)
  })
})

/** A Playwright suite of one spec file whose tests, in a describe block or not, end with these outcomes. */
function playwrightRoot(cwd: string, tests: { title: string; describe?: string; outcome: ReturnType<TestCase['outcome']> }[]): Suite {
  const root = { type: 'root', title: '' } as Suite
  const project = { type: 'project', title: '', parent: root } as Suite
  const file = { type: 'file', title: 'test/e2e/a.spec.ts', parent: project } as Suite
  const cases = tests.map(({ title, describe: block, outcome }, index) => ({
    title,
    parent: block === undefined ? file : ({ type: 'describe', title: block, parent: file } as Suite),
    location: { file: join(cwd, 'test', 'e2e', 'a.spec.ts'), line: 10 + index, column: 3 },
    outcome: () => outcome,
  }))
  return Object.assign(root, { allTests: () => cases as unknown as TestCase[] })
}

/** Runs the Playwright reporter over `root` from `cwd`. */
function runPlaywrightReporter(root: Suite, cwd: string): { stdout: string; stderr: string } {
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  const reporter = new PlaywrightFlakyReporter()
  return output(() => {
    reporter.onBegin({} as never, root)
    reporter.onEnd()
  })
}

describe('the Playwright flaky reporter', () => {
  it('prints a FLAKY line for a flaky test and appends the lines to the job summary', () => {
    const dir = tempDir()
    const summary = join(dir, 'summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const root = playwrightRoot(dir, [
      { title: 'opens the canvas', describe: 'Canvas', outcome: 'flaky' },
      { title: 'passed at once', outcome: 'expected' },
      { title: 'failed twice', outcome: 'unexpected' },
      { title: 'quarantined', outcome: 'skipped' },
    ])
    const line = 'FLAKY playwright test/e2e/a.spec.ts:10 > Canvas > opens the canvas'
    const { stdout } = runPlaywrightReporter(root, dir)
    expect(stdout.split('\n').filter(Boolean)).toEqual([line])
    expect(readFileSync(summary, 'utf8')).toBe(`### Flaky tests (playwright)\n\n1 passed only on the retry:\n\n\`\`\`\n${line}\n\`\`\`\n\n`)
  })

  it('prints nothing and writes no summary when no test needed the retry', () => {
    const dir = tempDir()
    const summary = join(dir, 'summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const root = playwrightRoot(dir, [{ title: 'passed at once', outcome: 'expected' }])
    expect(runPlaywrightReporter(root, dir)).toEqual({ stdout: '', stderr: '' })
    expect(existsSync(summary)).toBe(false)
  })

  it('without GITHUB_STEP_SUMMARY prints the line only', () => {
    const dir = tempDir()
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined)
    const root = playwrightRoot(dir, [{ title: 'opens the canvas', outcome: 'flaky' }])
    expect(runPlaywrightReporter(root, dir)).toEqual({ stdout: '\nFLAKY playwright test/e2e/a.spec.ts:10 > opens the canvas\n', stderr: '' })
  })

  it('a summary it cannot write is said on stderr and does not fail the run', () => {
    const dir = tempDir()
    vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'missing', 'summary.md'))
    const root = playwrightRoot(dir, [{ title: 'opens the canvas', outcome: 'flaky' }])
    const { stdout, stderr } = runPlaywrightReporter(root, dir)
    expect(stdout).toContain('FLAKY playwright test/e2e/a.spec.ts:10 > opens the canvas')
    expect(stderr).toMatch(/^flaky report: the job summary .*summary\.md was not written: /)
  })
})

describe('the FLAKY line', () => {
  // One form for both runners, at the start of a log line, so `grep '^FLAKY '` over a job log finds
  // every test that passed only on the retry.
  const FORM = /^FLAKY (vitest|playwright) [^\s:]+:\d+ > .+$/

  it('is FLAKY, the runner, the file and line of the test, then its title', () => {
    expect(flakyLine('vitest', { file: 'test/unit/a.test.ts', line: 12, name: 'group > test' })).toBe('FLAKY vitest test/unit/a.test.ts:12 > group > test')
    expect(flakyLine('playwright', { file: 'test/e2e/a.spec.ts', line: 7, name: 'Canvas > opens' })).toBe('FLAKY playwright test/e2e/a.spec.ts:7 > Canvas > opens')
  })

  it('both reporters print it in that form, each at the start of its own line', () => {
    const dir = tempDir()
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined)
    const vitest = output(() =>
      new VitestFlakyReporter().onTestRunEnd([vitestModule('test/unit/a.test.ts', [{ fullName: 'a > b', line: 3, retryCount: 1, flaky: true }])]),
    ).stdout
    const playwright = runPlaywrightReporter(playwrightRoot(dir, [{ title: 'b', describe: 'a', outcome: 'flaky' }]), dir).stdout
    const lines = `${vitest}${playwright}`.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toMatch(FORM)
  })

  it('leaves the line out only when the runner did not collect it', () => {
    expect(flakyLine('vitest', { file: 'test/unit/a.test.ts', line: undefined, name: 'test' })).toBe('FLAKY vitest test/unit/a.test.ts > test')
  })
})
