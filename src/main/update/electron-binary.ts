// Whether the Electron that `pnpm package` packs is in the clone of Update (worfy-update ticket 15).
// electron-builder.yml takes it from node_modules/electron/dist (electronDist), and the postinstall of
// the electron package downloads it there: install.js extracts the build into dist and, last, writes
// path.txt with the path of the program inside dist. A download that did not finish leaves dist
// empty or missing and no path.txt; `pnpm install` then answers "Already up to date" without running
// the postinstall again, and electron-builder fails minutes later with "electronDist does not exist".
//
// A copy of electronMissing of scripts/install-stable.mjs: that script is one file with no import of
// its own (a test copies it alone into another repository), and the main process does not import
// the script. test/unit/update-electron-binary.test.ts runs both over the same trees.
import { existsSync, readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/**
 * The script node runs in the clone to download the Electron again: ELECTRON_INSTALL of
 * scripts/install-stable.mjs without its `node`.
 */
export const ELECTRON_INSTALL_SCRIPT = 'node_modules/electron/install.js'

/**
 * `ok` — the program path.txt names is in dist; `no-package` — node_modules/electron is not there at
 * all, so there is no install.js to run; `no-download` — the package is there and its download did not
 * finish. On Windows path.txt says electron.exe; on macOS Electron.app/Contents/MacOS/Electron.
 */
export type ElectronBinary = 'ok' | 'no-package' | 'no-download'

export function electronBinary(
  platform: NodeJS.Platform,
  repo: string,
  exists: (path: string) => boolean = existsSync,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): ElectronBinary {
  const rules = platform === 'win32' ? win32 : posix
  const electron = rules.join(repo, 'node_modules', 'electron')
  if (!exists(electron)) return 'no-package'
  // install.js writes path.txt last: with none, the download did not finish.
  const pathTxt = rules.join(electron, 'path.txt')
  const program = exists(pathTxt) ? read(pathTxt).trim() : ''
  return program !== '' && exists(rules.join(electron, 'dist', program)) ? 'ok' : 'no-download'
}
