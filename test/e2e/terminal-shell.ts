import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, win32 } from 'node:path'

// The shell a Terminal Node starts, and what the e2e specs type into it. On Windows it is PowerShell
// (owner decision Q20), or Git Bash when the Project's settings choose it; SHELL does nothing there.
// Elsewhere it is $SHELL, which the specs set to /bin/sh.

export const WINDOWS = process.platform === 'win32'

/**
 * Chooses Git Bash for the Terminals of the Project whose data folder is `projectDataDir`, as the
 * settings window would: settings.json, written before worfy starts. The action templates have no
 * placeholder, which is valid. Git Bash reads no HOME of the test: its HOME is USERPROFILE, a
 * temporary folder when the spec launches with windowsProfileEnv. A spec still types `unset HISTFILE`
 * before anything else, so no history is written even where it does not.
 */
export function chooseGitBash(projectDataDir: string): void {
  writeFileSync(join(projectDataDir, 'settings.json'), JSON.stringify({ actionTemplates: { shipTicket: 'ship', runWave: 'wave', gateQueue: 'queue' }, terminalShell: 'git-bash' }))
}

/**
 * On Windows, the profile variables for the app's process that put the Terminal's shell in `dir`, a
 * temporary folder of the test; {} elsewhere. worfy passes USERPROFILE, APPDATA and LOCALAPPDATA of
 * its own process to the shell (WINDOWS_SESSION_VARS, src/main/agent/env.ts), so without this the
 * shell would get the owner's: PSReadLine would append every typed command to the owner's
 * history, pwsh would run the owner's $PROFILE, and Git Bash would read the owner's rc files from
 * HOME. With it, Windows PowerShell 5.1 finds no $PROFILE and PSReadLine keeps its history under
 * `dir`; pwsh takes both from `dir`; Git Bash's HOME is `dir`. TEMP of the user's registry is
 * %USERPROFILE%\AppData\Local\Temp on most machines, so the shell's TEMP lands in `dir` too: the
 * folders are made here. worfy's own folders do not move: WORFY_DATA_DIR and WORFY_CLAUDE_HOME
 * name them in every test (launch-env.ts).
 *
 * HOMEDRIVE and HOMEPATH move too. worfy passes no HOME on Windows, and Git for Windows takes HOME
 * from HOMEDRIVE + HOMEPATH before USERPROFILE: on the Windows PC on 2026-10-21, bin\bash.exe -c
 * with USERPROFILE, APPDATA and LOCALAPPDATA moved but the real HOMEDRIVE/HOMEPATH printed
 * HOME=/c/Users/<owner>; with these two moved as well it printed the temporary folder. The git
 * worfy runs in these specs gets that HOME as well and so no global git config: it only reads
 * (status, log), and the specs commit with their own -c identity.
 *
 * Moving USERPROFILE and LOCALAPPDATA also changes which shell worfy finds (src/main/agent/env.ts):
 * a per-user Git in %LOCALAPPDATA%\Programs\Git (findGitBash) and pwsh as an app execution alias in
 * %LOCALAPPDATA%\Microsoft\WindowsApps are not found. On such a machine these specs run Windows
 * PowerShell, and the Git Bash ones need a machine-wide Git or one on the Path.
 */
export function windowsProfileEnv(dir: string): Record<string, string> {
  if (!WINDOWS) return {}
  const appData = join(dir, 'AppData', 'Roaming')
  const localAppData = join(dir, 'AppData', 'Local')
  mkdirSync(appData, { recursive: true })
  mkdirSync(join(localAppData, 'Temp'), { recursive: true })
  // shortcut: a drive-letter path only (C:\...), not a UNC one; redo if tmpdir() is ever on a share.
  const drive = win32.parse(dir).root.replace(/\\$/, '')
  return { USERPROFILE: dir, APPDATA: appData, LOCALAPPDATA: localAppData, HOMEDRIVE: drive, HOMEPATH: dir.slice(drive.length) }
}

/**
 * A command that prints `a` and `b` as one word. The typed line holds them apart, so a regex for the
 * whole word matches only the output.
 */
