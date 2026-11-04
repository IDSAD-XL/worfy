// `gate-failures report` (harness/lib/gate-failures/report.mjs) over the records of many gate runs:
// the class of each failed test, the runs "under load", the steps without tests, and the candidates for
// a quarantine entry and a Windows exception. The fixture, test/fixtures/gate-failures/report/, is a
// state folder of the gate: base/ holds three runs on two computers (one own run of `mac`, two runs
// of `PC` under imported/) and two reruns, dirty/ one run with uncommitted changes and its rerun.
// Each test copies it into a temporary CLAUDE_GATE_STATE and moves every `at` so that the newest run
// is two hours old: the ages, not the dates, are what --days and the 14 days of a candidate read.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const CLI = join(process.cwd(), 'harness', 'bin', 'gate-failures')
const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'gate-failures', 'report')
const HOUR = 60 * 60 * 1000
// The newest `at` of the fixture (the PC run without a rerun): it becomes two hours ago.
const NEWEST = Date.parse('2026-11-03T08:00:00Z')
// One shift for every copy of the fixture, whole seconds: two copies made a second apart hold the same times.
const SHIFT = Math.floor((Date.now() - 2 * HOUR - NEWEST) / 1000) * 1000

const FLAKY = 'vitest test/unit/card-drag.test.ts > card drag > keeps the card under the pointer'
const RED = 'vitest test/unit/shell-launcher.test.ts > shell launcher > starts Git Bash with a login shell'
const LONE = 'playwright test/e2e/toolbar.spec.ts > toolbar > opens the Command palette'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

// The report of --json: what a reader such as scripts/quarantine-suggest.mjs may rely on.
const Computer = z.object({ id: z.string().regex(/^[0-9a-f]{8}$/), name: z.string().min(1), platform: z.string().min(1) })
const Class = z.enum(['red', 'flaky', 'unconfirmed'])
const Report = z
  .object({
    version: z.literal(1),
    kind: z.literal('report'),
    at: z.string(),
    days: z.number().int().positive(),
    computer: z.string().nullable(),
    runs: z.object({ total: z.number().int(), dirty: z.number().int(), imported: z.number().int(), reruns: z.number().int() }).strict(),
    tests: z.array(
      z
        .object({
          test: z.string(),
          runner: z.string().nullable(),
          file: z.string().nullable(),
          name: z.string().nullable(),
          class: Class,
          counts: z.object({ red: z.number().int(), flaky: z.number().int(), unconfirmed: z.number().int() }).strict(),
          computers: z.array(z.string()),
          platforms: z.array(z.string()),
          lastHead: z.string().nullable(),
          lastAt: z.string(),
          lastError: z.string(),
          runs: z.array(z.object({ run: z.string(), at: z.string(), head: z.string().nullable(), computer: Computer, imported: z.boolean(), class: Class }).strict()),
        })
        .strict(),
    ),
    steps: z.array(
      z
        .object({
          step: z.string(),
          count: z.number().int(),
          computers: z.array(z.string()),
          platforms: z.array(z.string()),
          lastHead: z.string().nullable(),
          lastAt: z.string(),
          lastError: z.string(),
        })
        .strict(),
    ),
    underLoad: z.array(
      z.object({ run: z.string(), at: z.string(), head: z.string().nullable(), computer: Computer, failed: z.number().int(), greenAlone: z.number().int() }).strict(),
    ),
    candidates: z.array(
      z
        .object({
          kind: z.enum(['quarantine', 'windows-exception']),
          test: z.string(),
          runner: z.string().nullable(),
          file: z.string().nullable(),
          name: z.string().nullable(),
          class: z.enum(['red', 'flaky']),
          platforms: z.array(z.string()).min(1),
          computers: z.array(z.string()).min(1),
          runs: z.array(z.string()).min(1),
          heads: z.array(z.string()).min(1),
          lastError: z.string(),
        })
        .strict(),
    ),
    skipped: z.array(z.object({ file: z.string(), reason: z.string() }).strict()),
  })
  .strict()
type Report = z.infer<typeof Report>

let root: string
let count = 0

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gate-failures-report-')))
})

afterAll(() => {
  removeTestTree(root)
})

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d+Z$/, 'Z')
}

// Every file under `dir`, recursively.
function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name)
    return statSync(file).isDirectory() ? filesOf(file) : [file]
  })
}

// A state folder with the fixture parts `parts` ("base", "dirty"), every `at` moved by the same amount.
function state(...parts: string[]): string {
  const dir = join(root, `state-${++count}`)
  mkdirSync(dir, { recursive: true })
  for (const part of parts) cpSync(join(FIXTURE, part), dir, { recursive: true })
  for (const file of filesOf(dir)) {
    const record = JSON.parse(readFileSync(file, 'utf8')) as { at: string }
    record.at = iso(Date.parse(record.at) + SHIFT)
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  }
  return dir
}

