// scripts/install-stable.mjs: the parts that decide by the system, which take it as a parameter, and
// the swap of the copies over a stand-in of the file system. None of these cases runs the script.
// They were moved out of install-stable.test.ts for worfy-windows ticket 28 (the gate warns about a
// file longer than 1000 lines); what the two files share is in install-stable-harness.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { build, buildCommand, builtApp, checkTarget, defaultTarget, dir, installerDir, leftoverName, leftovers, local, LSREGISTER, metadataPath, notACopy, registerCommand, removeInRounds, REPO, runningCopies, stamp, swapIn, targetIn, useStandInBuild, WIN_HOME, WINDOWS, type Env, type Files } from './install-stable-harness'

const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }
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

  it('on Windows takes a drive path written with \\\\?\\ or \\\\.\\ for the same folder, and leaves other paths of that kind as they are', () => {
    for (const prefix of ['\\\\?\\', '\\\\.\\', '//?/', '//./']) {
      expect(checkTarget('win32', `${prefix}D:\\apps\\worfy-stable`, WIN_ENV, WIN_HOME), prefix).toBe('D:\\apps\\worfy-stable')
      expect(() => checkTarget('win32', `${prefix}${INSTALLED}`, WIN_ENV, WIN_HOME), prefix).toThrow(/cannot be the folder the installer of worfy uses/)
      expect(() => checkTarget('win32', `${prefix}${INSTALLED}-2`, WIN_ENV, WIN_HOME), prefix).toThrow(/cannot start with the path/)
      expect(() => checkTarget('win32', `${prefix}D:\\`, WIN_ENV, WIN_HOME), prefix).toThrow(/not a whole disk/)
    }
    // A share written that way is no drive path: nothing is cut from it.
    expect(checkTarget('win32', '\\\\?\\UNC\\server\\share\\worfy-stable', WIN_ENV, WIN_HOME)).toBe('\\\\?\\UNC\\server\\share\\worfy-stable')
    expect(checkTarget('win32', '\\\\server\\share\\worfy-stable', WIN_ENV, WIN_HOME)).toBe('\\\\server\\share\\worfy-stable')
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

  it('on Windows is found when it was started through a `subst` drive: its path is spelled on disk before it is compared', () => {
    // Windows shows the path a program was started by; W: is a `subst` drive over C:\Users\dev\apps.
    const listing = JSON.stringify([
      { ProcessId: 21, Name: 'worfy.exe', ExecutablePath: 'W:\\worfy-stable\\worfy.exe' },
      { ProcessId: 22, Name: 'worfy.exe', ExecutablePath: 'W:\\worfy-other\\worfy.exe' },
    ])
    const target = 'C:\\Users\\dev\\apps\\worfy-stable'
    const spell = (path: string): string => path.replace(/^W:\\/, 'C:\\Users\\dev\\apps\\')
    expect(runningCopies('win32', [target], listing)).toEqual([])
    expect(runningCopies('win32', [target], listing, spell)).toEqual(['21 W:\\worfy-stable\\worfy.exe'])
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

  it('knows what an interrupted run left next to the target by its name and by a number a process can have; what a running install is using is told apart', () => {
    const names = [
      'worfy-stable',
      'worfy-stable.json',
      'worfy-stable.installing-100',
      'worfy-stable.installing-200',
      'worfy-stable.replaced-300',
      'worfy-stable.replaced-400',
      // Not leftovers: no number, a number no process can have, another target.
      'worfy-stable.installing-x',
      'worfy-stable.installing-',
      'worfy-stable.installing-0',
      'worfy-stable.installing-007',
      'worfy-stable.replaced-20261012',
      'worfy-stable.replaced-4194305',
      'worfy-stable.replaced-12.bak',
      'worfy-stable-2.installing-100',
      'other.replaced-300',
    ]
    const alive = (pid: number) => pid === 200 || pid === 400
    expect(leftovers(names, 'worfy-stable', alive)).toEqual({ installing: ['worfy-stable.installing-100'], replaced: ['worfy-stable.replaced-300'], kept: ['worfy-stable.installing-200', 'worfy-stable.replaced-400'] })
    expect(leftovers(names, 'worfy-stable', () => false)).toEqual({ installing: ['worfy-stable.installing-100', 'worfy-stable.installing-200'], replaced: ['worfy-stable.replaced-300', 'worfy-stable.replaced-400'], kept: [] })
    expect(leftovers(names, 'worfy-stable-2', () => false)).toEqual({ installing: ['worfy-stable-2.installing-100'], replaced: [], kept: [] })
    expect(leftovers([], 'worfy-stable', () => false)).toEqual({ installing: [], replaced: [], kept: [] })
    // The largest number a process can have is taken.
    expect(leftovers(['x.replaced-4194304'], 'x', () => false).replaced).toEqual(['x.replaced-4194304'])
    // The answer is in the order of the text of the names, whatever order they are listed in: a file system need not sort.
    expect(leftovers(['x.replaced-30', 'x.installing-9', 'x.replaced-200', 'x.installing-10'], 'x', (pid) => pid === 9)).toEqual({ installing: ['x.installing-10'], replaced: ['x.replaced-200', 'x.replaced-30'], kept: ['x.installing-9'] })
    const listed = ['x.replaced-30', 'x.replaced-200']
    leftovers(listed, 'x', () => false)
    expect(listed).toEqual(['x.replaced-30', 'x.replaced-200'])
  })

  it('finds the names the script itself gives to its unfinished copy and to the copy it moves aside', () => {
    expect(leftoverName('worfy-stable.app', 'installing', 4242)).toBe('worfy-stable.app.installing-4242')
    expect(leftoverName('worfy-stable', 'replaced', 77)).toBe('worfy-stable.replaced-77')
    expect(leftovers([leftoverName('t', 'installing', 4242), leftoverName('t', 'replaced', 77)], 't', () => false)).toEqual({ installing: ['t.installing-4242'], replaced: ['t.replaced-77'], kept: [] })
  })

  it('writes a time in UTC to the second, as the metadata file always had it', () => {
    expect(stamp(Date.UTC(2026, 9, 10, 18, 5, 9, 987))).toBe('2026-10-10T18:05:09Z')
    expect(stamp(0)).toBe('1970-01-01T00:00:00Z')
  })
})

describe('the registration of the copy with Launch Services', () => {
  const target = '/Users/dev/Applications/worfy-stable.app'

  it('on macOS is `lsregister -f <copy>`, so Notification Center takes the icon of the copy just installed', () => {
    expect(registerCommand('darwin', target, {})).toEqual({ command: LSREGISTER, args: ['-f', target] })
    expect(LSREGISTER).toBe('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister')
  })

  it('runs the program WORFY_STABLE_LSREGISTER names instead, and the tool when the variable is empty', () => {
    expect(registerCommand('darwin', target, { WORFY_STABLE_LSREGISTER: '/tmp/stand-in' })).toEqual({ command: '/tmp/stand-in', args: ['-f', target] })
    expect(registerCommand('darwin', target, { WORFY_STABLE_LSREGISTER: '' })).toEqual({ command: LSREGISTER, args: ['-f', target] })
  })

  it('is no step on Windows and Linux, which have no Launch Services', () => {
    expect(registerCommand('win32', 'C:\\Users\\dev\\AppData\\Local\\worfy-stable', { WORFY_STABLE_LSREGISTER: '/tmp/stand-in' })).toBeNull()
    expect(registerCommand('linux', '/home/dev/worfy-stable.app', {})).toBeNull()
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

// worfy-windows ticket 43, from the review of PR #283: the loop that runs a removal again on Windows
// was inside installStable behind the check of the system, so off Windows no test reached it. Here
// the removal is a stand-in that throws a code and touches no disk, and the pause is written down.
describe('a removal run again on Windows while the answer is "busy"', () => {
  /** A removal that fails `refusals` times with `code`, then answers 'removed'; and the pauses asked between runs. */
  function held(refusals: number, code: string | undefined) {
    const asked: string[] = []
    const pauses: number[] = []
    const remove = (path: string): string => {
      asked.push(path)
      if (asked.length <= refusals) throw Object.assign(new Error(`${code}: held`), { code })
      return 'removed'
    }
    return { asked, pauses, run: () => removeInRounds('C:\\apps\\worfy-stable.replaced-7', remove, (ms) => pauses.push(ms)) }
  }
  const BUSY = ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']

  it.each(BUSY)('%s: runs the removal again, five runs at most, with a pause of 100 ms before each new run, and throws the last error', (code) => {
    const forGood = held(99, code)
    expect(forGood.run).toThrow(`${code}: held`)
    expect(forGood.asked).toEqual(Array.from({ length: 5 }, () => 'C:\\apps\\worfy-stable.replaced-7'))
    expect(forGood.pauses).toEqual([100, 100, 100, 100])
  })

  it.each(BUSY)('%s four times: the fifth run removes it, and its answer is returned', (code) => {
    const fifth = held(4, code)
    expect(fifth.run()).toBe('removed')
    expect(fifth.asked).toHaveLength(5)
    expect(fifth.pauses).toEqual([100, 100, 100, 100])
  })

  it('a removal that goes at once is run once, with no pause', () => {
    const once = held(0, 'EBUSY')
    expect(once.run()).toBe('removed')
    expect(once.asked).toHaveLength(1)
    expect(once.pauses).toEqual([])
  })

  it.each(['EIO', 'EXDEV', 'ENOENT', 'ENOTDIR', 'ERR_FS_EISDIR', undefined])('another answer (%s) ends the removal at once: one run, no pause', (code) => {
    const other = held(99, code)
    expect(other.run).toThrow(`${code}: held`)
    expect(other.asked).toHaveLength(1)
    expect(other.pauses).toEqual([])
  })

  it('without a pause given, it waits for real: one busy run takes 100 ms more', () => {
    let runs = 0
    const started = performance.now()
    removeInRounds('C:\\x', () => {
      runs += 1
      if (runs === 1) throw Object.assign(new Error('EBUSY: held'), { code: 'EBUSY' })
    })
    // A timer of the system may come a few ms early. No upper bound: a slow worker is no error.
    expect(performance.now() - started).toBeGreaterThanOrEqual(100 - 20)
    expect(runs).toBe(2)
  })
})

// The deploy mark (ADR-0067, the Deploy Stage): after an install, the commit status `deploy: success` on the
// installed commit — in Full mode, for a copy built here from a clean tree, with origin on GitHub. The programs
// it runs are given as a stand-in: no test reaches gh or GitHub.
interface Run {
  status: number | null
  stdout: string
  stderr: string
  error?: { code?: string; message: string }
}
type Exec = (command: string, args: string[], options: { env?: Env }) => Run
interface DeployMark {
  markDeploy: (facts: { repo: string; commit: string; dirty: boolean; prebuilt: boolean; env: Env }, exec?: Exec) => string | null
  installStable: (
    argv: string[],
    options: { env: Env; repo: string; build?: (platform: string, repo: string) => void; mark?: (facts: { repo: string; commit: string; dirty: boolean; prebuilt: boolean; env: Env }) => string },
  ) => string
}
const { markDeploy, installStable: install } = (await import(pathToFileURL(join(REPO, 'scripts', 'install-stable.mjs')).href)) as DeployMark

const COMMIT = 'a'.repeat(40)
const ok = (stdout = ''): Run => ({ status: 0, stdout, stderr: '' })
const PROFILE_FULL = JSON.stringify({ github: { account: 'IDSAD-XL' }, _resolved: { mode: 'full' } })

/** A stand-in for spawnSync that answers each program by its name and records every call. */
function stand(answers: { profile?: Run; origin?: Run; token?: Run; api?: Run } = {}) {
  const calls: { command: string; args: string[]; env?: Env }[] = []
  const exec: Exec = (command, args, options) => {
    calls.push({ command, args, env: options.env })
    if (args.some((arg) => arg.endsWith(join('harness', 'bin', 'profile')))) return answers.profile ?? ok(PROFILE_FULL)
    if (command === 'git') return answers.origin ?? ok('https://github.com/IDSAD-XL/worfy.git\n')
    if (args[0] === 'auth') return answers.token ?? ok('gho_secret\n')
    if (args[0] === 'api') return answers.api ?? ok('{}')
    return { status: 1, stdout: '', stderr: `unexpected ${command}` }
  }
  return { exec, calls, gh: () => calls.filter((call) => call.command === 'gh') }
}
const facts = (extra: Partial<{ dirty: boolean; prebuilt: boolean; env: Env }> = {}) => ({ repo: '/r/worfy', commit: COMMIT, dirty: false, prebuilt: false, env: {}, ...extra })

describe('the deploy mark', () => {
  it('sets the commit status deploy: success on the installed commit of the GitHub origin, as the account of the profile', () => {
    const s = stand()
    const line = markDeploy(facts({ env: { PATH: '/bin' } }), s.exec)
    expect(line).toBe('install-stable: deploy mark: deploy success on aaaaaaa (IDSAD-XL/worfy)')
    expect(s.calls[0]).toMatchObject({ command: process.execPath, args: [join('/r/worfy', 'harness', 'bin', 'profile'), '-C', '/r/worfy', '--json'] })
    expect(s.calls[1]).toMatchObject({ command: 'git', args: ['-C', '/r/worfy', 'remote', 'get-url', 'origin'] })
    expect(s.gh().map((call) => call.args)).toEqual([
      ['auth', 'token', '-u', 'IDSAD-XL'],
      ['api', '-X', 'POST', `repos/IDSAD-XL/worfy/statuses/${COMMIT}`, '-f', 'state=success', '-f', 'context=deploy', '-f', 'description=installed as the stable copy'],
    ])
    expect(s.gh()[1]!.env).toMatchObject({ PATH: '/bin', GH_TOKEN: 'gho_secret' })
    expect(line).not.toContain('gho_secret')
  })

  it('keeps a GH_TOKEN the environment already has, and reads origin in its ssh spelling', () => {
    const s = stand({ origin: ok('git@github.com:IDSAD-XL/worfy.git\n') })
    expect(markDeploy(facts({ env: { GH_TOKEN: 'given' } }), s.exec)).toContain('deploy success on aaaaaaa (IDSAD-XL/worfy)')
    expect(s.gh().map((call) => call.args[0])).toEqual(['api'])
    expect(s.gh()[0]!.env?.GH_TOKEN).toBe('given')
  })

  it('takes WORFY_STABLE_GH for gh', () => {
    const s = stand()
    markDeploy(facts({ env: { WORFY_STABLE_GH: '/stub/gh', GH_TOKEN: 'given' } }), s.exec)
    expect(s.calls.at(-1)!.command).toBe('/stub/gh')
  })

  it.each([
    ['without gh', { token: { status: null, stdout: '', stderr: '', error: { code: 'ENOENT', message: 'spawnSync gh ENOENT' } } }, 'install-stable: deploy mark skipped: gh is not installed'],
    ['when gh api fails', { api: { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible\nmore' } }, 'install-stable: deploy mark skipped: gh api repos/IDSAD-XL/worfy/statuses/ failed (exit 1): HTTP 403: Resource not accessible'],
  ])('%s says "deploy mark skipped" and does not throw: the install matters more', (_name, answers, line) => {
    const s = stand(answers)
    expect(markDeploy(facts(), s.exec)?.replace(COMMIT, '')).toBe(line)
  })

  it.each([
    ['uncommitted changes', facts({ dirty: true }), {}, 'the tree has uncommitted changes, so the copy is not commit aaaaaaa'],
    ['no profile', facts(), { profile: { status: 3, stdout: '', stderr: 'profile: /r/worfy is not in a registered project\n' } }, 'no project profile (profile: /r/worfy is not in a registered project)'],
    ['Silent mode', facts(), { profile: ok(JSON.stringify({ _resolved: { mode: 'silent' } })) }, 'the project is in Silent mode: its marks stay off GitHub'],
    ['origin not on GitHub', facts(), { origin: ok('https://gitlab.com/a/b.git\n') }, 'origin is not on GitHub'],
    ['no origin', facts(), { origin: { status: 2, stdout: '', stderr: 'error: No such remote' } }, 'origin is not on GitHub'],
  ])('is skipped with %s, and gh is never run', (_name, given, answers, why) => {
    const s = stand(answers)
    expect(markDeploy(given, s.exec)).toBe(`install-stable: deploy mark skipped: ${why}`)
    expect(s.gh()).toEqual([])
  })

  it('with a prebuilt app (the tests\' path) runs nothing and says nothing; with uncommitted changes runs nothing', () => {
    const s = stand()
    expect(markDeploy(facts({ prebuilt: true }), s.exec)).toBeNull()
    markDeploy(facts({ dirty: true }), s.exec)
    expect(s.calls).toEqual([])
  })
})

// A whole install with a build step of the test, as `pnpm install:stable` runs: the mark comes after the copy is
// at the target and its metadata file is written, and a mark that throws does not fail the install.
// Not on Linux: there the copy step runs ditto, which only macOS has (the whole installs of install-stable.test.ts skip Linux too).
//
// Why these cases were slow: the stand-in of Launch Services' tool is a shell script useStandInBuild writes anew
// for every test, and macOS checks a new executable before its first run — about 400 ms on an idle Mac, several
// seconds on one a full gate loads, which took these cases past vitest's 5 s default. These cases do not look at
// what was registered, so the program they register with is /usr/bin/true, a system program macOS runs at once.
// What is left are real programs all the same (git, ps twice, ditto; PowerShell's list of processes twice on
// Windows), around 150 ms on an idle Mac: the explicit timeout keeps a loaded machine from failing them on time
// alone, as the contract project's 15 s does for its real processes. A case that really hangs still fails.
describe.runIf(process.platform !== 'linux')('the deploy mark after a whole install', { timeout: 15_000 }, () => {
  useStandInBuild()
  beforeEach(() => {
    // After useStandInBuild's own beforeEach, which points the variable at its script; its afterEach puts back the value from before.
    if (process.platform === 'darwin') process.env.WORFY_STABLE_LSREGISTER = '/usr/bin/true'
  })
  const repoWithBuild = () => {
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'README.md'), 'a repository\n')
    writeFileSync(join(repo, '.gitignore'), 'dist/\n')
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=worfy test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    git('init', '-q')
    git('add', '.')
    git('commit', '-q', '-m', 'a repository')
    const build = (): void => {
      const app = WINDOWS ? join(repo, 'dist', 'win-unpacked') : join(repo, 'dist', 'mac-arm64', 'worfy.app', 'Contents')
      mkdirSync(app, { recursive: true })
      writeFileSync(join(app, WINDOWS ? 'worfy.exe' : 'Info.plist'), 'not a real build')
    }
    return { repo, build, head: git('rev-parse', 'HEAD').trim() }
  }

  it('is set once, on the installed commit, after the copy and its metadata are in place', () => {
    const { repo, build, head } = repoWithBuild()
    const target = targetIn('apps', 'worfy-stable')
    const seen: { commit: string; dirty: boolean; prebuilt: boolean; copied: boolean; metadata: boolean }[] = []
    const mark = (given: { commit: string; dirty: boolean; prebuilt: boolean }) => {
      seen.push({ commit: given.commit, dirty: given.dirty, prebuilt: given.prebuilt, copied: existsSync(target), metadata: existsSync(metadataPath(process.platform, target)) })
      return 'install-stable: deploy mark: stand-in'
    }
    const out = install([target], { env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: '' }, repo, build, mark })
    expect(seen).toEqual([{ commit: head, dirty: false, prebuilt: false, copied: true, metadata: true }])
    expect(out).toContain(`install-stable: installed ${target} (commit ${head.slice(0, 7)})`)
    expect(out.split('\n').at(-1)).toBe('install-stable: deploy mark: stand-in')
  })

  it('a mark that throws leaves the install done, with the line "deploy mark skipped"', () => {
    const { repo, build } = repoWithBuild()
    const target = targetIn('apps', 'worfy-stable')
    const mark = (): string => {
      throw new Error('no network')
    }
    const out = install([target], { env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: '' }, repo, build, mark })
    expect(out).toContain(`install-stable: installed ${target}`)
    expect(out).toContain('install-stable: deploy mark skipped: no network')
    expect(existsSync(target)).toBe(true)
  })

  it('with the real mark and a prebuilt app, as every other test installs, runs no gh and adds no line', () => {
    const target = targetIn('apps', 'worfy-stable')
    const out = install([target], { env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build, WORFY_STABLE_GH: join(dir, 'no-such-gh') }, repo: REPO })
    expect(out.split('\n')).toEqual([expect.stringContaining(`install-stable: installed ${target} (commit `)])
  })
})
