// How worfy starts a program that an override variable may name another one in place of: `gh`
// and WORFY_GH (src/main/ipc/checks.ts, src/main/ipc/projects.ts), Claude Code and WORFY_CLAUDE
// (src/main/harness/install.ts).
//
// This exists for tests. They point worfy at a stand-in, and the stand-in is a Node script
// (test/fixtures/gh/gh-stub.mjs, the claude stub of test/contract/harness-install.test.ts). On
// macOS and Linux a `#!/bin/sh` wrapper next to it can be started as a program; Windows cannot
// start a script as a program. So an override that ends in
// `.mjs` is started as a script of worfy's own Node: the file is the one worfy runs from, the
// script is its first argument, and ELECTRON_RUN_AS_NODE=1 is added for that child. The same on
// every system.
//
// It is reached only through the override, which already points worfy at another program. With the
// variable unset the usual program — `gh` — starts exactly as before, and its name is not looked
// at. An override that does not end in `.mjs` (a real gh by its path, the wrapper) starts as it is.
// The installer gets WORFY_CLAUDE or the SDK's own binary as one path and passes it as the override:
// the SDK's binary is `claude` or `claude.exe`, never a `.mjs`, so it starts as it is too.
//
// It relies on Electron's run-as-Node mode, which a build can switch off with the RunAsNode fuse.
// This repository configures no fuses (electron-builder.yml has no electronFuses, and nothing
// flips them after packaging), so the mode is on in `pnpm dev` and in the packaged app.

import { posix, resolve, win32 } from 'node:path'

/** A full Windows path: a drive letter (`C:\…`, `C:/…`) or a network share (`\\…`). */
const WINDOWS_FULL_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/

/**
 * How Windows reads a program an override names (WORFY_GH), the one rule of the first-run checks
 * (src/main/first-run/checks.ts) and of "Sign in with gh" (src/main/github/accounts.ts):
 * - `name`: a bare name, for the caller to look for on the Path;
 * - `full`: a full path, that file with `.exe` added when it has no extension; `file` is null when
 *   there is no such file, and no other gh is looked for then;
 * - `relative`: a path that is not a full one (`tools\gh.exe`, `\opt\gh`), refused rather than looked
 *   for in every folder of the Path.
 */
export type WindowsProgramPath = { kind: 'name' } | { kind: 'relative' } | { kind: 'full'; file: string | null }

export function windowsProgramPath(program: string, exists: (path: string) => boolean): WindowsProgramPath {
  if (WINDOWS_FULL_PATH.test(program)) {
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

/**
 * What to start for `usual` when `override` may name another program in its place. `execPath` is
 * the file worfy itself runs from.
 *
 * A relative `.mjs` is resolved against worfy's own folder: the child runs in another one (gh in the
 * Project root), where Node would look for it otherwise. A path absolute in either form — POSIX or
 * Windows — stays as it is.
 */
export function programStart(override: string | undefined, usual: string, execPath: string = process.execPath): ProgramStart {
  if (override === undefined) return { file: usual, args: [], env: {} }
  if (!override.endsWith('.mjs')) return { file: override, args: [], env: {} }
  const script = posix.isAbsolute(override) || win32.isAbsolute(override) ? override : resolve(override)
  return { file: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
}
