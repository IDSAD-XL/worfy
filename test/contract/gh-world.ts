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
  token: string
}

/** Per repository `owner/repo`, per login: `permissions.push`, or the HTTP status gh fails with. */
export type StubRepos = Record<string, Record<string, boolean | number>>

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

/** A gh world in `dir`: what `auth status`, `auth token`, `api repos/…` and `auth login` answer. */
export function ghWorld(dir: string, spec: { accounts: readonly StubAccount[]; repos?: StubRepos; login?: StubAccount }): GhWorld {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'auth-status.json'), JSON.stringify(authStatus(spec.accounts)))
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
    // The developer's own GH_TOKEN and GITHUB_TOKEN stay out: the stub answers `api repos/…` by GH_TOKEN.
    run: ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve({ ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, ...env }), timeoutMs: 15_000 }),
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
  }
}
