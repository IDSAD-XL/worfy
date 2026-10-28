// The quarantine of flaky unit and contract tests (test/quarantine.ts, entries in test/quarantine/).
//
// The first block checks the real entries and marks of the repository: an entry without an owner or
// an exit date, one that stays longer than 14 days, one dated later than today, one past its exit
// date, one for a test the file does not have, a mark without an entry, more than 15 entries — each
// makes this file red, with the name of the entry. The other blocks check the rules on fixtures, with a clock passed in, never the
// system clock, and the helper with a fake `it` in place of vitest's.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ENTRIES,
  QUARANTINE_DIR,
  quarantineMode,
  quarantineProblems,
  quarantined,
  readEntryFiles,
  type EntryFile,
  type TestFunctionLike,
} from '../quarantine'

const REPO = join(import.meta.dirname, '..', '..')
const THIS_FILE = 'test/unit/quarantine.test.ts'

/** Every unit and contract test file, as a path from the repository root with `/`. */
function testFiles(): string[] {
  return ['test/unit', 'test/contract'].flatMap((dir) =>
    (readdirSync(join(REPO, dir), { recursive: true, encoding: 'utf8' }) as string[])
      .filter((name) => /\.test\.tsx?$/.test(name))
      .map((name) => relative(REPO, join(REPO, dir, name)).split(sep).join('/')),
  )
}

function readRepoFile(file: string): string | undefined {
  try {
    return readFileSync(join(REPO, file), 'utf8')
  } catch {
    return undefined
  }
}

describe('the quarantine of this repository', () => {
  it('has only valid entries, none past its exit date, each with its mark, and no mark without an entry', () => {
    // This file names quarantined() in its fixtures; its own marks are not marks.
    const files = testFiles().filter((file) => file !== THIS_FILE)
    const problems = quarantineProblems(readEntryFiles(QUARANTINE_DIR), {
      now: new Date(),
      readTestFile: readRepoFile,
      testFiles: files.map((file) => ({ file, text: readRepoFile(file) ?? '' })),
    })
    expect(problems).toEqual([])
  })
})

// A test file of the fixtures: one quarantined test inside a describe, one whose name is a template.
const FIXTURE_FILE = 'test/contract/fixture.test.ts'
const FIXTURE_TEXT = `import { describe } from 'vitest'
import { quarantined } from '../quarantine'
const ROUNDS = 16
describe('the watcher', () => {
  quarantined('watcher-event')('reports a change within one second', async () => {})
  quarantined('rounds')(\`\${ROUNDS} rounds give every handle back\`, async () => {})
})
`
const NOW = new Date('2026-10-28T12:00:00Z')

function entry(id: string, fields: Record<string, unknown> = {}): EntryFile {
  const raw = {
    file: FIXTURE_FILE,
    test: 'the watcher > reports a change within one second',
    platforms: ['win32'],
    reason: 'the event comes later than one second on a loaded runner',
    owner: 'worfy-throughput 23',
    since: '2026-10-28',
    until: '2026-11-11',
    ...fields,
  }
  for (const [key, value] of Object.entries(raw)) if (value === undefined) delete (raw as Record<string, unknown>)[key]
  return { id, text: JSON.stringify(raw) }
}

const roundsEntry = entry('rounds', { test: 'the watcher > 16 rounds give every handle back' })

function problemsOf(entries: EntryFile[], options: { now?: Date; text?: string } = {}): string[] {
  const text = options.text ?? FIXTURE_TEXT
  return quarantineProblems(entries, {
    now: options.now ?? NOW,
    readTestFile: (file) => (file === FIXTURE_FILE ? text : undefined),
    testFiles: [{ file: FIXTURE_FILE, text }],
  })
}

