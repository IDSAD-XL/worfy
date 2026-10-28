// No file of test/e2e or test/contract starts a process while it loads (worfy-windows tickets 53 and
// 54). Playwright loads every spec before it runs any, also for `--list` and for a run of one file, so
// one call at the top level of a module that fails stops the whole run; vitest fails the whole file,
// and not one of its tests runs. On Windows `execFileSync('/bin/sh', …)` of the zsh lookup did both.
// A process a test needs is started inside a function — the test, a hook, a helper the test calls —
// and a test that cannot run on the system says so with a skip.
//
// The search reads each file with the TypeScript parser, not line by line: code inside a string —
// test/e2e/epic-frame.spec.ts has a script with `require('node:child_process')` in one — is not a
// call, and a call inside an arrow function on one line is not at the top level.
//
// What counts as starting a process: a call of execFileSync, execSync or spawnSync of
// node:child_process, under its own name, under an alias, or through the module object (an import,
// a require, `import cp = require(…)`); and a call of a function whose body starts one, however deep
// — a function of test/e2e, of test/contract or of a file they import from elsewhere in the repo.
// A function is known by the file it is declared in: a call is matched through the import of its
// name, so a function of the same name from another module, or a method of the same name, is not it.
// Such a function passed by name to a call that runs it counts as well.
//
// What runs at load: everything outside a function, and a function that runs where it is written —
// called right there, or passed to a call or a `new` that runs it: a describe (vitest and Playwright
// run its body while they collect the tests), `[…].map`, `new Promise(…)`, any call but those that
// keep their callback for later — a test, its modifiers (`skip`, `skipIf(…)`, `each(…)`, …), a hook,
// `test.step`, and a function of the file that only hands its parameters on to one of them (a wrapper
// of beforeAll). Which those are is decided by where the name comes from: an import of vitest or of
// Playwright, a hook taken out of `test` by destructuring, a `test.extend(…)` under any name, also
// one imported from another file. The initialiser of a field of a class runs on `new`, not at load;
// that of a static field runs at load. The files imported from outside the two folders load with
// them, and the same rule holds in them.
//
// Not covered: the calls that do not wait for the process (spawn, execFile) — they do not throw
// while the module loads; a method of a class or of an object literal that starts one, and the `new`
// of a class whose fields start one; a function returned by another (`const git = makeGit()`), and
// one reached through another name than it was declared with.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const ROOTS = [join(REPO, 'test', 'e2e'), join(REPO, 'test', 'contract')]

const SPAWNS = new Set(['execFileSync', 'execSync', 'spawnSync'])
const CHILD_PROCESS = new Set(['node:child_process', 'child_process'])

/** What a name of a test framework does with a function passed to it: a test and a hook run it later, a describe now. */
type Api = 'test' | 'hook' | 'describe'

/** The names of vitest and of Playwright that take a function, by their imported name. */
const FRAMEWORKS: Record<string, Record<string, Api>> = {
  vitest: { it: 'test', test: 'test', describe: 'describe', suite: 'describe', beforeEach: 'hook', afterEach: 'hook', beforeAll: 'hook', afterAll: 'hook', aroundEach: 'hook', aroundAll: 'hook' },
  '@playwright/test': { test: 'test' },
}
/** test/quarantine.ts: `quarantined('<id>')` gives back a test of vitest, which keeps its function for later. */
const QUARANTINE: Record<string, Api> = { quarantined: 'test' }

/** The members of a test that are a test still: they keep the function for later, as the test does. */
const TEST_MEMBERS = new Set(['only', 'skip', 'fixme', 'fail', 'fails', 'slow', 'todo', 'concurrent', 'sequential', 'skipIf', 'runIf', 'each', 'for', 'extend'])
/** The members of a test that are hooks: `test.beforeEach`, `test.step`. */
const HOOK_MEMBERS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'aroundEach', 'aroundAll', 'step'])
/** The members of a test that are a describe: `test.describe`. */
const DESCRIBE_MEMBERS = new Set(['describe', 'suite'])

/** Every .ts and .tsx file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const parse = (text: string, name = 'file.ts'): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)

/** The file a relative specifier names, or undefined when it names none. */
type Resolve = (from: string, specifier: string) => string | undefined

