// scripts/postinstall.mjs (worfy-windows ticket 02): the root postinstall rebuilds node-pty for Electron
// on macOS and Linux and does nothing on Windows, where node-pty's prebuilt win32 binary loads as is.
// The platform is replaced with --platform and --dry-run prints the decision, so nothing is rebuilt here.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'postinstall.mjs')

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' })

/** The environment of the process with PATH (any case of the key, as on Windows) set to `dirs`. */
const withPath = (dirs: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (key.toUpperCase() !== 'PATH') env[key] = value
  env.PATH = dirs
  return env
}

describe('scripts/postinstall.mjs', () => {
  it('without --platform plans for the platform it runs on', () => {
    const result = run('--dry-run')
    expect(result.status, result.stderr).toBe(0)
    if (process.platform === 'win32') expect(result.stdout).toMatch(/^skip: /)
    else expect(result.stdout).toBe('run: electron-rebuild --only node-pty\n')
  })

  it('without electron-rebuild on PATH exits 1 and names the command', () => {
    const empty = mkdtempSync(join(tmpdir(), 'worfy-postinstall-empty-'))
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--platform', 'linux'], {
        cwd: REPO,
        encoding: 'utf8',
        env: withPath(empty),
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('postinstall: electron-rebuild:')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  // A stub electron-rebuild on PATH: the real run passes `--only node-pty` and returns its exit code.
  // The stub is a shell script, which Node runs without a shell only on macOS and Linux.
  it.skipIf(process.platform === 'win32')('passes the exit code of electron-rebuild on', () => {
    const bin = mkdtempSync(join(tmpdir(), 'worfy-postinstall-bin-'))
    try {
      const args = join(bin, 'args.txt')
      writeFileSync(join(bin, 'electron-rebuild'), `#!/bin/sh\necho "$@" > '${args}'\nexit 3\n`)
      chmodSync(join(bin, 'electron-rebuild'), 0o755)
      const result = spawnSync(process.execPath, [SCRIPT, '--platform', 'linux'], {
        cwd: REPO,
        encoding: 'utf8',
        env: withPath(bin),
      })
      expect(result.status, result.stderr).toBe(3)
      expect(readFileSync(args, 'utf8')).toBe('--only node-pty\n')
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  })

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
