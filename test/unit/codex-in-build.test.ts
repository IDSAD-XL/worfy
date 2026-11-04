// Whether this build carries Codex (codexInBuild of src/main/vendors/codex/launch.ts, worfy-multi-vendor
// ticket 29), and WORFY_CODEX=absent, which stands for a build without it: nothing starts then, as on a
// platform with no Codex package. Nothing here starts a process.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { CODEX_ABSENT, codexInBuild, codexLaunch } from '../../src/main/vendors/codex/launch'

const MAC: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: 'darwin', arch: 'arm64' }
const installed = (name: string): string => `/repo/node_modules/${name}`
const BINARY = '/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'

describe('codexInBuild', () => {
  it('is true for the fake, false under WORFY_CODEX=absent, whatever is installed', () => {
    expect(codexInBuild({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: 'fake' }, resolvePackage: () => undefined })).toBe(true)
    expect(codexInBuild({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: CODEX_ABSENT }, resolvePackage: installed, exists: () => true })).toBe(false)
  })

  it('otherwise says whether the pinned binary of this platform is there', () => {
    const seen: string[] = []
    const exists = (path: string): boolean => {
      seen.push(path)
      return true
    }
    expect(codexInBuild({ runtime: MAC, appPath: '/repo', env: {}, resolvePackage: installed, exists })).toBe(true)
    expect(seen).toEqual([BINARY])
    expect(codexInBuild({ runtime: MAC, appPath: '/repo', env: {}, resolvePackage: installed, exists: () => false })).toBe(false)
    expect(codexInBuild({ runtime: MAC, appPath: '/repo', env: {}, resolvePackage: () => undefined, exists: () => true })).toBe(false)
    expect(codexInBuild({ runtime: { ...MAC, platform: 'freebsd' }, appPath: '/repo', env: {}, resolvePackage: installed, exists: () => true })).toBe(false)
  })
})

describe('codexLaunch under WORFY_CODEX=fake', () => {
  const STOCK = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  const FAKE = join('/repo', 'test', 'fixtures', 'codex-app-server', 'fake-app-server.mjs')
  const SCRIPTS = join('/repo', 'test', 'fixtures', 'codex-scripts')
  it('runs the fake under the stock Electron in run-as-Node mode', () => {
    const launch = codexLaunch({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: 'fake' }, execPath: STOCK })
    expect(launch).toEqual({ file: STOCK, args: [FAKE], env: { WORFY_CODEX: 'fake', ELECTRON_RUN_AS_NODE: '1', WORFY_CODEX_SCRIPTS: SCRIPTS } })
  })

  it('reads the executable by the rules of the runtime\'s system: electron.exe is the stock Electron on Windows only', () => {
    const exe = 'C:\\repo\\node_modules\\electron\\dist\\electron.exe'
    const windows: CodexRuntime = { ...MAC, platform: 'win32', arch: 'x64' }
    expect(codexLaunch({ runtime: windows, appPath: '/repo', env: { WORFY_CODEX: 'fake' }, execPath: exe }).file).toBe(exe)
    expect(codexLaunch({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: 'fake' }, execPath: exe }).file).toBe('node')
  })

  it('runs it under node of the PATH in the packaged app, whose RunAsNode fuse is off (electron-builder.yml)', () => {
    const launch = codexLaunch({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: 'fake' }, execPath: '/Applications/worfy.app/Contents/MacOS/worfy' })
    expect(launch).toEqual({ file: 'node', args: [FAKE], env: { WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPTS: SCRIPTS } })
  })
})

describe('codexLaunch under WORFY_CODEX=absent', () => {
  it('starts nothing: it throws as for a platform without a Codex package', () => {
    expect(() => codexLaunch({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: CODEX_ABSENT }, resolvePackage: installed })).toThrow(
      'no Codex for darwin-arm64: the package @openai/codex-darwin-arm64 is not installed',
    )
  })
})
