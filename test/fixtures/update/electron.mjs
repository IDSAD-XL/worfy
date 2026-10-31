// node_modules/electron as the postinstall of the electron package leaves it when its download
// finished (README.md): the program in dist and, last, path.txt naming it. The program is an empty
// file: nothing here runs it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/** What path.txt names on this system: macOS Electron.app/Contents/MacOS/Electron, Windows electron.exe, Linux electron. */
export const PROGRAM = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron'

/** Puts the Electron into `<folder>/node_modules/electron`, by default the folder it runs in. */
export function putElectron(folder = '.') {
  const electron = join(folder, 'node_modules', 'electron')
  const program = join(electron, 'dist', ...PROGRAM.split('/'))
  mkdirSync(dirname(program), { recursive: true })
  writeFileSync(program, '')
  writeFileSync(join(electron, 'path.txt'), PROGRAM)
}
