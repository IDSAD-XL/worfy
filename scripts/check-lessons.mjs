#!/usr/bin/env node
// Checks that every lesson names what guards it (owner's decision of 2026-10-16, option В2):
//
//   node scripts/check-lessons.mjs [<repo root>]     (part of pnpm lint; default: this repository)
//
// A lesson is a `##` heading in docs/lessons/*.md; README.md describes the format and holds no lessons.
// Each lesson has exactly one line that starts with `Проверка:`, in one of two forms (docs/lessons/README.md):
//   Проверка: <path>:<line>[ — <explanation>]
//       one line of the test (test/…), hook test (harness/hooks/tests/…), Harness script test
//       (harness/bin/tests/…) or eval case (harness/evals/…) that goes red when the lesson is broken;
//       the path is relative to the repository root;
//   Проверка: проверки нет: <почему>
//       an honest gap, with a reason that is not blank.
// The file must exist inside the repository and the line must be inside the file, so a deleted or
// shortened test shows up here. Headings inside fenced code blocks do not count. Every violation goes
// to stderr as `<file>:<line>: «<heading>»: <what is wrong>`, and the exit code is 1. Clean lessons
// print one line, `lessons: ok (…)`, and exit 0. A folder that cannot be read exits 2.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const LESSONS = 'docs/lessons'
const MARK = 'Проверка:'
const GAP = 'проверки нет:'
const PLACES = ['test/', 'harness/hooks/tests/', 'harness/bin/tests/', 'harness/evals/']

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))

let files
try {
  files = readdirSync(join(root, LESSONS))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
} catch (error) {
  process.stderr.write(`${LESSONS}: не читается: ${error instanceof Error ? error.message : String(error)}\n`)
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

/** What is wrong with the value of one `Проверка:` line; null when nothing is. */
function problemOf(value) {
  if (value.startsWith(GAP)) return value.slice(GAP.length).trim() === '' ? `«${GAP}» без причины` : null
  const match = /^([^\s`,]+):(\d+)(?: — .+)?$/.exec(value)
  if (!match) return `«${value}» — не «<путь>:<строка>» и не «${GAP} <почему>»`
  const [, path, number] = match
  const absolute = resolve(root, path)
  const inside = relative(root, absolute)
  if (isAbsolute(path) || path.startsWith('~') || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return `${path} — путь вне репозитория`
  }
  const place = inside.split(sep).join('/')
  if (!PLACES.some((prefix) => place.startsWith(prefix))) {
    return `${path} — не test: путь не начинается с ${PLACES.slice(0, -1).join(', ')} или ${PLACES.at(-1)}`
  }
  if (!targets.has(place)) {
    let state
    try {
      state = statSync(absolute).isFile() ? linesOf(absolute).length : 'не файл'
    } catch {
      state = 'такого файла нет'
    }
    targets.set(place, state)
  }
  const count = targets.get(place)
  if (typeof count === 'string') return `${path} — ${count}`
  const line = Number(number)
  if (line < 1) return `${path}:${number} — строки считаются с 1`
  if (line > count) return `${path}:${number} — за концом файла (в нём ${count} ${plural(count, 'строка', 'строки', 'строк')})`
  return null
}

function plural(count, one, few, many) {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 14) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}

const problems = []
let total = 0
let gaps = 0
for (const file of files) {
  const name = `${LESSONS}/${file}`
  let lines
  try {
    lines = linesOf(join(root, LESSONS, file))
  } catch (error) {
    process.stderr.write(`${name}: не читается: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
  for (const lesson of lessonsOf(lines)) {
    total += 1
    if (lesson.checks.length === 0) {
      problems.push(`${name}:${lesson.line}: «${lesson.title}»: нет строки «${MARK}» — «${MARK} <путь>:<строка>» test-а, test-а hook-а или eval-кейса, или «${MARK} ${GAP} <почему>»`)
      continue
    }
    const [first, ...more] = lesson.checks
    if (first.value.startsWith(GAP)) gaps += 1
    const problem = problemOf(first.value)
    if (problem !== null) problems.push(`${name}:${first.line}: «${lesson.title}»: ${problem}`)
    for (const extra of more) {
      problems.push(`${name}:${extra.line}: «${lesson.title}»: вторая строка «${MARK}» — у урока она одна (первая — строка ${first.line})`)
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.stderr.write(`lessons: нарушений ${problems.length} — у каждого урока строка «${MARK} <путь>:<строка>» того, что его сторожит, или «${MARK} ${GAP} <почему>» (docs/lessons/README.md)\n`)
  process.exit(1)
}
const linked = total - gaps
process.stdout.write(`lessons: ok (${total} ${plural(total, 'урок', 'урока', 'уроков')}: ${linked} со ссылкой, ${gaps} без проверки)\n`)
