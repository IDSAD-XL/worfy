// The Autopilot run journal on disk (src/main/autopilot/journal.ts) over a temporary
// WORFY_DATA_DIR: one line per event, one file per run, a line appended from outside, the list of
// a Project's runs, and no write anywhere but the data folder.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESTIMATE_RUNS, journalDir, listRuns, openRun, readRecentRuns, readRun } from '../../src/main/autopilot/journal'
import { JOURNAL_EVENT_KINDS, type JournalEventFields } from '../../src/shared/autopilot/journal'
import { removeTestTree } from '../remove'

// node:fs/promises as it is, except that readFile and appendFile are spies: two tests make one
// call fail, the way a file removed mid-listing or a full disk would.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), appendFile: vi.fn(actual.appendFile) }
})
const fsp = await import('node:fs/promises')

const PROJECT = 'Auction-1a2b3c4d'
const OTHER_PROJECT = 'worfy-5e6f7a8b'
const EPIC = 'worfy-daily'

let scratch: string
let dataDir: string
let projectDir: string
let claudeHome: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-journal-')))
  dataDir = join(scratch, 'data')
  projectDir = join(scratch, 'project')
  claudeHome = join(scratch, 'claude-home')
  // The module reads WORFY_DATA_DIR from process.env through dataRoot(), as in the app.
  vi.stubEnv('WORFY_DATA_DIR', dataDir)
  vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(fsp.readFile).mockClear()
  vi.mocked(fsp.appendFile).mockClear()
  removeTestTree(scratch)
})

/** A clock that returns `start`, then one second later on every call. */
function ticking(start: number): () => Date {
  let next = start
  return () => {
    const date = new Date(next)
    next += 1000
    return date
  }
}

const suffixes = (...values: string[]): (() => string) => {
  const queue = [...values]
  return () => queue.shift() ?? 'ffffff'
}

const T0 = Date.UTC(2026, 9, 6, 1, 0)
const rawLines = (file: string): string[] => readFileSync(file, 'utf8').split('\n').slice(0, -1)

