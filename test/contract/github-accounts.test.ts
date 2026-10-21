// The GitHub account step of "Add project" (worfy-harness ticket 25, src/main/github/accounts.ts):
// the accounts of `gh auth status --json hosts` for the hosts of the folder's origins, the write
// access of each to every repository, the account chosen by default, and what never happens — a
// gh command that signs in, switches, logs out or configures, or a token in an answer or a log.
// Real git repositories in a temporary folder; gh is the stand-in of test/fixtures/gh (GH_STUB_DIR,
// GH_STUB_LOG), never the machine's own.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findOnPath } from '../../src/main/agent/env'
import { parseAuthStatus, parseRemote, readGithubAccounts, signInCommand, signInRegistry, type FolderRepo } from '../../src/main/github/accounts'
import { ghRunner } from '../../src/main/github/prs'
import { runGit } from '../../src/main/projects/store'
import { githubAccountsStepSchema, githubChoice, withGithubAccount, type GithubAccountsStep, type ProfileDraft } from '../../src/shared/ipc/projects'
import { authStatus, ghWorld, STUB_COMMAND, type GhWorld, type StubAccount, type StubRepos } from './gh-world'
import { removeTestTree } from '../remove'

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** A repository named `name` with `origin` (none when null). */
function repo(name: string, origin: string | null, parent = scratch): FolderRepo {
  const path = join(parent, name)
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  if (origin !== null) git(path, 'remote', 'add', 'origin', origin)
  return { name, path: realpathSync(path) }
}

const ALICE: StubAccount = { login: 'alice', active: true, token: 'gho_alice_SECRET_0001' }
const BOB: StubAccount = { login: 'bob', token: 'gho_bob_SECRET_0002' }

function world(accounts: readonly StubAccount[], repos: StubRepos = {}): GhWorld {
  return ghWorld(join(scratch, 'gh'), { accounts, repos })
}

const read = (repos: readonly FolderRepo[], gh: GhWorld): Promise<GithubAccountsStep> => readGithubAccounts(repos, { git: runGit, gh: gh.run })

/** The commands worfy may run for the step: read the accounts, take a token, read a repository. */
const ALLOWED = (call: readonly string[]): boolean =>
  (call[0] === 'auth' && call[1] === 'status' && call.includes('--json') && call[call.indexOf('--json') + 1] === 'hosts' && !call.includes('--show-token')) ||
  (call[0] === 'auth' && call[1] === 'token' && call[2] === '-u' && typeof call[3] === 'string') ||
  (call[0] === 'api' && /^repos\/[^/]+\/[^/]+$/.test(call[1] ?? ''))

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-gh-accounts-')))
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(scratch)
})

describe('the accounts of gh auth status --json hosts', () => {
  it('lists the accounts of the origin host with the active one; another host is left out', async () => {
    const gh = world([ALICE, BOB, { login: 'corp', host: 'ghe.example.com', active: true, token: 'gho_corp_SECRET_0003' }], { 'acme/shop': { alice: true, bob: true } })
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], gh)
    expect(step).toMatchObject({
      status: 'accounts',
      repos: [{ name: 'shop', host: 'github.com', slug: 'acme/shop' }],
      skipped: [],
      accounts: [
        { login: 'alice', host: 'github.com', active: true, state: 'success' },
        { login: 'bob', host: 'github.com', active: false, state: 'success' },
      ],
    })
  })

  it('a host without accounts: an empty list and nothing chosen', async () => {
    const gh = world([])
    const step = await read([repo('shop', 'git@github.com:acme/shop.git')], gh)
    expect(step).toEqual({ status: 'accounts', repos: [{ name: 'shop', host: 'github.com', slug: 'acme/shop' }], skipped: [], accounts: [], selected: null })
    expect(githubChoice(step, null)).toEqual({ account: null, finish: 'local-green' })
  })

  it('parses gh 2.97 output, keeps gh state words and skips entries it cannot read', () => {
    const status = authStatus([ALICE, { ...BOB, state: 'error' }])
    ;(status.hosts['github.com'] as unknown[]).push({ host: 'github.com' }, 'junk')
    expect(parseAuthStatus(JSON.stringify(status))).toEqual([
      { login: 'alice', host: 'github.com', active: true, state: 'success' },
      { login: 'bob', host: 'github.com', active: false, state: 'error' },
    ])
    expect(parseAuthStatus('{"hosts":{}}')).toEqual([])
    expect(() => parseAuthStatus('not json')).toThrow('printed no JSON')
  })

  it('reads remotes in https, ssh and scp form; other shapes are no GitHub repository', () => {
    expect(parseRemote('https://github.com/acme/shop.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' })
    expect(parseRemote('https://x-access:pw@GitHub.com/acme/shop/')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' })
    expect(parseRemote('git@github.com:acme/shop.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' })
    expect(parseRemote('ssh://git@github.com:22/acme/shop.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' })
    expect(parseRemote('/srv/git/shop.git')).toBeNull()
    expect(parseRemote('https://gitlab.com/group/sub/shop.git')).toBeNull()
    expect(parseRemote('file:///srv/acme/shop')).toBeNull()
  })
})

