// Whether a worfy window has focus, checked against the system on Windows (worfy-windows ticket 113).
//
// On Windows Electron answers by the window that is active in worfy's own thread (GetActiveWindow),
// not by the system's foreground window. When Windows does not let a new worfy window to the front
// (another application holds it: a launch from a shortcut or from a background process), Electron
// still calls that window focused, `blur()` and `minimize()` do not change it, and every
// notification stayed silent. Measured on the owner's PC: 3 launches of 7 (ticket 113, its result).
//
// So on Windows, when Electron says a window is focused, worfy asks the system which process owns
// the foreground window: one call of Windows PowerShell (Electron has no API for it; a native
// dependency was not taken, ticket 113). The call took 0.7–0.95 s on the owner's PC at 97 % CPU, and
// it runs only when a notification is about to be decided. When it fails or takes longer than
// FOREGROUND_TIMEOUT_MS, Electron's answer stands, as before, and the first such failure is logged.
// macOS and Linux keep Electron's answer.
import { powershellScriptCommand, runFile, stderrLine, type RunFile } from './agent/env'

export const FOREGROUND_TIMEOUT_MS = 2_000

/** Prints the pid of the process that owns the foreground window (0 when there is none). */
export const FOREGROUND_SCRIPT =
  "Add-Type -Namespace WorfyForeground -Name User32 -MemberDefinition '" +
  '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); ' +
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr window, out uint pid);' +
  "'; $p = [uint32]0; [void][WorfyForeground.User32]::GetWindowThreadProcessId([WorfyForeground.User32]::GetForegroundWindow(), [ref]$p); $p"

export type ForegroundAnswer = { pid: number } | { failure: string }

/** The pid of the process that owns the system's foreground window, or why it is not known. */
export function foregroundPid(run: RunFile = runFile, systemRoot = process.env.SystemRoot): Promise<ForegroundAnswer> {
  const command = powershellScriptCommand(systemRoot, FOREGROUND_SCRIPT)
  return new Promise((resolve) => {
    try {
      run(command.file, command.args, { ...command.options, timeout: FOREGROUND_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error !== null) {
          const reason = error.killed === true ? `no answer within ${FOREGROUND_TIMEOUT_MS} ms` : `exit code ${String(error.code)}`
          const line = stderrLine(stderr)
          resolve({ failure: line === null ? reason : `${reason}: ${line}` })
          return
        }
        const text = stdout.trim()
        resolve(/^\d+$/.test(text) ? { pid: Number(text) } : { failure: `unexpected output ${JSON.stringify(text.slice(0, 80))}` })
      })
    } catch (error) {
      // execFile throws at once for some spawn errors instead of calling back.
      resolve({ failure: `could not start: ${error instanceof Error ? error.message : String(error)}` })
    }
  })
}

export interface FocusDeps {
  /** Electron's answer: a worfy window is active in worfy's thread. */
  electronFocused(): boolean
  platform: NodeJS.Platform
  /** worfy's main process: it owns every worfy window. */
  pid: number
  foreground(): Promise<ForegroundAnswer>
  warn(message: string): void
}

/**
 * Whether a worfy window has focus: Electron's answer, and on Windows, when Electron says yes, whether
 * worfy owns the system's foreground window. A boolean when Electron's answer is final, a promise
 * when the system is asked.
 */
export function createFocusCheck(deps: FocusDeps): () => boolean | Promise<boolean> {
  let warned = false
  return () => {
    if (!deps.electronFocused()) return false
    if (deps.platform !== 'win32') return true
    return deps.foreground().then((answer) => {
      if ('pid' in answer) return answer.pid === deps.pid
      if (!warned) {
        warned = true
        deps.warn(`[notify] the foreground window is not known (${answer.failure}); Electron's focus decides`)
      }
      return true
    })
  }
}
