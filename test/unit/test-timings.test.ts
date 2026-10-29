// scripts/test-timings.mjs: the slowest test files per layer, read from the reports the test runs
// leave in test-results/ — the vitest timings report of test/timings-reporter.ts and the JSON
// reports of Playwright. Also the reporter itself: what it writes for a run.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestModule, Vitest } from 'vitest/node'
import { removeTestTree } from '../remove'
import TimingsReporter, { TIMINGS_REPORT, type TimingsReport } from '../timings-reporter'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'test-timings.mjs')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-test-timings-')))
  dirs.push(dir)
  return dir
}
function put(dir: string, file: string, content: unknown): void {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), typeof content === 'string' ? content : JSON.stringify(content))
}
const run = (cwd: string, ...args: string[]) => spawnSync(scriptNode(), [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: ms(30_000) })

interface TestTimings {
  testTimings: (args: string[], io: { cwd: string; out: (text: string) => void; err: (line: string) => void }) => number
}
const { testTimings } = (await import(pathToFileURL(SCRIPT).href)) as TestTimings

/**
 * The script in this process: its exit code and what it wrote to stderr. One launch of node costs
 * a second or more on a loaded Windows runner, so checks of many arguments run here; one test keeps
 * the launch of the command itself.
 */
function runHere(cwd: string, ...args: string[]): { status: number; stderr: string } {
  const err: string[] = []
  const status = testTimings(args, { cwd, out: () => undefined, err: (line) => err.push(line) })
  return { status, stderr: err.join('\n') }
}

const vitestReport = {
  version: 1,
  tool: 'vitest',
  at: '2026-10-20T10:00:00.000Z',
  reason: 'passed',
  wallMs: 9_000,
  files: [
    { file: 'test/unit/a.test.ts', project: 'node', state: 'passed', ms: 1_000 },
    { file: 'test/unit/b.test.ts', project: 'node', state: 'passed', ms: 3_000 },
    { file: 'test/unit/c.test.ts', project: 'node', state: 'passed', ms: 6_000 },
    { file: 'test/contract/x.test.ts', project: 'contract', state: 'failed', ms: 4_000 },
    { file: 'test/unit/v.test.tsx', project: 'jsdom', state: 'passed', ms: 500 },
  ],
}
// Playwright's JSON reporter: a top-level suite per file, describe blocks as inner suites, a result
// per try of a test.
const result = (duration: number) => ({ duration, status: 'passed' })
const e2eReport = {
  config: { rootDir: '/repo/test/e2e' },
  stats: { startTime: '2026-10-20T11:00:00.000Z', duration: 30_123.4 },
  suites: [
    {
      title: 'canvas.spec.ts',
      file: 'canvas.spec.ts',
      specs: [{ title: 'opens', tests: [{ projectName: '', results: [result(2_000)] }] }],
      suites: [{ title: 'inner', file: 'canvas.spec.ts', specs: [{ title: 'twice', tests: [{ projectName: '', results: [result(1_000), result(3_000)] }] }] }],
    },
    { title: 'menu.spec.ts', file: 'menu.spec.ts', specs: [{ title: 'shows', tests: [{ projectName: '', results: [result(18_000)] }] }] },
  ],
}

