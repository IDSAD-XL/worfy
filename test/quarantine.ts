// A quarantine for flaky unit, contract and e2e tests (owner's decisions 2026-10-28).
//
// A test that fails now and then for reasons outside the change under review — load, timing,
// the order of a console's output, a screenshot taken before the page has painted — gets an entry
// in test/quarantine/<id>.json and is declared with `quarantined('<id>')(name, fn, timeout)` in
// place of `it(name, fn, timeout)`; an e2e test, with `quarantined('<id>')(name, body)` of
// test/e2e/quarantine.ts in place of Playwright's `test(name, body)` (quarantinedDeclaration below).
// The entry says which runner runs the test (`runner`: vitest, the default, or playwright), which
// test it is, on which platforms it is flaky, why, which ticket fixes it (`owner`), and until when
// (`until`, at most 14 days after `since`; `since` is today's date in UTC, never a later one). There
// are at most 15 entries, vitest and Playwright ones together. This file holds the rules of both;
// test/e2e/quarantine.ts only hands it Playwright's `test`.
//
// Two kinds of entry share the folder, the mark and the helper (field `kind`; an entry without it is
// a quarantine one):
//   quarantine        — a flaky test, on any platforms, with its own owner ticket: at most 15
//                       entries, at most 14 days each (above);
//   windows-exception — a test red on Windows only, skipped there until Windows acceptance
//                       (worfy-windows 16; owner's decisions Q1 and Q9, 2026-10-31): `platforms` is
//                       exactly ["win32"], `owner` exactly "worfy-windows 117", the one ticket that
//                       owns them all; at most 30 entries, apart from the 15 of the quarantine, and
//                       `until` at most 45 days after `since` — acceptance plus 30 days, while the
//                       acceptance date is unknown; after it, each entry's `until` is set to
//                       acceptance plus 30 days, and extended only with the owner's word.
// Both behave alike below; the line, the annotation and the test's name say "windows exception" in
// place of "quarantine".
//
// What the helper does with such a test, by the environment variable WORFY_QUARANTINE:
//   unset or empty — the blocking runs (pnpm test, pnpm test:e2e, the gate, CI): the test is
//                    skipped, and a line on stderr names it with its owner and exit date; on GitHub
//                    Actions a second line, a ::warning workflow command, puts the same on the
//                    run's summary page. A vitest test's name says so too — "<name> (quarantine:
//                    <owner>, until <date>)", or "(windows exception: …)"; Playwright's list
//                    reporter names a skipped test itself;
//   run            — every test runs, the quarantined vitest ones under that name;
//   only           — vitest: the same, meant for the run of the quarantined tests alone:
//                    WORFY_QUARANTINE=only pnpm test -t "\((quarantine|windows exception): "
//                    (`-t` keeps only them: a variable cannot narrow vitest's run by itself);
//                    Playwright: the quarantined tests are declared with `test.only`, so
//                    WORFY_QUARANTINE=only pnpm test:e2e runs them alone.
// Nothing retries a failed test, except one retry in CI (test/flaky.ts); a test that passes only on
// that retry is printed as FLAKY and is a candidate for an entry here like any other flaky test.
//
// The helper skips nothing when the entry is missing or broken, names another test or another
// runner, does not name this platform, or is past its exit date (the day after `until`, in UTC): then the test runs under
// its own name in every run, and fails it as before. test/unit/quarantine.test.ts is red over every
// such entry, naming it — fix the test, or extend the entry with the owner's word.
//
// Quarantine only a test whose failure is its own. A jsdom test that fails because it is the first
// of its file to import a slow module only hands that cost to the next test when it is skipped
// (test/unit/canvas.test.tsx: with its first test skipped, the second one ran past 5 s on a loaded
// Mac).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it as vitestIt, type TestFunction } from 'vitest'

