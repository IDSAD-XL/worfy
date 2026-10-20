// fs.rmSync has one place in src/ and in scripts/ (worfy-windows ticket 23). Under the Node of
// Electron 44 on Windows its `recursive` goes through a junction and empties the folder behind it,
// and without `recursive` it refuses a read-only file and a junction. Removals go through
// src/main/storage/remove.ts, which calls rmSync only where it is safe: on every system but
// Windows. The scripts that cannot import the module carry a copy between marks, and the same rule
// holds inside it (test/unit/remove-tree-copies.test.ts compares the copies with the module).
//
// The search is by text, not by an ESLint rule: one of the places is JavaScript inside a string —
// the script restore.mjs in src/main/harness/migrate/restore.ts — which a rule would not see.
//
// Not covered in src/ and scripts/: `rm` of node:fs/promises. src/main/harness/install.ts calls it;
// measured on the PC, it does not go through a junction.
//
// What the search cannot see. The forms below are examples the reviews found (worfy-windows tickets
// 28 and 43), not the whole list; none is in the code today. In src/ and scripts/, where any
// mention of rmSync counts, what goes past is rmdirSync and the removals of other names:
//   - a removal reached through another name than an import alias — `const wipe = fs.rmdirSync`, a
//     property of an object, a name destructured from node:fs — and anything a string builds;
//   - `rm` of node:fs with a callback, `rmdir` of node:fs/promises;
//   - `fs.rmdirSync?.(…)`, `fs.rmdirSync.call(…)`, `fs['rmdirSync'](…)`, `rmdirSync(...args)`;
//   - a `)` in a comment inside the call, which ends it early; a line of code that starts with `*`,
//     which is read as a comment line.
// In test/ the same, and `rmSync(...args)` and `fs.rmSync?.(…)` too: there only a call with
// `recursive` counts, and these two have neither the word nor a second argument.
//
// A false finding, the other way: a quote inside a regular expression literal is read as the start
// of a string, so the call runs on to the next quote — `rmSync(name.replace(/'/g, ''))` takes in the
// lines after it, and a `recursive` there is counted for it. A real call is never lost by that.
//
// Tests have the same rule for a removal with `recursive` (worfy-windows tickets 26 and 32): they
// run under the Node of Electron, where a cleanup with rmSync failed its test at the first read-only
// file — git writes its objects that way — and left the folder in %TEMP%. In test/ the rule takes
// rmSync and rmdirSync, by name and under an alias an import of node:fs gives them (recursiveUses);
// the rm of node:fs/promises, measured, has neither fault. A test removes a folder with
// removeTestTree of test/remove.ts.
//
// The configuration files at the root of the repository have the rule of src/ (worfy-windows ticket
// 51): vitest.config.ts, under the same Node, removes old folders of other runs from %TEMP%.
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

/** Walks a text from a place on; `visit` gets each character that is not inside a quoted string, and ends the walk by answering true. */
function outsideStrings(text: string, from: number, visit: (char: string, at: number) => boolean): void {
  let quote: string | null = null
  for (let at = from; at >= 0 && at < text.length; at++) {
    const char = text[at]!
    if (quote !== null) {
      // The character after a backslash is not the end of the string.
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (visit(char, at)) return
  }
}

/**
 * The calls that start in a line — every one of them, not the first alone — each to the bracket
 * that closes it, on a later line when its arguments go on there, however far down that is. A call
 * that starts in a later line is found from that line. A bracket inside a quoted string closes
 * nothing.
 */
function callsFrom(lines: string[], index: number, name: RegExp): string[] {
  const matches = [...(lines[index] ?? '').matchAll(new RegExp(name.source, 'g'))]
  if (matches.length === 0) return []
  const rest = lines.slice(index).join('\n')
  return matches.map((match) => {
    let depth = 0
    let end = rest.length
    outsideStrings(rest, rest.indexOf('(', match.index), (char, at) => {
      if (char === '(') depth += 1
      else if (char === ')' && --depth === 0) end = at + 1
      return end !== rest.length
    })
    return rest.slice(match.index, end)
  })
}

/** The second argument of a call, as its text; '' when the call has one argument. */
function secondArgument(call: string): string {
  let depth = 0
  let second = ''
  outsideStrings(call, call.indexOf('('), (char, at) => {
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === ',' && depth === 1) second = call.slice(at + 1).replace(/\)\s*$/, '').trim()
    return second !== ''
  })
  return second
}

