#!/usr/bin/env node
// Builds the `generated` part of scripts/affected-tests.table.json: which files of the repository each
// test file and test helper reads by path, as a script it starts or a file it reads as text — the
// links vite's module graph does not see (scripts/affected-tests.mjs).
//
//   node scripts/affected-tests-table.mjs           → rewrites `generated` in the table
//   node scripts/affected-tests-table.mjs --check   → exit 0 when the table holds what this builds, 1 when not
//   node scripts/affected-tests-table.mjs --refs <file> → what the parser finds in one file
//
// test/unit/affected-tests.test.ts runs --check: a test that starts reading a file by path makes it
// red until the table is rebuilt. The other parts of the table (`all`, `none`, `links`) are written by
// hand and kept as they are.
//
// The readers are the files under test/ (TypeScript and JavaScript), except the e2e specs, the
// acceptance tests and the fixtures. In each, the TypeScript parser finds the path expressions it can
// evaluate without running the file:
// - `__dirname`, `import.meta.dirname`, `import.meta.filename`, `import.meta.url` through
//   `fileURLToPath` and `dirname`, `new URL('<literal>', import.meta.url)` and `process.cwd()` (the
//   repository root: the tests run from there);
// - `join`, `resolve` and `normalize` (also as `path.join`, `posix.join`…) of such a path and string
//   literals, and the constants that hold one;
// - a template literal that starts with such a path.
// An argument it cannot evaluate (a parameter, a spread, a call) ends the path there: the reader reads
// something under that folder. A path the file uses itself is a reference; a path that only feeds a
// longer one is not. A string literal that spells a tracked file or folder is a reference too — any
// path with a slash, and a bare name ('README.md', 'src') in a file that refers to the repository root.
// References that name no tracked file are dropped (paths in temporary folders, fixtures' own trees).
//
// Each reference becomes `reads` (the reader covers the file or every file under the folder) or
// `scans` (the reader looks at the folder, but that alone does not cover a file under it): a top-level
// folder and the folders in BROAD are scans. The root itself is neither: a name built at run time
// under it is unknown here, and the string literals of the file stand for it.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const TABLE = 'scripts/affected-tests.table.json'
// Folders that hold many unrelated files: a reader that names one reads some file under it, not all.
const BROAD = ['test/unit', 'test/contract', 'test/e2e', 'test/fixtures', 'harness/bin', 'harness/hooks', 'src/main', 'src/renderer', 'src/shared']
const READER = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
// The test of this script and of scripts/affected-tests.mjs: its literals are paths of the repositories
// it builds and of the assertions about the table, not files it reads. Its own row in `links` names what
// it depends on: these scripts, the table, and every test source (--check reads them all).
const NOT_READERS = ['test/unit/affected-tests.test.ts']
const PATH_CALLS = new Set(['join', 'resolve', 'normalize'])

/** A repository-relative path ('' is the root), or undefined when it leaves the repository. */
function clean(path) {
  const normal = posix.normalize(path === '' ? '.' : path)
  if (normal === '.') return ''
  if (normal.startsWith('..') || normal.startsWith('/')) return undefined
  return normal.replace(/\/$/, '')
}

/** The name of a call's callee: `join` for join(…), path.join(…) and posix.join(…). */
function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

const isImportMeta = (node, name) =>
  ts.isPropertyAccessExpression(node) && node.name.text === name && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword

