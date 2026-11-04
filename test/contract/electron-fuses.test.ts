// The Electron fuses of the packaged worfy (worfy-auto-approve ticket 12): electron-builder.yml turns
// RunAsNode and EnableNodeCliInspectArguments off, and `pnpm test:package` ends with
// scripts/check-fuses.mjs, which reads them from the dist/ build. Here, on any system and without a
// build: the settings themselves, the order of test:package, and what the check answers for stand-in
// binaries with a fuse wire of their own and for the stock Electron of node_modules.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-fuses.mjs')
const builder = readFileSync(join(REPO, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')
const scripts = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

/** The lines of a top-level section of electron-builder.yml, without comments and empty lines. */
function section(name: string): string[] {
  const lines = builder.split('\n')
  const start = lines.indexOf(`${name}:`)
  if (start < 0) throw new Error(`electron-builder.yml has no ${name}: section`)
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
}

// The fuse wire of an Electron binary (@electron/fuses 1.8.0, constants.js): the sentinel, the
// version of the wire (1), its length, then one byte per fuse: '0' off, '1' on.
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
const FUSES = ['RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments', 'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges'] as const
type Fuse = (typeof FUSES)[number]

/** Bytes shaped like an Electron binary whose fuses are those of `on`, all others off; or the bytes of `wire` as they are. */
function binary(on: readonly Fuse[], wire: number[] = FUSES.map((fuse) => (on.includes(fuse) ? 0x31 : 0x30))): Buffer {
  return Buffer.concat([Buffer.from('\x7fELF stand-in code before the wire '), Buffer.from(SENTINEL), Buffer.from([1, wire.length, ...wire]), Buffer.from(' code after it')])
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})
const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'electron-fuses-')))
  dirs.push(dir)
  return dir
}

/** A Windows build folder with worfy.exe in it. */
function windowsBuild(on: readonly Fuse[], wire?: number[]): string {
  const dir = join(scratch(), 'win-unpacked')
  mkdirSync(dir)
  writeFileSync(join(dir, 'worfy.exe'), binary(on, wire))
  return dir
}

/** A worfy.app whose fuses sit where Electron keeps them on macOS: in its Electron Framework. */
function macBuild(on: readonly Fuse[]): string {
  const app = join(scratch(), 'worfy.app')
  const framework = join(app, 'Contents', 'Frameworks', 'Electron Framework.framework')
  mkdirSync(framework, { recursive: true })
  writeFileSync(join(framework, 'Electron Framework'), binary(on))
  return app
}

function check(app: string): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(scriptNode(), [SCRIPT, app], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
}

describe('electronFuses in electron-builder.yml', () => {
  it('turns RunAsNode and EnableNodeCliInspectArguments off, and sets no other fuse', () => {
    expect(section('electronFuses')).toEqual(['  runAsNode: false', '  enableNodeCliInspectArguments: false'])
  })
})

describe('pnpm test:package', () => {
  it('reads the fuses of the dist/ build last, after the Playwright tests that drive a copy of it', () => {
    // The whole line: a `|| true` or a `;` in it would let the check pass after a red Playwright run,
    // or run it on a build a failed packaging left behind.
    expect(scripts['test:package']).toBe('pnpm package && playwright test --grep @packaged --workers=1 --output test-results/package && node scripts/check-fuses.mjs')
  })
})

describe('scripts/check-fuses.mjs', () => {
  it('exits 0 for a build with both fuses off, and prints every fuse with its state', () => {
    const run = check(windowsBuild(['GrantFileProtocolExtraPrivileges']))
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('  RunAsNode: disabled\n')
    expect(run.stdout).toContain('  EnableNodeCliInspectArguments: disabled\n')
    expect(run.stdout).toContain('  GrantFileProtocolExtraPrivileges: enabled\n')
  })

  it.each([
    ['RunAsNode', 'EnableNodeCliInspectArguments'],
    ['EnableNodeCliInspectArguments', 'RunAsNode'],
  ] as const)('exits 1 and names %s when it is on, and not %s, which is off', (on, off) => {
    const run = check(windowsBuild([on]))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain(`check-fuses: ${on} is enabled, and must be disabled`)
    expect(run.stderr).not.toContain(off)
  })

  it('exits 1 for a fuse marked removed: only disabled is off', () => {
    // The byte 'r' (FuseState.REMOVED): RunAsNode removed, every other fuse off.
    const run = check(windowsBuild([], [0x72, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]))
    expect(run.stdout).toContain('  RunAsNode: removed\n')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('check-fuses: RunAsNode is removed, and must be disabled')
    expect(run.stderr).not.toContain('EnableNodeCliInspectArguments')
  })

  it('exits 1 for a fuse wire too short to hold EnableNodeCliInspectArguments: a missing fuse is not off', () => {
    const run = check(windowsBuild([], [0x30, 0x30, 0x30]))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('check-fuses: EnableNodeCliInspectArguments is missing, and must be disabled')
    expect(run.stderr).not.toContain('RunAsNode')
  })

  it('reads a .app by its Electron Framework', () => {
    expect(check(macBuild([])).status).toBe(0)
    const on = check(macBuild(['RunAsNode', 'EnableNodeCliInspectArguments']))
    expect(on.status).toBe(1)
    expect(on.stderr.match(/must be disabled/g)).toHaveLength(2)
  })

  it('exits 1 for a file with no fuse wire, and says why', () => {
    const dir = join(scratch(), 'win-unpacked')
    mkdirSync(dir)
    writeFileSync(join(dir, 'worfy.exe'), 'no wire here')
    const run = check(dir)
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/^check-fuses: Could not find sentinel/m)
  })

  it('exits 1 for the stock Electron of node_modules, whose fuses are untouched: it reads a real binary', () => {
    // Under `pnpm test` the electron module is the path of that binary (scripts/vitest-electron.mjs).
    const electron = createRequire(import.meta.url)('electron') as string
    const run = check(electron)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('  RunAsNode: enabled\n')
    expect(run.stderr).toContain('check-fuses: RunAsNode is enabled, and must be disabled')
    expect(run.stderr).toContain('check-fuses: EnableNodeCliInspectArguments is enabled, and must be disabled')
  })
})