export const MAX_ENTRIES = 15
export const MAX_DAYS = 14
/** Windows exceptions: a cap and a stay of their own, apart from the quarantine's (owner's decision Q9, 2026-10-31). */
export const MAX_WINDOWS_EXCEPTIONS = 30
// Until Windows acceptance plus 30 days; the acceptance date is not known yet, so 45 days from `since`.
export const MAX_WINDOWS_EXCEPTION_DAYS = 45
/** The one ticket that owns every Windows exception. */
export const WINDOWS_EXCEPTION_OWNER = 'worfy-windows 117'
// import.meta.dirname, not import.meta.url: under jsdom vitest gives the module an http: URL.
export const QUARANTINE_DIR = join(import.meta.dirname, 'quarantine')

const PLATFORMS = ['darwin', 'win32', 'linux'] as const
const RUNNERS = ['vitest', 'playwright'] as const
const KINDS = ['quarantine', 'windows-exception'] as const
/** How a skipped test of each kind is named: in the line on stderr, the annotation and the vitest test's name. */
const LABEL = { quarantine: 'quarantine', 'windows-exception': 'windows exception' } as const
const DAY_MS = 24 * 60 * 60 * 1000
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** The test files of each runner, and how a problem names them. */
const TEST_FILES = {
  vitest: {
    pattern: /^test\/(?:unit|contract)\/.+\.test\.tsx?$/,
    what: 'a unit or contract test file (test/unit/… or test/contract/…, .test.ts or .test.tsx)',
  },
  playwright: { pattern: /^test\/e2e\/.+\.spec\.ts$/, what: 'an e2e spec file (test/e2e/…, .spec.ts)' },
} as const

export type TestFunctionLike = TestFunction
export type Runner = (typeof RUNNERS)[number]
export type Kind = (typeof KINDS)[number]

export interface QuarantineEntry {
  id: string
  /** A quarantine entry or a Windows exception; an entry without the field is a quarantine one. */
  kind: Kind
  /** Which runner runs the test; an entry without the field is a vitest one. */
  runner: Runner
  file: string
  /** The full name: the describe blocks and the test, joined by " > " (vitest prints it so; Playwright joins them by " › "). */
  test: string
  platforms: (typeof PLATFORMS)[number][]
  reason: string
  owner: string
  since: string
  until: string
}

/** One file of test/quarantine/: its name without .json, and its text. */
export interface EntryFile {
  id: string
  text: string
}

/** How vitest's `it` is called here; a test passes a stand-in. */
export interface TestRegistrar {
  (name: string, fn: TestFunctionLike, timeout?: number): void
  skip(name: string, fn: TestFunctionLike, timeout?: number): void
}

export type QuarantineMode = 'skip' | 'run' | 'only'

/** The mode of the run from WORFY_QUARANTINE; any other value is an error, not a silent default. */
export function quarantineMode(value: string | undefined): QuarantineMode {
  if (value === undefined || value === '') return 'skip'
  if (value === 'run' || value === 'only') return value
  throw new Error(`WORFY_QUARANTINE must be unset, run or only, not "${value}"`)
}

