// The environment of the Claude Code process (ADR-0007).
//
// An app started from Finder gets a bare PATH from launchd (/usr/bin:/bin:/usr/sbin:/sbin), so
// neither Claude Code nor the user's hooks would find node, pnpm or gh. worfy therefore takes the
// environment of the user's interactive login shell (`$SHELL -ilc`), once, with a timeout. The
// shell starts from a minimal environment, so variables of whoever started worfy (for example a
// parent Claude Code session when worfy runs from a terminal) never reach the child Claude Code.
// From the shell's environment only ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed: with
// them Claude Code would log in by key instead of the user's subscription.
//
// Windows has no login shell (ADR-0057, worfy-windows ticket 09). The environment is worfy's own,
// which already carries the user's Path, without the API keys and without the variables a parent
// Claude Code session leaves when worfy runs from its Bash tool (CLAUDECODE, CLAUDE_CODE_*,
// ANTHROPIC_BASE_URL, NoDefaultCurrentDirectoryInExePath …). Such a variable stays when the user
// set it persistently (HKCU or HKLM Environment, read with `reg query`), as an export from an rc
// file reaches Claude Code on the Mac. Claude Code gets Git Bash for its Bash tool through
// CLAUDE_CODE_GIT_BASH_PATH; `bash.exe` from Path may be the WSL launcher.
import { execFile } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { win32 } from 'node:path'

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
  /**
   * How it was obtained: from the shell, the minimal fallback when the shell failed, or (Windows)
   * worfy's own process environment.
   */
  from: 'login-shell' | 'fallback' | 'process'
  /** Why the shell was not used (`fallback`), or what is missing on Windows (`process`); else null. */
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

/** The persistent environment of Windows: the user's and the machine's. */
export const PERSISTENT_ENV_KEYS = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'] as const

/** stdout of `reg query <key>`; rejects when reg fails. */
export type RegQuery = (key: string) => Promise<string>
export type FileExists = (path: string) => boolean

const SYSTEM32_BASH = /\\windows\\system32\\bash\.exe$/i

/** Variable names on Windows are case-insensitive: the value of `name` under any case. */
function getVar(env: SourceEnv, name: string): string | undefined {
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper) return value
  return undefined
}

/** A variable a parent Claude Code session may leave in worfy's environment. */
export function isParentSessionVar(name: string): boolean {
  const upper = name.toUpperCase()
  return upper.startsWith('CLAUDE') || upper.startsWith('ANTHROPIC_') || upper === 'NODEFAULTCURRENTDIRECTORYINEXEPATH'
}

/** The value names in the output of `reg query <key>`: lines `    <name>    REG_<type>    <value>`. */
export function parseRegQuery(output: string): string[] {
  const names: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}REG_[A-Z_]+(?: {4}|$)/.exec(line)
    if (match) names.push(match[1]!)
  }
  return names
}

/**
 * A file there, or an app execution alias: `pwsh.exe` installed by winget from MSIX is a link in
 * %LOCALAPPDATA%\Microsoft\WindowsApps that existsSync does not see (evidence of worfy-windows
 * ticket 01, section 25).
 */
