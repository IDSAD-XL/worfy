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
// the user from the registry (read through Windows PowerShell, REG_EXPAND_SZ expanded, Path =
// machine Path + user Path), on top of a short list of session variables Windows sets at sign-in (SystemRoot,
// USERPROFILE, APPDATA …), taken from the process. Nothing else of whoever started worfy — a
// parent Claude Code session's CLAUDECODE or GH_TOKEN, WORFY_* — reaches Claude Code, as the
// minimal start of the login shell ensures on the Mac. The API keys are removed as on the Mac.
// Claude Code gets Git Bash for its Bash tool through CLAUDE_CODE_GIT_BASH_PATH; `bash.exe` from
// Path may be the WSL launcher.
import { execFile } from 'node:child_process'
import { readlinkSync, statSync } from 'node:fs'
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

/** The REG_SZ and REG_EXPAND_SZ values of a registry key, not expanded; rejects when the key cannot be read. */
export type RegRead = (key: string) => Promise<RegValue[]>
export type FileExists = (path: string) => boolean

/** Windows keeps one variable to 32,767 characters; a longer expansion stays as written. */
export const MAX_VAR_LENGTH = 32_767

/** Variable names on Windows are case-insensitive: the value of `name` under any case. */
function getVar(env: SourceEnv, name: string): string | undefined {
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper) return value
  return undefined
}

/**
 * The variables Windows sets for a session, taken from worfy's process; nothing else of it is. Most
 * live outside the Environment keys of the registry (HKCU\Volatile Environment, the system itself).
 * Some — ComSpec, PATHEXT, TEMP, windir … — are normally values of the machine's key too: the
 * registry value wins, and the copy from the process stays only when the registry lacks the name,
 * or in the fallback.
 */
export const WINDOWS_SESSION_VARS = [
  'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOMESHARE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData',
  'LOGONSERVER', 'USERDOMAIN_ROAMINGPROFILE', 'USERDNSDOMAIN', 'SESSIONNAME', 'CLIENTNAME',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramFiles(Arm)', 'ProgramW6432',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramFiles(Arm)', 'CommonProgramW6432',
  'PUBLIC', 'ALLUSERSPROFILE', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS',
] as const

export interface RegValue {
  name: string
  type: string
  value: string
}

const REGISTRY_HIVES: Record<string, string> = { HKCU: 'CurrentUser', HKLM: 'LocalMachine' }
const fromBase64 = (base64: string | undefined): string => Buffer.from(base64 ?? '', 'base64').toString('utf8')

/** The variables of the environment the registry script reads its key from. */
export const REGISTRY_HIVE_VAR = 'WORFY_REGISTRY_HIVE'
export const REGISTRY_SUBKEY_VAR = 'WORFY_REGISTRY_SUBKEY'

/**
 * A Windows PowerShell script that prints the REG_SZ and REG_EXPAND_SZ values of a key, not
 * expanded, one per line: `<String|ExpandString> <name> <value>`, name and value in base64 of UTF-8,
 * so the output is ASCII whatever the console's code page. A failure prints
 * `Error <message in base64>` and exits 1. The key is opened through the .NET Registry API, not the
 * registry provider: no module to load (PSModulePath may come from a pwsh 7 parent). `reg query` is
 * not used: it writes to a pipe in the OEM code page, so C:\Users\Алексей came out garbled and
 * characters outside that code page as `?`, with no error (review of PR #194, round 4).
 *
 * The text is constant (worfy-windows ticket 21): the key comes in two variables of the
 * environment (registryVars), so nothing is quoted and nothing is decoded. Measured on the owner's
 * PC from the Node of Electron: a script that decodes base64 — handed over with -EncodedCommand,
 * or calling FromBase64String itself — costs about a second more the first time a process runs
 * its text, and again after worfy is started anew; a script as text that only encodes costs
 * 0.26 s every time. From the system Node there is no such difference.
 */
