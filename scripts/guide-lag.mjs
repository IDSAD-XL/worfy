#!/usr/bin/env node
// Reports the Topics of the worfy Guide that lag behind (worfy-guide ticket 03, ADR-0090). Not part of
// pnpm lint, like scripts/feature-docs-lag.mjs: a Topic may lag, by design that does not fail a PR.
//
//   node scripts/guide-lag.mjs [<repo root>]
//       default: this repository
//
// A Topic is a folder src/renderer/guide/topics/<id>/ (src/renderer/guide/content.ts). Two lags:
//   - behind its page: topic.json names each page of docs/features/ the Topic was checked against and
//     the commit it was checked at; the page has commits after that one;
//   - behind its English text: the last commit that changed ru.json is older than commits that changed
//     en.json since. A commit that changes both counts as a translation of that English text.
//     shortcut: any later commit to ru.json counts as catching up, a typo fix included; when that
//     misleads in practice, give ru.json the commit of the en.json it was translated from, as the
//     translations of docs/features/ carry it.
//
// The report goes to stdout: one line per lag, then a line of totals. Exit code 0 means it was printed,
// empty included. Exit code 1 means a topic.json cannot be read or names no sources, a commit or a page
// it names is not found, or a text has no commit: each as a line on stderr, and the report still covers
// the rest. Exit code 2 means the folder of Topics cannot be read, or the root is not a git repository
// with a commit.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { SCRIPTS, stop } from './doc-headings.mjs'

const TOPICS = 'src/renderer/guide/topics'
const SHA = /^[0-9a-f]{7,40}$/

const message = (error) => (error instanceof Error ? error.message : String(error))

const args = process.argv.slice(2)
if (args.length > 1) stop('usage: guide-lag.mjs [<repo root>]')
const root = resolve(args[0] ?? join(SCRIPTS, '..'))

/** Runs git in the repository: its output, trimmed, or undefined when git fails. */
function git(...gitArgs) {
  const child = spawnSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' })
  return child.status === 0 ? child.stdout.trim() : undefined
}

const plural = (count) => `${count} ${count === 1 ? 'commit' : 'commits'}`

if (git('rev-parse', '--verify', '--quiet', 'HEAD^{commit}') === undefined) stop(`${root}: not a git repository with a commit`)

let ids
try {
  ids = readdirSync(join(root, TOPICS), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, TOPICS, entry.name, 'topic.json')))
    .map((entry) => entry.name)
    .sort()
} catch (error) {
  stop(`${TOPICS}: cannot be read: ${message(error)}`)
}

const lines = []
const problems = []
let pagesBehind = 0
let translationsBehind = 0

/** The commit `sha` names, when it is in the history of HEAD; `{ problem }` otherwise. */
function commitOf(sha) {
  const full = git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`)
  if (full === undefined) return { problem: `commit ${sha} not found` }
  if (git('merge-base', '--is-ancestor', full, 'HEAD') === undefined) return { problem: `commit ${sha} not found in the history of HEAD` }
  return { full }
}

for (const id of ids) {
  const folder = `${TOPICS}/${id}`
  const metaPath = `${folder}/topic.json`
  let meta
  try {
    meta = JSON.parse(readFileSync(join(root, metaPath), 'utf8'))
  } catch (error) {
    problems.push(`${metaPath}: cannot be read: ${message(error)}`)
    meta = undefined
  }
  if (meta !== undefined) {
    const sources = Array.isArray(meta?.sources) ? meta.sources : []
    if (sources.length === 0) problems.push(`${metaPath}: no sources: it names no page of docs/features/ it was checked against`)
    for (const source of sources) {
      const page = source?.page
      const sha = source?.sha
      if (typeof page !== 'string' || typeof sha !== 'string' || !SHA.test(sha)) {
        problems.push(`${metaPath}: a source is not { "page": "<path>", "sha": "<7 to 40 hex>" }`)
        continue
      }
      if (git('cat-file', '-e', `HEAD:${page}`) === undefined) {
        problems.push(`${metaPath}: ${page} does not exist at HEAD`)
        continue
      }
      const { full, problem } = commitOf(sha)
      if (problem !== undefined) {
        problems.push(`${metaPath}: ${problem}`)
        continue
      }
      const count = Number(git('rev-list', '--count', `${full}..HEAD`, '--', page))
      if (count > 0) {
        pagesBehind += 1
        lines.push(`${id}: ${page} has ${plural(count)} after ${full.slice(0, 8)}`)
      }
    }
  }

  const english = `${folder}/en.json`
  const russian = `${folder}/ru.json`
  const lastRussian = git('log', '-1', '--format=%H', '--', russian)
  if (!lastRussian) {
    problems.push(`${russian}: no commit has this file`)
    continue
  }
  const count = Number(git('rev-list', '--count', `${lastRussian}..HEAD`, '--', english))
  if (count > 0) {
    translationsBehind += 1
    lines.push(`${id}: ${russian} is behind ${english} by ${plural(count)}`)
  }
}

for (const line of lines) process.stdout.write(`${line}\n`)
process.stdout.write(`guide lag: ${pagesBehind} behind their pages, ${translationsBehind} translations behind (${ids.length} Topics checked)\n`)
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
