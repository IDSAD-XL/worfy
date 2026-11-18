// The GitHub access row of a Project and the honest gh-auth row (src/main/first-run/checks.ts, worfy-auth-check
// ticket 05), on the gh stand-in (test/fixtures/gh/gh-stub.mjs, as WORFY_GH names it): no account and one login
// with push → fixable with "Use <login>"; two logins with push → needs-user; an account gh has no login for →
// critical with Sign in…; 401; 404; no network and 5xx → unknown. "Use <login>" writes github.account through
// bin/profile-set (a recording stand-in here) and the row is ok after it. A known token never reaches a row, a
// log line or an error. Nothing reaches GitHub, the machine's gh or the real Profile.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunActions, type ActionDeps } from '../../src/main/first-run/actions'
import { githubAccessRow, githubAccessRows, githubAccessUnknown, runChecks, runTool, useLoginCandidate, type CheckDeps, type GithubAccessDeps, type GithubProject } from '../../src/main/first-run/checks'
import { HealthReports } from '../../src/main/first-run/health-reports'
import { ghRunner } from '../../src/main/github/prs'
import type { ProfileRun } from '../../src/main/workflow/profile'
import { checkState, type Check, type FirstRunReport } from '../../src/shared/ipc/first-run'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ghWorld, STUB_COMMAND, type StubAccount, type StubRepos } from './gh-world'

/**
 * A token shaped as gh's (`gho_` and 36 more), built here so that no token-shaped text sits in the source
 * (scripts/check-personal.mjs). The stand-in prints them in `gh auth token` and in every body of `api -i`.
 */
const shaped = (kind: 'o' | 'p', marker: string): string => [`gh${kind}`, marker.padEnd(36, '0')].join('_')
const ALICE: StubAccount = { login: 'alice', active: true, token: shaped('o', 'aliceLEAK') }
const BOB: StubAccount = { login: 'bob', token: shaped('o', 'bobLEAK') }
/** A token of the environment that GitHub never issued: 401. */
const BAD = shaped('p', 'badLEAK')
const SECRETS = [ALICE.token, BOB.token, BAD]

let root: string
let project: GithubProject

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-github-access-')))
  const folder = join(root, 'app')
  mkdirSync(folder)
  project = { id: 'p-alpha', name: 'alpha', root: folder, folders: [folder], repos: ['acme/app'] }
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(root)
})

interface Setup {
  accounts: readonly StubAccount[]
  repos?: StubRepos
  /** The Profile's github.account; null — not set. */
  account?: string | null
  /** The reason readGithubAccount gives with no account. */
  reason?: string
  /** GH_TOKEN of gh's environment. */
  token?: string
  offline?: boolean
}

/** The deps of the row on a stand-in world: gh, its environment, the account of the Profile and git with an origin on github.com. */
function world(setup: Setup): { deps: GithubAccessDeps; dir: string; profile: { account: string | null } } {
  const stub = ghWorld(join(root, `world-${Math.random().toString(36).slice(2)}`), { accounts: setup.accounts, repos: setup.repos ?? {} })
  if (setup.offline === true) writeFileSync(join(stub.dir, 'offline'), '')
  const env = { ...process.env, GH_TOKEN: setup.token, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, ...stub.env }
  const profile = { account: setup.account ?? null }
  const deps: GithubAccessDeps = {
    gh: ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve(env), timeoutMs: 15_000 }),
    ghEnv: () => Promise.resolve(env),
    account: () => Promise.resolve({ account: profile.account, reason: profile.account === null ? (setup.reason ?? 'the Profile has no github.account field (profile exit code 4)') : null }),
    git: (args) => Promise.resolve(args.includes('get-url') ? 'https://github.com/acme/app.git' : ''),
    platform: 'darwin',
  }
  return { deps, dir: stub.dir, profile }
}

async function rowOf(setup: Setup): Promise<Check> {
  const checked = await githubAccessRow(project, world(setup).deps)
  if (checked === null) throw new Error('no row')
  return checked
}

