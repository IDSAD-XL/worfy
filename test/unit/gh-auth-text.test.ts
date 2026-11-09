// The human-readable report of `gh auth status` (src/main/github/auth-text.ts, worfy-polish ticket 76):
// what the GitHub account step reads from a gh without `--json` (older than 2.81), and what the Health
// check row shows, from samples of gh 2.39 (stderr, "as <login>") and 2.40+ (stdout, "account <login>").
import { describe, expect, it } from 'vitest'
import { ghAccounts as healthCheckAccounts } from '../../src/main/first-run/checks'
import { ghAccounts, ghVersion, parseAuthText } from '../../src/main/github/auth-text'

/** gh 2.39: one account per host, on stderr, no "Active account" line. */
const GH_2_39 = [
  'github.com',
  '  ✓ Logged in to github.com as alice (/tmp/gh-config/hosts.yml)',
  '  ✓ Git operations for github.com configured to use https protocol.',
  '  ✓ Token: gho_************************************',
  '  ✓ Token scopes: gist, read:org, repo, workflow',
  '',
  'ghe.example.com',
  '  ✓ Logged in to ghe.example.com as corp (GH_ENTERPRISE_TOKEN)',
  '',
].join('\n')

/**
 * gh 2.40 to 2.80 (pkg/cmd/auth/status/status.go, authEntry.String), on stdout: several accounts per host, a
 * failed one among them, and a failed token from the environment, which has no login but its own "Active
 * account" line.
 */
const GH_2_60 = [
  'github.com',
  '  ✓ Logged in to github.com account alice (keyring)',
  '  - Active account: false',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
  '',
  '  ✓ Logged in to github.com account bob_acme (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'read:org', 'repo'",
  '',
  '  X Failed to log in to github.com account carol (keyring)',
  '  - Active account: false',
  '  - The token in keyring is invalid.',
  '  - To re-authenticate, run: gh auth login -h github.com',
  '  - To forget about this account, run: gh auth logout -h github.com -u carol',
  '',
  'ghe.example.com',
  '  X Failed to log in to ghe.example.com using token (GH_ENTERPRISE_TOKEN)',
  '  - Active account: true',
  '  - The token in GH_ENTERPRISE_TOKEN is invalid.',
  '',
].join('\r\n')

/** gh 2.40 to 2.80 when GitHub did not answer in time for the active account. */
const TIMED_OUT = [
  'github.com',
  '  ✓ Logged in to github.com account alice (keyring)',
  '  - Active account: false',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'read:org', 'repo'",
  '',
  '  X Timeout trying to log in to github.com account bob (keyring)',
  '  - Active account: true',
  '',
].join('\n')

describe('parseAuthText', () => {
  it('gh 2.39: login and host of each line; the one account of a host is the active one', () => {
    expect(parseAuthText(GH_2_39)).toEqual([
      { login: 'alice', host: 'github.com', active: true, state: 'success' },
      { login: 'corp', host: 'ghe.example.com', active: true, state: 'success' },
    ])
  })

  it('gh 2.40+: "Active account" under each account, a failed sign-in is not success, a token entry is skipped', () => {
    expect(parseAuthText(GH_2_60)).toEqual([
      { login: 'alice', host: 'github.com', active: false, state: 'success' },
      { login: 'bob_acme', host: 'github.com', active: true, state: 'success' },
      { login: 'carol', host: 'github.com', active: false, state: 'error' },
    ])
  })

  it('a timed-out account is read with state timeout and keeps its own "Active account" line', () => {
    expect(parseAuthText(TIMED_OUT)).toEqual([
      { login: 'alice', host: 'github.com', active: false, state: 'success' },
      { login: 'bob', host: 'github.com', active: true, state: 'timeout' },
    ])
    expect(parseAuthText('github.com\n  X Timeout trying to log in to github.com account bob (keyring)\n  - Active account: true\n')).toEqual([{ login: 'bob', host: 'github.com', active: true, state: 'timeout' }])
  })

  it('an entry without a login takes its "Active account" line with it, never to the account before it', () => {
    const text = [
      'github.com',
      '  X Timeout trying to log in to github.com using token (GH_TOKEN)',
      '  - Active account: true',
      '',
      '  ✓ Logged in to github.com account alice (keyring)',
      '  - Active account: false',
      '',
      'ghe.example.com',
      '  X Failed to log in to ghe.example.com using token (GH_ENTERPRISE_TOKEN)',
      '  - Active account: true',
      '  - The token in GH_ENTERPRISE_TOKEN is invalid.',
      '',
      '  ✓ Logged in to ghe.example.com account corp (keyring)',
      '  - Active account: false',
      '',
    ].join('\n')
    expect(parseAuthText(text)).toEqual([
      { login: 'alice', host: 'github.com', active: false, state: 'success' },
      { login: 'corp', host: 'ghe.example.com', active: false, state: 'success' },
    ])
  })

  it('two accounts of one host without "Active account" lines: neither is taken for active', () => {
    const text = '  ✓ Logged in to github.com account alice (keyring)\n  ✓ Logged in to github.com account bob (keyring)\n'
    expect(parseAuthText(text).map((account) => account.active)).toEqual([false, false])
  })

  it('no account: not signed in, or a text it does not know', () => {
    expect(parseAuthText('You are not logged into any GitHub hosts. To log in, run: gh auth login\n')).toEqual([])
    expect(parseAuthText('unknown command "status" for "gh auth"\n')).toEqual([])
  })
})

describe('ghAccounts, the Health check row', () => {
  it('reads the same samples as before: signed-in accounts as host: login, failed ones left out', () => {
    expect(ghAccounts(GH_2_39)).toEqual(['github.com: alice', 'ghe.example.com: corp'])
    expect(ghAccounts(GH_2_60)).toEqual(['github.com: alice', 'github.com: bob_acme'])
    expect(ghAccounts(TIMED_OUT)).toEqual(['github.com: alice'])
    expect(ghAccounts('You are not logged into any GitHub hosts.')).toEqual([])
  })

  it('is the function checks.ts exports, not a copy', () => {
    expect(healthCheckAccounts).toBe(ghAccounts)
  })
})

describe('ghVersion', () => {
  it('the version of the first line of gh --version, or null', () => {
    expect(ghVersion('gh version 2.39.1 (2023-11-14)\nhttps://github.com/cli/cli/releases/tag/v2.39.1\n')).toBe('2.39.1')
    expect(ghVersion('gh version 2.81.0 (2025-10-01)')).toBe('2.81.0')
    expect(ghVersion('gh version DEV')).toBeNull()
    expect(ghVersion('')).toBeNull()
  })
})