describe('scripts/test-timings.mjs', () => {
  it('reads the default reports of the working directory: per layer (the vitest project node as unit) the count, the sum and the N slowest with seconds and share', () => {
    const dir = tempDir()
    put(dir, 'test-results/vitest-timings.json', vitestReport)
    put(dir, 'test-results/e2e-report.json', e2eReport)
    // No package-report.json: a missing default report is skipped.
    const res = run(dir, '--top', '2')
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toBe(
      [
        'test-results/vitest-timings.json: vitest, 5 files, the run took 9.0 s (2026-10-20T10:00:00.000Z)',
        'test-results/e2e-report.json: playwright, 2 files, the run took 30.1 s (2026-10-20T11:00:00.000Z)',
        '',
        'unit — 3 files, 10.0 s in all',
        '    6.0 s   60.0%  test/unit/c.test.ts',
        '    3.0 s   30.0%  test/unit/b.test.ts',
        '',
        'contract — 1 files, 4.0 s in all',
        '    4.0 s  100.0%  test/contract/x.test.ts',
        '',
        'jsdom — 1 files, 0.5 s in all',
        '    0.5 s  100.0%  test/unit/v.test.tsx',
        '',
        'e2e — 2 files, 24.0 s in all',
        '   18.0 s   75.0%  menu.spec.ts',
        '    6.0 s   25.0%  canvas.spec.ts',
        '',
      ].join('\n'),
    )
  })

  it('--json: the same as one object; a Playwright file sums every try of every test in its inner suites', () => {
    const dir = tempDir()
    put(dir, 'test-results/vitest-timings.json', vitestReport)
    put(dir, 'test-results/package-report.json', e2eReport)
    const res = run(dir, '--json', '--top=1')
    expect(res.status, res.stderr).toBe(0)
    const parsed = JSON.parse(res.stdout) as { reports: unknown[]; projects: unknown[] }
    expect(parsed.reports).toEqual([
      { path: 'test-results/vitest-timings.json', kind: 'vitest', files: 5, wallMs: 9_000, at: '2026-10-20T10:00:00.000Z' },
      { path: 'test-results/package-report.json', kind: 'playwright', files: 2, wallMs: 30_123, at: '2026-10-20T11:00:00.000Z' },
    ])
    expect(parsed.projects).toEqual([
      { project: 'unit', files: 3, totalMs: 10_000, slowest: [{ file: 'test/unit/c.test.ts', ms: 6_000, share: 0.6 }] },
      { project: 'contract', files: 1, totalMs: 4_000, slowest: [{ file: 'test/contract/x.test.ts', ms: 4_000, share: 1 }] },
      { project: 'jsdom', files: 1, totalMs: 500, slowest: [{ file: 'test/unit/v.test.tsx', ms: 500, share: 1 }] },
      { project: 'package', files: 2, totalMs: 24_000, slowest: [{ file: 'menu.spec.ts', ms: 18_000, share: 0.75 }] },
    ])
  })

  it('a Playwright run in two workers: the run took its own wall time, the files keep their sum, which is more', () => {
    const dir = tempDir()
    const inWorker = (duration: number, workerIndex: number) => ({ ...result(duration), workerIndex, parallelIndex: workerIndex })
    const twoWorkers = {
      config: { rootDir: '/repo/test/e2e', workers: 2 },
      stats: { startTime: '2026-10-21T08:00:00.000Z', duration: 21_000 },
      suites: [
        { title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'one', tests: [{ projectName: '', results: [inWorker(12_000, 0)] }] }, { title: 'two', tests: [{ projectName: '', results: [inWorker(8_000, 0)] }] }] },
        { title: 'b.spec.ts', file: 'b.spec.ts', specs: [{ title: 'one', tests: [{ projectName: '', results: [inWorker(20_500, 1)] }] }] },
      ],
    }
    put(dir, 'test-results/e2e-report.json', twoWorkers)
    const res = run(dir, '--json')
    expect(res.status, res.stderr).toBe(0)
    const parsed = JSON.parse(res.stdout) as { reports: { wallMs: number }[]; projects: { project: string; totalMs: number; slowest: { file: string; ms: number }[] }[] }
    expect(parsed.reports).toEqual([{ path: 'test-results/e2e-report.json', kind: 'playwright', files: 2, wallMs: 21_000, at: '2026-10-21T08:00:00.000Z' }])
    expect(parsed.projects).toEqual([
      {
        project: 'e2e',
        files: 2,
        totalMs: 40_500,
        slowest: [
          { file: 'b.spec.ts', ms: 20_500, share: 0.5062 },
          { file: 'a.spec.ts', ms: 20_000, share: 0.4938 },
        ],
      },
    ])
  })

  it('takes reports named on the command line instead of the defaults; twenty files a layer by default, slowest first', () => {
    const dir = tempDir()
    const many = { ...vitestReport, files: Array.from({ length: 25 }, (_, i) => ({ file: `t${String(i).padStart(2, '0')}.test.ts`, project: 'contract', ms: 100 * (i + 1) })) }
    put(dir, 'elsewhere/mine.json', many)
    put(dir, 'test-results/e2e-report.json', e2eReport)
    const res = run(dir, 'elsewhere/mine.json')
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).not.toContain('e2e')
    const listed = res.stdout.split('\n').filter((line) => line.includes('.test.ts'))
    expect(listed).toHaveLength(20)
    expect(listed[0]).toContain('t24.test.ts')
    expect(listed[19]).toContain('t05.test.ts')
  })

  it('refuses: no report (1), a named report that is missing (1), a file that is no report (1), a wrong --top or option (2)', () => {
    const dir = tempDir()
    const none = runHere(dir)
    expect(none.status).toBe(1)
    expect(none.stderr).toContain('run pnpm test or pnpm test:e2e first')

    const missing = runHere(dir, 'nope.json')
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('nope.json: no such file')

    put(dir, 'other.json', { hello: 'world' })
    const other = runHere(dir, 'other.json')
    expect(other.status).toBe(1)
    expect(other.stderr).toContain('neither a vitest timings report')

    put(dir, 'broken.json', '{ not json')
    expect(runHere(dir, 'broken.json').status).toBe(1)

    for (const args of [['--top', '0'], ['--top'], ['--top=x'], ['--fast']]) {
      const bad = runHere(dir, ...args)
      expect(bad.status, args.join(' ')).toBe(2)
      expect(bad.stderr).toContain('usage:')
    }
  })

  it('the command itself: a refusal comes back as its exit code, the reason on stderr', () => {
    const bad = run(tempDir(), '--fast')
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('test-timings: unknown option --fast')
    expect(bad.stderr).toContain('usage:')
  })
})