describe('GitHub access of a Project', () => {
  it('no github.account, one login with push to every repository: non-critical, fixable with "Use alice"', async () => {
    const checked = await rowOf({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: false } } })
    expect(checked).toMatchObject({ id: 'github-access', group: 'Projects', project: { id: 'p-alpha', name: 'alpha' }, status: 'warn', severity: 'non-critical', opensFirstRun: false })
    expect(checked.detail).toContain('github.account is not set')
    expect(checked.actions).toEqual([{ id: 'use-login', label: 'Use alice', safe: true, login: 'alice' }])
    expect(checkState(checked)).toBe('fixable')
  })

  it('no github.account, two logins with push: needs-user, no button', async () => {
    const checked = await rowOf({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: true } } })
    expect(checked).toMatchObject({ status: 'warn', severity: 'non-critical', actions: [] })
    expect(checkState(checked)).toBe('needs-user')
  })

  it('an account gh has no login for: critical, Sign in… with gh auth login', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, account: 'carol' })
    expect(checked).toMatchObject({ status: 'fail', severity: 'critical', command: 'gh auth login', actions: [{ id: 'gh-login', label: 'Sign in…' }] })
    expect(checked.detail).toContain('no gh login for carol')
    expect(checked.hint).toContain('sign in as carol')
  })

  it('the same with GH_TOKEN in the environment: gh auth login refuses then, so the command runs it without the variable', async () => {
    const checked = await rowOf({ accounts: [ALICE], account: 'carol', token: BAD })
    expect(checked).toMatchObject({ status: 'fail', severity: 'critical', actions: [], command: 'env -u GH_TOKEN -u GITHUB_TOKEN gh auth login' })
    expect(checked.hint).toContain('GH_TOKEN is set')
  })

  it('no github.account, GH_TOKEN of the environment does not work (401): critical, the variable named, Use alice and the command to remove it', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, token: BAD })
    expect(checked).toMatchObject({ status: 'fail', severity: 'critical', command: 'launchctl unsetenv GH_TOKEN' })
    expect(checked.detail).toBe('GH_TOKEN from the environment does not work (HTTP 401)')
    expect(checked.hint).toContain('GH_TOKEN comes from your environment')
    expect(checked.actions).toEqual([{ id: 'use-login', label: 'Use alice', safe: true, login: 'alice' }])
  })

  it('404: critical, no access to the repository as the account', async () => {
    const checked = await rowOf({ accounts: [ALICE, BOB], repos: { 'acme/app': { bob: true } }, account: 'alice' })
    expect(checked).toMatchObject({ status: 'fail', severity: 'critical' })
    expect(checked.detail).toBe('no access to acme/app as alice')
  })

  it('the account with access: ok with the login, the source of the token and the repository; GH_TOKEN of the environment does not apply', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, account: 'alice', token: BAD })
    expect(checked).toMatchObject({ status: 'ok', severity: 'critical', actions: [] })
    expect(checked.detail).toBe("alice · the token of alice from gh's keyring (GH_TOKEN of the environment does not apply here) · acme/app")
  })

  it('no network: unknown, non-critical, "Couldn\'t check"', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, account: 'alice', offline: true })
    expect(checked).toMatchObject({ status: 'unknown', severity: 'non-critical', actions: [] })
    expect(checked.detail).toMatch(/^Couldn't check: /u)
  })

  it('GitHub answers 503: unknown, never a failure', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: 503 } }, account: 'alice' })
    expect(checked).toMatchObject({ status: 'unknown', severity: 'non-critical', detail: "Couldn't check: GitHub answered HTTP 503" })
  })

  it('a Profile that does not read: the row says so, and offers no write', async () => {
    const checked = await rowOf({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, reason: 'the profile script failed with exit code 1' })
    expect(checked).toMatchObject({ status: 'warn', actions: [] })
    expect(checked.detail).toContain('the Profile could not be read (the profile script failed with exit code 1)')
  })

  it('never rejects: an account that cannot be read is unknown; a Project without a GitHub repository has no row', async () => {
    const { deps } = world({ accounts: [ALICE] })
    const broken = await githubAccessRow(project, { ...deps, account: () => Promise.reject(new Error('profile went away')) })
    expect(broken).toMatchObject({ status: 'unknown', detail: "Couldn't check: profile went away" })
    expect(await githubAccessRow({ ...project, repos: [] }, deps)).toBeNull()
    expect(await githubAccessRows([{ ...project, repos: [] }, project], deps)).toHaveLength(1)
    // What the app's re-check answers when it cannot even read the Project's repositories.
    expect(githubAccessUnknown({ id: project.id, name: project.name }, 'no layout')).toMatchObject({ status: 'unknown', severity: 'non-critical', opensFirstRun: false, detail: "Couldn't check: no layout" })
  })

  it('the one login with push is asked of the stored accounts, not of GH_TOKEN of the environment', async () => {
    const { deps } = world({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: false } }, token: BOB.token })
    const asked: { args: readonly string[]; extra: Readonly<Record<string, string>> | undefined }[] = []
    const recording: GithubAccessDeps = { ...deps, gh: (args, cwd, extra, output) => (asked.push({ args, extra }), deps.gh(args, cwd, extra, output)) }
    expect(await useLoginCandidate(project, recording)).toBe('alice')
    // gh reads an empty variable as unset: the accounts are listed as gh stores them, each push asked with its own token.
    const status = asked.find((each) => each.args[0] === 'auth' && each.args[1] === 'status')
    expect(status?.extra).toMatchObject({ GH_TOKEN: '', GITHUB_TOKEN: '' })
    const push = asked.filter((each) => each.args[0] === 'api')
    expect(push.map((each) => each.extra?.GH_TOKEN)).toEqual(expect.arrayContaining([ALICE.token, BOB.token]))
  })
})