describe('quarantineProblems: the rules of an entry', () => {
  it('passes valid entries, a test named by a template included', () => {
    expect(problemsOf([entry('watcher-event'), roundsEntry])).toEqual([])
  })

  it('an entry without an owner is red, with its name', () => {
    expect(problemsOf([entry('watcher-event', { owner: undefined }), roundsEntry])).toEqual([
      'watcher-event: no owner (the ticket that fixes the test)',
    ])
  })

  it('an entry without an exit date is red, with its name', () => {
    expect(problemsOf([entry('watcher-event', { until: undefined }), roundsEntry])).toEqual([
      'watcher-event: no until (the exit date, YYYY-MM-DD)',
    ])
  })

  it('an exit date more than 14 days after the entry date is red; exactly 14 days passes', () => {
    expect(problemsOf([entry('watcher-event', { until: '2026-11-12' }), roundsEntry])).toEqual([
      'watcher-event: until 2026-11-12 is more than 14 days after since 2026-10-28',
    ])
    expect(problemsOf([entry('watcher-event', { until: '2026-11-11' }), roundsEntry])).toEqual([])
  })

  it('an exit date before the entry date, a date that is no date, and an unknown platform are red', () => {
    expect(
      problemsOf([entry('watcher-event', { since: '2026-11-02', until: '2026-11-01' }), roundsEntry]),
    ).toEqual(['watcher-event: until 2026-11-01 is before since 2026-11-02'])
    expect(problemsOf([entry('watcher-event', { since: '2026-02-30' }), roundsEntry])).toEqual([
      'watcher-event: no since (the entry date, YYYY-MM-DD)',
    ])
    expect(problemsOf([entry('watcher-event', { platforms: ['windows'] }), roundsEntry])).toEqual([
      'watcher-event: platforms must be a non-empty list of darwin, win32, linux',
    ])
  })

  it('an entry past its exit date is red with its name; on the exit date itself it is not', () => {
    expect(problemsOf([entry('watcher-event'), roundsEntry], { now: new Date('2026-11-12T00:00:01Z') })).toEqual([
      'watcher-event: expired on 2026-11-11 (owner worfy-throughput 23): fix the test, or extend the entry with the owner’s word',
      'rounds: expired on 2026-11-11 (owner worfy-throughput 23): fix the test, or extend the entry with the owner’s word',
    ])
    expect(problemsOf([entry('watcher-event'), roundsEntry], { now: new Date('2026-11-11T23:59:59Z') })).toEqual([])
  })

  it('an entry date later than today (UTC) is red; today itself passes', () => {
    const later = entry('watcher-event', { since: '2026-10-29', until: '2026-11-11' })
    expect(problemsOf([later, roundsEntry], { now: new Date('2026-10-28T23:59:59Z') })).toEqual([
      'watcher-event: since 2026-10-29 is later than today 2026-10-28 (UTC): the entry date is the day the test is quarantined',
    ])
    expect(problemsOf([later, roundsEntry], { now: new Date('2026-10-29T00:00:00Z') })).toEqual([])
  })

  it('an entry for a test the file does not have is red', () => {
    expect(
      problemsOf([entry('watcher-event', { test: 'the watcher > reports a change within two seconds' }), roundsEntry]),
    ).toEqual([
      `watcher-event: ${FIXTURE_FILE} has no test "the watcher > reports a change within two seconds" under quarantined('watcher-event')`,
    ])
    expect(problemsOf([entry('watcher-event', { test: 'the hub > reports a change within one second' }), roundsEntry])).toEqual([
      `watcher-event: ${FIXTURE_FILE} has no test "the hub > reports a change within one second" under quarantined('watcher-event')`,
    ])
  })

  it('an entry whose file is missing, or is no unit or contract test file, is red', () => {
    expect(problemsOf([entry('watcher-event', { file: 'test/contract/gone.test.ts' }), roundsEntry])).toEqual([
      "watcher-event: test/contract/gone.test.ts has no mark quarantined('watcher-event')",
      `${FIXTURE_FILE}: quarantined('watcher-event') has no entry for this file in test/quarantine/`,
    ])
    expect(problemsOf([entry('watcher-event', { file: 'test/e2e/canvas.spec.ts' }), roundsEntry])[0]).toBe(
      'watcher-event: file must be a unit or contract test file (test/unit/… or test/contract/…, .test.ts or .test.tsx)',
    )
  })

  it('a mark without an entry is red, and so is an entry whose file has no mark', () => {
    expect(problemsOf([roundsEntry])).toEqual([
      `${FIXTURE_FILE}: quarantined('watcher-event') has no entry for this file in test/quarantine/`,
    ])
    const unmarked = FIXTURE_TEXT.replace("quarantined('watcher-event')(", 'it(')
    expect(problemsOf([entry('watcher-event'), roundsEntry], { text: unmarked })).toEqual([
      `watcher-event: ${FIXTURE_FILE} has no mark quarantined('watcher-event')`,
    ])
  })

  it('two entries for one test are red', () => {
    const text = FIXTURE_TEXT.replace(
      "quarantined('rounds')",
      "quarantined('watcher-event-again')('reports a change within one second', async () => {})\n  quarantined('rounds')",
    )
    expect(problemsOf([entry('watcher-event'), entry('watcher-event-again'), roundsEntry], { text })).toEqual([
      'watcher-event-again: the same test as watcher-event: one entry per test',
    ])
  })

  it('an entry that is no JSON, or whose name is no plain id, is red', () => {
    expect(problemsOf([{ id: 'watcher-event', text: '{ "file": ' }, roundsEntry])[0]).toBe(
      'watcher-event: not a JSON object',
    )
    expect(problemsOf([entry('Watcher Event'), roundsEntry])[0]).toBe(
      'Watcher Event: the file name must be lower-case letters, digits and dashes, then .json',
    )
  })

  it(`more than ${MAX_ENTRIES} entries are red; ${MAX_ENTRIES} pass`, () => {
    const marks = (count: number) =>
      Array.from({ length: count }, (_, n) => `quarantined('e${n}')('test ${n}', () => {})`).join('\n')
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => entry(`e${n}`, { test: `test ${n}` }))
    expect(problemsOf(many(MAX_ENTRIES), { text: marks(MAX_ENTRIES) })).toEqual([])
    expect(problemsOf(many(MAX_ENTRIES + 1), { text: marks(MAX_ENTRIES + 1) })).toEqual([
      `${MAX_ENTRIES + 1} entries in test/quarantine/, at most ${MAX_ENTRIES}: fix a test before quarantining another`,
    ])
  })
})

