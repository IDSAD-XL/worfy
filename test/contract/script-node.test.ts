// The tests start the repository's scripts with the real node (test/script-node.ts), not with
// process.execPath, which is Electron under `pnpm test` and starts far slower under load. This file
// pins the few that stay on process.execPath, each with its reason, and fails on a new one.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { findScriptNode, scriptNode } from '../script-node'

const TEST = join(__dirname, '..')

/**
 * The test files that keep process.execPath as a program, and why. In each of them the program is the
 * app's own choice, which the test mirrors or needs, not a script the test starts for its result.
 */
const STAYS: Record<string, string> = {
  // The gh stand-in: the app starts a `.mjs` stand-in of a program with its own executable and
  // ELECTRON_RUN_AS_NODE (programStart, src/main/program.ts); these tests check that command.
  'contract/github-accounts.test.ts': 'checks the command the app starts the gh stand-in with: its own executable',
  'unit/program.test.ts': 'checks programStart, which starts a .mjs stand-in with the app\'s own executable',
  'unit/first-run-windows.test.ts': 'checks the gh stand-in calls of the first-run check, started with the app\'s own executable',
  'unit/install-stable-functions.test.ts': 'checks the command the install script starts the Harness profile with: the node that runs it',
  'contract/app-user-model-id.test.ts': 'checks the Windows AppUserModelID the app derives from its own executable',
  'contract/script-node.test.ts': 'checks that scriptNode() is not process.execPath, and refuses Electron given as npm_node_execpath',
  // The Claude process stub: a stand-in of the Claude Code process, handed to the app's watchedSpawn
  // as the SDK hands it (test/contract/claude-process-stub.ts).
  'contract/claude-process-stub.ts': 'the Claude Code stand-in, started through the app\'s watchedSpawn as the SDK starts it',
  'contract/orchestrator-relaunch.test.ts': 'the Claude Code stand-in of the relaunch, started through the app\'s watchedSpawn',
  // Electron itself is what this test needs: captureLoginShellEnv (src/main/agent/env.ts) runs in the
  // app's main process, and Electron's V8 keeps large strings outside heapUsed.
  'contract/login-shell-capture.test.ts': 'runs captureLoginShellEnv on Electron, the runtime of the app\'s main process where it runs',
}

/**
 * The lines where the code of a file reads process.execPath, as the TypeScript parser sees it: a launch,
 * an alias, a program handed on in an object or a list. Comments and the text of string literals do not
 * count — a script a test writes for a child reads its own process.execPath — but an expression inside
 * a template literal does.
 */
function execPathReads(path: string, text: string): number[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines: number[] = []
  const isProcess = (node: ts.Node): boolean => ts.isIdentifier(node) && node.text === 'process'
  const reads = (node: ts.Node): boolean =>
    // process.execPath, process['execPath']
    (ts.isPropertyAccessExpression(node) && node.name.text === 'execPath' && isProcess(node.expression)) ||
    (ts.isElementAccessExpression(node) && isProcess(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'execPath') ||
    // const { execPath } = process, const { execPath: node } = process
    (ts.isBindingElement(node) &&
      (node.propertyName ?? node.name).getText(source) === 'execPath' &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.initializer !== undefined &&
      isProcess(node.parent.parent.initializer)) ||
    // import { execPath } from 'node:process'
    (ts.isImportSpecifier(node) &&
      (node.propertyName ?? node.name).text === 'execPath' &&
      ts.isStringLiteral(node.parent.parent.parent.moduleSpecifier) &&
      ['process', 'node:process'].includes(node.parent.parent.parent.moduleSpecifier.text))
  const visit = (node: ts.Node): void => {
    if (reads(node)) lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

/** Test files outside test/e2e and test/acceptance: those run under Playwright's node, not Electron. */
function testFiles(): string[] {
  return (readdirSync(TEST, { recursive: true }) as string[])
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/^(?:e2e|acceptance)\//.test(path))
}

describe('test/script-node.ts', () => {
  it('no test code reads process.execPath but that of the list', () => {
    const found = testFiles()
      .filter((path) => !(path in STAYS))
      .flatMap((path) => execPathReads(path, readFileSync(join(TEST, path), 'utf8')).map((line) => `test/${path}:${line}`))
    expect(found, 'start the script with scriptNode() from test/script-node.ts, or add the file to STAYS with its reason').toEqual([])
  })

  it('every file of the list still reads process.execPath in its code', () => {
    for (const path of Object.keys(STAYS)) {
      expect(existsSync(join(TEST, path)), path).toBe(true)
      expect(execPathReads(path, readFileSync(join(TEST, path), 'utf8')), path).not.toEqual([])
    }
  })

  it('counts a split call, an alias, destructuring, an index and an import, and no comment or string text', () => {
    const text = [
      '// spawnSync(process.execPath)',
      "const child = 'spawnSync(process.execPath)'",
      'const script = `spawn(process.execPath, [])`',
      'spawnSync(',
      '  process.execPath,',
      ')',
      "it(\"runs the app's script\", () => { const node = process.execPath })",
      'const stub = `exec "${process.execPath}"`',
      'const { execPath } = process',
      'const { execPath: node, pid } = process',
      "const other = process['execPath']",
      "import { execPath as electron } from 'node:process'",
      "import { argv } from 'node:process'",
      'const { execPath: unrelated } = options',
    ].join('\n')
    expect(execPathReads('x.ts', text)).toEqual([5, 7, 8, 9, 10, 11, 12])
  })

  it('is node, not Electron', () => {
    const run = spawnSync(scriptNode(), ['-p', 'process.versions.electron ?? "none"'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    expect(run.stdout.trim(), run.stderr).toBe('none')
    if (process.versions.electron !== undefined) expect(scriptNode()).not.toBe(process.execPath)
  })

  it('without npm_node_execpath (a run without pnpm) takes node from PATH', () => {
    const env = { ...process.env }
    delete env.npm_node_execpath
    expect(existsSync(findScriptNode(env))).toBe(true)
  })

  it('throws, naming npm_node_execpath and PATH, when the node it is given does not start', () => {
    const env = { ...process.env, npm_node_execpath: join(TEST, 'no-such-node') }
    expect(() => findScriptNode(env)).toThrow(/npm_node_execpath .*did not start.*PATH.*never fall back to process\.execPath/s)
  })

  it.runIf(process.versions.electron !== undefined)('throws when the node it is given is Electron', () => {
    expect(() => findScriptNode({ ...process.env, npm_node_execpath: process.execPath })).toThrow(/is Electron/)
  })
})
