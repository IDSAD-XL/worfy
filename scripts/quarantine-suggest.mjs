#!/usr/bin/env node
// Entries for test/quarantine/ made from the candidates of the gate's failure records:
//
//   node scripts/quarantine-suggest.mjs [<report.json>]
//
// It reads the report of `gate-failures report --json` (the file named, or the one the Harness copy of
// this repository, harness/bin/gate-failures, prints when no file is named) and prints, for each of its
// candidates, the name of a file test/quarantine/<id>.json and the JSON of the entry, in the format of
// test/quarantine.ts (QuarantineEntry):
//   - a quarantine candidate (flaky in two different runs): runner, file, test, platforms (those it was
//     flaky on), reason (the class, the runs, the SHAs, the last error), owner "<ticket>" — the ticket
//     that fixes it is for the person who adds the entry to name —, since today (UTC), until 14 days on;
//   - a Windows exception candidate (stable red on win32 alone): kind "windows-exception", platforms
//     ["win32"], owner "worfy-windows 117", until 45 days on.
// A candidate whose test already has an entry is skipped with a line on stderr, and so is one that is
// not a test of this repository's runners (a vitest file of test/unit or test/contract, an e2e spec of
// test/e2e). A warning on stderr says when the entries printed would take the quarantine past its 15
// entries or the Windows exceptions past their 30 (test/quarantine.ts, MAX_ENTRIES and
// MAX_WINDOWS_EXCEPTIONS).
//
// It writes nothing: the entry and the mark quarantined('<id>') in the test file are for a person (or
// the Orchestrator) to add, with the owner's ticket.
// Exit code 0 — printed (no candidate is not an error); 1 — no report to read, or not a report;
// 2 — a wrong argument. Node's own modules only: test/quarantine.ts is TypeScript, so its rules that this
// script needs are repeated here, and test/unit/quarantine-suggest.test.ts checks they are the same.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const QUARANTINE_DIR = join(REPO, 'test', 'quarantine')
const GATE_FAILURES = join(REPO, 'harness', 'bin', 'gate-failures')
const USAGE = 'usage: node scripts/quarantine-suggest.mjs [<report.json>]'

// The rules of test/quarantine.ts this script needs.
export const MAX_ENTRIES = 15
export const MAX_DAYS = 14
export const MAX_WINDOWS_EXCEPTIONS = 30
export const MAX_WINDOWS_EXCEPTION_DAYS = 45
export const WINDOWS_EXCEPTION_OWNER = 'worfy-windows 117'
/** The owner of a quarantine entry until a person names its ticket. */
export const OWNER_PLACEHOLDER = '<ticket>'
const TEST_FILES = { vitest: /^test\/(?:unit|contract)\/.+\.test\.tsx?$/, playwright: /^test\/e2e\/.+\.spec\.ts$/ }
const PLATFORMS = ['darwin', 'win32', 'linux']
const ID_CHARS = 60
const SHA_CHARS = 12
const DAY_MS = 24 * 60 * 60 * 1000

const day = (time) => new Date(time).toISOString().slice(0, 10)

/** The entries already in `dir`: their ids, kinds and the tests they name. A broken one counts as a quarantine entry. */
function existingEntries(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      let raw = {}
      try {
        raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) ?? {}
      } catch {
        // A broken entry still counts in the cap; test/unit/quarantine.test.ts names it.
      }
      return {
        id: name.slice(0, -'.json'.length),
        kind: raw.kind === 'windows-exception' ? 'windows-exception' : 'quarantine',
        key: `${raw.runner ?? 'vitest'}\0${raw.file}\0${raw.test}`,
      }
    })
}

