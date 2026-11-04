// The CLI of the failure records (harness/bin/gate-failures): the subcommands `list` and `machine`, the
// usage of an unknown one, and the files they read and write. Every run gets its own HARNESS_HOME and
// CLAUDE_GATE_STATE in a temporary folder, so no test reads or writes the Harness home of this machine.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importedDir, pruneFailures, testId, type RunRecord } from '../../harness/hooks/gate-failures.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const CLI = join(process.cwd(), 'harness', 'bin', 'gate-failures')
const DAY = 24 * 60 * 60 * 1000
const OTHER = '9f8e7d6c'

let root: string
// The machine.json of the real Harness home, and whether it was there before the tests: the tests must
// not make it.
const realMachine = join(homedir(), '.claude', 'worfy-harness', 'gate', 'machine.json')
const realMachineBefore = existsSync(realMachine)

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gate-failures-cli-')))
})

afterAll(() => {
  removeTestTree(root)
  expect(existsSync(realMachine)).toBe(realMachineBefore)
})

function folders(name: string): { home: string; state: string } {
  const home = join(root, name, 'harness-home')
  const state = join(root, name, 'state')
  mkdirSync(home, { recursive: true })
  mkdirSync(state, { recursive: true })
  return { home, state }
}

function cli(args: string[], { home, state }: { home: string; state: string }): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, HARNESS_HOME: home, CLAUDE_GATE_STATE: state, EVAL_HARNESS_HOME: '' }
  const run = spawnSync(scriptNode(), [CLI, ...args], { cwd: root, encoding: 'utf8', env })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d+Z$/, 'Z')
}

function record(run: string, at: string, computerId = '0a1b2c3d', name = 'mac'): RunRecord {
  const file = 'test/unit/a.test.ts'
  return {
    version: 1,
    kind: 'run',
    run,
    at,
    key: 'demo',
    profile: 'full',
    head: '0123456789abcdef0123456789abcdef01234567',
    outcome: 'red',
    computer: { id: computerId, name, platform: 'darwin' },
    dirty: false,
    failures: [
      { step: 'demo/.:test', runner: 'vitest', file, line: 4, name: 'a > b', test: testId('vitest', file, 'a > b'), ms: 12, error: 'expected 1 to be 2', attempt: 1, rerun: ['node', 'scripts/vitest-electron.mjs', file, '-t', 'a > b'] },
      { step: 'demo/.:lint', runner: null, file: null, line: null, name: null, test: null, ms: 900, error: 'lint failed', attempt: 1, rerun: null },
    ],
  }
}

function put(dir: string, run: RunRecord): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${run.run.replace('/', '--')}.json`)
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`)
  return file
}