/** One event of every kind after run-started, as Autopilot will append them. */
const appended: JournalEventFields[] = [
  { kind: 'harness-behind', harness: '0.1.0+abcdef1', main: 'origin/main', commits: 2 },
  { kind: 'wave-started', wave: 1, tickets: ['01', '02'] },
  { kind: 'narrow-round', ticket: '02', outcome: 'rejected', text: 'NARROW: REJECTED: src/a.ts:1 still open' },
  { kind: 'wave-finished', wave: 1, tickets: ['01', '02'] },
  { kind: 'limits-hit', window: 'five_hour', resetsAt: '2026-10-06T06:00:00.000Z' },
  { kind: 'waiting-until', until: '2026-10-06T06:01:00.000Z' },
  { kind: 'resumed' },
  { kind: 'session-error', session: 'abc-123', message: 'spawn ENOENT' },
  { kind: 'refused-dialog', session: null, what: 'AskUserQuestion' },
  { kind: 'human-input', source: 'worfy', what: 'Send queued' },
  { kind: 'background-tasks', tasks: [] },
  { kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01'] },
  { kind: 'gate-queue', text: '/worfy:gate-queue' },
  { kind: 'run-stopped', reason: 'user-stop', tasks: [{ id: 'task-1', type: 'local_agent', description: 'Implement 01' }] },
  { kind: 'orchestrator-returned' },
  { kind: 'tasks-killed', reason: 'app-quit', tasks: [{ id: 'task-2', type: 'local_bash', description: null }] },
]

describe('openRun and append', () => {
  it('writes every kind of event as one JSON line in <WORFY_DATA_DIR>/autopilot/<run>.jsonl', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0), suffix: suffixes('a1b2c3') })
    for (const fields of appended) await journal.append(fields)

    expect(journal.run).toBe('2026-10-06T01-00-00-000Z-a1b2c3')
    expect(journal.file).toBe(join(dataDir, 'autopilot', '2026-10-06T01-00-00-000Z-a1b2c3.jsonl'))
    expect(journalDir()).toBe(join(dataDir, 'autopilot'))

    const lines = rawLines(journal.file).map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map((line) => line.kind)).toEqual([...JOURNAL_EVENT_KINDS])
    lines.forEach((line, index) => {
      expect(line).toEqual({
        ...(index === 0 ? { kind: 'run-started' } : appended[index - 1]),
        at: new Date(T0 + index * 1000).toISOString(),
        run: journal.run,
        project: PROJECT,
        epic: EPIC,
      })
    })
    expect(await readRun(journal.run)).toEqual({ events: lines, skipped: 0 })
  })

  it('opens two runs as two files', async () => {
    const options = { now: ticking(T0), suffix: suffixes('aaaaaa', 'bbbbbb') }
    const first = await openRun({ project: PROJECT, epic: EPIC }, options)
    const second = await openRun({ project: PROJECT, epic: EPIC }, options)
    await first.append({ kind: 'run-stopped', reason: 'stopped by the user' })
    await second.append({ kind: 'resumed' })

    expect(first.file).not.toBe(second.file)
    expect(readdirSync(join(dataDir, 'autopilot')).sort()).toEqual([`${first.run}.jsonl`, `${second.run}.jsonl`])
    expect(rawLines(first.file).map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(['run-started', 'run-stopped'])
    expect(rawLines(second.file).map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(['run-started', 'resumed'])
  })

  it('never reuses the file of an existing run: the same id is retried with a new suffix', async () => {
    const now = () => new Date(T0)
    const first = await openRun({ project: PROJECT, epic: EPIC }, { now, suffix: suffixes('abcabc') })
    const second = await openRun({ project: PROJECT, epic: EPIC }, { now, suffix: suffixes('abcabc', 'defdef') })
    expect(second.run).toBe('2026-10-06T01-00-00-000Z-defdef')
    expect(rawLines(first.file)).toHaveLength(1)
  })

  it('keeps the call order of appends that were not awaited one by one', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    const waves = Array.from({ length: 40 }, (_, index) => index + 1)
    await Promise.all(waves.map((wave) => journal.append({ kind: 'wave-started', wave, tickets: [] })))
    const written = rawLines(journal.file).slice(1).map((line) => (JSON.parse(line) as { wave: number }).wave)
    expect(written).toEqual(waves)
  })

  it('a failed write rejects that append only; the next one is still written', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    vi.mocked(fsp.appendFile).mockRejectedValueOnce(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }))
    const failed = journal.append({ kind: 'resumed' })
    const next = journal.append({ kind: 'run-stopped', reason: 'epic-done' })
    await expect(failed).rejects.toThrow(/no space/)
    await next
    expect(rawLines(journal.file).map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(['run-started', 'run-stopped'])
  })

  it('refuses an event outside the format and writes the parsed event, not the raw one', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    await expect(journal.append({ kind: 'coffee-break' } as unknown as JournalEventFields)).rejects.toThrow(/journal/)
    await expect(journal.append({ kind: 'wave-started', wave: 'one', tickets: [] } as unknown as JournalEventFields)).rejects.toThrow(/journal/)
    // Undeclared keys are dropped, and the common fields cannot be overridden by the producer.
    await journal.append({ kind: 'run-stopped', reason: 'epic-done', secret: 'x', project: 'elsewhere' } as unknown as JournalEventFields)

    const lines = rawLines(journal.file)
    expect(lines).toHaveLength(2)
    const last = JSON.parse(lines[1]!) as Record<string, unknown>
    expect(last).toEqual({ kind: 'run-stopped', reason: 'epic-done', at: new Date(T0 + 3000).toISOString(), run: journal.run, project: PROJECT, epic: EPIC })
  })
})

