#!/usr/bin/env node
// The slowest test files of the last runs, per project:
//
//   node scripts/test-timings.mjs [--top N] [--json] [<report.json> …]
//
// It reads the reports the test runs leave in test-results/ (not in git):
//   - test-results/vitest-timings.json — `pnpm test` (test/timings-reporter.ts): every file with its
//     vitest project and all the time it took. The projects are printed as the layers of the tests:
//     the project `node` as `unit`, `contract` and `jsdom` as they are;
//   - test-results/e2e-report.json and test-results/package-report.json — the JSON reporter of
//     Playwright in `pnpm test:e2e` and `pnpm test:package` (playwright.config.ts); a file's time is
//     the sum of the durations of its tests, and the project is the name of the report (e2e, package).
// Reports named on the command line are read instead; any Playwright JSON report will do.
//
// For each project it prints the number of files, their time in all, and the N slowest files
// (default 20) with seconds and their share of that time. The files of a vitest project run side
// by side, and so do the e2e files of a Playwright run with several workers, so their sum is more
// than the run took; the line of each report says how long the run itself took. --json prints the
// same as one JSON object.
//
// Exit code 0 — printed; 1 — no report to read, or a report that cannot be read; 2 — a wrong
// argument. A default report that is missing is skipped; a report named on the command line must
// be there. The default paths are taken from the working directory: run it from the repository root.
// Node's own modules only.

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const DEFAULT_REPORTS = ['test-results/vitest-timings.json', 'test-results/e2e-report.json', 'test-results/package-report.json']
export const DEFAULT_TOP = 20
const USAGE = 'usage: node scripts/test-timings.mjs [--top N] [--json] [<report.json> …]'

/** The layer a vitest project is printed as: the project `node` runs test/unit/**\/*.test.ts. */
const VITEST_LAYERS = { node: 'unit' }

/** The project name a Playwright report gets from its file name: e2e-report.json → e2e. */
export function reportLabel(file) {
  return basename(file).replace(/\.json$/i, '').replace(/-report$/i, '') || 'playwright'
}

/** Every test of a Playwright suite and of the suites inside it. */
function* playwrightTests(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) yield test
  for (const inner of suite.suites ?? []) yield* playwrightTests(inner)
}

/**
 * What a report holds: { kind, wallMs, at, entries: [{ project, file, ms }] }. Throws an Error with
 * a reason when the object is neither a vitest timings report nor a Playwright JSON report.
 */
export function readReport(report, file) {
  if (report && report.tool === 'vitest' && Array.isArray(report.files)) {
    const layer = (project) => VITEST_LAYERS[project] ?? project
    const entries = report.files.map((entry) => ({ project: layer(String(entry.project || 'vitest')), file: String(entry.file), ms: Number(entry.ms) || 0 }))
    return { kind: 'vitest', wallMs: Number(report.wallMs) || 0, at: report.at ?? null, entries }
  }
  if (report && Array.isArray(report.suites) && report.config) {
    const label = reportLabel(file)
    const byFile = new Map()
    // A top-level suite is one test file; with Playwright projects a file appears once per project.
    for (const suite of report.suites) {
      for (const test of playwrightTests(suite)) {
        const project = test.projectName ? `${label}:${test.projectName}` : label
        const key = `${project}\n${suite.file ?? suite.title}`
        const ms = (test.results ?? []).reduce((sum, result) => sum + (Number(result.duration) || 0), 0)
        const entry = byFile.get(key) ?? { project, file: String(suite.file ?? suite.title), ms: 0 }
        entry.ms += ms
        byFile.set(key, entry)
      }
    }
    return { kind: 'playwright', wallMs: Math.round(Number(report.stats?.duration) || 0), at: report.stats?.startTime ?? null, entries: [...byFile.values()] }
  }
  throw new Error('neither a vitest timings report (test/timings-reporter.ts) nor a Playwright JSON report')
}

/** Per project, in the order the projects first appear: the count, the sum and the `top` slowest files. */
export function summarize(entries, top) {
  const projects = new Map()
  for (const entry of entries) {
    const list = projects.get(entry.project) ?? []
    list.push(entry)
    projects.set(entry.project, list)
  }
  return [...projects].map(([project, list]) => {
    const totalMs = list.reduce((sum, entry) => sum + entry.ms, 0)
    const slowest = [...list]
      .sort((a, b) => b.ms - a.ms || a.file.localeCompare(b.file))
      .slice(0, top)
      .map(({ file, ms }) => ({ file, ms: Math.round(ms), share: totalMs > 0 ? Math.round((ms / totalMs) * 10000) / 10000 : 0 }))
    return { project, files: list.length, totalMs: Math.round(totalMs), slowest }
  })
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** The text of the summary: a line per report, then a block per project. */
export function render(reports, projects) {
  const lines = []
  for (const report of reports) lines.push(`${report.path}: ${report.kind}, ${report.files} files, the run took ${seconds(report.wallMs)}${report.at ? ` (${report.at})` : ''}`)
  for (const project of projects) {
    lines.push('', `${project.project} — ${project.files} files, ${seconds(project.totalMs)} in all`)
    for (const { file, ms, share } of project.slowest) lines.push(`${seconds(ms).padStart(9)}  ${`${(share * 100).toFixed(1)}%`.padStart(6)}  ${file}`)
  }
  return `${lines.join('\n')}\n`
}

/** The script itself; returns the exit code. `io` is { cwd, out, err }. */
export function testTimings(args, io) {
  let top = DEFAULT_TOP
  let json = false
  const named = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') json = true
    else if (arg === '--top' || arg.startsWith('--top=')) {
      const value = arg === '--top' ? args[++i] : arg.slice('--top='.length)
      if (!/^[1-9]\d*$/.test(value ?? '')) {
        io.err(`test-timings: --top takes a whole number above 0, not ${JSON.stringify(value ?? '')}\n${USAGE}`)
        return 2
      }
      top = Number(value)
    } else if (arg === '--help' || arg === '-h') {
      io.out(`${USAGE}\n`)
      return 0
    } else if (arg.startsWith('-')) {
      io.err(`test-timings: unknown option ${arg}\n${USAGE}`)
      return 2
    } else named.push(arg)
  }

  const paths = named.length ? named : DEFAULT_REPORTS
  const reports = []
  const entries = []
  for (const path of paths) {
    let text
    try {
      text = readFileSync(resolve(io.cwd, path), 'utf8')
    } catch (error) {
      if (!named.length && error.code === 'ENOENT') continue
      io.err(`test-timings: ${path}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`)
      return 1
    }
    let read
    try {
      read = readReport(JSON.parse(text), path)
    } catch (error) {
      io.err(`test-timings: ${path}: ${error.message}`)
      return 1
    }
    reports.push({ path, kind: read.kind, files: read.entries.length, wallMs: read.wallMs, at: read.at })
    entries.push(...read.entries)
  }
  if (!reports.length) {
    io.err(`test-timings: no report in ${DEFAULT_REPORTS.join(', ')} — run pnpm test or pnpm test:e2e first`)
    return 1
  }
  const projects = summarize(entries, top)
  io.out(json ? `${JSON.stringify({ reports, projects }, null, 2)}\n` : render(reports, projects))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = testTimings(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (line) => process.stderr.write(`${line}\n`),
  })
}
