#!/usr/bin/env node
// Checks the form of the state file HANDOFF.md (owner's decision H4 of 2026-10-08):
//
//   node scripts/check-handoff.mjs [--headings <file>] [<path>]
//       part of pnpm lint; default: HANDOFF.md at the repo root, the sections of scripts/doc-headings.json
//
// HANDOFF.md is a snapshot for whoever picks the work up tomorrow, not a log. The limits keep it one:
//   - at most 150 lines and 15360 bytes, counted with LF line ends (a CRLF working copy counts the same);
//   - no line longer than 300 characters;
//   - second-level headings are exactly the sections of `handoff.sections` in the headings config, each
//     once, in that order. The config is data in the language of the repository's documents, so this
//     script names no section itself.
// Headings inside fenced code blocks do not count. Every violation is printed to stderr as
// `<file>:<line>: <what is wrong>`, and the exit code is 1. A clean file prints one line,
// `handoff: ok (N lines, M bytes)`, and exits 0. A file or a headings config that cannot be read exits 2.

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { readCommandLine, SCRIPTS, stop, word } from './doc-headings.mjs'

const MAX_LINES = 150
const MAX_BYTES = 15360
const MAX_LINE_CHARS = 300
const { arg, config } = readCommandLine('check-handoff.mjs', 'path')
const path = arg ?? join(SCRIPTS, '..', 'HANDOFF.md')
const name = arg ?? 'HANDOFF.md'
const given = config.json?.handoff?.sections
const SECTIONS = Array.isArray(given) ? given.map(word) : []
if (SECTIONS.length === 0 || SECTIONS.includes(undefined)) {
  stop(`${config.path}: handoff.sections is a list of section names, got ${JSON.stringify(given)}`)
}
const message = (error) => (error instanceof Error ? error.message : String(error))

let buffer
try {
  buffer = readFileSync(path)
} catch (error) {
  process.stderr.write(`${name}: cannot be read: ${message(error)}\n`)
  process.exit(2)
}

// The limits are on the file as git stores it, with LF line ends. A working copy on Windows
// (core.autocrlf) has CRLF, one more byte per line, so CRLF is read as LF before anything is counted.
const raw = buffer.toString('utf8')
const text = raw.replace(/\r\n/g, '\n')
const size = buffer.length - (raw.length - text.length) // the bytes on disk less one CR per CRLF
const lines = text.split('\n')
if (lines.at(-1) === '') lines.pop() // the newline that ends the last line does not start another one

const problems = []
const report = (line, message) => problems.push(`${name}:${line}: ${message}`)

if (lines.length > MAX_LINES) {
  report(MAX_LINES + 1, `the file is longer than ${MAX_LINES} lines (${lines.length}); the details belong in the tickets, the epic specs, ADRs`)
}

if (size > MAX_BYTES) {
  // Point at the line on which the file crosses the limit.
  let bytes = 0
  let at = lines.length
  for (const [index, line] of lines.entries()) {
    bytes += Buffer.byteLength(line, 'utf8') + 1
    if (bytes > MAX_BYTES) {
      at = index + 1
      break
    }
  }
  report(at, `the file is larger than ${MAX_BYTES} bytes (${size}); the limit is crossed on this line`)
}

const headings = [] // { line, title }
let fence = null // the opening fence (``` or ~~~, with its length) of the code block we are in
for (const [index, line] of lines.entries()) {
  const number = index + 1
  const chars = Array.from(line).length
  if (chars > MAX_LINE_CHARS) report(number, `the line is longer than ${MAX_LINE_CHARS} characters (${chars})`)

  const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  if (fence) {
    if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) {
      fence = null
    }
    continue
  }
  if (fenceMatch) {
    fence = fenceMatch[1]
    continue
  }

  const heading = /^ {0,3}##(?=[ \t]|$)(.*)$/.exec(line)
  if (heading) headings.push({ line: number, title: heading[1].replace(/[ \t]+#+[ \t]*$/, '').trim() })
}

const quoted = (title) => `"${title}"`
const order = SECTIONS.map(quoted).join(', ')
const seen = new Map() // title -> line of its first heading
let expected = 0 // index in SECTIONS of the next section the order allows
for (const { line, title } of headings) {
  const position = SECTIONS.indexOf(title)
  if (position === -1) {
    report(line, `section ${quoted(title)} is not one of the ${SECTIONS.length} allowed: ${order}`)
  } else if (seen.has(title)) {
    report(line, `section ${quoted(title)} repeats (first at line ${seen.get(title)})`)
  } else {
    seen.set(title, line)
    if (position < expected) {
      report(line, `section ${quoted(title)} is out of place; the order: ${order}`)
    } else {
      expected = position + 1
    }
  }
}
for (const title of SECTIONS) {
  if (!seen.has(title)) report(1, `no section ${quoted(title)} (heading "## ${title}")`)
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.stderr.write(`handoff: the form is broken (${problems.length}): a snapshot for whoever picks the work up tomorrow — the details belong in the tickets, the epic specs, ADRs, docs/lessons/\n`)
  process.exit(1)
}
process.stdout.write(`handoff: ok (${lines.length} lines, ${size} bytes)\n`)