describe('readRun', () => {
  it('reads a human-input line an observer appended between two lines of worfy, in file order', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    await journal.append({ kind: 'wave-started', wave: 1, tickets: ['01'] })
    // The observer: a shell append, by the format in the comment of the shared module.
    appendFileSync(
      journal.file,
      `{"kind":"human-input","source":"observer","what":"clicked Allow on a Keychain dialog","at":"2026-10-06T04:00:30+03:00","run":"${journal.run}","project":"${PROJECT}","epic":"${EPIC}"}\n`,
    )
    await journal.append({ kind: 'wave-finished', wave: 1, tickets: ['01'] })

    const parsed = await readRun(journal.run)
    expect(parsed?.skipped).toBe(0)
    expect(parsed?.events.map((event) => (event.kind === 'human-input' ? `human-input:${event.source}` : event.kind))).toEqual([
      'run-started',
      'wave-started',
      'human-input:observer',
      'wave-finished',
    ])
  })

  it('reads a file whose last line was cut off and one with an unknown kind, and counts the skipped lines', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    appendFileSync(journal.file, `{"kind":"coffee-break","at":"2026-10-06T01:00:01Z","run":"${journal.run}","project":"${PROJECT}","epic":"${EPIC}"}\n`)
    await journal.append({ kind: 'resumed' })
    appendFileSync(journal.file, `{"kind":"run-stopped","reason":"ep`)

    const parsed = await readRun(journal.run)
    expect(parsed?.events.map((event) => event.kind)).toEqual(['run-started', 'resumed'])
    expect(parsed?.skipped).toBe(2)
  })

  it('reads a run-stopping line and skips, and counts, one without inWork (worfy-week ticket 18)', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    const head = `"at":"2026-10-06T01:00:01Z","run":"${journal.run}","project":"${PROJECT}","epic":"${EPIC}"`
    appendFileSync(journal.file, `{"kind":"run-stopping",${head},"reason":"user-stop","wave":1,"tickets":["01","02"],"inWork":["01"]}\n`)
    appendFileSync(journal.file, `{"kind":"run-stopping",${head},"reason":"user-stop","wave":1,"tickets":["01","02"]}\n`)

    const parsed = await readRun(journal.run)
    expect(parsed?.events.map((event) => event.kind)).toEqual(['run-started', 'run-stopping'])
    expect(parsed?.events[1]).toMatchObject({ reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01'] })
    expect(parsed?.skipped).toBe(1)
  })

  it('writes refused-dialog with the Subagent and the reason, and reads an old line without them (worfy-polish ticket 26)', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    await journal.append({ kind: 'refused-dialog', session: 'abc-123', what: 'permission_request Bash', agent: 'agent-impl-07', reason: 'rm -rf with a target that cannot be resolved (~/x)' })
    const head = `"at":"2026-10-06T01:00:02Z","run":"${journal.run}","project":"${PROJECT}","epic":"${EPIC}"`
    appendFileSync(journal.file, `{"kind":"refused-dialog",${head},"session":null,"what":"card_ask card-7"}\n`)

    const parsed = await readRun(journal.run)
    expect(parsed?.skipped).toBe(0)
    expect(parsed?.events.slice(1)).toEqual([
      expect.objectContaining({ kind: 'refused-dialog', session: 'abc-123', what: 'permission_request Bash', agent: 'agent-impl-07', reason: 'rm -rf with a target that cannot be resolved (~/x)' }),
      expect.objectContaining({ kind: 'refused-dialog', session: null, what: 'card_ask card-7' }),
    ])
    expect(parsed?.events[2]).not.toHaveProperty('agent')
    expect(parsed?.events[2]).not.toHaveProperty('reason')
  })

  it('writes wave-started and wave-finished with limits, reads old lines without them, and a wrong limits drops only that field (worfy-throughput ticket 40)', async () => {
    const limits = {
      five_hour: { utilization: 0.12, receivedAt: '2026-10-06T00:58:00.000Z', resetsAt: '2026-10-06T04:00:00.000Z' },
      seven_day: { utilization: 0.41, receivedAt: '2026-10-06T00:58:00.000Z', resetsAt: null },
    }
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    await journal.append({ kind: 'wave-started', wave: 1, tickets: ['01'], limits })
    await journal.append({ kind: 'wave-finished', wave: 1, tickets: ['01'], limits: { five_hour: null, seven_day: { ...limits.seven_day, utilization: 0.44 } } })
    const head = (second: number) => `"at":"2026-10-06T01:00:0${second}Z","run":"${journal.run}","project":"${PROJECT}","epic":"${EPIC}"`
    // A line written before ticket 40, and two with a limits value outside the format.
    appendFileSync(journal.file, `{"kind":"wave-started",${head(3)},"wave":2,"tickets":["02"]}\n`)
    appendFileSync(journal.file, `{"kind":"wave-finished",${head(4)},"wave":2,"tickets":["02"],"limits":{"seven_day":{"utilization":"41%"}}}\n`)
    appendFileSync(journal.file, `{"kind":"wave-started",${head(5)},"wave":3,"tickets":["03"],"limits":"full"}\n`)
    appendFileSync(journal.file, `{"kind":"wave-finished",${head(6)},"wave":3,"tickets":["03"]}\n`)

    // As written: the field is on the line, one JSON object.
    const written = rawLines(journal.file).map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(written[1]).toMatchObject({ kind: 'wave-started', limits })

    const parsed = await readRun(journal.run)
    expect(parsed?.skipped).toBe(0)
    const waves = parsed!.events.slice(1)
    expect(waves.map((event) => event.kind)).toEqual(['wave-started', 'wave-finished', 'wave-started', 'wave-finished', 'wave-started', 'wave-finished'])
    expect(waves[0]).toMatchObject({ wave: 1, limits })
    expect(waves[1]).toMatchObject({ wave: 1, limits: { five_hour: null, seven_day: { utilization: 0.44 } } })
    for (const event of waves.slice(2)) expect((event as { limits?: unknown }).limits).toBeUndefined()
    expect(waves.slice(2).map((event) => (event as { wave: number }).wave)).toEqual([2, 2, 3, 3])
  })

  it('returns undefined for a run without a file and refuses a name that is not a run id', async () => {
    expect(await readRun('2026-10-06T01-00-00-000Z-000000')).toBeUndefined()
    mkdirSync(join(dataDir, 'autopilot'), { recursive: true })
    writeFileSync(join(scratch, 'outside.jsonl'), '')
    await expect(readRun('../../outside')).rejects.toThrow(/run id/)
  })
})

