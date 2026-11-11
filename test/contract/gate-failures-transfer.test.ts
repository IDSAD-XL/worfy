// `gate-failures export` and `gate-failures import`: the failure records of one computer reach another
// as text — a file, stdin or the comments of an issue or a PR — and never carry the user name, the
// host name, the home folder or a token. Each "computer" is a Harness home and a gate state folder of
// its own in a temporary folder; gh and bin/profile are stand-ins (test/fixtures/gate-failures/transfer/),
// and a gh on PATH that fails shows the real one is never called. Nothing reaches GitHub.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RerunRecord, RunRecord } from '../../harness/hooks/gate-failures.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

// The host name of this computer is a secret only when privacy.cjs keeps it (distinctiveHost): a host named
// with a common word (a platform name) is not searched for, so the cases below check it only then.
const { distinctiveHost } = createRequire(import.meta.url)('../../harness/lib/privacy.cjs') as { distinctiveHost: (hostname: string) => string }
const secretHost = distinctiveHost(hostname()) !== ''

const CLI = join(process.cwd(), 'harness', 'bin', 'gate-failures')
const FIXTURES = join(process.cwd(), 'test', 'fixtures', 'gate-failures', 'transfer')
const PC = { id: 'a1b2c3d4', name: 'pc' }
const MAC = { id: 'b5c6d7e8', name: 'mac' }
const ACCOUNT = 'IDSAD-XL'

let root: string
let guardBin: string

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gate-failures-transfer-')))
  // A gh first on PATH that only leaves a mark: the stand-in comes through GATE_FAILURES_GH.
  guardBin = join(root, 'guard-bin')
  mkdirSync(guardBin)
  writeFileSync(join(guardBin, 'gh'), `#!/bin/sh\necho called > "${join(root, 'real-gh-called')}"\nexit 97\n`)
  chmodSync(join(guardBin, 'gh'), 0o755)
  writeFileSync(join(guardBin, 'gh.cmd'), `@echo called> "${join(root, 'real-gh-called')}"\r\n@exit /b 97\r\n`)
})

afterAll(() => {
  expect(existsSync(join(root, 'real-gh-called'))).toBe(false)
  removeTestTree(root)
})

interface Computer {
  home: string
  state: string
}

let seq = 0
function computer(label: string, who: { id: string; name: string }): Computer {
  const base = join(root, `${label}-${seq++}`)
  const home = join(base, 'harness-home')
  const state = join(base, 'state')
  mkdirSync(join(home, 'gate'), { recursive: true })
  mkdirSync(state, { recursive: true })
  writeFileSync(join(home, 'gate', 'machine.json'), JSON.stringify(who))
  return { home, state }
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function cli(args: string[], c: Computer, opts: { input?: string; env?: Record<string, string>; cwd?: string } = {}): Run {
  const env = {
    ...process.env,
    HARNESS_HOME: c.home,
    CLAUDE_GATE_STATE: c.state,
    EVAL_HARNESS_HOME: '',
    PATH: `${guardBin}${delimiter}${process.env.PATH ?? ''}`,
    GATE_FAILURES_GH: join(FIXTURES, 'gh-stub.mjs'),
    CLAUDE_PROFILE_BIN: join(FIXTURES, 'profile-stub.mjs'),
    ...opts.env,
  }
  const run = spawnSync(scriptNode(), [CLI, ...args], { cwd: opts.cwd ?? root, encoding: 'utf8', env, input: opts.input ?? '' })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d+Z$/, 'Z')
}

const TEMPLATE = JSON.parse(readFileSync(join(FIXTURES, 'run.json'), 'utf8')) as RunRecord

function runRecord(n: number, who = PC, error?: string, failures = 2): RunRecord {
  const base = structuredClone(TEMPLATE)
  const lead = base.failures[0]
  if (!lead) throw new Error('run.json has no failures')
  const extra = Array.from({ length: Math.max(0, failures - 2) }, (_, i) => ({ ...lead, name: `a > case ${i}`, test: `vitest test/unit/a.test.ts > a > case ${i}`, line: 10 + i }))
  const all = [...base.failures, ...extra].map((f) => (error === undefined ? f : { ...f, error }))
  return { ...base, run: `0f1e2d3c/r${String(n).padStart(3, '0')}`, at: iso(Date.now() - (n + 1) * 60_000), computer: { ...who, platform: 'win32' }, failures: all }
}

function rerunRecord(run: RunRecord): RerunRecord {
  return { version: 1, kind: 'rerun', of: run.run, at: iso(Date.parse(run.at) + 30_000), head: run.head, computer: run.computer, results: [{ test: run.failures[0]?.test ?? 'x', exit: 0, ms: 5, error: null }] }
}

