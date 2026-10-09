// The GitHub account of a Project being connected (worfy-harness ticket 25; ADR-0042, ADR-0045):
// which accounts gh knows for the hosts of the folder's `origin` remotes, and whether each of them
// may push to every such repository.
//
// - The accounts: one `gh auth status --json hosts` (never `--show-token`). A remote counts as on
//   GitHub when its host is github.com or a host gh has accounts for (GitHub Enterprise).
// - The access: per account, its token from `gh auth token -u <login>` through accountAuth
//   (src/main/github/prs.ts, worfy-week ticket 01), then per repository
//   `gh api repos/<owner>/<repo> --jq .permissions.push` with that token as GH_TOKEN. Only `true`
//   is write access; `false`, 403, 404 and any other failure are not, and the account's finish is
//   local (ADR-0045: no PR without write access to origin).
//
// The token lives only in the environment of that one `gh api` child: it is not in the answer, not
// in a reason (gh's own messages and accountAuth's never carry it) and not logged. gh runs with
// GH_PROMPT_DISABLED (ghRunner), and nothing here signs in, switches or logs out an account or
// changes gh's config: the global account belongs to the user.
import { spawn as spawnNodePty } from 'node-pty'
import { z } from 'zod'
import type { GithubAccount, GithubAccountsStep, WorkflowFinish } from '../../shared/ipc/projects'
import type { GitRunner } from '../projects/store'
import { TerminalRegistry, type SpawnPty } from '../terminal/pty'
import { accountAuth, type GhRunner } from './prs'

/** A remote on a host: `owner/repo` there. */
export interface RemoteRepo {
  host: string
  owner: string
  repo: string
}

/**
 * The host, owner and repository of a remote URL — `https://host/owner/repo(.git)`,
 * `ssh://git@host(:port)/owner/repo`, `git@host:owner/repo` — or null for anything else (a path, a
 * nested group of another forge).
 */
export function parseRemote(url: string): RemoteRepo | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/u.exec(trimmed)
  if (/^[a-z+]+:\/\//iu.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(parsed.protocol)) return null
    host = parsed.hostname
    path = parsed.pathname
  } else if (scp !== null) {
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else return null
  const parts = path
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.git$/u, '')
    .split('/')
  if (parts.length !== 2 || host === '' || parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return { host: host.toLowerCase(), owner: parts[0] ?? '', repo: parts[1] ?? '' }
}

const hostAccountSchema = z.object({ login: z.string().min(1), host: z.string().min(1), active: z.boolean().catch(false), state: z.string().catch('') }).loose()
const authStatusSchema = z.object({ hosts: z.record(z.string(), z.array(z.unknown()).catch([])) }).loose()

/** A login gh knows for a host. */
export type HostAccount = Pick<GithubAccount, 'login' | 'host' | 'active' | 'state'>

/** The accounts of `gh auth status --json hosts`, host by host as gh lists them; entries it cannot read are skipped. */
export function parseAuthStatus(stdout: string): HostAccount[] {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error('gh auth status --json hosts printed no JSON')
  }
  const status = authStatusSchema.safeParse(json)
  if (!status.success) throw new Error('gh auth status --json hosts printed no hosts')
  const accounts: HostAccount[] = []
  for (const [host, entries] of Object.entries(status.data.hosts)) {
    for (const entry of entries) {
      const account = hostAccountSchema.safeParse(entry)
      if (account.success) accounts.push({ login: account.data.login, host: account.data.host.toLowerCase() || host, active: account.data.active, state: account.data.state })
    }
  }
  return accounts
}

/** A repository of the folder (connect.ts, ConnectFolder.repos). */
export interface FolderRepo {
  name: string
  path: string
}

