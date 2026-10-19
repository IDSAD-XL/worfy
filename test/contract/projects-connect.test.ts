// Connecting a Project (src/main/projects/connect.ts): what kind of folder the user picked, a folder
// the Harness already knows, the Harness check, the draft Session and the write through the
// Harness script. Real git repositories and the real harness/bin/profile and
// harness/bin/project-connect in a temporary Harness home (HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR
// all in the temporary folder); the Harness check and Claude Code are replaced — the draft Session
// plays test/fixtures/agent-scripts/profile-draft.jsonl through the fake agent.
//
// Attribution (ADR-0061): that fixture is a Silent draft with `"attribution": "on"`, what the model
// wrote in the acceptance run of 2026-10-12. The form must get `off` for it, the person's own choice
// must be written as picked, a Full draft keeps what the Session proposed, and the default worfy's
// code names for a mode must be the one bin/profile prints for a Profile without the field.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import { githubChoice, withGithubAccount, type ProfileDraft } from '../../src/shared/ipc/projects'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { draftSessionOptions, sessionOptions } from '../../src/main/agent/options'
import { defaultAttribution } from '../../src/main/harness/attribution'
import { proposeAttribution } from '../../src/main/harness/migrate/profiles'
import {
  activityOf,
  applyChoices,
  CONNECT_TIMEOUT_MS,
  CONNECT_WRITE_TIMEOUT_MS,
  connectScriptRunner,
  connectTimeoutMs,
  DRAFT_DISALLOWED_TOOLS,
  DRAFT_TOOLS,
  draftCanUseTool,
  draftMessage,
  inspectFolder,
  MULTI_REPO_FULL,
  ProjectConnector,
  type AddOutcome,
  type ConnectDeps,
  type DraftRequest,
} from '../../src/main/projects/connect'
import { ghRunner } from '../../src/main/github/prs'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { profileRegistryFiles, type HarnessLocation } from '../../src/main/harness/locate'
import { HarnessScriptStartError, killRunningHarnessScripts, type ProfileRunner, type runHarnessScript, type SpawnProcess } from '../../src/main/workflow/profile'
import { NODE, NODE_DIR, nodeScript, scriptsEnv } from '../harness-node'
import { ghWorld } from './gh-world'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const BIN = join(REPO, 'harness', 'bin')
const SCRIPTS = join(REPO, 'test', 'fixtures', 'agent-scripts')
const SCHEMA = JSON.parse(readFileSync(join(REPO, 'harness', 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>
/** The 2020-12 meta-schema the schema file names; the validator of Claude Code has no such schema. */
const META_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

interface SchemaValidator {
  validateSchema: (schema: unknown) => unknown
  compile: (schema: unknown) => unknown
  errorsText: () => string
}
type SchemaValidatorClass = new (options: { allErrors: boolean; validateFormats: boolean; multipleOfPrecision: number }) => SchemaValidator

/**
 * Ajv 8 of the repository's dependencies: the one @modelcontextprotocol/sdk brings, which
 * @anthropic-ai/claude-agent-sdk (a dependency of the repository) brings. The repository has no ajv
 * of its own, and pnpm does not put a dependency of a dependency at the root.
 */
function ajv8(): SchemaValidatorClass {
  try {
    const agentSdk = createRequire(join(REPO, 'package.json')).resolve('@anthropic-ai/claude-agent-sdk')
    const mcpSdk = createRequire(agentSdk).resolve('@modelcontextprotocol/sdk/package.json')
    const ajv = createRequire(mcpSdk)('ajv') as SchemaValidatorClass & { default?: SchemaValidatorClass }
    return ajv.default ?? ajv
  } catch (error) {
    throw new Error(
      `ajv was not found through @anthropic-ai/claude-agent-sdk and its @modelcontextprotocol/sdk (${error instanceof Error ? error.message : String(error)}). ` +
        'This test needs Ajv 8, the validator Claude Code checks --json-schema with, to check the schema the draft Session gets: bring one another way, do not skip the check.',
      { cause: error },
    )
  }
}

/**
 * Checks `schema` the way Claude Code checks `--json-schema`: Ajv 8 (draft-07, strict mode by
 * default) built with `allErrors`, `validateFormats: false` and `multipleOfPrecision: 6`, then
 * `validateSchema`, then `compile`. The options and the order of the calls were read in the package
 * of Claude Code 2.1.291 (a binary with readable JS; it was not run): compare them again when Claude
 * Code is updated. Throws what the validator says, an error of its strict mode among that; returns
 * what strict mode only wrote to the console (its findings about types and tuples).
 */
function checkAsClaudeCode(schema: unknown): string[] {
  const Ajv = ajv8()
  const logged: string[] = []
  const spies = (['log', 'warn', 'error'] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))))
  try {
    const ajv = new Ajv({ allErrors: true, validateFormats: false, multipleOfPrecision: 6 })
    if (ajv.validateSchema(schema) !== true) throw new Error(`schema is invalid: ${ajv.errorsText()}`)
    ajv.compile(schema)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return logged
}

/** Every place in `value` where a key is `$schema` or `$id`, as paths: whatever the key means there. */
function metaKeys(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => metaKeys(item, `${at}[${index}]`))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => [...(key === '$schema' || key === '$id' ? [`${at}.${key}`] : []), ...metaKeys(inner, `${at}.${key}`)])
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) for (const inner of Object.values(Object.freeze(value))) deepFreeze(inner)
  return value
}

let scratch: string
let home: string
let harnessHome: string

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, 'package.json'), '{"scripts":{"lint":"eslint .","test":"vitest run"}}\n')
  git(path, 'add', 'package.json')
  git(path, 'commit', '-q', '-m', 'init')
  return realpathSync.native(path)
}

/**
 * Variables that would point the Harness scripts elsewhere: the gate exports CLAUDE_GATE_CONFIG
 * (its own registry) to the tests it runs.
 */
const OUTSIDE = /^(GIT_|CLAUDE_GATE_|CLAUDE_PROFILES_DIR$|PROJECT_CONNECT_|ELECTRON_RUN_AS_NODE$)/

/** The environment of the Harness scripts: everything in the temporary folder. */
function sandboxEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !OUTSIDE.test(key)))
  return {
    ...env,
    HOME: home,
    // node's os.homedir() on Windows: bin/profile looks for the old registry under it.
    USERPROFILE: home,
    HARNESS_HOME: harnessHome,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    PROJECT_CONNECT_QMD: join(scratch, 'no-qmd'),
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
}

