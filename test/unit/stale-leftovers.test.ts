// The removal of what killed runs leave behind, run by vitest.config.ts before each run (worfy-windows
// ticket 51), on a folder of this test instead of the system temporary folder. An old folder of a
// run may hold a link to a folder outside it — on Windows a junction, elsewhere a symlink to a
// folder: the link goes with the folder, and what it leads to stays.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTRACT_HOMES_PREFIX } from '../global-setup-contract'
import { removeTestTree } from '../remove'
import { removeStaleProbes, removeStaleTempFolders, STALE_AFTER_MS, STALE_PREFIXES } from '../stale-leftovers'

const HOUR = 60 * 60 * 1000
const REPO = join(import.meta.dirname, '..', '..')

let scratch: string

beforeEach(() => {
  // Not a name of the cleanup's own: the cleanup of a run in another checkout leaves it alone.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-stale-leftovers-test-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

/** A folder dated `age` before `now`; its mtime is set last, after what is put into it. */
function folder(path: string, now: number, age: number, fill: (path: string) => void = () => {}): string {
  mkdirSync(path)
  fill(path)
  const at = new Date(now - age)
  utimesSync(path, at, at)
  return path
}

/** A link to a folder: a junction on Windows, a symlink to a folder elsewhere. */
function linkToFolder(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('removeStaleTempFolders', () => {
  it('removes an old folder of a run with a link in it as a link: the file behind the link stays', () => {
    const now = Date.now()
    const temp = join(scratch, 'temp')
    mkdirSync(temp)
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'kept')
    const old = folder(join(temp, 'worfy-glob-probe-old'), now, 2 * HOUR, (path) => linkToFolder(outside, join(path, 'node_modules')))

    removeStaleTempFolders(temp, now)

    expect(existsSync(old)).toBe(false)
    expect(readdirSync(outside)).toEqual(['keep.txt'])
  })

  it('removes the old folders of every prefix and leaves a young one and those of other names', () => {
    const now = Date.now()
    const temp = join(scratch, 'temp')
    mkdirSync(temp)
    folder(join(temp, 'worfy-glob-probe-old'), now, 2 * HOUR)
    folder(join(temp, 'worfy-contract-claude-homes-old'), now, 2 * HOUR, (path) => writeFileSync(join(path, 'settings.json'), '{}'))
    folder(join(temp, 'worfy-eval-stub-old'), now, 2 * HOUR, (path) => writeFileSync(join(path, 'claude.mjs'), ''))
    // Fifty minutes: a run in another checkout may still use it.
    folder(join(temp, 'worfy-glob-probe-young'), now, 50 * 60_000)
    folder(join(temp, 'worfy-e2e-old'), now, 2 * HOUR)
    folder(join(temp, 'glob-probe-old'), now, 2 * HOUR)
    // A prefix inside the name, and a name that differs from a prefix only at its end.
    folder(join(temp, 'x-worfy-glob-probe-old'), now, 2 * HOUR)
    folder(join(temp, 'worfy-contract-claude-x-old'), now, 2 * HOUR)

    removeStaleTempFolders(temp, now)

    expect(readdirSync(temp).sort()).toEqual(['glob-probe-old', 'worfy-contract-claude-x-old', 'worfy-e2e-old', 'worfy-glob-probe-young', 'x-worfy-glob-probe-old'])
  })

  it('is old after an hour, and its prefixes are the names the runs make their folders with', () => {
    expect(STALE_AFTER_MS).toBe(HOUR)
    expect(STALE_PREFIXES).toEqual(['worfy-glob-probe-', CONTRACT_HOMES_PREFIX, 'worfy-eval-stub-'])
    expect(readFileSync(join(REPO, 'test', 'contract', 'harness-evals.test.ts'), 'utf8')).toContain("tempDir('worfy-eval-stub-')")
    // test/unit/glob-probe.tsx is type-checked without the types of Node and cannot import the constant.
    expect(readFileSync(join(REPO, 'test', 'unit', 'glob-probe.tsx'), 'utf8')).toContain('fs.mkdtempSync(`${tmpdir()}/worfy-glob-probe-`)')
  })

  it('goes on past a name it cannot look at: a link to a folder that is gone', () => {
    const now = Date.now()
    const temp = join(scratch, 'temp')
    mkdirSync(temp)
    const gone = join(scratch, 'gone')
    mkdirSync(gone)
    linkToFolder(gone, join(temp, 'worfy-glob-probe-a-dangling'))
    rmdirSync(gone)
    folder(join(temp, 'worfy-glob-probe-b-old'), now, 2 * HOUR)

    expect(() => removeStaleTempFolders(temp, now)).not.toThrow()
    expect(readdirSync(temp)).toEqual(['worfy-glob-probe-a-dangling'])
  })

  it('takes the age it is given', () => {
    const now = Date.now()
    const temp = join(scratch, 'temp')
    mkdirSync(temp)
    folder(join(temp, 'worfy-glob-probe-ten-minutes'), now, 10 * 60_000)

    removeStaleTempFolders(temp, now, 20 * 60_000)
    expect(readdirSync(temp)).toEqual(['worfy-glob-probe-ten-minutes'])
    removeStaleTempFolders(temp, now, 5 * 60_000)
    expect(readdirSync(temp)).toEqual([])
  })
})

describe('removeStaleProbes', () => {
  it('removes the probe files under a folder, at any depth, and nothing else', () => {
    const src = join(scratch, 'src')
    mkdirSync(join(src, 'renderer', 'shell'), { recursive: true })
    writeFileSync(join(src, 'ZzVitestProbeTop.tsx'), '')
    writeFileSync(join(src, 'renderer', 'shell', 'ZzVitestProbeDeep.tsx'), '')
    writeFileSync(join(src, 'renderer', 'shell', 'Sidebar.tsx'), '')
    writeFileSync(join(src, 'renderer', 'NotZzVitestProbe.tsx'), '')

    removeStaleProbes(src)

    expect(readdirSync(src)).toEqual(['renderer'])
    expect(readdirSync(join(src, 'renderer')).sort()).toEqual(['NotZzVitestProbe.tsx', 'shell'])
    expect(readdirSync(join(src, 'renderer', 'shell'))).toEqual(['Sidebar.tsx'])
  })
})

describe('vitest.config.ts', () => {
  // The config is not loaded here: loading it would clean the system temporary folder.
  it('cleans src/ and the system temporary folder with these functions before each run', () => {
    const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf8')
    expect(config).toContain("import { removeStaleProbes, removeStaleTempFolders } from './test/stale-leftovers'")
    expect(config).toContain("removeStaleProbes(join(import.meta.dirname, 'src'))")
    // `.native`: Vite checks server.fs.allow against the realpath(3) spelling, and the JavaScript
    // realpathSync keeps an 8.3 short name of the temporary folder (C:\Users\RUNNER~1 on the runner).
    expect(config).toContain('const tempDir = realpathSync.native(tmpdir())')
    expect(config).toContain('removeStaleTempFolders(tempDir, Date.now())')
  })
})