/**
 * Whether a call may remove with `recursive`: the word is in it, or its options are not written
 * out in the call — a variable, a call, an object with a spread — and may hold the word.
 */
function mayBeRecursive(call: string): boolean {
  if (/\brecursive\b/.test(call)) return true
  const second = secondArgument(call)
  return second !== '' && (!second.startsWith('{') || second.includes('...'))
}

/**
 * The lines of a text that remove with a call this ticket forbids: any mention of rmSync, and
 * rmdirSync with `recursive` (the same removal under another name). Not counted:
 *   - a comment line (`// …`, ` * …`, `/* …` with nothing after its end);
 *   - the text between `// <remove-tree>` and `// </remove-tree>`, or the same marks of
 *     `remove-file`: a copy of the module, compared with it by its own test;
 *   - an import of node:fs, in a file that has such a copy: the copy needs the name.
 */
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
    // A removal imported under another name is a use wherever it is: the search goes by the name.
    const renamed = /\b(rmSync|rmdirSync)\s+as\b/.test(line)
    if (hasCopy && !renamed && /^\s*import \{[^}]*\} from 'node:fs'\s*;?\s*$/.test(line)) return
    if (renamed || /\brmSync\b/.test(line) || callsFrom(lines, index, /\brmdirSync\s*\(/).some(mayBeRecursive)) found.push(`${index + 1}: ${line.trim()}`)
  })
  return found
}

const scanned = (folder: string, ending: RegExp): string[] =>
  sources(join(REPO, folder), ending)
    .map((file) => relative(REPO, file).replace(/\\/g, '/'))
    .filter((file) => file !== MODULE)
    .flatMap((file) => uses(readFileSync(join(REPO, file), 'utf8')).map((use) => `${file}:${use}`))

/**
 * The tests of the removal itself: they name rmSync in the texts they search, and call it to
 * compare with. remove-tree-model.ts holds no call of fs.rmSync: it is the file system in memory
 * those tests run over, and the `rmSync` it names is the model's own.
 */
const ITS_OWN_TESTS = ['test/unit/no-rmsync.test.ts', 'test/unit/remove-tree.test.ts', 'test/unit/remove-tree-model.ts']

/** A line without the comment at its end; a `//` inside a quoted string starts none. */
function withoutEndComment(line: string): string {
  let end = line.length
  outsideStrings(line, 0, (char, at) => {
    if (char === '/' && line[at + 1] === '/') end = at
    return end !== line.length
  })
  return line.slice(0, end)
}

/**
 * The lines of a text that call rmSync or rmdirSync (the same removal under another name) with
 * `recursive` (worfy-windows tickets 26 and 32), by their names, as a method (`fs.rmSync`), or under
 * an alias an import of node:fs gives them. Comment lines and a comment at the end of a line are not
 * read; the options may lie on the lines after the call. The rm of node:fs/promises is not counted:
 * see the test of the search below.
 */
function recursiveUses(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const aliases = [...text.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/g)].flatMap((imported) =>
    [...imported[1]!.matchAll(/\b(?:rmSync|rmdirSync)\s+as\s+([\w$]+)/g)].map((alias) => alias[1]!),
  )
  const name = new RegExp(`(?<![\\w$])(?:${['rmSync', 'rmdirSync', ...aliases].join('|')})\\s*\\(`)
  const code = lines.map(withoutEndComment)
  return lines.flatMap((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return []
    return callsFrom(code, index, name).some(mayBeRecursive) ? [line.trim()] : []
  })
}

