// fs.rmSync has one place in src/ and in scripts/ (worfy-windows ticket 23). Under the Node of
// Electron 44 on Windows its `recursive` goes through a junction and empties the folder behind it,
// and without `recursive` it refuses a read-only file and a junction. Removals go through
// src/main/storage/remove.ts, which calls rmSync only where it is safe: on every system but
// Windows. The scripts that cannot import the module carry a copy between marks, and the same rule
// holds inside it (test/unit/remove-tree.test.ts compares the copies with the module).
//
// The search is by text, not by an ESLint rule: one of the places is JavaScript inside a string —
// the script restore.mjs in src/main/harness/migrate/restore.ts — which a rule would not see.
//
// Not covered: `rm` of node:fs/promises. src/main/harness/install.ts calls it; measured on the PC,
// it does not go through a junction.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')

/** Every file under a folder whose name ends as asked. */
function sources(dir: string, ending: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path, ending)
    return ending.test(entry.name) ? [path] : []
  })
}

/** The module itself: the one file that may call rmSync anywhere. */
const MODULE = 'src/main/storage/remove.ts'

/**
 * The lines of a text that remove with a call this ticket forbids: any mention of rmSync, and
 * rmdirSync with `recursive` (the same removal under another name). Not counted:
 *   - a comment line (`// …`, ` * …`, `/* …` with nothing after its end);
 *   - the text between `// <remove-tree>` and `// </remove-tree>`, or the same marks of
 *     `remove-file`: a copy of the module, compared with it by its own test;
 *   - an import of node:fs, in a file that has such a copy: the copy needs the name.
 */
/** A call that starts in a line, to the bracket that closes it — on a later line when its arguments go on there. */
function callFrom(lines: string[], index: number, name: RegExp): string {
  const rest = lines.slice(index, index + 8).join('\n')
  const start = rest.search(name)
  if (start < 0) return ''
  let depth = 0
  for (let at = rest.indexOf('(', start); at >= 0 && at < rest.length; at++) {
    if (rest[at] === '(') depth += 1
    else if (rest[at] === ')' && --depth === 0) return rest.slice(start, at + 1)
  }
  return rest.slice(start)
}

function uses(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const found: string[] = []
  let copy: string | null = null
  const hasCopy = /\/\/ <remove-(tree|file)>/.test(text)
  lines.forEach((line, index) => {
    const mark = /^\s*\/\/ <(\/?)(remove-tree|remove-file)>\s*$/.exec(line)
    if (mark) {
      copy = mark[1] === '/' ? null : mark[2]!
      return
    }
    if (copy !== null) return
    if (/^\s*(\/\/|\*)/.test(line) || /^\s*\/\*(?:(?!\*\/).)*(\*\/\s*)?$/.test(line)) return
    if (hasCopy && /^\s*import \{[^}]*\} from 'node:fs'\s*;?\s*$/.test(line)) return
    if (/\brmSync\b/.test(line) || /\brecursive\b/.test(callFrom(lines, index, /\brmdirSync\s*\(/))) found.push(`${index + 1}: ${line.trim()}`)
  })
  return found
}

const scanned = (folder: string, ending: RegExp): string[] =>
  sources(join(REPO, folder), ending)
    .map((file) => relative(REPO, file).replace(/\\/g, '/'))
    .filter((file) => file !== MODULE)
    .flatMap((file) => uses(readFileSync(join(REPO, file), 'utf8')).map((use) => `${file}:${use}`))

