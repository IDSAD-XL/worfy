#!/usr/bin/env node
// Checks the form of the state file HANDOFF.md (owner's decision H4 of 2026-10-08):
//
//   node scripts/check-handoff.mjs [<path>]     (part of pnpm lint; default: HANDOFF.md at the repo root)
//
// HANDOFF.md is a snapshot for whoever picks the work up tomorrow, not a log. The limits keep it one:
//   - at most 150 lines and 15360 bytes, counted with LF line ends (a CRLF working copy counts the same);
//   - no line longer than 300 characters;
//   - second-level headings are exactly the five sections below, each once, in this order.
// Headings inside fenced code blocks do not count. Every violation is printed to stderr as
// `<file>:<line>: <what is wrong>`, and the exit code is 1. A clean file prints one line,
// `handoff: ok (N строк, M байт)`, and exits 0. A file that cannot be read exits 2.

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const MAX_LINES = 150
const MAX_BYTES = 15360
const MAX_LINE_CHARS = 300
const SECTIONS = ['Сейчас в работе', 'Ждёт владельца', 'Риски и долги', 'Дальше', 'Где остальное']

const arg = process.argv[2]
const path = arg ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'HANDOFF.md')
const name = arg ?? 'HANDOFF.md'

let buffer
try {
  buffer = readFileSync(path)
} catch (error) {
  process.stderr.write(`${name}: не читается: ${error instanceof Error ? error.message : String(error)}\n`)
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
  report(MAX_LINES + 1, `файл длиннее ${MAX_LINES} строк (${lines.length}); подробности — в «Итог» Ticket-ов, spec, ADR`)
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
  report(at, `файл больше ${MAX_BYTES} байт (${size}); предел пройден на этой строке`)
}

const headings = [] // { line, title }
let fence = null // the opening fence (``` or ~~~, with its length) of the code block we are in
for (const [index, line] of lines.entries()) {
  const number = index + 1
  const chars = Array.from(line).length
  if (chars > MAX_LINE_CHARS) report(number, `строка длиннее ${MAX_LINE_CHARS} символов (${chars})`)

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

const seen = new Map() // title -> line of its first heading
let expected = 0 // index in SECTIONS of the next section the order allows
for (const { line, title } of headings) {
  const position = SECTIONS.indexOf(title)
  if (position === -1) {
    report(line, `раздел «${title}» не из пяти разрешённых: ${SECTIONS.map((s) => `«${s}»`).join(', ')}`)
  } else if (seen.has(title)) {
    report(line, `раздел «${title}» повторяется (первый — строка ${seen.get(title)})`)
  } else {
    seen.set(title, line)
    if (position < expected) {
      report(line, `раздел «${title}» не на своём месте; порядок: ${SECTIONS.map((s) => `«${s}»`).join(', ')}`)
    } else {
      expected = position + 1
    }
  }
}
for (const title of SECTIONS) {
  if (!seen.has(title)) report(1, `нет раздела «${title}» (заголовок «## ${title}»)`)
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.stderr.write(`handoff: форма нарушена (${problems.length}): снимок для того, кто садится за работу завтра, — подробности в «Итог» Ticket-ов, spec Epic-ов, ADR, docs/lessons/\n`)
  process.exit(1)
}
process.stdout.write(`handoff: ok (${lines.length} строк, ${size} байт)\n`)
