#!/usr/bin/env node
// The spec files of one shard of the e2e tests, split by the time each file takes:
//
//   node scripts/e2e-shard.mjs <i>/<n> [<spec file> …]
//
// Playwright's own --shard splits by the count of tests, and the heavy files (linked-machines,
// linked-reconnect, epic-frame, browser, terminal) landed almost all in shard 1 of macos-e2e: on main
// shard 1 took 900–1121 s and shard 2 696–925 s (runs 40770425114 to 40788089367). Here every spec
// file gets its measured seconds from test/e2e/timings.json, and a greedy split puts the files into n
// shards of about the same time: the slowest file first (the name breaks a tie), each into the shard
// with the least time so far (the lower shard on a tie). The same files and table give the same
// shards on every machine. A file runs whole in one worker (fullyParallel: false), so a file is the
// unit of the split.
//
// The files split are every test/e2e/**/*.spec.ts of the repository, or the spec files named after
// <i>/<n>. A spec file the table does not know gets the median of the table; an entry of the table
// with no file is ignored.
//
// Prints the files of shard i, one per line, and on stderr how many and the seconds expected of them
// (the time of the tests only: the build of the app and the job's setup come on top). With
// GITHUB_OUTPUT set, also writes `files=<the files, separated by spaces>` there for the next step:
// the names are plain (letters, digits, . _ / -), which the script checks, so the shell splits the
// list on its spaces and Playwright, which reads each argument as a regular expression of a path,
// matches each name to its own file only.
//
// Exit code 0 — printed; 1 — the table cannot be read, a file name is not plain, or shard i gets no
// file; 2 — a wrong argument. Node's own modules only.

import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const E2E_DIR = 'test/e2e'
export const TIMINGS = 'test/e2e/timings.json'
const USAGE = 'usage: node scripts/e2e-shard.mjs <i>/<n> [<spec file> …]'
const PLAIN = /^[A-Za-z0-9._/-]+$/

/** Every spec file of the e2e tests under `root`, as forward-slash paths from `root`, sorted. */
export function listSpecs(root) {
  return readdirSync(join(root, E2E_DIR), { recursive: true, encoding: 'utf8' })
    .map((name) => `${E2E_DIR}/${name.split('\\').join('/')}`)
    .filter((path) => path.endsWith('.spec.ts'))
    .sort()
}

/** The table of `root`: { spec file → seconds }. Throws an Error with a reason when it cannot be read. */
export function readTimings(root) {
  const table = JSON.parse(readFileSync(join(root, TIMINGS), 'utf8'))
  const seconds = table?.seconds
  if (!seconds || typeof seconds !== 'object' || Array.isArray(seconds)) throw new Error('no "seconds" object')
  for (const [file, value] of Object.entries(seconds)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${file}: ${JSON.stringify(value)} is not a number of seconds`)
  }
  return seconds
}

/** The median of a list of numbers; 0 for an empty list. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * `files` split into `n` shards by `seconds` (spec file → seconds): [{ files, seconds }], the files of
 * each shard sorted by name. A file missing from `seconds` counts as the median of `seconds`.
 */
export function splitShards(files, seconds, n) {
  const fallback = median(Object.values(seconds))
  const cost = (file) => (Object.hasOwn(seconds, file) ? seconds[file] : fallback)
  const order = [...new Set(files)].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0))
  const shards = Array.from({ length: n }, () => ({ files: [], seconds: 0 }))
  for (const file of order) {
    let lightest = shards[0]
    for (const shard of shards) if (shard.seconds < lightest.seconds) lightest = shard
    lightest.files.push(file)
    lightest.seconds += cost(file)
  }
  for (const shard of shards) {
    shard.files.sort()
    shard.seconds = Math.round(shard.seconds * 10) / 10
  }
  return shards
}

/** `<i>/<n>` as { index, count }, or null when it is not 1 ≤ i ≤ n. */
export function parseShard(text) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(text ?? ''))
  if (!match) return null
  const index = Number(match[1])
  const count = Number(match[2])
  return index <= count ? { index, count } : null
}

/** A path given on the command line as a forward-slash path from the root: ./test\e2e\a.spec.ts → test/e2e/a.spec.ts. */
const normalize = (path) => path.split('\\').join('/').replace(/^(\.\/)+/, '')

/**
 * The command, without the process: the exit code. `io.out` takes the text of stdout, `io.err` one
 * line of stderr, `io.output` (optional) one `name=value` line for GITHUB_OUTPUT.
 */
export function e2eShard(args, io) {
  const root = io.root ?? ROOT
  const shard = parseShard(args[0])
  if (!shard) {
    io.err(`e2e-shard: ${args[0] === undefined ? 'no shard given' : `${JSON.stringify(args[0])} is not <i>/<n> with 1 ≤ i ≤ n`}\n${USAGE}`)
    return 2
  }
  const specs = listSpecs(root)
  let files = specs
  if (args.length > 1) {
    const known = new Set(specs)
    files = args.slice(1).map(normalize)
    const unknown = files.filter((file) => !known.has(file))
    if (unknown.length) {
      io.err(`e2e-shard: not a spec file under ${E2E_DIR}: ${unknown.join(' ')}\n${USAGE}`)
      return 2
    }
  }
  let seconds
  try {
    seconds = readTimings(root)
  } catch (error) {
    io.err(`e2e-shard: cannot read ${TIMINGS}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const odd = files.filter((file) => !PLAIN.test(file))
  if (odd.length) {
    io.err(`e2e-shard: a spec file name must be letters, digits and . _ / - only: ${odd.join(' ')}`)
    return 1
  }
  const shards = splitShards(files, seconds, shard.count)
  const mine = shards[shard.index - 1]
  const total = Math.round(shards.reduce((sum, s) => sum + s.seconds, 0) * 10) / 10
  // shortcut: a shard with no file is an error, because `pnpm test:e2e` with no file runs every file;
  // when CI hands a subset smaller than the shard count, the CI step has to skip such a shard instead.
  if (mine.files.length === 0) {
    io.err(`e2e-shard: shard ${shard.index}/${shard.count} gets no spec file of ${files.length}`)
    return 1
  }
  io.out(`${mine.files.join('\n')}\n`)
  io.err(
    `e2e-shard: shard ${shard.index}/${shard.count}: ${mine.files.length} of ${files.length} spec files, ${mine.seconds} s expected of ${total} s (shards: ${shards.map((s) => `${s.files.length} files ${s.seconds} s`).join(', ')})`,
  )
  io.output?.(`files=${mine.files.join(' ')}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const githubOutput = process.env.GITHUB_OUTPUT
  process.exitCode = e2eShard(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (line) => process.stderr.write(`${line}\n`),
    output: githubOutput ? (line) => appendFileSync(githubOutput, `${line}\n`) : undefined,
  })
}
