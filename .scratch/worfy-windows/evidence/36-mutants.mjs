// Mutants of worfy-windows ticket 36 (review leftovers of PR #281): one exact replacement in the
// code at a time, the named test files run under Electron's Node, the file put back byte for byte.
// A mutant is killed when the run exits non-zero; a replacement that is not found exactly once
// stops the runner. Usage, from the repository root:
//
//   node .scratch/worfy-windows/evidence/36-mutants.mjs [--lock <dir>] [name…]
//
// `--lock <dir>`: a folder made before each test run and removed after it, so that runs of several
// agents on one machine do not overlap. The JSON reports go to the system's temporary folder.
//
// The texts are those of the code after ticket 36. m01–m09 were also run on main 6340344 with the
// new tests, before the fix: there m09 read `if (name !== null && full(name)) {`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const say = (line) => process.stdout.write(`${line}\n`)
const fail = (line) => {
  process.stderr.write(`${line}\n`)
  process.exit(2)
}

const args = process.argv.slice(2)
const lockAt = args.indexOf('--lock')
const lock = lockAt >= 0 ? args[lockAt + 1] : null
const only = lockAt >= 0 ? args.filter((_arg, index) => index !== lockAt && index !== lockAt + 1) : args
const repo = process.cwd()
const run = Date.now().toString(36)

const DOCS = 'src/main/docs/watch.ts'
const LIM = 'src/main/agent/limits.ts'
const DT = ['test/unit/docs-watch-root-gone.test.ts']
const DR = ['test/contract/docs-watch-root.test.ts']
const LT = ['test/unit/limits-watch-gone.test.ts']
const LR = ['test/contract/limits-watch-root.test.ts']
const GONE = 'src/main/watch-gone.ts'
const GT = ['test/unit/watch-gone.test.ts']

// [name, file, exact text, replacement, test files]
const MUTANTS = [
  // Item 1: the watch made after the root came back, and a second loss.
  ['m01_the_new_watch_is_not_recorded', DOCS, '    this.watcher = mine.handle\n', '    if (this.docs === null) this.watcher = mine.handle\n', DT],
  ['m02_only_the_first_loss_is_met', DOCS, '  private lost(): void {\n', '  private lost(): void {\n    if ((this as any).once) return\n    ;(this as any).once = true\n', DT],
  ['m03_same_on_real_folders', DOCS, '  private lost(): void {\n', '  private lost(): void {\n    if ((this as any).once) return\n    ;(this as any).once = true\n', DR],
  ['m04_the_loss_of_the_data_folder_stops_the_poll', LIM, '            mine.handle?.close()\n            this.watcher = null\n', '            this.stop()\n', LT],
  ['m04r_same_on_a_real_folder', LIM, '            mine.handle?.close()\n            this.watcher = null\n', '            this.stop()\n', LR],
  // Item 3: the defaults, and the first event.
  ['m05_docs_no_name_is_a_full_path', DOCS, '    const full = this.options.isAbsolute ?? nativePath.isAbsolute\n', '    const full = this.options.isAbsolute ?? (() => false)\n', DT],
  ['m06_limits_no_name_is_a_full_path', LIM, '      const full = this.options.isAbsolute ?? isAbsolute\n', '      const full = this.options.isAbsolute ?? (() => false)\n', LT],
  ['m07_the_root_is_always_there', DOCS, '(this.options.rootThere ?? isFolder)', '(this.options.rootThere ?? (async () => true))', DT],
  ['m08_the_wait_for_the_root_is_100_times_longer', DOCS, '    return this.options.retryMs ?? ROOT_RETRY_MS\n', '    return this.options.retryMs ?? ROOT_RETRY_MS * 100\n', DT],
  ['m09_limits_closes_at_the_50th_event', LIM, '          if (namesTheFolder(name, full)) {\n', '          if (namesTheFolder(name, full) && ((this as any).seen = ((this as any).seen ?? 0) + 1) >= 50) {\n', LT],
  // Item 2: a watch of the documents that fails.
  ['m10_a_failed_watch_is_only_said', DOCS, '        this.drop()\n      },\n    )\n', '      },\n    )\n', DT],
  ['m11_an_error_of_a_closed_watch_is_taken', DOCS, '      (error) => {\n        if (this.watcher !== mine.handle) return\n', '      (error) => {\n', DT],
  // Item 3: a root that is a folder and cannot be watched.
  ['m12_a_failure_is_said_every_time', DOCS, '    if (this.failing) return\n', '', DT],
  ['m13_a_missing_root_is_said_too', DOCS, '            if (!notThere(error)) this.fail(', '            this.fail(', DT],
  ['m14_documents_not_read_while_refused', DOCS, '            this.request()\n            this.waitForRoot()\n', '            this.waitForRoot()\n', DT],
  // The shared rule (watch-gone.ts).
  ['m15_any_name_names_the_folder', GONE, '  return name !== null && isAbsolute(name)\n', '  return name !== null\n', [...GT, ...DT, ...LT]],
  ['m16_emfile_counts_as_not_there', GONE, "['ENOENT', 'ENOTDIR']", "['ENOENT', 'ENOTDIR', 'EMFILE']", [...GT, ...DT]],
  // The review of d9fb032: runs of failures, Linux, and the real fs.watch.
  ['m17_no_new_run_after_an_event', DOCS, '        if (this.watcher !== mine.handle) return\n        this.failing = false\n', '        if (this.watcher !== mine.handle) return\n', DT],
  ['m18_no_new_run_after_a_retry_period', DOCS, 'if (this.watcher === mine.handle) this.failing = false', 'if (this.watcher === mine.handle) void 0', DT],
  ['m19_a_new_run_at_every_watch_made', DOCS, '    this.watcher = mine.handle\n', '    this.watcher = mine.handle\n    this.failing = false\n', DT],
  ['m20_an_error_ends_the_watch_on_linux', DOCS, "  return platform !== 'linux'\n", '  return true\n', DT],
  ['m21_an_error_never_ends_the_watch_by_default', DOCS, 'this.options.errorEnds ?? errorEndsWatch(process.platform)', 'this.options.errorEnds ?? false', DT],
  ['m22_the_node_watch_is_always_recursive', GONE, '{ recursive }', '{ recursive: true }', GT],
  ['m23_the_node_watch_error_is_not_listened_to', GONE, "  watcher.on('error', onError)\n", '', GT],
]