/** An id from the file and the test's own name: lower-case words joined by dashes, at most 60 characters. */
export function entryId(candidate) {
  const file = basename(candidate.file).replace(/\.(?:test|spec)\.tsx?$/, '')
  const test = candidate.name.split(' > ').at(-1) ?? ''
  const words = `${file} ${test}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const suffix = candidate.kind === 'windows-exception' ? ['win32'] : []
  let id = ''
  for (const word of words) {
    const next = id ? `${id}-${word}` : word
    if (next.length + (suffix.length ? 6 : 0) > ID_CHARS) break
    id = next
  }
  return [id || 'test', ...suffix].join('-')
}

function reasonOf(candidate) {
  const runs = candidate.runs.length
  const shas = candidate.heads.map((h) => h.slice(0, SHA_CHARS)).join(', ')
  const where = `${candidate.runs.join(', ')}; on ${candidate.computers.join(', ')} (${candidate.platforms.join(', ')})`
  const what =
    candidate.kind === 'windows-exception'
      ? `Stable red on win32 only in ${runs} gate run${runs === 1 ? '' : 's'} (${where}): red in the run and red alone on the same SHA (${shas}), not red on another platform there.`
      : `Flaky in ${runs} gate runs (${where}): red in the run, green alone on the same SHA (${shas}).`
  return `${what} Last error: ${candidate.lastError || '(none)'} From gate-failures report; the cause is not found yet.`
}

/** The entry of one candidate, in the field order of the files of test/quarantine/. */
export function entryOf(candidate, now) {
  const windows = candidate.kind === 'windows-exception'
  const entry = windows ? { kind: 'windows-exception' } : {}
  return Object.assign(entry, {
    runner: candidate.runner,
    file: candidate.file,
    test: candidate.name,
    platforms: windows ? ['win32'] : PLATFORMS.filter((p) => candidate.platforms.includes(p)),
    reason: reasonOf(candidate),
    owner: windows ? WINDOWS_EXCEPTION_OWNER : OWNER_PLACEHOLDER,
    since: day(now),
    until: day(now + (windows ? MAX_WINDOWS_EXCEPTION_DAYS : MAX_DAYS) * DAY_MS),
  })
}

/** Why a candidate is no test of this repository's runners, or null. */
function notOurs(candidate) {
  const pattern = TEST_FILES[candidate.runner]
  if (!pattern) return `runner ${JSON.stringify(candidate.runner)} is not vitest or playwright`
  if (typeof candidate.file !== 'string' || !pattern.test(candidate.file)) return `${candidate.file} is not a ${candidate.runner} test file of this repository`
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') return 'the record has no test name'
  if (candidate.kind === 'quarantine' && !candidate.platforms.some((p) => PLATFORMS.includes(p))) return `platforms ${candidate.platforms.join(', ')} are none of ${PLATFORMS.join(', ')}`
  return null
}

/** The report the Harness prints for the records of this machine; throws with the reason when it does not. */
function harnessReport(io) {
  const run = spawnSync(io.node ?? process.execPath, [GATE_FAILURES, 'report', '--json'], { cwd: io.cwd, env: io.env ?? process.env, encoding: 'utf8', windowsHide: true })
  if (run.error) throw new Error(`gate-failures report did not start: ${run.error.message}`)
  if (run.status !== 0) throw new Error(`gate-failures report exited ${run.status ?? run.signal}: ${(run.stderr || '').trim()}`)
  return run.stdout
}

/**
 * The script itself; returns the exit code. `io` is { cwd, out, err } and, for tests, `now` (ms),
 * `quarantineDir`, `node` and `env` (of the gate-failures call).
 */
export function quarantineSuggest(args, io) {
  const named = []
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      io.out(`${USAGE}\n`)
      return 0
    }
    if (arg.startsWith('-')) {
      io.err(`quarantine-suggest: unknown option ${arg}\n${USAGE}`)
      return 2
    }
    named.push(arg)
  }
  if (named.length > 1) {
    io.err(`quarantine-suggest: one report at most\n${USAGE}`)
    return 2
  }
  let report
  try {
    const text = named.length === 1 ? readFileSync(resolve(io.cwd, named[0]), 'utf8') : harnessReport(io)
    report = JSON.parse(text)
  } catch (error) {
    io.err(`quarantine-suggest: no report: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (report?.kind !== 'report' || report.version !== 1 || !Array.isArray(report.candidates)) {
    io.err('quarantine-suggest: not a report of gate-failures report --json (version 1)')
    return 1
  }

  const now = io.now ?? Date.now()
  const existing = existingEntries(io.quarantineDir ?? QUARANTINE_DIR)
  const ids = new Set(existing.map((e) => e.id))
  const tests = new Map(existing.map((e) => [e.key, e.id]))
  const added = { quarantine: 0, 'windows-exception': 0 }
  const printed = []
  for (const candidate of report.candidates) {
    const why = notOurs(candidate)
    if (why) {
      io.err(`quarantine-suggest: skip ${candidate.test}: ${why}`)
      continue
    }
    const entry = entryOf(candidate, now)
    const has = tests.get(`${entry.runner}\0${entry.file}\0${entry.test}`)
    if (has !== undefined) {
      io.err(`quarantine-suggest: skip ${candidate.test}: test/quarantine/${has}.json already has it`)
      continue
    }
    let id = entryId(candidate)
    for (let n = 2; ids.has(id); n++) id = `${entryId(candidate)}-${n}`
    ids.add(id)
    tests.set(`${entry.runner}\0${entry.file}\0${entry.test}`, id)
    added[candidate.kind === 'windows-exception' ? 'windows-exception' : 'quarantine']++
    printed.push(`test/quarantine/${id}.json\n${JSON.stringify(entry, null, 2)}\n`)
  }

  const count = (kind) => existing.filter((e) => e.kind === kind).length + added[kind]
  if (added.quarantine > 0 && count('quarantine') > MAX_ENTRIES) {
    io.err(`quarantine-suggest: warning: with these the quarantine would hold ${count('quarantine')} entries, at most ${MAX_ENTRIES}: fix a test before quarantining another`)
  }
  if (added['windows-exception'] > 0 && count('windows-exception') > MAX_WINDOWS_EXCEPTIONS) {
    io.err(`quarantine-suggest: warning: with these there would be ${count('windows-exception')} Windows exceptions, at most ${MAX_WINDOWS_EXCEPTIONS}: fix a test before adding another`)
  }
  io.out(printed.length > 0 ? printed.join('\n') : 'no candidates in the report\n')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = quarantineSuggest(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (line) => process.stderr.write(`${line}\n`),
  })
}