/** A relative specifier on the disk: the file itself, with .ts or .tsx, or the index.ts of a folder. */
const onDisk: Resolve = (from, specifier) => {
  const base = resolve(dirname(from), specifier)
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

interface Imported {
  /** The resolved path of the module. */
  module: string
  /** The name the module exports. */
  name: string
}

interface Source {
  path: string
  file: ts.SourceFile
  /** Local names of execFileSync, execSync and spawnSync of node:child_process. */
  calls: Set<string>
  /** Local names of the module node:child_process itself. */
  modules: Set<string>
  /** Local names imported from a file of the repo, with where they come from. */
  imports: Map<string, Imported>
  /** Local names of a package, or of a relative module that is not there: functions of no file of the repo. */
  foreign: Set<string>
  /** Local names of a whole file of the repo: `import * as z`, `import z = require(…)`. */
  namespaces: Map<string, string>
  /** Local names of vitest and Playwright, with what they do with a function. */
  frameworks: Map<string, Api>
  /** Names this file exports from another one: `export { a as b } from './m'`, `export { a }` of an import. */
  reexports: Map<string, Imported>
  /** The modules of `export * from …`. */
  stars: string[]
  /** The names the top level declares. */
  declared: Set<string>
  /** `const x = <expression>`: what a name stands for. */
  values: Map<string, ts.Expression>
  /** `const { a, b: c } = <expression>`: the names taken out of an object. */
  destructured: Map<string, { from: ts.Expression; property: string }>
  /** The files of the repo this file loads, types apart. */
  loads: string[]
  /** The calls and the news of the file, in the order of the text: the search goes over them again and again. */
  callSites: (ts.CallExpression | ts.NewExpression)[]
}

function isRequireOfChildProcess(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') return false
  const [module] = node.arguments
  return node.arguments.length === 1 && module !== undefined && ts.isStringLiteral(module) && CHILD_PROCESS.has(module.text)
}

/** What a file imports, exports, declares and calls the spawning functions of node:child_process. */
function readSource(path: string, text: string, resolveModule: Resolve): Source {
  const file = parse(text, path)
  const s: Source = {
    path,
    file,
    calls: new Set(),
    modules: new Set(),
    imports: new Map(),
    foreign: new Set(),
    namespaces: new Map(),
    frameworks: new Map(),
    reexports: new Map(),
    stars: [],
    declared: new Set(),
    values: new Map(),
    destructured: new Map(),
    loads: [],
    callSites: [],
  }
  const local = (specifier: string): string | undefined => (specifier.startsWith('.') ? resolveModule(path, specifier) : undefined)

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (clause?.isTypeOnly) continue
      const module = local(specifier)
      if (module !== undefined) s.loads.push(module)
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter((element) => !element.isTypeOnly) : []
      const namespace = clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : undefined
      if (CHILD_PROCESS.has(specifier)) {
        if (clause?.name) s.modules.add(clause.name.text)
        if (namespace !== undefined) s.modules.add(namespace)
        for (const element of named) if (SPAWNS.has((element.propertyName ?? element.name).text)) s.calls.add(element.name.text)
        continue
      }
      const framework = FRAMEWORKS[specifier] ?? (/(?:^|\/)quarantine$/.test(specifier) ? QUARANTINE : undefined)
      for (const element of named) {
        const imported = (element.propertyName ?? element.name).text
        const api = framework?.[imported]
        if (api !== undefined) s.frameworks.set(element.name.text, api)
        if (module !== undefined) s.imports.set(element.name.text, { module, name: imported })
        else s.foreign.add(element.name.text)
      }
      if (clause?.name) {
        if (module !== undefined) s.imports.set(clause.name.text, { module, name: 'default' })
        else s.foreign.add(clause.name.text)
      }
      if (namespace !== undefined && module !== undefined) s.namespaces.set(namespace, module)
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly && ts.isExternalModuleReference(statement.moduleReference)) {
      // import cp = require('child_process')
      const reference = statement.moduleReference.expression
      if (!ts.isStringLiteral(reference)) continue
      if (CHILD_PROCESS.has(reference.text)) s.modules.add(statement.name.text)
      const module = local(reference.text)
      if (module !== undefined) {
        s.loads.push(module)
        s.namespaces.set(statement.name.text, module)
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const module = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? local(statement.moduleSpecifier.text) : undefined
      if (module !== undefined) s.loads.push(module)
      const clause = statement.exportClause
      if (statement.moduleSpecifier === undefined && clause && ts.isNamedExports(clause)) {
        // export { a as b }: of an import, or of a name of this file under another one
        for (const element of clause.elements) {
          const name = (element.propertyName ?? element.name).text
          const imported = s.imports.get(name)
          if (imported !== undefined) s.reexports.set(element.name.text, imported)
          else if (name !== element.name.text) s.reexports.set(element.name.text, { module: path, name })
        }
      } else if (module !== undefined && clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) s.reexports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text })
      } else if (module !== undefined && clause === undefined) s.stars.push(module)
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) s.declared.add(statement.name.text)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) s.declared.add(declaration.name.text)
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) s.callSites.push(node)
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = node.initializer
      if (ts.isIdentifier(node.name)) {
        // const cp = require('node:child_process')
        if (isRequireOfChildProcess(initializer)) s.modules.add(node.name.text)
        else s.values.set(node.name.text, initializer)
      } else if (ts.isObjectBindingPattern(node.name)) {
        // const { execFileSync } = require('node:child_process'), const { beforeAll } = test
        for (const element of node.name.elements) {
          const imported = element.propertyName ?? element.name
          if (!ts.isIdentifier(imported) || !ts.isIdentifier(element.name)) continue
          if (isRequireOfChildProcess(initializer)) {
            if (SPAWNS.has(imported.text)) s.calls.add(element.name.text)
          } else s.destructured.set(element.name.text, { from: initializer, property: imported.text })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return s
}

/** The files of a run: those of the entries and every file of the repo they load, each once. */
interface Program {
  files: Map<string, Source>
  /** Whether a call runs the functions passed to it now, once asked: it does not change between the rounds of the search. */
  now: Map<ts.Node, boolean>
}

function program(entries: string[], read: (path: string) => string, resolveModule: Resolve): Program {
  const files = new Map<string, Source>()
  const queue = [...entries]
  while (queue.length > 0) {
    const path = queue.shift()!
    if (files.has(path)) continue
    const source = readSource(path, read(path), resolveModule)
    files.set(path, source)
    queue.push(...source.loads)
  }
  return { files, now: new Map() }
}

const keyIn = (path: string, name: string): string => `${path}#${name}`

/** The key of what a module exports under a name: the file that declares it and its name there. */
function exportKey(p: Program, path: string, name: string, depth = 0): string {
  const source = p.files.get(path)
  if (source === undefined || depth > 20) return keyIn(path, name)
  const reexport = source.reexports.get(name)
  if (reexport !== undefined) return exportKey(p, reexport.module, reexport.name, depth + 1)
  if (source.declared.has(name)) return keyIn(path, name)
  for (const star of source.stars) {
    const key = exportKey(p, star, name, depth + 1)
    if (key !== keyIn(star, name) || p.files.get(star)?.declared.has(name)) return key
  }
  return keyIn(path, name)
}

/** The key of a name as a file uses it: through its import, or a name of the file itself; undefined for a name of a package. */
function keyOf(p: Program, source: Source, name: string): string | undefined {
  const imported = source.imports.get(name)
  if (imported !== undefined) return exportKey(p, imported.module, imported.name)
  if (source.foreign.has(name)) return undefined
  return keyIn(source.path, name)
}

/** What a member of a name of a test framework is. */
function member(api: Api, name: string): Api | undefined {
  if (api === 'describe') return 'describe'
  if (api === 'hook') return undefined
  if (DESCRIBE_MEMBERS.has(name)) return 'describe'
  if (HOOK_MEMBERS.has(name)) return 'hook'
  return TEST_MEMBERS.has(name) ? 'test' : undefined
}

/** What a name of a file is as a test framework goes, from where it comes: an import, a destructuring, a `const`. */
function apiOf(p: Program, source: Source, name: string, seen: Set<string>): Api | undefined {
  const key = keyIn(source.path, name)
  if (seen.has(key)) return undefined
  seen.add(key)
  const direct = source.frameworks.get(name)
  if (direct !== undefined) return direct
  const imported = source.imports.get(name)
  if (imported !== undefined) {
    const target = exportKey(p, imported.module, imported.name)
    const at = target.lastIndexOf('#')
    const file = p.files.get(target.slice(0, at))
    return file === undefined ? undefined : apiOf(p, file, target.slice(at + 1), seen)
  }
  const taken = source.destructured.get(name)
  if (taken !== undefined) {
    const from = apiOfExpression(p, source, taken.from, seen)
    return from === undefined ? undefined : member(from, taken.property)
  }
  const value = source.values.get(name)
  if (value !== undefined) return apiOfExpression(p, source, value, seen)
  const declared = source.file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  return declared !== undefined && handsOnLater(p, source, declared, seen) ? 'hook' : undefined
}

/**
 * Whether a function only hands its parameters on to a test or a hook and never runs one itself, as
 * `beforeBlock` of test/contract/harness-evals-outcome.test.ts does with `beforeAll(async () => { await build() }, timeout)`.
 * Each use of a parameter is an argument of such a call or lies inside a function that is one. A call
 * of the function is then a hook too: it keeps the function passed to it for later.
 */
function handsOnLater(p: Program, source: Source, fn: ts.FunctionLikeDeclaration, seen: Set<string>): boolean {
  const names = new Set(fn.parameters.flatMap((parameter) => (ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])))
  if (names.size === 0 || fn.body === undefined) return false
  const kept = (use: ts.Node): boolean => {
    for (let at = use; at !== fn; at = at.parent) {
      const call = at.parent
      if (!ts.isCallExpression(call) || call.expression === at) continue
      const api = apiOfExpression(p, source, call.expression, new Set(seen))
      if (api === 'test' || api === 'hook') return true
    }
    return false
  }
  let later = true
  const visit = (node: ts.Node): void => {
    if (!later) return
    if (ts.isIdentifier(node) && names.has(node.text)) later = kept(node)
    else ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return later
}

/** What an expression is as a test framework goes: `test`, `test.describe`, `it.skipIf(…)`, `test.extend(…)`. */
function apiOfExpression(p: Program, source: Source, expression: ts.Expression, seen = new Set<string>()): Api | undefined {
  let at = expression
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isNonNullExpression(at) || ts.isTypeAssertionExpression(at)) at = at.expression
  if (ts.isIdentifier(at)) return apiOf(p, source, at.text, seen)
  if (ts.isCallExpression(at)) return apiOfExpression(p, source, at.expression, seen)
  if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) return handsOnLater(p, source, at, seen) ? 'hook' : undefined
  if (ts.isPropertyAccessExpression(at)) {
    const of = apiOfExpression(p, source, at.expression, seen)
    return of === undefined ? undefined : member(of, at.name.text)
  }
  return undefined
}

