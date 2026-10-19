// What the Windows build of worfy is made from (worfy-windows ticket 12): the settings of
// electron-builder.yml and the two scripts of package.json. Nothing here builds anything, so it runs
// on any system: a setting that names a file that is not in the repository, or another kind of
// installer, would otherwise show only on a Windows machine, at the end of `pnpm package`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const builder = readFileSync(join(REPO, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')
const scripts = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

/** The lines of a top-level section of the file, without comments and empty lines. */
function section(name: string): string[] {
  const lines = builder.split('\n')
  const start = lines.indexOf(`${name}:`)
  if (start < 0) throw new Error(`electron-builder.yml has no ${name}: section`)
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
}
/** True when git tracks the file. */
const tracked = (path: string): boolean => execFileSync('git', ['-C', REPO, 'ls-files', '--', path], { encoding: 'utf8' }).trim() === path

describe('the Windows build in electron-builder.yml', () => {
  it('is one target: an NSIS installer for x64', () => {
    expect(section('win').filter((line) => /^\s+(- )?(target|arch):/.test(line) || line.trim() === 'target:')).toEqual(['  target:', '    - target: nsis', '      arch: x64'])
  })

  it('takes its icon from a file that is committed', () => {
    const icon = section('win')
      .map((line) => /^ {2}icon: (\S+)$/.exec(line)?.[1])
      .find((value) => value !== undefined)
    expect(icon).toBe('build/icon.ico')
    expect(existsSync(join(REPO, 'build', 'icon.ico'))).toBe(true)
    expect(tracked('build/icon.ico')).toBe(true)
  })

  it('has no nsis: section of its own: a one-click installer for the current user, without admin rights, is the default', () => {
    expect(builder).not.toMatch(/^nsis:/m)
    expect(builder).not.toMatch(/perMachine|allowElevation/)
  })
})

describe('the macOS build in electron-builder.yml', () => {
  it('is a folder with the app, not an installer: scripts/install-stable.mjs copies dist/mac*/worfy.app', () => {
    expect(section('mac').filter((line) => /^ {2}target:/.test(line))).toEqual(['  target: dir'])
  })
})

describe('the scripts of package.json that build and install', () => {
  it('pnpm package builds for the system it runs on: no system is named', () => {
    expect(scripts['package']).toBe('electron-vite build && electron-builder')
  })

  it('pnpm install:stable runs the script that is in the repository, with Node', () => {
    expect(scripts['install:stable']).toBe('node scripts/install-stable.mjs')
    expect(tracked('scripts/install-stable.mjs')).toBe(true)
    // The shell script it replaced is gone: a system without bash cannot run it.
    expect(existsSync(join(REPO, 'scripts', 'install-stable.sh'))).toBe(false)
  })
})

describe('@xterm/headless in the package (worfy-windows ticket 39)', () => {
  // Every Terminal answers the cursor-position requests with it (src/main/terminal/cursor-answers.ts),
  // loaded only when the first Terminal opens: the packaged e2e test opens none, so a package
  // without it would pass that test and break every Terminal.
  it('is a dependency of the app, at an exact version: electron-builder packs the dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> }
    expect(manifest.dependencies['@xterm/headless']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.devDependencies?.['@xterm/headless']).toBeUndefined()
  })

  it('sits outside app.asar: a worker thread loads it by path', () => {
    expect(section('asarUnpack')).toContain('  - node_modules/@xterm/headless/**')
  })
})