function cli(args: string[], stateDir: string): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, HARNESS_HOME: join(root, 'harness-home'), CLAUDE_GATE_STATE: stateDir, EVAL_HARNESS_HOME: '' }
  const run = spawnSync(scriptNode(), [CLI, 'report', ...args], { cwd: root, encoding: 'utf8', env })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

function report(args: string[], stateDir: string): Report {
  const run = cli([...args, '--json'], stateDir)
  expect(run.status, run.stderr).toBe(0)
  return Report.parse(JSON.parse(run.stdout))
}

const classes = (r: Report) => Object.fromEntries(r.tests.map((t) => [t.test, t.class]))

describe('gate-failures report', () => {
  it('gives one flaky test (twice, on darwin and win32), one stable red, one without a rerun, and one run under load', () => {
    const dir = state('base')
    const text = cli([], dir)
    expect(text.status, text.stderr).toBe(0)
    expect(text.stdout).toMatch(/^3 runs \(2 imported\), 2 reruns, the last 14 days, all computers$/m)
    expect(text.stdout).not.toMatch(/dirty/)
    expect(text.stdout).toMatch(/^under load: 1a2b3c4d\/2026-11-01T10-00-00Z-11 on mac \(darwin\) at aaaaaaaaaaaa: 1 failed, 1 green alone$/m)
    // The order: stable red, then flaky, then without a rerun; the steps without tests in a list of their own.
    const order = ['stable red', 'flaky', 'without rerun', 'steps without tests', 'candidates'].map((h) => text.stdout.search(new RegExp(`^${h} \\(`, 'm')))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text.stdout).toContain(`  ${FLAKY}\n    2 flaky; mac, PC; darwin, win32; last bbbbbbbbbbbb`)
    expect(text.stdout).toMatch(/^steps without tests \(1\):\n {2}demo\/\.:lint\n {4}1 time; mac; darwin; last aaaaaaaaaaaa/m)

    const json = report([], dir)
    expect(json.runs).toEqual({ total: 3, dirty: 0, imported: 2, reruns: 2 })
    expect(json.tests.map((t) => t.test)).toEqual([RED, FLAKY, LONE])
    expect(classes(json)).toEqual({ [RED]: 'red', [FLAKY]: 'flaky', [LONE]: 'unconfirmed' })
    const flaky = json.tests.find((t) => t.test === FLAKY)
    expect(flaky).toMatchObject({ counts: { red: 0, flaky: 2, unconfirmed: 0 }, computers: ['mac', 'PC'], platforms: ['darwin', 'win32'], lastHead: SHA_B })
    expect(flaky?.lastError).toBe('Error: Test timed out in 5000ms.')
    expect(json.tests.find((t) => t.test === RED)).toMatchObject({ counts: { red: 1, flaky: 0, unconfirmed: 0 }, computers: ['PC'], platforms: ['win32'] })
    expect(json.steps).toEqual([expect.objectContaining({ step: 'demo/.:lint', count: 1, computers: ['mac'], lastHead: SHA_A })])
    expect(json.underLoad).toEqual([expect.objectContaining({ run: '1a2b3c4d/2026-11-01T10-00-00Z-11', failed: 1, greenAlone: 1 })])
  })

  it('skips a dirty run with the same flaky test: classes and candidates stay, and one line says "1 dirty run skipped"', () => {
    const clean = report([], state('base'))
    const dir = state('base', 'dirty')
    const text = cli([], dir)
    expect(text.status, text.stderr).toBe(0)
    expect(text.stdout).toMatch(/^1 dirty run skipped$/m)
    const json = report([], dir)
    expect(json.runs).toEqual({ total: 3, dirty: 1, imported: 2, reruns: 2 })
    expect(json.tests).toEqual(clean.tests)
    expect(json.candidates).toEqual(clean.candidates)
    expect(json.underLoad).toEqual(clean.underLoad)
  })

  it('--days 1 drops the older runs; --computer PC keeps the records of PC alone', () => {
    const dir = state('base')
    const recent = report(['--days', '1'], dir)
    expect(recent.days).toBe(1)
    expect(recent.runs).toEqual({ total: 1, dirty: 0, imported: 1, reruns: 0 })
    expect(classes(recent)).toEqual({ [LONE]: 'unconfirmed' })
    expect(recent.steps).toEqual([])
    expect(recent.candidates).toEqual([])

    const pc = report(['--computer', 'PC'], dir)
    expect(pc.computer).toBe('PC')
    expect(pc.runs).toEqual({ total: 2, dirty: 0, imported: 2, reruns: 1 })
    expect(classes(pc)).toEqual({ [RED]: 'red', [FLAKY]: 'flaky', [LONE]: 'unconfirmed' })
    expect(pc.tests.flatMap((t) => t.computers)).toEqual(['PC', 'PC', 'PC'])
    expect(pc.steps).toEqual([])
    // Flaky in one run only: no quarantine candidate on PC alone.
    expect(pc.candidates.map((c) => c.kind)).toEqual(['windows-exception'])

    const text = cli(['--computer', 'PC', '--days', '1'], dir)
    expect(text.status, text.stderr).toBe(0)
    expect(text.stdout).toMatch(/^1 run \(1 imported\), 0 reruns, the last 1 day, computer PC$/m)
  })

  it('--json passes the schema; its candidates are one quarantine and one Windows exception', () => {
    const json = report([], state('base'))
    expect(json.candidates).toEqual([
      {
        kind: 'windows-exception',
        test: RED,
        runner: 'vitest',
        file: 'test/unit/shell-launcher.test.ts',
        name: 'shell launcher > starts Git Bash with a login shell',
        class: 'red',
        platforms: ['win32'],
        computers: ['PC'],
        runs: ['7e6d5c4b/2026-11-02T09-00-00Z-301'],
        heads: [SHA_B],
        lastError: "AssertionError: expected 'C:/Program Files/Git/bin/bash.exe' to be 'C:/Program Files/Git/usr/bin/bash.exe'",
      },
      {
        kind: 'quarantine',
        test: FLAKY,
        runner: 'vitest',
        file: 'test/unit/card-drag.test.ts',
        name: 'card drag > keeps the card under the pointer',
        class: 'flaky',
        platforms: ['darwin', 'win32'],
        computers: ['mac', 'PC'],
        runs: ['7e6d5c4b/2026-11-02T09-00-00Z-301', '1a2b3c4d/2026-11-01T10-00-00Z-11'],
        heads: [SHA_B, SHA_A],
        lastError: 'Error: Test timed out in 5000ms.',
      },
    ])
    const text = cli([], state('base'))
    expect(text.stdout).toMatch(/^ {2}windows exception {2}vitest test\/unit\/shell-launcher\.test\.ts > .*: red alone on win32 only \(1 run\)$/m)
    expect(text.stdout).toMatch(/^ {2}quarantine {9}vitest test\/unit\/card-drag\.test\.ts > .*: flaky in 2 runs \(mac, PC\)$/m)
  })

  it('a red run whose rerun is on another SHA stays without a rerun, and a Windows exception needs no red on another platform at that SHA', () => {
    const dir = state('base')
    // The rerun of the PC run, moved to another SHA: neither green nor red alone counts any more.
    const imported = join(dir, 'failures', 'imported', '9f8e7d6c')
    const rerunFile = readdirSync(imported).find((n) => n.includes('.rerun-')) ?? ''
    const rerun = JSON.parse(readFileSync(join(imported, rerunFile), 'utf8')) as { head: string }
    rerun.head = 'd'.repeat(40)
    writeFileSync(join(imported, rerunFile), JSON.stringify(rerun))
    const moved = report([], dir)
    expect(moved.tests.find((t) => t.test === RED)?.class).toBe('unconfirmed')
    expect(moved.candidates).toEqual([])

    // The stable red test fails on mac at the same SHA too, without a rerun there: not win32 alone.
    const both = state('base')
    const own = join(both, 'failures')
    const run = JSON.parse(readFileSync(join(own, '1a2b3c4d--2026-11-01T10-00-00Z-11.json'), 'utf8')) as {
      run: string
      head: string
      failures: { test: string | null }[]
    }
    const pcRun = JSON.parse(readFileSync(join(imported.replace(dir, both), '7e6d5c4b--2026-11-02T09-00-00Z-301.json'), 'utf8')) as {
      failures: { test: string | null }[]
    }
    run.run = '1a2b3c4d/2026-11-02T10-00-00Z-13'
    run.head = SHA_B
    run.failures = pcRun.failures.filter((f) => f.test === RED)
    writeFileSync(join(own, '1a2b3c4d--2026-11-02T10-00-00Z-13.json'), JSON.stringify(run))
    expect(report([], both).candidates.map((c) => c.kind)).toEqual(['quarantine'])
  })

  it('names a broken file on stderr and refuses wrong arguments with exit 2', () => {
    const dir = state('base')
    writeFileSync(join(dir, 'failures', 'aaaaaaaa--broken.json'), '{"version": 2}')
    const text = cli([], dir)
    expect(text.status, text.stderr).toBe(0)
    expect(text.stderr).toMatch(/skipped .*aaaaaaaa--broken\.json: version/)
    expect(report([], dir).skipped).toHaveLength(1)
    for (const args of [['--days', '0'], ['--days', 'x'], ['--computer'], ['--wat']]) {
      const bad = cli(args, dir)
      expect(bad.status, args.join(' ')).toBe(2)
      expect(bad.stderr).toMatch(/usage: gate-failures report/)
    }
    const empty = cli([], join(root, 'no-state'))
    expect(empty.status, empty.stderr).toBe(0)
    expect(empty.stdout).toMatch(/^no failure records in /)
  })
})
