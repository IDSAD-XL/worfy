// No file of test/e2e starts a process while it loads (worfy-windows ticket 53). Playwright loads
// every spec before it runs any, also for `--list` and for a run of one file, so one call at the top
// level of a module that fails stops the whole run: on Windows `execFileSync('/bin/sh', …)` of the
// zsh lookup did that, and not one e2e test ran. A process a test needs is started inside a function
// — the test, a hook, a helper the test calls — and a test that cannot run on the system says so
// with test.skip.
//
// The search reads each file with the TypeScript parser, not line by line: code inside a string —
// test/e2e/epic-frame.spec.ts has a script with `require('node:child_process')` in one — is not a
// call, and a call inside an arrow function on one line is not at the top level.
//
// What counts as starting a process: a call of execFileSync, execSync or spawnSync of
// node:child_process, under its own name, under an alias, or through the module object; and a call
// of a function whose body starts one, however deep — a function of test/e2e or of a file it
// imports from elsewhere in the repo. Such a function passed by name to a call that runs it counts
// as well.
//
// What runs at load: everything outside a function, and a function that runs where it is written —
// called right there, or passed to a call that runs it: a describe (Playwright runs its body while
// it collects the tests), `[…].map`, any call but the few of Playwright that keep their callback for
// later (`test`, its hooks, `test.step`). The files imported from outside test/e2e load with the
// specs, and the same rule holds in them.
//
// Not covered: the calls that do not wait for the process (spawn, execFile) — they do not throw
// while the module loads; a method of a class or of an object literal that starts one; a function
// returned by another (`const git = makeGit()`), and one reached through another name than it was
// declared with.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const E2E = join(REPO, 'test', 'e2e')

const SPAWNS = new Set(['execFileSync', 'execSync', 'spawnSync'])
const CHILD_PROCESS = new Set(['node:child_process', 'child_process'])

/** The calls of Playwright that keep a function for later: the test itself, its hooks, a step. */
const LATER = /^test(\.(only|skip|fixme|fail|slow))*$|^test\.(beforeEach|afterEach|beforeAll|afterAll|step)$/

/** Every .ts file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

const parse = (text: string, name = 'file.ts'): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)

/** The files of the repo a file loads: its imports and re-exports by a relative path, types apart. */
function localImports(path: string, file: ts.SourceFile): string[] {
  return file.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) return []
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || statement.moduleSpecifier === undefined) return []
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return []
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
    if (!specifier.startsWith('.')) return []
    const base = resolve(dirname(path), specifier)
    const found = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    return found === undefined ? [] : [found]
  })
}

/** The files of test/e2e and every file of the repo they load, each once. */
function loadedFiles(): string[] {
  const seen = new Set<string>()
  const queue = sources(E2E)
  while (queue.length > 0) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    queue.push(...localImports(path, parse(readFileSync(path, 'utf8'), path)))
  }
  return [...seen]
}

interface Names {
  /** Local names of execFileSync, execSync and spawnSync. */
  calls: Set<string>
  /** Local names of the module node:child_process itself. */
  modules: Set<string>
}

/** What a file calls the spawning functions of node:child_process, from its imports and requires. */
function childProcessNames(file: ts.SourceFile): Names {
  const names: Names = { calls: new Set(), modules: new Set() }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && CHILD_PROCESS.has(node.moduleSpecifier.text)) {
      const clause = node.importClause
      if (clause?.name) names.modules.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) names.modules.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if (SPAWNS.has((element.propertyName ?? element.name).text)) names.calls.add(element.name.text)
      }
    }
    // const { execFileSync } = require('node:child_process'), or const cp = require('node:child_process')
    if (ts.isVariableDeclaration(node) && node.initializer && isRequireOfChildProcess(node.initializer)) {
      if (ts.isIdentifier(node.name)) names.modules.add(node.name.text)
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName ?? element.name
          if (ts.isIdentifier(imported) && ts.isIdentifier(element.name) && SPAWNS.has(imported.text)) names.calls.add(element.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

function isRequireOfChildProcess(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') return false
  const [module] = node.arguments
  return node.arguments.length === 1 && module !== undefined && ts.isStringLiteral(module) && CHILD_PROCESS.has(module.text)
}

/** Whether a call starts a process: a spawning function of node:child_process, or a function of `spawning` by its name or as a property. */
function startsProcess(call: ts.CallExpression, names: Names, spawning: ReadonlySet<string>): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return names.calls.has(callee.text) || spawning.has(callee.text)
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (spawning.has(callee.name.text)) return true
  const target = callee.expression
  return SPAWNS.has(callee.name.text) && ((ts.isIdentifier(target) && names.modules.has(target.text)) || isRequireOfChildProcess(target))
}

/** Whether a call runs the functions passed to it now: anything but the test, its hooks and a step. */
const runsNow = (call: ts.CallExpression): boolean => !LATER.test(call.expression.getText())

/** Whether a function runs when the code around it runs: called where it is written, or passed to a call that runs it. */
function runsWithParent(fn: ts.Node): boolean {
  let at: ts.Node = fn
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent
  const parent = at.parent
  if (!ts.isCallExpression(parent)) return false
  if (parent.expression === at) return true
  return runsNow(parent)
}

/**
 * The places of a file that start a process: the calls that do, and a spawning function passed by
 * its name to a call that runs it.
 */
function spawnSites(file: ts.SourceFile, names: Names, spawning: ReadonlySet<string>): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (startsProcess(node, names, spawning)) found.push(node)
      if (runsNow(node)) found.push(...node.arguments.filter((arg) => ts.isIdentifier(arg) && (spawning.has(arg.text) || names.calls.has(arg.text))))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** The function a place runs in, as far as running goes: undefined when it runs while the module loads. */
function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at) && !runsWithParent(at)) return at
  }
  return undefined
}