describe('write access to origin and the finish', () => {
  it('push true is pr-green-ci; false, 403 and 404 are local-green with the reason naming the repository', async () => {
    const accounts = ['yes', 'no', 'forbidden', 'unseen'].map((login) => ({ login, token: `gho_${login}_SECRET` }))
    const gh = world(accounts, { 'acme/shop': { yes: true, no: false, forbidden: 403 } })
    const step = await read([repo('shop', 'https://github.com/acme/shop')], gh)
    if (step.status !== 'accounts') throw new Error(JSON.stringify(step))
    const by = Object.fromEntries(step.accounts.map((account) => [account.login, account]))
    expect(by.yes).toMatchObject({ push: true, finish: 'pr-green-ci', reason: null })
    expect(by.no).toMatchObject({ push: false, finish: 'local-green', reason: 'no has no write access to acme/shop: Tickets will close with the local finish.' })
    expect(by.forbidden).toMatchObject({ push: false, finish: 'local-green' })
    expect(by.forbidden?.reason).toContain('acme/shop (gh: Resource not accessible by personal access token (HTTP 403))')
    expect(by.unseen?.reason).toContain('acme/shop (gh: Not Found (HTTP 404))')
    for (const login of ['no', 'forbidden', 'unseen']) expect(githubChoice(step, login)).toEqual({ account: login, finish: 'local-green' })
    expect(githubChoice(step, 'yes')).toEqual({ account: 'yes', finish: 'pr-green-ci' })
  })

  it('without origin: no account and the local finish, gh not run', async () => {
    const gh = world([ALICE])
    const step = await read([repo('shop', null)], gh)
    expect(step).toEqual({ status: 'no-origin', reason: 'No GitHub origin: shop has no origin remote.' })
    const draft: ProfileDraft = { profile: { name: 'shop', github: { account: 'stale' }, workflow: { finish: 'pr-green-ci', folder: null } }, rules: '', gate: [] }
    expect(withGithubAccount(draft, githubChoice(step, 'alice')).profile).toEqual({ name: 'shop', github: { account: null }, workflow: { finish: 'local-green', folder: null } })
    expect(gh.calls()).toEqual([])
  })

  it('an origin on a host gh does not know is no GitHub origin', async () => {
    const gh = world([ALICE])
    expect(await read([repo('shop', 'https://gitlab.com/acme/shop.git')], gh)).toEqual({ status: 'no-origin', reason: 'No GitHub origin: the origin is not on a GitHub host (shop: gitlab.com).' })
  })

  it('a folder above two repositories: pr-green-ci only with access to both; the one without is named; a repository without origin is skipped', async () => {
    const workspace = join(scratch, 'ws')
    const repos = [repo('api', 'https://github.com/acme/api.git', workspace), repo('docs', null, workspace), repo('web', 'git@github.com:acme/web.git', workspace)]
    const gh = world([ALICE, BOB], { 'acme/api': { alice: true, bob: true }, 'acme/web': { alice: true, bob: false } })
    const step = await read(repos, gh)
    if (step.status !== 'accounts') throw new Error(JSON.stringify(step))
    expect(step.skipped).toEqual(['docs'])
    expect(step.repos.map((each) => each.slug)).toEqual(['acme/api', 'acme/web'])
    expect(step.accounts.find((account) => account.login === 'alice')).toMatchObject({ push: true, finish: 'pr-green-ci' })
    const bob = step.accounts.find((account) => account.login === 'bob')
    expect(bob).toMatchObject({ push: false, finish: 'local-green', reason: 'bob has no write access to acme/web: Tickets will close with the local finish.' })
    expect(bob?.reason).not.toContain('acme/api')
  })
})

