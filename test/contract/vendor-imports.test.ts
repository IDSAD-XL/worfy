// The Vendor drivers do not import the app's Session registry (worfy-multi-vendor ticket 16, ADR-0094).
// src/main/agent/app-registry.ts is made over the Claude driver: it imports src/main/vendors/registry.ts,
// which imports the drivers. A driver file that imported the registry back — by a static import, an
// `import type`, an `export … from`, an `import()` or a require — would make the cycle that ticket 13
// left and ticket 16 ended. Two checks over src/main/vendors/:
// - no file names src/main/agent/app-registry in an import of any kind;
// - no file reaches it through static imports of other files either (type-only imports do not load a
//   module and are not followed). An `import()` is followed by neither: it loads the module at the
//   call, after both have loaded.
// The checks take the root they look at, so the control cases run them on a temporary tree with a
// planted file.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const VENDORS = 'src/main/vendors'
/** The module no driver may import, without its extension. */
const APP_REGISTRY = 'src/main/agent/app-registry'
/** The source files the parser reads. */
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
/** How a relative module name without an extension is found, in the order the bundler tries. */
const CANDIDATES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']

/** Every source file under `dir` of `root`, relative to `root` with forward slashes. */
function sourceFiles(root: string, dir: string): string[] {
  const files: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (SOURCE.test(entry.name)) files.push(child)
    }
  }
  if (existsSync(join(root, dir))) walk(dir)
  return files.sort()
}

/** One module a file imports: its name as written, the line, and whether loading the file loads it. */
interface ModuleImport {
  name: string
  line: number
  statement: string
  /** A static import or `export … from` that is not type-only, or a require: the module loads with the file. */
  loads: boolean
}

const textOf = (node: ts.Node | undefined): string | null => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : null)

/** Every module `file` of `root` imports, as the TypeScript parser sees it; comments do not count. */
function importsOf(root: string, file: string): ModuleImport[] {
  const source = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: ModuleImport[] = []
  const add = (node: ts.Node, name: string | null, loads: boolean): void => {
    if (name === null) return
    let statement = node
    while (statement.parent !== undefined && !ts.isSourceFile(statement.parent)) statement = statement.parent
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    found.push({ name, line, statement: (statement.getText(source).split('\n')[0] ?? '').trim(), loads })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // Only `import type` is dropped from the build: `import { type X }` may still load the module.
      add(node, textOf(node.moduleSpecifier), node.importClause?.isTypeOnly !== true)
    } else if (ts.isExportDeclaration(node)) {
      add(node, textOf(node.moduleSpecifier), !node.isTypeOnly)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, textOf(node.moduleReference.expression), !node.isTypeOnly)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, textOf(node.argument.literal), false)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) add(node, textOf(node.arguments[0]), false)
      else if (ts.isIdentifier(callee) && callee.text === 'require') add(node, textOf(node.arguments[0]), true)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The file of `root` a relative module name of `file` stands for, relative to `root`; null for a package or a name not found. */
function resolveImport(root: string, file: string, name: string): string | null {
  if (!name.startsWith('.')) return null
  const base = join(dirname(join(root, file)), name.split('?')[0] ?? name)
  // A `.js` name of a TypeScript file (NodeNext style) is the `.ts` file.
  const names = /\.(js|mjs)$/.test(base) ? [base.replace(/\.(js|mjs)$/, (ext) => (ext === '.js' ? '.ts' : '.mts')), base] : CANDIDATES.map((ext) => base + ext)
  const found = names.find((path) => existsSync(path) && statSync(path).isFile())
  return found === undefined ? null : relative(root, found).split('\\').join('/')
}

const isAppRegistry = (path: string | null): boolean => path !== null && path.replace(/\.(ts|tsx|mts|js|mjs)$/, '') === APP_REGISTRY

/** `<file>:<line>: <statement>` for each import of src/main/agent/app-registry by a file under src/main/vendors/ of `root`. */
function registryImports(root: string): string[] {
  return sourceFiles(root, VENDORS).flatMap((file) =>
    importsOf(root, file)
      .filter((entry) => isAppRegistry(resolveImport(root, file, entry.name)))
      .map((entry) => `${file}:${entry.line}: ${entry.statement}`),
  )
}

/**
 * For each file under src/main/vendors/ of `root` that loads src/main/agent/app-registry through a
 * chain of static imports, the chain: `a.ts -> b.ts -> src/main/agent/app-registry.ts`.
 */