/** Whether a call runs the functions passed to it now: anything but a test and a hook; a `new` does. */
function runsNow(p: Program, source: Source, call: ts.CallExpression | ts.NewExpression): boolean {
  if (ts.isNewExpression(call)) return true
  let now = p.now.get(call)
  if (now === undefined) {
    const api = apiOfExpression(p, source, call.expression)
    now = api !== 'test' && api !== 'hook'
    p.now.set(call, now)
  }
  return now
}

/** Whether a function runs when the code around it runs: called where it is written, or passed to a call that runs it. */
function runsWithParent(p: Program, source: Source, fn: ts.Node): boolean {
  let at: ts.Node = fn
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent
  const parent = at.parent
  if (!ts.isCallExpression(parent) && !ts.isNewExpression(parent)) return false
  if (parent.expression === at) return true
  return runsNow(p, source, parent)
}

/** The functions of a file that start a process when called, by their keys. */
type Spawning = ReadonlySet<string>

/** Whether a call starts a process: a spawning function of node:child_process, or a spawning function by its name or through the namespace of its file. */
function startsProcess(p: Program, source: Source, call: ts.CallExpression, spawning: Spawning): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    const key = keyOf(p, source, callee.text)
    return source.calls.has(callee.text) || (key !== undefined && spawning.has(key))
  }
  if (!ts.isPropertyAccessExpression(callee)) return false
  const target = callee.expression
  if (ts.isIdentifier(target)) {
    const namespace = source.namespaces.get(target.text)
    if (namespace !== undefined) return spawning.has(exportKey(p, namespace, callee.name.text))
    return SPAWNS.has(callee.name.text) && source.modules.has(target.text)
  }
  return SPAWNS.has(callee.name.text) && isRequireOfChildProcess(target)
}

