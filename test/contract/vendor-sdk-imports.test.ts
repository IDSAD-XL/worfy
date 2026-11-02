// Only the Claude driver imports the Agent SDK (worfy-multi-vendor ticket 12; ADR-0094, item 4). Over
// src/: a file outside src/main/vendors/claude/ that names the package @anthropic-ai/claude-agent-sdk
// in its code — an import, an `import type`, an `import()`, a require, a resolve, a type `import('…')`,
// a platform package `claude-agent-sdk-<platform>-<arch>` — is named with its line; comments do not
// count. The SDK's types do not leave the folder either: a file of src/main/vendors/claude/ does not
// re-export from the package, and exports no SDK name, alias or interface built on one.
//
// Today 15 files import the SDK. Each is listed below with the ticket of this epic that takes the
// import away (14, 15 or 16). An exception that no longer imports is only reported, so tickets 13 to 15
// leave this file alone; ticket 16 empties the list and makes the test strict. The checks take the
// root they look at, so the control cases run them on a copy of src/ with a planted file.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SDK = '@anthropic-ai/claude-agent-sdk'
/** The folder of the Claude driver: the one place that may import the SDK. It may not exist yet. */
const CLAUDE_DRIVER = 'src/main/vendors/claude/'
/** The source files the parser reads; styles, data and shell files hold no import. */
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/

/**
 * The files outside the driver that import the SDK today, each with the ticket of the epic that takes
 * the import away. Ticket 16 leaves this list empty.
 */
const EXCEPTIONS: Record<string, number> = {
  'src/main/agent/attachments.ts': 14,
  'src/main/agent/session.ts': 14,
  'src/main/agent/session/run.ts': 14,
  'src/main/agent/session/types.ts': 14,
  'src/main/agent/limits-usage.ts': 15,
  'src/main/ipc/first-run.ts': 15,
  'src/main/ipc/projects.ts': 15,
  'src/main/projects/connect.ts': 15,
  'src/main/agent/app-registry.ts': 16,
  'src/main/agent/options.ts': 16,
  'src/main/mcp/browser-server.ts': 16,
  'src/main/mcp/canvas-server.ts': 16,
  'src/main/terminal-ai/assist.ts': 16,
  'src/main/terminal-ai/fake-backend.ts': 16,
  'src/main/terminal-ai/options.ts': 16,
}

/** Every source file under src/ of `root`, relative to `root` with forward slashes. */
function sourceFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (SOURCE.test(entry.name)) files.push(path)
    }
  }
  if (existsSync(join(root, 'src'))) walk('src')
  return files.sort()
}

/** A module name of the SDK: the package, a path inside it, or one of its platform packages. */
const isSdkName = (text: string): boolean => text.startsWith(SDK) || text.startsWith('claude-agent-sdk')

