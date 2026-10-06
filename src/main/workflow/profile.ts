// Reads the Project's Profile: the list of MCP servers its agents may use (ADR-0021).
//
// The Profile lives outside the repository, in `<claude home>/profiles/<name>/profile.json`, and
// its only reader is `<claude home>/bin/profile -C <root> --field <a.b>`: exit code 0 prints the
// field (JSON for an array, the bare word `null` for a null), 3 means the folder is in no
// registered project, 4 means the field is absent. Every way of not getting a list — those codes,
// a missing script, a failed run, output that is not a list of names — falls back to the default
// list, the servers the workflow itself needs, and the reason goes to the log: a Session never
// fails to start over its Profile.
//
// Nothing here writes: the script runs with the Project as cwd and only reads.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import { CANVAS_SERVER_NAME } from '../../shared/canvas/tools'

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

export const profilePath = (claudeHome: string): string => join(claudeHome, 'bin', 'profile')

const MAX_OUTPUT = 1024 * 1024
const TIMEOUT_MS = 15_000

/**
 * The default runner: the real script as a child process, with a timeout and a size cap. `env` is
 * the user's login shell environment (src/main/agent/env.ts): the script is `#!/usr/bin/env node`,
 * and an app started from Finder has only the system PATH, where there is no node.
 */
export function profileRunner(claudeHome: string, env: ProfileEnv): ProfileRunner {
  const script = profilePath(claudeHome)
  return (cwd, args) =>
    new Promise((resolvePromise, reject) => {
      execFile(script, [...args], { cwd, env, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
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

export interface ReadMcpAllowlistOptions {
  /** The Project's root, or any folder inside it: the script's cwd and its `-C`. */
  root: string
  /** Claude Code's home; the script is `<claudeHome>/bin/profile`. */
  claudeHome: string
  /** The environment the script runs with: the login shell's, so PATH finds node. */
  env: ProfileEnv
  /** Replaces the real script in tests. */
  run?: ProfileRunner | undefined
  /** Where the reason for a fallback goes; console.warn by default. */
  log?: ((message: string) => void) | undefined
}

/** The Profile's list of MCP servers for the Project at `root`, or the default list with the reason. */
export async function readMcpAllowlist(options: ReadMcpAllowlistOptions): Promise<McpAllowlist> {
  const run = options.run ?? profileRunner(options.claudeHome, options.env)
  const log = options.log ?? ((message: string) => console.warn(message))
  const fallback = (reason: string): McpAllowlist => {
    log(`[profile] MCP servers for ${options.root}: the default list (${DEFAULT_MCP_SERVERS.join(', ')}), because ${reason}`)
    return { servers: DEFAULT_MCP_SERVERS, source: 'default', reason }
  }

  let result: ProfileRun
  try {
    result = await run(options.root, ['-C', options.root, '--field', MCP_ALLOWED_FIELD])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return fallback(`there is no profile script at ${profilePath(options.claudeHome)}`)
    return fallback(`the profile script could not be run: ${error instanceof Error ? error.message : String(error)}`)
  }

  const detail = result.stderr.trim()
  if (result.code === 3) return fallback(`the folder is in no registered project (profile exit code 3${detail ? `: ${detail}` : ''})`)
  if (result.code === 4) return fallback(`the Profile has no ${MCP_ALLOWED_FIELD} field (profile exit code 4)`)
  if (result.code === null) return fallback('the profile script timed out')
  if (result.code !== 0) return fallback(`the profile script failed with exit code ${result.code}${detail ? `: ${detail}` : ''}`)

  const stdout = result.stdout.trim()
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