/**
 * The places of a file that start a process: the calls that do, and a spawning function passed by
 * its name to a call that runs it.
 */
function spawnSites(p: Program, source: Source, spawning: Spawning): ts.Node[] {
  const found: ts.Node[] = []
  const spawns = (arg: ts.Expression): boolean => {
    if (!ts.isIdentifier(arg)) return false
    const key = keyOf(p, source, arg.text)
    return source.calls.has(arg.text) || (key !== undefined && spawning.has(key))
  }
  for (const node of source.callSites) {
    if (ts.isCallExpression(node) && startsProcess(p, source, node, spawning)) found.push(node)
    if (runsNow(p, source, node)) found.push(...(node.arguments ?? []).filter(spawns))
  }
  return found
}

const isStatic = (node: ts.PropertyDeclaration): boolean => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false

/**
 * What a place runs in, as far as running goes: the function it waits in, or the field of a class
 * whose initialiser runs on `new`; undefined when it runs while the module loads.
 */
function enclosingScope(p: Program, source: Source, node: ts.Node): ts.Node | undefined {
  for (let child = node, at = node.parent; at !== undefined; child = at, at = at.parent) {
    if (ts.isFunctionLike(at) && !runsWithParent(p, source, at)) return at
    if (ts.isPropertyDeclaration(at) && at.initializer === child && !isStatic(at)) return at
  }
  return undefined
}

