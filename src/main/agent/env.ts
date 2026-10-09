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
// Windows has no login shell (ADR-0057, worfy-windows ticket 09). The environment is built as a new
// sign-in builds it, not taken from worfy's process: the persistent variables of the machine and
// the user from the registry (`reg query`, REG_EXPAND_SZ expanded, Path = machine Path + user
// Path), on top of a short list of session variables Windows sets at sign-in (SystemRoot,
// USERPROFILE, APPDATA …), taken from the process. Nothing else of whoever started worfy — a
// parent Claude Code session's CLAUDECODE or GH_TOKEN, WORFY_* — reaches Claude Code, as the
// minimal start of the login shell ensures on the Mac. The API keys are removed as on the Mac.
// Claude Code gets Git Bash for its Bash tool through CLAUDE_CODE_GIT_BASH_PATH; `bash.exe` from
// Path may be the WSL launcher.
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
   * How it was obtained: from the login shell, from the registry of Windows (ADR-0057), or the
   * minimal fallback when either failed.
   */
  from: 'login-shell' | 'registry' | 'fallback'
  /** Why the fallback was used, or what is missing on Windows (Git Bash); else null. */
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

/** Variable names on Windows are case-insensitive: the value of `name` under any case. */
function getVar(env: SourceEnv, name: string): string | undefined {
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper) return value
  return undefined
}

/**
 * Session variables Windows sets at sign-in and keeps outside the Environment keys of the registry
 * (HKCU\Volatile Environment, the system itself). They are taken from worfy's process; nothing else is.
 */
export const WINDOWS_SESSION_VARS = [
  'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOMESHARE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData',
  'LOGONSERVER', 'USERDOMAIN_ROAMINGPROFILE', 'SESSIONNAME', 'CLIENTNAME',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432',
  'PUBLIC', 'ALLUSERSPROFILE', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS',
] as const

export interface RegValue {
  name: string
  type: string
  value: string
}

/** The values in the output of `reg query <key>`: lines `    <name>    REG_<type>    <value>`. */
export function parseRegQuery(output: string): RegValue[] {
  const values: RegValue[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line)
    if (match) values.push({ name: match[1]!, type: match[2]!, value: match[3] ?? '' })
  }
  return values
}

/** `%NAME%` replaced by the value of NAME in `env` (any case); an unknown name stays as it is. */
export function expandVars(value: string, env: SourceEnv): string {
  return value.replace(/%([^%;]+)%/g, (whole, name: string) => getVar(env, name) ?? whole)
}

/** Sets `key` in `env`, replacing a key that differs only in case. */
function setVar(env: Env, key: string, value: string): void {
  for (const existing of Object.keys(env)) if (existing.toUpperCase() === key.toUpperCase()) delete env[existing]
  env[key] = value
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
  // Every candidate is <folder>\bin\bash.exe, never System32\bash.exe itself: bash.exe from the Path
  // is not looked at, because the first one there may be the WSL launcher. A candidate under the
  // Windows folder (git.exe placed there) is refused all the same.
  const systemRoot = (getVar(env, 'SystemRoot') ?? 'C:\\Windows').toLowerCase()
  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith(`${systemRoot}\\`)) continue
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
 * The agent environment on Windows, built as a new sign-in builds it:
 *   1. the session variables of WINDOWS_SESSION_VARS, from `source`;
 *   2. the machine's persistent variables, then the user's (the user's win), REG_EXPAND_SZ expanded
 *      against what is set so far; Path is the machine Path followed by the user Path;
 *   3. without ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN (any case), as on the Mac;
 *   4. Git Bash in CLAUDE_CODE_GIT_BASH_PATH unless the user has an own one.
 * When `reg query` fails the result is the session variables and the Path of `source` (`fallback`),
 * and `error` says why; without Git Bash `error` says the agent has no Bash tool.
 */
export async function captureWindowsEnv(options: WindowsEnvOptions = {}): Promise<CapturedEnv> {
  const source = options.source ?? process.env
  const errors: string[] = []
  const env: Env = {}
  for (const key of WINDOWS_SESSION_VARS) {
    const value = getVar(source, key)
    if (value !== undefined) env[key] = value
  }
  let from: CapturedEnv['from'] = 'registry'
  try {
    // PERSISTENT_ENV_KEYS: the user's key first, the machine's second.
    const [user, machine] = await Promise.all(PERSISTENT_ENV_KEYS.map((key) => (options.regQuery ?? execRegQuery)(key)))
    // As Windows does: first all raw values of both keys (the user's over the machine's), then the
    // expansion against the whole set — so `%NVM_HOME%` in Path finds NVM_HOME listed after Path or
    // set only for the user. Two passes resolve a reference to a variable that is itself expanded.
    const raw = new Map<string, { name: string; expand: boolean; value: string }>()
    const paths: { expand: boolean; value: string }[] = []
    for (const values of [parseRegQuery(machine!), parseRegQuery(user!)]) {
      for (const { name, type, value } of values) {
        if (type !== 'REG_SZ' && type !== 'REG_EXPAND_SZ') continue
        const entry = { name, expand: type === 'REG_EXPAND_SZ', value }
        if (name.toUpperCase() === 'PATH') paths.push(entry)
        else raw.set(name.toUpperCase(), entry)
      }
    }
    for (const { name, value } of raw.values()) setVar(env, name, value)
    for (let pass = 0; pass < 2; pass += 1) {
      for (const { name, expand } of raw.values()) if (expand) setVar(env, name, expandVars(getVar(env, name)!, env))
    }
    const path = paths.map(({ expand, value }) => (expand ? expandVars(value, env) : value)).filter((part) => part !== '')
    setVar(env, 'Path', path.join(';'))
  } catch (error) {
    from = 'fallback'
    const path = getVar(source, 'PATH')
    if (path !== undefined) setVar(env, 'Path', path)
    errors.push(`reg query failed, only the session variables and the Path of worfy's process are used: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const key of Object.keys(env)) if ((API_KEY_VARS as readonly string[]).includes(key.toUpperCase())) delete env[key]
  if (getVar(env, 'CLAUDE_CODE_GIT_BASH_PATH') === undefined) {
    const bash = findGitBash(env, options.exists)
    if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash
    else errors.push('Git Bash not found: the agent has no Bash tool')
  }
  return { env, from, error: errors.length > 0 ? errors.join('; ') : null }
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
    if (result.error) console.warn(`[agent] ${result.from === 'fallback' ? 'using the minimal environment' : 'agent environment'}: ${result.error}`)
    return result
  })
  return captured
}
