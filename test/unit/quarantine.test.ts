// The quarantine of flaky unit, contract and e2e tests (test/quarantine.ts, entries in
// test/quarantine/, the e2e helper in test/e2e/quarantine.ts).
//
// The first block checks the real entries and marks of the repository, vitest and Playwright ones
// alike: an entry without an owner or an exit date, one that stays longer than 14 days, one dated
// later than today, one past its exit date, one for a test or a spec file the repository does not
// have, a mark without an entry, more than 15 entries of both runners together — each makes this
// file red, with the name of the entry. A Windows exception has its own rules: more than 30 of them,
// one that stays longer than 45 days, names a platform other than win32 alone, or another owner
// than worfy-windows 117, is red too. The other blocks check the rules on fixtures, with a clock
// passed in, never the system clock, and the helper with a fake `it` in place of vitest's and of
// Playwright's `test`.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ENTRIES,
  MAX_WINDOWS_EXCEPTIONS,
  QUARANTINE_DIR,
  WINDOWS_EXCEPTION_OWNER,
  quarantineMode,
  quarantineProblems,
  quarantined,
  quarantinedDeclaration,
  readEntryFiles,
  type EntryFile,
  type TestFunctionLike,
} from '../quarantine'

const REPO = join(import.meta.dirname, '..', '..')
const THIS_FILE = 'test/unit/quarantine.test.ts'

