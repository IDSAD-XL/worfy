// The environment of the Claude Code process (ADR-0007).
//
// An app started from Finder gets a bare PATH from launchd (/usr/bin:/bin:/usr/sbin:/sbin), so
// neither Claude Code nor the user's hooks would find node, pnpm or gh. worfy therefore takes the
// environment of the user's interactive login shell (`$SHELL -ilc`), once, with a timeout. The
// shell starts from a minimal environment, so variables of whoever started worfy (for example a
// parent Claude Code session when worfy runs from a terminal) never reach the child Claude Code.
// From the shell's environment only ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed: with
// them Claude Code would log in by key instead of the user's subscription.
import { execFile } from 'node:child_process'

export type Env = Record<string, string>
type SourceEnv = Readonly<Record<string, string | undefined>>

/** What the shell starts with, besides PATH: the variables that describe the user and the session. */
export const SHELL_BASE_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'SSH_AUTH_SOCK', '__CF_USER_TEXT_ENCODING'] as const
export const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
/** The only variables removed from the shell's environment. */
export const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export const ENV_START_MARKER = '__worfy_env_start__'
export const ENV_END_MARKER = '__worfy_env_end__'
export const SHELL_TIMEOUT_MS = 10_000

/** The minimal environment the login shell starts from. */
export function shellBaseEnv(source: SourceEnv): Env {
  const base: Env = { PATH: SYSTEM_PATH }
  for (const key of SHELL_BASE_KEYS) {
    const value = source[key]
    if (value !== undefined) base[key] = value
  }
  return base
}

/**
 * Reads the output of `printf \0START\0; env -0; printf \0END\0`: NUL-separated entries between the
 * two markers. Whatever an interactive rc file prints before or after is cut off, and a value
 * with a newline stays one value. Returns null when the markers are missing.
 */
export function parseEnvDump(output: string): Env | null {
  const parts = output.split('\0')
  const start = parts.lastIndexOf(ENV_START_MARKER)
  const end = parts.lastIndexOf(ENV_END_MARKER)
  if (start < 0 || end < start) return null
  const env: Env = {}
  for (const entry of parts.slice(start + 1, end)) {
    const eq = entry.indexOf('=')
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return env
}

/** Removes exactly the API key variables; everything else the user's rc files set stays. */
export function withoutApiKeys(env: Readonly<Env>): Env {
  const result: Env = { ...env }
  for (const key of API_KEY_VARS) delete result[key]
  return result
}

export interface CaptureOptions {
  /** The shell to run; defaults to $SHELL of `source`, then /bin/zsh. */
  shell?: string
  /** worfy's own environment: only SHELL_BASE_KEYS are taken from it. */
  source?: SourceEnv
  timeoutMs?: number
}

export interface CapturedEnv {
  env: Env
  /** How it was obtained: from the shell, or the minimal fallback when the shell failed. */
  from: 'login-shell' | 'fallback'
  /** Why the shell was not used, when `from` is `fallback`. */
  error: string | null
}

/**
 * Runs `$SHELL -ilc` from the minimal environment and returns its environment without the API
 * keys. When the shell fails, hangs past the timeout or prints no markers, the result is the
 * minimal environment itself (still without API keys): Claude Code starts, but tools outside the
 * system PATH are not found, and `error` says why.
 */
export async function captureLoginShellEnv(options: CaptureOptions = {}): Promise<CapturedEnv> {
  const source = options.source ?? process.env
  const shell = options.shell ?? source.SHELL ?? '/bin/zsh'
  const base = shellBaseEnv(source)
  // Each marker has a NUL on both sides: an rc file may print text without a trailing newline or NUL.
  const script = `printf '\\0%s\\0' ${ENV_START_MARKER}; env -0; printf '\\0%s\\0' ${ENV_END_MARKER}`
  const fallback = (error: string): CapturedEnv => ({ env: withoutApiKeys(base), from: 'fallback', error })

  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', script],
      { env: base, encoding: 'utf8', timeout: options.timeoutMs ?? SHELL_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        const env = parseEnvDump(stdout)
        // A non-zero exit after the dump (an rc file failing on exit) still leaves a usable environment.
        if (env && Object.keys(env).length > 0) {
          resolve({ env: withoutApiKeys(env), from: 'login-shell', error: null })
          return
        }
        resolve(fallback(error ? `${shell} -ilc failed: ${error.message}` : `${shell} -ilc printed no environment`))
      },
    )
  })
}

let captured: Promise<CapturedEnv> | null = null

/** The login shell environment, captured once per app run on first use. */
export function agentEnv(): Promise<CapturedEnv> {
  captured ??= captureLoginShellEnv().then((result) => {
    if (result.error) console.warn(`[agent] using the minimal environment: ${result.error}`)
    return result
  })
  return captured
}
