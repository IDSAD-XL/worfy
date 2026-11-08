// scripts/download-electron.mjs: the Electron download of the CI jobs, up to 3 attempts of
// install.js of electron (worfy-polish 74). A stand-in install script exits with the codes a test
// gives it, one per attempt, and counts its runs; DOWNLOAD_ELECTRON_WAITS_MS keeps the waits short.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'download-electron.mjs')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

interface Run {
  status: number | null
  lines: string[]
  attempts: number
  stderr: string
  seconds: number
}

/** Runs the script with a stand-in install script that exits with `codes[i]` on attempt i + 1. */
function download(codes: number[], env: Record<string, string> = { DOWNLOAD_ELECTRON_WAITS_MS: '0,0' }): Run {
  const dir = mkdtempSync(join(tmpdir(), 'worfy-download-electron-'))
  dirs.push(dir)
  const count = join(dir, 'attempts')
  const install = join(dir, 'install.js')
  writeFileSync(
    install,
    [
      "const fs = require('fs')",
      `const file = ${JSON.stringify(count)}`,
      "const done = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0",
      'fs.writeFileSync(file, String(done + 1))',
      `process.exit(${JSON.stringify(codes)}[done] ?? 99)`,
    ].join('\n'),
  )
  const started = Date.now()
  const result = spawnSync(scriptNode(), [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, DOWNLOAD_ELECTRON_INSTALL: install, ...env },
    timeout: ms(30_000),
  })
  return {
    status: result.status,
    lines: result.stdout.split('\n').filter((line) => line !== ''),
    attempts: existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0,
    stderr: result.stderr,
    seconds: (Date.now() - started) / 1000,
  }
}

describe('scripts/download-electron.mjs', () => {
  it('succeeds on the third attempt after two failed ones', () => {
    const run = download([1, 1, 0])
    expect(run.status, run.stderr).toBe(0)
    expect(run.attempts).toBe(3)
    expect(run.lines).toEqual([
      'download-electron: attempt 1 of 3 failed (exit code 1); next attempt in 0 s',
      'download-electron: attempt 2 of 3 failed (exit code 1); next attempt in 0 s',
      'download-electron: attempt 3 of 3 succeeded',
    ])
  })

  it('fails after three attempts with the exit code of the last one', () => {
    const run = download([1, 5, 7])
    expect(run.status, run.stderr).toBe(7)
    expect(run.attempts).toBe(3)
    expect(run.lines).toEqual([
      'download-electron: attempt 1 of 3 failed (exit code 1); next attempt in 0 s',
      'download-electron: attempt 2 of 3 failed (exit code 5); next attempt in 0 s',
      'download-electron: attempt 3 of 3 failed (exit code 7); no attempt left',
    ])
  })

  it('makes no attempt after a success', () => {
    const first = download([0, 1, 1])
    expect(first.status, first.stderr).toBe(0)
    expect(first.attempts).toBe(1)
    expect(first.lines).toEqual(['download-electron: attempt 1 of 3 succeeded'])
    const second = download([1, 0, 1])
    expect(second.status, second.stderr).toBe(0)
    expect(second.attempts).toBe(2)
  })

  it('waits between attempts as DOWNLOAD_ELECTRON_WAITS_MS says, and makes one attempt more than it lists', () => {
    const run = download([1, 1, 1], { DOWNLOAD_ELECTRON_WAITS_MS: '400' })
    expect(run.status, run.stderr).toBe(1)
    expect(run.attempts).toBe(2)
    expect(run.lines[0]).toBe('download-electron: attempt 1 of 2 failed (exit code 1); next attempt in 0.4 s')
    // A lower bound only: the wait happened. The upper bound is the spawn's limit.
    expect(run.seconds).toBeGreaterThanOrEqual(0.35)
  })

  it('refuses a malformed DOWNLOAD_ELECTRON_WAITS_MS with exit code 2 and runs nothing', () => {
    const run = download([0], { DOWNLOAD_ELECTRON_WAITS_MS: '20s,60' })
    expect(run.status).toBe(2)
    expect(run.attempts).toBe(0)
    expect(run.stderr).toContain('DOWNLOAD_ELECTRON_WAITS_MS')
  })

  it('in CI waits 20 s and then 60 s, and runs install.js of electron, the script require(electron) runs', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toMatch(/^const WAITS_MS = \[20_000, 60_000\]$/m)
    expect(source).toContain("join('node_modules', 'electron', 'install.js')")
    expect(existsSync(join(REPO, 'node_modules', 'electron', 'install.js'))).toBe(true)
    // node_modules/electron/index.js runs that same file when the binary is missing.
    expect(readFileSync(join(REPO, 'node_modules', 'electron', 'index.js'), 'utf8')).toContain("path.join(__dirname, 'install.js')")
  })
})
