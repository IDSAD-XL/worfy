// The Harness scripts are Node on every system; bash is for tests only (worfy-windows ticket 16, item 3
// of the epic's done list; ADR-0055). Over harness/bin and harness/hooks, outside their tests folders:
// every file is Node (.mjs, .cjs, .js), data (.json) or text (.md), or starts with `#!/usr/bin/env node`;
// the hooks run through node, the qmd server starts with node, the Limits bridge is Node and Windows
// starts it with node, and git keeps these files LF in the working tree, which on a Windows clone with
// core.autocrlf catches what .gitattributes left out.
//
// Two files are shell on purpose; they are named below with their reasons, and a third one fails. The
// checks take the root they look at, so the control cases run them on a copy with a planted file.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { BRIDGE_ENTRY, BRIDGE_SCRIPT, bridgeCommand, bridgeFile } from '../../src/main/harness/status-line'
import { removeTestTree } from '../remove'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The folders of Harness scripts: what hooks.json, skills and agents start. */
const SCRIPT_DIRS = ['harness/bin', 'harness/hooks']
/** Files that are Node by their extension, or not scripts at all. */
const NOT_A_SCRIPT = /\.(mjs|cjs|js|json|md)$/
const NODE_SHEBANG = '#!/usr/bin/env node'
const SHELL_SHEBANG = /^#!.*\b(bash|zsh|sh)\b/

/** The files that are shell on purpose, and why. */
const SHELL_ON_PURPOSE: Record<string, string> = {
  'harness/hooks/gate.sh':
    'the launcher of the gate hook: where no node runs it answers "node not found" and replaces the stale verdict, which a hook command naming node cannot (decided 2026-10-14)',
  'harness/hooks/worktree-create.sh': 'an unregistered WorktreeCreate draft, kept as documentation (owner decision 2026-10-09)',
}
/**
 * The two forms a hook command may take, matched whole, so a chain (`;`, `&&`, `|`) or a shell script
 * behind node does not pass: node with a Node script of the plugin, or the gate's launcher. Either one
 * may take plain words as its arguments.
 */
const NODE_HOOK = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks|bin)\/[\w-]+(\.mjs|\.cjs|\.js)?"( [\w-]+)*$/
const LAUNCHER_HOOK = /^"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/gate\.sh"( [\w-]+)*$/
/** The shell draft no hook may start: it may stay shell only while it is not registered. */
const UNREGISTERED_DRAFT = 'worktree-create.sh'

/** Every file under SCRIPT_DIRS of `root`, outside folders named tests, relative to `root` with forward slashes. */
function scriptFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') walk(path)
      } else files.push(path)
    }
  }
  for (const dir of SCRIPT_DIRS) if (existsSync(join(root, dir))) walk(dir)
  return files.sort()
}

const firstLine = (root: string, file: string): string => (readFileSync(join(root, file), 'utf8').split('\n')[0] ?? '').replace(/\r$/, '')

/** `<file>: <why>` for each script of `root` that is not Node, except the files of `allowed`. */
function notNode(root: string, allowed: Record<string, string> = SHELL_ON_PURPOSE): string[] {
  const problems: string[] = []
  for (const file of scriptFiles(root)) {
    if (NOT_A_SCRIPT.test(file) || file in allowed) continue
    const line = firstLine(root, file)
    if (line === NODE_SHEBANG) continue
    problems.push(SHELL_SHEBANG.test(line) ? `${file}: a shell script (${line})` : `${file}: not .mjs, .cjs, .js, .json or .md, and its first line is not ${NODE_SHEBANG} (${line})`)
  }
  return problems
}

/** Every `command` of harness/hooks/hooks.json under `root`. */
function hookCommands(root: string): string[] {
  const commands: string[] = []
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect)
    else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'command' && typeof item === 'string') commands.push(item)
        else collect(item)
      }
    }
  }
  collect(JSON.parse(readFileSync(join(root, 'harness/hooks/hooks.json'), 'utf8')))
  return commands
}

/** The hook commands of neither form, and any that names the unregistered draft. */
function hookCommandProblems(root: string): string[] {
  return hookCommands(root).filter((command) => command.includes(UNREGISTERED_DRAFT) || !(NODE_HOOK.test(command) || LAUNCHER_HOOK.test(command)))
}

/** `<server>: <command>` for each server of harness/.mcp.json under `root` that does not start with node. */
function mcpProblems(root: string): string[] {
  const servers = (JSON.parse(readFileSync(join(root, 'harness/.mcp.json'), 'utf8')) as { mcpServers: Record<string, { command: string }> }).mcpServers
  return Object.entries(servers)
    .filter(([, server]) => server.command !== 'node')
    .map(([name, server]) => `${name}: ${server.command}`)
}

/** The files of `files` under `root` that hold a CRLF line end. */
function crlfFiles(root: string, files: string[]): string[] {
  return files.filter((file) => readFileSync(join(root, file), 'utf8').includes('\r\n'))
}

/** The scripts whose line ends are a contract: the Harness scripts with their tests, and the Limits bridge. */
function trackedScripts(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...SCRIPT_DIRS, `scripts/${BRIDGE_SCRIPT}`, `scripts/${BRIDGE_ENTRY}`], { cwd: repo, encoding: 'utf8' })
  return listed.split('\0').filter((file) => file !== '')
}