/** bin/profile-set as a recording stand-in: --read gives a fingerprint, --set takes the login into the "Profile". */
function profileSet(profile: { account: string | null }, calls: string[][]): (args: readonly string[]) => Promise<ProfileRun> {
  return (args) => {
    calls.push([...args])
    if (args.includes('--read')) return Promise.resolve({ code: 0, stdout: JSON.stringify({ fields: { 'github.account': profile.account }, fingerprint: 'f-1' }), stderr: '' })
    const value = JSON.parse(args[args.indexOf('--set') + 1] ?? '{}') as Record<string, string>
    profile.account = value['github.account'] ?? null
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ fingerprint: 'f-2', warning: null }), stderr: '' })
  }
}

function actionsFor(deps: GithubAccessDeps, profile: { account: string | null }, calls: string[][], set = profileSet(profile, calls)): FirstRunActions {
  const report: FirstRunReport = { checks: [], checkedAt: new Date(0).toISOString() }
  const actionDeps: ActionDeps = {
    checks: () => Promise.resolve(report),
    confirm: () => Promise.reject(new Error('Use <login> asks no dialog')),
    env: () => Promise.resolve({}),
    homes: { harnessHome: join(root, 'harness'), claudeHome: join(root, 'claude') },
    installHarness: () => Promise.reject(new Error('not here')),
    projects: () => Promise.resolve([]),
    binDir: join(root, 'bin'),
    githubAccount: {
      candidate: async (projectId) => (projectId === project.id ? { root: project.root, name: project.name, login: await useLoginCandidate(project, deps) } : null),
      profileSet: set,
    },
  }
  return new FirstRunActions(actionDeps)
}