describe('listRuns', () => {
  it("lists a Project's runs from newest to oldest, whatever the order they were opened in", async () => {
    const open = (project: string, start: number, suffix: string) => openRun({ project, epic: EPIC }, { now: () => new Date(start), suffix: () => suffix })
    const middle = await open(PROJECT, T0 + 60_000, 'bbbbbb')
    const oldest = await open(PROJECT, T0, 'aaaaaa')
    const newest = await open(PROJECT, T0 + 120_000, 'cccccc')
    await open(OTHER_PROJECT, T0 + 90_000, 'dddddd')

    const runs = await listRuns(PROJECT)
    expect(runs.map((run) => run.run)).toEqual([newest.run, middle.run, oldest.run])
    expect(runs[0]).toEqual({ run: newest.run, project: PROJECT, epic: EPIC, startedAt: new Date(T0 + 120_000).toISOString(), file: newest.file })
    expect((await listRuns(OTHER_PROJECT)).map((run) => run.project)).toEqual([OTHER_PROJECT])
  })

  it("readRecentRuns gives the events of the Project's newest runs, at most the limit, for the Wave estimate (worfy-throughput ticket 40)", async () => {
    expect(ESTIMATE_RUNS).toBe(30)
    const open = (project: string, start: number, suffix: string) => openRun({ project, epic: EPIC }, { now: () => new Date(start), suffix: () => suffix })
    const oldest = await open(PROJECT, T0, 'aaaaaa')
    const newest = await open(PROJECT, T0 + 120_000, 'cccccc')
    await newest.append({ kind: 'wave-started', wave: 1, tickets: ['01'] })
    await open(OTHER_PROJECT, T0 + 90_000, 'dddddd')

    const all = await readRecentRuns(PROJECT)
    expect(all.map((events) => events[0]?.run)).toEqual([newest.run, oldest.run])
    expect(all[0]!.map((event) => event.kind)).toEqual(['run-started', 'wave-started'])
    expect((await readRecentRuns(PROJECT, { limit: 1 })).map((events) => events[0]?.run)).toEqual([newest.run])
    expect(await readRecentRuns('nobody-00000000')).toEqual([])
  })

  it('leaves out files that are not run journals or have no readable line', async () => {
    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    const dir = join(dataDir, 'autopilot')
    writeFileSync(join(dir, 'notes.jsonl'), readFileSync(journal.file))
    writeFileSync(join(dir, `${journal.run}.json`), readFileSync(journal.file))
    writeFileSync(join(dir, '2026-10-06T00-00-00-000Z-000000.jsonl'), '{"kind":"run-st')
    expect((await listRuns(PROJECT)).map((run) => run.run)).toEqual([journal.run])
  })

  it('skips a file removed between listing the folder and reading it', async () => {
    const kept = await openRun({ project: PROJECT, epic: EPIC }, { now: () => new Date(T0), suffix: () => 'aaaaaa' })
    const removed = await openRun({ project: PROJECT, epic: EPIC }, { now: () => new Date(T0 + 1000), suffix: () => 'bbbbbb' })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsp.readFile).mockImplementation(async (file, options) => {
      if (String(file) === removed.file) rmSync(removed.file)
      return actual.readFile(file, options as BufferEncoding)
    })
    try {
      expect((await listRuns(PROJECT)).map((run) => run.run)).toEqual([kept.run])
    } finally {
      vi.mocked(fsp.readFile).mockImplementation(actual.readFile as typeof fsp.readFile)
    }
  })

  it('returns no runs and creates nothing when the journal folder does not exist', async () => {
    expect(await listRuns(PROJECT)).toEqual([])
    expect(existsSync(dataDir)).toBe(false)
  })
})

