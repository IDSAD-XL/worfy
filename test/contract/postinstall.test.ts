// scripts/postinstall.mjs (worfy-windows ticket 02): the root postinstall rebuilds node-pty for Electron
// on macOS and Linux and does nothing on Windows, where node-pty's prebuilt win32 binary loads as is.
// The platform is replaced with --platform and --dry-run prints the decision, so nothing is rebuilt here.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'postinstall.mjs')

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' })

describe('scripts/postinstall.mjs', () => {
  it.each(['darwin', 'linux'])('on %s runs electron-rebuild --only node-pty', (platform) => {
    const result = run('--platform', platform, '--dry-run')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('run: electron-rebuild --only node-pty\n')
  })

  it('on win32 rebuilds nothing and exits 0, also without --dry-run', () => {
    for (const args of [['--platform', 'win32', '--dry-run'], ['--platform', 'win32']]) {
      const result = run(...args)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toMatch(/^skip: /)
      expect(result.stdout).not.toContain('electron-rebuild')
    }
  })

  it('refuses an unknown argument with exit code 2', () => {
    const result = run('--rebuild-everything')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown argument --rebuild-everything')
  })

  it('is the postinstall of package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.postinstall).toBe('node scripts/postinstall.mjs')
  })
})
