import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, win32 } from 'node:path'

// The shell a Terminal Node starts, and what the e2e specs type into it. On Windows it is PowerShell
// (owner decision Q20), or Git Bash when the Project's settings choose it; SHELL does nothing there.
// Elsewhere it is $SHELL, which the specs set to /bin/sh.

export const WINDOWS = process.platform === 'win32'

/**
 * Chooses Git Bash for the Terminals of the Project whose data folder is `projectDataDir`, as the
 * settings window would: settings.json, written before worfy starts. The action templates have no
 * placeholder, which is valid. Git Bash reads no HOME of the test: it gets the user's profile folder,
 * so a spec types `unset HISTFILE` before anything else, and no history is written there.
 */
export function chooseGitBash(projectDataDir: string): void {
  writeFileSync(join(projectDataDir, 'settings.json'), JSON.stringify({ actionTemplates: { shipTicket: 'ship', runWave: 'wave', gateQueue: 'queue' }, terminalShell: 'git-bash' }))
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

/** The processes whose parent is `pid`, from CIM. The script has no double quote, so it stays one argument. */
function windowsChildren(pid: number): Child[] {
  const script = `ConvertTo-Json -Compress -InputObject @(Get-CimInstance -Query 'SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE ParentProcessId = ${Math.trunc(pid)}' | ForEach-Object { @{ pid = $_.ProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } })`
  const out = execFileSync(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
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
