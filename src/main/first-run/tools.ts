// How the Harness and the first-run screen start a program found on the PATH: on Windows npm leaves `.cmd`
// files, which Node refuses to start without cmd.exe (src/main/first-run/checks.ts, src/main/harness/qmd.ts,
// src/main/update/build.ts).
import { execFile, type ChildProcess } from 'node:child_process'
import { win32 } from 'node:path'
import { fileOrAlias, findOnPath, getVar, type FileExists } from '../agent/env'
import { windowsProgramPath } from '../program'

export type Env = Readonly<Record<string, string | undefined>>

/** The winget ids of what the checks name on Windows. */
export const WINGET_IDS = { git: 'Git.Git', gh: 'GitHub.cli', jq: 'jqlang.jq', node: 'OpenJS.NodeJS.LTS', pwsh: 'Microsoft.PowerShell' } as const

const MAX_OUTPUT = 256 * 1024


export interface ToolRun {
  code: number | null
  stdout: string
  stderr: string
  /** Not on the PATH, or not executable. */
  missing: boolean
}

/** The extensions windowsProgram looks for, in the order of PATHEXT (`.COM;.EXE;.BAT;.CMD;…` by default). */
function programExtensions(env: Env): string[] {
  const listed = (getVar(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext === '.exe' || ext === '.cmd' || ext === '.bat')
  return listed.length > 0 ? listed : ['.exe', '.bat', '.cmd']
}

/**
 * A program on the PATH of `env` on Windows, found as the command line finds it: folder by folder,
 * in each folder `<name>.exe`, `.bat` and `.cmd` in the order of PATHEXT — so npm's claude.cmd in a
 * folder before that of a claude.exe wins, as it does in a terminal. `.bat` and `.cmd` only cmd.exe
 * runs (`cmd: true`). Null when there is none.
 */
export function windowsProgram(name: string, env: Env, exists?: FileExists): { file: string; cmd: boolean } | null {
  const extensions = programExtensions(env)
  for (const dir of (getVar(env, 'PATH') ?? '').split(';')) {
    for (const ext of extensions) {
      // findOnPath on that one folder: the same rules for a folder of the Path (full paths only, quotes).
      const file = findOnPath(`${name}${ext}`, { PATH: dir }, exists)
      if (file !== null) return { file, cmd: ext !== '.exe' }
    }
  }
  return null
}

/**
 * How a tool starts. Off Windows by its name, which the PATH of `env` resolves. On Windows by the
 * full path windowsProgram finds; a `.cmd` through cmd.exe of %SystemRoot%, because Node refuses to
 * start a `.cmd` or `.bat` itself (EINVAL, the fix of CVE-2024-27980). The arguments the checks pass
 * are constant words (`--version`, `auth status`), so the line cmd.exe gets needs no escaping. The
 * path itself is quoted but cmd.exe still expands `%NAME%` in it: a folder named with `%` would be
 * read as another one (none of the usual install folders is).
 */
export function toolStart(name: string, args: readonly string[], env: Env, platform: NodeJS.Platform, exists?: FileExists): { file: string; args: string[]; shell: string | false } | null {
  if (platform !== 'win32') return { file: name, args: [...args], shell: false }
  // A full path (a WORFY_GH override, or worfy's own executable that runs a `.mjs` one in runGh) is
  // that file, as "Sign in with gh" reads it (windowsProgramPath); only a bare name is looked for on
  // the Path, and a relative path is refused.
  const path = windowsProgramPath(name, exists ?? fileOrAlias)
  if (path.kind === 'relative') return null
  const program = path.kind === 'full' ? (path.file === null ? null : { file: path.file, cmd: /\.(?:cmd|bat)$/i.test(path.file) }) : windowsProgram(name, env, exists)
  if (program === null) return null
  if (!program.cmd) return { file: program.file, args: [...args], shell: false }
  const root = getVar(env, 'SystemRoot') ?? ''
  const cmdExe = win32.join(/^[A-Za-z]:[\\/]/.test(root) ? root : 'C:\\Windows', 'System32', 'cmd.exe')
  return { file: [`"${program.file}"`, ...args].join(' '), args: [], shell: cmdExe }
}

/** taskkill of %SystemRoot%, by its full path. */
function taskkillPath(env: Env): string {
  const root = getVar(env, 'SystemRoot') ?? ''
  return win32.join(/^[A-Za-z]:[\\/]/.test(root) ? root : 'C:\\Windows', 'System32', 'taskkill.exe')
}

/** Ends a tool that did not answer: on Windows its whole tree (taskkill /T /F on the child worfy started), elsewhere the process itself. */
export function killTool(child: ChildProcess, platform: NodeJS.Platform, env: Env): void {
  if (platform === 'win32' && child.pid !== undefined) {
    execFile(taskkillPath(env), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  } else {
    child.kill('SIGKILL')
  }
}

/**
 * Runs a tool found on the PATH of `env`. Never rejects. At `timeoutMs` the run is answered at once
 * as timed out, without waiting for its output pipes to close: a claude.cmd runs node.exe under
 * cmd.exe, and node.exe keeps the pipes open after cmd.exe is gone. The tool is ended then by
 * `kill` (killTool; tests wrap it).
 */
export function runTool(
  name: string,
  args: readonly string[],
  env: Env,
  timeoutMs: number,
  { platform = process.platform, kill = killTool, cwd }: { platform?: NodeJS.Platform; kill?: typeof killTool; cwd?: string } = {},
): Promise<ToolRun> {
  const start = toolStart(name, args, env, platform)
  if (start === null) return Promise.resolve({ code: null, stdout: '', stderr: '', missing: true })
  return new Promise((resolve) => {
    let settled = false
    const settle = (run: ToolRun): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(run)
    }
    const options = { env: env as NodeJS.ProcessEnv, maxBuffer: MAX_OUTPUT, encoding: 'utf8' as const, windowsHide: true, ...(cwd === undefined ? {} : { cwd }), ...(start.shell === false ? {} : { shell: start.shell }) }
    const child = execFile(start.file, start.args, options, (error, stdout, stderr) => {
      if (!error) return settle({ code: 0, stdout, stderr, missing: false })
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') return settle({ code: null, stdout, stderr, missing: true })
      settle({ code: typeof code === 'number' ? code : null, stdout, stderr: stderr || error.message, missing: false })
    })
    const timer = setTimeout(() => {
      settle({ code: null, stdout: '', stderr: `${name} did not answer within ${Math.round(timeoutMs / 1000)} s`, missing: false })
      kill(child, platform, env)
    }, timeoutMs)
  })
}