export function printJoined(a: string, b: string): string {
  return WINDOWS ? `'${a}'+'${b}'` : `echo ${a}""${b}`
}

/** An expression in double quotes that gives the pty's size as `<cols>x<rows>`. */
export const SIZE_EXPRESSION = WINDOWS ? '$($Host.UI.RawUI.WindowSize.Width)x$($Host.UI.RawUI.WindowSize.Height)' : '$(tput cols)x$(tput lines)'

const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows'

/** The process names a Terminal's shell has on Windows. */
const WINDOWS_SHELLS = new Set(['powershell.exe', 'pwsh.exe', 'bash.exe'])

/** ConPTY starts these next to a shell; they are not a job of it. */
const CONSOLE_HOSTS = new Set(['conhost.exe', 'openconsole.exe'])

interface Child {
  pid: number
  name: string
  commandLine: string
}

/**
 * The PowerShell script that prints, as JSON, the processes whose parent is `pid`. Windows gives the
 * pid of an ended process to a new one and does not re-parent orphans: a process created before
 * `pid`'s process names that pid as its parent only because its real parent, now gone, once had
 * it. Such a process is left out, by the rule descendantsScript (src/main/terminal/pty.ts) uses;
 * without it a test could SIGKILL an unrelated program. No process with `pid` gives no children.
 * The script has no double quote, so it stays one argument of the command line.
 */
export function windowsChildrenScript(pid: number): string {
  const id = Math.trunc(pid)
  return [
    `$parent = Get-CimInstance -Query 'SELECT CreationDate FROM Win32_Process WHERE ProcessId = ${id}' | Select-Object -First 1`,
    "if ($null -eq $parent -or $null -eq $parent.CreationDate) { '[]'; exit 0 }",
    '$born = $parent.CreationDate.ToUniversalTime()',
    `ConvertTo-Json -Compress -InputObject @(Get-CimInstance -Query 'SELECT ProcessId, Name, CommandLine, CreationDate FROM Win32_Process WHERE ParentProcessId = ${id}' | Where-Object { $null -ne $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $born } | ForEach-Object { @{ pid = $_.ProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } })`,
  ].join('; ')
}

/** The processes whose parent is `pid`, from CIM (windowsChildrenScript). */
function windowsChildren(pid: number): Child[] {
  const out = execFileSync(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', windowsChildrenScript(pid)], { encoding: 'utf8', windowsHide: true })
  return (JSON.parse(out.trim() || '[]') as Child[]).map((child) => ({ ...child, name: child.name.toLowerCase() }))
}

function pgrep(args: string[]): number[] {
  try {
    return execFileSync('pgrep', args, { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

/** The pids of the processes whose parent is `pid`: a shell's jobs. On Windows the console hosts are left out. */
export function childrenOf(pid: number): number[] {
  if (!WINDOWS) return pgrep(['-P', String(pid)])
  return windowsChildren(pid)
    .filter((child) => !CONSOLE_HOSTS.has(child.name))
    .map((child) => child.pid)
}

/**
 * The pids of the shells whose parent is `pid`: the shells worfy's main process runs. On Windows main
 * also runs short PowerShell scripts of its own (-NonInteractive, such as the registry reads); they
 * are not Terminal shells.
 */
export function shellsOf(pid: number): number[] {
  if (!WINDOWS) return pgrep(['-x', '-P', String(pid), 'sh'])
  return windowsChildren(pid)
    .filter((child) => WINDOWS_SHELLS.has(child.name) && !/-NonInteractive/i.test(child.commandLine))
    .map((child) => child.pid)
}

/** The process name of `pid` on Windows (`bash.exe`, `powershell.exe` …), lower case; undefined when there is none. */
export function windowsProcessName(pid: number): string | undefined {
  const script = `(Get-CimInstance -Query 'SELECT Name FROM Win32_Process WHERE ProcessId = ${Math.trunc(pid)}').Name`
  const out = execFileSync(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  return out.trim().toLowerCase() || undefined
}