function runScript(script: string, args: readonly string[], stdin: string, cwd = scratch): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(BIN, script), ...args], { cwd, env: sandboxEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

/** The real harness/bin/profile in the sandbox. */
const realProfile: ProfileRunner = (cwd, args) => runScript('profile', args, '', cwd)

const installed: HarnessStatus = { state: { kind: 'installed', version: '0.4.0', enabled: true }, bundledVersion: '0.4.0', canInstall: true, pluginDir: '/x/plugin', dependencies: [] }

interface Harnessed {
  connector: ProjectConnector
  requests: DraftRequest[]
  calls: FakeCall[]
  added: string[]
  activity: string[]
}

/**
 * The real ProjectStore over the sandbox: a folder outside git joins the list when the sandbox
 * Harness resolves its `_resolved.workspace` (worfy-harness ticket 23), read by the real bin/profile.
 */
function sandboxStore(): ProjectStore {
  return new ProjectStore(join(scratch, 'data'), runGit, async (folder) => {
    const run = await realProfile(folder, ['-C', folder, '--field', '_resolved.workspace'])
    const value = run.stdout.trim()
    return run.code === 0 && value !== '' && value !== 'null' ? value : null
  })
}

/** A connector over the sandbox; `overrides` replace any of its parts. */
function connectorWith(overrides: Partial<ConnectDeps> & { script?: string; scriptsDir?: string } = {}): Harnessed {
  const requests: DraftRequest[] = []
  const calls: FakeCall[] = []
  const added: string[] = []
  const fake = fakeQueryFactory({ scriptsDir: overrides.scriptsDir ?? SCRIPTS, script: overrides.script ?? 'profile-draft', record: (call) => calls.push(call), releases: undefined })
  const store = sandboxStore()
  const deps: ConnectDeps = {
    git: runGit,
    // No gh unless a test brings its stand-in (test/contract/gh-world.ts).
    gh: ghRunner({ command: join(scratch, 'no-gh') }),
    profile: realProfile,
    gateRegistries: () => Promise.resolve(profileRegistryFiles(sandboxEnv())),
    connect: (args, stdin) => runScript('project-connect', args, stdin),
    harness: () => Promise.resolve(installed),
    query: (request) => {
      requests.push(request)
      return fake(request)
    },
    draftSchema: () => SCHEMA,
    reportsLanguage: () => 'ru',
    add: async (root, options): Promise<AddOutcome> => {
      added.push(root)
      const result = await store.add(root, options)
      return result.status === 'added' ? { status: 'added', projectId: result.project.id, notice: result.notice } : result
    },
    log: () => undefined,
    ...overrides,
  }
  return { connector: new ProjectConnector(deps), requests, calls, added, activity: [] }
}

/** Every file of the Harness home with its contents: equal before and after means nothing was written. */
function harnessFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = prefix + entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/`)
      else files[rel] = readFileSync(join(dir, entry.name), 'utf8')
    }
  }
  walk(harnessHome, '')
  return files
}

const clean = (repo: string): string => git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-connect-')))
  home = join(scratch, 'home')
  harnessHome = join(home, '.claude', 'worfy-harness')
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('the kind of the folder (step 1)', () => {
  it('a folder above two repositories that is not in git itself is multi-repo, with both repositories', async () => {
    const workspace = join(scratch, 'atakama')
    const server = makeRepo(join(workspace, 'server'))
    const extension = makeRepo(join(workspace, 'extension'))
    mkdirSync(join(workspace, 'notes'))

    const result = await inspectFolder(workspace, runGit)

    expect(result).toEqual({
      ok: true,
      folder: {
        kind: 'multi-repo',
        root: realpathSync.native(workspace),
        repos: [
          { name: 'extension', path: extension },
          { name: 'server', path: server },
        ],
        notice: null,
      },
    })
  })

  it('a git repository is git; a subfolder and a linked worktree resolve to its root and say so', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    mkdirSync(join(repo, 'src'))
    expect(await inspectFolder(repo, runGit)).toEqual({ ok: true, folder: { kind: 'git', root: repo, repos: [{ name: 'shop', path: repo }], notice: null } })

    const sub = await inspectFolder(join(repo, 'src'), runGit)
    expect(sub.ok && sub.folder.root).toBe(repo)
    expect(sub.ok && sub.folder.notice).toMatch(/is inside the repository .*the repository root is connected instead/)

    const worktree = join(scratch, 'shop-wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const linked = await inspectFolder(worktree, runGit)
    expect(linked.ok && linked.folder).toMatchObject({ kind: 'git', root: repo })
    expect(linked.ok && linked.folder.notice).toMatch(/is a worktree of .*the repository root is connected instead/)
  })

  it('a folder without repositories, or with only one, is refused with the reason', async () => {
    const plain = join(scratch, 'plain')
    mkdirSync(join(plain, 'docs'), { recursive: true })
    expect(await inspectFolder(plain, runGit)).toEqual({
      ok: false,
      reason: `${plain} is not a git repository and holds no repositories. Choose the folder of a git repository, or the folder above the repositories of one project.`,
    })
    const one = makeRepo(join(plain, 'only'))
    const single = await inspectFolder(plain, runGit)
    expect(single).toEqual({ ok: false, reason: `${plain} is not a git repository and holds only one: choose the repository ${one} itself.` })
    expect(await inspectFolder(join(scratch, 'missing'), runGit)).toEqual({ ok: false, reason: `${join(scratch, 'missing')} does not exist.` })
  })
})

describe('a folder the Harness already knows', () => {
  it('bin/profile -C exits 0: the folder is known, and no draft Session starts', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    // A bin/profile that knows every folder.
    const knowsAll: ProfileRunner = () => Promise.resolve({ code: 0, stdout: '{"name":"shop","_resolved":{"workspace":null}}', stderr: '' })
    const { connector, requests } = connectorWith({ profile: knowsAll })
    expect(await connector.inspect(repo)).toEqual({ status: 'known', folder: { kind: 'git', root: repo, repos: [{ name: 'shop', path: repo }], notice: null } })
    expect(requests).toHaveLength(0)

    // Unknown (exit 3): a new folder for the dialog.
    const unknown = connectorWith({ profile: () => Promise.resolve({ code: 3, stdout: '', stderr: 'not registered' }) })
    expect((await unknown.connector.inspect(repo)).status).toBe('new')
  })

  it('a multi-repo folder is known only with _resolved.workspace', async () => {
    const workspace = join(scratch, 'ws')
    makeRepo(join(workspace, 'api'))
    makeRepo(join(workspace, 'web'))
    const answer = (workspace: string | null): ProfileRunner => () => Promise.resolve({ code: 0, stdout: JSON.stringify({ _resolved: { workspace } }), stderr: '' })
    expect((await connectorWith({ profile: answer(null) }).connector.inspect(workspace)).status).toBe('new')
    expect((await connectorWith({ profile: answer(workspace) }).connector.inspect(workspace)).status).toBe('known')
  })

  // worfy-windows ticket 30: on Windows a bin/profile that was not started read as "unknown", and a
  // connected folder went into the form as a new one.
  it('bin/profile that did not start or did not answer: the Folder step shows why, not a new folder', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const noNode: ProfileRunner = () => Promise.reject(new HarnessScriptStartError('NODE_NOT_FOUND', 'node not found in PATH: /h/bin/profile is not run'))
    const { connector, requests } = connectorWith({ profile: noNode })
    expect(await connector.inspect(repo)).toEqual({ status: 'rejected', reason: `The Harness could not tell whether it knows ${repo}: bin/profile could not be run: node not found in PATH: /h/bin/profile is not run` })
    expect(requests).toHaveLength(0)

    const timedOut = connectorWith({ profile: () => Promise.resolve({ code: null, stdout: '', stderr: '' }) })
    expect(await timedOut.connector.inspect(repo)).toEqual({ status: 'rejected', reason: `The Harness could not tell whether it knows ${repo}: bin/profile did not answer in time and was stopped` })
  })

  // Mac review of PR #482: on main a machine without the Harness got "new", and the dialog's Harness
  // step said what to install. The profile script is missing there (ENOENT): that stays so.
  it('no profile script while the Harness step stops the dialog (not installed): a new folder, as before', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const missing: ProfileRunner = () => Promise.reject(new HarnessScriptStartError('ENOENT', `no Harness script at ${join(home, '.claude', 'bin', 'profile')}`))
    const notInstalled = connectorWith({ profile: missing, harness: () => Promise.resolve({ ...installed, state: { kind: 'not-installed' } }) })
    expect(await notInstalled.connector.inspect(repo)).toEqual({ status: 'new', folder: { kind: 'git', root: repo, repos: [{ name: 'shop', path: repo }], notice: null } })
    expect(await notInstalled.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)).toEqual({
      status: 'harness',
      reason: 'The Harness plugin is not installed. Install it on the first-run screen.',
    })
    expect(notInstalled.requests).toHaveLength(0)

    // The Harness installed and enabled, and still no script: that is the Folder step's error.
    const installedButMissing = connectorWith({ profile: missing })
    expect((await installedButMissing.connector.inspect(repo)).status).toBe('rejected')
  })

  it('the real bin/profile with a broken old registry (~/.claude/gate/config.json, no new one; exit 1): an error, not a new folder', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    removeTestTree(join(harnessHome, 'gate', 'config.json'))
    const legacy = join(home, '.claude', 'gate', 'config.json')
    mkdirSync(join(home, '.claude', 'gate'), { recursive: true })
    writeFileSync(legacy, '{"Repos":[]}\n')
    const { connector, requests } = connectorWith()
    const answer = await connector.inspect(repo)
    expect(answer.status).toBe('rejected')
    expect(answer.status === 'rejected' ? answer.reason : '').toContain(`registry ${legacy} is broken: the "repos" field must be an array`)
    expect(requests).toHaveLength(0)
  })

  it('the real bin/profile of a fresh Harness (no gate registry, exit 1): a new folder', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    removeTestTree(join(harnessHome, 'gate', 'config.json'))
    const { connector } = connectorWith()
    expect((await connector.inspect(repo)).status).toBe('new')
  })

  it('the real bin/profile with a broken registry (exit 1, the registry there): the Folder step shows its reason', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"Repos":[]}\n')
    const { connector, requests } = connectorWith()
    const answer = await connector.inspect(repo)
    expect(answer.status).toBe('rejected')
    const reason = answer.status === 'rejected' ? answer.reason : ''
    // The resolver's own reason, without bin/profile's wrapping: with the long paths of a
    // temporary folder the wrapped line outgrew the limit of a reason and lost its end.
    expect(reason).toBe(`The Harness could not tell whether it knows ${repo}: bin/profile failed with exit code 1: registry ${join(harnessHome, 'gate', 'config.json')} is broken: the "repos" field must be an array`)
    expect(requests).toHaveLength(0)
  })
})

/** Whether some process has the pid `pid` now (signal 0 only asks). */
function pidInUse(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the process `pid` runs and is still the grandchild named by `marker`: a pid that is in use
 * again by another process is not it. The command line comes from `ps`, on Windows from
 * Win32_Process.
 */
function grandchildRunning(pid: number, marker: string): boolean {
  if (!pidInUse(pid)) return false
  const commandLine =
    process.platform === 'win32'
      ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: 'utf8', windowsHide: true }).stdout
      : spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout
  return (commandLine ?? '').includes(marker)
}

describe('bin/project-connect is started as node <script> (worfy-windows ticket 30)', () => {
  /** A stand-in of the script: prints its arguments, its stdin and HARNESS_HOME. Not executable: only `node <file>` runs it. */
  const echoScript = nodeScript(
    "let stdin = ''\nprocess.stdin.on('data', (chunk) => (stdin += chunk))\nprocess.stdin.on('end', () => process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), stdin, harnessHome: process.env.HARNESS_HOME })))",
  )
  const location = (binDir: string): HarnessLocation => ({ kind: 'plugin', binDir, gateDir: join(harnessHome, 'gate'), harnessHome, checked: [join(home, '.claude', 'bin', 'epic-status'), join(binDir, 'epic-status')] })
  /** node's spawn, recording what it was asked to start. */
  const recording = (): { spawn: SpawnProcess; calls: { command: string; args: string[] }[] } => {
    const calls: { command: string; args: string[] }[] = []
    return {
      calls,
      spawn: (command, args, options) => {
        calls.push({ command, args: [...args] })
        return spawn(command, args, options)
      },
    }
  }

  it('the command is node from the PATH of the scripts, the script path is its first argument, then the arguments and stdin', async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    writeFileSync(join(binDir, 'project-connect'), echoScript)
    const { spawn: start, calls } = recording()
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), spawn: start })
    const run = await connect(['--facts', join(scratch, 'shop')], '{"draft":1}')
    expect(calls).toEqual([{ command: NODE, args: [join(binDir, 'project-connect'), '--facts', join(scratch, 'shop')] }])
    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ argv: ['--facts', join(scratch, 'shop')], stdin: '{"draft":1}', harnessHome })
  })

  it('the real bin/project-connect answers --schema-only through it', async () => {
    const { spawn: start, calls } = recording()
    const connect = connectScriptRunner({ harness: () => location(BIN), env: () => Promise.resolve(sandboxEnv()), spawn: start })
    const run = await connect(['--schema-only'], '{}')
    expect(calls.map((call) => call.args[0])).toEqual([join(BIN, 'project-connect')])
    expect(run.code).toBe(1)
    expect((JSON.parse(run.stdout) as { errors: { path: string }[] }).errors.map((issue) => issue.path)).toEqual(['profile', 'rules', 'gate'])
  })

  it('no script, or no node on the PATH: a HarnessScriptStartError, and nothing is started', async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const { spawn: start, calls } = recording()
    const missing = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), spawn: start })
    await expect(missing(['--check'], '{}')).rejects.toMatchObject({ code: 'ENOENT' })

    writeFileSync(join(binDir, 'project-connect'), echoScript)
    const emptyDir = join(scratch, 'empty')
    mkdirSync(emptyDir)
    const noNode = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([emptyDir])), spawn: start })
    await expect(noNode(['--check'], '{}')).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' })
    expect(calls).toHaveLength(0)
  })

  it('the time limit holds while a process the script started keeps its pipes open', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const alive = join(scratch, 'grandchild-alive')
    const stop = join(scratch, 'grandchild-stop')
    const tick = `${alive}.tick`
    // The holder has the script's pipes, inherited: it writes the time to a file every 100 ms while
    // it runs, and ends when the stop file appears (or after 30 s), removing its `alive` file. The
    // runner kills the script's whole tree (killTree), so the holder is left outside it, as a daemon
    // is: a short-lived process the script starts, detached, starts it detached and exits. Detached
    // also takes both out of the job in which node keeps its children on Windows.
    const grandchild = [
      "const fs = require('node:fs')",
      'const [alive, stop] = process.argv.slice(1)',
      'fs.writeFileSync(alive, String(process.pid))',
      'const end = () => { try { fs.unlinkSync(alive) } catch {} process.exit(0) }',
      "setInterval(() => { fs.writeFileSync(alive + '.tick', String(Date.now())); if (fs.existsSync(stop)) end() }, 100)",
      'setTimeout(end, 30000)',
    ].join('; ')
    const intermediate = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, ${JSON.stringify(alive)}, ${JSON.stringify(stop)}], { stdio: 'inherit', detached: true, windowsHide: true }).unref()`
    writeFileSync(
      join(binDir, 'project-connect'),
      [
        '#!/usr/bin/env node',
        "import('node:child_process').then((cp) => {",
        `  cp.spawn(process.execPath, ['-e', ${JSON.stringify(intermediate)}], { stdio: 'inherit', detached: true, windowsHide: true })`,
        '  setInterval(() => undefined, 1000)',
        '})',
        '',
      ].join('\n'),
    )
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), timeoutMs: 3000 })
    try {
      const started = Date.now()
      const run = await connect([], '{}')
      expect(run).toMatchObject({ code: null, signal: null })
      expect(Date.now() - started).toBeLessThan(8000)
      // The holder still runs (its time file moves on): the pipes were held when the answer came.
      const before = readFileSync(tick, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(readFileSync(tick, 'utf8')).not.toBe(before)
    } finally {
      // The grandchild ends itself on the stop file; nothing is killed by a pid.
      writeFileSync(stop, '')
      for (let i = 0; i < 100 && existsSync(alive); i++) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(existsSync(alive)).toBe(false)
  })

  // Mutant review of PR #482: the write's limit, the error after the write, and the timer branch.
  it('the write (no arguments) gets 30 minutes: after its commit it may run qmd-collections; the facts and the checks keep 120 s', () => {
    expect(CONNECT_WRITE_TIMEOUT_MS).toBe(30 * 60_000)
    expect(CONNECT_TIMEOUT_MS).toBe(120_000)
    expect(connectTimeoutMs([])).toBe(CONNECT_WRITE_TIMEOUT_MS)
    for (const args of [['--facts', '/work/shop'], ['--schema-only'], ['--check']]) expect(connectTimeoutMs(args)).toBe(CONNECT_TIMEOUT_MS)
  })

  it('bin/profile that fails after the Profile is written: the reason says so with what it said, not "does not find it"', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const written = connectorWith({
      connect: () => Promise.resolve({ code: 0, stdout: '{}', stderr: '' }),
      profile: () => Promise.resolve({ code: 1, stdout: '', stderr: 'profile: /h/projects/shop/profile.json is not valid JSON: Unexpected end of JSON input\n' }),
    })
    expect(await written.connector.write(repo, { profile: { mode: 'silent' }, rules: '', gate: [] })).toEqual({
      status: 'rejected',
      reason: `The profile was written, but the Harness could not be asked about ${repo}: bin/profile failed with exit code 1: profile: /h/projects/shop/profile.json is not valid JSON: Unexpected end of JSON input. The folder was not added.`,
    })
    expect(written.added).toEqual([])
  })

  it('the script ends by itself and only a process it started holds the pipes: at the limit, the script\'s own exit code', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const alive = join(scratch, 'grandchild-alive')
    const stop = join(scratch, 'grandchild-stop')
    // The grandchild holds the inherited pipes until the stop file appears (or 30 s); detached, so
    // that on Windows it outlives the script (see the time-limit test above).
    const grandchild = [
      "const fs = require('node:fs')",
      'const [alive, stop] = process.argv.slice(1)',
      'fs.writeFileSync(alive, String(process.pid))',
      'const end = () => { try { fs.unlinkSync(alive) } catch {} process.exit(0) }',
      'setInterval(() => { if (fs.existsSync(stop)) end() }, 100)',
      'setTimeout(end, 30000)',
    ].join('; ')
    writeFileSync(
      join(binDir, 'project-connect'),
      [
        '#!/usr/bin/env node',
        "import('node:child_process').then((cp) => {",
        // unref: the script does not wait for it, as with a daemon it leaves behind.
        `  cp.spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, ${JSON.stringify(alive)}, ${JSON.stringify(stop)}], { stdio: 'inherit', detached: true, windowsHide: true }).unref()`,
        "  process.stdout.write('written')",
        '  process.exitCode = 7',
        '})',
        '',
      ].join('\n'),
    )
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), timeoutMs: 3000 })
    try {
      const started = Date.now()
      const run = await connect([], '{}')
      expect(run).toMatchObject({ code: 7, signal: null, stdout: 'written' })
      expect(Date.now() - started).toBeLessThan(8000)
      expect(existsSync(alive)).toBe(true)
    } finally {
      writeFileSync(stop, '')
      for (let i = 0; i < 100 && existsSync(alive); i++) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(existsSync(alive)).toBe(false)
  })

  // Mac review round 2 of PR #482: a test of the limit the runner is asked for, not of the constants.
  it('with no limit in the source the write gets 30 minutes from runHarnessScript, --facts and --check 120 s', async () => {
    const asked: { args: string[]; timeoutMs: number }[] = []
    const run: typeof runHarnessScript = (_script, args, _env, options) => {
      asked.push({ args: [...args], timeoutMs: options.timeoutMs })
      return Promise.resolve({ code: 0, stdout: '{}', stderr: '' })
    }
    const connect = connectScriptRunner({ harness: () => location(join(scratch, 'harness-bin')), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), run })
    await connect([], '{}')
    await connect(['--facts', join(scratch, 'shop')], 'null')
    await connect(['--check'], '{}')
    expect(asked).toEqual([
      { args: [], timeoutMs: 30 * 60_000 },
      { args: ['--facts', join(scratch, 'shop')], timeoutMs: 120_000 },
      { args: ['--check'], timeoutMs: 120_000 },
    ])
  })

  // Mac review round 2: project-connect runs qmd-collections, which runs `qmd update`. A kill of
  // the script alone left them running.
  it('an abort kills the script and what it started: the grandchild does not outlive it', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const pidFile = join(scratch, 'grandchild-pid')
    const stop = join(scratch, 'grandchild-stop')
    const marker = `worfy-ticket30-grandchild-${process.pid}-${Date.now()}`
    // Ends by itself on the stop file or after 30 s, so that a failing run leaves nothing for long.
    const grandchild = [
      "const fs = require('node:fs')",
      'const [pidFile, stop] = process.argv.slice(1)',
      'fs.writeFileSync(pidFile, String(process.pid))',
      'setInterval(() => { if (fs.existsSync(stop)) process.exit(0) }, 100)',
      'setTimeout(() => process.exit(0), 30000)',
    ].join('; ')
    // On Windows node keeps the processes it starts in a job that ends with it; the grandchild is
    // detached there to be outside it, as a process a non-node program started would be. Elsewhere it
    // stays in the script's process group, as qmd-collections and qmd update do.
    const detached = process.platform === 'win32'
    writeFileSync(
      join(binDir, 'project-connect'),
      [
        '#!/usr/bin/env node',
        "import('node:child_process').then((cp) => {",
        `  cp.spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, ${JSON.stringify(pidFile)}, ${JSON.stringify(stop)}, ${JSON.stringify(marker)}], { stdio: 'ignore', detached: ${String(detached)}, windowsHide: true })`,
        '  setInterval(() => undefined, 1000)',
        '})',
        '',
      ].join('\n'),
    )
    const quitting = new AbortController()
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), signal: () => quitting.signal })
    try {
      const running = connect([], '{}')
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(grandchildRunning(pid, marker)).toBe(true)
      quitting.abort()
      expect(await running).toMatchObject({ code: null, signal: null })
      for (let i = 0; i < 50 && pidInUse(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(grandchildRunning(pid, marker)).toBe(false)
    } finally {
      writeFileSync(stop, '')
    }
  })

  /**
   * A stand-in of project-connect that starts a grandchild in its own process group (not detached,
   * as qmd-collections runs `qmd update`), writes its pid and, with `exitCode`, exits at once while
   * the grandchild holds the inherited pipes. The grandchild ends by itself on the stop file or
   * after 30 s, so that a failing run leaves nothing for long.
   */
  const groupScript = (binDir: string, exitCode: number | null): { pidFile: string; stop: string; marker: string } => {
    const pidFile = join(scratch, 'grandchild-pid')
    const stop = join(scratch, 'grandchild-stop')
    const marker = `worfy-ticket59-grandchild-${process.pid}-${Date.now()}`
    const grandchild = [
      "const fs = require('node:fs')",
      'const [pidFile, stop] = process.argv.slice(1)',
      'fs.writeFileSync(pidFile, String(process.pid))',
      'setInterval(() => { if (fs.existsSync(stop)) process.exit(0) }, 100)',
      'setTimeout(() => process.exit(0), 30000)',
    ].join('; ')
    writeFileSync(
      join(binDir, 'project-connect'),
      [
        '#!/usr/bin/env node',
        "import('node:child_process').then((cp) => {",
        `  cp.spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, ${JSON.stringify(pidFile)}, ${JSON.stringify(stop)}, ${JSON.stringify(marker)}], { stdio: 'inherit', windowsHide: true })${exitCode === null ? '' : '.unref()'}`,
        exitCode === null ? '  setInterval(() => undefined, 1000)' : `  process.exitCode = ${exitCode}`,
        '})',
        '',
      ].join('\n'),
    )
    return { pidFile, stop, marker }
  }

  // Mac review of PR #482 (worfy-windows ticket 59): stop() returned at once when the script had
  // exited, so the signal left its process group running with the pipes, and the run waited for the
  // time limit.
  it.skipIf(process.platform === 'win32')('the signal after the script has exited while its process group holds the pipes: the group is killed, the answer is the script\'s own exit code', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const { pidFile, stop, marker } = groupScript(binDir, 7)
    const quitting = new AbortController()
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), signal: () => quitting.signal, timeoutMs: 15_000 })
    try {
      const running = connect([], '{}')
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      // The script exits right after it starts the grandchild.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(grandchildRunning(pid, marker)).toBe(true)
      const started = Date.now()
      quitting.abort()
      expect(await running).toMatchObject({ code: 7, signal: null })
      expect(Date.now() - started).toBeLessThan(3000)
      for (let i = 0; i < 50 && pidInUse(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(grandchildRunning(pid, marker)).toBe(false)
    } finally {
      writeFileSync(stop, '')
      // The stop file goes with the scratch folder in afterEach: a grandchild of a failed run is ended here.
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8'))
        if (grandchildRunning(pid, marker)) process.kill(pid, 'SIGKILL')
      }
    }
  })

  // Mac review of PR #482 (worfy-windows ticket 59): the script leads a process group of its own, so
  // the Ctrl+C or SIGHUP of a terminal that started worfy does not reach it. Electron quits on those
  // signals and node emits 'exit'; the runner kills every script still running then — also
  // qmd-collections, which runs with no signal of its own (src/main/harness/qmd.ts).
  it.skipIf(process.platform === 'win32')('on the exit of worfy every Harness script still running is killed with its process group', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const { pidFile, stop, marker } = groupScript(binDir, null)
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), timeoutMs: 15_000 })
    try {
      const running = connect([], '{}')
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(grandchildRunning(pid, marker)).toBe(true)
      expect(process.listeners('exit')).toContain(killRunningHarnessScripts)
      const started = Date.now()
      killRunningHarnessScripts()
      expect(await running).toMatchObject({ code: null })
      expect(Date.now() - started).toBeLessThan(3000)
      for (let i = 0; i < 50 && pidInUse(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(grandchildRunning(pid, marker)).toBe(false)
    } finally {
      writeFileSync(stop, '')
      // The stop file goes with the scratch folder in afterEach: a grandchild of a failed run is ended here.
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8'))
        if (grandchildRunning(pid, marker)) process.kill(pid, 'SIGKILL')
      }
    }
  })

  // Review round 1 of PR #507: SIGKILL on the exit left qmd-collections no chance to release
  // refresh.lock. The exit sends SIGTERM, which a script can handle.
  it.skipIf(process.platform === 'win32')('on the exit of worfy a running script gets SIGTERM, so it can clean up before it ends', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const ready = join(scratch, 'term-ready')
    const cleaned = join(scratch, 'term-cleaned')
    writeFileSync(
      join(binDir, 'project-connect'),
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(cleaned)}, 'SIGTERM'); process.exit(143) })`,
        `fs.writeFileSync(${JSON.stringify(ready)}, '')`,
        'setTimeout(() => process.exit(0), 30000)',
        '',
      ].join('\n'),
    )
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), timeoutMs: 15_000 })
    const running = connect([], '{}')
    for (let i = 0; i < 200 && !existsSync(ready); i++) await new Promise((resolve) => setTimeout(resolve, 50))
    killRunningHarnessScripts()
    expect(await running).toMatchObject({ code: 143 })
    expect(readFileSync(cleaned, 'utf8')).toBe('SIGTERM')
  })

  // Review round 1 of PR #507 (mutant M1): the script has exited, its process group still holds the
  // pipes; the exit of worfy ends that group too.
  it.skipIf(process.platform === 'win32')('on the exit of worfy the group of a script that has exited, still holding its pipes, is ended', { timeout: 20_000 }, async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const { pidFile, stop, marker } = groupScript(binDir, 7)
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), timeoutMs: 5000 })
    try {
      const running = connect([], '{}')
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(grandchildRunning(pid, marker)).toBe(true)
      const started = Date.now()
      killRunningHarnessScripts()
      expect(await running).toMatchObject({ code: 7 })
      expect(Date.now() - started).toBeLessThan(3000)
      for (let i = 0; i < 50 && pidInUse(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(grandchildRunning(pid, marker)).toBe(false)
    } finally {
      writeFileSync(stop, '')
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8'))
        if (grandchildRunning(pid, marker)) process.kill(pid, 'SIGKILL')
      }
    }
  })

  // Review round 1 of PR #507 (mutant M4): a script that has answered leaves the list, so the exit of
  // worfy signals no group of an old pid, which may belong to another process by then.
  it('a script that has answered is not signalled on the exit of worfy', async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    writeFileSync(join(binDir, 'project-connect'), ['#!/usr/bin/env node', 'process.stdout.write(String(process.pid))', ''].join('\n'))
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])) })
    const run = await connect([], '{}')
    const pid = Number(run.stdout)
    expect(pid).toBeGreaterThan(0)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      killRunningHarnessScripts()
      expect(kill.mock.calls.filter(([target]) => target === pid || target === -pid)).toEqual([])
    } finally {
      kill.mockRestore()
    }
  })

  it('the signal (the app quits) kills a running script: code null, and the script is gone', async () => {
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const tick = join(scratch, 'script-tick')
    writeFileSync(
      join(binDir, 'project-connect'),
      ['#!/usr/bin/env node', `setInterval(() => require('node:fs').writeFileSync(${JSON.stringify(tick)}, String(Date.now())), 100)`, ''].join('\n'),
    )
    const quitting = new AbortController()
    const connect = connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])), signal: () => quitting.signal })
    const running = connect([], '{}')
    for (let i = 0; i < 100 && !existsSync(tick); i++) await new Promise((resolve) => setTimeout(resolve, 50))
    const started = Date.now()
    quitting.abort()
    expect(await running).toMatchObject({ code: null, signal: null })
    expect(Date.now() - started).toBeLessThan(3000)
    const last = readFileSync(tick, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(readFileSync(tick, 'utf8')).toBe(last)
    // An aborted signal starts nothing.
    await expect(connect([], '{}')).rejects.toThrow('not started: the run was stopped')
  })

  it('a crash of bin/project-connect (exit 1, no issues): the refusal names its Error line, not the "Node.js vNN" line', async () => {
    const crash = '/h/bin/project-connect:300\n    throw x\n    ^\n\nTypeError: boom\n    at Object.<anonymous> (/h/bin/project-connect:300:5)\n\nNode.js v24.21.0\n'
    const { connector } = connectorWith({ connect: () => Promise.resolve({ code: 1, stdout: '', stderr: crash }) })
    expect(await connector.check({} as ProfileDraft)).toEqual([{ path: '', kind: 'write', message: 'TypeError: boom' }])
  })

  it('a start failure of the script is the form step\'s reason', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const binDir = join(scratch, 'harness-bin')
    mkdirSync(binDir)
    const { connector } = connectorWith({ connect: connectScriptRunner({ harness: () => location(binDir), env: () => Promise.resolve(scriptsEnv([NODE_DIR])) }) })
    expect(await connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)).toEqual({
      status: 'failed',
      reason: `bin/project-connect could not be run: no Harness script at ${join(binDir, 'project-connect')}`,
      issues: [],
    })
  })
})

describe('the Harness check (step 3)', () => {
  it.each([
    [{ kind: 'not-installed' as const }, 'The Harness plugin is not installed. Install it on the first-run screen.'],
    [{ kind: 'outdated' as const, from: '0.3.0', to: '0.4.0' }, 'The Harness plugin is 0.3.0, and worfy carries 0.4.0. Update it on the first-run screen.'],
    [{ kind: 'installed' as const, version: '0.4.0', enabled: false }, 'The Harness plugin 0.4.0 is installed but disabled. Enable it on the first-run screen.'],
  ])('%o: no draft Session, the answer names the reason', async (state, reason) => {
    const repo = makeRepo(join(scratch, 'shop'))
    const { connector, requests } = connectorWith({ harness: () => Promise.resolve({ ...installed, state }) })
    expect(await connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)).toEqual({ status: 'harness', reason })
    expect(requests).toHaveLength(0)
  })
})

describe('the draft Session (step 4)', () => {
  it('runs in the folder with the draft schema and only Read/Glob/Grep; its first message is the skill with the facts of the repository', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith()
    const activity: string[] = []
    const before = harnessFiles()

    const outcome = await run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, (text) => activity.push(text))

    expect(run.requests).toHaveLength(1)
    const request = run.requests[0]
    expect(request?.cwd).toBe(repo)
    expect(request?.outputFormat.type).toBe('json_schema')
    expect(request?.allowedTools).toEqual(['Read', 'Glob', 'Grep'])
    expect(request?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']))
    expect(request?.allowedTools).not.toContain('Bash')
    expect(request?.settings.permissionMode).toBe('default')
    // The facts come from bin/project-connect --facts, as data: the Session runs no command for them.
    const facts = { folder: repo, kind: 'git', repos: [{ name: 'shop', path: repo, branch: 'main', defaultBranch: 'main', hasCommits: true, remotes: [], origin: null }] }
    const messages = run.calls.filter((call) => call.kind === 'message').map((call) => (call as { text: string }).text)
    expect(messages).toEqual([draftMessage(repo, 'silent', facts)])
    expect(messages[0]?.startsWith(`/worfy:connect-project ${repo} silent --draft-only\n`)).toBe(true)
    expect(messages[0]).toContain('run no commands')
    expect(messages[0]).toContain('"origin": null')
    expect(activity).toEqual(['Reading the repositories', 'Claude Code started', `Read ${repo}/package.json`, `Grep ${repo}/package.json`, 'The draft is ready'])

    // The form gets the draft, with what worfy owns set over it.
    expect(outcome.status).toBe('draft')
    if (outcome.status !== 'draft') return
    const profile = outcome.draft.profile as Record<string, Record<string, unknown>>
    expect(profile.mode).toBe('silent')
    expect(profile.workflow?.folder).toBeNull()
    expect(profile.worktree?.root).toBe(join(repo, '.claude', 'worktrees') + '/')
    expect(profile.language).toEqual({ reports: 'ru', team: 'en', docs: 'en' })
    expect(profile.github).toEqual({ account: null })
    expect(outcome.draft.gate).toEqual([expect.objectContaining({ key: 'fake-project', match: repo, profile: 'fake-project' })])
    expect(outcome.issues).toEqual([])
    // Nothing was written: not in the Harness home, not in the repository.
    expect(harnessFiles()).toEqual(before)
    expect(clean(repo)).toBe('')
  })

  it('the schema file as it is fails the validator of Claude Code on the meta-schema it names, with the text Claude Code printed', () => {
    expect(SCHEMA.$schema).toBe(META_2020_12)
    expect(() => checkAsClaudeCode(SCHEMA)).toThrow(`no schema with key or ref "${META_2020_12}"`)
  })

  it('the validator of the test is the strict Ajv 8 of Claude Code: it throws on what strict mode refuses and knows $defs', () => {
    expect(() => checkAsClaudeCode({ type: 'array', prefixItems: [{ type: 'string' }] })).toThrow('strict mode: unknown keyword: "prefixItems"')
    expect(() => checkAsClaudeCode({ if: { type: 'string' } })).toThrow('strict mode: "if" without "then" and "else" is ignored')
    expect(() => checkAsClaudeCode({ type: 'array', additionalItems: { type: 'number' } })).toThrow('strict mode: "additionalItems" is ignored when "items" is not an array of schemas')
    expect(() => checkAsClaudeCode({ type: 'strng' })).toThrow('schema is invalid')
    // What strict mode only writes down comes back, and the console is left as it was.
    expect(checkAsClaudeCode({ type: 'object', properties: { text: { minLength: 1 } } })).toEqual([expect.stringContaining('strict mode: missing type "string" for keyword "minLength"')])
    expect(vi.isMockFunction(console.warn)).toBe(false)
    expect(checkAsClaudeCode({ type: 'object', $defs: { name: { type: ['string', 'null'] } }, properties: { name: { $ref: '#/$defs/name' } } })).toEqual([])
  })

  it('gets the schema of the file without $schema and $id, and the validator of Claude Code takes it with no strict mode finding', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith()

    const outcome = await run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)

    expect(outcome.status).toBe('draft')
    const sent = run.requests[0]?.outputFormat.schema
    expect(metaKeys(sent)).toEqual([])
    // No error of strict mode (it would throw) and nothing strict mode wrote to the console.
    expect(checkAsClaudeCode(sent)).toEqual([])
    // Nothing else of the schema is lost on the way, and the file's own copy keeps its $schema.
    const { $schema: named, ...rest } = SCHEMA
    expect(named).toBe(META_2020_12)
    expect(sent).toEqual(rest)
  })

  it('takes $schema and $id out of every schema inside the schema, and leaves a field or a value of that name', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const inner = { $schema: META_2020_12, $id: 'https://worfy.example/inner' }
    // Frozen: the schema of the caller is not changed in place.
    const schema = deepFreeze({
      ...inner,
      type: 'object',
      required: ['$id'],
      properties: {
        // Fields of the draft that happen to be called $id and $schema: names, not keywords.
        // Values of enum, examples, default and const are data too, an object with such a key among them.
        $id: { ...inner, enum: ['$schema', '$id', { $id: 'a value', $schema: 'a value' }], examples: [{ $id: 'a value' }] },
        $schema: { type: 'object', default: { $id: 'a value' }, const: { $schema: 'a value' } },
        list: { type: 'array', items: { ...inner, type: 'string' }, contains: { ...inner, type: 'string' } },
        pair: { type: 'array', minItems: 1, maxItems: 1, items: [{ ...inner, type: 'string' }], additionalItems: { ...inner, type: 'number' } },
        either: { anyOf: [{ ...inner, type: 'string' }], oneOf: [{ ...inner, type: 'string' }], allOf: [{ ...inner, type: 'string' }], not: { ...inner, type: 'number' } },
        when: { if: { ...inner, type: 'string' }, then: { ...inner, type: 'string', minLength: 1 }, else: { ...inner, type: 'null' } },
        map: { type: 'object', patternProperties: { '^x': { ...inner, type: 'string' } }, additionalProperties: { ...inner, type: 'number' }, propertyNames: { ...inner, type: 'string', minLength: 1 } },
        needs: { type: 'object', dependencies: { a: { ...inner, required: ['b'] }, c: ['d'] } },
        shared: { $ref: '#/definitions/name' },
      },
      definitions: { name: { ...inner, type: 'string' } },
    })
    const run = connectorWith({ draftSchema: () => schema })

    await run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)

    expect(run.requests).toHaveLength(1)
    const sent = run.requests[0]?.outputFormat.schema
    expect(sent).toEqual({
      type: 'object',
      required: ['$id'],
      properties: {
        $id: { enum: ['$schema', '$id', { $id: 'a value', $schema: 'a value' }], examples: [{ $id: 'a value' }] },
        $schema: { type: 'object', default: { $id: 'a value' }, const: { $schema: 'a value' } },
        list: { type: 'array', items: { type: 'string' }, contains: { type: 'string' } },
        pair: { type: 'array', minItems: 1, maxItems: 1, items: [{ type: 'string' }], additionalItems: { type: 'number' } },
        either: { anyOf: [{ type: 'string' }], oneOf: [{ type: 'string' }], allOf: [{ type: 'string' }], not: { type: 'number' } },
        when: { if: { type: 'string' }, then: { type: 'string', minLength: 1 }, else: { type: 'null' } },
        map: { type: 'object', patternProperties: { '^x': { type: 'string' } }, additionalProperties: { type: 'number' }, propertyNames: { type: 'string', minLength: 1 } },
        needs: { type: 'object', dependencies: { a: { required: ['b'] }, c: ['d'] } },
        shared: { $ref: '#/definitions/name' },
      },
      definitions: { name: { type: 'string' } },
    })
    expect(checkAsClaudeCode(sent)).toEqual([])
  })

  it('a draft off the schema is an error with its reasons, and nothing is written', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const lines = readFileSync(join(SCRIPTS, 'profile-draft.jsonl'), 'utf8').trim().split('\n')
    const result = JSON.parse(lines.at(-1) ?? '{}') as { structured_output: { profile: Record<string, unknown>; extra?: number } }
    delete result.structured_output.profile.commands
    result.structured_output.extra = 1
    writeFileSync(join(scripts, 'broken.jsonl'), [...lines.slice(0, -1), JSON.stringify(result)].join('\n'))
    const before = harnessFiles()

    const outcome = await connectorWith({ scriptsDir: scripts, script: 'broken' }).connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.reason).toMatch(/^The draft does not match the schema: /)
    expect(outcome.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['profile.commands', 'extra']))
    expect(harnessFiles()).toEqual(before)
  })

  it('Stop ends the draft Session', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const lines = readFileSync(join(SCRIPTS, 'profile-draft.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(scripts, 'slow.jsonl'), [...lines.slice(0, 2), '{"fake":"wait_release","name":"never"}', ...lines.slice(2)].join('\n'))
    const { connector } = connectorWith({ scriptsDir: scripts, script: 'slow' })
    let started: () => void = () => undefined
    const startedNow = new Promise<void>((resolve) => (started = resolve))
    const outcome = connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => started())
    await startedNow
    expect(connector.stop('d1')).toBe(true)
    expect(await outcome).toEqual({ status: 'stopped' })
    expect(connector.stop('d1')).toBe(false)
  })

  it('canUseTool lets through only Read, Glob, Grep and the structured answer', async () => {
    const signal = new AbortController().signal
    for (const tool of ['Read', 'Glob', 'Grep', 'StructuredOutput']) {
      expect((await draftCanUseTool(tool, { file_path: '/x' }, { signal })).behavior, tool).toBe('allow')
    }
    for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'BashOutput', 'mcp__x__y', 'Skill']) {
      expect((await draftCanUseTool(tool, { command: 'git remote -v' }, { signal })).behavior, tool).toBe('deny')
    }
    expect(DRAFT_TOOLS).toEqual(['Read', 'Glob', 'Grep'])
    expect(DRAFT_DISALLOWED_TOOLS).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']))
  })

  it('Stop while the facts are read ends the draft before any Session', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => (release = resolve))
    const run = connectorWith({
      connect: async (args, stdin) => {
        if (args[0] === '--facts') await released
        return runScript('project-connect', args, stdin)
      },
    })
    let reading: () => void = () => undefined
    const readingNow = new Promise<void>((resolve) => (reading = resolve))
    const outcome = run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, (text) => text === 'Reading the repositories' && reading())
    await readingNow
    expect(run.connector.stop('d1')).toBe(true)
    release()
    expect(await outcome).toEqual({ status: 'stopped' })
    expect(run.requests).toHaveLength(0)
  })

  it('the facts of the folder that cannot be read stop the draft before any Session', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith({ connect: (args, stdin) => (args[0] === '--facts' ? Promise.resolve({ code: 1, stdout: '{"ok":false,"errors":[{"path":"","kind":"value","message":"cannot read"}]}', stderr: '' }) : runScript('project-connect', args, stdin)) })
    const outcome = await run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)
    expect(outcome).toEqual({ status: 'failed', reason: 'The facts of the folder could not be read: draft: cannot read', issues: [{ path: '', kind: 'value', message: 'cannot read' }] })
    expect(run.requests).toHaveLength(0)
  })

  it('reads only the user\'s settings and asks the policy tier to ignore every allow rule outside it', () => {
    const options = draftSessionOptions({
      cwd: '/repos/shop',
      env: {},
      runtime: { packaged: false, resourcesPath: '/r', platform: 'darwin', arch: 'arm64' },
      settings: { model: null, effort: null, permissionMode: 'default' },
      canUseTool: draftCanUseTool,
      outputFormat: { type: 'json_schema', schema: SCHEMA },
      allowedTools: DRAFT_TOOLS,
      disallowedTools: DRAFT_DISALLOWED_TOOLS,
      harnessPlugin: null,
    })
    // Not 'project' or 'local': allow rules in the repository's .claude/settings*.json would let a tool past canUseTool.
    expect(options.settingSources).toEqual(['user'])
    expect(options.managedSettings).toEqual({ allowManagedPermissionRulesOnly: true })
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep'])
    expect(options.disallowedTools).toContain('Bash')
    expect(options.allowedTools).not.toContain('Bash')
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema: SCHEMA })
    expect(options.permissionMode).toBe('default')
    expect(options.canUseTool).toBe(draftCanUseTool)
    expect(options.mcpServers).toBeUndefined()
    // An ordinary Session keeps all three sources and no such policy.
    const ordinary = sessionOptions({ cwd: '/repos/shop', env: {}, runtime: { packaged: false, resourcesPath: '/r', platform: 'darwin', arch: 'arm64' } })
    expect(ordinary.settingSources).toEqual(['user', 'project', 'local'])
    expect(ordinary.managedSettings).toBeUndefined()
  })

  it('the activity names the last tool and its target', () => {
    expect(activityOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'lint' } }] } })).toBe('Grep lint')
    expect(activityOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } })).toBeNull()
    expect(activityOf({ type: 'user' })).toBeNull()
  })
})

describe('the form and the write (steps 5 and 6)', () => {
  /** The draft of the fake agent for `repo`, as the form gets it. */
  async function draftFor(run: Harnessed, repo: string, mode: 'full' | 'silent' = 'silent', workflowFolder: string | null = null): Promise<ProfileDraft> {
    const outcome = await run.connector.draft({ draftId: `d-${repo}`, root: repo, mode, workflowFolder }, () => undefined)
    if (outcome.status !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`)
    return outcome.draft
  }

  it('the check names a taken name under its field; Connect writes, bin/profile finds it, the Project is in the list', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    mkdirSync(join(harnessHome, 'projects', 'fake-project'), { recursive: true })
    const run = connectorWith()
    const draft = await draftFor(run, repo)
    expect(await run.connector.check(draft)).toEqual([{ path: 'profile.name', kind: 'conflict', message: `the name is taken: ${join(harnessHome, 'projects', 'fake-project')} exists` }])
    expect(await run.connector.write(repo, draft)).toEqual({ status: 'refused', issues: [expect.objectContaining({ path: 'profile.name', kind: 'conflict' })] })
    expect(run.added).toEqual([])

    // The person renames it in the form.
    const renamed: ProfileDraft = { ...draft, profile: { ...draft.profile, name: 'shop' }, gate: draft.gate.map((entry) => ({ ...entry, key: 'shop', profile: 'shop' })) }
    expect(await run.connector.check(renamed)).toEqual([])
    const written = await run.connector.write(repo, renamed)
    expect(written).toMatchObject({ status: 'added', notice: 'qmd collections were not set up: qmd is not installed.' })
    expect(run.added).toEqual([repo])
    expect((await realProfile(repo, ['-C', repo, '--field', 'mode'])).stdout.trim()).toBe('silent')
    expect((await realProfile(repo, ['-C', repo, '--field', 'workflow.folder'])).stdout.trim()).toBe(join(harnessHome, 'projects', 'shop', 'workflow'))
    const store = new ProjectStore(join(scratch, 'data'), runGit, () => Promise.resolve(null))
    expect(store.active()).toMatchObject({ path: repo, name: 'shop' })
    // A second connection of the same repository: its match is in the registry now.
    expect(await run.connector.check({ ...renamed, profile: { ...renamed.profile, name: 'shop2' }, gate: renamed.gate.map((entry) => ({ ...entry, key: 'shop2', profile: 'shop2' })) })).toEqual([
      expect.objectContaining({ path: 'gate[0].match', kind: 'conflict' }),
    ])
    expect(clean(repo)).toBe('')
  })

  it('a folder above two repositories: Silent only, the folder itself is the Workflow folder, Full is refused', async () => {
    const workspace = join(scratch, 'ws')
    const api = makeRepo(join(workspace, 'api'))
    const web = makeRepo(join(workspace, 'web'))
    // The real ProjectStore (ticket 23 takes a folder outside git that the Harness resolves).
    const run = connectorWith()

    expect(await run.connector.draft({ draftId: 'full', root: workspace, mode: 'full', workflowFolder: null }, () => undefined)).toEqual({ status: 'refused', reason: MULTI_REPO_FULL })
    expect(run.requests).toHaveLength(0)

    const draft = await draftFor(run, workspace)
    const profile = draft.profile as Record<string, Record<string, unknown>>
    expect(profile.mode).toBe('silent')
    expect(profile.workflow?.folder).toBe(workspace)
    expect(profile.worktree?.root).toBeNull()
    // The skill proposes one entry per repository; the fake agent proposed one for the folder.
    const both: ProfileDraft = { ...draft, profile: { ...draft.profile, name: 'ws' }, gate: [api, web].map((match) => ({ ...draft.gate[0], key: basename(match), match, profile: 'ws' })) }
    expect(await run.connector.write(workspace, { ...both, profile: { ...both.profile, mode: 'full' } })).toEqual({ status: 'refused', issues: [{ path: 'profile.mode', kind: 'value', message: MULTI_REPO_FULL }] })
    expect(run.added).toEqual([])
    // Before the write the store refuses the folder: the Harness does not know it yet.
    expect((await sandboxStore().add(workspace)).status).toBe('rejected')

    const written = await run.connector.write(workspace, both)
    expect(written).toMatchObject({ status: 'added', notice: 'qmd collections were not set up: qmd is not installed.' })
    expect(run.added).toEqual([workspace])
    const store = sandboxStore()
    expect(store.list()).toEqual([expect.objectContaining({ name: 'ws', path: workspace })])
    expect(store.active()).toMatchObject({ path: workspace })
    // Both repositories keep their ticket worktrees out of git (Silent mode).
    for (const repo of [api, web]) expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n')).toContain('.claude/worktrees/')
    expect((await realProfile(workspace, ['-C', workspace, '--field', '_resolved.workspace'])).stdout.trim()).toBe(workspace)
    expect((await realProfile(api, ['-C', api, '--field', 'mode'])).stdout.trim()).toBe('silent')
    expect(clean(api)).toBe('')
    expect(clean(web)).toBe('')
  })
})

