// How worfy starts a program that an override variable may name another one in place of: `gh`
// and WORFY_GH (src/main/ipc/checks.ts, src/main/ipc/projects.ts), Claude Code and WORFY_CLAUDE
// (src/main/harness/install.ts).
//
// This exists for tests. They point worfy at a stand-in, and the stand-in is a Node script
// (test/fixtures/gh/gh-stub.mjs, the claude stub of test/contract/harness-install.test.ts). On
// macOS and Linux a `#!/bin/sh` wrapper next to it can be started as a program; Windows cannot
// start a script as a program. So an override that ends in `.mjs` is started as a Node script, and
// every start of a stand-in goes through this file:
// - programStart, for a child process: under the Node of scriptRunner, with the script as its
//   first argument. The same on every system.
// - programStartInPty, for a pseudo-terminal ("Sign in with gh", src/main/github/accounts.ts): the
//   same off Windows; on Windows under node.exe of the terminal's Path, because worfy's own
//   executable is a GUI program there and in a pseudo-terminal it prints nothing and reads nothing.
//
// It is reached only through the override, which already points worfy at another program. With the
// variable unset the usual program — `gh` — starts exactly as before, and its name is not looked
// at. An override that does not end in `.mjs` (a real gh by its path, the wrapper) starts as it is.
// The installer gets WORFY_CLAUDE or the SDK's own binary as one path and passes it as the override:
// the SDK's binary is `claude` or `claude.exe`, never a `.mjs`, so it starts as it is too.
//
// worfy's own executable is a Node only in Electron's run-as-Node mode, and the packaged worfy has
// it switched off: electron-builder.yml turns the RunAsNode fuse off (worfy-auto-approve ticket 12),
// so ELECTRON_RUN_AS_NODE=1 would start a second worfy there, not a Node. scriptRunner tells the two
// apart.

import { basename, posix, resolve, win32 } from 'node:path'
import { isWindowsAbsolutePath } from '../shared/paths'
import { fileOrAlias, findOnPath, type FileExists } from './agent/env'

/**
 * How Windows reads a program an override names (WORFY_GH) when it is not a `.mjs` stand-in, the
 * one rule of the first-run checks (src/main/first-run/checks.ts), of ghRunner
 * (src/main/github/prs.ts) and of "Sign in with gh" (src/main/github/accounts.ts):
 * - `name`: a bare name, for the caller to look for on the Path;
 * - `full`: a full path, that file with `.exe` added when it has no extension; `file` is null when
 *   there is no such file, and no other gh is looked for then;
 * - `relative`: a path that is not a full one (`tools\gh.exe`, `\opt\gh`), refused rather than looked
 *   for in every folder of the Path.
 */
export type WindowsProgramPath = { kind: 'name' } | { kind: 'relative' } | { kind: 'full'; file: string | null }

export function windowsProgramPath(program: string, exists: (path: string) => boolean): WindowsProgramPath {
  if (isWindowsAbsolutePath(program)) {
    // Backslashes, as a lookup on the Path would give it (`C:/tools/gh` is `C:\tools\gh.exe`).
    const file = win32.normalize(win32.extname(program) === '' ? `${program}.exe` : program)
    return { kind: 'full', file: exists(file) ? file : null }
  }
  return /[\\/]/.test(program) ? { kind: 'relative' } : { kind: 'name' }
}

/** What to start in place of a program. */
export interface ProgramStart {
  file: string
  /** Arguments that go before the caller's own. */
  args: string[]
  /** Variables to add to the environment of the child. */
  env: Record<string, string>
}

/** The program that runs a `.mjs` script, and the variables to add for it. */
export interface ScriptRunner {
  file: string
  env: Record<string, string>
}

/**
 * What runs a `.mjs` stand-in, for the file worfy runs from (`execPath`):
 * - the stock Electron of node_modules (`electron`, `electron.exe`): `pnpm dev`, the e2e runs of
 *   out/ and vitest. Its fuses are Electron's own, so it is a Node itself with ELECTRON_RUN_AS_NODE=1.
 * - any other file (worfy.app's `worfy`, `worfy.exe`): the packaged app, whose RunAsNode fuse is
 *   off. `node` by name, which the child's own PATH resolves as it resolves `gh`: no node there, and
 *   the start fails as a missing program does.
 * The rule of Electron's app.isPackaged, which reads the file name the same way; this file is loaded
 * by tests outside Electron, so it does not ask `app`.
 */
export function scriptRunner(execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): ScriptRunner {
  const name = (platform === 'win32' ? win32.basename(execPath) : basename(execPath)).toLowerCase()
  const stock = name === (platform === 'win32' ? 'electron.exe' : 'electron')
  return stock ? { file: execPath, env: { ELECTRON_RUN_AS_NODE: '1' } } : { file: 'node', env: {} }
}

/**
 * What to start for `usual` when `override` may name another program in its place. `execPath` is
 * the file worfy itself runs from: a `.mjs` override runs under scriptRunner of it.
 *
 * A relative `.mjs` is resolved against worfy's own folder (stubScript). A path absolute in either
 * form — POSIX or Windows — stays as it is.
 */
export function programStart(override: string | undefined, usual: string, execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): ProgramStart {
  if (override === undefined) return { file: usual, args: [], env: {} }
  const script = stubScript(override)
  if (script === null) return { file: override, args: [], env: {} }
  const runner = scriptRunner(execPath, platform)
  return { file: runner.file, args: [script], env: runner.env }
}

/**
 * programStart for a process that runs in a pseudo-terminal. Off Windows the same. On Windows a
 * `.mjs` override runs under node.exe, the first one in the Path of `env` (the environment the
 * pseudo-terminal gets), with no variable added; throws when there is none. Any other override, and
 * the usual program, come back as they are: the caller reads them by its own rule
 * (windowsProgramPath). The error names no variable: the caller adds the one it read.
 */
export function programStartInPty(
  override: string | undefined,
  usual: string,
  system: { platform?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>>; exists?: FileExists; execPath?: string } = {},
): ProgramStart {
  const script = override === undefined ? null : stubScript(override)
  if (script === null || (system.platform ?? process.platform) !== 'win32') return programStart(override, usual, system.execPath, system.platform)
  const node = findOnPath('node', system.env ?? {}, system.exists ?? fileOrAlias)
  if (node === null) throw new Error(`node.exe was not found in the Path: the .mjs stand-in ${override} needs it on Windows`)
  return { file: node, args: [script], env: {} }
}

/**
 * The script of a `.mjs` override, or null for any other override. A relative one is resolved
 * against worfy's own folder: the child runs in another one (gh in the Project root, a terminal in
 * its own folder), where Node would look for it otherwise.
 */
function stubScript(override: string): string | null {
  if (!override.endsWith('.mjs')) return null
  return posix.isAbsolute(override) || win32.isAbsolute(override) ? override : resolve(override)
}
