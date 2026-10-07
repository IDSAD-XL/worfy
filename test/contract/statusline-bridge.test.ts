// scripts/statusline-bridge.sh against the JSON Claude Code passes to the status line command
// (shape recorded from Claude Code 2.1.284, ticket 22): it copies `rate_limits` and nothing else
// into statusline-limits.json in worfy's data folder and passes stdin to the user's own command.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BuildKind, dataRoot } from '../../src/main/storage/paths'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'statusline-bridge.sh')

const RATE_LIMITS = { five_hour: { used_percentage: 29, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }
const STATUS = {
  session_id: '00000000-0000-4000-8000-000000000001',
  transcript_path: '/Users/someone/.claude/projects/x/00000000-0000-4000-8000-000000000001.jsonl',
  cwd: '/Users/someone/project',
  model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
  version: '2.1.284',
  cost: { total_cost_usd: 0.001 },
  rate_limits: RATE_LIMITS,
}

let scratch: string
let home: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-bridge-')))
  home = join(scratch, 'home')
  dataDir = join(scratch, 'data')
  mkdirSync(home)
  mkdirSync(dataDir)
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function run(stdin: string, args: string[] = [], env: Record<string, string> = { WORFY_DATA_DIR: dataDir }) {
  const result = spawnSync('/bin/sh', [SCRIPT, ...args], { input: stdin, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env } })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const written = (dir = dataDir): unknown => JSON.parse(readFileSync(join(dir, 'statusline-limits.json'), 'utf8'))

/** The default data folder of a build kind under the test's HOME, as src/main/storage/paths.ts names it. */
const defaultDataDir = (kind: BuildKind): string => join(home, relative(homedir(), dataRoot({}, kind)))

describe('statusline-bridge.sh', () => {
  it('writes rate_limits and nothing else of the status line JSON', () => {
    expect(run(JSON.stringify(STATUS))).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(dataDir)).toEqual(['statusline-limits.json'])
  })

  it('gives the wrapped status line command the same stdin and passes its output and exit code through', () => {
    const result = run(JSON.stringify(STATUS), ['jq -r ".model.display_name"; exit 3'])
    expect(result).toMatchObject({ status: 3, stdout: 'Haiku 4.5\n' })
    expect(written()).toEqual(RATE_LIMITS)
  })

  it('leaves the file alone when the status line JSON has no rate_limits or is not JSON', () => {
    run(JSON.stringify(STATUS))
    expect(run(JSON.stringify({ ...STATUS, rate_limits: undefined, cwd: '/elsewhere' }), ['cat >/dev/null; echo ok'])).toMatchObject({ status: 0, stdout: 'ok\n' })
    expect(run('{"rate_limits": "soon"}')).toMatchObject({ status: 0 })
    expect(run('not json', ['echo still here'])).toMatchObject({ status: 0, stdout: 'still here\n' })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(dataDir)).toEqual(['statusline-limits.json'])
  })

  it('writes nowhere when the data directory does not exist', () => {
    const missing = join(scratch, 'no-worfy-yet')
    expect(run(JSON.stringify(STATUS), [], { WORFY_DATA_DIR: missing })).toMatchObject({ status: 0 })
    expect(existsSync(missing)).toBe(false)
    // Without WORFY_DATA_DIR the default is under $HOME/Library, which this HOME does not have.
    expect(run(JSON.stringify(STATUS), [], {})).toMatchObject({ status: 0 })
    expect(readdirSync(home)).toEqual([])
  })

  it('without WORFY_DATA_DIR writes to the packaged and the dev data folders that paths.ts names', () => {
    const packaged = defaultDataDir('packaged')
    const dev = defaultDataDir('dev')
    expect(packaged).not.toBe(dev)
    mkdirSync(packaged, { recursive: true })
    mkdirSync(dev, { recursive: true })
    expect(run(JSON.stringify(STATUS), [], {})).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(written(packaged)).toEqual(RATE_LIMITS)
    expect(written(dev)).toEqual(RATE_LIMITS)
    expect(readdirSync(packaged)).toEqual(['statusline-limits.json'])
    expect(readdirSync(dev)).toEqual(['statusline-limits.json'])
  })

  it('without WORFY_DATA_DIR writes only to the data folders that exist', () => {
    const dev = defaultDataDir('dev')
    mkdirSync(dev, { recursive: true })
    expect(run(JSON.stringify(STATUS), [], { WORFY_DATA_DIR: '' })).toMatchObject({ status: 0 })
    expect(written(dev)).toEqual(RATE_LIMITS)
    expect(existsSync(defaultDataDir('packaged'))).toBe(false)
  })

  // The script ships in the .app (worfy-harness ticket 15) and runs from there, with no checkout of
  // the repository next to it: its commands name no path of the owner's machine or of the repository.
  it('names no path of a checkout in its executable lines', () => {
    const code = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
      .filter((line) => line !== '')
    // The comments are gone, the commands are still there.
    expect(code).toContain('input=$(cat)')
    expect(code.join('\n')).not.toContain('statusline-bridge')
    for (const line of code) {
      expect(line).not.toContain('/Users/')
      expect(line).not.toContain('CanvasForAI')
      expect(line).not.toContain('scripts/')
    }
  })

  it('with WORFY_DATA_DIR writes there and leaves the default data folders alone', () => {
    const packaged = defaultDataDir('packaged')
    const dev = defaultDataDir('dev')
    mkdirSync(packaged, { recursive: true })
    mkdirSync(dev, { recursive: true })
    expect(run(JSON.stringify(STATUS))).toMatchObject({ status: 0 })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(packaged)).toEqual([])
    expect(readdirSync(dev)).toEqual([])
  })
})