describe('the account chosen by default', () => {
  it('the active account with write access', async () => {
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], world([BOB, ALICE], { 'acme/shop': { alice: true, bob: true } }))
    expect(step).toMatchObject({ selected: 'alice' })
  })

  it('the active account without access: the first with access', async () => {
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], world([ALICE, BOB, { login: 'carol', token: 'gho_carol' }], { 'acme/shop': { bob: true, carol: true } }))
    expect(step).toMatchObject({ selected: 'bob' })
  })

  it('nobody with access: nothing chosen', async () => {
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], world([ALICE, BOB], { 'acme/shop': { alice: false } }))
    expect(step).toMatchObject({ status: 'accounts', selected: null })
  })

  it('an account gh has no token for has no access, and no repository is read with another token', async () => {
    const gh = ghWorld(join(scratch, 'gh'), { accounts: [ALICE], repos: { 'acme/shop': { alice: true } } })
    // gh lists bob, but holds no token for him (a broken keyring entry).
    writeFileSync(join(gh.dir, 'auth-status.json'), JSON.stringify(authStatus([ALICE, BOB])))
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], gh)
    if (step.status !== 'accounts') throw new Error(JSON.stringify(step))
    expect(step.accounts.find((account) => account.login === 'bob')).toMatchObject({ push: false, finish: 'local-green' })
    expect(step.accounts.find((account) => account.login === 'bob')?.reason).toContain('no gh login for bob')
    expect(gh.calls().filter((call) => call[0] === 'api')).toHaveLength(1)
  })
})

describe('gh missing or failing', () => {
  it('no gh: "gh not found", and the step goes on without an account', async () => {
    const step = await readGithubAccounts([repo('shop', 'https://github.com/acme/shop.git')], { git: runGit, gh: ghRunner({ command: join(scratch, 'no-such-gh') }) })
    expect(step.status).toBe('no-gh')
    expect(step.status === 'no-gh' ? step.reason : '').toMatch(/^gh not found/)
    expect(githubChoice(step, 'alice')).toEqual({ account: null, finish: 'local-green' })
  })

  it('gh failing otherwise: the reason, and no account', async () => {
    const failing = ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve({ ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, GH_STUB_FAIL: 'error connecting to api.github.com' }) })
    const step = await readGithubAccounts([repo('shop', 'https://github.com/acme/shop.git')], { git: runGit, gh: failing })
    expect(step).toEqual({ status: 'failed', reason: 'gh auth status failed: error connecting to api.github.com' })
  })
})

