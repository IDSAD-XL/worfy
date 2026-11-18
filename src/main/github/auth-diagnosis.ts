// What stands between gh and a Project's repositories (worfy-auth-check ticket 05; spec, implementation
// decisions, 3): whose token gh takes, and what GitHub answered to it. No SSO here: the X-GitHub-SSO
// header and `partial-results` are ticket 06. No imports beyond the text of `gh auth status`, nothing run:
// the Health check rows (src/main/first-run/checks.ts) run gh and hand its output here.
//
// Whose token gh takes (`gh help environment`; spike of ticket 01, "who wins"):
// - a caller that goes through accountAuth (src/main/github/prs.ts) with the Profile's `github.account`
//   gives gh GH_TOKEN of that account from gh's keyring (`gh auth token -u <login>`); it overrides
//   any variable of the environment;
// - otherwise GH_TOKEN, then GITHUB_TOKEN of gh's environment, when set and not empty, over the stored
//   accounts. The environment is the login shell's on macOS (a variable reaches it only through an rc
//   file, even after `launchctl setenv`) and the registry's on Windows (`setx`, ADR-0057);
// - otherwise the active account gh stores (the keyring).
// Only the name of a variable is ever returned, never its value.
//
// What GitHub answered, from `gh api -i repos/<owner>/<repo>` (status line, headers, blank line, body):
// 2xx — access; 401 — the token does not work; 404 — no access (GitHub answers 404, not 403, for a
// private repository the token cannot see); no status line with gh's "gh auth login" text (exit 4) —
// gh has no token at all; no network, a timeout, 5xx, 429 — unknown, never a failure. The body is
// never quoted: a reason names the status and nothing gh printed beyond its last line when no
// status came.
import { environmentTokens, type EnvironmentToken } from './auth-text'

/** The variables gh takes a github.com token from, in gh's order. */
export const TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN'] as const
export type TokenVariable = (typeof TOKEN_VARIABLES)[number]

type Env = Readonly<Record<string, string | undefined>>

/** The value of `name` in `env`; on Windows the name compares without case, as the system does. */
function valueOf(env: Env, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find((each) => each.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/** The variable of `env` gh takes its github.com token from, or null when none is set: an empty one counts as unset, as gh reads it. */
export function environmentToken(env: Env, platform: NodeJS.Platform = process.platform): TokenVariable | null {
  for (const name of TOKEN_VARIABLES) {
    const value = valueOf(env, name, platform)
    if (value !== undefined && value !== '') return name
  }
  return null
}

/** Where the token gh uses comes from. */
export type TokenSource =
  /** The Profile's `github.account`, its token from gh's keyring through accountAuth. */
  | { kind: 'account'; login: string }
  /** A variable of gh's environment. */
  | { kind: 'environment'; variable: TokenVariable }
  /** The active account gh stores. */
  | { kind: 'keyring' }

/** Whose token gh takes for a call: the account's when the caller passes one through accountAuth, else the environment's, else the keyring's. */
export function tokenSource(options: { account: string | null; env: Env; platform?: NodeJS.Platform }): TokenSource {
  if (options.account !== null) return { kind: 'account', login: options.account }
  const variable = environmentToken(options.env, options.platform)
  return variable === null ? { kind: 'keyring' } : { kind: 'environment', variable }
}

/** The source in words, for a row's detail: never a value. */
export function sourceText(source: TokenSource): string {
  if (source.kind === 'account') return `the token of ${source.login} from gh's keyring`
  if (source.kind === 'environment') return `${source.variable} from the environment`
  return "the token of gh's active account"
}

/**
 * The entry of `gh auth status` whose token comes from the environment and that gh uses: the active one, else
 * the first; null when gh took no token from a variable.
 */
export function environmentEntry(authStatus: string): EnvironmentToken | null {
  const entries = environmentTokens(authStatus)
  return entries.find((entry) => entry.active) ?? entries[0] ?? null
}

/** What GitHub answered to `gh api -i repos/<owner>/<repo>`. */
export type RepoAccess =
  | { kind: 'ok' }
  /** 401: the token does not work — invalid, revoked or expired. */
  | { kind: 'bad-token' }
  /** 404: the repository is not there for this token. */
  | { kind: 'no-access' }
  /** gh has no token at all (exit 4, "gh auth login"). */
  | { kind: 'no-token' }
  /** Another 4xx; a 403 of SSO is read by ticket 06. */
  | { kind: 'refused'; status: number }
  /** It could not be checked: no network, a timeout, GitHub 5xx or its rate limit. */
  | { kind: 'unknown'; reason: string }

const STATUS_LINE = /^HTTP\/[\d.]+ (\d{3})\b/mu
/** gh's text when it has no token at all (fixture api-no-auth of ticket 01). */
const NO_TOKEN = /\bgh auth login\b/u
/** The longest reason taken from gh's own words. */
const REASON_MAX = 160

/** The last line of gh's text, at most REASON_MAX characters; without the token-shaped words gh never prints there anyway. */
function lastWords(text: string): string {
  const line =
    text
      .split(/\r?\n/u)
      .map((each) => each.trim())
      .filter((each) => each !== '')
      .at(-1) ?? ''
  const words = line.replace(/\b(?:gh[pousr]_|github_pat_)\S+/gu, '[token]')
  return words.length > REASON_MAX ? `${words.slice(0, REASON_MAX - 1)}…` : words
}

/**
 * The answer of `gh api -i repos/<owner>/<repo>`: `output` — what gh printed (stdout and stderr) when it
 * exited, with any exit code; `failure` — why it did not finish (a timeout, a signal, gh not found), with
 * nothing printed to read.
 */
export function repoAccess(answer: { output: string } | { failure: string }): RepoAccess {
  if ('failure' in answer) return { kind: 'unknown', reason: lastWords(answer.failure) || 'gh did not answer' }
  const status = STATUS_LINE.exec(answer.output)
  if (status === null) {
    if (NO_TOKEN.test(answer.output)) return { kind: 'no-token' }
    return { kind: 'unknown', reason: lastWords(answer.output) || 'gh printed no answer of GitHub' }
  }
  const code = Number(status[1])
  if (code >= 200 && code < 300) return { kind: 'ok' }
  if (code === 401) return { kind: 'bad-token' }
  if (code === 404) return { kind: 'no-access' }
  if (code >= 500 || code === 429) return { kind: 'unknown', reason: `GitHub answered HTTP ${code}` }
  return { kind: 'refused', status: code }
}

/**
 * The command that removes a variable from the user's environment, for the user to copy: worfy never
 * changes the environment itself (spec, the repair). macOS: the variable of launchd (`launchctl setenv`);
 * an rc file that exports it is the user's to edit. Windows: the user's variable in the registry.
 */
export function removeVariableCommand(variable: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `[Environment]::SetEnvironmentVariable('${variable}', $null, 'User')`
  if (platform === 'darwin') return `launchctl unsetenv ${variable}`
  return `unset ${variable}`
}

/**
 * `gh auth login` with the token variables out of its environment, for the user to copy: gh refuses to
 * sign in while GH_TOKEN or GITHUB_TOKEN is set ("The value of the GH_TOKEN environment variable is being
 * used for authentication"), and a Terminal Node gets the same environment gh does.
 */
export function signInWithoutVariables(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue; gh auth login'
  return 'env -u GH_TOKEN -u GITHUB_TOKEN gh auth login'
}

/** Where else the variable may be set, said next to the command. */
export function variableHome(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'your user variables (setx)'
  return 'your shell startup files (~/.zshrc, ~/.zprofile)'
}