/** The name a function is declared with: `function f`, `const f = () => …`, `const f = function …`. */
function declaredName(scope: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(scope)) return scope.name?.text
  if ((ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) && ts.isVariableDeclaration(scope.parent) && ts.isIdentifier(scope.parent.name)) return scope.parent.name.text
  return undefined
}

/**
 * The keys of the functions declared in the files of a run that start a process when called, also
 * through another function of the set. A function that only hands its process to a test or a hook
 * starts none itself.
 */
function spawningFunctions(p: Program): Set<string> {
  const spawning = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const source of p.files.values()) {
      for (const site of spawnSites(p, source, spawning)) {
        const scope = enclosingScope(p, source, site)
        const name = scope === undefined ? undefined : declaredName(scope)
        if (name !== undefined && !spawning.has(keyIn(source.path, name))) {
          spawning.add(keyIn(source.path, name))
          grew = true
        }
      }
    }
  }
  return spawning
}

/** The places of a file that start a process while the module loads, as `line: text`. */
function spawnsOnLoad(p: Program, source: Source, spawning: Spawning): string[] {
  return spawnSites(p, source, spawning)
    .filter((site) => enclosingScope(p, source, site) === undefined)
    .map((site) => `${source.file.getLineAndCharacterOfPosition(site.getStart()).line + 1}: ${site.getText().split('\n')[0]!.trim()}`)
}

/**
 * The search over texts as the files of one run: the first texts may hold helpers, the last is
 * searched. A text is a file `fileN.ts`, or `[name, text]` for a file another one imports by name.
 */
function searched(...texts: (string | [string, string])[]): string[] {
  const named = texts.map((text, index): [string, string] => (typeof text === 'string' ? [`/v/file${index}.ts`, text] : [`/v/${text[0]}`, text[1]]))
  const byPath = new Map(named)
  const inMemory: Resolve = (from, specifier) => {
    const base = posix.join(posix.dirname(from), specifier)
    return [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => byPath.has(candidate))
  }
  const p = program([...byPath.keys()], (path) => byPath.get(path)!, inMemory)
  return spawnsOnLoad(p, p.files.get(named.at(-1)![0])!, spawningFunctions(p))
}

const inRepo = (path: string): string => relative(REPO, path).replace(/\\/g, '/')

/**
 * The processes files of test/contract start while they load on purpose, as `file: text` of the call:
 * none of them can stop the file loading on a system the tests run on. A new one comes here only with
 * the same argument; one that is gone from its file fails the test, so the list does not outlive it.
 */