describe('writes only to WORFY_DATA_DIR', () => {
  /** Every file and folder under `root`, with its content and modification time. */
  function snapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        const stat = statSync(path)
        const key = relative(root, path)
        if (entry.isDirectory()) {
          out[`${key}/`] = String(stat.mtimeMs)
          walk(path)
        } else {
          out[key] = `${stat.mtimeMs} ${readFileSync(path, 'base64')}`
        }
      }
    }
    walk(root)
    return out
  }

  it('leaves a Project folder and WORFY_CLAUDE_HOME exactly as they were', async () => {
    for (const dir of [join(projectDir, '.scratch', EPIC, 'issues'), join(projectDir, 'docs', 'adr'), join(claudeHome, 'projects', 'p')]) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(projectDir, 'HANDOFF.md'), '# handoff\n')
    writeFileSync(join(projectDir, '.scratch', EPIC, 'issues', '01-x.md'), 'Status: open\n')
    writeFileSync(join(claudeHome, 'projects', 'p', 'session.jsonl'), '{}\n')
    const before = { project: snapshot(projectDir), claudeHome: snapshot(claudeHome), scratch: readdirSync(scratch).sort() }

    const journal = await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0) })
    for (const fields of appended) await journal.append(fields)
    await openRun({ project: PROJECT, epic: EPIC }, { now: ticking(T0 + 60_000) })
    await listRuns(PROJECT)
    await readRun(journal.run)

    expect({ project: snapshot(projectDir), claudeHome: snapshot(claudeHome), scratch: readdirSync(scratch).sort() }).toEqual({
      ...before,
      scratch: [...before.scratch, 'data'].sort(),
    })
    // Keys come from relative(), so they carry the separator of the system; a folder key ends in "/".
    expect(Object.keys(snapshot(dataDir)).every((path) => path === 'autopilot/' || path.startsWith(`autopilot${sep}`))).toBe(true)
  })
})