/** The name a function is declared with: `function f`, `const f = () => …`, `const f = function …`. */
function declaredName(fn: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text
  return undefined
}

interface Source {
  file: ts.SourceFile
  names: Names
}

const source = (text: string, name?: string): Source => {
  const file = parse(text, name)
  return { file, names: childProcessNames(file) }
}

/**
 * The names of the functions declared in these files that start a process when called, also
 * through another function of the set. A function that only hands its process to a test or a hook
 * starts none itself.
 */
function spawningFunctions(files: Source[]): Set<string> {
  const spawning = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const { file, names } of files) {
      for (const site of spawnSites(file, names, spawning)) {
        const fn = enclosingFunction(site)
        const name = fn === undefined ? undefined : declaredName(fn)
        if (name !== undefined && !spawning.has(name)) {
          spawning.add(name)
          grew = true
        }
      }
    }
  }
  return spawning
}

/** The places of a file that start a process while the module loads, as `line: text`. */
function spawnsOnLoad({ file, names }: Source, spawning: ReadonlySet<string>): string[] {
  return spawnSites(file, names, spawning)
    .filter((site) => enclosingFunction(site) === undefined)
    .map((site) => `${file.getLineAndCharacterOfPosition(site.getStart()).line + 1}: ${site.getText().split('\n')[0]!.trim()}`)
}

/** The search over texts as the files of one run: the first texts may hold helpers, the last is searched. */
function searched(...texts: string[]): string[] {
  const files = texts.map((text) => source(text))
  return spawnsOnLoad(files.at(-1)!, spawningFunctions(files))
}