const STARTED_ON_LOAD_ON_PURPOSE: Record<string, { why: string; calls: string[] }> = {
  'test/contract/link-access.test.ts': {
    why: 'git, which every system of the tests has (the app needs it), builds the repositories of the file at its top level',
    calls: ["git(repo, 'init', '-q')", "git(repo, 'add', '.')", "git(repo, 'commit', '-q', '-m', 'init')", "git(second, 'init', '-q')", "git(second, 'add', '.')", "git(second, 'commit', '-q', '-m', 'init')"],
  },
  'test/contract/statusline-bridge.test.ts': {
    why: 'tool() is a spawnSync of /bin/sh, which returns the error where there is no /bin/sh instead of throwing it',
    calls: ["tool('jq')"],
  },
  'test/contract/workflow-profile.test.ts': { why: 'hasSh() of test/harness-node.ts is a spawnSync for it.skipIf: it returns false where sh does not start', calls: ['hasSh()'] },
  'test/contract/workflow-reader.test.ts': { why: 'hasSh() of test/harness-node.ts is a spawnSync for it.skipIf: it returns false where sh does not start', calls: ['hasSh()'] },
}

/** A call found at load (`<line>: <text>`) is on purpose when its file is on the list and the text of the call too. */
const onPurpose = ({ path, use }: { path: string; use: string }): boolean => STARTED_ON_LOAD_ON_PURPOSE[path]?.calls.includes(use.replace(/^\d+: /, '')) ?? false

