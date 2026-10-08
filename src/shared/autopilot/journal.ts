// The Autopilot run journal: every event of one Autopilot run, one JSON object per line (JSONL).
// The morning after a run, the journal shows what happened and every point where a human was
// needed. This comment is the format's specification: an observer reads and appends to the file
// without any worfy code.
//
// Where. `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`, one file per run, no rotation. WORFY_DATA_DIR
// defaults to `~/Library/Application Support/worfy` (ADR-0005). `<run>` is the run id: the start
// time in UTC with `:` and `.` replaced by `-`, a dash, and six lowercase hex digits, for example
// `2026-10-06T01-02-03-004Z-a1b2c3`. File names sort by start time; the newest run is the last.
//
// Line. One JSON object, then `\n`; no newline inside the object. Every line has:
//
//   at       when it happened: ISO 8601 date and time with `Z` or an offset
//            (`2026-10-06T01:02:03.004Z`, `2026-10-06T04:02:03+03:00`)
//   run      the run id, the same as the file name without `.jsonl`
//   project  the Project id (`<folder name>-<8 hex digits>`, src/main/projects/store.ts)
//   epic     the Epic's name (`worfy-daily`)
//   kind     one of the kinds below, plus that kind's fields
//
// Kinds and their fields:
//
//   run-started                      the run began; worfy writes it as the first line
//   harness-behind harness, main,    the Harness in worfy's main has changes in harness/ that the
//                  commits           running build's Harness has not (worfy-harness ticket 21,
//                                    ADR-0047): the Stable copy is due `pnpm install:stable` once
//                                    the run is over. harness: the build version,
//                                    `<semver>+<SHA>`; main: the ref compared with, `origin/main`
//                                    or `main`; commits: how many commits of main change harness/
//                                    after the build commit, from 1. Written right after
//                                    run-started when the Harness is behind, and before a
//                                    wave-started when the count has changed since (a lesson
//                                    merged during the run). Only packaged builds over worfy's own
//                                    repository write it; journals written before ticket 21 have
//                                    none
//   wave-started   wave, tickets,    wave: number from 1; tickets: Ticket numbers, ["01", "02"];
//                  text?, skipped?   text: the text the Orchestrator got; skipped: Tickets left
//                                    out because they are not open though their blockers are all
//                                    done, [{"num": "15", "state": "blocked"}], state `blocked` or
//                                    `none` (ticket 30, ADR-0033; lines written before it have
//                                    neither field)
//   narrow-round   ticket, outcome,  a Ticket of a Wave of the run went through a step of the
//                  text              narrow fix round (worfy-harness ticket 20, ADR-0046), as a
//                                    comment on its PR says: ticket: its number, as in tickets of
//                                    wave-started; outcome: `started` (a comment `NARROW:
//                                    <findings>`), `verified` (`NARROW: VERIFIED`) or `rejected`
//                                    (`NARROW: REJECTED…`); text: the first line of that comment,
//                                    at most 1000 characters. worfy reads the PRs of the Tickets of
//                                    the run's Waves at most once a minute (the PR badges' read), so
//                                    the line comes up to a minute or two after the comment, and a
//                                    state seen for the first time is journaled with the states
//                                    before it the run has not journaled yet, in comment order:
//                                    `started` and `rejected` can arrive together. A pair of ticket
//                                    and outcome is written once per run; the first read of a run
//                                    also journals the narrow-round comments already on the PR.
//                                    No PR, no line: a Ticket that finishes without a PR
//                                    (`local-green`, the verdicts are commits then) and a run
//                                    while gh is unavailable write none. The run reads once more
//                                    before run-stopped (not on a Force stop or a quit), but gh
//                                    answers at most once a minute: a comment made less than a
//                                    minute before the end may be missing. Journals written
//                                    before ticket 20 have none
//   wave-finished  wave, tickets     wave and tickets as in wave-started
//   limits-hit     window, resetsAt  a Session was refused by the Limits; window: `five_hour`,
//                                    `seven_day`, … or null; resetsAt: ISO time or null
//   waiting-until  until             the run sleeps until this ISO time
//   resumed                          the run continues after a wait
//   session-error  session, message  a Session failed; session: its id or null
//   refused-dialog session, what     a Session asked for a person (a permission or a question)
//                                    and the run refused it without one; what: which request
//   human-input    source, what      a person stepped into the run; any such line is a defect
//   background-tasks tasks           the live background tasks of the run's Orchestrator Session
//                                    changed (ADR-0029); tasks: every one now, possibly none; also
//                                    written after run-stopped while the run waits to give the
//                                    Orchestrator back
//   run-stopping   reason, wave,     a graceful Stop (worfy-week ticket 18, ADR-0051): the run takes
//                  tickets, inWork   no new Ticket and told the Orchestrator so; it ends with
//                                    run-stopped once the turn and the background tasks are over;
//                                    reason: `user-stop`; wave and tickets as in wave-started;
//                                    inWork: the Tickets of the Wave in work at the Stop
//   run-stopped    reason, tasks?,   the run ended; reason: why, in a few words; tasks: the
//                  tickets?,         background tasks alive then, when any were; tickets: with
//                  lastText?         `blocked-tickets`, the Tickets it stopped on (as skipped of
//                                    wave-started, numbers only); with `user-force-stop`, the
//                                    Tickets of the Wave it interrupted, none before the first Wave
//                                    (worfy-week tickets 17, 18; lines written before ticket 18 say
//                                    `user-stop` for it); lastText: with `no-progress`,
//                                    `no-ready-wave` and `blocked-tickets`, the first 1000
//                                    characters of the Orchestrator's last answer in the turns of
//                                    the Wave, none when no Wave was sent (ADR-0033)
//   orchestrator-returned            after a run-stopped with live tasks: they have ended and the
//                                    Orchestrator runs as a person's Session again; after
//                                    `user-force-stop`: it was given back at once (ADR-0050)
//   tasks-killed   reason, tasks     the background tasks a stopped run still waited for were
//                                    killed; reason: `app-quit`, tasks: none when the run waited
//                                    only for a turn of the Orchestrator still running; or
//                                    `user-force-stop`: the tasks alive at the Force stop, or
//                                    started by the turn it interrupted, ended with the
//                                    Orchestrator's process (ADR-0050), written only when there
//                                    were any
//
// A graceful Stop journals run-stopping → background-tasks … → run-stopped (`user-stop`, no
// tickets). A Force stop during it: run-stopping → … → run-stopped (`user-force-stop`, tickets) →
// tasks-killed (`user-force-stop`), when tasks lived → orchestrator-returned.
//
// A task of `tasks` is {id, type, description}: the task id of Claude Code, its type
// (`local_agent`, `local_bash`, …) and what it does, both null when Claude Code did not say.
//
// human-input. `source` says who writes the line:
//   "worfy"     worfy itself, on the user's action in a Session of the run: a message to the
//               Orchestrator or one of its Subagents, "Send queued", a change of mode or model,
//               a restart of the Session by hand;
//   "observer"  the observer agent, on a touch outside worfy that only the screen shows: a macOS
//               system dialog, Keychain, restarting the app by hand.
// `what` says in a few words what the person did. A Ticket opened for an intervention points at
// its line in `Source`: the file and the line's `at`.
//
// An observer appends one line to the file of the run it watches (while a run is going, the
// newest file in the folder), with `>>` and nothing else, for example:
//
//   printf '%s\n' '{"at":"2026-10-06T04:05:00+03:00","run":"2026-10-06T01-02-03-004Z-a1b2c3","project":"worfy-1a2b3c4d","epic":"worfy-daily","kind":"human-input","source":"observer","what":"clicked Allow on a Keychain dialog"}' \
//     >> "$HOME/Library/Application Support/worfy/autopilot/2026-10-06T01-02-03-004Z-a1b2c3.jsonl"
//
// Reading. A line that is not JSON (the last line cut off by a crash), a line of an unknown kind
// and a line whose fields do not match its kind are skipped and counted; the other lines are
// read in file order. Keys the format does not declare are dropped. Blank lines are ignored.
//
// Everything here is pure; src/main/autopilot/journal.ts reads and writes the files.
import { z } from 'zod'

