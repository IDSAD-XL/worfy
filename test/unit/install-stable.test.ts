// scripts/install-stable.mjs (worfy-windows ticket 12): the stable copy of worfy on macOS and on
// Windows. The parts that decide by the system take it as a parameter, so both are tested here on
// any machine; so is the swap of the copies, over a stand-in of the file system. Then the script
// itself: its refusals on any system, and on Windows whole installs over a stand-in build, with
// %LOCALAPPDATA% pointed at a temporary folder. On macOS a whole install is run by
// test/e2e/packaged.spec.ts.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Env = Record<string, string | undefined>
interface Files {
  there: (path: string) => boolean
  rename: (from: string, to: string) => void
}
interface InstallStable {
  defaultTarget: (platform: string, env: Env, home: string) => string
  installerDir: (env: Env, home: string) => string
  checkTarget: (platform: string, target: string, env: Env, home: string, installed?: string) => string
  metadataPath: (platform: string, target: string) => string
  runningCopies: (platform: string, targets: string[], listing: string) => string[]
  notACopy: (names: string[]) => string | null
  leftovers: (names: string[], base: string, alive: (pid: number) => boolean) => { installing: string[]; replaced: string[] }
  buildCommand: (platform: string) => { command: string; args: string[]; shell: boolean }
  builtApp: (platform: string, dist: string, names: string[], exists: (path: string) => boolean) => string
  swapIn: (paths: { staging: string; target: string; aside: string }, files: Files) => string | null
  installStable: (argv: string[], options: { env: Env; repo: string; build: (platform: string, repo: string) => void }) => string
  stamp: (ms: number) => string
}
const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'install-stable.mjs')
const { defaultTarget, installerDir, checkTarget, metadataPath, runningCopies, notACopy, leftovers, buildCommand, builtApp, swapIn, installStable, stamp } = (await import(
  pathToFileURL(SCRIPT).href
)) as InstallStable

const WINDOWS = process.platform === 'win32'
const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }
const WIN_HOME = 'C:\\Users\\dev'
const MAC_HOME = '/Users/dev'
const INSTALLED = 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy'