const parse = (root: string, file: string): ts.SourceFile => {
  const text = readFileSync(join(root, file), 'utf8')
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

const lineOf = (source: ts.SourceFile, node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

/** The first line of a statement, for a message. */
const firstLine = (source: ts.SourceFile, node: ts.Node): string => (node.getText(source).split('\n')[0] ?? '').trim()

/** The statement a node stands in: the child of the file that holds it. */
function statementOf(node: ts.Node): ts.Node {
  let current = node
  while (current.parent !== undefined && !ts.isSourceFile(current.parent)) current = current.parent
  return current
}

/**
 * `<line>: <statement>` for each place the code of `file` names the SDK, as the TypeScript parser sees
 * it: any string, template head or type `import('…')` argument that starts with the package name.
 * Comments do not count. A file whose text never names the SDK is not parsed.
 */
function sdkMentions(root: string, file: string): string[] {
  if (!readFileSync(join(root, file), 'utf8').includes('claude-agent-sdk')) return []
  const source = parse(root, file)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && isSdkName(node.text)) {
      found.push(`${lineOf(source, node)}: ${firstLine(source, statementOf(node))}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** `<file>:<line>: <statement>` for each SDK mention outside the driver, except in the files of `allowed`. */
function outsideDriver(root: string, allowed: Record<string, number> = EXCEPTIONS): string[] {
  return sourceFiles(root)
    .filter((file) => !file.startsWith(CLAUDE_DRIVER) && !(file in allowed))
    .flatMap((file) => sdkMentions(root, file).map((mention) => `${file}:${mention}`))
}

/** The exceptions of `allowed` that no longer name the SDK, or are gone: ticket 16 removes them. */
function staleExceptions(root: string, allowed: Record<string, number> = EXCEPTIONS): string[] {
  return Object.keys(allowed).filter((file) => !existsSync(join(root, file)) || sdkMentions(root, file).length === 0)
}

const isSdkModule = (node: ts.Node | undefined): boolean => node !== undefined && ts.isStringLiteralLike(node) && isSdkName(node.text)

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

/** Whether a node names one of `names`, or the SDK through a type `import('…')`. */
function refersTo(node: ts.Node, names: Set<string>): boolean {
  if (ts.isIdentifier(node) && names.has(node.text)) return true
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && isSdkModule(node.argument.literal)) return true
  return ts.forEachChild(node, (child) => refersTo(child, names) || undefined) ?? false
}

/**
 * `<file>:<line>: <statement>` for each statement of the driver's folder under `root` that lets an SDK
 * type out: an export from the package (`export … from`, `export *`, `export import … = require`), an
 * export of a name imported from it, or an exported type alias or interface built on one. A local
 * alias or interface built on an SDK name counts as an SDK name. Exported functions and classes are not
 * read: their signatures may use SDK types, the driver's callers get worfy types.
 */
function sdkTypesLeaving(root: string): string[] {
  const problems: string[] = []
  for (const file of sourceFiles(root).filter((path) => path.startsWith(CLAUDE_DRIVER))) {
    const source = parse(root, file)
    const report = (node: ts.Node): void => {
      problems.push(`${file}:${lineOf(source, node)}: ${firstLine(source, node)}`)
    }
    const names = new Set<string>()
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && isSdkModule(statement.moduleSpecifier)) {
        const clause = statement.importClause
        if (clause?.name !== undefined) names.add(clause.name.text)
        const bindings = clause?.namedBindings
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.add(bindings.name.text)
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text)
      }
      if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && isSdkModule(statement.moduleReference.expression)) {
        names.add(statement.name.text)
      }
    }
    // A local alias or interface built on an SDK name is one too, through any number of steps.
    const typeDeclarations = source.statements.filter(
      (statement): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration => ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement),
    )
    for (let grew = true; grew; ) {
      grew = false
      for (const declaration of typeDeclarations) {
        if (!names.has(declaration.name.text) && refersTo(declaration, names)) {
          names.add(declaration.name.text)
          grew = true
        }
      }
    }
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause
        if (isSdkModule(statement.moduleSpecifier)) report(statement)
        else if (statement.moduleSpecifier === undefined && clause !== undefined && ts.isNamedExports(clause)) {
          if (clause.elements.some((element) => names.has((element.propertyName ?? element.name).getText(source)))) report(statement)
        }
      } else if (ts.isExportAssignment(statement)) {
        if (refersTo(statement.expression, names)) report(statement)
      } else if (ts.isImportEqualsDeclaration(statement)) {
        if (isExported(statement) && names.has(statement.name.text)) report(statement)
      } else if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && isExported(statement)) {
        if (names.has(statement.name.text)) report(statement)
      }
    }
  }
  return problems
}

describe('only the Claude driver imports the Agent SDK', () => {
  it('no file of src/ outside src/main/vendors/claude/ and the listed exceptions names the SDK in its code', () => {
    expect(sourceFiles(repo).length).toBeGreaterThan(300)
    expect(outsideDriver(repo)).toEqual([])
  })

  it('each exception names the ticket of the epic that takes its import away', () => {
    for (const [file, ticket] of Object.entries(EXCEPTIONS)) expect([14, 15, 16], file).toContain(ticket)
  })

  it('reports an exception that no longer imports the SDK, and does not fail on it (ticket 16 makes the test strict)', () => {
    const stale = staleExceptions(repo)
    if (stale.length > 0) {
      console.info(`[vendor-sdk-imports] exceptions that no longer import ${SDK}, for ticket 16 to remove: ${stale.join(', ')}`)
    }
    expect(Object.keys(EXCEPTIONS)).toEqual(expect.arrayContaining(stale))
  })

  it('no SDK type leaves src/main/vendors/claude/ through an export', () => {
    expect(sdkTypesLeaving(repo)).toEqual([])
  })
})

describe('the checks fail on a planted file', () => {
  // One copy of src/ for the whole block: each case plants its files and removes them after itself.
  let copy = ''
  let planted: string[] = []
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), 'worfy-sdk-imports-'))
    cpSync(join(repo, 'src'), join(copy, 'src'), { recursive: true })
  })
  afterEach(() => {
    for (const file of planted) removeTestTree(join(copy, file))
    planted = []
  })
  afterAll(() => {
    if (copy !== '') removeTestTree(copy)
  })

  const srcCopy = (): string => copy

  const plant = (root: string, file: string, text: string): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
    planted.push(file)
  }

  it('an `import type` from the SDK in a file outside the list is named with its line, and the test of it is red', () => {
    const root = srcCopy()
    expect(outsideDriver(root)).toEqual([])
    plant(root, 'src/main/agent/planted.ts', `// planted\nimport type { Options } from '${SDK}'\nexport const options: Options = {}\n`)
    expect(outsideDriver(root)).toEqual([`src/main/agent/planted.ts:2: import type { Options } from '${SDK}'`])
  })

  it.each([
    ['an import', `import { query } from '${SDK}'`],
    ['a side-effect import', `import '${SDK}'`],
    ['an import()', `export const load = () => import("${SDK}")`],
    ['a require', `export const sdk = require('${SDK}')`],
    ['a resolve', `export const path = require.resolve('${SDK}')`],
    ['a path inside the package', `export const embed = import('${SDK}/embed')`],
    ['a platform package in a template literal', `export const binary = (platform: string) => require.resolve(\`${SDK}-\${platform}/package.json\`)`],
    ['a type import()', `export type Options = import('${SDK}').Options`],
    ['an export from the package', `export type { Options } from '${SDK}'`],
  ])('%s outside the driver is named', (_kind, line) => {
    const root = srcCopy()
    plant(root, 'src/shared/planted.ts', `${line}\n`)
    expect(outsideDriver(root)).toEqual([`src/shared/planted.ts:1: ${line}`])
  })

  it('a comment that names the SDK is not an import; a file inside the driver or on the list may import it', () => {
    const root = srcCopy()
    plant(root, 'src/main/commented.ts', `// the part of ${SDK} the driver uses\n/** \`${SDK}\` */\nexport const x = 1\n`)
    plant(root, `${CLAUDE_DRIVER}planted.ts`, `import { query } from '${SDK}'\nexport const run = query\n`)
    plant(root, 'src/main/listed.ts', `import { query } from '${SDK}'\n`)
    expect(outsideDriver(root, { ...EXCEPTIONS, 'src/main/listed.ts': 16 })).toEqual([])
    expect(outsideDriver(root, EXCEPTIONS)).toEqual([`src/main/listed.ts:1: import { query } from '${SDK}'`])
  })

  it('an exception that no longer imports the SDK, or is gone, is reported as stale', () => {
    const root = srcCopy()
    plant(root, 'src/main/clean.ts', 'export const x = 1\n')
    expect(staleExceptions(root, { 'src/main/clean.ts': 14, 'src/main/gone.ts': 15, 'src/main/agent/options.ts': 16 })).toEqual(['src/main/clean.ts', 'src/main/gone.ts'])
  })

  it.each([
    ['a re-export of an SDK type', `export type { Options } from '${SDK}'`, 1],
    ['a star re-export', `export * from '${SDK}'`, 1],
    ['an export of an imported SDK type', `import type { Options } from '${SDK}'\nexport type { Options }`, 2],
    ['an export of a renamed SDK type', `import type { Options as ClaudeOptions } from '${SDK}'\nexport { ClaudeOptions as Options }`, 2],
    ['an exported alias of an SDK type', `import type { Options } from '${SDK}'\nexport type DriverOptions = Options`, 2],
    ['an exported interface built on an SDK type', `import type { Options } from '${SDK}'\nexport interface DriverOptions extends Options { extra: string }`, 2],
    ['an exported alias through a namespace import', `import type * as sdk from '${SDK}'\nexport type DriverOptions = sdk.Options`, 2],
    ['an exported alias through a type import()', `export type DriverOptions = import('${SDK}').Options`, 1],
    ['an export of a local alias of an SDK type', `import type { Options } from '${SDK}'\ntype Local = Partial<Options>\nexport { Local }`, 3],
  ])('%s in src/main/vendors/claude/ is named, and the test of it is red', (_kind, text, line) => {
    const root = srcCopy()
    expect(sdkTypesLeaving(root)).toEqual([])
    plant(root, `${CLAUDE_DRIVER}planted.ts`, `${text}\n`)
    const statement = text.split('\n')[line - 1]
    expect(sdkTypesLeaving(root)).toEqual([`${CLAUDE_DRIVER}planted.ts:${line}: ${statement}`])
  })

  it('an SDK type used inside the driver, and a worfy type exported from it, are not named', () => {
    const root = srcCopy()
    plant(
      root,
      `${CLAUDE_DRIVER}planted.ts`,
      `import { query, type Options } from '${SDK}'\ntype Local = Options\nexport type DriverOptions = { cwd: string }\nexport const start = (o: DriverOptions) => query({ prompt: '', options: { cwd: o.cwd } satisfies Local })\n`,
    )
    expect(sdkTypesLeaving(root)).toEqual([])
  })
})
