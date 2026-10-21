// The Profile reader (src/main/workflow/profile.ts, worfy-daily ticket 06, ADR-0021): the list of
// MCP servers from `bin/profile --field mcp.allowed`, and the default list `plugin_worfy_qmd` (the qmd of the Harness plugin, worfy-harness ticket 17), `worfy-canvas`
// for every way of not getting one. With a stand-in runner for each exit code, then with a stub
// `bin/profile` in a temporary Claude home, which must stay as it was, like the Project's folder.
// Last, how the Session factory (src/main/agent/app-registry.ts) hands the list to Claude Code.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import {
  DEFAULT_MCP_SERVERS,
  GITHUB_ACCOUNT_FIELD,
  harnessScriptRunner,
  MCP_ALLOWED_FIELD,
  profileRunner,
  readGithubAccount,
  readMcpAllowlist,
  readResolvedProfile,
  scriptFailureDetail,
  type ProfileRun,
  type ProfileRunner,
} from '../../src/main/workflow/profile'
import { failedLayout, fullLayout, LayoutCache, layoutFailure, readProjectLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { readWorkflow } from '../../src/main/workflow/reader'
import { WorkflowWatcher } from '../../src/main/workflow/watch'
import type { WorkflowDelta } from '../../src/shared/workflow/types'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { ABORTED, hasSh, NODE_DIR, nodeScript, OUT_OF_MEMORY, scriptsEnv } from '../harness-node'
import { removeTestTree } from '../remove'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  query: vi.fn(),
  agentEnv: vi.fn(),
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

let scratch: string
let logged: string[]
const log = (message: string): void => void logged.push(message)

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-profile-'))
  logged = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

/** A runner that answers once with `answer` and records what it was asked. */
function stubRun(answer: ProfileRun | Error): ProfileRunner & { calls: [string, readonly string[]][] } {
  const calls: [string, readonly string[]][] = []
  const run = (cwd: string, args: readonly string[]): Promise<ProfileRun> => {
    calls.push([cwd, args])
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }
  return Object.assign(run, { calls })
}

const enoent = (): Error => Object.assign(new Error('spawn profile ENOENT'), { code: 'ENOENT' })

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The fixture paths are POSIX. A path worfy builds from one — the script under the Claude home, the
// Project root it resolves — is spelled by the rules of the system: the same string on macOS and
// Linux, `\h\bin\profile` and `C:\repo` on Windows. The expectations build it the same way.

/** The reason for a missing profile script under the Claude home `/h`. */
const NO_SCRIPT = new RegExp(`no profile script at ${escapeRegExp(join('/h', 'bin', 'profile'))}`)

/** The start of a `[workflow]` log line for the Project at `root`, resolved as readProjectLayout does. */
const workflowLine = (root: string, text: string): RegExp => new RegExp(`^\\[workflow\\] ${escapeRegExp(resolve(root))}: ${escapeRegExp(text)}`)

describe('readMcpAllowlist with a stand-in runner', () => {
  it('exit code 0 with a list: the Profile list, asked of the Project root', async () => {
    const run = stubRun({ code: 0, stdout: '[\n  "qmd",\n  "github",\n  "qmd"\n]\n', stderr: '' })
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/home/.claude', env: {}, run, log })
    expect(list).toEqual({ servers: ['qmd', 'github'], source: 'profile', reason: null })
    expect(run.calls).toEqual([['/repo', ['-C', '/repo', '--field', MCP_ALLOWED_FIELD]]])
    expect(MCP_ALLOWED_FIELD).toBe('mcp.allowed')
    expect(logged).toEqual([])
  })

  it('exit code 0 with an empty list: no servers, not the default', async () => {
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun({ code: 0, stdout: '[]\n', stderr: '' }), log })
    expect(list).toEqual({ servers: [], source: 'profile', reason: null })
  })

  it.each<[string, ProfileRun | Error, RegExp]>([
    ['exit code 3 (no registered project)', { code: 3, stdout: '', stderr: 'profile: /repo is not in a registered project\n' }, /no registered project.*exit code 3: profile: \/repo is not in a registered project/],
    ['exit code 4 (no such field)', { code: 4, stdout: '', stderr: 'profile: field "mcp.allowed" is absent\n' }, /no mcp\.allowed field \(profile exit code 4\)/],
    ['no script', enoent(), NO_SCRIPT],
    ['broken JSON', { code: 0, stdout: '["qmd", \n', stderr: '' }, /mcp\.allowed is not JSON/],
    ['a field that is null', { code: 0, stdout: 'null\n', stderr: '' }, /mcp\.allowed is null/],
    ['a field that is not a list', { code: 0, stdout: '{"qmd": true}\n', stderr: '' }, /not a list of server names/],
    ['a list with something other than names', { code: 0, stdout: '["qmd", 7, ""]\n', stderr: '' }, /not a list of server names/],
    ['a bare word', { code: 0, stdout: 'qmd\n', stderr: '' }, /mcp\.allowed is not JSON/],
    ['another exit code', { code: 1, stdout: '', stderr: 'registry is broken\n' }, /failed with exit code 1: registry is broken/],
    ['a timeout', { code: null, stdout: '', stderr: '' }, /did not answer within 15 s/],
    ['a script that cannot be started', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), /could not be run: spawn EACCES/],
  ])('%s: the default list plugin_worfy_qmd and worfy-canvas, the reason in the log', async (_case, answer, reason) => {
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer), log })
    expect(list.servers).toEqual(['plugin_worfy_qmd', CANVAS_SERVER_NAME])
    expect(list.source).toBe('default')
    expect(list.reason).toMatch(reason)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^\[profile\] MCP servers for \/repo: the default list \(plugin_worfy_qmd, worfy-canvas\), because /)
    expect(logged[0]).toMatch(reason)
  })

  it('the default list is the plugin qmd and worfy-canvas, without the user qmd, and nobody can change it', () => {
    expect(DEFAULT_MCP_SERVERS).toEqual(['plugin_worfy_qmd', 'worfy-canvas'])
    expect(Object.isFrozen(DEFAULT_MCP_SERVERS)).toBe(true)
  })
})

// ── the real runner against a stub script ─────────────────────────────────────

/** Every path under `dir` with its size, mode, mtime and content hash: equal snapshots mean nothing was written. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    const stat = statSync(path)
    const hash = entry.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'dir'
    out[path.slice(dir.length)] = `${stat.size} ${stat.mode} ${stat.mtimeMs} ${hash}`
  }
  return out
}

/**
 * The login shell environment (src/main/agent/env.ts): its PATH has node. worfy runs the script as
 * `node <script>` with the node of this PATH (src/main/workflow/profile.ts, harnessScriptCommand).
 */
