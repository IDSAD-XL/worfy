// A quarantine for flaky unit and contract tests (owner's decision 2026-10-28).
//
// A test that fails now and then for reasons outside the change under review — load, timing,
// the order of a console's output — gets an entry in test/quarantine/<id>.json and is declared with
// `quarantined('<id>')(name, fn, timeout)` in place of `it(name, fn, timeout)`. The entry says which
// test it is, on which platforms it is flaky, why, which ticket fixes it (`owner`), and until when
// (`until`, at most 14 days after `since`). There are at most 15 entries.
//
// What the helper does with such a test, by the environment variable WORFY_QUARANTINE:
//   unset or empty — the blocking runs (pnpm test, the gate, CI): the test is skipped, its name
//                    says so — "<name> (quarantine: <owner>, until <date>)" — and a line on stderr
//                    names it with its owner and exit date;
//   run            — every test runs, the quarantined ones under that name too;
//   only           — the same, meant for the run of the quarantined tests alone:
//                    WORFY_QUARANTINE=only pnpm test -t "\(quarantine: "
//                    (`-t` keeps only them: a variable cannot narrow vitest's run by itself).
// Nothing retries a failed test, in any run.
//
// The helper skips nothing when the entry is missing or broken, names another test, does not name
// this platform, or is past its exit date (the day after `until`, in UTC): then the test runs under
// its own name in every run, and fails it as before. test/unit/quarantine.test.ts is red over every
// such entry, naming it — fix the test, or extend the entry with the owner's word.
//
// Quarantine only a test whose failure is its own. A jsdom test that fails because it is the first
// of its file to import a slow module only hands that cost to the next test when it is skipped
// (test/unit/canvas.test.tsx: with its first test skipped, the second one ran past 5 s on a loaded
// Mac).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it as vitestIt, type TestFunction } from 'vitest'

export const MAX_ENTRIES = 15
export const MAX_DAYS = 14
// import.meta.dirname, not import.meta.url: under jsdom vitest gives the module an http: URL.
export const QUARANTINE_DIR = join(import.meta.dirname, 'quarantine')

const PLATFORMS = ['darwin', 'win32', 'linux'] as const
const DAY_MS = 24 * 60 * 60 * 1000
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TEST_FILE = /^test\/(?:unit|contract)\/.+\.test\.tsx?$/

export type TestFunctionLike = TestFunction

export interface QuarantineEntry {
  id: string
  file: string
  /** The full name as vitest prints it: the describe blocks and the test, joined by " > ". */
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
  if (!filled(r.file) || !TEST_FILE.test(r.file)) {
    problems.push(`${id}: file must be a unit or contract test file (test/unit/… or test/contract/…, .test.ts or .test.tsx)`)
  }
  if (!filled(r.test)) problems.push(`${id}: no test (the full name, as vitest prints it)`)
  if (
    !Array.isArray(r.platforms) ||
    r.platforms.length === 0 ||
    !r.platforms.every((p) => (PLATFORMS as readonly unknown[]).includes(p)) ||
    new Set(r.platforms).size !== r.platforms.length
  ) {
    problems.push(`${id}: platforms must be a non-empty list of ${PLATFORMS.join(', ')}`)
  }
  if (!filled(r.reason)) problems.push(`${id}: no reason`)
  if (!filled(r.owner)) problems.push(`${id}: no owner (the ticket that fixes the test)`)
  if (!isDate(r.since)) problems.push(`${id}: no since (the entry date, YYYY-MM-DD)`)
  if (!isDate(r.until)) problems.push(`${id}: no until (the exit date, YYYY-MM-DD)`)
  if (isDate(r.since) && isDate(r.until)) {
    const days = (Date.parse(r.until) - Date.parse(r.since)) / DAY_MS
    if (days < 0) problems.push(`${id}: until ${r.until} is before since ${r.since}`)
    if (days > MAX_DAYS) problems.push(`${id}: until ${r.until} is more than ${MAX_DAYS} days after since ${r.since}`)
  }
  if (problems.length > 0) return { problems }
  return { entry: { id, ...(r as Omit<QuarantineEntry, 'id'>) } }
}

/** Past its exit date: today, in UTC, is later than `until`. */
export function isExpired(entry: QuarantineEntry, now: Date): boolean {
  return now.toISOString().slice(0, 10) > entry.until
}

/** The files of test/quarantine/ (or of `dir`), sorted by name. */
export function readEntryFiles(dir: string): EntryFile[] {
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
const MARK = /quarantined\(\s*(['"])([^'"\n]+)\1\s*\)\(\s*/g

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
 * when it is in order. `testFiles` are the unit and contract test files whose marks are checked.
 */
export function quarantineProblems(
  entries: EntryFile[],
  options: { now: Date; readTestFile: (file: string) => string | undefined; testFiles: { file: string; text: string }[] },
): string[] {
  const problems: string[] = []
  if (entries.length > MAX_ENTRIES) {
    problems.push(`${entries.length} entries in test/quarantine/, at most ${MAX_ENTRIES}: fix a test before quarantining another`)
  }
  const seen = new Map<string, string>()
  for (const file of entries) {
    const parsed = parseEntry(file)
    if ('problems' in parsed) {
      problems.push(...parsed.problems)
      continue
    }
    const { entry } = parsed
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
      // shortcut: a describe name is looked for as plain text, so one written as a template or with
      // an escaped quote is not found; redo when such a describe holds a quarantined test.
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

export interface QuarantineOptions {
  /** vitest's `it` unless given. */
  it?: TestRegistrar
  /** The text of the entry `id`; test/quarantine/<id>.json unless given. */
  read?: (id: string) => string | undefined
  /** The value of WORFY_QUARANTINE; the variable itself unless the key is given. */
  env?: string | undefined
  platform?: NodeJS.Platform
  now?: Date
  /** Where the line about a skipped test goes; stderr unless given, written directly: vitest under an agent hides console output of passing files. */
  log?: (line: string) => void
}

/**
 * Declares a test that may be in quarantine: `quarantined('<id>')(name, fn, timeout)` in place of
 * `it(name, fn, timeout)`. Skipped only while its entry is valid, names this test and this
 * platform, has not expired, and WORFY_QUARANTINE is unset.
 */
export function quarantined(id: string, options: QuarantineOptions = {}) {
  const register = options.it ?? (vitestIt as TestRegistrar)
  const mode = quarantineMode('env' in options ? options.env : process.env.WORFY_QUARANTINE)
  const platform = options.platform ?? process.platform
  const now = options.now ?? new Date()
  const text = (options.read ?? readEntry)(id)
  return (name: string, fn: TestFunctionLike, timeout?: number): void => {
    const parsed = text === undefined ? undefined : parseEntry({ id, text })
    const entry = parsed !== undefined && 'entry' in parsed ? parsed.entry : undefined
    const active =
      entry !== undefined &&
      (entry.test === name || entry.test.endsWith(` > ${name}`)) &&
      (entry.platforms as string[]).includes(platform) &&
      !isExpired(entry, now)
    if (!active) {
      register(name, fn, timeout)
      return
    }
    const labelled = `${name} (quarantine: ${entry.owner}, until ${entry.until})`
    if (mode === 'skip') {
      // vitest's default reporter counts skipped tests but does not name them: this line does.
      const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
      log(`skip (quarantine: ${entry.owner}, until ${entry.until}): ${entry.file} > ${entry.test}`)
      register.skip(labelled, fn, timeout)
    } else register(labelled, fn, timeout)
  }
}
