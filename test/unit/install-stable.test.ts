// scripts/install-stable.mjs (worfy-windows ticket 12): the stable copy of worfy on macOS and on
// Windows. The parts that decide by the system take it as a parameter, so both are tested here on
// any machine; the last block runs the script itself on Windows, over a stand-in build and with
// %LOCALAPPDATA% pointed at a temporary folder. On macOS the script is run by test/e2e/packaged.spec.ts.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Env = Record<string, string | undefined>
interface InstallStable {
  defaultTarget: (platform: string, env: Env, home: string) => string
  installerDir: (env: Env, home: string) => string
  checkTarget: (platform: string, target: string, env: Env, home: string) => string
  metadataPath: (platform: string, target: string) => string
  runningCopies: (platform: string, targets: string[], listing: string) => string[]
  notACopy: (names: string[]) => string | null
  stamp: (ms: number) => string
}
const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'install-stable.mjs')
const { defaultTarget, installerDir, checkTarget, metadataPath, runningCopies, notACopy, stamp } = (await import(pathToFileURL(SCRIPT).href)) as InstallStable

const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }
const WIN_HOME = 'C:\\Users\\dev'
const MAC_HOME = '/Users/dev'

describe('the target of the stable copy', () => {
  it('by default is ~/Applications/worfy-stable.app on macOS, with worfy-stable.json next to it', () => {
    const target = defaultTarget('darwin', {}, MAC_HOME)
    expect(target).toBe('/Users/dev/Applications/worfy-stable.app')
    expect(checkTarget('darwin', target, {}, MAC_HOME)).toBe(target)
    expect(metadataPath('darwin', target)).toBe('/Users/dev/Applications/worfy-stable.json')
  })

  it('by default is %LOCALAPPDATA%\\Programs\\worfy-stable on Windows, with worfy-stable.json next to it', () => {
    const target = defaultTarget('win32', WIN_ENV, WIN_HOME)
    expect(target).toBe('C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable')
    expect(checkTarget('win32', target, WIN_ENV, WIN_HOME)).toBe(target)
    expect(metadataPath('win32', target)).toBe('C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable.json')
    // Without the variable the folder is the one Windows gives a user by default.
    expect(defaultTarget('win32', {}, WIN_HOME)).toBe(target)
    expect(defaultTarget('win32', { LOCALAPPDATA: 'D:\\Local' }, WIN_HOME)).toBe('D:\\Local\\Programs\\worfy-stable')
  })

  it('on macOS must end in .app; a trailing slash, as shell completion writes it, is dropped first', () => {
    expect(checkTarget('darwin', '/tmp/x/worfy-stable.app/', {}, MAC_HOME)).toBe('/tmp/x/worfy-stable.app')
    expect(() => checkTarget('darwin', '/tmp/not-an-app', {}, MAC_HOME)).toThrow('the target must be a path ending in .app, got: /tmp/not-an-app')
    expect(() => checkTarget('darwin', '/tmp/not-an-app/', {}, MAC_HOME)).toThrow('got: /tmp/not-an-app')
    expect(() => checkTarget('darwin', '/Users/dev/Applications/worfy-stable', {}, MAC_HOME)).toThrow(/must be a path ending in \.app/)
  })

  it('on Windows is any folder but the one the installer uses, one inside it, one around it, or a whole disk', () => {
    expect(installerDir(WIN_ENV, WIN_HOME)).toBe('C:\\Users\\dev\\AppData\\Local\\Programs\\worfy')
    expect(checkTarget('win32', 'D:\\apps\\worfy-stable\\', WIN_ENV, WIN_HOME)).toBe('D:\\apps\\worfy-stable')
    // The name of the installer's folder is only the start of this one.
    expect(checkTarget('win32', 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-2', WIN_ENV, WIN_HOME)).toBe('C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-2')
    for (const target of [
      'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy',
      'c:\\users\\DEV\\appdata\\local\\programs\\WORFY\\',
      'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy\\stable',
      'C:\\Users\\dev\\AppData\\Local\\Programs',
      'C:\\Users\\dev',
    ]) {
      expect(() => checkTarget('win32', target, WIN_ENV, WIN_HOME), target).toThrow(/cannot be the folder the installer of worfy uses/)
    }
    expect(() => checkTarget('win32', 'D:\\', WIN_ENV, WIN_HOME)).toThrow(/not a whole disk/)
    // A .app ending means nothing on Windows.
    expect(checkTarget('win32', 'D:\\apps\\worfy-stable.app', WIN_ENV, WIN_HOME)).toBe('D:\\apps\\worfy-stable.app')
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
      { ProcessId: 4, ExecutablePath: null },
      { ProcessId: 812, ExecutablePath: 'C:\\Windows\\System32\\svchost.exe' },
      { ProcessId: 9120, ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable\\worfy.exe' },
      { ProcessId: 9131, ExecutablePath: 'c:\\users\\dev\\appdata\\local\\programs\\WORFY-STABLE\\resources\\app.asar.unpacked\\node_modules\\claude.exe' },
      { ProcessId: 9200, ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy\\worfy.exe' },
      { ProcessId: 9300, ExecutablePath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable-2\\worfy.exe' },
    ])
    const target = 'C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable'
    expect(runningCopies('win32', [target], listing)).toEqual([
      '9120 C:\\Users\\dev\\AppData\\Local\\Programs\\worfy-stable\\worfy.exe',
      '9131 c:\\users\\dev\\appdata\\local\\programs\\WORFY-STABLE\\resources\\app.asar.unpacked\\node_modules\\claude.exe',
    ])
    expect(runningCopies('win32', ['D:\\elsewhere'], listing)).toEqual([])
    // PowerShell prints one process as an object, not a list; and nothing at all for none.
    expect(runningCopies('win32', [target], JSON.stringify({ ProcessId: 7, ExecutablePath: `${target}\\worfy.exe` }))).toEqual([`7 ${target}\\worfy.exe`])
    expect(runningCopies('win32', [target], '\r\n')).toEqual([])
  })
})

describe('what the script replaces and writes', () => {
  it('takes a Windows folder for an earlier copy only when it holds worfy.exe, or nothing', () => {
    expect(notACopy([])).toBeNull()
    expect(notACopy(['resources', 'Worfy.EXE', 'LICENSE.txt'])).toBeNull()
    expect(notACopy(['Documents', 'photo.jpg'])).toMatch(/holds no worfy\.exe/)
  })

  it('writes a time in UTC to the second, as the metadata file always had it', () => {
    expect(stamp(Date.UTC(2026, 9, 10, 18, 5, 9, 987))).toBe('2026-10-10T18:05:09Z')
    expect(stamp(0)).toBe('1970-01-01T00:00:00Z')
  })
})

// The script itself on Windows, with nothing of the real machine touched: the build is a stand-in
// folder, and %LOCALAPPDATA% is a temporary one.
describe.runIf(process.platform === 'win32')('scripts/install-stable.mjs on Windows, over a stand-in build', () => {
  let dir: string
  let local: string
  let build: string
  // Vitest runs in Electron, whose fs reads a file named app.asar as a folder; here it is a plain file.
  const electron = process as { noAsar?: boolean }
  let noAsar: boolean | undefined

  beforeEach(() => {
    noAsar = electron.noAsar
    electron.noAsar = true
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-install-stable-')))
    local = join(dir, 'Local')
    build = join(dir, 'build', 'win-unpacked')
    mkdirSync(join(build, 'resources'), { recursive: true })
    writeFileSync(join(build, 'worfy.exe'), 'not a real program')
    writeFileSync(join(build, 'resources', 'app.asar'), 'not a real archive')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    electron.noAsar = noAsar
  })

  const run = (args: string[], env: Env = {}) => {
    // process.execPath is Electron run as Node (ELECTRON_RUN_AS_NODE=1 is in the environment).
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build, ...env } })
  }
  const head = (): string => spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

  it('without an argument installs into %LOCALAPPDATA%\\Programs\\worfy-stable, with worfy-stable.json next to it', () => {
    const result = run([])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const programs = join(local, 'Programs')
    expect(readdirSync(programs).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
    expect(readFileSync(join(programs, 'worfy-stable', 'worfy.exe'), 'utf8')).toBe('not a real program')
    // The archive is copied as the file it is.
    expect(readFileSync(join(programs, 'worfy-stable', 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    const metadata = JSON.parse(readFileSync(join(programs, 'worfy-stable.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(metadata)).toEqual(['commit', 'dirty', 'builtAt', 'installedAt', 'source'])
    expect(metadata).toMatchObject({ commit: head(), source: build, builtAt: stamp(statSync(join(build, 'worfy.exe')).mtimeMs) })
    expect(typeof metadata.dirty).toBe('boolean')
    expect(metadata.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(result.stdout).toContain(`install-stable: installed ${join(programs, 'worfy-stable')} (commit ${head().slice(0, 7)}`)
  }, 60_000)

  it('replaces an earlier copy: a file that the new build does not have is gone', () => {
    const target = join(dir, 'apps', 'worfy-stable')
    expect(run([target]).status).toBe(0)
    writeFileSync(join(target, 'left-over.txt'), 'from the earlier copy')
    writeFileSync(join(build, 'worfy.exe'), 'the next build')
    const again = run([target])
    expect(again.stderr).toBe('')
    expect(again.status).toBe(0)
    expect(readdirSync(target).sort()).toEqual(['resources', 'worfy.exe'])
    expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('the next build')
    // Nothing of the copy in progress is left next to the target.
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
  }, 60_000)

  it('refuses the folder of the installer and a folder that is not an earlier copy, and leaves them as they were', () => {
    const installed = run([join(local, 'Programs', 'worfy')])
    expect(installed.status).not.toBe(0)
    expect(installed.stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
    expect(existsSync(join(local, 'Programs', 'worfy'))).toBe(false)

    const mine = join(dir, 'Documents')
    mkdirSync(mine)
    writeFileSync(join(mine, 'letter.txt'), 'keep me')
    const refused = run([mine])
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('holds no worfy.exe')
    expect(readdirSync(mine)).toEqual(['letter.txt'])
    expect(existsSync(`${mine}.json`)).toBe(false)
  }, 60_000)

  it('refuses a build that has no worfy.exe, and more than one argument', () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const noBuild = run([join(dir, 'apps', 'worfy-stable')], { WORFY_STABLE_PREBUILT: empty })
    expect(noBuild.status).not.toBe(0)
    expect(noBuild.stderr).toContain('does not look like a built worfy')
    expect(existsSync(join(dir, 'apps', 'worfy-stable'))).toBe(false)
    const two = run(['a', 'b'])
    expect(two.status).not.toBe(0)
    expect(two.stderr).toContain('expected at most one argument')
  }, 60_000)

  it('refuses while a program of the copy is running, and leaves the copy in place', async () => {
    const target = join(dir, 'apps', 'worfy-stable')
    // A real program inside the copy: the command interpreter of Windows under the name of the app.
    // It waits for a key on an input that stays open, until it is stopped below.
    writeFileSync(join(build, 'worfy.exe'), readFileSync(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe'))
    expect(run([target]).status).toBe(0)
    const { spawn } = await import('node:child_process')
    const child = spawn(join(target, 'worfy.exe'), ['/d', '/c', 'pause'], { stdio: ['pipe', 'ignore', 'ignore'] })
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      const refused = run([target])
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toContain(`${child.pid} `)
      expect(refused.stderr).toContain(`install-stable: the stable copy at ${target} is running`)
      expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
    } finally {
      const gone = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await gone
    }
  }, 60_000)
})
