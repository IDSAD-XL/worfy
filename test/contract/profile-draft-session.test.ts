// The draft of a Project's profile ("Add project", src/main/projects/connect.ts) leaves no Session of
// the Project behind. The draft is a single request of Claude Code (the oneShot part of the Claude
// driver), not a Session the person started: once the folder is a Project, the registry of ~/.claude
// (src/main/claude-home/registry.ts) must show neither a live nor a history Session for it, and no
// transcript of the draft's prompt may stay on disk.
//
// Claude Code is stood in at the Agent SDK's query(), as test/contract/story-one-shot.test.ts does it:
// the request reaches it through the Claude driver's real options (claudeOneShotQuery), and the stand-in
// does what Claude Code 2.1.322 does — registers itself in <home>/.claude/sessions/<pid>.json with its cwd
// while it runs and keeps a transcript under <home>/.claude/projects/<its cwd's folder> unless
// persistSession is false. Its answer is the draft of test/fixtures/agent-scripts/profile-draft.jsonl for
// the folder its prompt names. The real harness/bin/project-connect and harness/bin/profile write the
// Project in a temporary Harness home; HOME is a temporary folder, never the real one.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import { removeTestTree } from '../remove'

const mocks = vi.hoisted(() => ({
  home: '',
  /** What the stand-in query() got: its options and the text of its one message. */
  calls: [] as { options: Record<string, unknown>; text: string }[],
  /** The cwd of every entry in <home>/.claude/sessions while the request ran. */
  liveWhileRunning: [] as string[],
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin:/bin', HOME: mocks.home }, from: 'login-shell', error: null }) }))
vi.mock('../../src/main/harness/locate', async (original) => ({ ...(await original<object>()), currentHarness: () => ({ kind: 'plugin' }) }))
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { projectDirName: dirName } = await import('../../src/main/claude-home/registry')
  const SCRIPT = path.join(import.meta.dirname, '..', 'fixtures', 'agent-scripts', 'profile-draft.jsonl')
  /** The draft the fake agent answers, for `folder`. */
  const draftFor = (folder: string): unknown => {
    const line = fs
      .readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .find((text) => text.includes('"structured_output"'))
    if (line === undefined) throw new Error(`${SCRIPT} has no structured_output`)
    const result = JSON.parse(line.replaceAll(/\{\{(cwd|folder)\}\}/g, JSON.stringify(folder).slice(1, -1)).replaceAll('{{session}}', 'draft-1')) as { structured_output: unknown }
    return result.structured_output
  }
  return {
    query: (params: { prompt: AsyncIterable<{ message: { content: unknown } }>; options: Record<string, unknown> }) => {
      const options = params.options
      const at = String(options.cwd)
      const home = path.join(mocks.home, '.claude')
      const entry = path.join(home, 'sessions', `${String(process.pid)}.json`)
      return {
        async *[Symbol.asyncIterator]() {
          let text = ''
          for await (const message of params.prompt) text += String(message.message.content)
          mocks.calls.push({ options, text })
          fs.mkdirSync(path.dirname(entry), { recursive: true })
          fs.writeFileSync(entry, JSON.stringify({ pid: process.pid, sessionId: 'draft-1', cwd: at, entrypoint: 'sdk-ts', kind: 'sdk', startedAt: Date.now() }))
          if (options.persistSession !== false) {
            fs.mkdirSync(path.join(home, 'projects', dirName(at)), { recursive: true })
            fs.writeFileSync(path.join(home, 'projects', dirName(at), 'draft-1.jsonl'), `${JSON.stringify({ type: 'user', cwd: at, sessionId: 'draft-1', entrypoint: 'sdk-ts', message: { role: 'user', content: text } })}\n`)
          }
          mocks.liveWhileRunning = fs.readdirSync(path.dirname(entry)).map((name) => String((JSON.parse(fs.readFileSync(path.join(path.dirname(entry), name), 'utf8')) as { cwd: string }).cwd))
          // The folder the request is about: the one its prompt names (`/worfy:connect-project <folder> <mode> --draft-only`).
          const folder = /^\/worfy:connect-project (\S+) /.exec(text)?.[1] ?? at
          yield { type: 'system', subtype: 'init', cwd: at, session_id: 'draft-1' }
          yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(folder, 'package.json') } }] } }
          yield { type: 'result', subtype: 'success', result: '', structured_output: draftFor(folder) }
        },
        // Claude Code removes its entry when it exits.
        close: () => {
          fs.rmSync(entry, { force: true })
        },
      }
    },
  }
})

const { ProjectConnector } = await import('../../src/main/projects/connect')
const { vendorDriver } = await import('../../src/main/vendors/registry')
const { ClaudeHomeRegistry, projectDirName } = await import('../../src/main/claude-home/registry')
const { ProjectStore, runGit } = await import('../../src/main/projects/store')
const { profileRegistryFiles } = await import('../../src/main/harness/locate')
const { ghRunner } = await import('../../src/main/github/prs')