function loginEnv(): Record<string, string> {
  return scriptsEnv([NODE_DIR], { HOME: scratch })
}

/** The environment of an app started from Finder, as far as node goes: a PATH without it. */
function bareEnv(): Record<string, string> {
  const empty = join(scratch, 'no-node-here')
  mkdirSync(empty, { recursive: true })
  return scriptsEnv([empty], { HOME: scratch })
}

/** The line a stand-in logs: its cwd, as `pwd -P` gives it, and its arguments. */
const LOG_LINE = "`${fs.realpathSync(process.cwd())} ${process.argv.slice(2).join(' ')}"

/**
 * A Claude home whose `bin/profile` prints `stdout`, `stderr` and exits with `code`; it logs its
 * cwd and args to a file outside the home. Like the real script, it is run by the node of the PATH
 * it is handed (loginEnv); with a PATH without node it is not run at all.
 */
function stubHome(code: number, stdout: string, stderr = ''): { home: string; calls: string } {
  const home = join(scratch, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  mkdirSync(join(home, 'profiles', 'demo'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'demo', 'profile.json'), '{"name": "demo"}\n')
  const out = join(scratch, 'stdout.txt')
  const calls = join(scratch, 'calls.txt')
  writeFileSync(out, stdout)
  writeFileSync(
    join(home, 'bin', 'profile'),
    nodeScript(
      [
        `fs.appendFileSync(${JSON.stringify(calls)}, ${LOG_LINE}\\n\`)`,
        `process.stdout.write(fs.readFileSync(${JSON.stringify(out)}, 'utf8'))`,
        `process.stderr.write(${JSON.stringify(stderr)})`,
        `process.exitCode = ${code}`,
      ].join('\n'),
    ),
  )
  return { home, calls }
}

/**
 * A Claude home with no Harness of its own and the Harness plugin in <home>/worfy-harness/plugin
 * (worfy-harness ticket 12): its `bin/profile` prints `stdout` and logs its cwd, args and the
 * HARNESS_HOME it got. The Profile is where the plugin keeps it, <harnessHome>/projects/demo.
 */
function pluginHome(stdout: string): { home: string; harnessHome: string; calls: string } {
  const home = join(scratch, 'claude-home')
  const harnessHome = join(home, 'worfy-harness')
  const plugin = join(harnessHome, 'plugin')
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(harnessHome, 'projects', 'demo'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name": "worfy", "version": "0.2.0+abc"}\n')
  writeFileSync(join(harnessHome, 'projects', 'demo', 'profile.json'), '{"name": "demo"}\n')
  writeFileSync(join(plugin, 'bin', 'epic-status'), '#!/bin/sh\n')
  chmodSync(join(plugin, 'bin', 'epic-status'), 0o755)
  const out = join(scratch, 'stdout.txt')
  const calls = join(scratch, 'calls.txt')
  writeFileSync(out, stdout)
  writeFileSync(
    join(plugin, 'bin', 'profile'),
    nodeScript(
      [
        `fs.appendFileSync(${JSON.stringify(calls)}, ${LOG_LINE} HARNESS_HOME=\${process.env.HARNESS_HOME ?? 'unset'}\\n\`)`,
        `process.stdout.write(fs.readFileSync(${JSON.stringify(out)}, 'utf8'))`,
      ].join('\n'),
    ),
  )
  return { home, harnessHome, calls }
}

/** A Project folder with a repository-like tree. */
function projectRoot(): string {
  const root = join(scratch, 'project')
  mkdirSync(join(root, '.claude'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, '.claude', 'settings.json'), '{}\n')
  writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
  return root
}

describe('readMcpAllowlist with the real runner', () => {
  it.each<[string, number, string, string, string[]]>([
    ['code 0 with a list', 0, '[\n  "qmd",\n  "github"\n]\n', '', ['qmd', 'github']],
    ['code 3', 3, '', 'profile: not in a registered project', ['plugin_worfy_qmd', 'worfy-canvas']],
    ['code 4', 4, '', 'profile: field "mcp.allowed" is absent', ['plugin_worfy_qmd', 'worfy-canvas']],
    ['broken JSON', 0, '["qmd"\n', '', ['plugin_worfy_qmd', 'worfy-canvas']],
  ])('%s: runs bin/profile in the Project and writes neither to the Claude home nor to the Project', async (_case, code, stdout, stderr, servers) => {
    const { home, calls } = stubHome(code, stdout, stderr)
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const list = await readMcpAllowlist({ root, claudeHome: home, env: loginEnv(), log })
    expect(list.servers).toEqual(servers)
    expect(readFileSync(calls, 'utf8').trim()).toBe(`${realpathSync(root)} -C ${root} --field mcp.allowed`)
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })

  it('no script in the Claude home: the default list, nothing created there', async () => {
    const home = join(scratch, 'empty-home')
    mkdirSync(home)
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const list = await readMcpAllowlist({ root, claudeHome: home, env: loginEnv(), log })
    expect(list).toMatchObject({ servers: ['plugin_worfy_qmd', 'worfy-canvas'], source: 'default' })
    expect(list.reason).toBe(`there is no profile script at ${join(home, 'bin', 'profile')}`)
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })

  it('the runner resolves any exit code and rejects only a script that cannot be started', async () => {
    const { home } = stubHome(4, '', 'absent')
    const root = projectRoot()
    await expect(profileRunner(home, loginEnv())(root, ['--field', 'x'])).resolves.toMatchObject({ code: 4, stderr: 'absent' })
    await expect(profileRunner(join(scratch, 'nowhere'), loginEnv())(root, [])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // worfy-harness ticket 37, review round 2: a crash by a signal was read as a timeout.
  it('the runner tells its own kill at the time limit from a signal it did not send', async () => {
    const home = join(scratch, 'signal-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    const script = (body: string): void => writeFileSync(join(home, 'bin', 'profile'), nodeScript(body))
    const root = projectRoot()
    // The first start of a new script can take a few hundred ms on macOS: only the slow script gets a short limit.
    const run = (limitMs = 10_000): Promise<ProfileRun> => harnessScriptRunner(home, loginEnv(), 'profile', limitMs)(root, [])
    script('setTimeout(() => undefined, 5000)')
    const slow = await run(1000)
    expect(slow).toMatchObject({ code: null })
    expect(slow.signal ?? null).toBeNull()
    // Windows has no signals a process can send itself: there the kill below ends it with an exit code.
    if (process.platform === 'win32') return
    // writeSync: a write to the stderr pipe is asynchronous on macOS, and the kill would come first.
    script("fs.writeSync(2, 'crashed\\n')\nprocess.kill(process.pid, 'SIGSEGV')")
    expect(await run()).toMatchObject({ code: null, signal: 'SIGSEGV', stderr: 'crashed\n' })
    // The runner's own signal at the limit is SIGTERM: the same signal sent by something else is still a signal.
    script("process.kill(process.pid, 'SIGTERM')")
    expect(await run()).toMatchObject({ code: null, signal: 'SIGTERM' })
  })

  // Review round 3 of PR #311: node's crash report reached the sidebar with the stack's addresses.
  // The reason the sidebar shows (layoutFailure) for a real process.abort(), and for one after
  // node's out-of-memory report: the FATAL ERROR line, no frame.
  it.skipIf(process.platform === 'win32')('a script that aborts: the sidebar names the signal and the FATAL ERROR line, never a frame of the stack', async () => {
    const home = join(scratch, 'abort-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    const root = projectRoot()
    const reasonOf = async (body: string): Promise<string> => {
      writeFileSync(join(home, 'bin', 'profile'), nodeScript(body))
      return layoutFailure(await readProjectLayout({ root, claudeHome: home, env: loginEnv(), log }))
    }
    // A real abort, as the ticket asks: on macOS ReportCrash writes a report to the real ~/Library/Logs/DiagnosticReports, whatever HOME is.
    const SAID = 'worfy could not ask the Harness where the workflow of this Project lives: the profile script was ended by the signal SIGABRT'
    expect(await reasonOf('process.abort()')).toBe(SAID)
    // writeSync: a write to the stderr pipe is asynchronous on macOS, and the abort would come first.
    expect(await reasonOf(`fs.writeSync(2, ${JSON.stringify(OUT_OF_MEMORY)})\nprocess.abort()`)).toBe(`${SAID}: FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`)
  })

  it("runs the script with the environment it is given, not worfy's own: from Finder the system PATH has no node", async () => {
    const { home, calls } = stubHome(0, '["github"]\n')
    const root = projectRoot()
    const withShell = await readMcpAllowlist({ root, claudeHome: home, env: loginEnv(), log })
    expect(withShell).toEqual({ servers: ['github'], source: 'profile', reason: null })
    // The same script with a PATH without node, as an app started from Finder has: not run, though
    // this test process's own PATH has node.
    const bare = await readMcpAllowlist({ root, claudeHome: home, env: bareEnv(), log })
    expect(bare).toMatchObject({ servers: ['plugin_worfy_qmd', 'worfy-canvas'], source: 'default' })
    expect(bare.reason).toBe('the profile script could not be run: node not found in PATH')
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  // worfy-windows ticket 05: the script runs as `node <script>`; a missing file is told before node runs.
  it('a Harness whose profile script is missing: the "no profile script" refusal, not node\'s exit code 1, with or without node', async () => {
    const { home, harnessHome } = pluginHome('[]\n')
    unlinkSync(join(harnessHome, 'plugin', 'bin', 'profile'))
    const root = projectRoot()
    const script = join(harnessHome, 'plugin', 'bin', 'profile')
    for (const env of [loginEnv(), bareEnv()]) {
      const read = await readResolvedProfile({ root, claudeHome: home, env, log })
      expect(read).toEqual({ ok: false, reason: `there is no profile script at ${script}`, miss: 'none' })
      await expect(profileRunner(home, env)(root, [])).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  /**
   * A Claude home whose bin/profile is an older Harness's: a shell script that prints `["github"]`
   * when called as readMcpAllowlist calls it, `-C <root> --field mcp.allowed`; any other arguments
   * fail with exit code 2 and say so, so a start that loses them gets the default list.
   */
  function bashProfileHome(): { home: string; script: string } {
    const home = join(scratch, 'bash-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    const script = join(home, 'bin', 'profile')
    const expected = `[ "$#" -eq 4 ] && [ "$1" = -C ] && [ -n "$2" ] && [ "$3" = --field ] && [ "$4" = ${MCP_ALLOWED_FIELD} ]`
    writeFileSync(script, `#!/bin/sh\nif ! { ${expected}; }; then echo "profile stand-in: unexpected arguments: $*" >&2; exit 2; fi\necho '["github"]'\n`)
    chmodSync(script, 0o755)
    return { home, script }
  }

  // The stand-in itself, run by sh wherever there is one (on Windows, Git Bash's): it answers only
  // to readMcpAllowlist's arguments, so the case below proves they reach the script.
  it.skipIf(!hasSh())("the older Harness's stand-in profile answers only to the arguments worfy passes", () => {
    const { script } = bashProfileHome()
    const run = (args: string[]): ReturnType<typeof spawnSync> => spawnSync('sh', [script, ...args], { encoding: 'utf8' })
    const ok = run(['-C', scratch, '--field', MCP_ALLOWED_FIELD])
    expect(ok.status).toBe(0)
    expect(String(ok.stdout)).toBe('["github"]\n')
    for (const args of [[], ['--field', MCP_ALLOWED_FIELD], ['-C', scratch, '--field', 'github.account'], ['-C', scratch, '--json']]) {
      const refused = run(args)
      expect(refused.status).toBe(2)
      expect(String(refused.stderr)).toContain('profile stand-in: unexpected arguments')
    }
  })

  it.skipIf(process.platform === 'win32')("an older Harness's shell profile is started by itself, not by node, which could not read it", async () => {
    const { home } = bashProfileHome()
    const list = await readMcpAllowlist({ root: projectRoot(), claudeHome: home, env: loginEnv(), log })
    expect(list).toEqual({ servers: ['github'], source: 'profile', reason: null })
  })

  it.skipIf(process.platform !== 'win32')("on Windows an older Harness's shell profile is not run: a failed call that says to update the Harness", async () => {
    const { home, script } = bashProfileHome()
    const read = await readResolvedProfile({ root: projectRoot(), claudeHome: home, env: loginEnv(), log })
    expect(read).toEqual({ ok: false, reason: `the profile script could not be run: this Harness's profile is not a Node script — update the Harness (${script})`, miss: 'failed', environment: false })
  })

  it('no node on the PATH: a failed call that points at the environment, so the login shell is asked again', async () => {
    const { home } = stubHome(0, '{}')
    const read = await readResolvedProfile({ root: projectRoot(), claudeHome: home, env: bareEnv(), log })
    expect(read).toEqual({ ok: false, reason: 'the profile script could not be run: node not found in PATH', miss: 'failed', environment: true })
  })
})

describe('bin/profile of the Harness plugin (worfy-harness ticket 12)', () => {
  it('runs the plugin\'s bin/profile with HARNESS_HOME when only the plugin is there, and writes nothing', async () => {
    const { home, harnessHome, calls } = pluginHome('[\n  "qmd",\n  "github"\n]\n')
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const list = await readMcpAllowlist({ root, claudeHome: home, env: loginEnv(), log })
    expect(list).toEqual({ servers: ['qmd', 'github'], source: 'profile', reason: null })
    expect(readFileSync(calls, 'utf8').trim()).toBe(`${realpathSync(root)} -C ${root} --field mcp.allowed HARNESS_HOME=${harnessHome}`)
    // The login shell environment it was given is kept: the interpreter is still found on its PATH.
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })

  it('reads the GitHub account through the plugin\'s script too', async () => {
    const { home } = pluginHome('IDSAD-XL\n')
    const account = await readGithubAccount({ root: projectRoot(), claudeHome: home, env: loginEnv(), log })
    expect(account).toEqual({ account: 'IDSAD-XL', reason: null })
  })

  it('keeps running <claudeHome>/bin/profile, without HARNESS_HOME, while the old Harness is there next to the plugin', async () => {
    const { calls: pluginCalls } = pluginHome('["from-plugin"]\n')
    const { home, calls } = stubHome(0, '["from-old"]\n')
    writeFileSync(join(home, 'bin', 'epic-status'), '#!/bin/sh\n')
    chmodSync(join(home, 'bin', 'epic-status'), 0o755)
    const list = await readMcpAllowlist({ root: projectRoot(), claudeHome: home, env: loginEnv(), log })
    expect(list.servers).toEqual(['from-old'])
    // stubHome and pluginHome log to the same file: one call, the old script's, with no HARNESS_HOME in it.
    expect(pluginCalls).toBe(calls)
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(readFileSync(calls, 'utf8')).not.toContain('HARNESS_HOME')
  })
})

// ── the GitHub account (worfy-week ticket 01, ADR-0020) ───────────────────────

describe('readGithubAccount', () => {
  it('exit code 0 with a login: the account, asked of the Project root, nothing logged', async () => {
    const run = stubRun({ code: 0, stdout: 'IDSAD-XL\n', stderr: '' })
    expect(await readGithubAccount({ root: '/repo', claudeHome: '/h', env: {}, run, log })).toEqual({ account: 'IDSAD-XL', reason: null })
    expect(run.calls).toEqual([['/repo', ['-C', '/repo', '--field', GITHUB_ACCOUNT_FIELD]]])
    expect(GITHUB_ACCOUNT_FIELD).toBe('github.account')
    expect(logged).toEqual([])
  })

  it('a JSON-quoted login is taken too', async () => {
    const account = await readGithubAccount({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun({ code: 0, stdout: '"IDSAD-XL"\n', stderr: '' }), log })
    expect(account).toEqual({ account: 'IDSAD-XL', reason: null })
  })

  it.each<[string, ProfileRun | Error, RegExp]>([
    ['exit code 3 (no registered project)', { code: 3, stdout: '', stderr: 'profile: /repo is not in a registered project\n' }, /no registered project.*exit code 3: profile: \/repo is not in a registered project/],
    ['exit code 4 (no such field)', { code: 4, stdout: '', stderr: 'profile: field "github.account" is absent\n' }, /no github\.account field \(profile exit code 4\)/],
    ['a field that is null', { code: 0, stdout: 'null\n', stderr: '' }, /github\.account is null/],
    ['no script', enoent(), NO_SCRIPT],
    ['another exit code', { code: 1, stdout: '', stderr: 'registry is broken\n' }, /failed with exit code 1: registry is broken/],
    ['a timeout', { code: null, stdout: '', stderr: '' }, /did not answer within 15 s/],
    ['an empty value', { code: 0, stdout: '\n', stderr: '' }, /github\.account is empty/],
    ['an object', { code: 0, stdout: '{\n  "account": "x"\n}\n', stderr: '' }, /not a GitHub login/],
    ['an option instead of a login', { code: 0, stdout: '--hostname\n', stderr: '' }, /not a GitHub login: "--hostname"/],
    ['two words', { code: 0, stdout: 'IDSAD-XL other\n', stderr: '' }, /not a GitHub login/],
    ['a login too long for GitHub', { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' }, /not a GitHub login/],
  ])('%s: no account, the reason in one log line', async (_case, answer, reason) => {
    const account = await readGithubAccount({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer), log })
    expect(account.account).toBeNull()
    expect(account.reason).toMatch(reason)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^\[profile\] GitHub account for \/repo: none, gh runs with the login shell's own account, because /)
    expect(logged[0]).toMatch(reason)
  })

  it.each<[string, number, string, string, string | null]>([
    ['code 0 with a login', 0, 'IDSAD-XL\n', '', 'IDSAD-XL'],
    ['code 3', 3, '', 'profile: not in a registered project', null],
    ['code 4', 4, '', 'profile: field "github.account" is absent', null],
    ['null', 0, 'null\n', '', null],
  ])('with the real runner, %s: runs bin/profile in the Project and writes neither to the Claude home nor to the Project', async (_case, code, stdout, stderr, expected) => {
    const { home, calls } = stubHome(code, stdout, stderr)
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const account = await readGithubAccount({ root, claudeHome: home, env: loginEnv(), log })
    expect(account.account).toBe(expected)
    expect(readFileSync(calls, 'utf8').trim()).toBe(`${realpathSync(root)} -C ${root} --field github.account`)
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })

  it('with the real runner and no script: no account, nothing created in the Claude home', async () => {
    const home = join(scratch, 'empty-home')
    mkdirSync(home)
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const account = await readGithubAccount({ root, claudeHome: home, env: loginEnv(), log })
    expect(account).toEqual({ account: null, reason: `there is no profile script at ${join(home, 'bin', 'profile')}` })
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })
})

// ── the Session factory ───────────────────────────────────────────────────────

describe('sdkQueryFactory and the Profile list', () => {
  const SDK_QUERY = { kind: 'sdk query' }
  const canvasServer = { type: 'sdk', name: CANVAS_SERVER_NAME }
  const attached: CanvasSession = {
    attachment: { server: canvasServer as never, cardsDir: '/data/p/cards', instructions: 'canvas' },
    observe: (query) => query,
  }
  const request = (cwd: string): QueryRequest => ({
    prompt: (async function* () {})(),
    cwd,
    resume: undefined,
    stderr: () => undefined,
    settings: DEFAULT_SETTINGS,
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
  })
  const sdkOptions = (): Record<string, unknown> => {
    expect(mocks.query).toHaveBeenCalledOnce()
    return (mocks.query.mock.calls[0] as [{ options: Record<string, unknown> }])[0].options
  }

  beforeEach(() => {
    mocks.query.mockReset().mockReturnValue(SDK_QUERY)
    mocks.agentEnv.mockReset().mockResolvedValue({ env: loginEnv(), from: 'login-shell' })
  })

  it("a Session in a Project gets the Profile's list as the MCP policy, read for its cwd", async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    const asked: [string, Record<string, string>][] = []
    const allowlist = (cwd: string, env: Record<string, string>): Promise<readonly string[]> => (asked.push([cwd, env]), Promise.resolve(['qmd']))
    await sdkQueryFactory(() => Promise.resolve(attached), allowlist)(request('/repo/.claude/worktrees/06'))
    const options = sdkOptions()
    // Asked with the login shell environment the Session itself gets (env.ts), not worfy's own.
    expect(asked).toEqual([['/repo/.claude/worktrees/06', loginEnv()]])
    expect(asked[0]?.[1]).toBe(options.env)
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'qmd' }] })
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
  })

  it('a Session outside every Project, or whose canvas failed, does not ask the Profile and keeps the user servers', async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    const allowlist = vi.fn(() => Promise.resolve(['qmd']))
    await sdkQueryFactory(() => Promise.resolve(null), allowlist)(request('/elsewhere'))
    expect(sdkOptions()).not.toHaveProperty('managedSettings')
    mocks.query.mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await sdkQueryFactory(() => Promise.reject(new Error('no store')), allowlist)(request('/repo'))
    warn.mockRestore()
    expect(sdkOptions()).not.toHaveProperty('managedSettings')
    expect(allowlist).not.toHaveBeenCalled()
  })

  it('by default reads the list with <WORFY_CLAUDE_HOME>/bin/profile, run with the login shell environment', async () => {
    const { home } = stubHome(0, '["qmd", "worfy-canvas", "github"]\n')
    const root = projectRoot()
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
    const before = snapshot(home)
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory(() => Promise.resolve(attached))(request(root))
    const options = sdkOptions()
    expect(options.managedSettings).toEqual({
      allowManagedMcpServersOnly: true,
      allowedMcpServers: [{ serverName: 'qmd' }, { serverName: 'worfy-canvas' }, { serverName: 'github' }],
    })
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
    expect(snapshot(home)).toEqual(before)
  })
})

// ── where the workflow lives (worfy-harness ticket 23) ──────────────────────

const SILENT_JSON = {
  name: 'atakama',
  mode: 'silent',
  _resolved: {
    name: 'atakama',
    mode: 'silent',
    workflow_folder: '/work/atakama',
    workspace: '/work/atakama',
    repos: [
      { name: 'api', path: '/work/atakama/api', gate_key: 'api' },
      { name: 'web', path: '/work/atakama/web', gate_key: null },
    ],
  },
}

describe('readResolvedProfile and readProjectLayout with a stand-in runner', () => {
  it('exit code 0 in Silent mode: the Workflow folder, the repositories and the Tickets root of `ticket root`, run in the Project root', async () => {
    const run = stubRun({ code: 0, stdout: `${JSON.stringify(SILENT_JSON)}\n`, stderr: '' })
    const runTicket = stubRun({ code: 0, stdout: '/work/atakama/.scratch\n', stderr: '' })
    const layout = await readProjectLayout({ root: '/work/atakama', claudeHome: '/h', env: {}, run, runTicket, log })
    expect(layout).toEqual({
      // The root is resolved; the paths the Harness printed are kept as printed.
      root: resolve('/work/atakama'),
      mode: 'silent',
      workflowFolder: '/work/atakama',
      ticketsRoot: '/work/atakama/.scratch',
      repos: [
        { name: 'api', path: '/work/atakama/api' },
        { name: 'web', path: '/work/atakama/web' },
      ],
      workspace: '/work/atakama',
      reason: null,
      failed: false,
    })
    expect(run.calls).toEqual([[resolve('/work/atakama'), ['-C', resolve('/work/atakama'), '--json']]])
    expect(runTicket.calls).toEqual([[resolve('/work/atakama'), ['root']]])
    expect(logged).toEqual([])
  })

  it('exit code 0 in Full mode: the Project root as the Workflow folder, whatever spelling of it the Harness printed', async () => {
    const json = { mode: 'full', _resolved: { mode: 'full', workflow_folder: '/private/repo', workspace: null, repos: [{ name: 'repo', path: '/private/repo' }] } }
    const layout = await readProjectLayout({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun({ code: 0, stdout: JSON.stringify(json), stderr: '' }), runTicket: stubRun({ code: 0, stdout: '/private/repo/.scratch\n', stderr: '' }), log })
    expect(layout).toMatchObject({ mode: 'full', workflowFolder: resolve('/repo'), ticketsRoot: '/private/repo/.scratch', repos: [{ name: 'repo', path: '/private/repo' }], reason: null })
  })

  it('carries the names of the document sections the Profile gives, and none of a value that is not a name', async () => {
    const resolved = { mode: 'full', workflow_folder: '/repo', workspace: null, repos: [] }
    const layoutOf = (json: object) =>
      readProjectLayout({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun({ code: 0, stdout: JSON.stringify(json), stderr: '' }), runTicket: stubRun({ code: 0, stdout: '/repo/.scratch\n', stderr: '' }), log })
    const named = await layoutOf({
      mode: 'full',
      tickets: { trail_section: '## Fichiers', done_section: '## Fini quand', manual_mark: 'à la main', path: 'x' },
      docs: { adr_dir: 'docs/adr', adr_status_label: 'Statut' },
      _resolved: resolved,
    })
    expect(named.headings).toEqual({ trailSection: '## Fichiers', doneSection: '## Fini quand', manualMark: 'à la main', adrStatusLabel: 'Statut' })
    // A Harness from before the new fields: the trail section only.
    expect((await layoutOf({ mode: 'full', tickets: { trail_section: '## Files' }, _resolved: resolved })).headings).toEqual({ trailSection: '## Files' })
    // Blank, null, a number, a list: not a name, so the readers take the default for it.
    const wrong = await layoutOf({ mode: 'full', tickets: { trail_section: '  ', done_section: null, manual_mark: 5 }, docs: ['Statut'], _resolved: resolved })
    expect(wrong).not.toHaveProperty('headings')
    expect(await layoutOf({ mode: 'full', tickets: null, docs: null, _resolved: resolved })).not.toHaveProperty('headings')
  })

  // Mac review of PR #489 (worfy-windows ticket 59): the roots above are resolved already, so a
  // readProjectLayout that kept the root as given passed them all.
  it('a root that is not in its resolved form (`..`, a trailing separator): the scripts, the layout and the log line get the resolved root', async () => {
    const given = join('/work', 'atakama', 'sub', '..') + '/'
    const root = resolve(given)
    expect(given).not.toBe(root)
    const json = { mode: 'full', _resolved: { mode: 'full', workflow_folder: '/private/work/atakama', workspace: null, repos: [{ name: 'atakama', path: '/private/work/atakama' }] } }
    const run = stubRun({ code: 0, stdout: JSON.stringify(json), stderr: '' })
    const runTicket = stubRun({ code: 1, stdout: '', stderr: 'usage' })
    const layout = await readProjectLayout({ root: given, claudeHome: '/h', env: {}, run, runTicket, log })
    expect(layout).toMatchObject({ root, mode: 'full', workflowFolder: root, ticketsRoot: join(root, '.scratch') })
    expect(run.calls).toEqual([[root, ['-C', root, '--json']]])
    expect(runTicket.calls).toEqual([[root, ['root']]])
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(workflowLine(given, 'the Tickets are read from'))
    // Without a Profile too: the Full layout of the resolved root.
    const none = await readProjectLayout({ root: given, claudeHome: '/h', env: {}, run: stubRun({ code: 3, stdout: '', stderr: '' }), log })
    expect(none).toMatchObject({ root, workflowFolder: root, ticketsRoot: join(root, '.scratch'), failed: false })
  })

  it.each<[string, ProfileRun, RegExp]>([
    ['exit code 1', { code: 1, stdout: '', stderr: 'usage' }, /ticket root failed with exit code 1: usage/],
    ['a timeout', { code: null, stdout: '', stderr: '' }, /ticket root failed with a timeout/],
    ['a signal', { code: null, signal: 'SIGSEGV', stdout: '', stderr: '' }, /ticket root failed with the signal SIGSEGV/],
  ])('`ticket root` failing (%s): the Tickets root is .scratch of the Workflow folder, and the reason is logged', async (_case, answer, reason) => {
    const layout = await readProjectLayout({ root: '/work/atakama', claudeHome: '/h', env: {}, run: stubRun({ code: 0, stdout: JSON.stringify(SILENT_JSON), stderr: '' }), runTicket: stubRun(answer), log })
    // `.scratch` joined to the Workflow folder as the Harness printed it, by the rules of the system.
    expect(layout).toMatchObject({ mode: 'silent', ticketsRoot: join('/work/atakama', '.scratch'), reason: null })
    expect(logged.join('\n')).toMatch(reason)
  })

  // No Profile: the folder is read as before Silent mode (worfy-harness ticket 37, "no Profile").
  it.each<[string, ProfileRun | Error, RegExp]>([
    ['exit code 3', { code: 3, stdout: '', stderr: 'profile: /repo is not in a registered project\n' }, /no registered project.*exit code 3/],
    ['no script', enoent(), NO_SCRIPT],
    ['a Harness before Silent mode: no _resolved.mode', { code: 0, stdout: JSON.stringify({ name: 'demo', _resolved: { name: 'demo', repo_root: '/repo' } }), stderr: '' }, /no _resolved\.mode/],
  ])('no Profile — %s: Full mode, the Project root, one repository, <root>/.scratch — and `ticket root` is not run', async (_case, answer, reason) => {
    const runTicket = stubRun({ code: 0, stdout: '/elsewhere\n', stderr: '' })
    const layout = await readProjectLayout({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer), runTicket, log })
    expect({ ...layout, reason: null }).toEqual(fullLayout('/repo'))
    expect(layout.failed).toBe(false)
    expect(layout.reason).toMatch(reason)
    expect(runTicket.calls).toEqual([])
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(workflowLine('/repo', 'Full mode'))
    const resolved = await readResolvedProfile({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer) })
    expect(resolved).toEqual({ ok: false, miss: 'none', reason: expect.stringMatching(reason) })
  })

  // A failed call: the mode is unknown, nothing is guessed (worfy-harness ticket 37, "the call failed").
  // The last column: whether the failure points at the scripts' environment, so the watcher takes
  // the login shell again before it asks once more.
  const CRASH = '/h/bin/profile.js:12\n    throw new TypeError(\'boom\')\n    ^\n\nTypeError: boom\n    at main (/h/bin/profile.js:12:11)\n    at Object.<anonymous> (/h/bin/profile.js:20:1) {\n  code: \'ERR_BOOM\'\n}\n\nNode.js v24.19.0\n'
  it.each<[string, ProfileRun | Error, RegExp, boolean]>([
    ['exit code 127: the script finds no node', { code: 127, stdout: '', stderr: 'env: node: No such file or directory\n' }, /failed with exit code 127: env: node: No such file or directory$/, true],
    ['exit code 126: node cannot be run', { code: 126, stdout: '', stderr: 'env: node: Permission denied\n' }, /failed with exit code 126: env: node: Permission denied$/, true],
    ['exit code 1: a broken registry', { code: 1, stdout: '', stderr: 'registry is broken\n' }, /failed with exit code 1: registry is broken$/, false],
    ['exit code 1: a crash of the script — its Error line, not the stack nor the node version', { code: 1, stdout: '', stderr: CRASH }, /failed with exit code 1: TypeError: boom$/, false],
    ['exit code 4 on --json', { code: 4, stdout: '', stderr: '' }, /exit code 4/, false],
    ['a timeout, with its limit', { code: null, stdout: '', stderr: '' }, /^the profile script did not answer within 15 s$/, false],
    // A signal the runner did not send: a crash, not a slow machine, and no time limit is named.
    ['a signal', { code: null, signal: 'SIGSEGV', stdout: '', stderr: 'Segmentation fault\n' }, /^the profile script was ended by the signal SIGSEGV: Segmentation fault$/, false],
    // A file problem (no execute bit, output over the size cap): a new login shell cannot fix it.
    ['a script that cannot be started', Object.assign(new Error('spawn profile EACCES'), { code: 'EACCES' }), /could not be run: spawn profile EACCES/, false],
    ['output over the size cap', Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), /could not be run: stdout maxBuffer length exceeded/, false],
    ['output that is not JSON', { code: 0, stdout: 'name: demo\n', stderr: '' }, /not JSON/, false],
    ['JSON null', { code: 0, stdout: 'null\n', stderr: '' }, /printed no object: "null"/, false],
    ['a JSON list', { code: 0, stdout: '[]\n', stderr: '' }, /printed no object: "\[\]"/, false],
    ['a JSON string', { code: 0, stdout: '"text"\n', stderr: '' }, /printed no object/, false],
    ['_resolved: null', { code: 0, stdout: JSON.stringify({ _resolved: null }), stderr: '' }, /expected _resolved fields: _resolved/, false],
    // A list has no `mode` either, but it is not a Harness from before Silent mode: that one has no `_resolved` or an object.
    ['_resolved: []', { code: 0, stdout: JSON.stringify({ _resolved: [] }), stderr: '' }, /expected _resolved fields: _resolved/, false],
    ['_resolved without workflow_folder', { code: 0, stdout: JSON.stringify({ _resolved: { mode: 'silent', repos: [] } }), stderr: '' }, /workflow_folder/, false],
    ['a relative workflow_folder', { code: 0, stdout: JSON.stringify({ _resolved: { mode: 'silent', workflow_folder: 'wf', repos: [] } }), stderr: '' }, /workflow_folder/, false],
    ['an unknown mode', { code: 0, stdout: JSON.stringify({ _resolved: { mode: 'quiet', workflow_folder: '/wf', repos: [] } }), stderr: '' }, /mode/, false],
  ])('a failed call — %s: the layout is marked failed with the reason, and `ticket root` is not run', async (_case, answer, reason, environment) => {
    const runTicket = stubRun({ code: 0, stdout: '/elsewhere\n', stderr: '' })
    const layout = await readProjectLayout({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer), runTicket, log })
    expect(layout).toEqual(failedLayout('/repo', layout.reason ?? '', environment))
    expect(layout.failed).toBe(true)
    expect(layout.environmentFailure).toBe(environment)
    expect(layout.reason).toMatch(reason)
    expect(layout.reason).not.toMatch(/Node\.js v|\n/)
    expect(runTicket.calls).toEqual([])
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(workflowLine('/repo', 'the workflow is not read, because '))
    const resolved = await readResolvedProfile({ root: '/repo', claudeHome: '/h', env: {}, run: stubRun(answer) })
    expect(resolved).toEqual({ ok: false, miss: 'failed', reason: expect.stringMatching(reason), environment })
  })

  it('the window shows the first lines of a long reason, not all of it', () => {
    const long = failedLayout('/repo', ['one', 'two', 'three', 'four', 'five'].join('\n'))
    expect(layoutFailure(long)).toBe('worfy could not ask the Harness where the workflow of this Project lives: one\ntwo\nthree\n…')
    expect(layoutFailure(failedLayout('/repo', 'one line'))).toBe('worfy could not ask the Harness where the workflow of this Project lives: one line')
  })

  it('the cache reads a Project once per interval and again after it', async () => {
    let now = 0
    let runs = 0
    const home = join(scratch, 'cache-home')
    mkdirSync(join(home, 'bin'), { recursive: true })
    const cache = new LayoutCache({ claudeHome: () => home, env: () => Promise.resolve({}), ttlMs: 1000, now: () => now })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => void (runs += 1))
    const first = await cache.get('/nowhere/repo')
    expect(await cache.get('/nowhere/repo')).toBe(first)
    now = 1500
    expect(await cache.get('/nowhere/repo')).not.toBe(first)
    expect(first).toMatchObject({ mode: 'full', root: resolve('/nowhere/repo') })
    // The fallback reason (no script) is logged once for the Project, not on every read.
    expect(runs).toBe(1)
    warn.mockRestore()
  })
})

describe('readProjectLayout with the real scripts', () => {
  it('runs bin/profile --json and bin/ticket root of the Claude home in the Project root, and writes nowhere', async () => {
    const root = projectRoot()
    const folder = join(scratch, 'workflow')
    mkdirSync(join(folder, '.scratch'), { recursive: true })
    const json = { mode: 'silent', _resolved: { mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'project', path: root }] } }
    const { home, calls } = stubHome(0, JSON.stringify(json))
    const ticketCalls = join(scratch, 'ticket-calls.txt')
    writeFileSync(
      join(home, 'bin', 'ticket'),
      nodeScript([`fs.appendFileSync(${JSON.stringify(ticketCalls)}, ${LOG_LINE}\\n\`)`, `process.stdout.write(${JSON.stringify(`${join(folder, '.scratch')}\n`)})`].join('\n')),
    )
    const before = { home: snapshot(home), root: snapshot(root), folder: snapshot(folder) }

    const layout = await readProjectLayout({ root, claudeHome: home, env: loginEnv(), log })
    expect(layout).toEqual({ root, mode: 'silent', workflowFolder: folder, ticketsRoot: join(folder, '.scratch'), repos: [{ name: 'project', path: root }], workspace: null, reason: null, failed: false })
    expect(readFileSync(calls, 'utf8').trim()).toBe(`${realpathSync(root)} -C ${root} --json`)
    expect(readFileSync(ticketCalls, 'utf8').trim()).toBe(`${realpathSync(root)} root`)
    expect({ home: snapshot(home), root: snapshot(root), folder: snapshot(folder) }).toEqual(before)
  })
})

// worfy-harness ticket 37: a failed `profile` call reaches the window as the model's error, through
// the same path as a failed `epic-status`, and goes away without a restart once the cause is gone.
describe('a failed profile call in the workflow model', () => {
  const EPIC_JSON = JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] })

  it('readWorkflow: no node on the PATH of the environment — an empty model with the reason, and epic-status is not run', async () => {
    const root = projectRoot()
    const { home } = stubHome(0, JSON.stringify({ _resolved: { mode: 'full', workflow_folder: root, repos: [] } }))
    const runs: string[] = []
    const run = (cwd: string): Promise<string> => (runs.push(cwd), Promise.resolve(EPIC_JSON))
    // A PATH without node, as worfy from Finder has.
    const env = (): Promise<Record<string, string>> => Promise.resolve(bareEnv())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { model } = await readWorkflow({ root, claudeHome: home, env }, run)
    warn.mockRestore()
    expect(model).toMatchObject({ root, epics: [], tickets: [], branchErrors: [] })
    expect(model.error?.code).toBe('failed')
    expect(model.error?.message).toMatch(/^worfy could not ask the Harness where the workflow of this Project lives: the profile script could not be run: node not found in PATH/)
    expect(runs).toEqual([])
  })

  it('the watcher shows the reason, asks the layout again and reads the Epics once it answers, without a restart', async () => {
    const root = projectRoot()
    let answers = 0
    let cured = false
    const layout = (at: string): Promise<ProjectLayout> => {
      answers += 1
      return Promise.resolve(cured ? { ...fullLayout(at), mode: 'silent', ticketsRoot: join(at, '.scratch') } : failedLayout(at, 'the profile script failed with exit code 127: env: node: No such file or directory'))
    }
    const runs: string[] = []
    const run = (cwd: string): Promise<string> => (runs.push(cwd), Promise.resolve(EPIC_JSON))
    const changes: WorkflowDelta[] = []
    const watcher = await WorkflowWatcher.start({ root, claudeHome: '/h', env: () => Promise.resolve({}), run, layout, layoutRetryMs: 50, ticketsWatch: 'chokidar', onChange: (delta) => changes.push(delta) })
    try {
      expect(watcher.current.error?.message).toMatch(/where the workflow of this Project lives: .*exit code 127: env: node/)
      expect(watcher.current.epics).toEqual([])
      expect(runs).toEqual([])
      // Still failing: asked again, the same reason, nothing sent.
      await vi.waitFor(() => expect(answers).toBeGreaterThanOrEqual(3), { timeout: 5000 })
      expect(changes).toEqual([])
      cured = true
      await vi.waitFor(() => expect(watcher.current.epics.map((epic) => epic.epic)).toEqual(['demo']), { timeout: 5000 })
      expect(watcher.current.error).toBeNull()
      expect(runs.length).toBeGreaterThan(0)
      expect(changes.at(-1)).toMatchObject({ error: null })
      // Answered: no more retries.
      const settled = answers
      await new Promise((done) => setTimeout(done, 200))
      expect(answers).toBe(settled)
    } finally {
      await watcher.close()
    }
  })

  it('close stops the retries of a failed layout', async () => {
    const root = projectRoot()
    let answers = 0
    const layout = (at: string): Promise<ProjectLayout> => ((answers += 1), Promise.resolve(failedLayout(at, 'timed out')))
    const watcher = await WorkflowWatcher.start({ root, claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout, layoutRetryMs: 30, ticketsWatch: 'chokidar', onChange: () => undefined })
    await watcher.close()
    const closedAt = answers
    await new Promise((done) => setTimeout(done, 150))
    expect(answers).toBe(closedAt)
  })
})