describe('what worfy never does with gh', () => {
  it('runs only auth status --json hosts, auth token -u and api repos/…; never login, switch, logout or config', async () => {
    const workspace = join(scratch, 'ws')
    const gh = world([ALICE, BOB], { 'acme/api': { alice: true }, 'acme/web': { bob: true } })
    await read([repo('api', 'https://github.com/acme/api.git', workspace), repo('web', 'https://github.com/acme/web.git', workspace)], gh)
    const calls = gh.calls()
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.filter((call) => !ALLOWED(call))).toEqual([])
    const flat = calls.map((call) => call.join(' '))
    for (const forbidden of ['auth login', 'auth switch', 'auth logout', 'auth refresh', 'config', '--show-token']) expect(flat.filter((call) => call.includes(forbidden))).toEqual([])
    expect(flat.filter((call) => call.startsWith('auth status'))).toEqual(['auth status --json hosts'])
    expect(flat.filter((call) => call.startsWith('auth token')).sort()).toEqual(['auth token -u alice', 'auth token -u bob'])
  })

  it('the stand-in itself refuses what would change the account: switch, logout, config', async () => {
    const gh = world([ALICE])
    for (const args of [['auth', 'switch', '-u', 'alice'], ['auth', 'logout'], ['config', 'set', 'git_protocol', 'ssh']]) {
      await expect(gh.run(args, scratch)).rejects.toThrow('gh stub: unsupported command')
    }
  })

  it('no token in the answer, in the draft, in the console or in the gh log', async () => {
    const lines: string[] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')))
    const gh = world([ALICE, BOB], { 'acme/shop': { alice: true, bob: 403 } })
    const step = await read([repo('shop', 'https://github.com/acme/shop.git')], gh)
    // What crosses IPC is what the channel's schema lets through.
    const answer = JSON.stringify(githubAccountsStepSchema.parse(step))
    const draft = JSON.stringify(withGithubAccount({ profile: { name: 'shop' }, rules: '', gate: [] }, githubChoice(step, 'bob')))
    const logged = `${lines.join('\n')}\n${readFileSync(gh.log, 'utf8')}`
    for (const { token } of [ALICE, BOB]) {
      expect(answer).not.toContain(token)
      expect(draft).not.toContain(token)
      expect(logged).not.toContain(token)
    }
    // The tokens were used: the access of both accounts was read with them.
    expect(answer).toContain('"push":true')
  })
})

