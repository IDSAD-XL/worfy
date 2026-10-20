// A vitest reporter (vitest.config.ts) that writes how long each test file took to
// test-results/vitest-timings.json, next to the default console reporter. scripts/test-timings.mjs
// reads it and prints the slowest files of each project.
//
// The built-in json reporter is not used: it names no project, and its time of a file covers only
// the tests, not the import of the file and its setup, which is most of the time of a slow file.
// Here a file's `ms` is all of it — environment, preparation, setup files, import and collection,
// tests and hooks — as vitest measures them in the worker (TestModule.diagnostic()).
//
// The file is written whole at the end of every run, a filtered one too (`pnpm test -- <file>`):
// it tells the last run, not the last full run. A run that names its own reporters on the command
// line (`--reporter=dot`) replaces the reporters of the config and writes no file.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Reporter, TestModule, TestRunEndReason, Vitest } from 'vitest/node'

/** Where the report lies, from the root of the run (the repository). */
export const TIMINGS_REPORT = join('test-results', 'vitest-timings.json')

export interface FileTiming {
  /** The test file, from the root, with forward slashes. */
  file: string
  /** The vitest project: node, contract or jsdom. */
  project: string
  state: string
  /** Everything the file took in its worker, in whole milliseconds. */
  ms: number
  environmentMs: number
  prepareMs: number
  setupMs: number
  collectMs: number
  testsMs: number
}

export interface TimingsReport {
  version: 1
  tool: 'vitest'
  at: string
  /** passed, failed or interrupted. */
  reason: string
  /** The time of the run itself, start to end; the files of a project run side by side. */
  wallMs: number
  files: FileTiming[]
}

export function fileTiming(module: TestModule): FileTiming {
  const d = module.diagnostic()
  const ms = (value: number) => Math.round(value)
  return {
    file: module.relativeModuleId.replaceAll('\\', '/'),
    project: module.project.name,
    state: module.state(),
    ms: ms(d.environmentSetupDuration + d.prepareDuration + d.setupDuration + d.collectDuration + d.duration),
    environmentMs: ms(d.environmentSetupDuration),
    prepareMs: ms(d.prepareDuration),
    setupMs: ms(d.setupDuration),
    collectMs: ms(d.collectDuration),
    testsMs: ms(d.duration),
  }
}

export default class TimingsReporter implements Reporter {
  private root = process.cwd()
  private started = performance.now()

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root
    this.started = performance.now()
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, _errors: unknown, reason: TestRunEndReason): void {
    const report: TimingsReport = {
      version: 1,
      tool: 'vitest',
      at: new Date().toISOString(),
      reason,
      wallMs: Math.round(performance.now() - this.started),
      files: testModules.map(fileTiming),
    }
    const file = join(this.root, TIMINGS_REPORT)
    // A temporary file and a rename: a reader never sees half a report. The report is a help to
    // whoever measures the tests, so a failed write does not fail the run.
    const tmp = `${file}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`)
      renameSync(tmp, file)
    } catch (error) {
      rmSync(tmp, { force: true })
      process.stderr.write(`timings-reporter: ${file} was not written: ${(error as Error).message}\n`)
    }
  }
}
