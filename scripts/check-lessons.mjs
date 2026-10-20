#!/usr/bin/env node
// Checks that every lesson names what guards it (owner's decision of 2026-10-16, option B2):
//
//   node scripts/check-lessons.mjs [--headings <file>] [<repo root>]
//       part of pnpm lint; default: this repository, the words of scripts/doc-headings.json
//
// A lesson is a `##` heading in docs/lessons/*.md; README.md describes the format and holds no lessons.
// Each lesson has exactly one check line: it starts with the mark `lessons.check` of the headings config
// (<mark> below), in one of two forms (docs/lessons/README.md):
//   <mark> <path>:<line>[ — <explanation>]
//       one line of the test (test/…), hook test (harness/hooks/tests/…), Harness script test
//       (harness/bin/tests/…) or eval case (harness/evals/…) that goes red when the lesson is broken;
//       the path is relative to the repository root;
//   <mark> <no check> <reason>
//       an honest gap, with a reason that is not blank; <no check> is `lessons.no_check` of the config.
// The config is data in the language of the repository's documents, so this script names neither word.
// The file must exist inside the repository and the line must be inside the file, so a deleted or
// shortened test shows up here. Headings inside fenced code blocks do not count. Every violation goes
// to stderr as `<file>:<line>: "<heading>": <what is wrong>`, and the exit code is 1. Clean lessons
// print one line, `lessons: ok (…)`, and exit 0. A folder or a headings config that cannot be read exits 2.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { readCommandLine, SCRIPTS, stop, word } from './doc-headings.mjs'

const LESSONS = 'docs/lessons'
const PLACES = ['test/', 'harness/hooks/tests/', 'harness/bin/tests/', 'harness/evals/']
const { arg, config } = readCommandLine('check-lessons.mjs', 'repo root')
const root = resolve(arg ?? join(SCRIPTS, '..'))
const MARK = word(config.json?.lessons?.check)
const GAP = word(config.json?.lessons?.no_check)
if (MARK === undefined || GAP === undefined) {
  stop(`${config.path}: lessons.check and lessons.no_check are non-empty strings, got ${JSON.stringify(config.json?.lessons)}`)
}
const message = (error) => (error instanceof Error ? error.message : String(error))

let files
try {
  files = readdirSync(join(root, LESSONS))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
} catch (error) {
  process.stderr.write(`${LESSONS}: cannot be read: ${message(error)}\n`)
  process.exit(2)
}

/** The lines of a text file as git stores it: CRLF read as LF, the final newline starts no line. */
function linesOf(path) {
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** Lessons of one file: { line, title, checks: [{ line, value }] }, `##` in code blocks skipped. */
function lessonsOf(lines) {
  const lessons = []
  let fence = null // the opening fence (``` or ~~~, with its length) of the code block we are in
  for (const [index, line] of lines.entries()) {
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
    if (heading) {
      lessons.push({ line: index + 1, title: heading[1].replace(/[ \t]+#+[ \t]*$/, '').trim(), checks: [] })
    } else if (/^ {0,3}#(?=[ \t]|$)/.test(line)) {
      lessons.push(null) // a first-level heading ends the lesson above it
    } else if (line.startsWith(MARK) && lessons.at(-1)) {
      lessons.at(-1).checks.push({ line: index + 1, value: line.slice(MARK.length).trim() })
    }
  }
  return lessons.filter(Boolean)
}

const targets = new Map() // repo-relative path -> number of lines, or a string saying what is wrong

/** What is wrong with the value of one check line; null when nothing is. */
function problemOf(value) {
  if (value.startsWith(GAP)) return value.slice(GAP.length).trim() === '' ? `"${GAP}" without a reason` : null
  const match = /^([^\s`,]+):(\d+)(?: — .+)?$/.exec(value)
  if (!match) return `"${value}" is neither "<path>:<line>" nor "${GAP} <reason>"`
  const [, path, number] = match
  const absolute = resolve(root, path)
  const inside = relative(root, absolute)
  if (isAbsolute(path) || path.startsWith('~') || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return `${path} — a path outside the repository`
  }
  const place = inside.split(sep).join('/')
  if (!PLACES.some((prefix) => place.startsWith(prefix))) {
    return `${path} — not a test: the path starts with none of ${PLACES.slice(0, -1).join(', ')} or ${PLACES.at(-1)}`
  }
  if (!targets.has(place)) {
    let state
    try {
      state = statSync(absolute).isFile() ? linesOf(absolute).length : 'not a file'
    } catch {
      state = 'no such file'
    }
    targets.set(place, state)
  }
  const count = targets.get(place)
  if (typeof count === 'string') return `${path} — ${count}`
  const line = Number(number)
  if (line < 1) return `${path}:${number} — lines are counted from 1`
  if (line > count) return `${path}:${number} — past the end of the file (it has ${plural(count, 'line')})`
  return null
}

/** `1 line`, `3 lines`. */
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const problems = []
let total = 0
let gaps = 0
for (const file of files) {
  const name = `${LESSONS}/${file}`
  let lines
  try {
    lines = linesOf(join(root, LESSONS, file))
  } catch (error) {
    process.stderr.write(`${name}: cannot be read: ${message(error)}\n`)
    process.exit(2)
  }
  for (const lesson of lessonsOf(lines)) {
    total += 1
    if (lesson.checks.length === 0) {
      problems.push(`${name}:${lesson.line}: "${lesson.title}": no "${MARK}" line — "${MARK} <path>:<line>" of a test, a hook test or an eval case, or "${MARK} ${GAP} <reason>"`)
      continue
    }
    const [first, ...more] = lesson.checks
    if (first.value.startsWith(GAP)) gaps += 1
    const problem = problemOf(first.value)
    if (problem !== null) problems.push(`${name}:${first.line}: "${lesson.title}": ${problem}`)
    for (const extra of more) {
      problems.push(`${name}:${extra.line}: "${lesson.title}": a second "${MARK}" line — a lesson has one (the first is line ${first.line})`)
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.stderr.write(`lessons: ${plural(problems.length, 'violation')} — every lesson has a line "${MARK} <path>:<line>" of what guards it, or "${MARK} ${GAP} <reason>" (docs/lessons/README.md)\n`)
  process.exit(1)
}
const linked = total - gaps
process.stdout.write(`lessons: ok (${plural(total, 'lesson')}: ${linked} linked, ${gaps} without a check)\n`)