function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** The entry of one file, or what is wrong with it. Whether it has expired is not checked here. */
export function parseEntry({ id, text }: EntryFile): { entry: QuarantineEntry } | { problems: string[] } {
  if (!ID.test(id)) return { problems: [`${id}: the file name must be lower-case letters, digits and dashes, then .json`] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { problems: [`${id}: not a JSON object`] }
  const r = raw as Record<string, unknown>
  const problems: string[] = []
  const kind = r.kind ?? 'quarantine'
  if (!isKind(kind)) problems.push(`${id}: kind must be ${KINDS.join(' or ')} (an entry without it is a quarantine one)`)
  const runner = r.runner ?? 'vitest'
  if (!isRunner(runner)) problems.push(`${id}: runner must be ${RUNNERS.join(' or ')} (an entry without it is a vitest one)`)
  else if (!filled(r.file) || !TEST_FILES[runner].pattern.test(r.file)) {
    problems.push(`${id}: file must be ${TEST_FILES[runner].what}`)
  }
  if (!filled(r.test)) problems.push(`${id}: no test (the full name: the describe blocks and the test, joined by " > ")`)
  if (
    !Array.isArray(r.platforms) ||
    r.platforms.length === 0 ||
    !r.platforms.every((p) => (PLATFORMS as readonly unknown[]).includes(p)) ||
    new Set(r.platforms).size !== r.platforms.length
  ) {
    problems.push(`${id}: platforms must be a non-empty list of ${PLATFORMS.join(', ')}`)
  } else if (kind === 'windows-exception' && (r.platforms.length !== 1 || r.platforms[0] !== 'win32')) {
    problems.push(`${id}: a Windows exception must have platforms ["win32"] exactly`)
  }
  if (!filled(r.reason)) problems.push(`${id}: no reason`)
  if (!filled(r.owner)) problems.push(`${id}: no owner (the ticket that fixes the test)`)
  else if (kind === 'windows-exception' && r.owner !== WINDOWS_EXCEPTION_OWNER) {
    problems.push(`${id}: a Windows exception must have owner "${WINDOWS_EXCEPTION_OWNER}", not "${r.owner}"`)
  }
  if (!isDate(r.since)) problems.push(`${id}: no since (the entry date, YYYY-MM-DD)`)
  if (!isDate(r.until)) problems.push(`${id}: no until (the exit date, YYYY-MM-DD)`)
  if (isDate(r.since) && isDate(r.until)) {
    const days = (Date.parse(r.until) - Date.parse(r.since)) / DAY_MS
    if (days < 0) problems.push(`${id}: until ${r.until} is before since ${r.since}`)
    const maxDays = kind === 'windows-exception' ? MAX_WINDOWS_EXCEPTION_DAYS : MAX_DAYS
    if (days > maxDays) problems.push(`${id}: until ${r.until} is more than ${maxDays} days after since ${r.since}`)
  }
  if (problems.length > 0) return { problems }
  return { entry: { id, ...(r as Omit<QuarantineEntry, 'id' | 'kind' | 'runner'>), kind: kind as Kind, runner: runner as Runner } }
}

const isRunner = (value: unknown): value is Runner => (RUNNERS as readonly unknown[]).includes(value)
const isKind = (value: unknown): value is Kind => (KINDS as readonly unknown[]).includes(value)

/** The kind an entry file names, read without the rest of its rules: a broken entry counts in the cap of its kind. */
function kindOf(file: EntryFile): Kind {
  try {
    return (JSON.parse(file.text) as { kind?: unknown }).kind === 'windows-exception' ? 'windows-exception' : 'quarantine'
  } catch {
    return 'quarantine'
  }
}

const today = (now: Date) => now.toISOString().slice(0, 10)

/** Past its exit date: today, in UTC, is later than `until`. */
export function isExpired(entry: QuarantineEntry, now: Date): boolean {
  return today(now) > entry.until
}

/** The files of test/quarantine/ (or of `dir`), sorted by name. */
export function readEntryFiles(dir: string): EntryFile[] {
  // git keeps no empty folder: with the last entry gone, test/quarantine/ is gone too.
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ id: name.slice(0, -'.json'.length), text: readFileSync(join(dir, name), 'utf8') }))
}

