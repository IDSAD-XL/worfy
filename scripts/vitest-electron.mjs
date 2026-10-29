#!/usr/bin/env node
// Runs vitest under Electron's Node (`pnpm test`, worfy-windows ticket 02):
//
//   node scripts/vitest-electron.mjs [<vitest args>…]     → electron node_modules/vitest/vitest.mjs run <args>
//
// The tests run in Electron's Node so that native modules (node-pty) load with Electron's ABI, as the
// app loads them. The script used to be `ELECTRON_RUN_AS_NODE=1 electron …`, but a `VAR=value`
// prefix is POSIX shell syntax and cmd.exe, which runs pnpm scripts on Windows, does not understand
// it (evidence of worfy-windows ticket 01, section 10). Here the variable is set for the child alone.
// The arguments after `pnpm test` go to `vitest run` as before; the exit code is vitest's, and
// Ctrl+C and TERM are passed on to it.
//
// One exception to "the exit code is vitest's": a run that exits 0 without vitest's summary
// (`Test Files …` and `Tests …`) exits 1 with the line "vitest ended without its summary". The gate
// and CI read only the exit code, and a run cut short with code 0 — a worker that hung and was
// closed, Electron started as a GUI app — would otherwise read as green. The stdout of vitest is
// therefore piped through this script and copied out as it arrives; its stderr is not touched.
// A pipe is not a TTY, so in a terminal vitest's live progress line gives way to plain lines. The
// verdict waits for stdout to close, so a process that inherited vitest's stdout can delay the exit.
// Invocations that print no summary by design (--help, --version, a reporter such as json alone)
// are not checked.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
// The electron package exports the path of its binary when required from Node.
const electron = createRequire(import.meta.url)('electron')
const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs')
// `pnpm test -- <file>` hands the `--` on. vitest takes everything after a `--` as extra options,
// not as file filters, so the filter was dropped and the whole suite ran. A leading `--` is removed.
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
// WORFY_TEST_FILES: the test files a CI job of a pull request runs (scripts/affected-tests.mjs), paths
// separated by spaces. They go to vitest as file filters after the other arguments: from the environment,
// not the command line, because cmd.exe, which runs `pnpm test` on Windows, stops at 8191 characters,
// and the whole suite's names take about 17 000. With --passWithNoTests: a shard of a short list may get
// no file, and a shard that leaves out the only listed file (WORFY_TEST_EXCLUDE) has none. Unset elsewhere.
const listed = (process.env.WORFY_TEST_FILES ?? '').split(/\s+/).filter(Boolean)
if (listed.length > 0) args.push('--passWithNoTests', ...listed)

// The built-in reporters that end a run with the summary; any other (json, junit, a custom file)
// may print none, so a run that names only such reporters is not checked.
const SUMMARY_REPORTERS = new Set(['default', 'verbose', 'dot', 'tree'])
const reporters = args.flatMap((arg, index) => {
  if (arg.startsWith('--reporter=')) return [arg.slice('--reporter='.length)]
  if (arg === '--reporter' && index + 1 < args.length) return [args[index + 1]]
  return []
})
const expectsSummary =
  !args.some((arg) => ['--help', '-h', '--version', '-v'].includes(arg)) &&
  (reporters.length === 0 || reporters.some((name) => SUMMARY_REPORTERS.has(name)))

// Lines of the summary as vitest prints them, colour codes removed: " Test Files  1 passed (1)" and
// "      Tests  2 passed (2)". "No test files found, exiting with code 0" (--passWithNoTests) is
// vitest's own last word for a run with nothing to run.
const TEST_FILES_LINE = /^\s*Test Files\s+.*\(\d+\)\s*$/
const TESTS_LINE = /^\s*Tests\s+.*\(\d+\)\s*$/
const NO_FILES_LINE = /^No test files found, exiting with code 0\s*$/
let sawTestFiles = false
let sawTests = false
let sawNoFiles = false
let partial = ''
const scan = (line) => {
  const plain = stripVTControlCharacters(line)
  if (TEST_FILES_LINE.test(plain)) sawTestFiles = true
  if (TESTS_LINE.test(plain)) sawTests = true
  if (NO_FILES_LINE.test(plain)) sawNoFiles = true
}

// The list stays out of the tests' environment: a test that starts this script again must not inherit it.
const env = { ...process.env }
delete env.WORFY_TEST_FILES
const child = spawn(electron, [vitest, 'run', ...args], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
})
// A reader that went away (`pnpm test | head`) must not stop the run: vitest keeps its output going
// and its exit code still decides.
process.stdout.on('error', () => {})
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  const lines = (partial + chunk.toString('utf8')).split(/\r?\n|\r/)
  partial = lines.pop() ?? ''
  for (const line of lines) scan(line)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal)
  })
}
child.on('error', (error) => {
  process.stderr.write(`vitest-electron: ${electron}: ${error.message}\n`)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  scan(partial)
  if (signal) process.stderr.write(`vitest-electron: vitest ended by ${signal}\n`)
  process.exitCode = typeof code === 'number' && code >= 0 ? code : 1
  if (process.exitCode === 0 && expectsSummary && !((sawTestFiles && sawTests) || sawNoFiles)) {
    process.stderr.write('vitest-electron: vitest ended without its summary\n')
    process.exitCode = 1
  }
})
