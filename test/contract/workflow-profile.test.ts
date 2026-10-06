// The Profile reader (src/main/workflow/profile.ts, worfy-daily ticket 06, ADR-0021): the list of
// MCP servers from `bin/profile --field mcp.allowed`, and the default list `qmd`, `worfy-canvas`
// for every way of not getting one. With a stand-in runner for each exit code, then with a stub
// `bin/profile` in a temporary Claude home, which must stay as it was, like the Project's folder.
// Last, how the Session factory (src/main/agent/app-registry.ts) hands the list to Claude Code.
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import { DEFAULT_MCP_SERVERS, MCP_ALLOWED_FIELD, profileRunner, readMcpAllowlist, type ProfileRun, type ProfileRunner } from '../../src/main/workflow/profile'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'

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
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

describe('readMcpAllowlist with a stand-in runner', () => {
  it('exit code 0 with a list: the Profile list, asked of the Project root', async () => {
    const run = stubRun({ code: 0, stdout: '[\n  "qmd",\n  "github",\n  "qmd"\n]\n', stderr: '' })
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/home/.claude', run, log })
    expect(list).toEqual({ servers: ['qmd', 'github'], source: 'profile', reason: null })
    expect(run.calls).toEqual([['/repo', ['-C', '/repo', '--field', MCP_ALLOWED_FIELD]]])
    expect(MCP_ALLOWED_FIELD).toBe('mcp.allowed')
    expect(logged).toEqual([])
  })

  it('exit code 0 with an empty list: no servers, not the default', async () => {
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/h', run: stubRun({ code: 0, stdout: '[]\n', stderr: '' }), log })
    expect(list).toEqual({ servers: [], source: 'profile', reason: null })
  })

  it.each<[string, ProfileRun | Error, RegExp]>([
    ['exit code 3 (no registered project)', { code: 3, stdout: '', stderr: 'profile: /repo is not in a registered project\n' }, /no registered project.*exit code 3: profile: \/repo is not in a registered project/],
    ['exit code 4 (no such field)', { code: 4, stdout: '', stderr: 'profile: field "mcp.allowed" is absent\n' }, /no mcp\.allowed field \(profile exit code 4\)/],
    ['no script', enoent(), /no profile script at \/h\/bin\/profile/],
    ['broken JSON', { code: 0, stdout: '["qmd", \n', stderr: '' }, /mcp\.allowed is not JSON/],
    ['a field that is null', { code: 0, stdout: 'null\n', stderr: '' }, /mcp\.allowed is null/],
    ['a field that is not a list', { code: 0, stdout: '{"qmd": true}\n', stderr: '' }, /not a list of server names/],
    ['a list with something other than names', { code: 0, stdout: '["qmd", 7, ""]\n', stderr: '' }, /not a list of server names/],
    ['a bare word', { code: 0, stdout: 'qmd\n', stderr: '' }, /mcp\.allowed is not JSON/],
    ['another exit code', { code: 1, stdout: '', stderr: 'registry is broken\n' }, /failed with exit code 1: registry is broken/],
    ['a timeout', { code: null, stdout: '', stderr: '' }, /timed out/],
    ['a script that cannot be started', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), /could not be run: spawn EACCES/],
  ])('%s: the default list qmd and worfy-canvas, the reason in the log', async (_case, answer, reason) => {
    const list = await readMcpAllowlist({ root: '/repo', claudeHome: '/h', run: stubRun(answer), log })
    expect(list.servers).toEqual(['qmd', CANVAS_SERVER_NAME])
    expect(list.source).toBe('default')
    expect(list.reason).toMatch(reason)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^\[profile\] MCP servers for \/repo: the default list \(qmd, worfy-canvas\), because /)
    expect(logged[0]).toMatch(reason)
  })

  it('the default list is qmd and worfy-canvas, and nobody can change it', () => {
    expect(DEFAULT_MCP_SERVERS).toEqual(['qmd', 'worfy-canvas'])
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

/** A Claude home whose `bin/profile` prints `stdout`, `stderr` and exits with `code`; it logs its cwd and args to a file outside the home. */
function stubHome(code: number, stdout: string, stderr = ''): { home: string; calls: string } {
  const home = join(scratch, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  mkdirSync(join(home, 'profiles', 'demo'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'demo', 'profile.json'), '{"name": "demo"}\n')
  const out = join(scratch, 'stdout.txt')
  const calls = join(scratch, 'calls.txt')
  writeFileSync(out, stdout)
  writeFileSync(join(home, 'bin', 'profile'), `#!/bin/sh\necho "$(pwd -P) $*" >> '${calls}'\ncat '${out}'\nprintf '%s' '${stderr}' >&2\nexit ${code}\n`)
  chmodSync(join(home, 'bin', 'profile'), 0o755)
  return { home, calls }
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
    ['code 3', 3, '', 'profile: not in a registered project', ['qmd', 'worfy-canvas']],
    ['code 4', 4, '', 'profile: field "mcp.allowed" is absent', ['qmd', 'worfy-canvas']],
    ['broken JSON', 0, '["qmd"\n', '', ['qmd', 'worfy-canvas']],
  ])('%s: runs bin/profile in the Project and writes neither to the Claude home nor to the Project', async (_case, code, stdout, stderr, servers) => {
    const { home, calls } = stubHome(code, stdout, stderr)
    const root = projectRoot()
    const before = { home: snapshot(home), root: snapshot(root) }
    const list = await readMcpAllowlist({ root, claudeHome: home, log })
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
    const list = await readMcpAllowlist({ root, claudeHome: home, log })
    expect(list).toMatchObject({ servers: ['qmd', 'worfy-canvas'], source: 'default' })
    expect(list.reason).toBe(`there is no profile script at ${join(home, 'bin', 'profile')}`)
    expect(snapshot(home)).toEqual(before.home)
    expect(snapshot(root)).toEqual(before.root)
  })

  it('the runner resolves any exit code and rejects only a script that cannot be started', async () => {
    const { home } = stubHome(4, '', 'absent')
    const root = projectRoot()
    await expect(profileRunner(home)(root, ['--field', 'x'])).resolves.toMatchObject({ code: 4, stderr: 'absent' })
    await expect(profileRunner(join(scratch, 'nowhere'))(root, [])).rejects.toMatchObject({ code: 'ENOENT' })
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
    mocks.agentEnv.mockReset().mockResolvedValue({ env: { PATH: '/usr/bin' }, from: 'login-shell' })
  })

  it("a Session in a Project gets the Profile's list as the MCP policy, read for its cwd", async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    const asked: string[] = []
    const allowlist = (cwd: string): Promise<readonly string[]> => (asked.push(cwd), Promise.resolve(['qmd']))
    await sdkQueryFactory(() => Promise.resolve(attached), allowlist)(request('/repo/.claude/worktrees/06'))
    const options = sdkOptions()
    expect(asked).toEqual(['/repo/.claude/worktrees/06'])
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

  it('by default reads the list with <WORFY_CLAUDE_HOME>/bin/profile', async () => {
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
