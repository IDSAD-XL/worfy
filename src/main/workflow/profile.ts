// Reads the Project's Profile: the list of MCP servers its agents may use (ADR-0021) and the
// GitHub account worfy's own gh calls go with (ADR-0020, worfy-week ticket 01).
//
// The Profile lives outside the repository — `<claude home>/profiles/<name>/profile.json` with the
// old Harness, `<Harness home>/projects/<name>/` with the plugin — and its only reader is the
// Harness's `bin/profile -C <root> --field <a.b>` (src/main/harness/locate.ts says which; the
// plugin's script gets HARNESS_HOME): exit code 0 prints the
// field (JSON for an array, the bare string for a string, the bare word `null` for a null), 3 means
// the folder is in no registered project, 4 means the field is absent. Every way of not getting a
// value — those codes, a missing script, a failed run, output of the wrong shape — falls back to
// what worfy did without a Profile (the default MCP list; gh with the login shell's own account),
// and the reason goes to the log: nothing fails over its Profile.
//
// Nothing here writes: the script runs with the Project as cwd and only reads.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import { CANVAS_SERVER_NAME } from '../../shared/canvas/tools'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'

/** The script's environment, for example the login shell's from src/main/agent/env.ts. */
export type ProfileEnv = Readonly<Record<string, string | undefined>>

/** The Profile field with the list of MCP server names. */
export const MCP_ALLOWED_FIELD = 'mcp.allowed'

/** The servers the workflow needs: `qmd` (ADRs, lessons, Tickets) and the canvas. */
export const DEFAULT_MCP_SERVERS: readonly string[] = Object.freeze(['qmd', CANVAS_SERVER_NAME])

/** What one run of `bin/profile` ended with. */
export interface ProfileRun {
  /** The exit code; null when the process was killed (timeout). */
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Runs `bin/profile` with `args` in `cwd`. Resolves with the exit code whatever it is; rejects when
 * the script cannot be started (ENOENT when there is none).
 */
export type ProfileRunner = (cwd: string, args: readonly string[]) => Promise<ProfileRun>

/**
 * The `profile` script of the Harness found on the machine (src/main/harness/locate.ts): the
 * plugin's in <harnessHome>/plugin/bin, or the old one in <claudeHome>/bin.
 */
export const profilePath = (claudeHome: string): string => join(locateHarness(harnessHomes(claudeHome)).binDir, 'profile')

const MAX_OUTPUT = 1024 * 1024
const TIMEOUT_MS = 15_000

/**
 * The default runner: the real script as a child process, with a timeout and a size cap. `env` is
 * the user's login shell environment (src/main/agent/env.ts): the script is `#!/usr/bin/env node`,
 * and an app started from Finder has only the system PATH, where there is no node.
 */
export function profileRunner(claudeHome: string, env: ProfileEnv): ProfileRunner {
  return (cwd, args) =>
    new Promise((resolvePromise, reject) => {
      // Looked for on every run; the plugin's script gets HARNESS_HOME, where its Profiles are.
      const harness = locateHarness(harnessHomes(claudeHome))
      const script = join(harness.binDir, 'profile')
      execFile(script, [...args], { cwd, env: scriptEnv(harness, env), maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error) return resolvePromise({ code: 0, stdout, stderr })
        const code = (error as NodeJS.ErrnoException).code
        // A number is the script's exit code; a string is a failure to start it (ENOENT, EACCES…).
        if (typeof code === 'number') return resolvePromise({ code, stdout, stderr })
        if (error.killed || error.signal) return resolvePromise({ code: null, stdout, stderr })
        reject(error)
      })
    })
}

/** The MCP servers a Session in the Project gets, and where the list came from. */
export interface McpAllowlist {
  servers: readonly string[]
  /** `profile`: the Profile's own list; `default`: DEFAULT_MCP_SERVERS, for `reason`. */
  source: 'profile' | 'default'
  /** Why the default list is used; null when the list is the Profile's. */
  reason: string | null
}

const serverNames = z.array(z.string().trim().min(1))

export interface ReadProfileOptions {
  /** The Project's root, or any folder inside it: the script's cwd and its `-C`. */
  root: string
  /** Claude Code's home; the script is that of the Harness found from it (profilePath). */
  claudeHome: string
  /** The environment the script runs with: the login shell's, so PATH finds node. */
  env: ProfileEnv
  /** Replaces the real script in tests. */
  run?: ProfileRunner | undefined
  /** Where the reason for a fallback goes; console.warn by default. */
  log?: ((message: string) => void) | undefined
}

export type ReadMcpAllowlistOptions = ReadProfileOptions