const REPO = join(import.meta.dirname, '..', '..')
const BIN = join(REPO, 'harness', 'bin')
const SCHEMA = JSON.parse(readFileSync(join(REPO, 'harness', 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>
const installed: HarnessStatus = { state: { kind: 'installed', version: '0.4.0', enabled: true }, bundledVersion: '0.4.0', canInstall: true, pluginDir: '/x/plugin', dependencies: [] }
/** Variables that would point the Harness scripts elsewhere (test/contract/projects-connect.test.ts). */
const OUTSIDE = /^(GIT_|CLAUDE_GATE_|CLAUDE_PROFILES_DIR$|PROJECT_CONNECT_|ELECTRON_RUN_AS_NODE$)/

let scratch: string
let home: string
let harnessHome: string
let runDir: string

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-draft-session-')))
  home = join(scratch, 'home')
  mocks.home = home
  mocks.calls = []
  mocks.liveWhileRunning = []
  harnessHome = join(home, '.claude', 'worfy-harness')
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
  runDir = join(scratch, 'worfy-data', 'terminal-ai')
})

afterEach(() => {
  removeTestTree(scratch)
})

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

function sandboxEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !OUTSIDE.test(key)))
  return { ...env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, CLAUDE_CONFIG_DIR: join(home, '.claude'), PROJECT_CONNECT_QMD: join(scratch, 'no-qmd') }
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

/** The connector of the app: the draft on the Claude driver's oneShot, the real Harness scripts in the sandbox. */
function appConnector(): InstanceType<typeof ProjectConnector> {
  const store = new ProjectStore(join(scratch, 'data'), runGit, () => Promise.resolve(null))
  return new ProjectConnector({
    git: runGit,
    gh: ghRunner({ command: join(scratch, 'no-gh') }),
    profile: (cwd, args) => runScript('profile', args, '', cwd),
    gateRegistries: () => Promise.resolve(profileRegistryFiles(sandboxEnv())),
    connect: (args, stdin) => runScript('project-connect', args, stdin),
    harness: () => Promise.resolve(installed),
    oneShot: (prompt, opts) => vendorDriver('claude').oneShot(prompt, opts),
    runDir: () => runDir,
    draftSchema: () => SCHEMA,
    reportsLanguage: () => 'ru',
    add: async (root, options) => {
      const result = await store.add(root, options)
      return result.status === 'added' ? { status: 'added', projectId: result.project.id, notice: result.notice } : result
    },
    log: () => undefined,
    insideTemp: () => false,
  })
}

const claudeHome = (): string => join(home, '.claude')
const registry = () => new ClaudeHomeRegistry({ home: claudeHome(), listWorktrees: () => Promise.resolve([]), isAlive: () => Promise.resolve(true) })

describe('the profile draft leaves no Session behind', () => {
  it('after the draft and Connect, the Project has no live and no history Session, and no transcript of the draft stays anywhere', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const connector = appConnector()

    const outcome = await connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)
    expect(outcome.status).toBe('draft')
    if (outcome.status !== 'draft') return
    expect(mocks.calls).toHaveLength(1)
    const written = await connector.write(repo, { ...outcome.draft, profile: { ...outcome.draft.profile, name: 'shop' }, gate: outcome.draft.gate.map((entry) => ({ ...entry, key: 'shop', profile: 'shop' })) })
    expect(written).toMatchObject({ status: 'added' })

    // The folder is a Project now: the Canvas's view of its Sessions is empty.
    expect(await registry().sessions(repo)).toEqual({ live: [], history: [] })
    expect(existsSync(join(claudeHome(), 'projects', projectDirName(repo)))).toBe(false)
    // The draft's text (the facts of the repositories) is kept nowhere.
    expect(existsSync(join(claudeHome(), 'projects'))).toBe(false)
    // While it ran, Claude Code stood in worfy's own folder, which is no Project's.
    expect(mocks.liveWhileRunning).toEqual([runDir])
    expect(existsSync(runDir)).toBe(true)
  })

  it('runs in worfy\'s own folder, reads the Project\'s folder as an extra folder, keeps no transcript, and names the folder by its absolute path', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    await appConnector().draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)
    const call = mocks.calls[0]
    expect(call?.options.cwd).toBe(runDir)
    expect(call?.options.additionalDirectories).toEqual([repo])
    expect(call?.options.persistSession).toBe(false)
    expect(call?.text.startsWith(`/worfy:connect-project ${repo} silent --draft-only\n`)).toBe(true)
    // Glob and Grep without a path look in the cwd, which is not the folder: the prompt says so.
    expect(call?.text).toContain(`absolute paths under ${repo}`)
  })
})
