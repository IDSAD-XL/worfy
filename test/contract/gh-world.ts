// The accounts, tokens and repositories the gh stand-in (test/fixtures/gh/gh-stub.mjs) answers with, written into a
// folder for GH_STUB_DIR, and a runner that points worfy's gh code at the stand-in (worfy-harness
// ticket 25). Nothing reaches GitHub or the machine's own gh.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ghRunner, type GhRunner } from '../../src/main/github/prs'

export interface StubAccount {
  login: string
  host?: string
  active?: boolean
  state?: string
  /** Where gh took the token: `keyring` by default; an environment variable such as GH_TOKEN for an entry with an empty login. */
  source?: string
  token: string
}

/** Per repository `owner/repo`, per login: `permissions.push` (null or a text: an odd answer), or the HTTP status gh fails with. */
export type StubRepos = Record<string, Record<string, boolean | null | string | number>>

export interface GhWorld {
  dir: string
  /** GH_STUB_LOG: one JSON line of arguments per call. */
  log: string
  /** The stand-in executable (WORFY_GH). */
  command: string
  /** The environment the stand-in needs. */
  env: Record<string, string>
  run: GhRunner
  /** The arguments of every call so far. */
  calls: () => string[][]
}

/**
 * The stand-in as WORFY_GH names it: the `gh` wrapper, a shell script; on Windows, which cannot
 * start one, the Node script itself, which worfy runs under its own Node (src/main/program.ts).
 */
export const STUB_COMMAND = join(__dirname, '..', 'fixtures', 'gh', process.platform === 'win32' ? 'gh-stub.mjs' : 'gh')

/** `gh auth status --json hosts` as gh 2.97 prints it. */
export function authStatus(accounts: readonly StubAccount[]): { hosts: Record<string, unknown[]> } {
  const hosts: Record<string, unknown[]> = {}
  for (const account of accounts) {
    const host = account.host ?? 'github.com'
    ;(hosts[host] ??= []).push({ active: account.active ?? false, gitProtocol: 'https', host, login: account.login, scopes: 'gist, read:org, repo', state: account.state ?? 'success', tokenSource: 'keyring' })
  }
  return { hosts }
}

/**
 * `gh auth status` without flags as gh 2.40 to 2.80 prints it (pkg/cmd/auth/status/status.go, authEntry.String):
 * an entry per account, `success`, `error` or `timeout`; an empty login is the entry of a token from the
 * environment, "using token (<source>)". Every entry has its "Active account" line.
 */
export function authStatusText(accounts: readonly StubAccount[]): string {
  const hosts = new Map<string, string[]>()
  for (const account of accounts) {
    const host = account.host ?? 'github.com'
    const source = account.source ?? 'keyring'
    const who = account.login === '' ? `using token (${source})` : `account ${account.login} (${source})`
    const active = `  - Active account: ${String(account.active ?? false)}`
    const state = account.state ?? 'success'
    let lines: string[]
    if (state === 'success') lines = [`  ✓ Logged in to ${host} ${who}`, active, '  - Git operations protocol: https', '  - Token: gho_************************************', "  - Token scopes: 'gist', 'read:org', 'repo'"]
    else if (state === 'timeout') lines = [`  X Timeout trying to log in to ${host} ${who}`, active]
    else {
      lines = [`  X Failed to log in to ${host} ${who}`, active, `  - The token in ${source} is invalid.`]
      // gh offers to sign in again only for a token it stores itself, not for one from the environment.
      if (!source.endsWith('_TOKEN')) lines.push(`  - To re-authenticate, run: gh auth login -h ${host}`, `  - To forget about this account, run: gh auth logout -h ${host} -u ${account.login}`)
    }
    hosts.set(host, [...(hosts.get(host) ?? []), lines.join('\n')])
  }
  if (hosts.size === 0) return 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n'
  return `${[...hosts].map(([host, blocks]) => `${host}\n${blocks.join('\n\n')}`).join('\n\n')}\n`
}

/**
 * A gh older than 2.81, which has no `auth status --json`: `--version` prints `version`, `auth status
 * --json …` fails with "unknown flag: --json", and `auth status` prints `text` to `stream` and exits `code`.
 */
export interface OldGh {
  version: string
  text: string
  stream?: 'stdout' | 'stderr'
  code?: number
}

/** A gh world in `dir`: what `auth status`, `auth token`, `api repos/…` and `auth login` answer. */
export function ghWorld(dir: string, spec: { accounts: readonly StubAccount[]; repos?: StubRepos; login?: StubAccount; oldGh?: OldGh }): GhWorld {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'auth-status.json'), JSON.stringify(authStatus(spec.accounts)))
  if (spec.oldGh !== undefined) writeFileSync(join(dir, 'old-gh.json'), JSON.stringify(spec.oldGh))
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify(Object.fromEntries(spec.accounts.map((account) => [account.login, account.token]))))
  writeFileSync(join(dir, 'repos.json'), JSON.stringify(spec.repos ?? {}))
  if (spec.login !== undefined) writeFileSync(join(dir, 'login.json'), JSON.stringify(spec.login))
  const log = join(dir, 'calls.jsonl')
  writeFileSync(log, '')
  const env = { GH_STUB_DIR: dir, GH_STUB_LOG: log }
  return {
    dir,
    log,
    command: STUB_COMMAND,
    env,
    // The developer's own gh tokens stay out: the stub answers `api repos/…` by GH_TOKEN.
    run: ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve({ ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined, ...env }), timeoutMs: 15_000 }),
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
  }
}
