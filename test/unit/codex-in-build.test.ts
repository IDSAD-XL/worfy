// Whether this build carries Codex (codexInBuild of src/main/vendors/codex/launch.ts, worfy-multi-vendor
// ticket 29), and WORFY_CODEX=absent, which stands for a build without it: nothing starts then, as on a
// platform with no Codex package. Nothing here starts a process.
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

describe('codexLaunch under WORFY_CODEX=absent', () => {
  it('starts nothing: it throws as for a platform without a Codex package', () => {
    expect(() => codexLaunch({ runtime: MAC, appPath: '/repo', env: { WORFY_CODEX: CODEX_ABSENT }, resolvePackage: installed })).toThrow(
      'no Codex for darwin-arm64: the package @openai/codex-darwin-arm64 is not installed',
    )
  })
})