describe('attribution: what the form gets and what Connect writes (ADR-0061)', () => {
  type Attribution = 'on' | 'off'
  const fixtureLines = (): string[] => readFileSync(join(SCRIPTS, 'profile-draft.jsonl'), 'utf8').trim().split('\n')
  const proposedBy = (lines: readonly string[]): Record<string, unknown> => (JSON.parse(lines.at(-1) ?? '{}') as { structured_output: { profile: Record<string, unknown> } }).structured_output.profile

  /** A folder with the fake agent's script changed so that the Session proposes `attribution`. */
  function scriptsProposing(attribution: Attribution): string {
    const scripts = join(scratch, `scripts-${attribution}`)
    mkdirSync(scripts)
    const lines = fixtureLines()
    const result = JSON.parse(lines.at(-1) ?? '{}') as { structured_output: { profile: Record<string, unknown> } }
    result.structured_output.profile.attribution = attribution
    writeFileSync(join(scripts, 'profile-draft.jsonl'), [...lines.slice(0, -1), JSON.stringify(result)].join('\n'))
    return scripts
  }

  /** The draft as the form gets it: the Session's answer after worfy set what it owns. */
  async function draftFor(run: Harnessed, repo: string, mode: 'full' | 'silent'): Promise<ProfileDraft> {
    const outcome = await run.connector.draft({ draftId: `d-${repo}`, root: repo, mode, workflowFolder: null }, () => undefined)
    if (outcome.status !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`)
    return outcome.draft
  }

  /** What the person does in the form: the name of the folder, and `patch` over the Profile. */
  const edited = (draft: ProfileDraft, name: string, patch: Record<string, unknown> = {}): ProfileDraft => ({
    ...draft,
    profile: { ...draft.profile, name, ...patch },
    gate: draft.gate.map((entry) => ({ ...entry, key: name, profile: name })),
  })
  const writtenAttribution = (name: string): unknown => (JSON.parse(readFileSync(join(harnessHome, 'projects', name, 'profile.json'), 'utf8')) as Record<string, unknown>).attribution
  const printedAttribution = async (repo: string): Promise<string> => (await realProfile(repo, ['-C', repo, '--field', 'attribution'])).stdout.trim()

  it('Silent, the Session proposed on: the form gets off, and Connect writes off', async () => {
    // The fixture is that case, and stays it.
    expect(proposedBy(fixtureLines())).toMatchObject({ mode: 'silent', attribution: 'on' })
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith()
    const draft = await draftFor(run, repo, 'silent')
    expect(draft.profile).toMatchObject({ mode: 'silent', attribution: 'off' })

    const form = edited(draft, 'shop')
    expect(await run.connector.check(form)).toEqual([])
    expect(await run.connector.write(repo, form)).toMatchObject({ status: 'added' })
    expect(writtenAttribution('shop')).toBe('off')
    expect(await printedAttribution(repo)).toBe('off')
  })

  it('Silent, the Session proposed off: off as well', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const draft = await draftFor(connectorWith({ scriptsDir: scriptsProposing('off') }), repo, 'silent')
    expect(draft.profile).toMatchObject({ mode: 'silent', attribution: 'off' })
  })

  it('Silent, the person picks on in the form: Connect writes on', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith()
    const draft = await draftFor(run, repo, 'silent')
    expect(draft.profile.attribution).toBe('off')

    // The check and the write take the form's draft as it is: the starting value is not set again.
    const picked = edited(draft, 'shop', { attribution: 'on' })
    expect(await run.connector.check(picked)).toEqual([])
    expect(await run.connector.write(repo, picked)).toMatchObject({ status: 'added' })
    expect(writtenAttribution('shop')).toBe('on')
    expect(await printedAttribution(repo)).toBe('on')
  })

  it('Full: the form gets what the Session proposed, on or off, and Connect writes it', async () => {
    for (const proposed of ['on', 'off'] as const) {
      const name = `full-${proposed}`
      const repo = makeRepo(join(scratch, name))
      const run = connectorWith({ scriptsDir: scriptsProposing(proposed) })
      const draft = await draftFor(run, repo, 'full')
      expect(draft.profile, proposed).toMatchObject({ mode: 'full', attribution: proposed })

      expect(await run.connector.write(repo, edited(draft, name)), proposed).toMatchObject({ status: 'added' })
      expect(writtenAttribution(name), proposed).toBe(proposed)
      expect(await printedAttribution(repo), proposed).toBe(proposed)
    }
  })

  it('one rule in bin/profile and in worfy: the default worfy names for a mode is what bin/profile prints for a Profile without the field', async () => {
    const expected = { silent: 'off', full: 'on' } as const
    const repos = { silent: makeRepo(join(scratch, 'bare-silent')), full: makeRepo(join(scratch, 'bare-full')) }
    const entries = (['silent', 'full'] as const).map((mode) => ({ key: `bare-${mode}`, match: repos[mode], profile: `bare-${mode}`, pm: 'npm', root: {}, workspace: {} }))
    writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: entries }))
    for (const mode of ['silent', 'full'] as const) {
      mkdirSync(join(harnessHome, 'projects', `bare-${mode}`), { recursive: true })
      // No `attribution` in the file: bin/profile answers with its own default.
      writeFileSync(join(harnessHome, 'projects', `bare-${mode}`, 'profile.json'), JSON.stringify({ schema: 2, name: `bare-${mode}`, mode }))
    }
    const silentDraft = applyChoices(
      { profile: { ...proposedBy(fixtureLines()), attribution: 'on' }, rules: '', gate: [] },
      { folder: { kind: 'git', root: repos.silent, repos: [], notice: null }, mode: 'silent', workflowFolder: null, reportsLanguage: 'en' },
    )
    for (const mode of ['silent', 'full'] as const) {
      const run = await realProfile(repos[mode], ['-C', repos[mode], '--field', 'attribution'])
      expect(run.code, `${mode}: ${run.stderr}`).toBe(0)
      const printed = run.stdout.trim()
      expect(printed, mode).toBe(expected[mode])
      // The shared function, and its two users: the move of schema 1 Profiles and the Silent draft.
      expect(defaultAttribution(mode), mode).toBe(printed)
      expect(proposeAttribution({}, mode), mode).toBe(printed)
    }
    expect(silentDraft.profile.attribution).toBe((await realProfile(repos.silent, ['-C', repos.silent, '--field', 'attribution'])).stdout.trim())
  })
})

describe('Connect for a Linked machine (worfy-link ticket 11)', () => {
  it('with keepActive the Project joins the list and the active Project of this Machine stays', async () => {
    const mine = makeRepo(join(scratch, 'mine'))
    await sandboxStore().add(mine)
    const run = connectorWith()
    const repo = makeRepo(join(scratch, 'shop'))
    const outcome = await run.connector.draft({ draftId: 'linked', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)
    if (outcome.status !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`)
    const draft: ProfileDraft = { ...outcome.draft, profile: { ...outcome.draft.profile, name: 'shop' }, gate: outcome.draft.gate.map((entry) => ({ ...entry, key: 'shop', profile: 'shop' })) }
    expect(await run.connector.write(repo, draft, { keepActive: true })).toMatchObject({ status: 'added' })
    const store = sandboxStore()
    expect(store.list().map((project) => project.path)).toEqual([mine, repo])
    expect(store.active()).toMatchObject({ path: mine })
    // Without keepActive — this Machine's own screen — the new Project becomes active: the test of steps 5 and 6 above.
  })
})