describe('"Use <login>"', () => {
  it('calls bin/profile-set --field github.account with that login, and the next check of the row is ok', async () => {
    const { deps, profile } = world({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: false } }, token: BAD })
    const calls: string[][] = []
    const result = await actionsFor(deps, profile, calls).run('use-login', { projectId: project.id, login: 'alice' })
    expect(result).toMatchObject({ outcome: 'done', message: 'github.account of alpha is now alice' })
    expect(calls).toEqual([
      ['-C', project.root, '--field', 'github.account', '--read'],
      ['-C', project.root, '--field', 'github.account', '--expect', 'f-1', '--set', '{"github.account":"alice"}'],
    ])
    expect(await githubAccessRow(project, deps)).toMatchObject({ status: 'ok', severity: 'critical' })
  })

  it('two Projects with rows: the button of the second writes the Profile of the second only', async () => {
    const second = join(root, 'web')
    mkdirSync(second)
    const web: GithubProject = { id: 'p-beta', name: 'beta', root: second, folders: [second], repos: ['acme/web'] }
    const { deps } = world({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: false }, 'acme/web': { alice: false, bob: true } } })
    const both = { ...deps, git: (args: readonly string[]) => Promise.resolve(args.includes(second) ? 'https://github.com/acme/web.git' : 'https://github.com/acme/app.git') }
    const rows = await githubAccessRows([project, web], both)
    expect(rows.map((each) => [each.project?.id, each.actions.map((button) => button.login)])).toEqual([
      ['p-alpha', ['alice']],
      ['p-beta', ['bob']],
    ])
    const calls: string[][] = []
    const profiles: Record<string, { account: string | null }> = { [project.root]: { account: null }, [second]: { account: null } }
    const set = (args: readonly string[]): Promise<ProfileRun> => profileSet(profiles[args[1] ?? ''] ?? { account: null }, calls)(args)
    const byId = { [project.id]: project, [web.id]: web }
    const actions = new FirstRunActions({
      checks: () => Promise.resolve({ checks: [], checkedAt: new Date(0).toISOString() }),
      confirm: () => Promise.reject(new Error('Use <login> asks no dialog')),
      env: () => Promise.resolve({}),
      homes: { harnessHome: join(root, 'harness'), claudeHome: join(root, 'claude') },
      installHarness: () => Promise.reject(new Error('not here')),
      projects: () => Promise.resolve([]),
      binDir: join(root, 'bin'),
      githubAccount: {
        candidate: async (projectId) => {
          const found = byId[projectId]
          return found === undefined ? null : { root: found.root, name: found.name, login: await useLoginCandidate(found, both) }
        },
        profileSet: set,
      },
    })
    expect(await actions.run('use-login', { projectId: 'p-beta', login: 'bob' })).toMatchObject({ outcome: 'done', message: 'github.account of beta is now bob' })
    expect(calls.map((each) => each[1])).toEqual([second, second])
    expect(profiles).toEqual({ [project.root]: { account: null }, [second]: { account: 'bob' } })
  })

  it('writes nothing for a login that is no longer the one with push, or for another Project', async () => {
    const { deps, profile } = world({ accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: true } } })
    const calls: string[][] = []
    const actions = actionsFor(deps, profile, calls)
    expect(await actions.run('use-login', { projectId: project.id, login: 'alice' })).toMatchObject({ outcome: 'failed' })
    expect(await actions.run('use-login', { projectId: 'p-other', login: 'alice' })).toMatchObject({ outcome: 'failed' })
    expect(await actions.run('use-login', { projectId: project.id })).toMatchObject({ outcome: 'failed' })
    expect(calls).toEqual([])
    expect(profile.account).toBeNull()
  })

  it('a Profile changed between --read and --set is not written over', async () => {
    const { deps, profile } = world({ accounts: [ALICE], repos: { 'acme/app': { alice: true } } })
    const changed = (args: readonly string[]): Promise<ProfileRun> =>
      Promise.resolve(args.includes('--read') ? { code: 0, stdout: '{"fingerprint":"f-1"}', stderr: '' } : { code: 5, stdout: '', stderr: 'profile-set: changed' })
    const conflict = actionsFor(deps, profile, [], changed)
    expect(await conflict.run('use-login', { projectId: project.id, login: 'alice' })).toMatchObject({ outcome: 'failed', message: 'the Profile changed while it was written: check again' })
  })
})

/** The stand-in's script itself: the checks run a `.mjs` under worfy's own Node, with no node on the PATH needed. */
const STUB_SCRIPT = join(import.meta.dirname, '..', 'fixtures', 'gh', 'gh-stub.mjs')

/** The checks with every tool missing but gh, which is the stand-in: only the gh rows answer. */
function ghOnly(dir: string, token: string | undefined): CheckDeps {
  const stub = { GH_STUB_DIR: dir, GH_STUB_LOG: join(dir, 'calls.jsonl') }
  const isStub = (name: string, args: readonly string[]): boolean => args[0] === STUB_SCRIPT
  return {
    // With the node that runs the `.mjs` when the tests are not under Electron (scriptRunner: `node`); no other tool runs (probes).
    env: { PATH: [dirname(scriptNode()), ...(process.env.PATH ?? '').split(delimiter)].join(delimiter), HOME: root },
    gh: { command: STUB_SCRIPT, env: { ...stub, ...(token === undefined ? {} : { GH_TOKEN: token }) } },
    scriptEnv: () => Promise.resolve({}),
    bundledClaudeCodeVersion: null,
    accountInfo: () => Promise.resolve({}),
    harness: () => Promise.reject(new Error('no Harness here')),
    legacyHarness: () => false,
    homes: { harnessHome: join(root, 'harness'), claudeHome: join(root, 'claude') },
    projects: () => Promise.resolve([]),
    system: { platform: 'darwin', release: '24.6.0', arch: 'arm64' },
    probes: {
      run: (name, args, env, ms, cwd) => (isStub(name, args) ? runTool(name, args, env, ms, { cwd }) : Promise.resolve({ code: null, stdout: '', stderr: '', missing: true })),
      exists: () => false,
    },
  }
}