/** Every unit and contract test file and every e2e spec file, as a path from the repository root with `/`. */
function testFiles(): string[] {
  return [
    { dir: 'test/unit', pattern: /\.test\.tsx?$/ },
    { dir: 'test/contract', pattern: /\.test\.tsx?$/ },
    { dir: 'test/e2e', pattern: /\.spec\.ts$/ },
  ].flatMap(({ dir, pattern }) =>
    (readdirSync(join(REPO, dir), { recursive: true, encoding: 'utf8' }) as string[])
      .filter((name) => pattern.test(name))
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

  it('looks for marks in the e2e spec files as well as in the unit and contract test files', () => {
    const files = testFiles()
    for (const pattern of [/^test\/unit\/.+\.test\.ts$/, /^test\/contract\/.+\.test\.ts$/, /^test\/e2e\/.+\.spec\.ts$/]) {
      expect(files.some((file) => pattern.test(file)), String(pattern)).toBe(true)
    }
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

// An e2e spec of the fixtures: a test at the top level, one inside a describe, one of a loop.
const E2E_FILE = 'test/e2e/fixture.spec.ts'
const E2E_TEXT = `import { test } from '@playwright/test'
import { quarantined } from './quarantine'
quarantined('menu')('the Canvas menu is drawn over the page', async () => {})
test.describe('zoom', () => {
  for (const zoom of [0.25, 0.5]) {
    quarantined('zoom-quarter', { when: zoom === 0.25 })(\`zoom \${zoom}: the page scales with its frame\`, async () => {})
  }
})
`

function e2eEntry(id: string, fields: Record<string, unknown> = {}): EntryFile {
  return entry(id, { runner: 'playwright', file: E2E_FILE, test: 'the Canvas menu is drawn over the page', platforms: ['darwin'], ...fields })
}

const zoomEntry = e2eEntry('zoom-quarter', { test: 'zoom > zoom 0.25: the page scales with its frame' })

function problemsOf(entries: EntryFile[], options: { now?: Date; text?: string; e2eText?: string } = {}): string[] {
  const text = options.text ?? FIXTURE_TEXT
  const e2eText = options.e2eText ?? ''
  const files: Record<string, string> = { [FIXTURE_FILE]: text, [E2E_FILE]: e2eText }
  return quarantineProblems(entries, {
    now: options.now ?? NOW,
    readTestFile: (file) => files[file],
    testFiles: Object.entries(files).map(([file, fileText]) => ({ file, text: fileText })),
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
      `${MAX_ENTRIES + 1} entries in test/quarantine/, at most ${MAX_ENTRIES} for vitest and Playwright together: fix a test before quarantining another`,
    ])
  })
})

describe('quarantineProblems: e2e entries', () => {
  it('passes valid e2e entries next to vitest ones: at the top level, inside a describe, a round of a loop', () => {
    expect(problemsOf([entry('watcher-event'), roundsEntry, e2eEntry('menu'), zoomEntry], { e2eText: E2E_TEXT })).toEqual([])
  })

  it('an e2e entry for a test the spec does not have, or for a spec that does not exist, is red', () => {
    expect(
      problemsOf([e2eEntry('menu', { test: 'the Canvas menu is drawn under the page' }), zoomEntry, entry('watcher-event'), roundsEntry], {
        e2eText: E2E_TEXT,
      }),
    ).toEqual([`menu: ${E2E_FILE} has no test "the Canvas menu is drawn under the page" under quarantined('menu')`])
    expect(problemsOf([e2eEntry('menu', { test: 'zoom > zoom 0.25: the page scales with its frame' })], { e2eText: E2E_TEXT })).toContain(
      `menu: ${E2E_FILE} has no test "zoom > zoom 0.25: the page scales with its frame" under quarantined('menu')`,
    )
    expect(problemsOf([e2eEntry('menu', { file: 'test/e2e/gone.spec.ts' }), entry('watcher-event'), roundsEntry])).toEqual([
      "menu: test/e2e/gone.spec.ts has no mark quarantined('menu')",
    ])
  })

  it('a mark in an e2e spec without an entry is red', () => {
    expect(problemsOf([e2eEntry('menu'), entry('watcher-event'), roundsEntry], { e2eText: E2E_TEXT })).toEqual([
      `${E2E_FILE}: quarantined('zoom-quarter') has no entry for this file in test/quarantine/`,
    ])
  })

  it('an e2e entry must name an e2e spec, a vitest entry a unit or contract test file, and the runner must be known', () => {
    expect(problemsOf([e2eEntry('menu', { file: FIXTURE_FILE }), entry('watcher-event'), roundsEntry])[0]).toBe(
      'menu: file must be an e2e spec file (test/e2e/…, .spec.ts)',
    )
    expect(problemsOf([entry('watcher-event', { file: E2E_FILE }), roundsEntry])[0]).toBe(
      'watcher-event: file must be a unit or contract test file (test/unit/… or test/contract/…, .test.ts or .test.tsx)',
    )
    expect(problemsOf([entry('watcher-event', { runner: 'jest' }), roundsEntry])[0]).toBe(
      'watcher-event: runner must be vitest or playwright (an entry without it is a vitest one)',
    )
    expect(problemsOf([entry('watcher-event', { runner: 'vitest' }), roundsEntry])).toEqual([])
  })

  it('an e2e entry past its exit date is red with its name', () => {
    expect(problemsOf([e2eEntry('menu'), zoomEntry, entry('watcher-event'), roundsEntry], { e2eText: E2E_TEXT, now: new Date('2026-11-12T00:00:00Z') })).toContain(
      'menu: expired on 2026-11-11 (owner worfy-throughput 23): fix the test, or extend the entry with the owner’s word',
    )
  })

  it(`the cap of ${MAX_ENTRIES} counts vitest and e2e entries together`, () => {
    const half = Math.ceil(MAX_ENTRIES / 2)
    const marks = (count: number, start: number) =>
      Array.from({ length: count }, (_, n) => `quarantined('e${start + n}')('test ${start + n}', () => {})`).join('\n')
    const vitestEntries = Array.from({ length: half }, (_, n) => entry(`e${n}`, { test: `test ${n}` }))
    const e2eEntries = (count: number) =>
      Array.from({ length: count }, (_, n) => e2eEntry(`e${half + n}`, { test: `test ${half + n}` }))
    const options = (e2eCount: number) => ({ text: marks(half, 0), e2eText: marks(e2eCount, half) })
    // Neither runner alone is over the cap, both together are by one.
    expect(problemsOf([...vitestEntries, ...e2eEntries(MAX_ENTRIES - half)], options(MAX_ENTRIES - half))).toEqual([])
    expect(problemsOf([...vitestEntries, ...e2eEntries(MAX_ENTRIES - half + 1)], options(MAX_ENTRIES - half + 1))).toEqual([
      `${MAX_ENTRIES + 1} entries in test/quarantine/, at most ${MAX_ENTRIES} for vitest and Playwright together: fix a test before quarantining another`,
    ])
  })
})

/** A Windows exception of the fixtures: a test red on Windows only, with the one shared owner. */
function exceptionEntry(id: string, fields: Record<string, unknown> = {}): EntryFile {
  return entry(id, { kind: 'windows-exception', owner: WINDOWS_EXCEPTION_OWNER, until: '2026-11-27', ...fields })
}

describe('quarantineProblems: Windows exceptions', () => {
  it('passes a Windows exception that stays 30 days, and one that stays exactly 45; 46 days are red', () => {
    expect(problemsOf([exceptionEntry('watcher-event'), roundsEntry])).toEqual([])
    expect(problemsOf([exceptionEntry('watcher-event', { until: '2026-12-12' }), roundsEntry])).toEqual([])
    expect(problemsOf([exceptionEntry('watcher-event', { until: '2026-12-13' }), roundsEntry])).toEqual([
      'watcher-event: until 2026-12-13 is more than 45 days after since 2026-10-28',
    ])
  })

  it('the longer stay belongs to the Windows exception only: a quarantine entry of 30 days is red, with or without its kind', () => {
    const red = ['watcher-event: until 2026-11-27 is more than 14 days after since 2026-10-28']
    expect(problemsOf([entry('watcher-event', { until: '2026-11-27' }), roundsEntry])).toEqual(red)
    expect(problemsOf([entry('watcher-event', { kind: 'quarantine', until: '2026-11-27' }), roundsEntry])).toEqual(red)
    expect(problemsOf([entry('watcher-event', { kind: 'quarantine' }), roundsEntry])).toEqual([])
  })

  it('an unknown kind is red', () => {
    expect(problemsOf([entry('watcher-event', { kind: 'windows' }), roundsEntry])).toEqual([
      'watcher-event: kind must be quarantine or windows-exception (an entry without it is a quarantine one)',
    ])
  })

  it(`a Windows exception names win32 alone, and its owner is ${WINDOWS_EXCEPTION_OWNER}`, () => {
    const platforms = `watcher-event: a Windows exception must have platforms ["win32"] exactly`
    expect(problemsOf([exceptionEntry('watcher-event', { platforms: ['darwin'] }), roundsEntry])).toEqual([platforms])
    expect(problemsOf([exceptionEntry('watcher-event', { platforms: ['win32', 'linux'] }), roundsEntry])).toEqual([platforms])
    expect(problemsOf([exceptionEntry('watcher-event', { owner: 'worfy-polish 47' }), roundsEntry])).toEqual([
      `watcher-event: a Windows exception must have owner "${WINDOWS_EXCEPTION_OWNER}", not "worfy-polish 47"`,
    ])
    // A quarantine entry keeps any owner and any platforms.
    expect(problemsOf([entry('watcher-event', { platforms: ['darwin', 'linux'], owner: 'worfy-polish 47' }), roundsEntry])).toEqual([])
  })

  it('a Windows exception past its exit date is red with its name', () => {
    expect(problemsOf([exceptionEntry('watcher-event'), roundsEntry], { now: new Date('2026-11-28T00:00:00Z') })).toContain(
      `watcher-event: expired on 2026-11-27 (owner ${WINDOWS_EXCEPTION_OWNER}): fix the test, or extend the entry with the owner’s word`,
    )
  })

  const marks = (count: number) => Array.from({ length: count }, (_, n) => `quarantined('e${n}')('test ${n}', () => {})`).join('\n')
  const exceptions = (count: number, start = 0) =>
    Array.from({ length: count }, (_, n) => exceptionEntry(`e${start + n}`, { test: `test ${start + n}` }))
  const quarantines = (count: number, start: number) =>
    Array.from({ length: count }, (_, n) => entry(`e${start + n}`, { test: `test ${start + n}` }))

  it(`more than ${MAX_WINDOWS_EXCEPTIONS} Windows exceptions are red; ${MAX_WINDOWS_EXCEPTIONS} pass`, () => {
    expect(problemsOf(exceptions(MAX_WINDOWS_EXCEPTIONS), { text: marks(MAX_WINDOWS_EXCEPTIONS) })).toEqual([])
    expect(problemsOf(exceptions(MAX_WINDOWS_EXCEPTIONS + 1), { text: marks(MAX_WINDOWS_EXCEPTIONS + 1) })).toEqual([
      `${MAX_WINDOWS_EXCEPTIONS + 1} Windows exceptions in test/quarantine/, at most ${MAX_WINDOWS_EXCEPTIONS}: fix a test before adding another`,
    ])
  })

  it(`Windows exceptions do not count in the ${MAX_ENTRIES} quarantine entries, nor quarantine entries in the ${MAX_WINDOWS_EXCEPTIONS} exceptions`, () => {
    const all = MAX_WINDOWS_EXCEPTIONS + MAX_ENTRIES
    expect(problemsOf([...exceptions(MAX_WINDOWS_EXCEPTIONS), ...quarantines(MAX_ENTRIES, MAX_WINDOWS_EXCEPTIONS)], { text: marks(all) })).toEqual([])
    expect(problemsOf([...exceptions(MAX_WINDOWS_EXCEPTIONS), ...quarantines(MAX_ENTRIES + 1, MAX_WINDOWS_EXCEPTIONS)], { text: marks(all + 1) })).toEqual([
      `${MAX_ENTRIES + 1} entries in test/quarantine/, at most ${MAX_ENTRIES} for vitest and Playwright together: fix a test before quarantining another`,
    ])
    // A broken entry counts in the kind it names.
    const broken = { id: `e${all}`, text: JSON.stringify({ kind: 'windows-exception' }) }
    expect(problemsOf([...exceptions(MAX_WINDOWS_EXCEPTIONS), ...quarantines(MAX_ENTRIES, MAX_WINDOWS_EXCEPTIONS), broken], { text: marks(all) })).toContain(
      `${MAX_WINDOWS_EXCEPTIONS + 1} Windows exceptions in test/quarantine/, at most ${MAX_WINDOWS_EXCEPTIONS}: fix a test before adding another`,
    )
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

  it('says "windows exception", not "quarantine", in the line, the annotation and the name of a skipped Windows exception', () => {
    const files = { 'watcher-event': exceptionEntry('watcher-event') }
    const until = `${WINDOWS_EXCEPTION_OWNER}, until 2026-11-27`
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    expect(declare({ files })).toEqual([
      { how: 'log', name: `skip (windows exception: ${until}): ${FIXTURE_FILE} > the watcher > ${name}` },
      {
        how: 'log',
        name: `::warning title=windows exception::${FIXTURE_FILE} > the watcher > ${name} (owner ${until})`,
      },
      { how: 'skip', name: `${name} (windows exception: ${until})`, timeout: 30_000 },
    ])
    expect(declare({ files, env: 'run' })).toEqual([{ how: 'run', name: `${name} (windows exception: ${until})`, timeout: 30_000 }])
    expect(declare({ files, platform: 'darwin' })).toEqual([{ how: 'run', name, timeout: 30_000 }])
  })

  it('skips each Windows exception of this repository on win32 alone: on the Mac and on Linux it runs', () => {
    const exceptions = readEntryFiles(QUARANTINE_DIR).filter((file) => (JSON.parse(file.text) as { kind?: string }).kind === 'windows-exception')
    expect(exceptions.map((file) => file.id)).toEqual(
      expect.arrayContaining(['terminal-windows-close-no-console-host', 'workflow-branches-gone-worktree-then-repository']),
    )
    for (const file of exceptions) {
      const raw = JSON.parse(file.text) as { test: string; since: string }
      const testName = raw.test.split(' > ').at(-1) ?? ''
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        const fake = fakeIt()
        quarantined(file.id, { it: fake.it, env: undefined, platform, now: new Date(`${raw.since}T12:00:00Z`), log: () => {} })(testName, () => {})
        expect(fake.calls.map((call) => call.how), `${file.id} on ${platform}`).toEqual([platform === 'win32' ? 'skip' : 'run'])
      }
    }
  })

  it('reads its entry from test/quarantine/ by default, for either runner', () => {
    for (const file of readEntryFiles(QUARANTINE_DIR)) {
      const raw = JSON.parse(file.text) as { runner?: string; test: string; platforms: NodeJS.Platform[]; since: string }
      const fake = fakeIt()
      const options = { env: undefined, platform: raw.platforms[0], now: new Date(`${raw.since}T12:00:00Z`), log: (line: string) => fake.calls.push({ how: 'log', name: line }) }
      if (raw.runner === 'playwright') {
        expect(quarantinedDeclaration(file.id, PLAYWRIGHT, options), file.id).toBe('test.skip')
        expect(fake.calls.map((call) => call.how), file.id).toEqual(['log'])
      } else {
        quarantined(file.id, { it: fake.it, ...options })(raw.test.split(' > ').at(-1) ?? '', () => {})
        expect(fake.calls.map((call) => call.how), file.id).toEqual(['log', 'skip'])
      }
    }
  })
})

/** Stand-ins for Playwright's `test`, `test.skip` and `test.only`: the helper gives one of them back. */
const PLAYWRIGHT = { test: 'test', skip: 'test.skip', only: 'test.only' }

describe('quarantinedDeclaration(): which Playwright declaration an e2e test gets', () => {
  const files: Record<string, EntryFile> = {
    menu: e2eEntry('menu'),
    broken: e2eEntry('broken', { owner: '' }),
    'watcher-event': entry('watcher-event'),
    'menu-windows': e2eEntry('menu-windows', { kind: 'windows-exception', owner: WINDOWS_EXCEPTION_OWNER, platforms: ['win32'], until: '2026-11-27' }),
  }
  const name = 'the Canvas menu is drawn over the page'

  beforeEach(() => {
    vi.stubEnv('GITHUB_ACTIONS', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function declare(options: { id?: string; env?: string; platform?: NodeJS.Platform; now?: Date; when?: boolean } = {}) {
    const lines: string[] = []
    const declaration = quarantinedDeclaration(options.id ?? 'menu', PLAYWRIGHT, {
      read: (id) => files[id]?.text,
      env: options.env,
      platform: options.platform ?? 'darwin',
      now: options.now ?? NOW,
      log: (line) => lines.push(line),
      ...('when' in options ? { when: options.when } : {}),
    })
    return { declaration, lines }
  }

  it('skips the test of an active entry, and names it on stderr, on GitHub Actions in a warning annotation too', () => {
    const line = `skip (quarantine: worfy-throughput 23, until 2026-11-11): ${E2E_FILE} > ${name}`
    expect(declare()).toEqual({ declaration: 'test.skip', lines: [line] })
    expect(declare({ env: '' })).toEqual({ declaration: 'test.skip', lines: [line] })
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    expect(declare()).toEqual({
      declaration: 'test.skip',
      lines: [line, `::warning title=quarantine::${E2E_FILE} > ${name} (owner worfy-throughput 23, until 2026-11-11)`],
    })
  })

  it('names a skipped Windows exception "windows exception" on stderr and in the annotation, on win32 alone', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    expect(declare({ id: 'menu-windows', platform: 'win32' })).toEqual({
      declaration: 'test.skip',
      lines: [
        `skip (windows exception: ${WINDOWS_EXCEPTION_OWNER}, until 2026-11-27): ${E2E_FILE} > ${name}`,
        `::warning title=windows exception::${E2E_FILE} > ${name} (owner ${WINDOWS_EXCEPTION_OWNER}, until 2026-11-27)`,
      ],
    })
    expect(declare({ id: 'menu-windows' })).toEqual({ declaration: 'test', lines: [] })
  })

  it('declares the test plainly under WORFY_QUARANTINE=run, and alone (test.only) under =only, without a line', () => {
    expect(declare({ env: 'run' })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ env: 'only' })).toEqual({ declaration: 'test.only', lines: [] })
  })

  it('declares the test plainly past the exit date, on another platform, or in a round the entry does not name', () => {
    expect(declare({ now: new Date('2026-11-12T00:00:00Z') })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ now: new Date('2026-11-11T23:59:59Z') }).declaration).toBe('test.skip')
    expect(declare({ platform: 'win32' })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ when: false })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ when: false, env: 'only' })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ when: true }).declaration).toBe('test.skip')
  })

  it('declares the test plainly when its entry is missing, broken, or a vitest one; a Playwright entry skips no vitest test', () => {
    expect(declare({ id: 'gone' })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ id: 'broken' })).toEqual({ declaration: 'test', lines: [] })
    expect(declare({ id: 'watcher-event', platform: 'win32' })).toEqual({ declaration: 'test', lines: [] })
    const fake = fakeIt()
    quarantined('menu', { it: fake.it, read: (id) => files[id]?.text, env: undefined, platform: 'darwin', now: NOW, log: () => {} })(name, () => {})
    expect(fake.calls).toEqual([{ how: 'run', name, timeout: undefined }])
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
