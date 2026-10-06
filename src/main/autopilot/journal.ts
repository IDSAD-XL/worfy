// The Autopilot run journal on disk: `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`, one file per run.
// The format, and how an observer appends to it without worfy code, is described at the top of
// src/shared/autopilot/journal.ts; this module only opens, appends to, lists and reads the files.
//
// worfy writes nowhere but its data folder (ADR-0005): not to a Project's repository, not to
// ~/.claude. A line is appended with one appendFile call (O_APPEND), so a line the observer
// appends from outside lands between two lines of worfy, never inside one.
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  RUN_ID_SUFFIX_LENGTH,
  formatJournalLine,
  isRunId,
  journalFileName,
  makeRunId,
  parseJournal,
  type JournalEvent,
  type JournalEventFields,
  type ParsedJournal,
} from '../../shared/autopilot/journal'
import { dataRoot } from '../storage/paths'

type Env = Readonly<Record<string, string | undefined>>

export interface JournalOptions {
  /** Where WORFY_DATA_DIR is read from; tests pass their own. */
  env?: Env
  /** Clock for the run id and each line's `at`; tests pass a fixed one. */
  now?: () => Date
  /** The hex digits that end a run id; tests pass fixed ones. */
  suffix?: () => string
}

/** The folder of the run journals. */
export function journalDir(env: Env = process.env): string {
  return join(dataRoot(env), 'autopilot')
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

const randomSuffix = (): string => randomBytes(RUN_ID_SUFFIX_LENGTH / 2).toString('hex')

/** How many run ids to try when the file of a new one already exists (same millisecond and suffix). */
const OPEN_ATTEMPTS = 5

/** One open run: appends its events to its file, in the order append() was called. */
export class RunJournal {
  /** The previous append; the next one starts after it settles, so lines keep the call order. */
  private tail: Promise<void> = Promise.resolve()

  constructor(
    readonly run: string,
    readonly file: string,
    readonly project: string,
    readonly epic: string,
    private readonly now: () => Date,
  ) {}

  /**
   * Appends one event as one line. Rejects, and writes nothing, when the event is outside the
   * format; a failed write rejects this call only, the next append still runs.
   */
  append(fields: JournalEventFields): Promise<void> {
    let line: string
    try {
      line = formatJournalLine({
        ...fields,
        at: this.now().toISOString(),
        run: this.run,
        project: this.project,
        epic: this.epic,
      } as JournalEvent)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const write = this.tail.then(() => appendFile(this.file, line))
    this.tail = write.catch(() => undefined)
    return write
  }
}

/** Starts a new run of `epic` in `project`: creates its file with the `run-started` line. */
export async function openRun(start: { project: string; epic: string }, options: JournalOptions = {}): Promise<RunJournal> {
  const now = options.now ?? (() => new Date())
  const suffix = options.suffix ?? randomSuffix
  const dir = journalDir(options.env)
  await mkdir(dir, { recursive: true })

  for (let attempt = 1; ; attempt++) {
    const at = now()
    const run = makeRunId(at, suffix())
    const file = join(dir, journalFileName(run))
    const line = formatJournalLine({ at: at.toISOString(), run, project: start.project, epic: start.epic, kind: 'run-started' })
    try {
      // 'wx': a new run never appends to the file of another one.
      await writeFile(file, line, { flag: 'wx' })
    } catch (error) {
      if (isCode(error, 'EEXIST') && attempt < OPEN_ATTEMPTS) continue
      throw error
    }
    return new RunJournal(run, file, start.project, start.epic, now)
  }
}

export interface RunSummary {
  run: string
  project: string
  epic: string
  /** `at` of the run's first readable line, normally `run-started`. */
  startedAt: string
  file: string
}

/** Reads a file, or undefined when it does not exist (also when it was removed just now). */
async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/**
 * The runs of a Project, newest first. A file without a single readable line belongs to no
 * Project and is left out. Reading never creates the folder.
 */
export async function listRuns(project: string, options: Pick<JournalOptions, 'env'> = {}): Promise<RunSummary[]> {
  const dir = journalDir(options.env)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isCode(error, 'ENOENT')) return []
    throw error
  }

  const runs = names.filter((name) => name.endsWith('.jsonl') && isRunId(name.slice(0, -'.jsonl'.length))).map((name) => name.slice(0, -'.jsonl'.length))
  const summaries = await Promise.all(
    runs.map(async (run): Promise<RunSummary | undefined> => {
      const file = join(dir, journalFileName(run))
      const text = await readIfPresent(file)
      if (text === undefined) return undefined
      const { events } = parseJournal(text)
      const first = events.find((event) => event.kind === 'run-started') ?? events[0]
      if (!first) return undefined
      return { run, project: first.project, epic: first.epic, startedAt: first.at, file }
    }),
  )
  return summaries
    .filter((summary): summary is RunSummary => summary !== undefined && summary.project === project)
    .sort((a, b) => (a.run < b.run ? 1 : a.run > b.run ? -1 : 0))
}

/** One run's events and the number of skipped lines; undefined when the run has no file. */
export async function readRun(run: string, options: Pick<JournalOptions, 'env'> = {}): Promise<ParsedJournal | undefined> {
  if (!isRunId(run)) throw new Error(`not a run id: ${JSON.stringify(run)}`)
  const text = await readIfPresent(join(journalDir(options.env), journalFileName(run)))
  return text === undefined ? undefined : parseJournal(text)
}
