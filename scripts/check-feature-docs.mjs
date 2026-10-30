#!/usr/bin/env node
// Checks that the paths on the English Feature pages exist (owner's decision Q15 of 2026-10-30):
//
//   node scripts/check-feature-docs.mjs [<repo root>]
//       part of pnpm lint; default: this repository
//
// The form of a path is the section "Form of paths" of docs/features/README.md:
//   - inline code without spaces that starts with one of PREFIXES, read from the repository root;
//   - a relative Markdown link (a reference definition and an image too), read from the folder of the
//     page. An external address, a link from the root of the site and an anchor on the same page do not
//     count, and neither the part after # nor the query is part of the path.
// Code in fenced blocks is not read; an indented block is read as text, the form names only fences. A
// token with <, >, * or { is a template and is skipped. The suffix :<number> is dropped before the check:
// the page template forbids line numbers and review catches them, this script does not. A path that
// leaves the repository does not exist in it. docs/features/ru/ is not read: a translation may lag, and a
// lagging one must not break lint after a rename.
//
// Every path that does not exist goes to stderr as `<file>:<line>: <path> does not exist`, and the exit
// code is 1. A clean run prints one line, `feature docs: ok (…)`, and exits 0. A folder or a page that
// cannot be read exits 2.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { SCRIPTS, stop } from './doc-headings.mjs'

const FEATURES = 'docs/features'
const PREFIXES = ['src/', 'test/', 'scripts/', 'harness/', 'docs/', 'build/', '.github/']
const TEMPLATE = /[<>*{]/
const LINE_SUFFIX = /:\d+$/
// A code span: a run of backticks closed by a run of the same length in the same block of text (a blank
// line ends a block), so a stray backtick stays a stray backtick.
const SPAN = /(?<![`\\])(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?)(?<!`)\1(?!`)/g
// The destination of `[text](…)` and `![alt](…)`: in angle brackets, or without spaces and with balanced
// parentheses; a title may follow.
const LINK = /(?<!\\)\]\(\s*(<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g
// `[label]: destination`; `[^1]: text` is a footnote.
const DEFINITION = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(<[^<>\n]*>|\S+)/gm
// A scheme (https:, mailto:) and not the suffix of a bare file name (page.md:12).
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+$)/i

const message = (error) => (error instanceof Error ? error.message : String(error))
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const args = process.argv.slice(2)
if (args.length > 1) stop('usage: check-feature-docs.mjs [<repo root>]')
const root = resolve(args[0] ?? join(SCRIPTS, '..'))

/** The text with the lines of its fenced blocks blank, so every other line keeps its number. */
function withoutFences(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let fence = null // the opening fence (``` or ~~~, with its length) of the block we are in
  for (const [index, line] of lines.entries()) {
    const match = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === '') fence = null
      lines[index] = ''
    } else if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
      fence = match[1]
      lines[index] = ''
    }
  }
  return lines.join('\n')
}

/** The number of the line that holds this offset of the text. */
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

/** The checked paths of one page in document order: { line, path, from }, `from` being the folder it is read from. */
function pathsOf(raw) {
  const text = withoutFences(raw)
  const found = []
  for (const match of text.matchAll(SPAN)) {
    const token = match[2]
    if (/\s/.test(token) || TEMPLATE.test(token) || !PREFIXES.some((prefix) => token.startsWith(prefix))) continue
    found.push({ line: lineAt(text, match.index), path: token.replace(LINE_SUFFIX, ''), from: root })
  }
  // A link written inside inline code is code; a link around inline code keeps its destination.
  const links = text.replace(SPAN, (span) => span.replace(/[^\n]/g, ' '))
  for (const match of [...links.matchAll(LINK), ...links.matchAll(DEFINITION)]) {
    const path = linkPath(match[1])
    if (path !== undefined) found.push({ line: lineAt(links, match.index), path, from: join(root, FEATURES) })
  }
  return found.sort((a, b) => a.line - b.line)
}

/** The file path of a link's destination; undefined when the destination is not a path to check. */
function linkPath(destination) {
  const bare = destination.replace(/^<(.*)>$/, '$1')
  if (SCHEME.test(bare) || bare.startsWith('/')) return undefined
  const [address] = bare.split(/[#?]/)
  if (address === '' || TEMPLATE.test(address)) return undefined
  let path = address
  try {
    path = decodeURIComponent(address)
  } catch {
    // A % that encodes nothing is part of the file name.
  }
  return path.replace(LINE_SUFFIX, '')
}

/** True when the path is inside the repository and exists. */
function exists(from, path) {
  const absolute = resolve(from, path)
  const inside = relative(root, absolute)
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return false
  return existsSync(absolute)
}

let files
try {
  files = readdirSync(join(root, FEATURES))
    .filter((name) => name.endsWith('.md'))
    .sort()
} catch (error) {
  stop(`${FEATURES}: cannot be read: ${message(error)}`)
}

const problems = []
let total = 0
for (const file of files) {
  const name = `${FEATURES}/${file}`
  let raw
  try {
    raw = readFileSync(join(root, FEATURES, file), 'utf8')
  } catch (error) {
    stop(`${name}: cannot be read: ${message(error)}`)
  }
  for (const { line, path, from } of pathsOf(raw)) {
    total += 1
    if (!exists(from, path)) problems.push(`${name}:${line}: ${path} does not exist`)
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`feature docs: ok (${plural(files.length, 'page')}, ${plural(total, 'path')})\n`)