/** Every kind of event, in the order a run usually meets them. */
export const JOURNAL_EVENT_KINDS = [
  'run-started',
  'harness-behind',
  'wave-started',
  'narrow-round',
  'wave-finished',
  'limits-hit',
  'waiting-until',
  'resumed',
  'session-error',
  'refused-dialog',
  'human-input',
  'background-tasks',
  'run-stopping',
  'run-stopped',
  'orchestrator-returned',
  'tasks-killed',
] as const
export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[number]

/** Who wrote a `human-input` line. */
export const HUMAN_INPUT_SOURCES = ['worfy', 'observer'] as const
export type HumanInputSource = (typeof HUMAN_INPUT_SOURCES)[number]

/** The states of a narrow fix round a `narrow-round` line names. */
export const NARROW_OUTCOMES = ['started', 'verified', 'rejected'] as const
export type NarrowOutcome = (typeof NARROW_OUTCOMES)[number]

const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}$/
/** Hex digits after the start time in a run id. */
export const RUN_ID_SUFFIX_LENGTH = 6

/** Whether a text is a run id, and so also safe as a file name inside the journal folder. */
export function isRunId(text: string): boolean {
  return RUN_ID_PATTERN.test(text)
}

/** The run id for a run started at `start`; `suffix` is six lowercase hex digits. */
export function makeRunId(start: Date, suffix: string): string {
  const run = `${start.toISOString().replace(/[:.]/g, '-')}-${suffix}`
  if (!isRunId(run)) throw new Error(`not a run id: ${run}`)
  return run
}

