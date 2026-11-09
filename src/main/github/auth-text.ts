// The human-readable report of `gh auth status`, read in two places (worfy-polish ticket 76): the
// Health check row of gh (src/main/first-run/checks.ts) and the GitHub account step of "Add project"
// (./accounts.ts) when gh is older than 2.81 and has no `--json` for that command. A module with no
// imports, so both take it without one depending on the other.
//
// gh before 2.40 prints one account per host to stderr: "✓ Logged in to github.com as alice (…)".
// gh 2.40 and later (pkg/cmd/auth/status/status.go) prints to stdout one entry per account, its first
// line marked ✓ or X and "- Active account: true|false" under it:
//   ✓ Logged in to github.com account alice (keyring)
//   X Failed to log in to github.com account alice (keyring)        the token does not work
//   X Timeout trying to log in to github.com account alice (keyring) GitHub did not answer in time
// An entry of a token from the environment has no login ("X Failed to log in to github.com using token
// (GH_TOKEN)") but still an "Active account" line. Callers pass stdout and stderr together.

/** An account the text names: the fields `gh auth status --json hosts` gives for it too. */
export interface TextAccount {
  login: string
  host: string
  active: boolean
  /** `success` for "Logged in", `error` for "Failed to log in", `timeout` for "Timeout trying to log in", as the JSON names them. */
  state: string
}

// Logins have letters, digits and hyphens; managed users of GitHub Enterprise add `_<shortcode>`.
const ACCOUNT_LINE = /(Logged in|Failed to log in|Timeout trying to log in) to (\S+) (?:account|as) ([A-Za-z0-9_-]+)/u
const STATES: Readonly<Record<string, string>> = { 'Logged in': 'success', 'Failed to log in': 'error', 'Timeout trying to log in': 'timeout' }
/** The first line of an entry, or of a check of gh before 2.40: ✓ or X after the indent. */
const ENTRY_LINE = /^\s*(?:✓|X)\s/u
const ACTIVE_LINE = /Active account: (true|false)/u

/** The accounts of `gh auth status` in the order gh lists them; an entry without a login is skipped. */
export function parseAuthText(output: string): TextAccount[] {
  const accounts: TextAccount[] = []
  const marked = new Set<TextAccount>()
  // The account of the entry being read: an "Active account" line belongs to it, never to an earlier one.
  let current: TextAccount | null = null
  for (const line of output.split(/\r?\n/u)) {
    const named = ACCOUNT_LINE.exec(line)
    if (named !== null) {
      current = { login: named[3] ?? '', host: named[2] ?? '', active: false, state: STATES[named[1] ?? ''] ?? 'error' }
      accounts.push(current)
      continue
    }
    if (ENTRY_LINE.test(line)) {
      current = null
      continue
    }
    const active = ACTIVE_LINE.exec(line)
    if (active !== null && current !== null) {
      current.active = active[1] === 'true'
      marked.add(current)
    }
  }
  // gh before 2.40 has one account per host and prints no "Active account" line: that account is the active one.
  for (const account of accounts) {
    if (!marked.has(account) && accounts.filter((each) => each.host === account.host).length === 1) account.active = true
  }
  return accounts
}

/** The signed-in accounts of `gh auth status` as the Health check shows them, `host: login`. */
export function ghAccounts(output: string): string[] {
  return parseAuthText(output)
    .filter((account) => account.state === 'success')
    .map((account) => `${account.host}: ${account.login}`)
}

/** The version of `gh --version` ("gh version 2.39.1 (2023-11-14)"), or null when it prints none. */
export function ghVersion(output: string): string | null {
  return /^gh version (\d+\.\d+\.\d+)/mu.exec(output)?.[1] ?? null
}