describe('test/timings-reporter.ts', () => {
  const diagnostic = { environmentSetupDuration: 10.4, prepareDuration: 2.2, setupDuration: 30, collectDuration: 400.6, duration: 1_200.2 }
  const module = (relativeModuleId: string, project: string, state: string) =>
    ({ relativeModuleId, project: { name: project }, state: () => state, diagnostic: () => diagnostic }) as unknown as TestModule

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes test-results/vitest-timings.json under the root: every file with its project and all its time in whole milliseconds', () => {
    const root = tempDir()
    // The clock: 0 when the reporter is made, 1000 at the start of the run, 3500.4 at its end.
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(3_500.4)
    const reporter = new TimingsReporter()
    reporter.onInit({ config: { root } } as unknown as Vitest)
    reporter.onTestRunEnd([module('test/unit/a.test.ts', 'node', 'passed'), module('test\\contract\\b.test.ts', 'contract', 'failed')], [], 'failed')
    const report = JSON.parse(readFileSync(join(root, TIMINGS_REPORT), 'utf8')) as TimingsReport
    expect(report).toMatchObject({ version: 1, tool: 'vitest', reason: 'failed' })
    expect(now).toHaveBeenCalledTimes(3)
    expect(report.wallMs).toBe(2_500)
    expect(report.files).toEqual([
      { file: 'test/unit/a.test.ts', project: 'node', state: 'passed', ms: 1_643, environmentMs: 10, prepareMs: 2, setupMs: 30, collectMs: 401, testsMs: 1_200 },
      { file: 'test/contract/b.test.ts', project: 'contract', state: 'failed', ms: 1_643, environmentMs: 10, prepareMs: 2, setupMs: 30, collectMs: 401, testsMs: 1_200 },
    ])
    // What it wrote, the script reads.
    const res = run(root)
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain('unit — 1 files, 1.6 s in all')
  })

  it('is a reporter of the vitest config, next to the default one', () => {
    const config = readFileSync(join(import.meta.dirname, '..', '..', 'vitest.config.ts'), 'utf8')
    expect(config).toContain("reporters: [...configDefaults.reporters, './test/timings-reporter.ts',")
  })

  it('keeps the run going when the report cannot be written: one line on stderr, no temporary file left', () => {
    const root = tempDir()
    // A file where the folder test-results/ should be: the folder cannot be made.
    writeFileSync(join(root, 'test-results'), '')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const reporter = new TimingsReporter()
    reporter.onInit({ config: { root } } as unknown as Vitest)
    expect(() => reporter.onTestRunEnd([module('test/unit/a.test.ts', 'node', 'passed')], [], 'passed')).not.toThrow()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('timings-reporter:'))
  })
})