async function ghAuthRow(setup: { accounts: readonly StubAccount[]; token?: string }): Promise<Check> {
  const { dir } = world({ accounts: setup.accounts })
  const report = await runChecks(ghOnly(dir, setup.token))
  const found = report.checks.find((check) => check.id === 'gh-auth')
  if (found === undefined) throw new Error('no gh-auth row')
  return found
}

describe('gh-auth names the source of the token', () => {
  it('GH_TOKEN that works: ok, the stored account and the variable that overrides it', async () => {
    const checked = await ghAuthRow({ accounts: [ALICE], token: ALICE.token })
    expect(checked.status).toBe('ok')
    expect(checked.detail).toBe('alice (keyring), GH_TOKEN from the environment (alice) overrides it')
  })

  it('GH_TOKEN that does not work: fail, though a stored account works — gh exits 1', async () => {
    const checked = await ghAuthRow({ accounts: [ALICE], token: BAD })
    expect(checked).toMatchObject({ status: 'fail', command: 'launchctl unsetenv GH_TOKEN' })
    expect(checked.detail).toBe('the token in GH_TOKEN from the environment does not work; it overrides alice (keyring)')
  })

  it('the keyring alone: ok as before', async () => {
    const checked = await ghAuthRow({ accounts: [ALICE] })
    expect(checked).toMatchObject({ status: 'ok', detail: 'github.com: alice' })
  })
})

describe('no token reaches a row, a log line or an error', () => {
  it('the rows, the merged report, the action messages and the console of every case above hold none of the known tokens', async () => {
    const printed: unknown[] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(args))
    const cases: Setup[] = [
      { accounts: [ALICE, BOB], repos: { 'acme/app': { alice: true, bob: false } } },
      { accounts: [ALICE], repos: { 'acme/app': { alice: true } }, token: BAD },
      { accounts: [ALICE], repos: { 'acme/app': { bob: true } }, account: 'alice' },
      { accounts: [ALICE], repos: { 'acme/app': { alice: 503 } }, account: 'alice' },
      { accounts: [ALICE], account: 'carol', token: BAD },
      { accounts: [ALICE], account: 'alice', offline: true },
    ]
    const seen: unknown[] = []
    for (const setup of cases) {
      const { deps, profile } = world(setup)
      const health = new HealthReports()
      health.registerNetworkRows(() => githubAccessRows([project], deps))
      health.registerRecheck('github-access', () => githubAccessRow(project, deps))
      await health.checkNetwork()
      // A feature that let a token slip into its reason: the report redacts it.
      health.reportFailure('github-access', { id: project.id, name: project.name }, `gh failed with ${ALICE.token}`, 'Open Health check')
      seen.push(health.current())
      seen.push(await actionsFor(deps, profile, []).run('use-login', { projectId: project.id, login: 'alice' }))
      seen.push(await actionsFor(deps, profile, []).run('use-login', { projectId: project.id, login: 'bob' }))
    }
    seen.push(await ghAuthRow({ accounts: [ALICE], token: BAD }), await ghAuthRow({ accounts: [ALICE], token: ALICE.token }))
    const everything = JSON.stringify([seen, printed])
    expect(everything).toContain('github-access')
    // The stand-in did print them to the rows' gh: in `gh auth token` and in the body of `api -i`.
    const { deps } = world({ accounts: [ALICE], repos: { 'acme/app': { alice: true } }, token: BAD })
    expect(await deps.gh(['auth', 'token', '-u', 'alice'], project.root)).toContain(ALICE.token)
    const body = await deps.gh(['api', '-i', 'repos/acme/app'], project.root, {}, 'all').catch((error: unknown) => (error as { output?: string }).output ?? '')
    expect(body).toContain(ALICE.token)
    expect(body).toContain(BAD)
    for (const secret of SECRETS) expect(everything).not.toContain(secret)
  })
})
