#!/usr/bin/env node
// worfy status line bridge: copies the `rate_limits` object that Claude Code passes to the status
// line command into statusline-limits.json in worfy's data folder, where worfy reads its Limits
// (ticket worfy-mvp/22). Claude Code 2.1.284 sends it after the first answer of a session:
//   {"five_hour": {"used_percentage": 29, "resets_at": 1791202800}, "seven_day": {...}}
//
// The data folder is WORFY_DATA_DIR when it is set. Otherwise the file goes to each of the two
// default folders of src/main/storage/paths.ts (dataRoot) that exist — worfy (the packaged app,
// such as the stable copy) and worfy-dev (`pnpm dev`), so a dev run next to the stable copy sees the
// same Limits: on macOS in ~/Library/Application Support, on Windows in %APPDATA% (worfy-windows
// ticket 08). This script runs without the app and cannot import paths.ts;
// test/contract/statusline-bridge.test.ts keeps the folders in step with it.
//
// It goes in front of the user's own status line command, which gets the same stdin and whose
// output and exit code are passed through unchanged. That command runs in the shell Claude Code
// runs `statusLine` in: `sh -c` on macOS and Linux; on Windows Git Bash — Claude Code 2.1.233 says
// so to its own status line setup agent ("the command is executed through Git Bash") — or, without
// Git Bash, the default shell of Node.
//
// In the .app it sits next to its entry Contents/Resources/statusline-bridge.sh, which the user's
// `statusLine` names (electron-builder.yml): worfy points `statusLine` at it only through the Harness
// migration form, after the user agrees (ADR-0040, ADR-0047). worfy only reads statusline-limits.json.
//
// Without an argument it prints nothing. It writes nothing but that one file per folder, only into
// a folder that exists (worfy has run), needs nothing but Node (no jq), and never fails the status
// line: any error of the Limits part is ignored.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const LIMITS_FILE = 'statusline-limits.json'
const FOLDERS = ['worfy', 'worfy-dev']
/** isWindowsAbsolutePath of src/shared/paths.ts: `C:\…`, `C:/…` or UNC; the test keeps the two in step. */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/

/**
 * The folders the Limits go to: WORFY_DATA_DIR when it is set, else both default data folders of
 * the platform, as dataRoot() of src/main/storage/paths.ts names them. On Windows the home is
 * USERPROFILE (what os.homedir() reads there) when APPDATA is missing or not absolute.
 */
export function limitsFolders(env = process.env, platform = process.platform, home = homedir()) {
  if (env.WORFY_DATA_DIR) return [env.WORFY_DATA_DIR]
  if (platform === 'win32') {
    const appData = env.APPDATA && WINDOWS_ABSOLUTE.test(env.APPDATA) ? env.APPDATA : win32.join(env.USERPROFILE || home, 'AppData', 'Roaming')
    return FOLDERS.map((name) => win32.join(appData, name))
  }
  return FOLDERS.map((name) => posix.join(home, 'Library', 'Application Support', name))
}

/** The `rate_limits` object of the status line JSON, as one line of JSON; null when there is none. */
export function rateLimitsOf(input) {
  try {
    const limits = JSON.parse(input)?.rate_limits
    return typeof limits === 'object' && limits !== null && !Array.isArray(limits) ? JSON.stringify(limits) : null
  } catch {
    return null
  }
}

/** Writes `limits` into each folder that exists, beside the target and renamed over it, so worfy never reads half a file. */
export function writeLimits(folders, limits) {
  for (const folder of folders) {
    try {
      if (!statSync(folder).isDirectory()) continue
    } catch {
      continue
    }
    const tmp = join(folder, `.${LIMITS_FILE}.${process.pid}`)
    try {
      writeFileSync(tmp, `${limits}\n`)
      renameSync(tmp, join(folder, LIMITS_FILE))
    } catch {
      rmSync(tmp, { force: true })
    }
  }
}

/**
 * Git Bash of Git for Windows: CLAUDE_CODE_GIT_BASH_PATH, else next to git.exe on PATH, else under
 * %ProgramFiles%\Git or %LOCALAPPDATA%\Programs\Git — the order of findGitBash in
 * src/main/agent/env.ts. Nothing under %SystemRoot%: C:\Windows\System32\bash.exe starts WSL.
 */
export function gitBash(env = process.env, exists = existsSync) {
  const systemRoot = (env.SystemRoot || 'C:\\Windows').toLowerCase()
  const candidates = []
  if (env.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(env.CLAUDE_CODE_GIT_BASH_PATH)
  for (const dir of (env.PATH ?? env.Path ?? '').split(';')) {
    const clean = dir.trim().replace(/^"(.*)"$/, '$1')
    if (!clean || !exists(win32.join(clean, 'git.exe'))) continue
    let root = clean
    if (['cmd', 'bin'].includes(win32.basename(root).toLowerCase())) root = win32.dirname(root)
    if (win32.basename(root).toLowerCase() === 'mingw64') root = win32.dirname(root)
    candidates.push(win32.join(root, 'bin', 'bash.exe'))
    break
  }
  if (env.ProgramFiles) candidates.push(win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'))
  if (env.LOCALAPPDATA) candidates.push(win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'))
  return candidates.find((path) => !path.toLowerCase().startsWith(`${systemRoot}\\`) && exists(path)) ?? null
}

/** How the user's command runs: `sh -c` on macOS and Linux, Git Bash `-c` on Windows, else Node's default shell. */
export function commandRunner(command, platform = process.platform, env = process.env, exists = existsSync) {
  if (platform !== 'win32') return { file: 'sh', args: ['-c', command], shell: false }
  const bash = gitBash(env, exists)
  return bash ? { file: bash, args: ['-c', command], shell: false } : { file: command, args: [], shell: true }
}

function main() {
  let input = ''
  try {
    input = readFileSync(0, 'utf8')
  } catch {
    // No stdin: nothing to copy, nothing to pass on.
  }
  try {
    const limits = rateLimitsOf(input)
    if (limits !== null) writeLimits(limitsFolders(), limits)
  } catch {
    // The status line never fails because of the Limits.
  }
  const command = process.argv[2]
  if (command === undefined) return
  const { file, args, shell } = commandRunner(command)
  const result = spawnSync(file, args, { input, stdio: ['pipe', 'inherit', 'inherit'], shell })
  process.exitCode = result.status ?? 1
}

/** Run as a script, not imported (the test imports the functions above). */
function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) main()