/** The journal file's name for a run. */
export const journalFileName = (run: string): string => `${run}.jsonl`

const isoTime = z.iso.datetime({ offset: true })
const text = z.string().min(1)
const wave = { wave: z.number().int().positive(), tickets: z.array(text) }
/** How much of the Orchestrator's last answer `run-stopped` keeps. */
export const LAST_TEXT_MAX = 1000
const skipped = z.array(z.object({ num: text, state: z.enum(['blocked', 'none']) }))
const session = z.string().min(1).nullable()
const tasks = z.array(z.object({ id: text, type: z.string().nullable(), description: z.string().nullable() }))

const common = {
  at: isoTime,
  run: z.string().regex(RUN_ID_PATTERN),
  project: text,
  epic: text,
}

const event = <K extends JournalEventKind, F extends z.ZodRawShape>(kind: K, fields: F) =>
  z.object({ ...common, kind: z.literal(kind), ...fields })

export const journalEventSchema = z.discriminatedUnion('kind', [
  event('run-started', {}),
  event('harness-behind', { harness: text, main: text, commits: z.number().int().positive() }),
  event('wave-started', { ...wave, text: z.string().optional(), skipped: skipped.optional() }),
  event('narrow-round', { ticket: text, outcome: z.enum(NARROW_OUTCOMES), text: text.max(LAST_TEXT_MAX) }),
  event('wave-finished', wave),
  event('limits-hit', { window: z.string().min(1).nullable(), resetsAt: isoTime.nullable() }),
  event('waiting-until', { until: isoTime }),
  event('resumed', {}),
  event('session-error', { session, message: z.string() }),
  event('refused-dialog', { session, what: text }),
  event('human-input', { source: z.enum(HUMAN_INPUT_SOURCES), what: text }),
  event('background-tasks', { tasks }),
  event('run-stopping', { reason: text, ...wave, inWork: z.array(text) }),
  event('run-stopped', { reason: text, tasks: tasks.optional(), tickets: z.array(text).optional(), lastText: z.string().max(LAST_TEXT_MAX).optional() }),
  event('orchestrator-returned', {}),
  event('tasks-killed', { reason: text, tasks }),
])
export type JournalEvent = z.output<typeof journalEventSchema>

/**
 * The start of an answer as `run-stopped` keeps it: at most LAST_TEXT_MAX UTF-16 units (as the
 * format checks it), without half of a surrogate pair at the cut.
 */
export function clipLastText(answer: string): string {
  if (answer.length <= LAST_TEXT_MAX) return answer
  const cut = answer.slice(0, LAST_TEXT_MAX)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The fields every line shares; the writer fills them in. */
export type JournalCommon = Pick<JournalEvent, 'at' | 'run' | 'project' | 'epic'>
/** An event as its producer gives it: the kind and that kind's fields. */
export type JournalEventFields = JournalEvent extends infer E ? (E extends JournalEvent ? Omit<E, keyof JournalCommon> : never) : never

export interface ParsedJournal {
  /** The readable events, in file order. */
  events: JournalEvent[]
  /** Lines that were not blank and could not be read as an event. */
  skipped: number
}

/** Reads a journal file's text; never throws. */
export function parseJournal(source: string): ParsedJournal {
  const events: JournalEvent[] = []
  let skipped = 0
  for (const line of source.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      skipped++
      continue
    }
    const parsed = journalEventSchema.safeParse(value)
    if (parsed.success) events.push(parsed.data)
    else skipped++
  }
  return { events, skipped }
}

/**
 * One journal line for `value`, newline included. The value is parsed first: undeclared keys are
 * dropped, and a value outside the format throws instead of becoming a line no reader accepts.
 */
export function formatJournalLine(value: JournalEvent): string {
  const parsed = journalEventSchema.safeParse(value)
  if (!parsed.success) throw new Error(`refusing to write a journal line outside the format\n${z.prettifyError(parsed.error)}`)
  return `${JSON.stringify(parsed.data)}\n`
}
