// What install-stable.test.ts and install-stable-functions.test.ts both need: the functions of
// scripts/install-stable.mjs. It also holds the stand-in build and the temporary folders of the
// cases that run the script. It is not a test file. The tests were split in two for worfy-windows
// ticket 28: the gate warns about a file longer than 1000 lines.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach } from 'vitest'
import { removeTestTree } from '../remove'

export type Env = Record<string, string | undefined>
export interface Files {
  there: (path: string) => boolean
  rename: (from: string, to: string) => void
}
interface InstallStable {
  defaultTarget: (platform: string, env: Env, home: string) => string
  installerDir: (env: Env, home: string) => string
  checkTarget: (platform: string, target: string, env: Env, home: string, installed?: string) => string
  metadataPath: (platform: string, target: string) => string
  runningCopies: (platform: string, targets: string[], listing: string, spell?: (path: string) => string) => string[]
  notACopy: (names: string[]) => string | null
  leftoverName: (base: string, kind: 'installing' | 'replaced', pid: number | string) => string
  leftovers: (names: string[], base: string, alive: (pid: number) => boolean) => { installing: string[]; replaced: string[]; kept: string[] }
  buildCommand: (platform: string) => { command: string; args: string[]; shell: boolean }
  builtApp: (platform: string, dist: string, names: string[], exists: (path: string) => boolean) => string
  swapIn: (paths: { staging: string; target: string; aside: string }, files: Files) => string | null
  onDisk: (path: string) => string
  installStable: (
    argv: string[],
    options: { env: Env; repo: string; build?: (platform: string, repo: string) => void; rename?: (from: string, to: string) => void; removeFolder?: (path: string) => void; listing?: (platform: string) => string },
  ) => string
  stamp: (ms: number) => string
  registerCommand: (platform: string, target: string, env: Env) => { command: string; args: string[] } | null
  LSREGISTER: string
  REMOVE_ROUNDS: number
}
export const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'install-stable.mjs')
export const { defaultTarget, installerDir, checkTarget, metadataPath, runningCopies, notACopy, leftoverName, leftovers, buildCommand, builtApp, swapIn, onDisk, installStable, stamp, registerCommand, LSREGISTER, REMOVE_ROUNDS } = (await import(
  pathToFileURL(SCRIPT).href
)) as InstallStable

export const WINDOWS = process.platform === 'win32'
export const WIN_HOME = 'C:\\Users\\dev'

// The folders of the test that is running. useStandInBuild sets them before each test; a file that
// imports them reads the value of that moment.
export let dir: string
export let local: string
export let build: string
// Vitest runs in Electron, whose fs reads a file named app.asar as a folder; here it is a plain file.
const electron = process as { noAsar?: boolean }
let noAsar: boolean | undefined
let lsregister: string | undefined
/** The folder of the stand-in of Launch Services' tool and of its log: not in `dir`, whose list the tests check. */
let tool: string
/**
 * What the stand-in of Launch Services' tool was asked, one line of arguments per call; it is the
 * program the script registers a copy with (WORFY_STABLE_LSREGISTER) off Windows: the stand-in
 * build is no app, and a test does not change what Launch Services knows of this Mac.
 */
export const registrations = (): string[] => {
  const log = join(tool, 'lsregister.log')
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((line) => line !== '') : []
}
/** The junctions a test made. */
export const links: string[] = []
export const junction = (to: string, at: string): void => {
  symlinkSync(to, at, 'junction')
  links.push(at)
}

/** Makes the stand-in build and the temporary folders before each test of the describe it is called in, and removes them after. */
export function useStandInBuild(): void {
  beforeEach(() => {
    noAsar = electron.noAsar
    electron.noAsar = true
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-install-stable-')))
    local = join(dir, 'Local')
    build = join(dir, 'build', WINDOWS ? 'win-unpacked' : 'worfy.app')
    mkdirSync(join(build, 'resources'), { recursive: true })
    mkdirSync(join(build, 'Contents'), { recursive: true })
    writeFileSync(join(build, 'worfy.exe'), 'not a real program')
    writeFileSync(join(build, 'Contents', 'Info.plist'), 'not a real plist')
    writeFileSync(join(build, 'resources', 'app.asar'), 'not a real archive')
    lsregister = process.env.WORFY_STABLE_LSREGISTER
    tool = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-install-stable-lsregister-')))
    if (!WINDOWS) {
      const stub = join(tool, 'lsregister')
      writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(tool, 'lsregister.log')}'\n`, { mode: 0o755 })
      process.env.WORFY_STABLE_LSREGISTER = stub
    }
  })

  afterEach(() => {
    // Links first, as links. (From the time this folder went with rmSync; removeTestTree takes a link as a link too.)
    for (const link of links.splice(0)) {
      try {
        rmdirSync(link)
      } catch {
        // Replaced by the script, or never made.
      }
    }
    removeTestTree(dir)
    removeTestTree(tool)
    electron.noAsar = noAsar
    if (lsregister === undefined) delete process.env.WORFY_STABLE_LSREGISTER
    else process.env.WORFY_STABLE_LSREGISTER = lsregister
  })
}

/** The target of a system: a folder on Windows, a path ending in .app elsewhere. */
export const targetIn = (...parts: string[]) => join(dir, ...parts.slice(0, -1), WINDOWS ? parts.at(-1)! : `${parts.at(-1)!}.app`)
export const run = (args: string[], env: Env = {}, script = SCRIPT) => {
  // process.execPath is Electron run as Node (ELECTRON_RUN_AS_NODE=1 is in the environment).
  // The working folder is the temporary one: a relative target would land there, not in the repository.
  // Electron's fs would read the stand-in app.asar as an archive; the Node that runs the script for a user has no such fs.
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: dir, env: { ...process.env, ELECTRON_NO_ASAR: '1', LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build, ...env } })
}
export const head = (): string => spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