export interface AccountsDeps {
  git: GitRunner
  /** The app's gh: the same executable and environment as its other gh calls. */
  gh: GhRunner
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** ghRunner's rejection for a gh that cannot be started. */
const isMissingGh = (error: unknown): boolean => /^gh not found\b/u.test(messageOf(error))

/** `git remote get-url origin`, or null without an origin. */
async function originOf(git: GitRunner, path: string): Promise<string | null> {
  try {
    const url = await git(['-C', path, 'remote', 'get-url', 'origin'])
    return url === '' ? null : url
  } catch {
    return null
  }
}

/** Whether `login` may push to the repository: `push` only on gh's `true`; else gh's reason. */
async function pushAccess(gh: GhRunner, cwd: string, remote: RemoteRepo, token: Readonly<Record<string, string>>): Promise<{ push: boolean; detail: string | null }> {
  try {
    const answer = await gh(['api', `repos/${remote.owner}/${remote.repo}`, '--jq', '.permissions.push', '--hostname', remote.host], cwd, token)
    return answer.trim() === 'true' ? { push: true, detail: null } : { push: false, detail: null }
  } catch (error) {
    return { push: false, detail: messageOf(error) }
  }
}

const finishOf = (push: boolean): WorkflowFinish => (push ? 'pr-green-ci' : 'local-green')

/** The account step of a folder's repositories: reads git and gh, writes nothing. */
export async function readGithubAccounts(repos: readonly FolderRepo[], deps: AccountsDeps): Promise<GithubAccountsStep> {
  const origins = await Promise.all(repos.map(async (repo) => ({ repo, url: await originOf(deps.git, repo.path) })))
  const withOrigin = origins.filter((each): each is { repo: FolderRepo; url: string } => each.url !== null)
  if (withOrigin.length === 0) {
    const names = repos.map((repo) => repo.name).join(', ')
    return { status: 'no-origin', reason: `No GitHub origin: ${names} ${repos.length === 1 ? 'has' : 'have'} no origin remote.` }
  }
  const cwd = withOrigin[0]?.repo.path ?? repos[0]?.path ?? '.'

  let known: HostAccount[]
  try {
    known = parseAuthStatus(await deps.gh(['auth', 'status', '--json', 'hosts'], cwd))
  } catch (error) {
    if (isMissingGh(error)) return { status: 'no-gh', reason: `${messageOf(error)}: install it with brew install gh; the first-run screen checks it.` }
    return { status: 'failed', reason: `gh auth status failed: ${messageOf(error)}` }
  }
  const githubHosts = new Set(['github.com', ...known.map((account) => account.host)])
  const onGithub: { name: string; path: string; remote: RemoteRepo }[] = []
  const skipped: string[] = []
  for (const { repo, url } of origins) {
    const remote = url === null ? null : parseRemote(url)
    if (remote !== null && githubHosts.has(remote.host)) onGithub.push({ ...repo, remote })
    else skipped.push(repo.name)
  }
  if (onGithub.length === 0) {
    const hosts = withOrigin.map(({ repo, url }) => `${repo.name}: ${parseRemote(url)?.host ?? url}`).join(', ')
    return { status: 'no-origin', reason: `No GitHub origin: the origin is not on a GitHub host (${hosts}).` }
  }

  const hosts = new Set(onGithub.map((repo) => repo.remote.host))
  const candidates = known.filter((account) => hosts.has(account.host))
  const accounts = await Promise.all(
    candidates.map(async (account): Promise<GithubAccount> => {
      const run: GhRunner = (args, at, env) => deps.gh(account.host === 'github.com' ? args : [...args, '--hostname', account.host], at, env)
      let token: Readonly<Record<string, string>>
      try {
        token = await accountAuth({ account: () => Promise.resolve(account.login), run })(cwd)
      } catch (error) {
        return { ...account, push: false, finish: 'local-green', reason: `${messageOf(error)}. Tickets will close with the local finish.` }
      }
      const missing: string[] = []
      for (const repo of onGithub) {
        const slug = `${repo.remote.owner}/${repo.remote.repo}`
        if (repo.remote.host !== account.host) {
          missing.push(`${slug} (on ${repo.remote.host})`)
          continue
        }
        const access = await pushAccess(deps.gh, repo.path, repo.remote, token)
        if (!access.push) missing.push(access.detail === null ? slug : `${slug} (${access.detail})`)
      }
      const push = missing.length === 0
      return {
        ...account,
        push,
        finish: finishOf(push),
        reason: push ? null : `${account.login} has no write access to ${missing.join(', ')}: Tickets will close with the local finish.`,
      }
    }),
  )
  const withPush = accounts.filter((account) => account.push)
  const selected = withPush.find((account) => account.active) ?? withPush[0] ?? null
  return {
    status: 'accounts',
    repos: onGithub.map((repo) => ({ name: repo.name, host: repo.remote.host, slug: `${repo.remote.owner}/${repo.remote.repo}` })),
    skipped,
    accounts,
    selected: selected?.login ?? null,
  }
}

/**
 * How "Sign in with gh" starts `gh auth login`: `/bin/sh` execs the app's gh (`gh` from the login
 * shell's PATH, or WORFY_GH) with exactly those two arguments, so the pseudo-terminal's process is
 * gh itself and its exit is the end of the sign-in. Nothing is typed into it by worfy.
 */
export function signInCommand(gh: string): { file: string; args: string[] } {
  return { file: '/bin/sh', args: ['-c', 'exec "$0" auth login', gh] }
}

/** The app's gh: its executable and the environment it runs in. */
export interface GhProgram {
  command: string
  env: () => Promise<Record<string, string | undefined>>
}

/**
 * The pseudo-terminals of "Sign in with gh": the Terminal Nodes' registry (output kept for a
 * redraw, the size, SIGHUP then SIGKILL on close), but its process is `gh auth login` of the app's
 * gh instead of the user's shell.
 */
export function signInRegistry(gh: GhProgram, spawn: SpawnPty = (file, args, options) => spawnNodePty(file, args, options)): TerminalRegistry {
  const command = signInCommand(gh.command)
  return new TerminalRegistry({
    env: async () => Object.fromEntries(Object.entries(await gh.env()).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    spawn: (_shell, _args, options) => spawn(command.file, command.args, options),
  })
}