describe('a process started while a module of test/e2e loads', () => {
  it('is started by no file of test/e2e, nor by a file it loads: Playwright loads every spec before it runs any', () => {
    const files = loadedFiles().map((path) => ({ path: relative(REPO, path).replace(/\\/g, '/'), ...source(readFileSync(path, 'utf8'), path) }))
    const spawning = spawningFunctions(files)
    expect(files.flatMap((file) => spawnsOnLoad(file, spawning).map((use) => `${file.path}:${use}`))).toEqual([])
    // The search sees the helpers it must: the zsh lookup and what calls it, and a file from outside test/e2e.
    expect([...spawning]).toEqual(expect.arrayContaining(['zshPath', 'terminalAiSandbox', 'buildVersion']))
    expect(files.map(({ path }) => path)).toContain('scripts/build-version.ts')
  })

  const IMPORT = "import { execFileSync, execSync, spawnSync } from 'node:child_process'\n"

  it.each<{ name: string; text: string; found: string[] }>([
    // Found: what runs while the module loads.
    { name: 'a constant of the top level', text: `${IMPORT}export const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()`, found: ["2: execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' })"] },
    { name: 'execSync and spawnSync', text: `${IMPORT}execSync('git init')\nconst r = spawnSync('git', ['status'])`, found: ["2: execSync('git init')", "3: spawnSync('git', ['status'])"] },
    { name: 'an alias', text: "import { execFileSync as run } from 'node:child_process'\nrun('git')", found: ["2: run('git')"] },
    { name: 'the module object', text: "import * as cp from 'node:child_process'\ncp.execFileSync('git')", found: ["2: cp.execFileSync('git')"] },
    { name: 'a default import, without node:', text: "import cp from 'child_process'\ncp.spawnSync('git')", found: ["2: cp.spawnSync('git')"] },
    { name: 'a require', text: "const { execSync } = require('node:child_process')\nexecSync('ls')\nrequire('child_process').spawnSync('ls')", found: ["2: execSync('ls')", "3: require('child_process').spawnSync('ls')"] },
    { name: 'a require under another name', text: "const { execSync: run } = require('node:child_process')\nrun('ls')", found: ["2: run('ls')"] },
    { name: 'the module object of a require', text: "const cp = require('node:child_process')\ncp.execSync('ls')", found: ["2: cp.execSync('ls')"] },
    { name: 'a helper of the file called at the top level', text: `${IMPORT}function zsh() { return execFileSync('/bin/sh') }\nconst SHELL = zsh()`, found: ['3: zsh()'] },
    { name: 'a helper two calls deep', text: `${IMPORT}const run = () => execFileSync('git')\nconst twice = () => [run(), run()]\ntwice()`, found: ['4: twice()'] },
    { name: 'a function expression', text: `${IMPORT}const f = function () { return execFileSync('git') }\nf()`, found: ['3: f()'] },
    { name: 'a helper whose call is inside a callback it runs', text: `${IMPORT}function setup() {\n  return ['a'].map((d) => execFileSync('git', ['init'], { cwd: d }))\n}\nconst X = setup()`, found: ['5: setup()'] },
    { name: 'the callback of a describe', text: `${IMPORT}test.describe.serial('x', () => {\n  const head = execFileSync('git')\n})`, found: ["3: execFileSync('git')"] },
    { name: 'the callback of a bare describe', text: `${IMPORT}const { describe } = test\ndescribe('x', () => {\n  execFileSync('git')\n})`, found: ["4: execFileSync('git')"] },
    { name: 'a describe whose body is a function by its name', text: `${IMPORT}function body() { execFileSync('git') }\ntest.describe('x', body)`, found: ['3: body'] },
    { name: 'a function called where it is written', text: `${IMPORT}const head = (() => execFileSync('git'))()`, found: ["2: execFileSync('git')"] },
    { name: 'the callback of an array method', text: `${IMPORT}const TOOLS = ['zsh'].map((t) => execFileSync('/bin/sh', ['-c', t]))\n;['a'].forEach(function (t) { execSync(t) })`, found: ["2: execFileSync('/bin/sh', ['-c', t])", '3: execSync(t)'] },
    { name: 'a call whose name only ends like test', text: `${IMPORT}latest('x', () => { execSync('ls') })`, found: ["2: execSync('ls')"] },
    { name: 'a spawning function passed by its name', text: `${IMPORT}const run = (d: string) => execFileSync('git', [d])\n;['a'].forEach(run)`, found: ['3: run'] },
    // Passed by: what runs only when something calls it.
    { name: 'an arrow function of one line', text: `${IMPORT}const git = (...args: string[]) => execFileSync('git', args)`, found: [] },
    { name: 'a function', text: `${IMPORT}function git(...args: string[]) {\n  return execFileSync('git', args)\n}`, found: [] },
    { name: 'a test and a hook', text: `${IMPORT}test.beforeEach(() => { execSync('git init') })\ntest('x', async () => { spawnSync('git') })\ntest.skip('y', () => { execSync('ls') })`, found: [] },
    { name: 'a step of a test, and a function given to the test by its name', text: `${IMPORT}const run = () => execSync('ls')\ntest('x', run)\ntest('y', async () => { await test.step('s', () => { execSync('ls') }) })`, found: [] },
    { name: 'a helper called inside a test', text: `${IMPORT}const zsh = () => execFileSync('/bin/sh')\ntest('x', () => { zsh() })`, found: [] },
    { name: 'a helper that only adds a hook, called at the top level', text: `${IMPORT}function setup() {\n  test.afterEach(() => { execSync('x') })\n}\nsetup()`, found: [] },
    { name: 'a function called where it is written, inside a function no one calls', text: `${IMPORT}function f() { (() => execFileSync('git'))() }`, found: [] },
    { name: 'a call inside a string', text: "const SCRIPT = String.raw`\nconst { execFileSync } = require('node:child_process')\nexecFileSync('git')\n`", found: [] },
    { name: 'a call in a comment', text: `${IMPORT}// execFileSync('/bin/sh')\n/* spawnSync('git') */`, found: [] },
    { name: 'another function of the same name', text: "import { execFileSync } from './elsewhere'\nexecFileSync('git')\nconst { execSync } = require('./elsewhere')\nexecSync('ls')\nrequire('./elsewhere').spawnSync('ls')", found: [] },
    { name: 'the calls that do not wait', text: "import * as cp from 'node:child_process'\nimport { execFile, spawn } from 'node:child_process'\nspawn('git')\nexecFile('git')\ncp.spawn('git')", found: [] },
  ])('$name', ({ text, found }) => {
    expect(searched(text)).toEqual(found)
  })

  it('a helper of another file counts: a top-level call of the zsh lookup is found', () => {
    const zsh = "import { execFileSync } from 'node:child_process'\nexport function zshPath(): string {\n  return execFileSync('/bin/sh')\n}"
    expect(searched(zsh, "import { zshPath } from './zsh'\nconst ZSH = zshPath()")).toEqual(['2: zshPath()'])
    expect(searched(zsh, "import * as z from './zsh'\nconst Z = z.zshPath()")).toEqual(['2: z.zshPath()'])
    expect(searched(zsh, "import { zshPath } from './zsh'\ntest('x', () => { zshPath() })")).toEqual([])
  })
})
