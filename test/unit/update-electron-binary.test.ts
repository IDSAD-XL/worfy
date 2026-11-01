// The check of the Electron that `pnpm package` packs (worfy-update ticket 15) lives twice:
// electronMissing of scripts/install-stable.mjs, a script with no import of its own, and its copy in
// src/main/update/electron-binary.ts, which the Update build runs. Both are run here over the same
// trees, on macOS, Windows and Linux paths, and must give the same answer.
import { join, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { electronBinary, ELECTRON_INSTALL_SCRIPT, type ElectronBinary } from '../../src/main/update/electron-binary'

/** Importing the script runs nothing (test/unit/install-stable-functions.test.ts). */
const script = (await import(pathToFileURL(join(import.meta.dirname, '..', '..', 'scripts', 'install-stable.mjs')).href)) as {
  ELECTRON_INSTALL: string
  electronMissing: (platform: string, repo: string, exists: (path: string) => boolean, read: (file: string) => string) => string | null
}

/** What path.txt says on each system, and the repository's path there. */
const SYSTEMS: [NodeJS.Platform, string, string][] = [
  ['darwin', '/Users/u/update/repo', 'Electron.app/Contents/MacOS/Electron'],
  ['win32', 'C:\\Users\\u\\AppData\\Roaming\\worfy\\update\\repo', 'electron.exe'],
  ['linux', '/home/u/update/repo', 'electron'],
]

/**
 * A tree: the paths under node_modules/electron that are there (`/`-separated), and what path.txt
 * says when it is one of them.
 */
interface Tree {
  paths: string[]
  pathTxt?: string
}

/** The trees, by the program path.txt names on the system; the answer of the copy. */
const TREES: [string, (program: string) => Tree, ElectronBinary][] = [
  ['a download that finished', (program) => ({ paths: ['', 'path.txt', `dist/${program}`], pathTxt: program }), 'ok'],
  ['path.txt with a line end after the program', (program) => ({ paths: ['', 'path.txt', `dist/${program}`], pathTxt: `${program}\n` }), 'ok'],
  ['no node_modules/electron', () => ({ paths: [] }), 'no-package'],
  ['the package with neither dist nor path.txt (the PC, 2026-11-01)', () => ({ paths: ['', 'install.js', 'package.json'] }), 'no-download'],
  ['the program in dist, no path.txt (install.js writes it last)', (program) => ({ paths: ['', `dist/${program}`] }), 'no-download'],
  ['an empty path.txt', (program) => ({ paths: ['', 'path.txt', `dist/${program}`], pathTxt: '' }), 'no-download'],
  ['path.txt naming a program dist does not hold', (program) => ({ paths: ['', 'path.txt', 'dist'], pathTxt: program }), 'no-download'],
]

describe('the Electron check of the Update build and of scripts/install-stable.mjs', () => {
  it('runs the command the script names', () => {
    expect(script.ELECTRON_INSTALL).toBe(`node ${ELECTRON_INSTALL_SCRIPT}`)
  })

  for (const [platform, repo, program] of SYSTEMS) {
    describe(platform, () => {
      const rules = platform === 'win32' ? win32 : posix
      const electron = rules.join(repo, 'node_modules', 'electron')
      it.each(TREES)('%s', (_, make, answer) => {
        const tree = make(program)
        const there = new Set(tree.paths.map((path) => (path === '' ? electron : rules.join(electron, ...path.split('/')))))
        const exists = (path: string): boolean => there.has(path)
        const read = (file: string): string => {
          if (file !== rules.join(electron, 'path.txt') || tree.pathTxt === undefined) throw new Error(`read of ${file}, which is not there`)
          return tree.pathTxt
        }
        const copy = electronBinary(platform, repo, exists, read)
        const original = script.electronMissing(platform, repo, exists, read)
        expect(copy).toBe(answer)
        // The script answers null when the copy says `ok`, and its "run pnpm install" when there is no package.
        expect(original === null).toBe(copy === 'ok')
        expect(original?.includes('run pnpm install') ?? false).toBe(copy === 'no-package')
      })
    })
  }
})