/** The references of one reader. */
function referencesOf(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const dir = posix.dirname(file)
  // name → { path, complete } for constants holding a path; name → string for string constants.
  const paths = new Map()
  const strings = new Map()

  // A value: { path, complete } for a path, { text } for a string, undefined when unknown.
  function evaluate(node) {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return evaluate(node.expression)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text }
    if (ts.isIdentifier(node)) {
      if (node.text === '__dirname') return { path: dir, complete: true }
      if (node.text === '__filename') return { path: file, complete: true }
      if (paths.has(node.text)) return paths.get(node.text)
      if (strings.has(node.text)) return { text: strings.get(node.text) }
      return undefined
    }
    if (isImportMeta(node, 'dirname')) return { path: dir, complete: true }
    if (isImportMeta(node, 'filename') || isImportMeta(node, 'url')) return { path: file, complete: true }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'pathname') return evaluate(node.expression)
    if (ts.isNewExpression(node) && calleeName(node.expression) === 'URL' && node.arguments?.length === 2) {
      const [relative, base] = node.arguments.map(evaluate)
      if (relative?.text !== undefined && base?.path !== undefined) {
        const path = clean(posix.join(posix.dirname(base.path), relative.text))
        return path === undefined ? undefined : { path, complete: true }
      }
      return undefined
    }
    if (ts.isTemplateExpression(node)) {
      if (node.head.text !== '') return undefined
      const first = evaluate(node.templateSpans[0].expression)
      if (first?.path === undefined) return undefined
      const tail = node.templateSpans[0].literal.text
      if (node.templateSpans.length > 1) return { path: clean(posix.join(first.path, posix.dirname(`${tail}x`))) ?? first.path, complete: false }
      const path = clean(posix.join(first.path, tail))
      return path === undefined ? undefined : { path, complete: first.complete }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression)
      if (name === 'cwd' && ts.isPropertyAccessExpression(node.expression)) return { path: '', complete: true }
      if (name === 'fileURLToPath' && node.arguments.length === 1) return evaluate(node.arguments[0])
      if (name === 'dirname' && node.arguments.length === 1) {
        const inner = evaluate(node.arguments[0])
        return inner?.path === undefined ? undefined : { path: clean(posix.dirname(inner.path === '' ? '.' : inner.path)) ?? '', complete: inner.complete }
      }
      if (PATH_CALLS.has(name) && node.arguments.length > 0) {
        let path
        let literalOnly = true
        for (const argument of node.arguments) {
          const value = ts.isSpreadElement(argument) ? undefined : evaluate(argument)
          if (value?.path !== undefined) {
            path = value.path
            literalOnly = false
            if (!value.complete) return { path, complete: false }
          } else if (value?.text !== undefined) {
            path = posix.join(path ?? '', value.text)
          } else {
            const known = path === undefined ? undefined : clean(path)
            return known === undefined ? undefined : literalOnly ? { text: known, partial: true } : { path: known, complete: false }
          }
        }
        if (path === undefined) return undefined
        if (literalOnly) return { text: path }
        const known = clean(path)
        return known === undefined ? undefined : { path: known, complete: true }
      }
    }
    return undefined
  }

  // Constants first, in order, twice: a later one may feed an earlier function's body.
  const declarations = []
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.push(node)
    ts.forEachChild(node, collect)
  }
  collect(source)
  for (let pass = 0; pass < 2; pass++) {
    for (const declaration of declarations) {
      const value = evaluate(declaration.initializer)
      if (value?.path !== undefined) paths.set(declaration.name.text, value)
      else if (value?.text !== undefined && !value.partial) strings.set(declaration.name.text, value.text)
    }
  }

  const refs = new Map() // path → complete
  const literals = new Set()
  const add = (path, complete) => {
    if (path === undefined) return
    refs.set(path, (refs.get(path) ?? false) || complete)
  }
  // Whether `node` only feeds a longer path or a constant: its parent evaluates it.
  const consumed = (node) => {
    const parent = node.parent
    if (!parent) return false
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) return consumed(parent)
    if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
      const name = calleeName(parent.expression)
      if (name === 'fileURLToPath' || name === 'dirname' || PATH_CALLS.has(name)) return evaluate(parent) !== undefined
    }
    if (ts.isNewExpression(parent) && calleeName(parent.expression) === 'URL') return evaluate(parent) !== undefined
    if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'pathname') return true
    if (ts.isTemplateSpan(parent)) return evaluate(parent.parent) !== undefined
    return false
  }
  // Whether the literal `node` is an argument of a path call that resolves to a path.
  const takenWhole = (node) => {
    const parent = node.parent
    if (!ts.isCallExpression(parent) || !parent.arguments.includes(node) || !PATH_CALLS.has(calleeName(parent.expression))) return false
    return evaluate(parent)?.path !== undefined
  }
  const visit = (node) => {
    // An import or a re-export is the module graph's business.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    // A literal that a path above takes in whole (join(REPO, 'docs', 'x.md')) stands for that path only.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !takenWhole(node)) literals.add(node.text)
    // join(<unknown>, 'test', 'fixtures', 'x'): the literal tail, read from a root the parser cannot see
    // (a parameter that holds the repository) — kept when it spells a tracked path.
    if (ts.isCallExpression(node) && PATH_CALLS.has(calleeName(node.expression))) {
      const tail = []
      for (const argument of [...node.arguments].reverse()) {
        if (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument)) break
        tail.unshift(argument.text)
      }
      if (tail.length > 0 && tail.length < node.arguments.length) literals.add(posix.join(...tail))
    }
    if (ts.isExpression(node) && !(ts.isIdentifier(node) && ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
      const value = evaluate(node)
      if (value?.path !== undefined && !ts.isStringLiteral(node) && !consumed(node)) add(value.path, value.complete)
      if (value?.text !== undefined && ts.isCallExpression(node) && !consumed(node)) literals.add(value.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { refs, literals, root: refs.has('') }
}

/** Every tracked file of the repository at `root`, and every folder that holds one. */
function tracked(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  const folders = new Set()
  for (const file of files) for (let at = file.indexOf('/'); at !== -1; at = file.indexOf('/', at + 1)) folders.add(file.slice(0, at))
  return { files: new Set(files), folders }
}

/** The `generated` part of the table for the repository at `root`. */
function generate(root) {
  const { files, folders } = tracked(root)
  const readers = [...files]
    .filter((file) => file.startsWith('test/') && READER.test(file) && !/^test\/(e2e\/.*\.spec\.ts|acceptance\/|fixtures\/)/.test(file) && !NOT_READERS.includes(file))
    .sort()
  const generated = []
  for (const reader of readers) {
    const { refs, literals, root: usesRoot } = referencesOf(reader, readFileSync(join(root, reader), 'utf8'))
    for (const literal of literals) {
      const path = clean(literal)
      if (path === undefined || path === '' || refs.has(path)) continue
      if (path.includes('/') || usesRoot) refs.set(path, true)
    }
    const reads = new Set()
    const scans = new Set()
    for (const [path, complete] of refs) {
      if (path === reader) continue
      const isFile = files.has(path)
      // The root itself: a name built at run time under it is unknown here; the literals above stand for it.
      if (path === '' || (!isFile && !folders.has(path))) continue
      const broad = !isFile && (!path.includes('/') || BROAD.includes(path) || (!complete && BROAD.some((folder) => folder.startsWith(`${path}/`))))
      if (broad) scans.add(path)
      else reads.add(path)
    }
    if (reads.size === 0 && scans.size === 0) continue
    const entry = { file: reader }
    if (reads.size > 0) entry.reads = [...reads].sort()
    if (scans.size > 0) entry.scans = [...scans].sort()
    generated.push(entry)
  }
  return generated
}

function main() {
  const check = process.argv.includes('--check')
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  // --refs <reader>: what the parser finds in one file, before the tracked-path filter.
  const at = process.argv.indexOf('--refs')
  if (at !== -1) {
    const reader = process.argv[at + 1]
    const { refs, literals, root: usesRoot } = referencesOf(reader, readFileSync(join(root, reader), 'utf8'))
    process.stdout.write(`${JSON.stringify({ refs: Object.fromEntries(refs), usesRoot, literals: [...literals] }, null, 1)}\n`)
    return
  }
  const path = join(root, TABLE)
  const table = JSON.parse(readFileSync(path, 'utf8'))
  const generated = generate(root)
  if (check) {
    if (JSON.stringify(table.generated) === JSON.stringify(generated)) return
    const before = new Map((table.generated ?? []).map((entry) => [entry.file, JSON.stringify(entry)]))
    const after = new Map(generated.map((entry) => [entry.file, JSON.stringify(entry)]))
    for (const file of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(file) !== after.get(file)) process.stderr.write(`affected-tests-table: ${file}: table ${before.get(file) ?? 'none'}, now ${after.get(file) ?? 'none'}\n`)
    }
    process.stderr.write(`affected-tests-table: ${TABLE} is out of date; run node scripts/affected-tests-table.mjs\n`)
    process.exitCode = 1
    return
  }
  table.generated = generated
  writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`)
}

main()