// What a failed Harness script's stderr gives the window (worfy-harness ticket 37): its Error line
// when it crashed, else its first lines; never the stack, nor node's version line, nor a whole log.
describe('scriptFailureDetail', () => {
  it('stderr without an Error line: its first three lines, joined with " — "', () => {
    expect(scriptFailureDetail('one\ntwo\nthree\nfour\nfive\n')).toBe('one — two — three')
    expect(scriptFailureDetail('one\r\ntwo\r\n')).toBe('one — two')
  })

  it('stack lines, the caret line, blank lines and the `Node.js vNN` line are left out before the lines are counted', () => {
    const stderr = 'warning: registry is old\n    at load (/h/bin/profile.js:3:1)\n    at main (/h/bin/profile.js:9:2)\n\n  ^^^\nNode.js v24.19.0\nsecond line\nthird line\nfourth line\n'
    expect(scriptFailureDetail(stderr)).toBe('warning: registry is old — second line — third line')
    expect(scriptFailureDetail('Node.js v24.19.0\n    at x (y.js:1:1)\n')).toBe('')
    // Only a line that starts with "at " and a space is a stack line; text that starts with "at" is kept.
    expect(scriptFailureDetail('atlas: not found\n')).toBe('atlas: not found')
  })

  it('an Error line wins over the lines before it', () => {
    expect(scriptFailureDetail('/h/bin/profile.js:12\n    throw new TypeError("boom")\n    ^\n\nTypeError: boom\n    at main (/h/bin/profile.js:12:11)\n\nNode.js v24.19.0\n')).toBe('TypeError: boom')
  })

  // Review round 3 of PR #311: node's own crash report reached the window — the native stack's
  // addresses, the GC block — and its FATAL ERROR line was not taken for the error line.
  it("node's crash report: the FATAL ERROR line; without one, nothing of the GC block or of either stack", () => {
    expect(scriptFailureDetail(OUT_OF_MEMORY)).toBe('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory')
    // The FATAL ERROR line wins over what the script printed before it, as an Error line does.
    expect(scriptFailureDetail(`profile: reading the registry\n${OUT_OF_MEMORY}`)).toBe('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory')
    expect(scriptFailureDetail(ABORTED)).toBe('')
    // A GC block and frames with no FATAL ERROR line: nothing of them.
    expect(scriptFailureDetail(OUT_OF_MEMORY.replace(/^FATAL ERROR:.*$/m, ''))).toBe('')
    // Only a number, a colon and a space start a frame: a line that starts with a number is kept.
    expect(scriptFailureDetail('2 Epics are broken\n')).toBe('2 Epics are broken')
    // Frames are dropped, what follows them is kept.
    expect(scriptFailureDetail(`${ABORTED}registry is broken\n`)).toBe('registry is broken')
  })

  it('at most 400 characters, then "…"', () => {
    expect(scriptFailureDetail('x'.repeat(400))).toBe('x'.repeat(400))
    expect(scriptFailureDetail('x'.repeat(401))).toBe(`${'x'.repeat(400)}…`)
    // The cap holds for the joined lines too, and for an Error line.
    expect(scriptFailureDetail(`${'a'.repeat(300)}\n${'b'.repeat(300)}\n`)).toBe(`${'a'.repeat(300)} — ${'b'.repeat(97)}…`)
    expect(scriptFailureDetail(`Error: ${'e'.repeat(500)}\n`)).toBe(`Error: ${'e'.repeat(393)}…`)
  })

  // Mac review of PR #482 (worfy-windows ticket 59): bin/profile wraps the gate resolver's reason in
  // a line with the resolver's path, and with two long paths the cap cut the line before the reason.
  // Every caller — the profile reads, `ticket root`, the first-run check — gets the reason itself.
  it('a gate resolver reason wrapped by bin/profile: the reason itself, whatever the length of the paths', () => {
    const long = `/Users/someone/${'very-long-folder-name/'.repeat(12)}`
    const reason = `registry ${long}gate/config.json is broken: the "repos" field must be an array`
    const stderr = `profile: resolver ${long}plugin/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: ${reason}\n`
    expect(stderr.length).toBeGreaterThan(400)
    expect(scriptFailureDetail(stderr)).toBe(reason)
    expect(scriptFailureDetail(`gate-resolve: ${reason}\n`)).toBe(reason)
    // A crash of the resolver keeps its wrapping: it says where it crashed.
    const crash = 'profile: resolver /h/r.mjs failed (exit 1) — project not determined: TypeError: boom\n'
    expect(scriptFailureDetail(crash)).toBe(crash.trim())
    // A resolver ended by a signal has no exit status: bin/profile says `exit null`, and the reason is unwrapped too.
    expect(scriptFailureDetail(`profile: resolver ${long}gate-resolve.mjs failed (exit null) — project not determined: gate-resolve: ${reason}\n`)).toBe(reason)
  })

  it('a profile read that fails with such a reason names it', async () => {
    const long = `/Users/someone/${'very-long-folder-name/'.repeat(12)}`
    const reason = `registry ${long}gate/config.json is broken: the "repos" field must be an array`
    const run: ProfileRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: `profile: resolver ${long}plugin/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: ${reason}\n` })
    const layout = await readProjectLayout({ root: '/work/shop', claudeHome: '/nowhere/.claude', env: {}, run, log: () => undefined })
    expect(layout.failed).toBe(true)
    expect(layout.reason).toContain(reason)
  })
})
