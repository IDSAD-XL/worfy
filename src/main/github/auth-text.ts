// The human-readable report of `gh auth status`, read in two places (worfy-polish ticket 76): the
// Health check row of gh (src/main/first-run/checks.ts) and the GitHub account step of "Add project"
// (./accounts.ts) when gh is older than 2.81 and has no `--json` for that command. A module with no
// imports, so both take it without one depending on the other.
//
// gh before 2.40 prints one account per host to stderr: "✓ Logged in to github.com as alice (…)".
// gh 2.40 and later prints to stdout, every account of a host with "Active account: true|false" under
// it: "✓ Logged in to github.com account alice (keyring)", or "X Failed to log in to github.com account
// alice (keyring)" when its token does not work. Callers pass stdout and stderr together.

/** An account the text names: the fields `gh auth status --json hosts` gives for it too. */
export interface TextAccount {
  login: string
  host: string
  active: boolean
  /** `success` for "Logged in", `error` for "Failed to log in", as the JSON names them. */
  state: string
}

// Logins have letters, digits and hyphens; managed users of GitHub Enterprise add `_<shortcode>`.
const ACCOUNT_LINE = /(Logged in|Failed to log in) to (\S+) (?:account|as) ([A-Za-z0-9_-]+)/u
const ACTIVE_LINE = /Active account: (true|false)/u

/** The accounts of `gh auth status` in the order gh lists them; a line without a login is skipped. */
export function parseAuthText(output: string): TextAccount[] {
  const accounts: TextAccount[] = []
  const marked = new Set<TextAccount>()
  for (const line of output.split(/\r?\n/u)) {
    const named = ACCOUNT_LINE.exec(line)
    if (named !== null) {
      accounts.push({ login: named[3] ?? '', host: named[2] ?? '', active: false, state: named[1] === 'Logged in' ? 'success' : 'error' })
      continue
    }
    const active = ACTIVE_LINE.exec(line)
    const last = accounts.at(-1)
    if (active !== null && last !== undefined) {
      last.active = active[1] === 'true'
      marked.add(last)
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