const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function locked(work) {
  if (lock === null) return work()
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch {
      pauseSync(20_000)
    }
  }
  try {
    return work()
  } finally {
    fs.rmdirSync(lock)
  }
}

function runTests(files, out) {
  return locked(() => {
    const result = spawnSync(process.execPath, ['scripts/vitest-electron.mjs', ...files, '--reporter=json', `--outputFile=${out}`], { cwd: repo, encoding: 'utf8', timeout: 600_000 })
    return result.status
  })
}

function failedNames(out) {
  try {
    const report = JSON.parse(fs.readFileSync(out, 'utf8'))
    const names = []
    for (const file of report.testResults) {
      if (file.status === 'failed' && file.assertionResults.length === 0) names.push(`${path.basename(file.name)}: ${String(file.message).split('\n')[0]}`)
      for (const test of file.assertionResults) if (test.status === 'failed') names.push(test.title)
    }
    return names
  } catch (error) {
    return [`no report: ${error.message}`]
  }
}

for (const [name, file, from, to, tests] of MUTANTS) {
  if (only.length > 0 && !only.includes(name)) continue
  const full = path.join(repo, file)
  const original = fs.readFileSync(full)
  const text = original.toString('utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const exact = from.replace(/\n/g, eol)
  const count = text.split(exact).length - 1
  if (count !== 1) {
    fail(`${name}: the text is found ${count} times in ${file}`)
  }
  const out = path.join(os.tmpdir(), `mut36-${run}-${name}.json`)
  let status
  try {
    fs.writeFileSync(full, text.replace(exact, () => to.replace(/\n/g, eol)))
    status = runTests(tests, out)
  } finally {
    fs.writeFileSync(full, original)
  }
  if (!fs.readFileSync(full).equals(original)) {
    fail(`${name}: ${file} was not put back`)
  }
  const failed = failedNames(out)
  say(`${status === 0 ? 'SURVIVED' : 'killed  '} ${name} (exit ${status}; ${failed.length} failed)`)
  for (const title of failed) say(`    - ${title}`)
}