const fileOrAlias: FileExists = (path) => {
  if (existsSync(path)) return true
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** The first `<name>.exe` in the Path of `env`, or null. */
export function findOnPath(name: string, env: SourceEnv, exists: FileExists = fileOrAlias): string | null {
  const file = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.exe`
  for (const raw of (getVar(env, 'PATH') ?? '').split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const candidate = win32.join(dir, file)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Git Bash of Git for Windows, or null. First from git.exe on the Path: the root of Git for Windows
 * is the folder above `cmd`, `bin` or `mingw64\bin`, and Git Bash is <root>\bin\bash.exe. Then
 * %ProgramFiles%\Git and %LOCALAPPDATA%\Programs\Git (a per-user install). The WSL launcher
 * C:\Windows\System32\bash.exe is never taken.
 */
export function findGitBash(env: SourceEnv, exists: FileExists = fileOrAlias): string | null {
  const candidates: string[] = []
  const git = findOnPath('git', env, exists)
  if (git) {
    let root = win32.dirname(git)
    const tail = win32.basename(root).toLowerCase()
    if (tail === 'cmd' || tail === 'bin') root = win32.dirname(root)
    if (win32.basename(root).toLowerCase() === 'mingw64') root = win32.dirname(root)
    candidates.push(win32.join(root, 'bin', 'bash.exe'))
  }
  const programFiles = getVar(env, 'ProgramFiles')
  if (programFiles) candidates.push(win32.join(programFiles, 'Git', 'bin', 'bash.exe'))
  const localAppData = getVar(env, 'LOCALAPPDATA')
  if (localAppData) candidates.push(win32.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  const systemRoot = (getVar(env, 'SystemRoot') ?? 'C:\\Windows').toLowerCase()
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    if (SYSTEM32_BASH.test(candidate) || lower.startsWith(`${systemRoot}\\`)) continue
    if (exists(candidate)) return candidate
  }
  return null
}

const execRegQuery: RegQuery = (key) =>
  new Promise((resolve, reject) => {
    execFile('reg', ['query', key], { encoding: 'utf8', timeout: SHELL_TIMEOUT_MS, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })

export interface WindowsEnvOptions {
  /** worfy's own environment; process.env by default. */
  source?: SourceEnv
  regQuery?: RegQuery
  exists?: FileExists
}

/**
 * The agent environment on Windows: `source` without the API keys (any case) and without the
 * variables of a parent session that are not persistent; one key for the path; Git Bash in
 * CLAUDE_CODE_GIT_BASH_PATH unless the user has an own one. When `reg query` fails, every such
 * variable goes and `error` says why; without Git Bash `error` says the agent has no Bash tool.
 */
export async function captureWindowsEnv(options: WindowsEnvOptions = {}): Promise<CapturedEnv> {
  const source = options.source ?? process.env
  const errors: string[] = []
  let persistent: Set<string> | null = null
  try {
    const answers = await Promise.all(PERSISTENT_ENV_KEYS.map((key) => (options.regQuery ?? execRegQuery)(key)))
    persistent = new Set(answers.flatMap(parseRegQuery).map((name) => name.toUpperCase()))
  } catch (error) {
    errors.push(`reg query failed, every CLAUDE* and ANTHROPIC_* variable is removed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const apiKeys = new Set<string>(API_KEY_VARS)
  const env: Env = {}
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(source)) {
    const upper = key.toUpperCase()
    if (value === undefined || seen.has(upper) || apiKeys.has(upper)) continue
    if (isParentSessionVar(key) && !persistent?.has(upper)) continue
    seen.add(upper)
    env[key] = value
  }
  if (getVar(env, 'CLAUDE_CODE_GIT_BASH_PATH') === undefined) {
    const bash = findGitBash(env, options.exists)
    if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash
    else errors.push('Git Bash not found: the agent has no Bash tool')
  }
  return { env, from: 'process', error: errors.length > 0 ? errors.join('; ') : null }
}

export interface AgentEnvOptions extends WindowsEnvOptions {
  platform?: NodeJS.Platform
  /** The login shell capture of macOS and Linux; captureLoginShellEnv by default. */
  captureShell?: () => Promise<CapturedEnv>
}

/** The agent environment of this platform: the login shell on macOS and Linux, the process on Windows. */
export function captureAgentEnv(options: AgentEnvOptions = {}): Promise<CapturedEnv> {
  if ((options.platform ?? process.platform) === 'win32') return captureWindowsEnv(options)
  return (options.captureShell ?? (() => captureLoginShellEnv({ source: options.source })))()
}

let captured: Promise<CapturedEnv> | null = null

/** The agent environment, captured once per app run on first use. */
export function agentEnv(): Promise<CapturedEnv> {
  captured ??= captureAgentEnv().then((result) => {
    if (result.error) console.warn(`[agent] ${result.from === 'process' ? 'agent environment' : 'using the minimal environment'}: ${result.error}`)
    return result
  })
  return captured
}