describe('the GitHub account (worfy-harness ticket 25)', () => {
  const ACCOUNTS = [
    { login: 'alice', active: true, token: 'gho_alice_TOKEN_0001' },
    { login: 'bob', token: 'gho_bob_TOKEN_0002' },
  ]

  async function draftFor(run: Harnessed, root: string): Promise<ProfileDraft> {
    const outcome = await run.connector.draft({ draftId: `d-${root}`, root, mode: 'silent', workflowFolder: null }, () => undefined)
    if (outcome.status !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`)
    return { ...outcome.draft, profile: { ...outcome.draft.profile, name: 'shop' }, gate: outcome.draft.gate.map((entry) => ({ ...entry, key: 'shop', profile: 'shop' })) }
  }

  it('after the account step the draft carries the chosen account and the finish its access allows; Connect writes both', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git')
    const gh = ghWorld(join(scratch, 'gh'), { accounts: ACCOUNTS, repos: { 'acme/shop': { alice: true, bob: false } } })
    const run = connectorWith({ gh: gh.run })

    const step = await run.connector.accounts(repo)
    expect(step).toMatchObject({ status: 'accounts', selected: 'alice' })
    const draft = await draftFor(run, repo)
    // bob has no write access: the local finish.
    const chosen = withGithubAccount(draft, githubChoice(step, 'bob'))
    expect(chosen.profile.github).toEqual({ account: 'bob' })
    expect((chosen.profile.workflow as Record<string, unknown>).finish).toBe('local-green')
    expect(await run.connector.check(chosen)).toEqual([])
    expect(await run.connector.write(repo, chosen)).toMatchObject({ status: 'added' })
    expect(await realProfile(repo, ['-C', repo, '--field', 'github.account'])).toMatchObject({ code: 0, stdout: 'bob\n' })
    expect((await realProfile(repo, ['-C', repo, '--field', 'workflow.finish'])).stdout.trim()).toBe('local-green')
    // No token reached the draft or the Harness home.
    const written = JSON.stringify(harnessFiles())
    for (const account of ACCOUNTS) expect(`${JSON.stringify(step)}${JSON.stringify(chosen)}${written}`).not.toContain(account.token)
    expect(clean(repo)).toBe('')
  })

  it('the active account with write access is chosen by default: pr-green-ci; "No account" gives none and the local finish', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
    const gh = ghWorld(join(scratch, 'gh'), { accounts: ACCOUNTS, repos: { 'acme/shop': { alice: true, bob: false } } })
    const run = connectorWith({ gh: gh.run })
    const step = await run.connector.accounts(repo)
    const draft = await draftFor(run, repo)
    const byDefault = withGithubAccount(draft, githubChoice(step, step.status === 'accounts' ? step.selected : null))
    expect(byDefault.profile.github).toEqual({ account: 'alice' })
    expect((byDefault.profile.workflow as Record<string, unknown>).finish).toBe('pr-green-ci')
    const none = withGithubAccount(draft, githubChoice(step, null))
    expect(none.profile.github).toEqual({ account: null })
    expect((none.profile.workflow as Record<string, unknown>).finish).toBe('local-green')
    expect(await run.connector.write(repo, byDefault)).toMatchObject({ status: 'added' })
    expect((await realProfile(repo, ['-C', repo, '--field', 'github.account'])).stdout.trim()).toBe('alice')
    expect((await realProfile(repo, ['-C', repo, '--field', 'workflow.finish'])).stdout.trim()).toBe('pr-green-ci')
  })

  it('a repository without origin needs no account and gh is not run: no account, the local finish', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const gh = ghWorld(join(scratch, 'gh'), { accounts: ACCOUNTS })
    const run = connectorWith({ gh: gh.run })
    const step = await run.connector.accounts(repo)
    expect(step).toEqual({ status: 'no-origin', reason: 'No GitHub origin: shop has no origin remote.' })
    expect(githubChoice(step, 'alice')).toEqual({ account: null, finish: 'local-green' })
    expect(gh.calls()).toEqual([])
  })
})