describe('gate-failures', () => {
  it('names list and machine in --help, and gives the usage with exit 2 for an unknown subcommand', () => {
    const dirs = folders('usage')
    const help = cli(['--help'], dirs)
    expect(help.status, help.stderr).toBe(0)
    expect(help.stdout).toMatch(/^\s+list\s/m)
    expect(help.stdout).toMatch(/^\s+machine\s/m)

    for (const args of [['nonsense'], ['../list'], ['List'], []]) {
      const bad = cli(args, dirs)
      expect(bad.status, args.join(' ')).toBe(2)
      expect(bad.stderr).toMatch(/usage: gate-failures <subcommand>/)
      expect(bad.stderr).toMatch(/^\s+list\s/m)
    }
  })

  it('creates machine.json once: the second call gives the same id, and the file holds no host or user name', () => {
    const dirs = folders('machine')
    const first = cli(['machine', '--json'], dirs)
    expect(first.status, first.stderr).toBe(0)
    const file = join(dirs.home, 'gate', 'machine.json')
    const made = statSync(file).mtimeMs
    const text = readFileSync(file, 'utf8')
    const computer = JSON.parse(text)
    expect(Object.keys(computer).sort()).toEqual(['id', 'name'])
    expect(computer.id).toMatch(/^[0-9a-f]{8}$/)
    expect(computer.name).toBe(process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux')
    expect(JSON.parse(first.stdout)).toMatchObject({ id: computer.id, name: computer.name, platform: process.platform })

    const second = cli(['machine', '--json'], dirs)
    expect(second.status, second.stderr).toBe(0)
    expect(JSON.parse(second.stdout).id).toBe(computer.id)
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(statSync(file).mtimeMs).toBe(made)

    const host = (hostname().split('.')[0] ?? '').toLowerCase()
    const user = userInfo().username.toLowerCase()
    if (host.length >= 3) expect(text.toLowerCase()).not.toContain(host)
    if (user.length >= 3) expect(text.toLowerCase()).not.toContain(user)
  })

  it('renames the computer and keeps its id; refuses the host name as a name', () => {
    const dirs = folders('rename')
    const id = JSON.parse(cli(['machine', '--json'], dirs).stdout).id
    const renamed = cli(['machine', '--name', 'PC', '--json'], dirs)
    expect(renamed.status, renamed.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(dirs.home, 'gate', 'machine.json'), 'utf8'))).toEqual({ id, name: 'PC' })

    const refused = cli(['machine', '--name', hostname()], dirs)
    expect(refused.status).toBe(2)
    expect(JSON.parse(readFileSync(join(dirs.home, 'gate', 'machine.json'), 'utf8')).name).toBe('PC')
    expect(cli(['machine', '--name'], dirs).status).toBe(2)
  })

  it('lists the own and the imported runs, marks the imported ones, and pruneFailures removes what is older than 60 days in both folders', () => {
    const dirs = folders('list')
    const now = Date.now()
    const own = join(dirs.state, 'failures')
    const imported = importedDir(dirs.state, OTHER)
    put(own, record('1a2b3c4d/2026-11-01T10-00-00Z-11', iso(now - 1 * DAY)))
    put(own, record('1a2b3c4d/2026-11-02T10-00-00Z-12', iso(now - 2 * DAY)))
    const oldOwn = put(own, record('5e6f7a8b/2026-08-01T10-00-00Z-13', iso(now - 61 * DAY)))
    const fresh = put(imported, record('2b3c4d5e/2026-11-03T10-00-00Z-21', iso(now - 3 * DAY), OTHER, 'PC'))
    const oldImported = put(imported, record('2b3c4d5e/2026-08-01T10-00-00Z-22', iso(now - 70 * DAY), OTHER, 'PC'))
    // The age is the `at` inside the file, not the time the file was written: a young record with an
    // old mtime stays, the old records above were written just now.
    utimesSync(fresh, new Date(now - 100 * DAY), new Date(now - 100 * DAY))
    writeFileSync(join(own, 'aaaaaaaa--broken.json'), '{"version": 2}')

    const listed = cli(['list', '--json'], dirs)
    expect(listed.status, listed.stderr).toBe(0)
    const out = JSON.parse(listed.stdout) as { runs: { run: string; imported: boolean; records: number; tests: number; steps: number; computer: { id: string } }[]; skipped: { file: string; reason: string }[] }
    expect(out.runs.map((r) => r.run)).toEqual([
      '1a2b3c4d/2026-11-01T10-00-00Z-11',
      '1a2b3c4d/2026-11-02T10-00-00Z-12',
      '2b3c4d5e/2026-11-03T10-00-00Z-21',
      '5e6f7a8b/2026-08-01T10-00-00Z-13',
      '2b3c4d5e/2026-08-01T10-00-00Z-22',
    ])
    expect(out.runs.filter((r) => r.imported).map((r) => r.run)).toEqual(['2b3c4d5e/2026-11-03T10-00-00Z-21', '2b3c4d5e/2026-08-01T10-00-00Z-22'])
    expect(out.runs.filter((r) => r.imported).every((r) => r.computer.id === OTHER)).toBe(true)
    expect(out.runs[0]).toMatchObject({ records: 2, tests: 1, steps: 1, imported: false })
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0]?.reason).toMatch(/version/)

    const text = cli(['list'], dirs)
    expect(text.status, text.stderr).toBe(0)
    expect(text.stdout).toMatch(/^1a2b3c4d\/2026-11-01T10-00-00Z-11 .* mac 0a1b2c3d .* 2 record\(s\)/m)
    expect(text.stdout).toMatch(/^2b3c4d5e\/2026-11-03T10-00-00Z-21 .*\[imported\]$/m)
    expect(text.stderr).toMatch(/skipped .*aaaaaaaa--broken\.json: version/)

    expect(JSON.parse(cli(['list', '--json', '--days', '60'], dirs).stdout).runs).toHaveLength(3)

    const removed = pruneFailures(dirs.state, now)
    expect(removed.sort()).toEqual([oldImported, oldOwn].sort())
    expect(existsSync(oldOwn)).toBe(false)
    expect(existsSync(oldImported)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(join(own, 'aaaaaaaa--broken.json'))).toBe(true)
    expect(JSON.parse(cli(['list', '--json'], dirs).stdout).runs).toHaveLength(3)
  })

  it('says so when there are no records, and refuses an unknown argument', () => {
    const dirs = folders('empty')
    const empty = cli(['list'], dirs)
    expect(empty.status, empty.stderr).toBe(0)
    expect(empty.stdout).toMatch(/^no failure records in /)
    expect(cli(['list', '--days', 'x'], dirs).status).toBe(2)
    expect(cli(['list', '--wat'], dirs).status).toBe(2)
  })

  it('runs every call with a Harness home and a state folder in the temporary folder', () => {
    const dirs = folders('where')
    expect(dirs.home.startsWith(root)).toBe(true)
    expect(dirs.state.startsWith(root)).toBe(true)
    expect(cli(['machine'], dirs).status).toBe(0)
    expect(existsSync(join(dirs.home, 'gate', 'machine.json'))).toBe(true)
  })
})
