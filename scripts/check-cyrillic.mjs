#!/usr/bin/env node
// No Cyrillic in the code of the repository: src/, scripts/, test/ and harness/. Comments, names,
// log messages and test names are English; the documents of the Project (tickets, ADRs, HANDOFF.md)
// are not code and are not checked.
//
//   node scripts/check-cyrillic.mjs [--root <dir>]   → exit 0 clean, 1 with one line per finding
//
// The file has two halves:
//   - noCyrillic, an ESLint rule; eslint.config.js turns it on for the JS and TS files `eslint .` reads;
//   - the command, for the files ESLint does not read: shell scripts (.sh, .zsh, .bash), extensionless
//     scripts (a `node` shebang is read as JavaScript with the same rule, any other line by line as
//     shell), the Markdown of harness/ (the text the plugin ships to agents) and .css, .html, .yaml.
//     JSON files are data and are not checked (harness/lib/input-words.json holds the Russian words
//     of ticket input on purpose).
//
// Where Cyrillic is allowed:
//   - comments and test names (the first argument of describe, it and test): nowhere;
//   - test/fixtures/**: everywhere (the Russian documents tests read);
//   - test files — under test/, in a tests/ folder, *.test.* or *.spec.*, and the eval cases of
//     harness/evals/ — outside comments: the Russian input a test feeds a parser, with an English
//     comment saying why;
//   - the statement right after a comment with the marker `shortcut: accepts the old Russian token`:
//     a reader that still accepts an old Russian word for one release. In JS and TS the marker
//     comment covers the statement, declaration or object member that starts at the next token,
//     to its end; a marker after code on the same line covers that line alone. In a shell script it
//     covers the next command: its first line, the lines continued with a trailing backslash or an
//     open quote, and a heredoc it opens; a marker after code on the same line covers that command
//     alone. In Markdown an HTML comment
//     `<!-- shortcut: accepts the old Russian token … -->` (in the front matter a YAML comment
//     `# shortcut: …`) covers the lines up to the next blank line or `---`.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'

const CYRILLIC = /\p{Script=Cyrillic}/u
export const MARKER = 'shortcut: accepts the old Russian token'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')


const MESSAGES = {
  comment: 'Cyrillic in a comment: comments are English everywhere.',
  testName: 'Cyrillic in a test name: test names are English, as comments are.',
  code: 'Cyrillic outside a comment: allowed only in test files, test/fixtures/ and the statement after a `shortcut: accepts the old Russian token` comment.',
}