describe('the target of the stable copy', () => {
  it('by default is ~/Applications/worfy-stable.app on macOS, with worfy-stable.json next to it', () => {
    const target = defaultTarget('darwin', {}, MAC_HOME)
    expect(target).toBe('/Users/dev/Applications/worfy-stable.app')
    expect(checkTarget('darwin', target, {}, MAC_HOME)).toBe(target)
    expect(metadataPath('darwin', target)).toBe('/Users/dev/Applications/worfy-stable.json')
  })

  it('by default is %LOCALAPPDATA%\\worfy-stable on Windows, with worfy-stable.json next to it: not under Programs, where the installer works', () => {
    const target = defaultTarget('win32', WIN_ENV, WIN_HOME)
    expect(target).toBe('C:\\Users\\dev\\AppData\\Local\\worfy-stable')
    expect(checkTarget('win32', target, WIN_ENV, WIN_HOME)).toBe(target)
    expect(metadataPath('win32', target)).toBe('C:\\Users\\dev\\AppData\\Local\\worfy-stable.json')
    // Without the variable the folder is the one Windows gives a user by default.
    expect(defaultTarget('win32', {}, WIN_HOME)).toBe(target)
    expect(defaultTarget('win32', { LOCALAPPDATA: 'D:\\Local' }, WIN_HOME)).toBe('D:\\Local\\worfy-stable')
    // The default is accepted wherever %LOCALAPPDATA% is.
    expect(checkTarget('win32', 'D:\\Local\\worfy-stable', { LOCALAPPDATA: 'D:\\Local' }, WIN_HOME)).toBe('D:\\Local\\worfy-stable')
  })

  it('the folder of the installer is Programs\\worfy under %LOCALAPPDATA%, or under the default of a user without the variable', () => {
    expect(installerDir(WIN_ENV, WIN_HOME)).toBe(INSTALLED)
    expect(installerDir({ LOCALAPPDATA: 'D:\\Local' }, WIN_HOME)).toBe('D:\\Local\\Programs\\worfy')
    expect(installerDir({}, 'C:\\Users\\other')).toBe('C:\\Users\\other\\AppData\\Local\\Programs\\worfy')
    expect(installerDir({ LOCALAPPDATA: '' }, WIN_HOME)).toBe(INSTALLED)
  })

  it('on macOS must end in .app; a trailing slash, as shell completion writes it, is dropped first', () => {
    expect(checkTarget('darwin', '/tmp/x/worfy-stable.app/', {}, MAC_HOME)).toBe('/tmp/x/worfy-stable.app')
    expect(() => checkTarget('darwin', '/tmp/not-an-app', {}, MAC_HOME)).toThrow('the target must be a path ending in .app, got: /tmp/not-an-app')
    expect(() => checkTarget('darwin', '/tmp/not-an-app/', {}, MAC_HOME)).toThrow('got: /tmp/not-an-app')
    expect(() => checkTarget('darwin', '/Users/dev/Applications/worfy-stable', {}, MAC_HOME)).toThrow(/must be a path ending in \.app/)
  })

  it('on Windows is any folder but the one the installer uses, one inside it, one around it, or a whole disk', () => {
    expect(checkTarget('win32', 'D:\\apps\\worfy-stable\\', WIN_ENV, WIN_HOME)).toBe('D:\\apps\\worfy-stable')
    for (const target of [INSTALLED, 'c:\\users\\DEV\\appdata\\local\\programs\\WORFY\\', `${INSTALLED}\\stable`, 'C:\\Users\\dev\\AppData\\Local\\Programs', 'C:\\Users\\dev']) {
      expect(() => checkTarget('win32', target, WIN_ENV, WIN_HOME), target).toThrow(/cannot be the folder the installer of worfy uses/)
    }
    expect(() => checkTarget('win32', 'D:\\', WIN_ENV, WIN_HOME)).toThrow(/not a whole disk/)
    // A .app ending means nothing on Windows.
    expect(checkTarget('win32', 'D:\\apps\\worfy-stable.app', WIN_ENV, WIN_HOME)).toBe('D:\\apps\\worfy-stable.app')
    expect(metadataPath('win32', 'D:\\apps\\worfy-stable.app')).toBe('D:\\apps\\worfy-stable.app.json')
  })

  it('on Windows is no path that starts with the path of the installer\'s folder: the installer stops every program whose path starts with it', () => {
    for (const target of [`${INSTALLED}-2`, `${INSTALLED}-stable`, 'c:\\USERS\\dev\\appdata\\local\\programs\\WORFY2', `${INSTALLED}-stable\\deeper`]) {
      expect(() => checkTarget('win32', target, WIN_ENV, WIN_HOME), target).toThrow(/cannot start with the path of the folder the installer of worfy uses/)
    }
    // A neighbour whose name only shares some letters, or that ends with the name, is fine.
    for (const target of ['C:\\Users\\dev\\AppData\\Local\\Programs\\wor', 'C:\\Users\\dev\\AppData\\Local\\Programs\\my-worfy', 'C:\\Users\\dev\\AppData\\Local\\Programs\\other']) {
      expect(checkTarget('win32', target, WIN_ENV, WIN_HOME), target).toBe(target)
    }
  })

  it('on Windows takes the folder of the installer as it is told, when the disk spells it another way', () => {
    expect(() => checkTarget('win32', 'D:\\elsewhere\\worfy', WIN_ENV, WIN_HOME, 'D:\\elsewhere\\worfy')).toThrow(/cannot be the folder the installer/)
    expect(() => checkTarget('win32', 'D:\\elsewhere\\worfy-2', WIN_ENV, WIN_HOME, 'D:\\elsewhere\\worfy')).toThrow(/cannot start with the path/)
    expect(checkTarget('win32', INSTALLED.replace('Programs', 'Other'), WIN_ENV, WIN_HOME, 'D:\\elsewhere\\worfy')).toBe(INSTALLED.replace('Programs', 'Other'))
  })
})