function readEntry(id: string): string | undefined {
  if (!ID.test(id)) return undefined
  try {
    return readFileSync(join(QUARANTINE_DIR, `${id}.json`), 'utf8')
  } catch {
    return undefined
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The second argument, if any, is an e2e mark's `{ when: … }` on one line, without parentheses.
const MARK = /quarantined\(\s*(['"])([^'"\n]+)\1(?:\s*,[^()\n]*)?\s*\)\(\s*/g

/** The name literals that follow `quarantined('<id>')(` in a test file, as patterns over the name. */
function markedNames(text: string, id: string): RegExp[] {
  const names: RegExp[] = []
  for (const match of text.matchAll(MARK)) {
    if (match[2] !== id) continue
    const start = (match.index ?? 0) + match[0].length
    const quote = text[start]
    if (quote !== "'" && quote !== '"' && quote !== '`') continue
    let end = start + 1
    while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1
    const literal = text.slice(start + 1, end).replace(/\\(.)/g, '$1')
    // A template's `${…}` stands for any text.
    const pattern = quote === '`' ? literal.split(/\$\{[^}]*\}/).map(escapeRegExp).join('.+') : escapeRegExp(literal)
    names.push(new RegExp(`^(?:(.*) > )?${pattern}$`))
  }
  return names
}

/**
 * Everything wrong with the quarantine, one line per problem, each naming its entry or file: empty
 * when it is in order. `testFiles` are the unit and contract test files and the e2e spec files whose
 * marks are checked. The cap counts every entry, whatever its runner.
 */
export function quarantineProblems(
  entries: EntryFile[],
  options: { now: Date; readTestFile: (file: string) => string | undefined; testFiles: { file: string; text: string }[] },
): string[] {
  const problems: string[] = []
  const exceptions = entries.filter((file) => kindOf(file) === 'windows-exception').length
  const quarantines = entries.length - exceptions
  if (quarantines > MAX_ENTRIES) {
    problems.push(
      `${quarantines} entries in test/quarantine/, at most ${MAX_ENTRIES} for vitest and Playwright together: fix a test before quarantining another`,
    )
  }
  if (exceptions > MAX_WINDOWS_EXCEPTIONS) {
    problems.push(
      `${exceptions} Windows exceptions in test/quarantine/, at most ${MAX_WINDOWS_EXCEPTIONS}: fix a test before adding another`,
    )
  }
  const seen = new Map<string, string>()
  for (const file of entries) {
    const parsed = parseEntry(file)
    if ('problems' in parsed) {
      problems.push(...parsed.problems)
      continue
    }
    const { entry } = parsed
    // An entry date in the future would stretch the stay from `since` to `until` past today's.
    if (entry.since > today(options.now)) {
      problems.push(
        `${entry.id}: since ${entry.since} is later than today ${today(options.now)} (UTC): the entry date is the day the test is quarantined`,
      )
    }
    if (isExpired(entry, options.now)) {
      problems.push(
        `${entry.id}: expired on ${entry.until} (owner ${entry.owner}): fix the test, or extend the entry with the owner’s word`,
      )
    }
    const text = options.readTestFile(entry.file)
    const names = text === undefined ? [] : markedNames(text, entry.id)
    if (text === undefined || names.length === 0) {
      problems.push(`${entry.id}: ${entry.file} has no mark quarantined('${entry.id}')`)
    } else {
      // shortcut: a describe name is matched as plain text (no template, no escaped quote), redo when one gets an entry.
      const found = names.some((name) => {
        const match = name.exec(entry.test)
        return match !== null && (match[1] ?? '').split(' > ').every((block) => block === '' || text.includes(block))
      })
      if (!found) problems.push(`${entry.id}: ${entry.file} has no test "${entry.test}" under quarantined('${entry.id}')`)
    }
    const key = `${entry.file}\0${entry.test}`
    const first = seen.get(key)
    if (first !== undefined) problems.push(`${entry.id}: the same test as ${first}: one entry per test`)
    else seen.set(key, entry.id)
  }
  const fileOf = new Map<string, unknown>()
  for (const file of entries) {
    try {
      fileOf.set(file.id, (JSON.parse(file.text) as { file?: unknown }).file)
    } catch {
      // A broken entry is reported above; its marks have no entry.
    }
  }
  for (const { file, text } of options.testFiles) {
    for (const match of text.matchAll(MARK)) {
      const id = match[2] ?? ''
      if (fileOf.get(id) !== file) problems.push(`${file}: quarantined('${id}') has no entry for this file in test/quarantine/`)
    }
  }
  return problems
}

/** What the helper reads from the run; a test passes its own. */
export interface DeclareOptions {
  /** The text of the entry `id`; test/quarantine/<id>.json unless given. */
  read?: (id: string) => string | undefined
  /** The value of WORFY_QUARANTINE; the variable itself unless the key is given. */
  env?: string | undefined
  platform?: NodeJS.Platform
  now?: Date
  /** Where the line about a skipped test goes; stderr unless given, written directly: vitest under an agent hides console output of passing files. */
  log?: (line: string) => void
}

export interface QuarantineOptions extends DeclareOptions {
  /** vitest's `it` unless given. */
  it?: TestRegistrar
}

/**
 * The quarantine of a test of `runner` declared under `id`: given the test's name (vitest) or none
 * (Playwright: the entry alone says which test), the entry and the mode of the run while the entry
 * is valid, is one of this runner, names this test and this platform, and has not expired;
 * undefined otherwise. When the mode skips the test, it writes the line that names it.
 */
function quarantineOf(runner: Runner, id: string, options: DeclareOptions) {
  const mode = quarantineMode('env' in options ? options.env : process.env.WORFY_QUARANTINE)
  const platform = options.platform ?? process.platform
  const now = options.now ?? new Date()
  const text = (options.read ?? readEntry)(id)
  return (name?: string): { entry: QuarantineEntry; mode: QuarantineMode } | undefined => {
    const parsed = text === undefined ? undefined : parseEntry({ id, text })
    const entry = parsed !== undefined && 'entry' in parsed ? parsed.entry : undefined
    const active =
      entry !== undefined &&
      entry.runner === runner &&
      (name === undefined || entry.test === name || entry.test.endsWith(` > ${name}`)) &&
      (entry.platforms as string[]).includes(platform) &&
      !isExpired(entry, now)
    if (!active) return undefined
    if (mode === 'skip') {
      // vitest's default reporter counts skipped tests but does not name them: this line does.
      const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
      log(`skip (${LABEL[entry.kind]}: ${entry.owner}, until ${entry.until}): ${entry.file} > ${entry.test}`)
      // The github-actions reporters annotate failures only; this names the skip on the run's page.
      if (process.env.GITHUB_ACTIONS === 'true') {
        const message = `${entry.file} > ${entry.test} (owner ${entry.owner}, until ${entry.until})`
        log(`::warning title=${LABEL[entry.kind]}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`)
      }
    }
    return { entry, mode }
  }
}

/**
 * Declares a vitest test that may be in quarantine: `quarantined('<id>')(name, fn, timeout)` in
 * place of `it(name, fn, timeout)`. Skipped only while its entry is valid, is a vitest one, names
 * this test and this platform, has not expired, and WORFY_QUARANTINE is unset.
 */
export function quarantined(id: string, options: QuarantineOptions = {}) {
  const register = options.it ?? (vitestIt as TestRegistrar)
  const quarantine = quarantineOf('vitest', id, options)
  return (name: string, fn: TestFunctionLike, timeout?: number): void => {
    const active = quarantine(name)
    if (active === undefined) {
      register(name, fn, timeout)
      return
    }
    const labelled = `${name} (${LABEL[active.entry.kind]}: ${active.entry.owner}, until ${active.entry.until})`
    if (active.mode === 'skip') register.skip(labelled, fn, timeout)
    else register(labelled, fn, timeout)
  }
}

/** The ways an e2e spec declares a test: Playwright's `test`, `test.skip` and `test.only`; a test passes stand-ins. */
export interface E2eDeclarations<Declare> {
  test: Declare
  skip: Declare
  only: Declare
}

export interface E2eQuarantineOptions extends DeclareOptions {
  /** false: the test the spec declares is not the entry's (another round of a loop), and is declared as it is. */
  when?: boolean
}

/**
 * Which of `declare` an e2e spec declares the test of entry `id` with:
 * `quarantined('<id>')(name, body)` in place of `test(name, body)`. The spec calls the function
 * itself, never a wrapper: Playwright records the file and line that call it as the test's
 * location, which the reports and `file:line` on the command line go by. So the helper
 * does not see the name: the entry names the test, test/unit/quarantine.test.ts checks that the
 * spec has it, and a loop passes `when` for the round the entry names.
 *
 * `skip` while the entry is valid, is a Playwright one, names this platform, has not expired, and
 * WORFY_QUARANTINE is unset; `only` under WORFY_QUARANTINE=only, so that
 * `WORFY_QUARANTINE=only pnpm test:e2e` runs the quarantined tests alone — or every test, when no
 * entry names this platform; `test` otherwise. The name of the test is not changed: Playwright's
 * list reporter names a skipped test itself.
 */
export function quarantinedDeclaration<Declare>(id: string, declare: E2eDeclarations<Declare>, options: E2eQuarantineOptions = {}): Declare {
  if (options.when === false) return declare.test
  const active = quarantineOf('playwright', id, options)()
  if (active === undefined || active.mode === 'run') return declare.test
  return active.mode === 'skip' ? declare.skip : declare.only
}