/** A path relative to the root, with forward slashes; undefined when it is outside the root. */
function relPath(root, file) {
  const rel = relative(root, isAbsolute(file) ? file : resolve(root, file))
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/** 'out' (not checked), 'fixture' (not checked), 'test' (data allowed outside comments) or 'code'. */
export function kindOf(rel) {
  if (rel === undefined || !/^(src|scripts|test|harness)\//.test(rel)) return 'out'
  if (rel.startsWith('test/fixtures/')) return 'fixture'
  if (rel.startsWith('test/') || rel.startsWith('harness/evals/') || /(^|\/)tests\//.test(rel) || /\.(test|spec)\.[^/]+$/.test(rel)) return 'test'
  return 'code'
}

const TEST_CALLS = new Set(['describe', 'it', 'test'])

/** True for the callee of a test or a suite: it(…), it.each(…)(…), test.describe(…), describe.skip(…). */
function isTestCallee(node) {
  if (node.type === 'Identifier') return TEST_CALLS.has(node.name)
  if (node.type === 'MemberExpression') return isTestCallee(node.object)
  if (node.type === 'CallExpression') return isTestCallee(node.callee)
  return false
}

/**
 * The source range a marker comment covers: after code on the same line, that line up to the
 * comment; otherwise from the comment to the end of the node at the next token.
 */
function markedRange(sourceCode, comment) {
  const before = sourceCode.getTokenBefore(comment, { includeComments: false })
  if (before && before.loc.end.line === comment.loc.start.line) {
    return [sourceCode.getIndexFromLoc({ line: comment.loc.start.line, column: 0 }), comment.range[1]]
  }
  const token = sourceCode.getTokenAfter(comment, { includeComments: false })
  if (!token) return undefined
  let node = sourceCode.getNodeByRangeIndex(token.range[0])
  if (!node) return undefined
  while (node.parent && node.parent.type !== 'Program' && node.parent.range[0] === token.range[0]) node = node.parent
  return [comment.range[0], node.range[1]]
}

export const noCyrillic = {
  meta: {
    type: 'problem',
    docs: { description: 'No Cyrillic in code: comments never, data only in tests, fixtures and marked statements' },
    schema: [],
    messages: MESSAGES,
  },
  create(context) {
    const rel = relPath(context.cwd, context.filename)
    const kind = kindOf(rel)
    if (kind === 'out' || kind === 'fixture') return {}
    return {
      CallExpression(node) {
        // A test name is a string, but not data: it is read by people, as a comment is.
        const name = node.arguments[0]
        if (kind !== 'test' || !name || !isTestCallee(node.callee)) return
        if (name.type !== 'Literal' && name.type !== 'TemplateLiteral') return
        if (CYRILLIC.test(context.sourceCode.getText(name))) context.report({ node: name, messageId: 'testName' })
      },
      Program() {
        const sourceCode = context.sourceCode
        const covered = []
        for (const comment of sourceCode.getAllComments()) {
          if (CYRILLIC.test(comment.value)) context.report({ loc: comment.loc, messageId: 'comment' })
          if (comment.value.includes(MARKER)) {
            const range = markedRange(sourceCode, comment)
            if (range) covered.push(range)
          }
        }
        if (kind === 'test') return
        for (const token of sourceCode.ast.tokens) {
          if (!CYRILLIC.test(token.value)) continue
          if (covered.some(([start, end]) => token.range[0] >= start && token.range[1] <= end)) continue
          context.report({ loc: token.loc, messageId: 'code' })
        }
      },
    }
  },
}

// ── the command ───────────────────────────────────────────────────────────────────────────────

/**
 * Splits each line of a shell script into its code and its comment. Tracks quotes across lines and
 * heredoc bodies (their lines are data, with no comment). `continues` — the next line belongs to
 * the same command: a trailing backslash, an open quote or an open heredoc. Every heredoc a line
 * opens is read, in order. Inside `(( … ))` and `$(( … ))` a `<<` is a shift, not a heredoc; the
 * depth is counted per line, so a `((` that is two nested subshells turns nothing off past its
 * line. `<<<` is a here-string and opens nothing.
 */
function shellLines(lines) {
  const out = []
  let quote = null
  const heredocs = []
  for (const line of lines) {
    if (heredocs.length > 0) {
      const heredoc = heredocs[0]
      const done = (heredoc.strip ? line.replace(/^\t+/, '') : line) === heredoc.delim
      if (done) heredocs.shift()
      out.push({ code: line, comment: '', continues: heredocs.length > 0 })
      continue
    }
    let code = ''
    let comment = ''
    let arith = 0
    for (let i = 0; i < line.length; ) {
      const c = line[i]
      if (quote === "'") {
        code += c
        if (c === "'") quote = null
        i++
      } else if (c === '\\') {
        code += line.slice(i, i + 2)
        i += 2
      } else if (quote === '"') {
        code += c
        if (c === '"') quote = null
        i++
      } else if (c === "'" || c === '"') {
        quote = c
        code += c
        i++
      } else if (c === '#' && (i === 0 || /[\s;&|()]/.test(line[i - 1]))) {
        comment = line.slice(i)
        break
      } else if (c === '(' && line[i + 1] === '(') {
        arith++
        code += '(('
        i += 2
      } else if (c === ')' && line[i + 1] === ')' && arith > 0) {
        arith--
        code += '))'
        i += 2
      } else if (line.startsWith('<<<', i)) {
        code += '<<<'
        i += 3
      } else {
        // The delimiter: a word (dashes allowed), in quotes or after a backslash.
        const here = c === '<' && arith === 0 ? /^<<(-?)[ \t]*(?:\\([A-Za-z_][\w-]*)|(['"])([A-Za-z_][\w-]*)\3|([A-Za-z_][\w-]*))/.exec(line.slice(i)) : null
        if (here) {
          heredocs.push({ delim: here[2] ?? here[4] ?? here[5], strip: here[1] === '-' })
          code += here[0]
          i += here[0].length
        } else {
          code += c
          i++
        }
      }
    }
    out.push({ code, comment, continues: quote !== null || heredocs.length > 0 || /\\$/.test(code) })
  }
  return out
}

/** Findings of a shell script: [line number, message id]. */
function checkShell(kind, lines) {
  const found = []
  const parsed = shellLines(lines)
  let cover = 'none' // 'none' | 'seek' (after a marker, before its command) | 'in' (inside the command)
  parsed.forEach(({ code, comment, continues }, index) => {
    const marker = comment.includes(MARKER)
    if (marker) cover = code.trim() ? 'in' : 'seek'
    else if (cover === 'seek' && code.trim()) cover = 'in'
    if (CYRILLIC.test(comment)) found.push([index + 1, 'comment'])
    if (kind === 'code' && cover !== 'in' && CYRILLIC.test(code)) found.push([index + 1, 'code'])
    if (cover === 'in' && !continues) cover = 'none'
  })
  return found
}

/**
 * Findings of the Markdown of harness/: every line with Cyrillic outside a marked paragraph. The
 * marker is an HTML comment, or a YAML comment in the front matter (`# shortcut: …`), where an HTML
 * comment would break the YAML; it covers the lines up to the next blank line or `---`.
 */
function checkMarkdown(lines) {
  const found = []
  let covered = false
  lines.forEach((line, index) => {
    if (line.includes(MARKER) && (line.includes('<!--') || /^#\s/.test(line))) covered = true
    else if (!line.trim() || line.trim() === '---') covered = false
    if (!covered && CYRILLIC.test(line)) found.push([index + 1, 'code'])
  })
  return found
}

/** Findings of a Node script without an extension, read with the ESLint rule. */
function checkNodeScript(root, file, text) {
  const linter = new Linter({ cwd: root })
  const rel = relPath(root, file)
  let messages = []
  for (const sourceType of ['module', 'commonjs']) {
    messages = linter.verify(
      text,
      [
        {
          files: [rel],
          languageOptions: { ecmaVersion: 'latest', sourceType },
          plugins: { worfy: { rules: { 'no-cyrillic': noCyrillic } } },
          rules: { 'worfy/no-cyrillic': 'error' },
        },
      ],
      { filename: file },
    )
    if (!messages.some((m) => m.fatal)) break
  }
  return messages.map((m) => [m.line, m.fatal ? `could not read as JavaScript: ${m.message}` : m.messageId])
}

const SHELL = new Set(['.sh', '.zsh', '.bash'])
const PLAIN = new Set(['.css', '.html', '.yaml', '.yml'])

/** Findings of one file the command reads; [] for a file it leaves to ESLint or does not check. */
export function checkFile(root, file) {
  const rel = relPath(root, file)
  const kind = kindOf(rel)
  if (kind === 'out' || kind === 'fixture') return []
  const ext = extname(file)
  const isMarkdown = ext === '.md' && rel.startsWith('harness/')
  if (!SHELL.has(ext) && !PLAIN.has(ext) && ext !== '' && !isMarkdown) return []
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  if (isMarkdown) return kind === 'test' ? [] : checkMarkdown(lines)
  if (PLAIN.has(ext)) return lines.flatMap((line, i) => (CYRILLIC.test(line) ? [[i + 1, 'code']] : []))
  if (ext === '' && /^#!.*\bnode\b/.test(lines[0])) return checkNodeScript(root, file, text)
  return checkShell(kind, lines)
}

/** Every file under the four code folders, node_modules left out. */
function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

function main(argv) {
  const at = argv.indexOf('--root')
  const root = resolve(at >= 0 ? argv[at + 1] : REPO)
  let count = 0
  for (const top of ['src', 'scripts', 'test', 'harness']) {
    for (const file of walk(join(root, top))) {
      for (const [line, what] of checkFile(root, file)) {
        process.stderr.write(`${relPath(root, file)}:${line}: ${MESSAGES[what] ?? what}\n`)
        count++
      }
    }
  }
  if (count > 0) {
    process.stderr.write(`check-cyrillic: ${count} line(s) with Cyrillic outside the allowed places\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && basename(resolve(process.argv[1])) === basename(fileURLToPath(import.meta.url))) main(process.argv.slice(2))