export const REGISTRY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$b64 = { param($s) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$s)) }',
  'try {',
  '  $hives = @{ CurrentUser = [Microsoft.Win32.Registry]::CurrentUser; LocalMachine = [Microsoft.Win32.Registry]::LocalMachine }',
  `  $hive = $hives[[string]$env:${REGISTRY_HIVE_VAR}]`,
  `  if ($null -eq $hive) { throw "not a hive this script reads: $env:${REGISTRY_HIVE_VAR}" }`,
  `  $path = [string]$env:${REGISTRY_SUBKEY_VAR}`,
  '  $key = $hive.OpenSubKey($path)',
  '  if ($null -eq $key) { throw "no such key: $path" }',
  '  foreach ($name in $key.GetValueNames()) {',
  "    if ($name -eq '') { continue }",
  '    $kind = $key.GetValueKind($name).ToString()',
  "    if ($kind -ne 'String' -and $kind -ne 'ExpandString') { continue }",
  "    $value = $key.GetValue($name, '', 'DoNotExpandEnvironmentNames')",
  '    "$kind $(& $b64 $name) $(& $b64 $value)"',
  '  }',
  '} catch {',
  '  "Error $(& $b64 $_.Exception.Message)"',
  '  exit 1',
  '}',
].join('\n')

/** The variables REGISTRY_SCRIPT reads for `key` (HKCU\… or HKLM\…); throws for a key of another hive. */
export function registryVars(key: string): Env {
  const [hive = '', ...subkey] = key.split('\\')
  const root = REGISTRY_HIVES[hive.toUpperCase()]
  if (!root) throw new Error(`not a key of HKCU or HKLM: ${key}`)
  return { [REGISTRY_HIVE_VAR]: root, [REGISTRY_SUBKEY_VAR]: subkey.join('\\') }
}

/** The values in the output of registryScript; other lines are skipped. */
export function parseRegistryValues(output: string): RegValue[] {
  const values: RegValue[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^(String|ExpandString) ([A-Za-z0-9+/]+=*)(?: ([A-Za-z0-9+/]*=*))? *$/.exec(line)
    if (match) values.push({ name: fromBase64(match[2]), type: match[1] === 'String' ? 'REG_SZ' : 'REG_EXPAND_SZ', value: fromBase64(match[3]) })
  }
  return values
}

export interface PowershellCommand {
  file: string
  args: string[]
  /** `env` is there when the script has data: the environment of worfy with the data added. */
  options: { encoding: 'utf8'; timeout: number; windowsHide: boolean; env?: Env }
}

/**
 * How a script runs: Windows PowerShell of `systemRoot` by its absolute path — C:\Windows when
 * `systemRoot` is missing, empty or not absolute — without a profile and without prompts, hidden,
 * with a timeout. Also used by the live Session check of src/main/claude-home/registry.ts.
 *
 * The script goes in as text, with -Command, and must be a constant: what changes from call to
 * call is given in `vars`, which the script reads as `$env:NAME`. -EncodedCommand is not used
 * (worfy-windows ticket 21; the numbers are at REGISTRY_SCRIPT).
 */
export function powershellScriptCommand(systemRoot: string | undefined, script: string, vars: Env = {}, env: Env = process.env as Env): PowershellCommand {
  // A drive and its root: `\Windows` (the root of the current drive) passes win32.isAbsolute but is not one.
  const root = systemRoot && /^[A-Za-z]:[\\/]/.test(systemRoot) ? systemRoot : 'C:\\Windows'
  const withData = Object.keys(vars).length > 0
  return {
    file: win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    options: { encoding: 'utf8', timeout: SHELL_TIMEOUT_MS, windowsHide: true, ...(withData ? { env: { ...env, ...vars } } : {}) },
  }
}

/** How REGISTRY_SCRIPT runs for `key` (powershellScriptCommand). */
export function powershellCommand(systemRoot: string | undefined, key: string, env: Env = process.env as Env): PowershellCommand {
  return powershellScriptCommand(systemRoot, REGISTRY_SCRIPT, registryVars(key), env)
}

export type RunFile = (
  file: string,
  args: string[],
  options: PowershellCommand['options'],
  done: (error: { code?: unknown; killed?: boolean } | null, stdout: string, stderr: string) => void,
) => void

