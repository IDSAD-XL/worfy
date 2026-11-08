// codexExecutablePath (src/main/vendors/codex/binary.ts): the Codex binary of the packaged app in
// app.asar.unpacked, and of node_modules otherwise, with the separators and the file name of the
// runtime's platform (worfy-multi-vendor ticket 17). Nothing here runs Codex.
import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexExecutablePath, type CodexRuntime } from '../../src/main/vendors/codex/binary'

const mac: CodexRuntime = { packaged: true, resourcesPath: '/Applications/worfy.app/Contents/Resources', platform: 'darwin', arch: 'arm64' }
const windows: CodexRuntime = { packaged: true, resourcesPath: 'C:\\Users\\someone\\AppData\\Local\\Programs\\worfy\\resources', platform: 'win32', arch: 'x64' }

/** A resolver that finds every package under `root`, joined as the platform of the test runtime writes it. */
const under = (root: string, separator: string) => (name: string) => [root, ...name.split('/')].join(separator)

describe('codexExecutablePath', () => {
  it('packaged on macOS: the platform package in app.asar.unpacked, for either architecture', () => {
    const unpacked = `${mac.resourcesPath}/app.asar.unpacked/node_modules/@openai`
    expect(codexExecutablePath(mac)).toBe(`${unpacked}/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`)
    expect(codexExecutablePath({ ...mac, arch: 'x64' })).toBe(`${unpacked}/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex`)
  })

  it('packaged on Windows: backslashes and codex.exe, for either architecture', () => {
    const unpacked = `${windows.resourcesPath}\\app.asar.unpacked\\node_modules\\@openai`
    expect(codexExecutablePath(windows)).toBe(`${unpacked}\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`)
    expect(codexExecutablePath({ ...windows, arch: 'arm64' })).toBe(`${unpacked}\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe`)
  })

  it('packaged: the folder of the package is not asked for', () => {
    const resolve = () => {
      throw new Error('a packaged app does not look into node_modules')
    }
    expect(codexExecutablePath(mac, resolve)).toContain('app.asar.unpacked')
  })

  it('in development on macOS: the binary of the platform package node_modules has', () => {
    const asked: string[] = []
    const resolve = (name: string) => {
      asked.push(name)
      return under('/repo/node_modules/.pnpm/x/node_modules', '/')(name)
    }
    expect(codexExecutablePath({ ...mac, packaged: false }, resolve)).toBe('/repo/node_modules/.pnpm/x/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex')
    expect(asked).toEqual(['@openai/codex-darwin-arm64'])
  })

  it('in development on Windows: backslashes and codex.exe', () => {
    const resolve = under('C:\\repo\\node_modules\\.pnpm\\x\\node_modules', '\\')
    expect(codexExecutablePath({ ...windows, packaged: false }, resolve)).toBe('C:\\repo\\node_modules\\.pnpm\\x\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe')
  })

  it('in development without the platform package installed: undefined', () => {
    expect(codexExecutablePath({ ...mac, packaged: false }, () => undefined)).toBeUndefined()
  })

  it('a platform or an architecture Codex has no package for: undefined, packaged or not', () => {
    expect(codexExecutablePath({ ...mac, platform: 'freebsd' })).toBeUndefined()
    expect(codexExecutablePath({ ...windows, arch: 'ia32' })).toBeUndefined()
    expect(codexExecutablePath({ ...mac, packaged: false, arch: 'ppc64' }, () => '/never')).toBeUndefined()
  })

  it('in development on this machine: the binary pnpm installed is there and executable', () => {
    const path = codexExecutablePath({ packaged: false, resourcesPath: '', platform: process.platform, arch: process.arch }) ?? ''
    expect(path).not.toBe('')
    expect(existsSync(path)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o111).not.toBe(0)
  })
})