describe('"Sign in with gh"', () => {
  it('runs the app\'s gh with exactly auth login: /bin/sh execs it, so the process is gh itself', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(signInCommand('/opt/stub/gh', platform)).toEqual({ file: '/bin/sh', args: ['-c', 'exec "$0" auth login', '/opt/stub/gh'] })
      expect(signInCommand('gh', platform)).toEqual({ file: '/bin/sh', args: ['-c', 'exec "$0" auth login', 'gh'] })
    }
  })

  // Windows has no /bin/sh, and node-pty there looks a bare name up only in worfy's own Path,
  // without adding .exe: the pseudo-terminal starts gh.exe by its full path, found in the Path the
  // pseudo-terminal gets.
  const WIN_PATH = { Path: 'C:\\Windows\\system32;tools;C:\\Program Files\\GitHub CLI' }
  const ghExe = 'C:\\Program Files\\GitHub CLI\\gh.exe'
  const onlyGhExe = (path: string) => path === ghExe

  it('on Windows runs gh.exe of the Path by its full path with auth login, without /bin/sh', () => {
    expect(signInCommand('gh', 'win32', WIN_PATH, onlyGhExe)).toEqual({ file: ghExe, args: ['auth', 'login'] })
  })

  it('on Windows a WORFY_GH with a full path is started as it is', () => {
    expect(signInCommand('D:\\stub\\gh.exe', 'win32', {}, (path) => path === 'D:\\stub\\gh.exe')).toEqual({ file: 'D:\\stub\\gh.exe', args: ['auth', 'login'] })
    expect(signInCommand('\\\\host\\share\\gh.exe', 'win32', {}, (path) => path === '\\\\host\\share\\gh.exe')).toEqual({ file: '\\\\host\\share\\gh.exe', args: ['auth', 'login'] })
  })

  it('a .mjs WORFY_GH off Windows runs under worfy\'s own Node, never handed to the terminal as a program', () => {
    const stub = '/fixtures/gh/gh-stub.mjs'
    expect(signInCommand(stub, 'darwin')).toEqual({ file: process.execPath, args: [stub, 'auth', 'login'], env: { ELECTRON_RUN_AS_NODE: '1' } })
  })

  it('a .mjs WORFY_GH on Windows runs under node.exe of the Path: worfy\'s own executable prints nothing in a terminal there', () => {
    const stub = 'C:\\fixtures\\gh\\gh-stub.mjs'
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe'
    const env = { PATH: 'C:\\Program Files\\nodejs;C:\\Windows\\System32' }
    expect(signInCommand(stub, 'win32', env, (path) => path === nodeExe)).toEqual({ file: nodeExe, args: [stub, 'auth', 'login'], env: {} })
    expect(() => signInCommand(stub, 'win32', env, () => false)).toThrow('node.exe was not found in the Path')
  })

  it('a relative .mjs WORFY_GH is started by its absolute path: the terminal runs in another folder', () => {
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe'
    const env = { PATH: 'C:\\Program Files\\nodejs' }
    const relative = join('test', 'fixtures', 'gh', 'gh-stub.mjs')
    expect(signInCommand(relative, 'win32', env, (path) => path === nodeExe).args).toEqual([resolve(relative), 'auth', 'login'])
    expect(signInCommand(relative, 'darwin').args).toEqual([resolve(relative), 'auth', 'login'])
  })

  it('a .mjs WORFY_GH off Windows: the pseudo-terminal gets ELECTRON_RUN_AS_NODE=1 on top of its own environment', async () => {
    let started: { file: string; args: string[]; env: Record<string, string> } | undefined
    const registry = signInRegistry(
      { command: '/x/gh-stub.mjs', env: () => Promise.resolve({ PATH: '/usr/bin', GH_STUB_DIR: '/stub/dir', EMPTY: undefined }) },
      (file, args, options) => {
        started = { file, args, env: options.env }
        throw new Error('not started in this test')
      },
      { platform: 'darwin' },
    )
    await Promise.resolve(registry.open('s3', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })).catch(() => undefined)
    expect(started?.file).toBe(process.execPath)
    expect(started?.args).toEqual(['/x/gh-stub.mjs', 'auth', 'login'])
    expect(started?.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(started?.env.PATH).toBe('/usr/bin')
    expect(started?.env.GH_STUB_DIR).toBe('/stub/dir')
    expect(started?.env.TERM).toBe('xterm-256color')
    await registry.closeAll()
  })

  it('on Windows a full-path WORFY_GH without an extension starts its .exe, and one that is not there fails with why', () => {
    expect(signInCommand('C:\\stub\\gh', 'win32', WIN_PATH, (path) => path === 'C:\\stub\\gh.exe')).toEqual({ file: 'C:\\stub\\gh.exe', args: ['auth', 'login'] })
    expect(() => signInCommand('C:\\stub\\gh', 'win32', WIN_PATH, onlyGhExe)).toThrow('C:\\stub\\gh was not found: WORFY_GH must name gh.exe by its full path')
  })

  it('on Windows a relative WORFY_GH is refused, not looked up in every Path entry', () => {
    // Every candidate exists: a lookup would find one, so only the refusal passes.
    for (const relative of ['tools\\gh.exe', '\\opt\\gh', 'bin/gh']) {
      expect(() => signInCommand(relative, 'win32', WIN_PATH, () => true)).toThrow(`WORFY_GH must be a full path (C:\\… or \\\\…), not ${relative}`)
    }
  })

  it('on Windows without gh in the Path the sign-in fails with a reason a person can act on', () => {
    expect(() => signInCommand('gh', 'win32', WIN_PATH, () => false)).toThrow('gh was not found in the Path')
  })

  it('takes the system from process.platform when none is given', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(signInCommand('gh', undefined, WIN_PATH, onlyGhExe)).toEqual({ file: ghExe, args: ['auth', 'login'] })
    } finally {
      if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
    }
  })

  it('on Windows the pseudo-terminal starts gh.exe found in the Path of the environment it gets', async () => {
    let started: string[] | undefined
    const registry = signInRegistry(
      { env: () => Promise.resolve(WIN_PATH) },
      (file, args) => {
        started = [file, ...args]
        throw new Error('not started in this test')
      },
      { platform: 'win32', exists: onlyGhExe },
    )
    await Promise.resolve(registry.open('w0', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })).catch(() => undefined)
    expect(started).toEqual([ghExe, 'auth', 'login'])
    await registry.closeAll()
  })

  it('on Windows without gh in the Path nothing is started and the sign-in answers why', async () => {
    let started = false
    const registry = signInRegistry(
      { env: () => Promise.resolve(WIN_PATH) },
      () => {
        started = true
        throw new Error('File not found: ')
      },
      { platform: 'win32', exists: () => false },
    )
    await expect(registry.open('w1', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })).rejects.toThrow('gh was not found in the Path')
    expect(started).toBe(false)
    await registry.closeAll()
  })

  it('without WORFY_GH the sign-in runs `gh` itself on macOS and Linux (nothing is started here: the spawn only records)', async () => {
    let started: string[] | undefined
    const registry = signInRegistry({ env: () => Promise.resolve({}) }, (file, args) => {
      started = [file, ...args]
      throw new Error('not started in this test')
    }, { platform: 'darwin' })
    await Promise.resolve(registry.open('s0', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: () => undefined, exit: () => undefined, started: () => undefined })).catch(() => undefined)
    expect(started).toEqual(['/bin/sh', '-c', 'exec "$0" auth login', 'gh'])
    await registry.closeAll()
  })

  // The two tests below start the gh stand-in in a real pseudo-terminal. On Windows the stand-in is
  // gh-stub.mjs, and the sign-in starts it under node.exe of the Path (programStartInPty): without
  // one there they cannot run.
  const NO_NODE_EXE = process.platform === 'win32' && findOnPath('node', process.env) === null
  it.skipIf(NO_NODE_EXE)('gh auth login in a real pseudo-terminal: worfy types nothing, the user\'s Enter signs in, the exit ends it and the new account is there', async () => {
    const gh = ghWorld(join(scratch, 'gh'), { accounts: [ALICE], login: { login: 'carol', token: 'gho_carol_SECRET_0004' } })
    const registry = signInRegistry({ command: gh.command, env: () => Promise.resolve({ ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, ...gh.env }) })
    let output = ''
    const exited = new Promise<number>((resolve) => {
      void registry.open('s1', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: (data) => void (output += data), exit: (code) => resolve(code), started: () => undefined })
    })
    await vi.waitFor(() => expect(output).toContain('Press Enter to sign in'), { timeout: 10_000 })
    // Until the user answers, gh waits: no account was added.
    expect(gh.calls()).toEqual([['auth', 'login']])
    expect(readFileSync(join(gh.dir, 'auth-status.json'), 'utf8')).not.toContain('carol')
    registry.write('s1', '\r', undefined)
    expect(await exited).toBe(0)
    const accounts = parseAuthStatus(readFileSync(join(gh.dir, 'auth-status.json'), 'utf8'))
    expect(accounts.map((account) => [account.login, account.active])).toEqual([
      ['alice', false],
      ['carol', true],
    ])
    await registry.closeAll()
  })

  it.skipIf(NO_NODE_EXE)('closing a sign-in that waits for its user ends gh', async () => {
    const gh = ghWorld(join(scratch, 'gh'), { accounts: [], login: { login: 'carol', token: 'gho_carol' } })
    const registry = signInRegistry({ command: gh.command, env: () => Promise.resolve({ ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, ...gh.env }) })
    let output = ''
    await registry.open('s2', { cwd: scratch, cols: 80, rows: 24 }, {}, { output: (data) => void (output += data), exit: () => undefined, started: () => undefined })
    await vi.waitFor(() => expect(output).toContain('Press Enter'), { timeout: 10_000 })
    await registry.close('s2')
    expect(registry.has('s2')).toBe(false)
    expect(readFileSync(join(gh.dir, 'auth-status.json'), 'utf8')).not.toContain('carol')
  })
})