export const runFile: RunFile = (file, args, options, done) => {
  execFile(file, args, options, (error, stdout, stderr) => done(error, stdout, stderr))
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

/**
 * The line of stderr that says what failed. powershell.exe writes a redirected error stream as
 * CLIXML (`#< CLIXML` and one line of XML), even with -OutputFormat Text (checked on the owner's PC
 * for worfy-windows ticket 08): its message is the first line of the `<S S="Error">` strings.
 * Plain stderr gives its last line.
 */
export function stderrLine(stderr: string): string | null {
  const clixml = stderr.trimStart().startsWith('#< CLIXML')
  const text = clixml
    ? [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
        .map((match) => match[1]!)
        .join('')
        .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => XML_ENTITIES[name]!)
    : stderr
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  return (clixml ? lines[0] : lines.at(-1)) ?? null
}

/** Why the reader failed: the timeout, the script's own Error line, or what stderr says. */
function readerFailure(error: { code?: unknown; killed?: boolean }, stdout: string, stderr: string): string {
  if (error.killed) return `timed out after ${SHELL_TIMEOUT_MS / 1000} s`
  const own = /^Error ([A-Za-z0-9+/]*=*) *$/m.exec(stdout)
  if (own) return fromBase64(own[1])
  const line = stderrLine(stderr)
  return line ? `exit ${String(error.code)}: ${line.slice(0, 300)}` : `exit ${String(error.code)}`
}

/** Reads a key through Windows PowerShell (powershellCommand). */
export function powershellRegRead(systemRoot: string | undefined, run: RunFile = runFile): RegRead {
  return (key) =>
    new Promise((resolve, reject) => {
      const { file, args, options } = powershellCommand(systemRoot, key)
      run(file, args, options, (error, stdout, stderr) =>
        error ? reject(new Error(`${file} could not read ${key}: ${readerFailure(error, stdout, stderr)}`)) : resolve(parseRegistryValues(stdout)),
      )
    })
}

/** Sets `key` in `env`, replacing a key that differs only in case. */
function setVar(env: Env, key: string, value: string): void {
  for (const existing of Object.keys(env)) if (existing.toUpperCase() === key.toUpperCase()) delete env[existing]
  env[key] = value
}

/**
 * The values of one Environment key put into `env`, as a sign-in does. REG_SZ goes in as it is.
 * REG_EXPAND_SZ waits until every variable it names is final — not itself waiting in this key — and
 * then each `%NAME%` gets the value NAME has in `env`, once: the text put in is not scanned again.
 * So a forward reference within the key works, and a reference to the value's own name gets the value
 * from before this key: the machine's for the user's key, or the session's when there is none. An
 * unknown name stays as written, and so does a reference within a cycle. A value whose expansion goes
 * past MAX_VAR_LENGTH at any point stays as written.
 *
 * A value is cut at its first NUL, as the C-string APIs of a sign-in read it, and a name with a NUL is
 * dropped: GetValue keeps an embedded NUL, and Node refuses an environment holding one at spawn
 * (ERR_INVALID_ARG_VALUE), so no agent would start.
 */
function putKey(values: RegValue[], env: Env): void {
  const waiting = new Map<string, RegValue>()
  for (const { name, type, value: raw } of values) {
    if (name.includes('\0')) continue
    const value = raw.split('\0')[0]!
    if (type === 'REG_SZ') {
      waiting.delete(name.toUpperCase())
      setVar(env, name, value)
    } else if (type === 'REG_EXPAND_SZ') waiting.set(name.toUpperCase(), { name, type, value })
  }
  const blockedBy = (self: string, name: string): boolean => name.toUpperCase() !== self && waiting.has(name.toUpperCase())
  const expand = (self: string, value: string): string => {
    // The length is counted while expanding, so a value that doubles at every step stops early; once
    // past the limit the value stays as written, even if later references would make it shorter.
    let length = value.length
    let over = false
    const expanded = value.replace(/%([^%;]+)%/g, (whole, name: string) => {
      const found = blockedBy(self, name) ? whole : (getVar(env, name) ?? whole)
      length += found.length - whole.length
      if (length > MAX_VAR_LENGTH) over = true
      return over ? '' : found
    })
    return over ? value : expanded
  }
  let progress = true
  while (progress) {
    progress = false
    for (const [self, entry] of waiting) {
      if ([...entry.value.matchAll(/%([^%;]+)%/g)].some((match) => blockedBy(self, match[1]!))) continue
      setVar(env, entry.name, expand(self, entry.value))
      waiting.delete(self)
      progress = true
    }
  }
  // What is left waits on a cycle: those references stay as written.
  const left = [...waiting].map(([self, entry]) => [entry.name, expand(self, entry.value)] as const)
  for (const [name, value] of left) setVar(env, name, value)
}

/**
 * A file there, or an app execution alias of one: `pwsh.exe` installed by winget from MSIX is a
 * link in %LOCALAPPDATA%\Microsoft\WindowsApps that cannot be opened as a file (existsSync says no,
 * stat fails with EACCES), and readlink names the program it starts (evidence of worfy-windows
 * ticket 01, section 25; ticket 10). A folder of that name and a link to nothing are neither.
 */
const fileOrAlias: FileExists = (path) => {
  try {
    return statSync(path).isFile()
  } catch {
    // Not a file that opens: an alias, a link to nothing, or nothing.
  }
  try {
    return statSync(readlinkSync(path)).isFile()
  } catch {
    return false
  }
}

/**
 * The first `<name>.exe` in the Path of `env`, or null. An entry of the Path that is not a full
 * path (`.`, `tools`, `\bin`) is skipped: it would be looked for in worfy's own working folder.
 */
export function findOnPath(name: string, env: SourceEnv, exists: FileExists = fileOrAlias): string | null {
  const file = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.exe`
  for (const raw of (getVar(env, 'PATH') ?? '').split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(dir)) continue
    const candidate = win32.join(dir, file)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Git Bash of Git for Windows, or null. First from git.exe on the Path: the root of Git for Windows
 * is the folder above `cmd`, `bin` or `mingw64\bin`, and Git Bash is <root>\bin\bash.exe. Then
 * %ProgramFiles%\Git, %ProgramFiles(x86)%\Git (a 32-bit Git) and %LOCALAPPDATA%\Programs\Git (a
 * per-user install). The registry is not asked. The WSL launcher
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
  const programFilesX86 = getVar(env, 'ProgramFiles(x86)')
  if (programFilesX86) candidates.push(win32.join(programFilesX86, 'Git', 'bin', 'bash.exe'))
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

export interface WindowsEnvOptions {
  /** worfy's own environment; process.env by default. */
  source?: SourceEnv
  /** The registry reader; powershellRegRead of %SystemRoot% by default. */
  readKey?: RegRead
  exists?: FileExists
}

/**
 * The agent environment on Windows, built as a new sign-in builds it:
 *   1. the session variables of WINDOWS_SESSION_VARS, from `source`;
 *   2. the machine's persistent variables, final, and then the user's on top (putKey): REG_EXPAND_SZ
 *      gets the final values of the variables it names; Path is the machine Path followed by the
 *      user Path, and no Path when both are missing or empty;
 *   3. without ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN (any case), as on the Mac;
 *   4. Git Bash in CLAUDE_CODE_GIT_BASH_PATH unless the user has an own one.
 * When either key cannot be read, or applying them fails, the result is exactly the session variables
 * and the Path of `source` (`fallback`), and `error` says why; without Git Bash `error` says the
 * agent has no Bash tool.
 */
export async function captureWindowsEnv(options: WindowsEnvOptions = {}): Promise<CapturedEnv> {
  const source = options.source ?? process.env
  const errors: string[] = []
  let env: Env = {}
  for (const key of WINDOWS_SESSION_VARS) {
    const value = getVar(source, key)
    if (value !== undefined) env[key] = value
  }
  let from: CapturedEnv['from'] = 'registry'
  try {
    const readKey = options.readKey ?? powershellRegRead(getVar(source, 'SystemRoot'))
    // PERSISTENT_ENV_KEYS: the user's key first, the machine's second.
    const [userValues, machineValues] = await Promise.all(PERSISTENT_ENV_KEYS.map((key) => readKey(key)))
    // Built apart and taken only when complete, so a fallback carries nothing of the registry.
    const registry: Env = { ...env }
    // As Windows does: the machine's key is final before the user's is read, so `%PATHEXT%` in the
    // user's PATHEXT is the machine's value. Path alone is not replaced: the user's goes after it.
    const hasPath = (values: RegValue[]): boolean => values.some(({ name, type }) => name.toUpperCase() === 'PATH' && /^REG_(EXPAND_)?SZ$/.test(type))
    putKey(machineValues!, registry)
    const machinePath = hasPath(machineValues!) ? getVar(registry, 'PATH') : undefined
    putKey(userValues!, registry)
    const userPath = hasPath(userValues!) ? getVar(registry, 'PATH') : undefined
    const path = [machinePath, userPath].filter((part) => part !== undefined && part !== '')
    setVar(registry, 'Path', path.join(';'))
    if (path.length === 0) delete registry.Path
    env = registry
  } catch (error) {
    from = 'fallback'
    const path = getVar(source, 'PATH')
    if (path !== undefined) setVar(env, 'Path', path)
    errors.push(`the registry could not be read, only the session variables and the Path of worfy's process are used: ${error instanceof Error ? error.message : String(error)}`)
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

/**
 * The agent environment of this platform: the login shell on macOS and Linux; on Windows, the
 * session variables and the registry, as a new sign-in builds it.
 */
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