/** One field of the Profile: its printed value, or why there is none. */
type FieldRead = { ok: true; stdout: string } | { ok: false; reason: string }

/** Runs `bin/profile -C <root> --field <field>` and turns every exit but code 0 into a reason. */
async function readField(options: ReadProfileOptions, field: string): Promise<FieldRead> {
  const run = options.run ?? profileRunner(options.claudeHome, options.env)
  const none = (reason: string): FieldRead => ({ ok: false, reason })

  let result: ProfileRun
  try {
    result = await run(options.root, ['-C', options.root, '--field', field])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // With no Harness found this names <claudeHome>/bin/profile, where it was looked for before the plugin.
    if (code === 'ENOENT') return none(`there is no profile script at ${profilePath(options.claudeHome)}`)
    return none(`the profile script could not be run: ${error instanceof Error ? error.message : String(error)}`)
  }

  const detail = result.stderr.trim()
  if (result.code === 3) return none(`the folder is in no registered project (profile exit code 3${detail ? `: ${detail}` : ''})`)
  if (result.code === 4) return none(`the Profile has no ${field} field (profile exit code 4)`)
  if (result.code === null) return none('the profile script timed out')
  if (result.code !== 0) return none(`the profile script failed with exit code ${result.code}${detail ? `: ${detail}` : ''}`)
  return { ok: true, stdout: result.stdout.trim() }
}

/** The Profile's list of MCP servers for the Project at `root`, or the default list with the reason. */
export async function readMcpAllowlist(options: ReadMcpAllowlistOptions): Promise<McpAllowlist> {
  const log = options.log ?? ((message: string) => console.warn(message))
  const fallback = (reason: string): McpAllowlist => {
    log(`[profile] MCP servers for ${options.root}: the default list (${DEFAULT_MCP_SERVERS.join(', ')}), because ${reason}`)
    return { servers: DEFAULT_MCP_SERVERS, source: 'default', reason }
  }

  const field = await readField(options, MCP_ALLOWED_FIELD)
  if (!field.ok) return fallback(field.reason)
  const stdout = field.stdout
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return fallback(`${MCP_ALLOWED_FIELD} is not JSON: ${JSON.stringify(stdout.slice(0, 200))}`)
  }
  if (json === null) return fallback(`${MCP_ALLOWED_FIELD} is null`)
  const parsed = serverNames.safeParse(json)
  if (!parsed.success) return fallback(`${MCP_ALLOWED_FIELD} is not a list of server names: ${JSON.stringify(stdout.slice(0, 200))}`)
  return { servers: [...new Set(parsed.data)], source: 'profile', reason: null }
}

// ── the GitHub account ───────────────────────────────────────────────────────

/** The Profile field with the login of the GitHub account the Project's repository belongs to. */
export const GITHUB_ACCOUNT_FIELD = 'github.account'

/**
 * A GitHub login: letters, digits and single hyphens, at most 39 characters, never starting with a
 * hyphen — so it can never be read by gh as an option.
 */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u

/** The Project's GitHub account, or null with the reason there is none. */
export interface GithubAccount {
  account: string | null
  /** Why there is no account; null when there is one. */
  reason: string | null
}

/**
 * The GitHub account the Profile names for the Project at `root` (`github.account`). Without one —
 * exit code 3 or 4, `null`, no script, a failed run, a value that is not a login — the account is
 * null, gh goes with the login shell's own account as before, and the reason is logged.
 */
export async function readGithubAccount(options: ReadProfileOptions): Promise<GithubAccount> {
  const log = options.log ?? ((message: string) => console.warn(message))
  const none = (reason: string): GithubAccount => {
    log(`[profile] GitHub account for ${options.root}: none, gh runs with the login shell's own account, because ${reason}`)
    return { account: null, reason }
  }

  const field = await readField(options, GITHUB_ACCOUNT_FIELD)
  if (!field.ok) return none(field.reason)
  // A string field prints bare; a JSON-quoted one is taken too.
  let value = field.stdout
  if (value.startsWith('"')) {
    try {
      const json: unknown = JSON.parse(value)
      if (typeof json === 'string') value = json.trim()
    } catch {
      // Not JSON: checked as it is below.
    }
  }
  if (value === 'null') return none(`${GITHUB_ACCOUNT_FIELD} is null`)
  if (value === '') return none(`${GITHUB_ACCOUNT_FIELD} is empty`)
  if (!GITHUB_LOGIN.test(value)) return none(`${GITHUB_ACCOUNT_FIELD} is not a GitHub login: ${JSON.stringify(value.slice(0, 200))}`)
  return { account: value, reason: null }
}