describe('fs.rmSync with "recursive" in test/', () => {
  it('is called by no test: the folder of a test goes with removeTestTree of test/remove.ts', () => {
    const found = sources(join(REPO, 'test'), /\.tsx?$/)
      .map((file) => relative(REPO, file).replace(/\\/g, '/'))
      .filter((file) => !ITS_OWN_TESTS.includes(file))
      .flatMap((file) => recursiveUses(readFileSync(join(REPO, file), 'utf8')).map((use) => `${file}: ${use}`))
    // No file is passed by (worfy-windows ticket 51). test/unit/glob-probe.tsx, type-checked without
    // the types of Node, loads test/remove.ts through a computed specifier: its own folder holds a
    // symlink to node_modules, and the cleanup of vitest.config.ts removes any old folder of its
    // name, whatever is in it.
    expect(found).toEqual([])
  })

  // worfy-windows ticket 51: vitest.config.ts removed the old folders of runs in %TEMP% with rmSync,
  // outside test/, src/ and scripts/, where the search did not look.
  it('is used in no configuration file at the root of the repository: they remove through test/stale-leftovers.ts', () => {
    const configs = readdirSync(REPO).filter((name) => /\.config\.(ts|mts|cts|js|mjs|cjs)$/.test(name))
    expect(configs.sort()).toEqual(['electron.vite.config.ts', 'eslint.config.js', 'playwright.acceptance.config.ts', 'playwright.config.ts', 'vitest.config.ts'])
    expect(configs.flatMap((file) => uses(readFileSync(join(REPO, file), 'utf8')).map((use) => `${file}:${use}`))).toEqual([])
  })

  // Review round 1 of PR #293: test/unit/remove-tree-model.ts is passed by as a whole file above.
  // It can call no fs.rmSync: of node:fs it has readFileSync and nothing else.
  it('the model of the removal tests, which the search passes by, takes readFileSync alone from node:fs and loads no module any other way', () => {
    const text = readFileSync(join(REPO, 'test', 'unit', 'remove-tree-model.ts'), 'utf8')
    const lines = text.split(/\r?\n/)
    expect(lines.filter((line) => /['"](node:)?fs(\/promises)?['"]/.test(line))).toEqual(["import { readFileSync } from 'node:fs'"])
    expect(lines.filter((line) => /\b(require|import)\s*\(/.test(line) || /\bprocess\.binding\b/.test(line))).toEqual([])
  })

  it('the helper is the removal of the application, and calls nothing else', () => {
    const helper = readFileSync(join(REPO, 'test', 'remove.ts'), 'utf8')
    expect(helper).toContain("import { removeTree } from '../src/main/storage/remove'")
    expect(recursiveUses(helper)).toEqual([])
    expect(helper.split(/\r?\n/).filter((line) => /^import /.test(line))).toHaveLength(1)
  })

  it('the search finds a call with "recursive" in its line or in the lines after it, and passes by a call without it', () => {
    expect(recursiveUses('  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })')).toHaveLength(1)
    expect(recursiveUses("  rmSync(join(root, 'tools'), { recursive: true })")).toHaveLength(1)
    expect(recursiveUses('  afterAll(() => fs.rmSync(scratch, {\n    recursive: true,\n    force: true,\n  }))')).toEqual(['afterAll(() => fs.rmSync(scratch, {'])
    expect(recursiveUses('  rmSync(file)\n  rmSync(other, { force: true })')).toEqual([])
    // "recursive" of another call, in the same line or the next, is not that of rmSync.
    expect(recursiveUses('  rmSync(file)\n  mkdirSync(dir, { recursive: true })')).toEqual([])
    expect(recursiveUses('  mkdirSync(dir, { recursive: true }); rmSync(file)')).toEqual([])
    expect(recursiveUses('  // rmSync(dir, { recursive: true }) stops at a read-only file')).toEqual([])
    expect(recursiveUses('  removeTestTree(scratch)')).toEqual([])
    // worfy-windows ticket 28: the second call of a line, options that are not written out, a bracket in a string.
    expect(recursiveUses('  rmSync(file); rmSync(dir, { recursive: true })')).toHaveLength(1)
    expect(recursiveUses('  rmSync(dir, options)')).toHaveLength(1)
    expect(recursiveUses('  rmSync(dir, { ...options, force: true })')).toHaveLength(1)
    expect(recursiveUses("  rmSync(join(dir, ')'), { recursive: true })")).toHaveLength(1)
    expect(recursiveUses("  rmSync(join(dir, 'a,b'))\n  rmSync(other, { force: true })")).toEqual([])
  })

  // worfy-windows ticket 32: the forms the review of PR #276 found the search of test/ passing by,
  // one per line, and the two places it failed a line that removes nothing.
  it('the search finds rmSync and rmdirSync under an import alias, rmdirSync with "recursive", and options eight lines after the call', () => {
    expect(recursiveUses('  const options = { recursive: true, force: true }\n  rmSync(dir, options)')).toEqual(['rmSync(dir, options)'])
    expect(recursiveUses("import { rmSync as wipe } from 'node:fs'\n  wipe(dir, { recursive: true })")).toEqual(['wipe(dir, { recursive: true })'])
    expect(recursiveUses("import {\n  mkdirSync,\n  rmdirSync as clear,\n} from 'fs'\n  clear(dir, options)")).toEqual(['clear(dir, options)'])
    expect(recursiveUses('  rmdirSync(dir, { recursive: true })')).toEqual(['rmdirSync(dir, { recursive: true })'])
    expect(recursiveUses('  fs.rmdirSync(join(root, name), {\n    recursive: true,\n  })')).toEqual(['fs.rmdirSync(join(root, name), {'])
    expect(recursiveUses('  rmSync(file); rmSync(dir, { recursive: true })')).toHaveLength(1)
    expect(recursiveUses(`  rmSync(dir,${'\n'.repeat(8)}    { recursive: true })`)).toEqual(['rmSync(dir,'])
  })

  it('the search passes by "rmSync" in a comment at the end of a line, rmdirSync without "recursive", and the rm of node:fs/promises', () => {
    expect(recursiveUses('  removeTestTree(dir) // not rmSync(dir, { recursive: true }): it stops at a read-only file')).toEqual([])
    expect(recursiveUses("  const url = 'http://example.test/a'; rmSync(dir, { recursive: true }) // gone")).toHaveLength(1)
    expect(recursiveUses('  rmdirSync(link)\n  rmdirSync(dir, { maxRetries: 3 })')).toEqual([])
    expect(recursiveUses("import { rmSync as wipe } from 'node:fs'\n  wipe(file)")).toEqual([])
    expect(recursiveUses('  farm(dir, options); confirmSync(dir, options)')).toEqual([])
    // Measured under the Node of Electron 44 on the PC (worfy-windows ticket 32): fs.promises.rm with
    // `recursive` removes a read-only file and takes a junction away as a link, where fs.rmSync
    // stops with EPERM and empties the folder behind the junction. 137 cleanups of test/ call it.
    expect(recursiveUses("import { rm } from 'node:fs/promises'\n  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })")).toEqual([])
    // A call inside a string is still one: a script a test writes may run under process.execPath,
    // which is the Node of Electron in the test run.
    expect(recursiveUses('  const script = "rmSync(dir, { recursive: true })"')).toHaveLength(1)
  })
})

describe('fs.rmSync in src/ and in scripts/', () => {
  it('is used nowhere in src/ but in the removal module: a file, a link or a folder is removed with removeFile or removeTree', () => {
    expect(scanned('src', /\.tsx?$/)).toEqual([])
  })

  // worfy-windows ticket 44: until then install-stable.mjs had one line of its own that called
  // rmSync off Windows, past the copy and so past the look for a mounted volume the copy makes.
  it('is used in no script but inside a copy of the module', () => {
    expect(scanned('scripts', /\.(mjs|cjs|js|ts)$/)).toEqual([])
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
    // worfy-windows ticket 32: however far down the call ends.
    expect(uses(`  rmdirSync(dir,${'\n'.repeat(8)}    { recursive: true })`)).toEqual(['1: rmdirSync(dir,'])
  })

  // Review round 2 of PR #257. What lies between the marks is not searched, so the marks are
  // taken only where test/unit/remove-tree-copies.test.ts compares the text between them with the module.
  it('a copy between the marks is in the three files whose copy is compared with the module, and in no other', () => {
    const marked = [...sources(join(REPO, 'src'), /\.tsx?$/), ...sources(join(REPO, 'scripts'), /\.(mjs|cjs|js|ts)$/)]
      .filter((file) => /^\s*\/\/ <\/?remove-(tree|file)>\s*$/m.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file).replace(/\\/g, '/'))
      .sort()
    expect(marked).toEqual(['scripts/install-stable.mjs', 'scripts/remove-tree.mjs', 'src/main/harness/migrate/restore.ts'])
  })

  // worfy-windows ticket 28: the forms the review of PR #257 found the search passing by.
  it('the search finds a removal imported under another name, options that are not written out in the call, the second call of a line, and a call with a bracket in a string', () => {
    // An alias, also in a file that has a copy: there the plain import is passed by, this one is not.
    const copy = ['// <remove-tree>', 'function removeTree(path) {', '  return rmSync(path, { recursive: true, force: true })', '}', '// </remove-tree>']
    expect(uses(["import { lstatSync, rmSync as wipe } from 'node:fs'", ...copy, 'wipe(dir, { recursive: true })'].join('\n'))).toEqual(["1: import { lstatSync, rmSync as wipe } from 'node:fs'"])
    expect(uses("import { rmdirSync as wipe } from 'node:fs'\nwipe(dir, { recursive: true })")).toEqual(["1: import { rmdirSync as wipe } from 'node:fs'"])
    // rmdirSync with options that may say "recursive".
    expect(uses('  rmdirSync(dir, options)')).toHaveLength(1)
    expect(uses('  rmdirSync(dir, optionsOf(dir))')).toHaveLength(1)
    expect(uses('  rmdirSync(dir, { ...options })')).toHaveLength(1)
    // Options written out without the word, and a comma that is not at the top of the call, are no use.
    expect(uses('  rmdirSync(dir, { maxRetries: 3 })')).toEqual([])
    expect(uses('  rmdirSync(join(root, name))')).toEqual([])
    expect(uses("  rmdirSync(join(root, 'a,b'),\n  )")).toEqual([])
    // Two calls in one line: the second is looked at as well.
    expect(uses('  rmdirSync(link); rmdirSync(dir, { recursive: true })')).toEqual(['1: rmdirSync(link); rmdirSync(dir, { recursive: true })'])
    // A closing bracket inside a string does not end the call.
    expect(uses("  rmdirSync(join(dir, ')'), { recursive: true })")).toHaveLength(1)
    expect(uses('  rmdirSync(`${dir})`, { recursive: true })')).toHaveLength(1)
    expect(uses("  rmdirSync(join(dir, '\\')'), { recursive: true })")).toHaveLength(1)
    // A quote after a backslash does not end the string: the call ends where it does, and a later line is not read into it.
    expect(uses("  rmdirSync(join(dir, 'it\\'s)'))\n  const options = { recursive: true }")).toEqual([])
  })

  it('each of the three files has its copy once: a second pair of marks would hide text from the search and from the comparison with the module', () => {
    const marks = (file: string, mark: string): number => readFileSync(join(REPO, file), 'utf8').split(/\r?\n/).filter((line) => line.trim() === mark).length
    for (const file of ['scripts/install-stable.mjs', 'scripts/remove-tree.mjs', 'src/main/harness/migrate/restore.ts']) {
      expect([marks(file, '// <remove-tree>'), marks(file, '// </remove-tree>')], file).toEqual([1, 1])
      const files = file === 'src/main/harness/migrate/restore.ts' ? 1 : 0
      expect([marks(file, '// <remove-file>'), marks(file, '// </remove-file>')], file).toEqual([files, files])
    }
  })

  it('the search passes by a comment, another name, rmdirSync of an empty folder, and a copy between its marks with the import it needs', () => {
    expect(uses('// fs.rmSync is not used here\n * rmSync would go through a junction\n/* rmSync */\n  /* rmSync, in a comment that goes on')).toEqual([])
    expect(uses('const rmSyncLike = 1; warmSync()')).toEqual([])
    expect(uses('  rmdirSync(link)')).toEqual([])
    // "recursive" of the next call is not that of this one.
    expect(uses('  rmdirSync(link)\n  mkdirSync(dir, { recursive: true })')).toEqual([])
    // A call on a later line is found from that line, not from the lines before it.
    expect(uses('  const dir = join(a, b)\n  rmdirSync(dir, { recursive: true })')).toEqual(['2: rmdirSync(dir, { recursive: true })'])
    const withCopy = ["import { lstatSync, rmSync, unlinkSync } from 'node:fs'", '// <remove-tree>', 'function removeTree(path) {', '  return rmSync(path, { recursive: true, force: true })', '}', '// </remove-tree>', 'rmSync(other)'].join('\n')
    expect(uses(withCopy)).toEqual(['7: rmSync(other)'])
    // Without a copy in the file, the import is a use like any other.
    expect(uses("import { lstatSync, rmSync, unlinkSync } from 'node:fs'\nremoveTree(dir)")).toHaveLength(1)
  })
})
