// scripts/quarantine-suggest.mjs: the entries of test/quarantine/ it prints for the candidates of a
// `gate-failures report --json` (test/fixtures/gate-failures/report/report.json: one quarantine
// candidate, a flaky test, and one Windows exception candidate). The entries must pass parseEntry of
// test/quarantine.ts, the script must skip a test that already has an entry and warn at the cap, and it
// must write nothing.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as quarantine from '../quarantine'
import { parseEntry, QUARANTINE_DIR } from '../quarantine'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'quarantine-suggest.mjs')
const REPORT = join(import.meta.dirname, '..', 'fixtures', 'gate-failures', 'report', 'report.json')
const NOW = Date.parse('2026-11-05T09:00:00Z')

interface Io {
  cwd: string
  out: (text: string) => void
  err: (line: string) => void
  now?: number
  quarantineDir?: string
  node?: string
  env?: NodeJS.ProcessEnv
}
interface Script {
  quarantineSuggest: (args: string[], io: Io) => number
  MAX_ENTRIES: number
  MAX_DAYS: number
  MAX_WINDOWS_EXCEPTIONS: number
  MAX_WINDOWS_EXCEPTION_DAYS: number
  WINDOWS_EXCEPTION_OWNER: string
  OWNER_PLACEHOLDER: string
}
const script = (await import(pathToFileURL(SCRIPT).href)) as Script

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-quarantine-suggest-')))
  dirs.push(dir)
  return dir
}

/** Every file of `dir` with its text: what "the folder did not change" compares. */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), 'utf8')]))
}

function suggest(args: string[], quarantineDir: string, extra: Partial<Io> = {}) {
  let out = ''
  const err: string[] = []
  const code = script.quarantineSuggest(args, { cwd: process.cwd(), out: (t) => (out += t), err: (l) => err.push(l), now: NOW, quarantineDir, ...extra })
  return { code, out, err }
}

/** The printed entries: [{ file, id, text }]. */
function entries(out: string): { file: string; id: string; text: string }[] {
  return [...out.matchAll(/^test\/quarantine\/([a-z0-9-]+)\.json\n(\{[\s\S]*?\n\})\n/gm)].map((m) => ({ file: `test/quarantine/${m[1]}.json`, id: m[1] ?? '', text: m[2] ?? '' }))
}

const FLAKY_NAME = 'card drag > keeps the card under the pointer'
const RED_NAME = 'shell launcher > starts Git Bash with a login shell'