function registryChains(root: string): string[] {
  const loads = new Map<string, string[]>()
  const loadedBy = (file: string): string[] => {
    let next = loads.get(file)
    if (next === undefined) {
      next = importsOf(root, file)
        .filter((entry) => entry.loads)
        .map((entry) => resolveImport(root, file, entry.name))
        .filter((path): path is string => path !== null && SOURCE.test(path))
      loads.set(file, next)
    }
    return next
  }
  const chains: string[] = []
  for (const start of sourceFiles(root, VENDORS)) {
    const previous = new Map<string, string | null>([[start, null]])
    const queue = [start]
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (isAppRegistry(file)) {
        const chain: string[] = []
        for (let at: string | null = file; at !== null; at = previous.get(at) ?? null) chain.unshift(at)
        chains.push(chain.join(' -> '))
        break
      }
      for (const next of loadedBy(file)) {
        if (!previous.has(next)) {
          previous.set(next, file)
          queue.push(next)
        }
      }
    }
  }
  return chains
}

describe('the Vendor drivers do not import the app Session registry', () => {
  it('no file under src/main/vendors/ imports src/main/agent/app-registry, statically or through import()', () => {
    expect(sourceFiles(repo, VENDORS).length).toBeGreaterThan(20)
    expect(existsSync(join(repo, `${APP_REGISTRY}.ts`))).toBe(true)
    expect(registryImports(repo)).toEqual([])
  })

  it('no file under src/main/vendors/ loads src/main/agent/app-registry through a chain of static imports', () => {
    expect(registryChains(repo)).toEqual([])
  })

  it('the registry still imports the drivers: the rule guards a cycle that would exist', () => {
    const registry = importsOf(repo, `${APP_REGISTRY}.ts`).map((entry) => resolveImport(repo, `${APP_REGISTRY}.ts`, entry.name))
    expect(registry).toContain(`${VENDORS}/registry.ts`)
  })
})

describe('control cases: a planted import reds the checks', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) removeTestTree(root)
  })

  /** A tree with the registry, a neutral helper, and `files` (path → text) added. */
  const plant = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'worfy-vendor-imports-'))
    roots.push(root)
    const all: Record<string, string> = {
      [`${APP_REGISTRY}.ts`]: "import { vendorDriver } from '../vendors/registry'\nexport const sharedRegistry = () => vendorDriver\n",
      [`${VENDORS}/registry.ts`]: "export const vendorDriver = () => null\n",
      'src/main/helper.ts': 'export const helper = 1\n',
      ...files,
    }
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return root
  }

  it('a clean tree passes both checks', () => {
    const root = plant({ [`${VENDORS}/claude/query.ts`]: "import { helper } from '../../helper'\nexport const q = helper\n" })
    expect(registryImports(root)).toEqual([])
    expect(registryChains(root)).toEqual([])
  })

  it.each([
    ['a static import', "import { sharedRegistry } from '../../agent/app-registry'"],
    ['an import type', "import type { sharedRegistry } from '../../agent/app-registry'"],
    ['an export from', "export { sharedRegistry } from '../../agent/app-registry'"],
    ['an import() at the call', "export const later = () => import('../../agent/app-registry')"],
    ['a require', "export const now = require('../../agent/app-registry')"],
    ['a name with the extension', "import { sharedRegistry } from '../../agent/app-registry.ts'"],
    ['a type import()', "export type R = typeof import('../../agent/app-registry')"],
  ])('%s of the registry by a driver file is named', (_kind, line) => {
    const root = plant({ [`${VENDORS}/claude/query.ts`]: `// a comment naming '../../agent/app-registry' does not count\n${line}\n` })
    expect(registryImports(root)).toEqual([`${VENDORS}/claude/query.ts:2: ${line}`])
  })

  it('a comment naming the registry is not an import', () => {
    const root = plant({ [`${VENDORS}/claude/query.ts`]: "// import { sharedRegistry } from '../../agent/app-registry'\nexport const q = 1\n" })
    expect(registryImports(root)).toEqual([])
  })

  it('a static chain through a file outside src/main/vendors/ is named; an import() or a type-only import on the way is not followed', () => {
    const root = plant({
      [`${VENDORS}/claude/query.ts`]: "import { via } from '../../mcp/via'\nexport const q = via\n",
      'src/main/mcp/via.ts': "import { sharedRegistry } from '../agent/app-registry'\nexport const via = sharedRegistry\n",
      [`${VENDORS}/claude/lazy.ts`]: "export const later = () => import('../../mcp/via')\n",
      [`${VENDORS}/claude/typed.ts`]: "import type { via } from '../../mcp/via'\nexport type V = typeof via\n",
    })
    expect(registryImports(root)).toEqual([])
    expect(registryChains(root)).toEqual([`${VENDORS}/claude/query.ts -> src/main/mcp/via.ts -> ${APP_REGISTRY}.ts`])
  })
})