/** A stand-in for vitest's `it` that records how each test was declared. */
function fakeIt() {
  const calls: { how: 'run' | 'skip' | 'log'; name: string; timeout?: number }[] = []
  const register = ((name: string, _fn: TestFunctionLike, timeout?: number) => {
    calls.push({ how: 'run', name, timeout })
  }) as ((name: string, fn: TestFunctionLike, timeout?: number) => void) & {
    skip: (name: string, fn: TestFunctionLike, timeout?: number) => void
  }
  register.skip = (name, _fn, timeout) => {
    calls.push({ how: 'skip', name, timeout })
  }
  return { it: register, calls }
}

describe('quarantined(): what the helper does with a test', () => {
  const read = (files: Record<string, EntryFile>) => (id: string) => files[id]?.text
  const watcher = { 'watcher-event': entry('watcher-event') }
  const name = 'reports a change within one second'
  const label = ' (quarantine: worfy-throughput 23, until 2026-11-11)'

  // CI sets GITHUB_ACTIONS; these tests set it themselves, so they read the same everywhere.
  beforeEach(() => {
    vi.stubEnv('GITHUB_ACTIONS', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function declare(options: { env?: string; platform?: NodeJS.Platform; now?: Date; files?: Record<string, EntryFile>; id?: string; name?: string }) {
    const fake = fakeIt()
    quarantined(options.id ?? 'watcher-event', {
      it: fake.it,
      read: read(options.files ?? watcher),
      env: options.env,
      platform: options.platform ?? 'win32',
      now: options.now ?? NOW,
      log: (line) => fake.calls.push({ how: 'log', name: line }),
    })(options.name ?? name, () => {}, 30_000)
    return fake.calls
  }

  it('skips an active entry of this platform without WORFY_QUARANTINE, and prints the owner and the exit date', () => {
    const skipped = [
      { how: 'log', name: `skip (quarantine: worfy-throughput 23, until 2026-11-11): ${FIXTURE_FILE} > the watcher > ${name}` },
      { how: 'skip', name: `${name}${label}`, timeout: 30_000 },
    ]
    expect(declare({})).toEqual(skipped)
    expect(declare({ env: '' })).toEqual(skipped)
  })

  it('on GitHub Actions also prints a warning annotation that names the test, its owner and exit date', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    expect(declare({})).toEqual([
      { how: 'log', name: `skip (quarantine: worfy-throughput 23, until 2026-11-11): ${FIXTURE_FILE} > the watcher > ${name}` },
      {
        how: 'log',
        name: `::warning title=quarantine::${FIXTURE_FILE} > the watcher > ${name} (owner worfy-throughput 23, until 2026-11-11)`,
      },
      { how: 'skip', name: `${name}${label}`, timeout: 30_000 },
    ])
    // The message of a workflow command escapes %, CR and LF.
    const odd = { 'watcher-event': entry('watcher-event', { test: 'the watcher > 100% of\nchanges' }) }
    expect(declare({ files: odd, name: '100% of\nchanges' })[1]?.name).toBe(
      `::warning title=quarantine::${FIXTURE_FILE} > the watcher > 100%25 of%0Achanges (owner worfy-throughput 23, until 2026-11-11)`,
    )
    expect(declare({ env: 'run' }).map((call) => call.how)).toEqual(['run'])
  })

  it('runs the test under WORFY_QUARANTINE=run and =only, its name still saying it is quarantined', () => {
    expect(declare({ env: 'run' })).toEqual([{ how: 'run', name: `${name}${label}`, timeout: 30_000 }])
    expect(declare({ env: 'only' })).toEqual([{ how: 'run', name: `${name}${label}`, timeout: 30_000 }])
  })

  it('does not skip a test past its exit date: it runs under its own name in every run', () => {
    expect(declare({ now: new Date('2026-11-12T00:00:00Z') })).toEqual([{ how: 'run', name, timeout: 30_000 }])
    expect(declare({ now: new Date('2026-11-11T23:59:59Z') }).at(-1)?.how).toBe('skip')
  })

  it('runs the test on a platform the entry does not name', () => {
    expect(declare({ platform: 'darwin' })).toEqual([{ how: 'run', name, timeout: 30_000 }])
    expect(declare({ platform: 'linux' })).toEqual([{ how: 'run', name, timeout: 30_000 }])
  })

  it('runs the test when its entry is missing, broken, or names another test', () => {
    expect(declare({ files: {} })).toEqual([{ how: 'run', name, timeout: 30_000 }])
    expect(declare({ files: { 'watcher-event': { id: 'watcher-event', text: '{' } } })).toEqual([
      { how: 'run', name, timeout: 30_000 },
    ])
    expect(declare({ files: { 'watcher-event': entry('watcher-event', { owner: '' }) } })).toEqual([
      { how: 'run', name, timeout: 30_000 },
    ])
    expect(declare({ name: 'reports a change within two seconds' })).toEqual([
      { how: 'run', name: 'reports a change within two seconds', timeout: 30_000 },
    ])
  })

  it('reads its entry from test/quarantine/ by default', () => {
    const [first] = readEntryFiles(QUARANTINE_DIR)
    if (first === undefined) return
    const raw = JSON.parse(first.text) as { test: string; platforms: NodeJS.Platform[]; since: string }
    const fake = fakeIt()
    const log = (line: string) => fake.calls.push({ how: 'log', name: line })
    quarantined(first.id, { it: fake.it, env: undefined, platform: raw.platforms[0], now: new Date(`${raw.since}T12:00:00Z`), log })(
      raw.test.split(' > ').at(-1) ?? '',
      () => {},
    )
    expect(fake.calls.map((call) => call.how)).toEqual(['log', 'skip'])
  })
})

describe('quarantineMode', () => {
  it('reads WORFY_QUARANTINE: unset or empty skips, run and only run, anything else is an error', () => {
    expect(quarantineMode(undefined)).toBe('skip')
    expect(quarantineMode('')).toBe('skip')
    expect(quarantineMode('run')).toBe('run')
    expect(quarantineMode('only')).toBe('only')
    expect(() => quarantineMode('yes')).toThrow('WORFY_QUARANTINE must be unset, run or only, not "yes"')
  })
})