describe('quarantine-suggest', () => {
  it('keeps the rules of test/quarantine.ts', () => {
    expect(script.MAX_ENTRIES).toBe(quarantine.MAX_ENTRIES)
    expect(script.MAX_DAYS).toBe(quarantine.MAX_DAYS)
    expect(script.MAX_WINDOWS_EXCEPTIONS).toBe(quarantine.MAX_WINDOWS_EXCEPTIONS)
    expect(script.MAX_WINDOWS_EXCEPTION_DAYS).toBe(quarantine.MAX_WINDOWS_EXCEPTION_DAYS)
    expect(script.WINDOWS_EXCEPTION_OWNER).toBe(quarantine.WINDOWS_EXCEPTION_OWNER)
  })

  it('prints a quarantine entry and a Windows exception that pass parseEntry', () => {
    const dir = tempDir()
    const run = suggest([REPORT], dir)
    expect(run.code, run.err.join('\n')).toBe(0)
    expect(run.err).toEqual([])
    const printed = entries(run.out)
    expect(printed.map((e) => e.id)).toEqual(['shell-launcher-starts-git-bash-with-a-login-shell-win32', 'card-drag-keeps-the-card-under-the-pointer'])
    for (const e of printed) {
      const parsed = parseEntry({ id: e.id, text: e.text })
      expect(parsed, e.text).toHaveProperty('entry')
    }
    const [windows, flaky] = printed.map((e) => JSON.parse(e.text) as Record<string, unknown>)
    expect(windows).toMatchObject({
      kind: 'windows-exception',
      runner: 'vitest',
      file: 'test/unit/shell-launcher.test.ts',
      test: RED_NAME,
      platforms: ['win32'],
      owner: 'worfy-windows 117',
      since: '2026-11-05',
      until: '2026-12-20',
    })
    expect(windows?.reason).toMatch(/^Stable red on win32 only in 1 gate run \(7e6d5c4b\/2026-11-02T09-00-00Z-301; on PC \(win32\)\).*bbbbbbbbbbbb.*Last error: AssertionError: /)
    expect(flaky).toEqual({
      runner: 'vitest',
      file: 'test/unit/card-drag.test.ts',
      test: FLAKY_NAME,
      platforms: ['darwin', 'win32'],
      reason: expect.stringMatching(/^Flaky in 2 gate runs \(7e6d5c4b\/2026-11-02T09-00-00Z-301, 1a2b3c4d\/2026-11-01T10-00-00Z-11; on mac, PC \(darwin, win32\)\): red in the run, green alone on the same SHA \(bbbbbbbbbbbb, aaaaaaaaaaaa\)\. Last error: Error: Test timed out in 5000ms\./),
      owner: script.OWNER_PLACEHOLDER,
      since: '2026-11-05',
      until: '2026-11-19',
    })
    // The only thing a person still has to fill in is the owner's ticket.
    expect(Object.values(flaky ?? {}).filter((v) => v === '<ticket>')).toHaveLength(1)
    expect(snapshot(dir)).toEqual({})
  })

  it('skips a test that already has an entry, under any id', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'card-drag-pointer.json'),
      JSON.stringify({ runner: 'vitest', file: 'test/unit/card-drag.test.ts', test: FLAKY_NAME, platforms: ['darwin'], reason: 'r', owner: 'x 1', since: '2026-11-01', until: '2026-11-10' }),
    )
    const run = suggest([REPORT], dir)
    expect(run.code).toBe(0)
    expect(entries(run.out).map((e) => e.id)).toEqual(['shell-launcher-starts-git-bash-with-a-login-shell-win32'])
    expect(run.err).toEqual([expect.stringMatching(/skip vitest test\/unit\/card-drag\.test\.ts > .*: test\/quarantine\/card-drag-pointer\.json already has it$/)])
  })

  it('warns when the quarantine would pass its 15 entries, and takes another id when one is taken', () => {
    const dir = tempDir()
    for (let i = 1; i <= 15; i++) {
      const name = i === 1 ? 'card-drag-keeps-the-card-under-the-pointer' : `other-${i}`
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ runner: 'vitest', file: `test/unit/other-${i}.test.ts`, test: 't', platforms: ['darwin'], reason: 'r', owner: 'x 1', since: '2026-11-01', until: '2026-11-10' }))
    }
    const before = snapshot(dir)
    const run = suggest([REPORT], dir)
    expect(run.code).toBe(0)
    expect(entries(run.out).map((e) => e.id)).toEqual(['shell-launcher-starts-git-bash-with-a-login-shell-win32', 'card-drag-keeps-the-card-under-the-pointer-2'])
    expect(run.err).toEqual(['quarantine-suggest: warning: with these the quarantine would hold 16 entries, at most 15: fix a test before quarantining another'])
    expect(snapshot(dir)).toEqual(before)
  })

  it('writes no file: test/quarantine/ is the same before and after a run of the script', () => {
    const before = snapshot(QUARANTINE_DIR)
    const run = spawnSync(scriptNode(), [SCRIPT, REPORT], { cwd: tempDir(), encoding: 'utf8', timeout: ms(30_000) })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/^test\/quarantine\/[a-z0-9-]+\.json$/m)
    expect(snapshot(QUARANTINE_DIR)).toEqual(before)
  })

  it('asks gate-failures report itself without a file, and refuses what is no report', () => {
    const dir = tempDir()
    const state = join(dir, 'state')
    mkdirSync(state)
    const env = { ...process.env, CLAUDE_GATE_STATE: state, HARNESS_HOME: join(dir, 'home'), EVAL_HARNESS_HOME: '' }
    const asked = suggest([], join(dir, 'quarantine'), { node: scriptNode(), env })
    expect(asked.code, asked.err.join('\n')).toBe(0)
    expect(asked.out).toBe('no candidates in the report\n')

    writeFileSync(join(dir, 'other.json'), '{"runs": []}')
    expect(suggest([join(dir, 'other.json')], dir).code).toBe(1)
    expect(suggest([join(dir, 'missing.json')], dir).code).toBe(1)
    expect(suggest(['--wat'], dir).code).toBe(2)
    expect(suggest([REPORT, REPORT], dir).code).toBe(2)
  })
})