describe('fs.rmSync in src/ and in scripts/', () => {
  it('is used nowhere in src/ but in the removal module: a file, a link or a folder is removed with removeFile or removeTree', () => {
    expect(scanned('src', /\.tsx?$/)).toEqual([])
  })

  it('is used in no script but inside a copy of the module, and in the one line of install-stable.mjs that removes off Windows', () => {
    // (By the text of the line, not by its number.)
    expect(scanned('scripts', /\.(mjs|cjs|js|ts)$/).map((use) => use.replace(/:\d+: /, ': '))).toEqual([
      "scripts/install-stable.mjs: const remove = (path) => (platform === 'win32' ? removeTree(path) : rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))",
    ])
  })

  it('the module is where the call is: off Windows, with "recursive" and "force" for a tree and "force" alone for a file', () => {
    const calls = readFileSync(join(REPO, MODULE), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /\brmSync\(/.test(line) && !/^\s*(\/\/|\*)/.test(line))
      .map((line) => line.trim())
    expect(calls).toEqual(['fs.rmSync(path, { recursive: true, force: true })', 'fs.rmSync(path, { force: true })'])
  })

  it('the search finds a call, an import and a call inside a string, with "recursive" and without, and rmdirSync with "recursive"', () => {
    expect(uses('    rmSync(dir, { recursive: true, force: true })')).toEqual(['1: rmSync(dir, { recursive: true, force: true })'])
    expect(uses('  rmSync(file, { force: true })')).toHaveLength(1)
    expect(uses("import { mkdirSync, rmSync } from 'node:fs'")).toHaveLength(1)
    expect(uses('const remove = fs.rmSync')).toHaveLength(1)
    expect(uses('const SOURCE = String.raw`\n    if (move) rmSync(path, { recursive: true, force: true })\n`')).toEqual(['2: if (move) rmSync(path, { recursive: true, force: true })'])
    expect(uses('  rmdirSync(dir, { recursive: true })')).toHaveLength(1)
    expect(uses('  rmdirSync(this.entryDir(projectId, label), { recursive: true })')).toHaveLength(1)
    // A block comment before code on the same line hides nothing.
    expect(uses('/* gone */ rmSync(dir)')).toHaveLength(1)
    // The options of a call on the lines after it are read with it.
    expect(uses('  rmdirSync(dir, {\n    recursive: true,\n  })')).toEqual(['1: rmdirSync(dir, {'])
    expect(uses('  rmdirSync(\n    join(a, b),\n    { recursive: true },\n  )')).toHaveLength(1)
  })

  // Review round 2 of PR #257. What lies between the marks is not searched, so the marks are
  // taken only where test/unit/remove-tree.test.ts compares the text between them with the module.
  it('a copy between the marks is in the three files whose copy is compared with the module, and in no other', () => {
    const marked = [...sources(join(REPO, 'src'), /\.tsx?$/), ...sources(join(REPO, 'scripts'), /\.(mjs|cjs|js|ts)$/)]
      .filter((file) => /^\s*\/\/ <\/?remove-(tree|file)>\s*$/m.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file).replace(/\\/g, '/'))
      .sort()
    expect(marked).toEqual(['scripts/install-stable.mjs', 'scripts/remove-tree.mjs', 'src/main/harness/migrate/restore.ts'])
  })

  it('the search passes by a comment, another name, rmdirSync of an empty folder, and a copy between its marks with the import it needs', () => {
    expect(uses('// fs.rmSync is not used here\n * rmSync would go through a junction\n/* rmSync */\n  /* rmSync, in a comment that goes on')).toEqual([])
    expect(uses('const rmSyncLike = 1; warmSync()')).toEqual([])
    expect(uses('  rmdirSync(link)')).toEqual([])
    // "recursive" of the next call is not that of this one.
    expect(uses('  rmdirSync(link)\n  mkdirSync(dir, { recursive: true })')).toEqual([])
    const withCopy = ["import { lstatSync, rmSync, unlinkSync } from 'node:fs'", '// <remove-tree>', 'function removeTree(path) {', '  return rmSync(path, { recursive: true, force: true })', '}', '// </remove-tree>', 'rmSync(other)'].join('\n')
    expect(uses(withCopy)).toEqual(['7: rmSync(other)'])
    // Without a copy in the file, the import is a use like any other.
    expect(uses("import { lstatSync, rmSync, unlinkSync } from 'node:fs'\nremoveTree(dir)")).toHaveLength(1)
  })
})
