#!/usr/bin/env node
// Reports the translations of Feature pages that lag behind their English version (owner's decision Q12
// of 2026-10-30). Not part of pnpm lint: a translation may lag.
//
//   node scripts/feature-docs-lag.mjs [<repo root>]
//       default: this repository
//
// The rule is the section "Translation" of docs/features/README.md. The first line under the heading of
// docs/features/ru/<page>.md names a commit, and it is matched by its Latin marker alone (HEADER), so this
// script names no word of the translation:
//   - a SHA: the last commit that changed the English file the translation was made from;
//   - same-pr: both files came in one pull request; the count starts at the last commit that changed the
//     Russian file.
// A page is behind when its English file has commits after that one. A translation that holds one line
// and has no header is a stub, and it is skipped while the English file is a stub too.
//
// The report goes to stdout: one line per page behind, then a line of totals. Exit code 0 means it was
// printed, empty included. Exit code 1 means a translation has no header or an unreadable one, its commit
// is not found in the history of HEAD, or its English file is gone: each as a line on stderr, and the
// report still covers the other pages. Exit code 2 means the folder of translations or a file cannot be
// read, or the root is not a git repository with a commit.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { SCRIPTS, stop } from './doc-headings.mjs'

const FEATURES = 'docs/features'
const TRANSLATIONS = `${FEATURES}/ru`
const SAME_PR = 'same-pr'
const HEADER = /^> .*, commit `(same-pr|[0-9a-f]{7,40})`\.$/
const STUB = 'This page is not written yet.'

const message = (error) => (error instanceof Error ? error.message : String(error))

const args = process.argv.slice(2)
if (args.length > 1) stop('usage: feature-docs-lag.mjs [<repo root>]')
const root = resolve(args[0] ?? join(SCRIPTS, '..'))

/** Runs git in the repository: its output, trimmed, or undefined when git fails. */
function git(...gitArgs) {
  const child = spawnSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' })
  return child.status === 0 ? child.stdout.trim() : undefined
}

/**
 * The file as `{ line, text }` for each line that is not blank, without the first-level heading it starts
 * with: lines are numbered from 1 and CRLF is read as LF. Without such a heading the list holds every line.
 */
function bodyOf(path) {
  const lines = readFileSync(path, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => text.trim() !== '')
  return lines[0] !== undefined && /^# /.test(lines[0].text) ? lines.slice(1) : lines
}

/** The commit the count starts from; `{ problem }` when there is none. `sha` is the word of the header. */
function startOf(sha, translation) {
  if (sha === SAME_PR) {
    const last = git('log', '-1', '--format=%H', '--', translation)
    return last ? { start: last } : { problem: `${SAME_PR}, and no commit changed this file` }
  }
  const full = git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`)
  if (full === undefined) return { problem: `commit ${sha} not found` }
  if (git('merge-base', '--is-ancestor', full, 'HEAD') === undefined) return { problem: `commit ${sha} not found in the history of HEAD` }
  return { start: full }
}

let files
try {
  files = readdirSync(join(root, TRANSLATIONS))
    .filter((name) => name.endsWith('.md'))
    .sort()
} catch (error) {
  stop(`${TRANSLATIONS}: cannot be read: ${message(error)}`)
}
if (git('rev-parse', '--verify', '--quiet', 'HEAD^{commit}') === undefined) stop(`${root}: not a git repository with a commit`)

const behind = []
const problems = []
let stubs = 0
for (const file of files) {
  const translation = `${TRANSLATIONS}/${file}`
  const english = `${FEATURES}/${file}`
  if (!existsSync(join(root, english))) {
    problems.push(`${translation}: the English file ${english} does not exist`)
    continue
  }
  let body
  let englishBody
  try {
    body = bodyOf(join(root, translation))
    englishBody = bodyOf(join(root, english))
  } catch (error) {
    stop(`${translation}: cannot be read: ${message(error)}`)
  }
  const header = body[0] === undefined ? null : HEADER.exec(body[0].text)
  if (header === null) {
    if (body.length === 1 && englishBody.length === 1 && englishBody[0].text === STUB) {
      stubs += 1
    } else {
      problems.push(`${translation}:${body[0]?.line ?? 1}: no translation header: the first line under the heading is "> ..., commit \`<SHA or ${SAME_PR}>\`."`)
    }
    continue
  }
  const { start, problem } = startOf(header[1], translation)
  if (problem !== undefined) {
    problems.push(`${translation}:${body[0].line}: ${problem}`)
    continue
  }
  const count = Number(git('rev-list', '--count', `${start}..HEAD`, '--', english))
  if (count > 0) behind.push(`${translation}: ${english} has ${count} ${count === 1 ? 'commit' : 'commits'} after ${start.slice(0, 8)}`)
}

for (const line of behind) process.stdout.write(`${line}\n`)
process.stdout.write(`feature docs lag: ${behind.length} behind (${files.length} checked, ${stubs} not written yet)\n`)
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
