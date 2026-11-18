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
//
// The word in parentheses after the login is where gh took the token (worfy-auth-check ticket 05):
// `keyring`, a hosts.yml path or `oauth_token` for a token gh stores, or the name of an environment
// variable — `(GH_TOKEN)`, `(GITHUB_TOKEN)` — for a token gh takes from its environment over the stored
// ones. parseAuthEntries keeps it; parseAuthText reads the logins as before.

/** An account the text names: the fields `gh auth status --json hosts` gives for it too. */
export interface TextAccount {
  login: string
  host: string
  active: boolean
  /** `success` for "Logged in", `error` for "Failed to log in", `timeout` for "Timeout trying to log in", as the JSON names them. */
  state: string
}

/** An entry of the text, with or without a login, and where its token comes from. */
export interface AuthEntry extends Omit<TextAccount, 'login'> {
  /** null for the entry of a token from the environment that gh could not sign in with. */
  login: string | null
  /** What the parentheses after the entry say: `keyring`, `GH_TOKEN`, a hosts.yml path; null without them. */
  source: string | null
}

/** The variables gh takes a token from over the stored ones (`gh help environment`). */
const TOKEN_VARIABLE = /^(?:GH|GITHUB)(?:_ENTERPRISE)?_TOKEN$/u

/** Whether an entry's source is a variable of gh's environment rather than a token gh stores. */
export const isTokenVariable = (source: string | null): source is string => source !== null && TOKEN_VARIABLE.test(source)

// Logins have letters, digits and hyphens; managed users of GitHub Enterprise add `_<shortcode>`.
const ENTRY = /(Logged in|Failed to log in|Timeout trying to log in) to (\S+) (?:(?:account|as) ([A-Za-z0-9_-]+)|using token)(?: \(([^)\r\n]+)\))?/u
const STATES: Readonly<Record<string, string>> = { 'Logged in': 'success', 'Failed to log in': 'error', 'Timeout trying to log in': 'timeout' }
/** The first line of an entry, or of a check of gh before 2.40: ✓ or X after the indent. */
const ENTRY_LINE = /^\s*(?:✓|X)\s/u
const ACTIVE_LINE = /Active account: (true|false)/u

/** The entries in the order gh lists them, and those an "Active account" line marked. */
function readEntries(output: string): { entries: AuthEntry[]; marked: Set<AuthEntry> } {
  const entries: AuthEntry[] = []
  const marked = new Set<AuthEntry>()
  // The entry being read: an "Active account" line belongs to it, never to an earlier one.
  let current: AuthEntry | null = null
  for (const line of output.split(/\r?\n/u)) {
    const named = ENTRY.exec(line)
    if (named !== null) {
      current = { login: named[3] ?? null, host: named[2] ?? '', active: false, state: STATES[named[1] ?? ''] ?? 'error', source: named[4] ?? null }
      entries.push(current)
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
  return { entries, marked }
}

/** gh before 2.40 has one account per host and prints no "Active account" line: that account is the active one. */
function markLoneActive<T extends { host: string; active: boolean }>(entries: T[], marked: ReadonlySet<unknown>): T[] {
  for (const entry of entries) {
    if (!marked.has(entry) && entries.filter((each) => each.host === entry.host).length === 1) entry.active = true
  }
  return entries
}

/** The accounts of `gh auth status` in the order gh lists them; an entry without a login is skipped. */
export function parseAuthText(output: string): TextAccount[] {
  const { entries, marked } = readEntries(output)
  const named = entries.filter((entry): entry is AuthEntry & { login: string } => entry.login !== null)
  return markLoneActive(named, marked).map(({ login, host, active, state }) => ({ login, host, active, state }))
}

/** Every entry of `gh auth status`, a token from the environment without a login included, with its source. */
export function parseAuthEntries(output: string): AuthEntry[] {
  const { entries, marked } = readEntries(output)
  return markLoneActive(entries, marked)
}

/** An entry of a token gh takes from its environment: the variable's name and the entry's state, never the value. */
export interface EnvironmentToken {
  variable: string
  host: string
  /** `success`, `error` (the token does not work) or `timeout`. */
  state: string
  active: boolean
  /** The account the token signs in as; null when gh could not sign in with it. */
  login: string | null
}

/** The entries of `gh auth status` whose token comes from a variable of gh's environment (`(GH_TOKEN)`, `(GITHUB_TOKEN)`). */
export function environmentTokens(output: string): EnvironmentToken[] {
  return parseAuthEntries(output)
    .filter((entry): entry is AuthEntry & { source: string } => isTokenVariable(entry.source))
    .map(({ source, host, state, active, login }) => ({ variable: source, host, state, active, login }))
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