describe('a process started while a module of test/e2e or test/contract loads', () => {
  // It parses every file of the two folders and of src/ that they load: about 2 s alone on Windows, more in a full run.
  it('is started by no file of test/e2e or test/contract, nor by a file they load: Playwright loads every spec before it runs any, vitest fails the whole file', { timeout: 20_000 }, () => {
    const p = program(ROOTS.flatMap(sources), (path) => readFileSync(path, 'utf8'), onDisk)
    const spawning = spawningFunctions(p)
    const found = [...p.files.values()].flatMap((source) => spawnsOnLoad(p, source, spawning).map((use) => ({ path: inRepo(source.path), use })))
    expect(found.filter((site) => !onPurpose(site)).map(({ path, use }) => `${path}:${use}`)).toEqual([])
    const listed = Object.entries(STARTED_ON_LOAD_ON_PURPOSE).flatMap(([path, { calls }]) => calls.map((call) => `${path}: ${call}`))
    expect(listed.filter((entry) => !found.some(({ path, use }) => `${path}: ${use.replace(/^\d+: /, '')}` === entry))).toEqual([])
    // The search sees the helpers it must: the zsh lookup and what calls it, and a file from outside the two folders.
    const keys = [...spawning].map((key) => inRepo(key))
    expect(keys).toEqual(expect.arrayContaining(['test/zsh.ts#zshPath', 'test/e2e/terminal-ai-helpers.ts#terminalAiSandbox', 'scripts/build-version.ts#buildVersion']))
    const paths = [...p.files.keys()].map(inRepo)
    expect(paths).toContain('scripts/build-version.ts')
    expect(paths).toContain('test/contract/ipc-renderer.test.tsx')
    expect(paths).toEqual(expect.arrayContaining(['test/contract/terminal-ai-zle.test.ts', 'test/contract/terminal-shell-integration.test.ts']))
  })

  it.each<[string, { path: string; use: string }, boolean]>([
    ['a listed call in its file is on purpose', { path: 'test/contract/link-access.test.ts', use: "12: git(repo, 'init', '-q')" }, true],
    ['another call in a listed file is not', { path: 'test/contract/link-access.test.ts', use: "12: execSync('git init')" }, false],
    ['a listed call in another file is not', { path: 'test/contract/terminal.test.ts', use: "12: git(repo, 'init', '-q')" }, false],
  ])('the list of processes started on purpose: %s', (_name, site, listed) => {
    expect(onPurpose(site)).toBe(listed)
  })

  const IMPORT = "import { test } from '@playwright/test'; import { execFileSync, execSync, spawnSync } from 'node:child_process'\n"
  const VITEST = "import { afterEach, beforeAll, describe, it } from 'vitest'; import { execFileSync, execSync } from 'node:child_process'\n"

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
    { name: 'the module object of an import = require', text: "import cp = require('child_process')\ncp.execSync('ls')", found: ["2: cp.execSync('ls')"] },
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
    { name: 'a test of no framework: test that was not imported', text: "import { execSync } from 'node:child_process'\ntest('x', () => { execSync('ls') })", found: ["2: execSync('ls')"] },
    { name: 'a spawning function passed by its name', text: `${IMPORT}const run = (d: string) => execFileSync('git', [d])\n;['a'].forEach(run)`, found: ['3: run'] },
    {
      name: 'a function of the file that runs its parameter now, hands it to a describe, or does both',
      text: `${VITEST}const now = (run: () => unknown) => { run() }\nconst build = () => { execSync('git init') }\nnow(build)\nconst group = (body: () => void) => { describe('x', body) }\ngroup(() => { execFileSync('git') })\nconst both = (run: () => unknown) => { beforeAll(run); [1].map(run) }\nboth(build)`,
      found: ['4: build', "6: execFileSync('git')", '8: build'],
    },
    { name: 'the function of a new Promise: it runs at once', text: `${IMPORT}const head = new Promise((resolve) => resolve(execFileSync('git')))\nconst run = (resolve: () => void) => execSync('ls')\nconst done = new Promise(run)`, found: ["2: execFileSync('git')", '4: run'] },
    { name: 'the initialiser of a static field', text: `${IMPORT}class Repo {\n  static head = execFileSync('git')\n}`, found: ["3: execFileSync('git')"] },
    { name: 'a top-level constant of a vitest file', text: `${VITEST}const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()`, found: ["2: execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' })"] },
    { name: 'the callback of a vitest describe, also of describe.skipIf', text: `${VITEST}describe('x', () => {\n  const head = execFileSync('git')\n})\ndescribe.skipIf(false)('y', () => { execSync('ls') })`, found: ["3: execFileSync('git')", "5: execSync('ls')"] },
    // Passed by: what runs only when something calls it.
    { name: 'an arrow function of one line', text: `${IMPORT}const git = (...args: string[]) => execFileSync('git', args)`, found: [] },
    { name: 'a function', text: `${IMPORT}function git(...args: string[]) {\n  return execFileSync('git', args)\n}`, found: [] },
    { name: 'a test and a hook', text: `${IMPORT}test.beforeEach(() => { execSync('git init') })\ntest('x', async () => { spawnSync('git') })\ntest.skip('y', () => { execSync('ls') })`, found: [] },
    { name: 'a step of a test, and a function given to the test by its name', text: `${IMPORT}const run = () => execSync('ls')\ntest('x', run)\ntest('y', async () => { await test.step('s', () => { execSync('ls') }) })`, found: [] },
    { name: 'a helper called inside a test', text: `${IMPORT}const zsh = () => execFileSync('/bin/sh')\ntest('x', () => { zsh() })`, found: [] },
    { name: 'a helper that only adds a hook, called at the top level', text: `${IMPORT}function setup() {\n  test.afterEach(() => { execSync('x') })\n}\nsetup()`, found: [] },
    {
      name: 'a function of the file that only hands its parameters on to a hook or a test: a hook too',
      text: `${VITEST}const beforeBlock = (build: () => unknown, timeout: number): void => {\n  beforeAll(async () => {\n    await build()\n  }, timeout)\n  afterEach(() => {})\n}\nconst build = () => { execSync('git init') }\nbeforeBlock(build, 1000)\nbeforeBlock(() => { execSync('ls') }, 1000)\nfunction later(run: () => void) {\n  it('x', run)\n}\nlater(() => { execFileSync('git') })`,
      found: [],
    },
    { name: 'a function called where it is written, inside a function no one calls', text: `${IMPORT}function f() { (() => execFileSync('git'))() }`, found: [] },
    { name: 'a call inside a string', text: "const SCRIPT = String.raw`\nconst { execFileSync } = require('node:child_process')\nexecFileSync('git')\n`", found: [] },
    { name: 'a call in a comment', text: `${IMPORT}// execFileSync('/bin/sh')\n/* spawnSync('git') */`, found: [] },
    { name: 'another function of the same name', text: "import { execFileSync } from './elsewhere'\nexecFileSync('git')\nconst { execSync } = require('./elsewhere')\nexecSync('ls')\nrequire('./elsewhere').spawnSync('ls')", found: [] },
    { name: 'hooks taken out of test by destructuring', text: `${IMPORT}const { beforeAll, afterEach } = test\nbeforeAll(() => { execSync('git init') })\nafterEach(async () => { spawnSync('git') })`, found: [] },
    { name: 'test.extend under another name, its hooks and its modifiers', text: `${IMPORT}const it2 = test.extend({})\nit2('x', () => { execSync('ls') })\nit2.beforeEach(() => { execSync('ls') })\nit2.skip('y', () => { execSync('ls') })`, found: [] },
    { name: 'the tests and hooks of vitest, also under another name', text: "import { beforeAll as setup, it, test as check } from 'vitest'; import { execSync } from 'node:child_process'\nsetup(() => { execSync('a') })\nit('x', () => { execSync('b') })\nit.skipIf(false)('y', () => { execSync('c') })\nit.each([1])('z %i', () => { execSync('d') })\ncheck('w', () => { execSync('e') })", found: [] },
    { name: 'a test in quarantine (test/quarantine.ts) starts its processes when it runs', text: "import { quarantined } from '../quarantine'; import { execSync } from 'node:child_process'\nquarantined(\"x\")('y', () => { execSync('a') }, 30_000)", found: [] },
    { name: 'a vitest describe whose tests and hooks start the processes', text: `${VITEST}describe('x', () => {\n  beforeAll(() => { execSync('git init') })\n  it('y', () => { execFileSync('git') })\n  afterEach(() => { execSync('ls') })\n})`, found: [] },
    { name: 'the initialiser of a field: it runs on new, not at load', text: `${IMPORT}class Repo {\n  head = execFileSync('git')\n}`, found: [] },
    { name: 'the calls that do not wait', text: "import * as cp from 'node:child_process'\nimport { execFile, spawn } from 'node:child_process'\nspawn('git')\nexecFile('git')\ncp.spawn('git')", found: [] },
  ])('$name', ({ text, found }) => {
    expect(searched(text)).toEqual(found)
  })

  it('a helper of another file counts: a top-level call of the zsh lookup is found', () => {
    const zsh: [string, string] = ['zsh.ts', "import { execFileSync } from 'node:child_process'\nexport function zshPath(): string {\n  return execFileSync('/bin/sh')\n}"]
    expect(searched(zsh, "import { zshPath } from './zsh'\nconst ZSH = zshPath()")).toEqual(['2: zshPath()'])
    expect(searched(zsh, "import * as z from './zsh'\nconst Z = z.zshPath()")).toEqual(['2: z.zshPath()'])
    expect(searched(zsh, "import z = require('./zsh')\nconst Z = z.zshPath()")).toEqual(['2: z.zshPath()'])
    expect(searched(zsh, ['index.ts', "export { zshPath as lookup } from './zsh'"], "import { lookup } from './index'\nconst Z = lookup()")).toEqual(['2: lookup()'])
    expect(searched(zsh, `${IMPORT}import { zshPath } from './zsh'\ntest('x', () => { zshPath() })`)).toEqual([])
  })

  it('a namesake of a spawning function from another module, or a method of the same name, is not it', () => {
    const helper: [string, string] = ['helper.ts', "import { execFileSync } from 'node:child_process'\nexport function start() {\n  return execFileSync('git')\n}"]
    expect(searched(helper, "import { start } from 'launcher'\nstart()\nconst server = { start: () => 1 }\nserver.start()")).toEqual([])
    // The spawning start itself, imported, is found.
    expect(searched(helper, "import { start } from './helper'\nstart()")).toEqual(['2: start()'])
  })

  it('a test or a hook imported from a file that made it with test.extend keeps its function for later', () => {
    const fixtures: [string, string] = ['fixtures.ts', "import { test as base } from '@playwright/test'\nexport const test = base.extend({})\nexport const { beforeEach } = test"]
    expect(searched(fixtures, "import { execSync } from 'node:child_process'\nimport { beforeEach, test } from './fixtures'\ntest('x', () => { execSync('a') })\nbeforeEach(() => { execSync('b') })\ntest.describe('d', () => { execSync('c') })")).toEqual(["5: execSync('c')"])
  })
})