function put(c: Computer, record: RunRecord | RerunRecord): void {
  const dir = join(c.state, 'failures')
  mkdirSync(dir, { recursive: true })
  const name = record.kind === 'rerun' ? `${record.of.replace('/', '--')}.rerun-${record.at.replaceAll(':', '-')}.json` : `${record.run.replace('/', '--')}.json`
  writeFileSync(join(dir, name), `${JSON.stringify(record, null, 2)}\n`)
}

function imported(c: Computer, id = PC.id): string[] {
  const dir = join(c.state, 'failures', 'imported', id)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

function block(files: unknown[], part = 1, parts = 1, exportId = 'c0ffee00', who = PC): string {
  const head = JSON.stringify({ export: exportId, at: '2026-11-04T10:00:00Z', computer: { ...who, platform: 'win32' }, part, parts })
  return [`gate-failures export v1 part ${part}/${parts}`, `computer: ${who.name} (win32)`, '```json', `${head.slice(0, -1)},"files":[`, files.map((f) => JSON.stringify(f)).join(',\n'), ']}', '```', ''].join('\n')
}

// Personal values, put together at run time so the test file itself carries none whole.
const WINDOWS_HOME = ['C:', 'Users', 'jdoe', 'AppData', 'x.ts'].join('\\')
const TOKEN = `ghp_${'Ab3'.repeat(12)}`
const UUID = '3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b'

describe('gate-failures export and import', () => {
  it('lists export and import in --help', () => {
    const help = cli(['--help'], computer('help', MAC))
    expect(help.status).toBe(0)
    expect(help.stdout).toMatch(/^ {2}export /m)
    expect(help.stdout).toMatch(/^ {2}import /m)
    expect(help.stdout).not.toMatch(/transfer-common/)
  })

  it('moves two runs and a rerun through a file; a second import says already imported', () => {
    const pc = computer('pc', PC)
    const mac = computer('mac', MAC)
    const first = runRecord(1)
    put(pc, first)
    put(pc, runRecord(2))
    put(pc, rerunRecord(first))
    const out = join(root, `export-${seq++}`)
    const exported = cli(['export', '--out', out], pc)
    expect(exported.stderr).toBe('')
    expect(exported.status).toBe(0)
    expect(exported.stdout).toContain('2 run(s), 1 rerun(s) in 1 part(s)')
    const text = readFileSync(`${out}.1`, 'utf8')
    expect(text.split('\n').slice(0, 2)).toEqual(['gate-failures export v1 part 1/1', 'computer: pc (' + process.platform + ')'])

    const once = cli(['import', `${out}.1`], mac)
    expect(once.status).toBe(0)
    expect(once.stdout).toContain('imported: 3 new, 0 skipped, 0 rejected')
    expect(imported(mac)).toEqual(['0f1e2d3c--r001.json', `0f1e2d3c--r001.rerun-${rerunRecord(first).at.replaceAll(':', '-')}.json`, '0f1e2d3c--r002.json'].sort())
    const list = JSON.parse(cli(['list', '--json'], mac).stdout) as { runs: { run: string; imported: boolean; reruns: number }[] }
    expect(list.runs.map((r) => [r.run, r.imported, r.reruns])).toEqual([
      ['0f1e2d3c/r001', true, 1],
      ['0f1e2d3c/r002', true, 0],
    ])

    const twice = cli(['import', `${out}.1`], mac)
    expect(twice.status).toBe(0)
    expect(twice.stdout).toContain('imported: 0 new, 3 skipped, 0 rejected')
    expect(twice.stdout).toMatch(/0f1e2d3c\/r001 of pc a1b2c3d4: already imported/)
  })

  it('takes the export from stdin with import -', () => {
    const pc = computer('pc', PC)
    const mac = computer('mac', MAC)
    put(pc, runRecord(1))
    put(pc, runRecord(2))
    const exported = cli(['export'], pc)
    expect(exported.status).toBe(0)
    expect(exported.stdout.startsWith('gate-failures export v1 part 1/1\n')).toBe(true)
    const once = cli(['import', '-'], mac, { input: exported.stdout })
    expect(once.status).toBe(0)
    expect(once.stdout).toContain('imported: 2 new, 0 skipped, 0 rejected')
    expect(imported(mac)).toEqual(['0f1e2d3c--r001.json', '0f1e2d3c--r002.json'])
    expect(cli(['import', '-'], mac, { input: exported.stdout }).stdout).toContain('imported: 0 new, 2 skipped, 0 rejected')
  })

  it('splits 40 runs with long errors into parts of at most 60000 characters, and refuses an export with a part missing', () => {
    const pc = computer('pc', PC)
    const error = `AssertionError: expected the value to match ${'0123456789 '.repeat(20)}`.slice(0, 200)
    for (let n = 0; n < 40; n++) put(pc, runRecord(n, PC, error, 8))
    const out = join(root, `export-${seq++}`)
    const exported = cli(['export', '--out', out], pc)
    expect(exported.status).toBe(0)
    expect(exported.stdout).toContain('40 run(s), 0 rerun(s) in 3 part(s)')
    const parts = [1, 2, 3].map((k) => readFileSync(`${out}.${k}`, 'utf8'))
    expect(existsSync(`${out}.4`)).toBe(false)
    for (const [i, text] of parts.entries()) {
      expect(text.length).toBeLessThanOrEqual(60000)
      expect(text.startsWith(`gate-failures export v1 part ${i + 1}/3\n`)).toBe(true)
    }

    const mac = computer('mac', MAC)
    const all = cli(['import', '-'], mac, { input: parts.join('\n') })
    expect(all.status).toBe(0)
    expect(all.stdout).toContain('imported: 40 new, 0 skipped, 0 rejected')
    expect(imported(mac)).toHaveLength(40)

    const other = computer('mac', MAC)
    const short = cli(['import', '-'], other, { input: parts.slice(0, 2).join('\n') })
    expect(short.status).toBe(2)
    expect(short.stdout).toContain('export incomplete: part 3/3 missing')
    expect(imported(other)).toEqual([])
  })

  it('cuts the errors of a run that alone is longer than a part to 80 characters, and says so', () => {
    const pc = computer('pc', PC)
    put(pc, runRecord(1, PC, `E${'x'.repeat(199)}`, 150))
    const exported = cli(['export'], pc)
    expect(exported.status).toBe(0)
    expect(exported.stderr).toContain('0f1e2d3c/r001 is longer than a part: the error of its records is cut to 80 characters')
    expect(exported.stdout.length).toBeLessThanOrEqual(60000)
    const mac = computer('mac', MAC)
    expect(cli(['import', '-'], mac, { input: exported.stdout }).status).toBe(0)
    const record = JSON.parse(readFileSync(join(mac.state, 'failures', 'imported', PC.id, '0f1e2d3c--r001.json'), 'utf8')) as RunRecord
    expect(record.failures).toHaveLength(150)
    expect(record.failures.every((f) => [...f.error].length === 80 && f.error.endsWith('…'))).toBe(true)
  })

  it('with --gh takes only the blocks of the profile account, and passes over a comment without a marker', () => {
    const pc = computer('pc', PC)
    put(pc, runRecord(1))
    const mine = cli(['export'], pc).stdout
    const stranger = block([runRecord(7, { id: 'c9d8e7f6', name: 'other' })], 1, 1, 'deadbeef', { id: 'c9d8e7f6', name: 'other' })
    const gh = join(root, `gh-${seq++}`)
    mkdirSync(gh)
    writeFileSync(join(gh, 'calls.jsonl'), '')
    writeFileSync(
      join(gh, 'responses.json'),
      JSON.stringify({
        'repos/IDSAD-XL/worfy/issues/42': { user: { login: 'someone-else' }, body: 'main is red on the PC\n\ngate report: exit 2' },
        'repos/IDSAD-XL/worfy/issues/42/comments?per_page=100&page=1': [
          { id: 1, user: { login: 'idsad-xl' }, body: mine },
          { id: 2, user: { login: 'intruder' }, body: stranger },
          { id: 3, user: { login: ACCOUNT }, body: 'rerun went green, see above' },
        ],
      }),
    )
    const mac = computer('mac', MAC)
    const env = { GH_STUB_DIR: gh, STUB_ACCOUNT: ACCOUNT }
    const got = cli(['import', '--gh', 'IDSAD-XL/worfy', '--issue', '42'], mac, { env })
    expect(got.stderr).toBe('')
    expect(got.status).toBe(0)
    expect(got.stdout).toContain('ignored  comment 2 by intruder: not IDSAD-XL (github.account)')
    expect(got.stdout).toContain('imported: 1 new, 0 skipped, 0 rejected')
    expect(got.stdout).not.toContain('comment 3')
    expect(imported(mac)).toEqual(['0f1e2d3c--r001.json'])
    expect(imported(mac, 'c9d8e7f6')).toEqual([])
    const calls = readFileSync(join(gh, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
    expect(calls).toEqual([
      ['api', 'repos/IDSAD-XL/worfy/issues/42'],
      ['api', 'repos/IDSAD-XL/worfy/issues/42/comments?per_page=100&page=1'],
    ])

    // A PR reads the same endpoints; with no github.account nothing counts.
    const none = cli(['import', '--gh', 'IDSAD-XL/worfy', '--pr', '42'], computer('mac', MAC), { env: { GH_STUB_DIR: gh, STUB_ACCOUNT: '' } })
    expect(none.status).toBe(1)
    expect(none.stderr).toContain("--gh needs the profile's github.account")
  })

  it('refuses to export a record with a Windows home path, the host name, a UUID and a token, and import refuses the same file', () => {
    const pc = computer('pc', PC)
    const host = hostname()
    const leaky = runRecord(1, PC, `failed at ${WINDOWS_HOME} on ${host} for ${UUID} with ${TOKEN}`.slice(0, 200))
    put(pc, leaky)
    const out = join(root, `export-${seq++}`)
    const exported = cli(['export', '--out', out], pc)
    expect(exported.status).toBe(2)
    expect(exported.stdout).toBe('')
    expect(existsSync(`${out}.1`)).toBe(false)
    expect(exported.stderr).toMatch(/personal data: 0f1e2d3c\/r001 failures\[0\]\.error: .*home-path/)
    expect(exported.stderr).toMatch(/failures\[0\]\.error: .*uuid/)
    expect(exported.stderr).toMatch(/failures\[0\]\.error: .*token/)
    if (secretHost) expect(exported.stderr).toMatch(/failures\[0\]\.error: .*host/)
    for (const value of ['jdoe', UUID, TOKEN]) expect(exported.stderr).not.toContain(value)

    const mac = computer('mac', MAC)
    const got = cli(['import', '-'], mac, { input: block([leaky]) })
    expect(got.status).toBe(2)
    expect(got.stdout).toMatch(/rejected 0f1e2d3c\/r001 from pc a1b2c3d4: personal data in failures\[0\]\.error \(.*home-path.*\)/)
    expect(got.stdout).toContain('imported: 0 new, 0 skipped, 1 rejected')
    expect(got.stdout).not.toContain('jdoe')
    expect(imported(mac)).toEqual([])
  })

  it('refuses a record that holds the home folder or the host name of this computer', () => {
    for (const value of [`${homedir()}/x.ts`, ...(secretHost ? [hostname()] : [])]) {
      const pc = computer('pc', PC)
      put(pc, runRecord(1, PC, `failed near ${value}`.slice(0, 200)))
      const exported = cli(['export'], pc)
      expect(exported.status).toBe(2)
      expect(exported.stdout).toBe('')
      expect(exported.stderr).toMatch(/personal data: 0f1e2d3c\/r001 failures\[0\]\.error: /)
    }
  })

  it('writes an export without the worktree root, the home folder, the host name or the user name of this computer', () => {
    const pc = computer('pc', PC)
    for (let n = 0; n < 3; n++) put(pc, runRecord(n))
    // From the worktree of this repository, so its root is one of the values the export checks.
    const exported = cli(['export'], pc, { cwd: process.cwd() })
    expect(exported.status).toBe(0)
    const text = exported.stdout
    expect(text).toContain('gate-failures export v1 part 1/1')
    const lower = text.toLowerCase()
    for (const folder of [process.cwd(), homedir()]) {
      for (const spelling of [folder, folder.replaceAll('\\', '/'), folder.replaceAll('/', '\\'), JSON.stringify(folder).slice(1, -1)]) expect(lower).not.toContain(spelling.toLowerCase())
    }
    const word = (w: string): RegExp => new RegExp(`(?<![A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i')
    if (secretHost) expect(text).not.toMatch(word(hostname()))
    // The stand-in names of privacy.cjs (a CI runner is "runner") are words of the format itself.
    const user = userInfo().username
    if (user.length >= 3 && !['test', 'someone', 'user', 'you', 'runner', 'runneradmin'].includes(user.toLowerCase())) expect(text).not.toMatch(word(user))
  })

  it('does not import a file of its own computer', () => {
    const pc = computer('pc', PC)
    put(pc, runRecord(1))
    const exported = cli(['export'], pc)
    expect(exported.status).toBe(0)
    const back = cli(['import', '-'], pc, { input: exported.stdout })
    expect(back.status).toBe(0)
    expect(back.stdout).toContain('skipped  0f1e2d3c/r001: a record of this computer (a1b2c3d4)')
    expect(back.stdout).toContain('imported: 0 new, 1 skipped, 0 rejected')
    expect(imported(pc)).toEqual([])
  })

  it('refuses a broken block and a record of another format, and takes the rest', () => {
    const mac = computer('mac', MAC)
    const bad = { ...runRecord(2), version: 2 }
    const input = [`gate-failures export v1 part 1/1\ncomputer: pc (win32)\n\`\`\`json\n{not json\n\`\`\`\n`, block([runRecord(1), bad], 1, 1, 'abcdef01')].join('\n')
    const got = cli(['import', '-'], mac, { input })
    expect(got.status).toBe(2)
    expect(got.stdout).toContain('rejected block at stdin line 1: the block is not JSON')
    expect(got.stdout).toMatch(/rejected 0f1e2d3c\/r002 from pc a1b2c3d4: version: 2/)
    expect(got.stdout).toContain('imported: 1 new, 0 skipped, 2 rejected')
    expect(imported(mac)).toEqual(['0f1e2d3c--r001.json'])
  })
})