describe('a running copy in the list of processes', () => {
  it('on macOS is a line of ps whose command lies inside the target, by either spelling of its path', () => {
    const ps = [
      '  501 /sbin/launchd',
      ' 9120 /Users/dev/Applications/worfy-stable.app/Contents/MacOS/worfy',
      ' 9131 /Users/dev/Applications/worfy-stable.app/Contents/Frameworks/worfy Helper.app/Contents/MacOS/worfy Helper --type=gpu-process',
      ' 9200 /Applications/worfy.app/Contents/MacOS/worfy',
      ' 9300 /private/var/folders/x/worfy-stable.app/Contents/MacOS/worfy',
      ' 9400 /usr/bin/grep /Users/dev/Applications/worfy-stable.app',
      '',
    ].join('\n')
    const running = runningCopies('darwin', ['/Users/dev/Applications/worfy-stable.app'], ps)
    expect(running.map((line) => line.trim().split(' ')[0])).toEqual(['9120', '9131'])
    // /var is a link to /private/var: a process shows the path it was started by.
    expect(runningCopies('darwin', ['/var/folders/x/worfy-stable.app', '/private/var/folders/x/worfy-stable.app'], ps)).toHaveLength(1)
    expect(runningCopies('darwin', ['/Users/dev/Applications/worfy-other.app'], ps)).toEqual([])
    expect(runningCopies('darwin', ['/Users/dev/Applications/worfy-stable.app'], '')).toEqual([])
  })

  it('on Windows is a process whose executable lies inside the target folder, in any case of the letters', () => {
    const listing = JSON.stringify([
      { ProcessId: 4, Name: 'System', ExecutablePath: null },
      { ProcessId: 812, Name: 'svchost.exe', ExecutablePath: 'C:\\Windows\\System32\\svchost.exe' },
      { ProcessId: 9120, Name: 'worfy.exe', ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\worfy-stable\\worfy.exe' },
      { ProcessId: 9131, Name: 'claude.exe', ExecutablePath: 'c:\\users\\dev\\appdata\\local\\WORFY-STABLE\\resources\\app.asar.unpacked\\node_modules\\claude.exe' },
      { ProcessId: 9200, Name: 'worfy.exe', ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy\\worfy.exe' },
      { ProcessId: 9300, Name: 'worfy.exe', ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\worfy-stable-2\\worfy.exe' },
    ])
    const target = 'C:\\Users\\dev\\AppData\\Local\\worfy-stable'
    expect(runningCopies('win32', [target], listing)).toEqual([
      '9120 C:\\Users\\dev\\AppData\\Local\\worfy-stable\\worfy.exe',
      '9131 c:\\users\\dev\\appdata\\local\\WORFY-STABLE\\resources\\app.asar.unpacked\\node_modules\\claude.exe',
    ])
    expect(runningCopies('win32', ['D:\\elsewhere'], listing)).toEqual([])
    // PowerShell prints one process as an object, not a list; and nothing at all for none.
    expect(runningCopies('win32', [target], JSON.stringify({ ProcessId: 7, Name: 'worfy.exe', ExecutablePath: `${target}\\worfy.exe` }))).toEqual([`7 ${target}\\worfy.exe`])
    expect(runningCopies('win32', [target], '\r\n')).toEqual([])
  })

  it('on Windows is found by every spelling of the target it is given: neither of these two paths holds the other', () => {
    const typed = 'C:\\Users\\dev\\links\\stable'
    const onDisk = 'D:\\apps\\worfy-stable'
    const listing = JSON.stringify([
      { ProcessId: 11, Name: 'worfy.exe', ExecutablePath: `${typed}\\worfy.exe` },
      { ProcessId: 12, Name: 'worfy.exe', ExecutablePath: `${onDisk}\\worfy.exe` },
    ])
    expect(runningCopies('win32', [typed], listing)).toEqual([`11 ${typed}\\worfy.exe`])
    expect(runningCopies('win32', [onDisk], listing)).toEqual([`12 ${onDisk}\\worfy.exe`])
    expect(runningCopies('win32', [typed, onDisk], listing)).toHaveLength(2)
  })

  it('on Windows a worfy.exe whose path Windows does not give counts: it may be the copy, run by another user or elevated', () => {
    const listing = JSON.stringify([
      { ProcessId: 4, Name: 'System', ExecutablePath: null },
      { ProcessId: 31, Name: 'WORFY.exe', ExecutablePath: null },
      { ProcessId: 32, Name: 'worfy.exe' },
      { ProcessId: 33, Name: 'claude.exe', ExecutablePath: null },
      { ProcessId: 34, Name: 'my-worfy.exe', ExecutablePath: null },
    ])
    const running = runningCopies('win32', ['D:\\apps\\worfy-stable'], listing)
    expect(running.map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual(['31 WORFY.exe', '32 worfy.exe'])
    expect(running[0]).toMatch(/does not say where it runs from/)
  })
})

describe('what the script replaces and writes', () => {
  it('takes a Windows folder for an earlier copy only when it holds worfy.exe, or nothing', () => {
    expect(notACopy([])).toBeNull()
    expect(notACopy(['resources', 'Worfy.EXE', 'LICENSE.txt'])).toBeNull()
    expect(notACopy(['Documents', 'photo.jpg'])).toMatch(/holds no worfy\.exe/)
    // Names that only look like it.
    for (const name of ['worfy.exe.bak', 'my-worfy.exe', 'worfy.exe.config', 'worfy', 'worfy.ex']) expect(notACopy([name, 'resources']), name).toMatch(/holds no worfy\.exe/)
  })

  it('never takes a folder with the uninstaller of worfy for a copy: the installer put that worfy there, wherever it is', () => {
    expect(notACopy(['worfy.exe', 'Uninstall worfy.exe', 'resources'])).toMatch(/the installer of worfy put it there/)
    expect(notACopy(['WORFY.EXE', 'uninstall WORFY.exe'])).toMatch(/not a stable copy/)
    expect(notACopy(['Uninstall worfy.exe'])).toMatch(/the installer of worfy put it there/)
    // Another program's uninstaller says nothing.
    expect(notACopy(['worfy.exe', 'Uninstall other.exe'])).toBeNull()
  })

  it('knows what an interrupted run left next to the target, and leaves alone what a running install is using', () => {
    const names = ['worfy-stable', 'worfy-stable.json', 'worfy-stable.installing-100', 'worfy-stable.installing-200', 'worfy-stable.replaced-300', 'worfy-stable.replaced-400', 'worfy-stable.installing-x', 'worfy-stable.installing-', 'worfy-stable-2.installing-100', 'other.replaced-300']
    const alive = (pid: number) => pid === 200 || pid === 400
    expect(leftovers(names, 'worfy-stable', alive)).toEqual({ installing: ['worfy-stable.installing-100'], replaced: ['worfy-stable.replaced-300'] })
    expect(leftovers(names, 'worfy-stable', () => false)).toEqual({ installing: ['worfy-stable.installing-100', 'worfy-stable.installing-200'], replaced: ['worfy-stable.replaced-300', 'worfy-stable.replaced-400'] })
    expect(leftovers(names, 'worfy-stable-2', () => false)).toEqual({ installing: ['worfy-stable-2.installing-100'], replaced: [] })
    expect(leftovers([], 'worfy-stable', () => false)).toEqual({ installing: [], replaced: [] })
  })

  it('writes a time in UTC to the second, as the metadata file always had it', () => {
    expect(stamp(Date.UTC(2026, 9, 10, 18, 5, 9, 987))).toBe('2026-10-10T18:05:09Z')
    expect(stamp(0)).toBe('1970-01-01T00:00:00Z')
  })
})

describe('the build the script copies', () => {
  it('is made by pnpm package; on Windows through a shell, since pnpm is pnpm.cmd there', () => {
    // One text for the shell: arguments next to a shell are joined without quoting, and Node 24 warns about them.
    expect(buildCommand('win32')).toEqual({ command: 'pnpm package', args: [], shell: true })
    expect(buildCommand('darwin')).toEqual({ command: 'pnpm', args: ['package'], shell: false })
    expect(buildCommand('linux')).toEqual({ command: 'pnpm', args: ['package'], shell: false })
  })

  it('on Windows is dist\\win-unpacked, and its absence is an error', () => {
    expect(builtApp('win32', 'C:\\repo\\dist', ['win-unpacked', 'worfy Setup 0.2.0.exe'], (path) => path === 'C:\\repo\\dist\\win-unpacked')).toBe('C:\\repo\\dist\\win-unpacked')
    expect(() => builtApp('win32', 'C:\\repo\\dist', ['win-ia32-unpacked'], () => false)).toThrow('expected dist\\win-unpacked after the build, and it is not there')
  })

  it('on macOS is the one folder of dist that starts with mac and holds worfy.app; none or several is an error', () => {
    const has = (...paths: string[]) => (path: string) => paths.includes(path)
    expect(builtApp('darwin', '/repo/dist', ['mac-arm64', 'builder-debug.yml'], has('/repo/dist/mac-arm64/worfy.app'))).toBe('/repo/dist/mac-arm64/worfy.app')
    expect(builtApp('darwin', '/repo/dist', ['mac'], has('/repo/dist/mac/worfy.app'))).toBe('/repo/dist/mac/worfy.app')
    // A mac folder without the app in it, and a folder of another name with one, are not builds.
    expect(builtApp('darwin', '/repo/dist', ['mac', 'mac-arm64', 'linux'], has('/repo/dist/mac-arm64/worfy.app', '/repo/dist/linux/worfy.app'))).toBe('/repo/dist/mac-arm64/worfy.app')
    expect(() => builtApp('darwin', '/repo/dist', ['mac-arm64'], () => false)).toThrow('expected exactly one dist/mac*/worfy.app after the build, found 0')
    expect(() => builtApp('darwin', '/repo/dist', [], () => true)).toThrow('found 0')
    expect(() => builtApp('darwin', '/repo/dist', ['mac', 'mac-arm64'], () => true)).toThrow('found 2')
  })
})

describe('the swap of the copies', () => {
  /** A stand-in of a folder of the disk: the names that are there, and renames that can be made to fail. */
  function disk(names: string[], failing: Record<string, string> = {}) {
    const set = new Set(names)
    const moves: string[] = []
    const files: Files = {
      there: (path) => set.has(path),
      rename: (from, to) => {
        moves.push(`${from} -> ${to}`)
        const reason = failing[`${from} -> ${to}`]
        if (reason !== undefined) throw new Error(reason)
        if (!set.has(from)) throw new Error(`ENOENT: ${from}`)
        set.delete(from)
        set.add(to)
      },
    }
    return { files, moves, names: () => [...set].sort() }
  }
  const PATHS = { staging: 'T.installing-7', target: 'T', aside: 'T.replaced-7' }

  it('with no copy at the target only moves the new one in, and has nothing to remove afterwards', () => {
    const d = disk(['T.installing-7'])
    expect(swapIn(PATHS, d.files)).toBeNull()
    expect(d.moves).toEqual(['T.installing-7 -> T'])
    expect(d.names()).toEqual(['T'])
  })

  it('moves the earlier copy aside, then the new one in, and answers the earlier copy to remove: it is whole until then', () => {
    const d = disk(['T', 'T.installing-7'])
    expect(swapIn(PATHS, d.files)).toBe('T.replaced-7')
    expect(d.moves).toEqual(['T -> T.replaced-7', 'T.installing-7 -> T'])
    expect(d.names()).toEqual(['T', 'T.replaced-7'])
  })

  it('when the earlier copy cannot be moved aside, leaves it where it is and touches nothing else', () => {
    const d = disk(['T', 'T.installing-7'], { 'T -> T.replaced-7': 'EPERM: operation not permitted' })
    expect(() => swapIn(PATHS, d.files)).toThrow('the copy at T could not be moved aside (EPERM: operation not permitted): a program may hold a file of it open. It is left as it was')
    expect(d.moves).toEqual(['T -> T.replaced-7'])
    expect(d.names()).toEqual(['T', 'T.installing-7'])
  })

  it('when the new copy cannot be moved in, puts the earlier one back and says so', () => {
    const d = disk(['T', 'T.installing-7'], { 'T.installing-7 -> T': 'EBUSY: resource busy' })
    expect(() => swapIn(PATHS, d.files)).toThrow('the new copy could not be put at T (EBUSY: resource busy); the copy that was there is back in place')
    expect(d.moves).toEqual(['T -> T.replaced-7', 'T.installing-7 -> T', 'T.replaced-7 -> T'])
    expect(d.names()).toEqual(['T', 'T.installing-7'])
  })

  it('when the earlier copy cannot be put back either, says where it is', () => {
    const d = disk(['T', 'T.installing-7'], { 'T.installing-7 -> T': 'EBUSY: resource busy', 'T.replaced-7 -> T': 'EACCES: permission denied' })
    expect(() => swapIn(PATHS, d.files)).toThrow('could not be put back (EACCES: permission denied): it is at T.replaced-7')
    expect(d.names()).toEqual(['T.installing-7', 'T.replaced-7'])
  })

  it('when there was no copy and the new one cannot be moved in, says only that', () => {
    const d = disk(['T.installing-7'], { 'T.installing-7 -> T': 'EXDEV: cross-device link' })
    expect(() => swapIn(PATHS, d.files)).toThrow('the new copy could not be put at T (EXDEV: cross-device link)')
    expect(() => swapIn(PATHS, d.files)).not.toThrow(/back in place/)
    expect(d.moves).toEqual(['T.installing-7 -> T', 'T.installing-7 -> T'])
  })
})

// The script itself. Its build is a stand-in folder that has what the script looks for on either
// system, and every folder it may write to is a temporary one.
describe('scripts/install-stable.mjs, run over a stand-in build', () => {
  let dir: string
  let local: string
  let build: string
  // Vitest runs in Electron, whose fs reads a file named app.asar as a folder; here it is a plain file.
  const electron = process as { noAsar?: boolean }
  let noAsar: boolean | undefined
  /** The junctions a test made. */
  const links: string[] = []
  const junction = (to: string, at: string): void => {
    symlinkSync(to, at, 'junction')
    links.push(at)
  }

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
  })

  afterEach(() => {
    // Links first, as links: under Electron's Node rmSync goes through a junction and empties what it leads to.
    for (const link of links.splice(0)) {
      try {
        rmdirSync(link)
      } catch {
        // Replaced by the script, or never made.
      }
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    electron.noAsar = noAsar
  })

  /** The target of a system: a folder on Windows, a path ending in .app elsewhere. */
  const targetIn = (...parts: string[]) => join(dir, ...parts.slice(0, -1), WINDOWS ? parts.at(-1)! : `${parts.at(-1)!}.app`)
  const run = (args: string[], env: Env = {}, script = SCRIPT) => {
    // process.execPath is Electron run as Node (ELECTRON_RUN_AS_NODE=1 is in the environment).
    // The working folder is the temporary one: a relative target would land there, not in the repository.
    // Electron's fs would read the stand-in app.asar as an archive; the Node that runs the script for a user has no such fs.
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: dir, env: { ...process.env, ELECTRON_NO_ASAR: '1', LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build, ...env } })
  }
  const head = (): string => spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

  it('refuses more than one argument before anything is made', () => {
    const two = run([targetIn('one'), targetIn('two')])
    expect(two.status).not.toBe(0)
    expect(two.stderr).toContain('install-stable: expected at most one argument, the target path; got 2')
    expect(readdirSync(dir).sort()).toEqual(['build'])
  }, 60_000)

  it('refuses a build that is not a folder, and one that does not look like a built worfy, and puts nothing at the target', () => {
    const target = targetIn('apps', 'worfy-stable')
    const notAFolder = run([target], { WORFY_STABLE_PREBUILT: join(build, 'worfy.exe') })
    expect(notAFolder.status).not.toBe(0)
    expect(notAFolder.stderr).toContain('install-stable: WORFY_STABLE_PREBUILT is not a folder')
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const noBuild = run([target], { WORFY_STABLE_PREBUILT: empty })
    expect(noBuild.status).not.toBe(0)
    expect(noBuild.stderr).toContain(`install-stable: ${empty} does not look like a built worfy: there is no ${WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist')} in it`)
    expect(existsSync(target)).toBe(false)
    expect(readdirSync(join(dir, 'apps'))).toEqual([])
  }, 60_000)

  // A whole install copies with ditto on macOS and with Node on Windows; Linux has neither system's copy.
  describe.runIf(process.platform !== 'linux')('a whole install', () => {
    it('writes the commit, whether the tree was clean, both times and the build it copied next to the copy', () => {
      const target = targetIn('apps', 'worfy-stable')
      const result = run([target])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const metadata = JSON.parse(readFileSync(join(dir, 'apps', 'worfy-stable.json'), 'utf8')) as Record<string, unknown>
      expect(Object.keys(metadata)).toEqual(['commit', 'dirty', 'builtAt', 'installedAt', 'source'])
      expect(metadata).toMatchObject({ commit: head(), source: build, builtAt: stamp(statSync(join(build, WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist'))).mtimeMs) })
      expect(typeof metadata.dirty).toBe('boolean')
      expect(metadata.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(result.stdout).toContain(`install-stable: installed ${target} (commit ${head().slice(0, 7)}`)
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    }, 60_000)

    it('replaces an earlier copy: a file that the new build does not have is gone, and nothing is left next to the target', () => {
      const target = targetIn('apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      writeFileSync(join(target, 'left-over.txt'), 'from the earlier copy')
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      const again = run([target])
      expect(again.stderr).toBe('')
      expect(again.status).toBe(0)
      expect(existsSync(join(target, 'left-over.txt'))).toBe(false)
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('the next build')
      // Neither the copy in progress nor the earlier copy set aside.
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual([WINDOWS ? 'worfy-stable' : 'worfy-stable.app', 'worfy-stable.json'].sort())
    }, 60_000)

    it('clears what an interrupted run left: its unfinished copy is removed, and a copy it had set aside goes back when nothing took its place', () => {
      const target = targetIn('apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      // A run with a pid that no process has stopped after it had moved the copy aside.
      const dead = 4_194_299
      const aside = `${target}.replaced-${dead}`
      const unfinished = `${target}.installing-${dead}`
      mkdirSync(join(unfinished, 'resources'), { recursive: true })
      writeFileSync(join(unfinished, 'half.txt'), 'half a copy')
      execFileSync(process.execPath, ['-e', 'require("node:fs").renameSync(process.argv[1], process.argv[2])', target, aside], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      expect(existsSync(target)).toBe(false)
      // The build is not one: the run stops after the clearing, before it copies anything.
      const empty = join(dir, 'empty')
      mkdirSync(empty)
      const stopped = run([target], { WORFY_STABLE_PREBUILT: empty })
      expect(stopped.stderr).toContain('does not look like a built worfy')
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual([WINDOWS ? 'worfy-stable' : 'worfy-stable.app', 'worfy-stable.json'].sort())
    }, 60_000)
  })

  describe.runIf(WINDOWS)('on Windows', () => {
    /** A real program under the name of the app: the command interpreter of Windows. */
    const realProgram = () => readFileSync(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe')

    it('without an argument installs into %LOCALAPPDATA%\\worfy-stable, with worfy-stable.json next to it', () => {
      const result = run([])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      // (PowerShell, asked for the list of processes, keeps its own folder under %LOCALAPPDATA%.)
      expect(readdirSync(local).filter((name) => name !== 'Microsoft').sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      expect(readFileSync(join(local, 'worfy-stable', 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The archive is copied as the file it is.
      expect(readFileSync(join(local, 'worfy-stable', 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      expect(result.stdout).toContain(`install-stable: installed ${join(local, 'worfy-stable')} (commit ${head().slice(0, 7)}`)
    }, 60_000)

    it('refuses the folder of the installer, a neighbour whose path starts with it, and a folder that is not an earlier copy, and leaves them as they were', () => {
      const installed = run([join(local, 'Programs', 'worfy')])
      expect(installed.status).not.toBe(0)
      expect(installed.stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      const neighbour = run([join(local, 'Programs', 'worfy-stable')])
      expect(neighbour.status).not.toBe(0)
      expect(neighbour.stderr).toContain('install-stable: the target cannot start with the path of the folder the installer of worfy uses')
      expect(existsSync(join(local, 'Programs'))).toBe(false)

      const mine = join(dir, 'Documents')
      mkdirSync(mine)
      writeFileSync(join(mine, 'letter.txt'), 'keep me')
      const refused = run([mine])
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toContain('holds no worfy.exe')
      expect(readdirSync(mine)).toEqual(['letter.txt'])
      expect(existsSync(`${mine}.json`)).toBe(false)
    }, 60_000)

    it('refuses the installed worfy under another spelling of its folder, and a worfy the installer put elsewhere', () => {
      // The installer's folder, with what the installer writes into it.
      const installed = join(local, 'Programs', 'worfy')
      mkdirSync(installed, { recursive: true })
      writeFileSync(join(installed, 'worfy.exe'), 'the installed worfy')
      writeFileSync(join(installed, 'Uninstall worfy.exe'), 'its uninstaller')
      for (const spelling of [`\\\\?\\${installed}`, `\\\\.\\${installed}`, installed.toUpperCase(), `//?/${installed.replace(/\\/g, '/')}`]) {
        const refused = run([spelling])
        expect(refused.status, spelling).not.toBe(0)
        expect(refused.stderr, spelling).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      }
      // A link to it from elsewhere.
      const link = join(dir, 'link-to-installed')
      junction(installed, link)
      expect(run([link]).stderr).toContain('the target cannot be the folder the installer of worfy uses')
      // The spelling through the administrative share stays a path of its own: the uninstaller in the folder tells.
      const share = `\\\\localhost\\${installed[0]}$${installed.slice(2)}`
      if (existsSync(share)) expect(run([share]).stderr).toContain('the installer of worfy put it there')
      // A worfy installed into another folder (/D=…).
      const elsewhere = join(dir, 'Tools', 'worfy-app')
      mkdirSync(elsewhere, { recursive: true })
      writeFileSync(join(elsewhere, 'worfy.exe'), 'the installed worfy')
      writeFileSync(join(elsewhere, 'Uninstall worfy.exe'), 'its uninstaller')
      const moved = run([elsewhere])
      expect(moved.status).not.toBe(0)
      expect(moved.stderr).toContain('the installer of worfy put it there')
      for (const folder of [installed, elsewhere]) expect(readdirSync(folder).sort()).toEqual(['Uninstall worfy.exe', 'worfy.exe'])
    }, 120_000)

    it('knows the folder of the installer by the spelling of the disk: Programs moved to another folder, with a link left in its place', () => {
      const moved = join(dir, 'MovedPrograms')
      mkdirSync(join(moved, 'worfy'), { recursive: true })
      mkdirSync(local)
      junction(moved, join(local, 'Programs'))
      // Typed as the real folder, the target has nothing of %LOCALAPPDATA% in its text.
      const same = run([join(moved, 'worfy')])
      expect(same.status).not.toBe(0)
      expect(same.stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      const neighbour = run([join(moved, 'worfy-2')])
      expect(neighbour.status).not.toBe(0)
      expect(neighbour.stderr).toContain('install-stable: the target cannot start with the path of the folder the installer of worfy uses')
      expect(readdirSync(moved)).toEqual(['worfy'])
      expect(readdirSync(join(moved, 'worfy'))).toEqual([])
    }, 60_000)

    it('a junction at the target is replaced as a link: the folder it led to keeps its files', () => {
      const behind = join(dir, 'behind')
      mkdirSync(behind)
      writeFileSync(join(behind, 'worfy.exe'), 'behind the junction')
      writeFileSync(join(behind, 'notes.txt'), 'keep me')
      const target = join(dir, 'apps', 'worfy-stable')
      mkdirSync(join(dir, 'apps'))
      junction(behind, target)
      const result = run([target])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(lstatSync(target).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The junction is gone, not set aside for a later run.
      expect(result.stdout).not.toContain('could not be removed')
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      expect(readdirSync(behind).sort()).toEqual(['notes.txt', 'worfy.exe'])
      expect(readFileSync(join(behind, 'worfy.exe'), 'utf8')).toBe('behind the junction')
    }, 60_000)

    it('copies the build from its real folder when it is given as a link: the copy is a folder, not a link to the build', () => {
      const link = join(dir, 'build-link')
      junction(build, link)
      const target = join(dir, 'apps', 'worfy-stable')
      const result = run([target], { WORFY_STABLE_PREBUILT: link })
      expect(result.stderr).toBe('')
      expect(lstatSync(target).isSymbolicLink()).toBe(false)
      writeFileSync(join(build, 'worfy.exe'), 'the build changed afterwards')
      expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The file next to the copy names the build as it was given.
      expect((JSON.parse(readFileSync(`${target}.json`, 'utf8')) as { source: string }).source).toBe(link)
    }, 60_000)

    it('refuses while a program of the copy is running — before it looks at the build — and leaves the copy in place', async () => {
      const target = join(dir, 'apps', 'worfy-stable')
      // It waits for a key on an input that stays open, until it is stopped below.
      writeFileSync(join(build, 'worfy.exe'), realProgram())
      expect(run([target]).status).toBe(0)
      const child = spawn(join(target, 'worfy.exe'), ['/d', '/c', 'pause'], { stdio: ['pipe', 'ignore', 'ignore'] })
      try {
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        // The build is not one: a run that looked at it first would say so.
        const refused = run([target], { WORFY_STABLE_PREBUILT: join(dir, 'no-such-build') })
        expect(refused.status).not.toBe(0)
        expect(refused.stderr).toContain(`${child.pid} `)
        expect(refused.stderr).toContain(`install-stable: the stable copy at ${target} is running`)
        expect(refused.stderr).not.toContain('WORFY_STABLE_PREBUILT')
        // The same copy under another spelling of its folder.
        const spelled = run([`\\\\?\\${target.toUpperCase()}`])
        expect(spelled.status).not.toBe(0)
        expect(spelled.stderr).toContain('is running')
        expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
        // And named through a junction to its folder: Windows shows the program by the real folder.
        const through = join(dir, 'link-to-the-copy')
        junction(target, through)
        const linked = run([through])
        expect(linked.status).not.toBe(0)
        expect(linked.stderr).toContain(`install-stable: the stable copy at ${through} is running`)
        expect(lstatSync(through).isSymbolicLink()).toBe(true)
      } finally {
        const gone = new Promise((resolve) => child.once('exit', resolve))
        child.kill()
        await gone
      }
    }, 120_000)

    it('a copy that cannot be moved aside stays whole, with the file that names its build; nothing of the new copy is left', async () => {
      const target = join(dir, 'apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      const before = readFileSync(`${target}.json`, 'utf8')
      // A program of the system whose working folder is inside the copy: Windows does not let the folder be renamed.
      const holder = spawn(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'pause'], { cwd: join(target, 'resources'), stdio: ['pipe', 'ignore', 'ignore'] })
      try {
        await new Promise((resolve, reject) => {
          holder.once('spawn', resolve)
          holder.once('error', reject)
        })
        writeFileSync(join(build, 'worfy.exe'), 'the next build')
        const failed = run([target])
        expect(failed.status).not.toBe(0)
        expect(failed.stderr).toContain(`install-stable: the copy at ${target} could not be moved aside`)
        expect(failed.stderr).toContain('It is left as it was')
        expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
        expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
        expect(readFileSync(`${target}.json`, 'utf8')).toBe(before)
        expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      } finally {
        const gone = new Promise((resolve) => holder.once('exit', resolve))
        holder.kill()
        await gone
      }
    }, 120_000)

    it('with no build given it builds, takes dist\\win-unpacked of the repository, and looks for a running copy again after the build', async () => {
      // A repository of its own, and a build step of the test: pnpm is never started.
      const repo = join(dir, 'repo')
      mkdirSync(repo)
      writeFileSync(join(repo, 'README.md'), 'a repository\n')
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=worfy test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
      git('init', '-q')
      git('add', '.')
      git('commit', '-q', '-m', 'a repository')
      const target = join(dir, 'apps', 'worfy-stable')
      const env = { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: '' }
      const builds: string[] = []
      const build = (platform: string, where: string): void => {
        builds.push(`${platform} ${where}`)
        mkdirSync(join(repo, 'dist', 'win-unpacked'), { recursive: true })
        writeFileSync(join(repo, 'dist', 'win-unpacked', 'worfy.exe'), realProgram())
      }
      const line = installStable([target], { env, repo, build })
      expect(builds).toEqual([`win32 ${repo}`])
      expect(line).toContain(`install-stable: installed ${target} (commit ${git('rev-parse', 'HEAD').trim().slice(0, 7)}, uncommitted changes)`)
      expect(readFileSync(join(target, 'worfy.exe')).equals(realProgram())).toBe(true)
      expect(JSON.parse(readFileSync(`${target}.json`, 'utf8'))).toMatchObject({ source: join(repo, 'dist', 'win-unpacked'), commit: git('rev-parse', 'HEAD').trim(), dirty: true })

      // The copy is not running when the script starts; a user starts it while the build runs.
      let child: ReturnType<typeof spawn> | undefined
      const buildWhileTheCopyStarts = (platform: string, where: string): void => {
        build(platform, where)
        child = spawn(join(target, 'worfy.exe'), ['/d', '/c', 'pause'], { stdio: ['pipe', 'ignore', 'ignore'] })
      }
      try {
        expect(() => installStable([target], { env, repo, build: buildWhileTheCopyStarts })).toThrow(`the stable copy at ${target} is running`)
        expect(builds).toHaveLength(2)
        expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
      } finally {
        if (child !== undefined) {
          const gone = new Promise((resolve) => child?.once('exit', resolve))
          child.kill()
          await gone
        }
      }

      // git writes its objects read-only, and rmSync of the temporary folder stops at such a file on Windows.
      for (const entry of readdirSync(join(repo, '.git', 'objects'), { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) chmodSync(join(entry.parentPath, entry.name), 0o666)
      }

      // A build that leaves no dist\win-unpacked is an error, and the copy stays.
      rmSync(join(repo, 'dist'), { recursive: true, force: true })
      expect(() => installStable([target], { env, repo, build: () => undefined })).toThrow('expected dist\\win-unpacked after the build, and it is not there')
      expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
    }, 180_000)
  })
})
