// The bundle `pnpm dev` runs on macOS (scripts/dev-bundle.ts): a copy of Electron.app with worfy's
// name, its own bundle id and build/icon.icns, so the notifications of a dev run show worfy, not
// Electron. The copy is made over a stand-in repository: its Electron.app is a few small files.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_BUNDLE, devBundleExecutable, patchInfoPlist, useDevBundle } from '../../scripts/dev-bundle'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')

/** The keys of Electron.app's own Info.plist that the dev bundle changes, and two it keeps. */
const ELECTRON_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Electron</string>
	<key>CFBundleExecutable</key>
	<string>Electron</string>
	<key>CFBundleIconFile</key>
	<string>electron.icns</string>
	<key>CFBundleIdentifier</key>
	<string>com.github.Electron</string>
	<key>CFBundleName</key>
	<string>Electron</string>
	<key>CFBundleVersion</key>
	<string>44.5.1</string>
	<key>NSPrincipalClass</key>
	<string>AtomApplication</string>
</dict>
</plist>
`

/** The string a plist gives for a key, read the way this test reads it: the first <string> after the key. */
const valueOf = (xml: string, key: string): string | undefined => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1]

describe('the Info.plist of the dev bundle', () => {
  it("has worfy's name, its own bundle id and its own icon file; the executable and the version stay Electron's", () => {
    const patched = patchInfoPlist(ELECTRON_PLIST, DEV_BUNDLE)
    expect(valueOf(patched, 'CFBundleName')).toBe('worfy')
    expect(valueOf(patched, 'CFBundleDisplayName')).toBe('worfy')
    expect(valueOf(patched, 'CFBundleIdentifier')).toBe('dev.worfy.dev')
    expect(valueOf(patched, 'CFBundleIconFile')).toBe('worfy.icns')
    // app.isPackaged stays false only while the executable is called Electron.
    expect(valueOf(patched, 'CFBundleExecutable')).toBe('Electron')
    expect(valueOf(patched, 'CFBundleVersion')).toBe('44.5.1')
    expect(valueOf(patched, 'NSPrincipalClass')).toBe('AtomApplication')
    expect(patched.split('\n')).toHaveLength(ELECTRON_PLIST.split('\n').length)
  })

  it('is not the bundle id of the stable copy: macOS would take the two for one app', () => {
    expect(DEV_BUNDLE.id).not.toBe('dev.worfy.app')
  })

  it('adds a key Electron does not have at the end of the top-level dict', () => {
    const withoutDisplayName = ELECTRON_PLIST.replace('\t<key>CFBundleDisplayName</key>\n\t<string>Electron</string>\n', '')
    const patched = patchInfoPlist(withoutDisplayName, DEV_BUNDLE)
    expect(valueOf(patched, 'CFBundleDisplayName')).toBe('worfy')
    expect(patched.endsWith('\t<key>CFBundleDisplayName</key>\n\t<string>worfy</string>\n</dict>\n</plist>\n')).toBe(true)
  })

  it('writes a value as XML text: an ampersand or an angle bracket is escaped, and a dollar sign is no replacement pattern', () => {
    const patched = patchInfoPlist(ELECTRON_PLIST, { name: 'a & <b> $& $1', id: 'dev.worfy.dev', iconFile: 'worfy.icns' })
    expect(valueOf(patched, 'CFBundleName')).toBe('a &amp; &lt;b&gt; $&amp; $1')
  })

  it('refuses a file with no dict to add a key to', () => {
    expect(() => patchInfoPlist('<plist version="1.0"></plist>', DEV_BUNDLE)).toThrow('the Info.plist has no dict to add CFBundleName to')
  })

  const electronPlist = join(REPO, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist')
  // macOS only: Electron.app's Info.plist and plutil exist on macOS only.
  it.runIf(process.platform === 'darwin' && existsSync(electronPlist))("over Electron's real Info.plist is a plist macOS reads, with worfy's values", () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-dev-bundle-plist-')))
    try {
      const file = join(scratch, 'Info.plist')
      writeFileSync(file, patchInfoPlist(readFileSync(electronPlist, 'utf8'), DEV_BUNDLE))
      execFileSync('plutil', ['-lint', file], { stdio: 'pipe' })
      const read = (key: string) => execFileSync('plutil', ['-extract', key, 'raw', file], { encoding: 'utf8' }).trim()
      expect([read('CFBundleIdentifier'), read('CFBundleName'), read('CFBundleDisplayName'), read('CFBundleIconFile'), read('CFBundleExecutable')]).toEqual([
        'dev.worfy.dev',
        'worfy',
        'worfy',
        'worfy.icns',
        'Electron',
      ])
    } finally {
      removeTestTree(scratch)
    }
  })
})

describe('the dev bundle in node_modules/.cache', () => {
  let repo: string
  const electronApp = () => join(repo, 'node_modules', 'electron', 'dist', 'Electron.app')
  const devApp = () => join(repo, 'node_modules', '.cache', 'worfy-dev', 'worfy.app')
  const executable = () => join(devApp(), 'Contents', 'MacOS', 'Electron')

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-dev-bundle-')))
    for (const part of ['MacOS', 'Resources']) mkdirSync(join(electronApp(), 'Contents', part), { recursive: true })
    writeFileSync(join(electronApp(), 'Contents', 'Info.plist'), ELECTRON_PLIST)
    writeFileSync(join(electronApp(), 'Contents', 'MacOS', 'Electron'), 'not a real program')
    writeFileSync(join(electronApp(), 'Contents', 'Resources', 'electron.icns'), 'the icon of Electron')
    mkdirSync(join(repo, 'build'))
    writeFileSync(join(repo, 'build', 'icon.icns'), 'the icon of worfy')
  })

  afterEach(() => removeTestTree(repo))

  /**
   * The deps of a Mac, over the stand-in repository; the copy is Node's, so the case runs on any
   * system. It refuses a path that is there, as `cp -R` would not: that one copies into the folder.
   */
  const mac = () => ({
    platform: 'darwin' as const,
    repo,
    copyApp: vi.fn((from: string, to: string) => {
      if (existsSync(to)) throw new Error(`${to} is there already`)
      cpSync(from, to, { recursive: true })
    }),
    register: vi.fn(),
    warn: vi.fn(),
  })

  it("is made on macOS: Electron's files, worfy's Info.plist and icon, registered with Launch Services, nothing left beside it", () => {
    const deps = mac()
    expect(devBundleExecutable(deps)).toBe(executable())
    expect(readFileSync(executable(), 'utf8')).toBe('not a real program')
    expect(readFileSync(join(devApp(), 'Contents', 'Info.plist'), 'utf8')).toBe(patchInfoPlist(ELECTRON_PLIST, DEV_BUNDLE))
    expect(readFileSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'), 'utf8')).toBe('the icon of worfy')
    expect(deps.register).toHaveBeenCalledExactlyOnceWith(devApp())
    expect(deps.warn).not.toHaveBeenCalled()
    expect(existsSync(join(repo, 'node_modules', '.cache', 'worfy-dev', 'worfy.app.making'))).toBe(false)
    // Electron.app itself is not changed.
    expect(readFileSync(join(electronApp(), 'Contents', 'Info.plist'), 'utf8')).toBe(ELECTRON_PLIST)
  })

  it('is taken as it is by the next dev run: no copy, no registration', () => {
    devBundleExecutable(mac())
    const again = mac()
    expect(devBundleExecutable(again)).toBe(executable())
    expect(again.copyApp).not.toHaveBeenCalled()
    expect(again.register).not.toHaveBeenCalled()
  })

  it('is made again when the icon changes, and when Electron does', () => {
    devBundleExecutable(mac())
    writeFileSync(join(repo, 'build', 'icon.icns'), 'a new icon of worfy')
    const newIcon = mac()
    expect(devBundleExecutable(newIcon)).toBe(executable())
    expect(newIcon.copyApp).toHaveBeenCalledOnce()
    expect(readFileSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'), 'utf8')).toBe('a new icon of worfy')

    writeFileSync(join(electronApp(), 'Contents', 'Info.plist'), ELECTRON_PLIST.replace('44.5.1', '45.0.0'))
    writeFileSync(join(electronApp(), 'Contents', 'MacOS', 'Electron'), 'a newer program')
    const newElectron = mac()
    expect(devBundleExecutable(newElectron)).toBe(executable())
    expect(newElectron.copyApp).toHaveBeenCalledOnce()
    expect(readFileSync(executable(), 'utf8')).toBe('a newer program')
    expect(valueOf(readFileSync(join(devApp(), 'Contents', 'Info.plist'), 'utf8'), 'CFBundleVersion')).toBe('45.0.0')
  })

  it('is made again when an earlier one lost a file', () => {
    devBundleExecutable(mac())
    unlinkSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'))
    const deps = mac()
    expect(devBundleExecutable(deps)).toBe(executable())
    expect(deps.copyApp).toHaveBeenCalledOnce()
    expect(readFileSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'), 'utf8')).toBe('the icon of worfy')
  })

  it('is not made off macOS: a dev run there starts Electron as it is', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const deps = { ...mac(), platform }
      expect(devBundleExecutable(deps)).toBeNull()
      expect(deps.copyApp).not.toHaveBeenCalled()
      expect(deps.warn).not.toHaveBeenCalled()
    }
    expect(existsSync(join(repo, 'node_modules', '.cache'))).toBe(false)
  })

  it('without build/icon.icns is a warning, and the dev run starts Electron.app', () => {
    removeTestTree(join(repo, 'build'))
    const deps = mac()
    expect(devBundleExecutable(deps)).toBeNull()
    expect(deps.copyApp).not.toHaveBeenCalled()
    expect(deps.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`[worfy] could not make the dev bundle at ${devApp()}: ENOENT`))
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("This dev run starts Electron.app, whose notifications show Electron's name and icon."))
  })

  it('a copy that fails is a warning; an earlier bundle stays whole, and the half copy goes with the next run', () => {
    devBundleExecutable(mac())
    writeFileSync(join(repo, 'build', 'icon.icns'), 'a new icon of worfy')
    const failing = {
      ...mac(),
      copyApp: vi.fn((from: string, to: string) => {
        mkdirSync(join(to, 'Contents'), { recursive: true })
        throw new Error('the disk is full')
      }),
    }
    expect(devBundleExecutable(failing)).toBeNull()
    expect(failing.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('the disk is full'))
    expect(readFileSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'), 'utf8')).toBe('the icon of worfy')
    expect(existsSync(join(repo, 'node_modules', '.cache', 'worfy-dev', 'worfy.app.making'))).toBe(true)

    expect(devBundleExecutable(mac())).toBe(executable())
    expect(existsSync(join(repo, 'node_modules', '.cache', 'worfy-dev', 'worfy.app.making'))).toBe(false)
    expect(readFileSync(join(devApp(), 'Contents', 'Resources', 'worfy.icns'), 'utf8')).toBe('a new icon of worfy')
  })

  it('a registration Launch Services refuses is a warning: the bundle is used all the same', () => {
    const deps = { ...mac(), register: vi.fn(() => { throw new Error('lsregister exited with 1') }) }
    expect(devBundleExecutable(deps)).toBe(executable())
    expect(deps.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`[worfy] Launch Services did not take the dev bundle ${devApp()}: lsregister exited with 1`))
  })

  describe('pointed at by ELECTRON_EXEC_PATH for `pnpm dev`', () => {
    it('sets the variable to the executable of the bundle', () => {
      const env: NodeJS.ProcessEnv = {}
      useDevBundle(env, mac())
      expect(env.ELECTRON_EXEC_PATH).toBe(executable())
    })

    it('leaves a variable that is set already, and makes no bundle then', () => {
      const env: NodeJS.ProcessEnv = { ELECTRON_EXEC_PATH: '/somewhere/Electron' }
      const deps = mac()
      useDevBundle(env, deps)
      expect(env.ELECTRON_EXEC_PATH).toBe('/somewhere/Electron')
      expect(deps.copyApp).not.toHaveBeenCalled()
    })

    it('leaves the variable unset off macOS, and when no bundle could be made', () => {
      const off: NodeJS.ProcessEnv = {}
      useDevBundle(off, { ...mac(), platform: 'linux' })
      expect('ELECTRON_EXEC_PATH' in off).toBe(false)
      removeTestTree(join(repo, 'build'))
      const failed: NodeJS.ProcessEnv = {}
      useDevBundle(failed, mac())
      expect('ELECTRON_EXEC_PATH' in failed).toBe(false)
    })
  })
})

// The real config, not a stand-in: off macOS `pnpm dev` (serve) runs Electron as it is, so the
// variable stays unset (CI runs this on Linux). On macOS the same call would make the bundle in this
// repository; test/unit/dev-bundle-config.test.ts covers the command there with a recorder.
describe.runIf(process.platform !== 'darwin')('electron.vite.config.ts off macOS', () => {
  it('leaves ELECTRON_EXEC_PATH unset for serve and for build', async () => {
    const before = process.env.ELECTRON_EXEC_PATH
    delete process.env.ELECTRON_EXEC_PATH
    try {
      // Loaded by path: electron.vite.config.ts belongs to tsconfig.node.json, not to the test project.
      const { default: config } = (await import(join(REPO, 'electron.vite.config.ts'))) as { default: (env: { command: 'build' | 'serve'; mode: string }) => unknown }
      config({ command: 'serve', mode: 'development' })
      config({ command: 'build', mode: 'production' })
      expect('ELECTRON_EXEC_PATH' in process.env).toBe(false)
    } finally {
      if (before !== undefined) process.env.ELECTRON_EXEC_PATH = before
    }
  })
})
