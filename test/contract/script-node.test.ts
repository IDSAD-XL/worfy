// The tests start the repository's scripts with the real node (test/script-node.ts), not with
// process.execPath, which is Electron under `pnpm test` and starts far slower under load. This file
// pins the few that stay on process.execPath, each with its reason, and fails on a new one.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
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
  // The Claude process stub: a stand-in of the Claude Code process, handed to the app's watchedSpawn
  // as the SDK hands it (test/contract/claude-process-stub.ts).
  'contract/claude-process-stub.ts': 'the Claude Code stand-in, started through the app\'s watchedSpawn as the SDK starts it',
  'contract/orchestrator-relaunch.test.ts': 'the Claude Code stand-in of the relaunch, started through the app\'s watchedSpawn',
  // Electron itself is what these tests need.
  'contract/e2e-end-app.test.ts': 'the process plays the app, started directly as macOS and Linux start it',
  'contract/harness-install.test.ts': 'checks that the installer runs the Claude stand-in under worfy\'s own Node and Electron opens no second app',
  // shortcut: agent-cost keeps its launch while #922 changes that file, switch it once #922 is merged.
  'unit/agent-cost.test.ts': 'waits for #922, which changes this file',
}

/** A program given as process.execPath in code: the first argument of a launch, or a `command`. */
const LAUNCH = /\b(?:spawn|spawnSync|execFile|execFileSync|runFile|fork)\(\s*process\.execPath\b|\bcommand:\s*process\.execPath\b/

/** The line without its comments and string literals, so a script a test writes does not count. */
function code(line: string): string {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
  return line
    .replace(/`[^`]*`/g, '``')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/\/.*$/, '')
}

/** Test files outside test/e2e and test/acceptance: those run under Playwright's node, not Electron. */
function testFiles(): string[] {
  return (readdirSync(TEST, { recursive: true }) as string[])
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/^(?:e2e|acceptance)\//.test(path))
}

describe('test/script-node.ts', () => {
  it('no test starts a program with process.execPath but those of the list', () => {
    const found = testFiles().flatMap((path) =>
      readFileSync(join(TEST, path), 'utf8')
        .split(/\r?\n/)
        .flatMap((line, at) => (LAUNCH.test(code(line)) && !(path in STAYS) ? [`test/${path}:${at + 1}`] : [])),
    )
    expect(found, 'start the script with scriptNode() from test/script-node.ts, or add the file to STAYS with its reason').toEqual([])
  })

  it('every file of the list still uses process.execPath', () => {
    for (const path of Object.keys(STAYS)) {
      expect(existsSync(join(TEST, path)), path).toBe(true)
      expect(readFileSync(join(TEST, path), 'utf8'), path).toContain('process.execPath')
    }
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
