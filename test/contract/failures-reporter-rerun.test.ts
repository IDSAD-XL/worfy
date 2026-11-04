// The rerun argv of a vitest failure record (test/failures-reporter.ts) runs exactly the test it names.
// vitest's -t is a regular expression without anchors: without ^ and $ the rerun of a test "a" would
// also run a test "a b". A real vitest under scripts/vitest-electron.mjs runs the failing fixture
// tests (test/fixtures/failures-reporter/) once with the reporter, then the rerun argv of a record.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FailureRecord } from '../failure-records'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const FIXTURE = 'test/fixtures/failures-reporter/rerun.fixture.test.ts'
const CONFIG = ['--config', 'test/fixtures/failures-reporter/vitest.config.ts']
const RUN_MS = ms(120_000)

let dir = ''
let runs = 0
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-failures-rerun-')))
})
afterAll(() => {
  if (dir) removeTestTree(dir)
})

/**
 * Runs `argv` ("node" first) from the root of the repository with a GATE_FAILURES_FILE of its own —
 * never the file of a gate running this test — and returns the Tests line and the records.
 */
function run(argv: string[]): { status: number | null; tests: string; records: FailureRecord[]; output: string } {
  const file = join(dir, `run-${++runs}.failures.jsonl`)
  const [node, ...args] = argv
  expect(node).toBe('node')
  const result = spawnSync(scriptNode(), [...args, ...CONFIG], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: RUN_MS,
    env: { ...process.env, GATE_FAILURES_FILE: file },
  })
  const output = `${result.stdout}\n${result.stderr}`
  const tests = stripVTControlCharacters(result.stdout).match(/^\s*Tests\s+(.*)$/m)?.[1]?.trim() ?? ''
  let records: FailureRecord[] = []
  try {
    records = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FailureRecord)
  } catch {
    // No file: no record.
  }
  return { status: result.status, tests, records, output }
}

describe('the rerun argv of a vitest failure record', () => {
  let first: ReturnType<typeof run>
  beforeAll(() => {
    first = run(['node', 'scripts/vitest-electron.mjs', FIXTURE])
  }, RUN_MS)

  it('the run of the fixture gives a record for each of its three failed tests', () => {
    expect(first.status, first.output).toBe(1)
    expect(first.tests, first.output).toMatch(/^3 failed \| 1 passed \(4\)/)
    expect(first.records.map((r) => r.name).sort()).toEqual(['a', 'a b', 'group (with) [regex] chars.* > a'])
    for (const record of first.records) expect(record.file).toBe(FIXTURE)
  })

  it.each(['a', 'group (with) [regex] chars.* > a'])('the rerun of %j runs that test alone', (name) => {
    const record = first.records.find((r) => r.name === name)
    expect(record?.rerun, first.output).toBeTruthy()
    const again = run(record!.rerun!)
    expect(again.status, again.output).toBe(1)
    expect(again.tests, again.output).toMatch(/^1 failed \| 3 skipped \(4\)/)
    expect(again.records.map((r) => r.name)).toEqual([name])
  }, RUN_MS)
})
