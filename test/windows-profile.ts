import { mkdirSync } from 'node:fs'
import { join, win32 } from 'node:path'

// The user's profile folders of Windows moved to a temporary folder of a test: for the app's
// launches in the e2e specs (test/e2e/launch-env.ts) and for the Terminal contract tests
// (test/contract/terminal-harness.ts). Kept apart from test/e2e so the contract tests do not
// import a module of the e2e specs.

/**
 * On Windows (`platform`), the profile variables for the app's process that put the Terminal's shell
 * in `dir`, a temporary folder of the test; {} elsewhere. Every start of the app in a test gets them
 * (isolation in test/e2e/launch-env.ts); a spec that passes its own wins. worfy passes USERPROFILE, APPDATA and LOCALAPPDATA of
 * its own process to the shell (WINDOWS_SESSION_VARS, src/main/agent/env.ts), so without this the
 * shell would get the owner's: PSReadLine would append every typed command to the owner's
 * history, pwsh would run the owner's $PROFILE, and Git Bash would read the owner's rc files from
 * HOME. With it, Windows PowerShell 5.1 finds no $PROFILE and PSReadLine keeps its history under
 * `dir`; pwsh takes both from `dir`; Git Bash's HOME is `dir`. TEMP of the user's registry is
 * %USERPROFILE%\AppData\Local\Temp on most machines, so the shell's TEMP lands in `dir` too: the
 * folders are made here. worfy's own folders do not move: WORFY_DATA_DIR and WORFY_CLAUDE_HOME
 * name them in every test (test/e2e/launch-env.ts).
 *
 * HOMEDRIVE and HOMEPATH move too. worfy passes no HOME on Windows, and Git for Windows takes HOME
 * from HOMEDRIVE + HOMEPATH before USERPROFILE: on the Windows PC on 2026-10-21, bin\bash.exe -c
 * with USERPROFILE, APPDATA and LOCALAPPDATA moved but the real HOMEDRIVE/HOMEPATH printed
 * HOME=/c/Users/<owner>; with these two moved as well it printed the temporary folder. The git
 * worfy itself runs gets that HOME only while worfy's process has no HOME; under Git Bash, which
 * sets HOME, it reads the global config of that HOME (test/e2e/launch-env.ts).
 *
 * Moving USERPROFILE and LOCALAPPDATA also changes which shell worfy finds (src/main/agent/env.ts):
 * a per-user Git in %LOCALAPPDATA%\Programs\Git (findGitBash) and pwsh as an app execution alias in
 * %LOCALAPPDATA%\Microsoft\WindowsApps are not found. On such a machine these specs run Windows
 * PowerShell, and the Git Bash ones need a machine-wide Git or one on the Path.
 */
export function windowsProfileEnv(dir: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (platform !== 'win32') return {}
  const vars = profileVars(dir)
  mkdirSync(vars.APPDATA, { recursive: true })
  mkdirSync(join(vars.LOCALAPPDATA, 'Temp'), { recursive: true })
  return vars
}

/** The names windowsProfileEnv moves: every variable a Windows shell finds its profile, history and rc files by. */
export const PROFILE_VARS = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'] as const

/**
 * The PROFILE_VARS that name `dir` as the user's profile folder, on any system and without making a
 * folder: windowsProfileEnv on Windows, and the Windows environment of the Terminal contract tests
 * (test/contract/terminal-harness.ts), which also runs with a stand-in Windows on macOS and Linux.
 */
export function profileVars(dir: string): Record<(typeof PROFILE_VARS)[number], string> {
  // shortcut: a drive-letter path only (C:\...), not a UNC one; redo if tmpdir() is ever on a share.
  const drive = win32.parse(dir).root.replace(/\\$/, '')
  return { USERPROFILE: dir, APPDATA: join(dir, 'AppData', 'Roaming'), LOCALAPPDATA: join(dir, 'AppData', 'Local'), HOMEDRIVE: drive, HOMEPATH: dir.slice(drive.length) }
}