describe('the Harness scripts are Node; bash only in tests', () => {
  it('every file of harness/bin and harness/hooks outside tests is Node, data or text, but the two named shell files', () => {
    expect(scriptFiles(repo).length).toBeGreaterThan(30)
    expect(notNode(repo)).toEqual([])
  })

  it('names each file that is shell on purpose: they exist, and without the list both are reported', () => {
    for (const file of Object.keys(SHELL_ON_PURPOSE)) expect(existsSync(join(repo, file)), file).toBe(true)
    expect(notNode(repo, {})).toEqual(Object.keys(SHELL_ON_PURPOSE).map((file) => `${file}: a shell script (#!/usr/bin/env bash)`))
  })

  it('every hook command is node with a Node script of the plugin, or the gate launcher; the worktree draft is not registered', () => {
    const commands = hookCommands(repo)
    expect(commands.length).toBeGreaterThan(10)
    expect(hookCommandProblems(repo)).toEqual([])
    expect(commands.filter((command) => command.includes(UNREGISTERED_DRAFT))).toEqual([])
  })

  it('the qmd server of harness/.mcp.json starts with node', () => {
    const servers = (JSON.parse(readFileSync(join(repo, 'harness/.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers
    expect(Object.keys(servers)).toContain('qmd')
    expect(mcpProblems(repo)).toEqual([])
  })

  it('the Limits bridge is Node: Windows starts it with node, and the sh entry of macOS hands the work to it', () => {
    expect(firstLine(repo, `scripts/${BRIDGE_SCRIPT}`)).toBe(NODE_SHEBANG)
    expect(bridgeCommand('win32', bridgeFile('win32', 'C:\\Program Files\\worfy\\resources'), '')).toBe("node 'C:/Program Files/worfy/resources/statusline-bridge.mjs'")
    expect(readFileSync(join(repo, 'scripts', BRIDGE_ENTRY), 'utf8')).toContain(`node "$here/${BRIDGE_SCRIPT}"`)
  })

  it('git checks these scripts out with LF, and the working tree holds no CRLF in them', () => {
    const files = trackedScripts()
    expect(files.length).toBeGreaterThan(30)
    const attributes = execFileSync('git', ['check-attr', '-z', 'eol', '--', ...files], { cwd: repo, encoding: 'utf8' }).split('\0')
    const notLf: string[] = []
    for (let i = 0; i + 2 < attributes.length; i += 3) if (attributes[i + 2] !== 'lf') notLf.push(`${attributes[i]}: eol ${attributes[i + 2]}`)
    expect(notLf).toEqual([])
    expect(crlfFiles(repo, files)).toEqual([])
  })
})

describe('the checks fail on a planted file', () => {
  let copy = ''
  afterEach(() => {
    if (copy !== '') removeTestTree(copy)
    copy = ''
  })

  const harnessCopy = (): string => {
    copy = mkdtempSync(join(tmpdir(), 'worfy-node-only-'))
    for (const dir of SCRIPT_DIRS) cpSync(join(repo, dir), join(copy, dir), { recursive: true })
    cpSync(join(repo, 'harness/.mcp.json'), join(copy, 'harness/.mcp.json'))
    return copy
  }

  /** Adds a hook event with `command` to the hooks.json of `root`. */
  const plantHook = (root: string, command: string): void => {
    const file = join(root, 'harness/hooks/hooks.json')
    const hooks = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, unknown[]> }
    hooks.hooks.Planted = [{ hooks: [{ type: 'command', command }] }]
    writeFileSync(file, JSON.stringify(hooks))
  }

  it('a #!/bin/bash script in a copy of harness/bin is named, and the test of it is red', () => {
    const root = harnessCopy()
    expect(notNode(root)).toEqual([])
    writeFileSync(join(root, 'harness/bin/planted'), '#!/bin/bash\necho planted\n')
    expect(notNode(root)).toEqual(['harness/bin/planted: a shell script (#!/bin/bash)'])
  })

  it('a script without a node shebang or a Node extension is named; one in a tests folder is not', () => {
    const root = harnessCopy()
    writeFileSync(join(root, 'harness/hooks/planted.py'), 'print(1)\n')
    writeFileSync(join(root, 'harness/hooks/tests/planted.sh'), '#!/usr/bin/env bash\n')
    expect(notNode(root)).toEqual([`harness/hooks/planted.py: not .mjs, .cjs, .js, .json or .md, and its first line is not ${NODE_SHEBANG} (print(1))`])
  })

  it.each([
    ['a script started by its path', '"${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"'],
    ['a chain after a node script', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"; bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"'],
    ['a chain after the gate launcher', '"${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast && sh other.sh'],
    ['a shell script behind node', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"'],
    ['the unregistered worktree draft', '"${CLAUDE_PLUGIN_ROOT}/hooks/worktree-create.sh"'],
  ])('a hook command that is %s is named', (_kind, command) => {
    const root = harnessCopy()
    expect(hookCommandProblems(root)).toEqual([])
    plantHook(root, command)
    expect(hookCommandProblems(root)).toEqual([command])
  })

  it('a .mcp.json server that does not start with node is named', () => {
    const root = harnessCopy()
    writeFileSync(join(root, 'harness/.mcp.json'), JSON.stringify({ mcpServers: { qmd: { command: 'bash', args: ['qmd.sh'] } } }))
    expect(mcpProblems(root)).toEqual(['qmd: bash'])
  })

  it('a CRLF line end in a script is named', () => {
    const root = harnessCopy()
    writeFileSync(join(root, 'harness/bin/ticket'), `${NODE_SHEBANG}\r\nconsole.log(1)\r\n`)
    expect(crlfFiles(root, ['harness/bin/ticket', 'harness/bin/profile'])).toEqual(['harness/bin/ticket'])
  })
})
