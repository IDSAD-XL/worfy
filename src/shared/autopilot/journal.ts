// The Autopilot run journal: every event of one Autopilot run, one JSON object per line (JSONL).
// The morning after a run, the journal shows what happened and every point where a human was
// needed. This comment is the format's specification: an observer reads and appends to the file
// without any worfy code.
//
// Where. `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`, one file per run, no rotation. WORFY_DATA_DIR
// defaults to `~/Library/Application Support/worfy` on macOS and `%APPDATA%\worfy` on Windows
// (ADR-0005, worfy-windows ticket 08). `<run>` is the run id: the start
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
//   run-started    origin?,          the run began; worfy writes it as the first line. origin:
//                  override?,        the key of remote `origin` of the Project's repository
//                  unasked?          (`github.com/owner/repo`: no scheme, user or port, lower
//                                    case, no `.git`), absent without one; override: `true` when
//                                    the start went past a run of the same Epic and origin on
//                                    another Machine ("Start anyway" while that run went on),
//                                    absent otherwise; unasked:
//                                    the names of the Linked machines the start could not ask
//                                    about their runs (not connected, or no answer within 3 s),
//                                    absent when it asked them all (worfy-link ticket 15). Lines
//                                    written before that ticket have none of the three.
//                  by?, tickets?     by: who started the run, `button` (the Autopilot button),
//                                    `command` (a command typed in a chat) or `tool` (the
//                                    Orchestrator's tool `autopilot_start`); tickets: the Tickets
//                                    of a run over named Tickets, numbers as in wave-started, in
//                                    number order, absent for a run over the whole Epic
//                                    (worfy-flight-recorder tickets 11, 21; ADR-0091, ADR-0092).
//                                    A `by` of another value reads as none, the line stays.
//                                    Lines written before ticket 11 have neither
//                  mode?             the Run mode (worfy-resource-planner ticket 05, ADR-0093):
//                                    `fastest`, `budget-aware` or `start-window`; a `mode` of
//                                    another value reads as none, the line stays. Lines written
//                                    before ticket 05 have none
//                  vendor?           the Vendor of the Orchestrator that runs the Waves
//                                    (worfy-multi-vendor ticket 37): `claude` or `codex`; absent —
//                                    `claude`, as in every line written before that ticket. A
//                                    `vendor` this build does not know reads as none, the line stays
//                  autoApproval?     the Auto-approval mode of the Project when the run started
//                                    (worfy-auto-approve ticket 04): `shadow` or `on`; `off` when
//                                    it was Shadow or On but the run could not read what the
//                                    policy needs (git), so the policy is off for the whole run;
//                                    absent when it was Off, as in every line written before the
//                                    ticket. A mode switched later counts from the next request,
//                                    and each auto-approval line names the mode it was judged in
//   harness-behind harness, main,   the Harness in worfy's main has changes in harness/ that the
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
//   forecast       mode, waves,      the Epic forecast at the start of the run (worfy-resource-
//                  tickets,          planner ticket 07, ADR-0093), once, after run-started and
//                  uncounted,        harness-behind (when that is written) and before the first
//                  samples, low,     wave-started. The run reckons it from what it reads at the
//                  high, fit, week,  start: the workflow model, the journals of the Project's recent
//                  durationP90Ms,    runs on this Machine, the Limits and Settings (forecast.ts,
//                  durationSamples,  forecast-lines.ts, wave-duration.ts). mode: as in run-started, a
//                                    mode of another value reads as none and the line stays;
//                  window?           waves, tickets: the Waves left and the Tickets in them (over
//                                    the named Tickets only in a run over named Tickets); uncounted:
//                                    Tickets not closed and without a Wave number; samples: the
//                                    per-Ticket samples the range is drawn from, 0 when the
//                                    journals could not be read; low, high: p10 and p90 of the share
//                                    of the week all those Waves take, 0..1, both null under 5
//                                    samples or with no Wave left; fit: K of the recommendation, how
//                                    many of the first Waves fit before the 7-day reset by their p90
//                                    with the reserve of Settings, only when the budget acts in the
//                                    run (Budget-aware, or Start window with the budget on); null
//                                    without a recommendation (Fastest, Start window with the budget
//                                    off), a range, or a fresh 7-day number with its reset ahead;
//                                    week: the 7-day number at the start, {utilization, resetsAt}
//                                    (resetsAt an ISO time or null), null without a fresh one (30
//                                    minutes); durationP90Ms: the p90 of the Waves' duration in ms,
//                                    null under 5 samples; durationSamples: how many durations there
//                                    are; window: {from, to}, the whole local hours of the Start
//                                    window, only in mode `start-window`. A week or a window of
//                                    another shape reads as none, the line stays. Written only when
//                                    the run reads past journals (the app's runs always do).
//                                    Journals written before ticket 07 have none
//   wave-started   wave, tickets,    wave: number from 1; tickets: Ticket numbers, ["01", "02"];
//                  text?, skipped?,  text: the text the Orchestrator got; skipped: Tickets left
//                  session?          out because they are not open though their blockers are all
//                                    done, [{"num": "15", "state": "blocked"}], state `blocked` or
//                                    `none` (ticket 30, ADR-0033; lines written before it have
//                                    neither field); session: the id of the Orchestrator's SDK
//                                    session the Wave went to, the name of its transcript
//                                    (`<session>.jsonl`), a new one for each Wave after the first
//                                    when the Harness gives one (worfy-flight-recorder ticket 11,
//                                    ADR-0092; lines written before it have none)
//   ticket-status  ticket, state,    the `Status:` line of a Ticket of the run's Epic changed while
//                  statusAt?,        the run went on (worfy-flight-recorder ticket 11, ADR-0092):
//                  reason?, waits?   worfy reads the workflow on each change of the Tickets' files,
//                                    and once more right before run-stopped (not on a Force stop
//                                    or a quit), and writes a line for every Ticket whose status
//                                    differs from its last read; the read at the start only
//                                    records them, so none before the run, and none after it. A
//                                    Ticket whose file appeared during the run writes the status
//                                    it is first seen with, `open` too. ticket: its
//                                    number, as in wave-started; state: `claimed` (`Status:
//                                    claimed`, in work), `blocked`, `done` or `open`; a Ticket
//                                    whose Status cannot be read writes none. statusAt: the time
//                                    of the Status line as the Ticket gives it (`2026-10-17T09:41Z`
//                                    or a date); reason: its `Blocked reason:` line; waits: its
//                                    `Waits:` line; each absent without that line. `at` is when
//                                    worfy saw the change, which may be later than it was made: a
//                                    reader takes the time of the change from statusAt. Two changes
//                                    between two reads write only the later one. Journals written
//                                    before ticket 11 have none
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
//                                    and outcome is written once per run. Only comments made after
//                                    the run started count (gh's `createdAt` against worfy's clock):
//                                    those of an earlier run or a closed PR write no line; a
//                                    comment gh gives no time for is taken. No PR, no line: a
//                                    Ticket that finishes without a PR (`local-green`, the verdicts
//                                    are commits then) and a run while gh is unavailable write
//                                    none. The run reads once more before run-stopped and waits
//                                    for that read 1 s at most, not at all on a Force stop or a
//                                    quit; gh answers at most once a minute. So a comment made less
//                                    than a minute before the end, or one gh is slow to give then,
//                                    may be missing. Journals written before ticket 20 have none
//   wave-finished  wave, tickets,    wave and tickets as in wave-started
//                  limits?
//
//   limits? of wave-started and wave-finished: the share of the Limits windows when the line
//   was written (worfy-throughput ticket 40), in the shape of the Vendor of the run (run-started
//   vendor). A run on Claude: {"five_hour": <window>, "seven_day": <window>}, a window null when
//   worfy knew nothing of it; <window> is {utilization, receivedAt, resetsAt}: utilization the
//   used share 0..1 (above 1 when over) or null, receivedAt the ISO time worfy got the number,
//   resetsAt the ISO time the window resets or null. A run on another Vendor (Codex,
//   worfy-multi-vendor ticket 38): {"windows": [<limit window>, …]}, every window of that Vendor
//   worfy knew of; <limit window> is {vendor, provider?, id, label, usedPercent, windowMinutes,
//   resetsAt, receivedAt, state, source}, a LimitWindow of src/shared/agent/limits.ts with its
//   times as ISO: usedPercent 0..100 and more or null, windowMinutes the window's length or null,
//   resetsAt an ISO time or null, receivedAt an ISO time, state `ok`, `warning`, `reached` or
//   null. No line when nothing is known of any window. Before both lines worfy asks the usage
//   (Claude) or reads the Vendor's windows again once when the number is older than 5 minutes. A
//   limits value outside both shapes is dropped and the line read without it. Lines written before
//   ticket 40 have no limits, and lines before ticket 38 only the first shape
//   start-window   reason, until,    the next Wave did not start for the Start window of the Run
//                  text,             mode `start-window` (worfy-resource-planner ticket 05,
//                  durationP90Ms?    ADR-0093): checked before each Wave, never inside one, and
//                                    before the budget. reason: `outside` (the window is not open)
//                                    or `wave-too-long` (open, but the p90 of the Waves' duration
//                                    would end the Wave after the window's end); until: the ISO
//                                    time of the window's next start, when the run checks again;
//                                    text: the reason in words; durationP90Ms: that p90 in ms,
//                                    absent with fewer than 5 samples. waiting-until with the same
//                                    time follows, and resumed when the time comes. Journals
//                                    written before ticket 05 have none
//   budget-stop    cause, share,     the next Wave did not start for the budget of the Limits
//                  used, need,       (worfy-throughput ticket 41, Settings → Autopilot): checked
//                  until, text       before each Wave, never inside one. cause: `daily-share`
//                                    (nothing left of today's share, or less than the estimate of
//                                    the Wave) or `five-hour` (today's share is left, the 5-hour
//                                    window is full); share: today's share of the week, 0..1, as
//                                    (1 − reserve − the 7-day share at the start of the day) / days
//                                    until the 7-day reset; used: the 7-day share used since the
//                                    start of the day; need: the estimate of the Wave (0 without
//                                    one); until: the ISO time the run tries the Wave again; text:
//                                    the reason in words. waiting-until with the same time follows,
//                                    and resumed when the time comes. Journals written before
//                                    ticket 41 have none
//   limits-hit     window, resetsAt, a Session was refused by the Limits; window: `five_hour`,
//                  reason?,          `seven_day`, `primary`, … or null; resetsAt: ISO time or null;
//                  message?          reason: `quota` when the Vendor refused without a window that
//                                    resets (Codex `usageLimitExceeded` with no window used up:
//                                    the plan does not include Codex, or a quota ran out;
//                                    worfy-multi-vendor ticket 38), absent for a window that
//                                    resets; message: with `quota`, the first 1000 characters of
//                                    the turn's error text. run-stopped `vendor-quota` follows a
//                                    `quota` hit at once, with no wait. A reason of another value
//                                    reads as none, the line stays. Lines written before ticket 38
//                                    have neither field
//   waiting-until  until             the run sleeps until this ISO time
//   resumed                          the run continues after a wait
//   turn-retry     attempt, of,      a turn of the run's Orchestrator ended with a temporary API
//                  error, message,   error and Auto-continue is on (worfy-retry ticket 04): the
//                  until             run waits and then sends the Orchestrator a continuation;
//                                    attempt: this retry, from 1, of `of` at most in a row; error:
//                                    the kind (`api-500`, `overloaded`, `connection`, …,
//                                    src/shared/agent/turn-failure.ts); message: the first 300
//                                    characters of the turn's error text; until: the ISO time the
//                                    continuation goes. resumed follows when it has gone; a turn
//                                    that goes through in the meantime ends the wait without one
//   retry-refused  reason, actions?  Auto-continue is on, the turn ended with an error, and the
//                                    run does not retry it: `not-transient` (the error does not
//                                    pass with time), `in-flight` (an external action of the turn
//                                    has no result: it may or may not have run), `cap` (the
//                                    retries in a row ran out). actions: with `in-flight`, worfy's
//                                    summary of each such call (`git push origin main`), secrets
//                                    hidden as in `auto-approval`. session-error and run-stopped
//                                    `turn-error` follow, as without Auto-continue
//   session-error  session, message  a Session failed; session: its id or null
//   refused-dialog session, what,    a Session asked for a person (a permission or a question)
//                  agent?, reason?   and the run refused it without one; what: which request;
//                                    agent: the Subagent that asked (Claude Code's agentID), absent
//                                    for the Session's own turn; reason: why Claude Code asked, its
//                                    first REASON_MAX units with the home folder written as `~`
//                                    (journalReason). The command itself is never written: it may
//                                    hold tokens and personal paths. Lines written before
//                                    worfy-polish ticket 26 have neither field
//   auto-approval  session, agent?,  the approval policy judged a permission request of the run's
//                  vendor, mode,     Session (worfy-auto-approve ticket 04) while Auto-approval was
//                  outcome, rule,    Shadow or On; mode: `shadow` or `on`, as it was at the request;
//                  tool, targets,    outcome: `allow`, `deny`, `park`, `hard-deny`, in Shadow
//                  command?          `would-allow`, `would-deny`, `would-park` (a hard-deny stays
//                                    `hard-deny`), and `park-answered`, `park-expired` once a parked
//                                    request ends (ticket 07); rule: the id of the rule that decided;
//                                    tool: the tool asked for; targets: the paths judged, the home
//                                    folder as `~`, each at most COMMAND_MAX units; command: a Bash
//                                    command as journalCommand keeps it — `NAME=***` for an
//                                    assignment whose name holds TOKEN, KEY, SECRET or PASSWORD, the
//                                    home folder as `~`, at most COMMAND_MAX units. Off writes no
//                                    such line: a refusal then is `refused-dialog` as before.
//                                    Journals written before ticket 04 have none
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
//   gate-queue     text              the run had no Wave to send (it was to stop with `no-ready-wave`
//                                    or `blocked-tickets`) on the machine with the role `serve` of
//                                    the cross-machine gate, and sent the Orchestrator the "Process
//                                    gate queue" template first (worfy-windows ticket 17,
//                                    ADR-0069); text: what it sent. Once per run. Its turn ends by
//                                    the rules of a Wave's turn (background tasks, the Limits);
//                                    run-stopped follows with the reason it was to stop with. A
//                                    Stop during it writes no run-stopping: run-stopped
//                                    (`user-stop`) follows the turn.
//                                    Journals written before ticket 17 have none
//   gate-queue-finished              the gate queue's turn is over, whatever ended it; run-stopped
//                                    follows (worfy-flight-recorder ticket 11, ADR-0092). Journals
//                                    written before ticket 11 have none
//   run-stopped    reason, tasks?,   the run ended; reason: why, in a few words; tasks: the
//                  tickets?,         background tasks alive then, when any were; tickets: with
//                  lastText?         `blocked-tickets`, the Tickets it stopped on (as skipped of
//                                    wave-started, numbers only); with `user-force-stop`, the
//                                    Tickets of the Wave it interrupted, none before the first Wave
//                                    (worfy-week tickets 17, 18; lines written before ticket 18 say
//                                    `user-stop` for it); so with `session-error` since
//                                    worfy-retry ticket 14; lastText: with `no-progress`,
//                                    `no-ready-wave`, `blocked-tickets` and `tickets-done`
//                                    (worfy-flight-recorder ticket 21), the first 1000
//                                    characters of the Orchestrator's last answer in the turns of
//                                    the Wave, none when no Wave was sent (ADR-0033)
//                  actual?           actual: the share of the week the run's Waves took
//                                    (worfy-resource-planner ticket 07): {share, waves, counted};
//                                    share: the sum of the growth of the 7-day share over each Wave
//                                    of the run that gives one by the rule of the samples
//                                    (waveGrowth, limits-estimate.ts: fresh numbers at both ends, no
//                                    reset inside), 0..1; waves: the Waves the run finished
//                                    (wave-finished); counted: how many of them gave a growth. None
//                                    when the run finished no Wave. A Force stop and a quit write
//                                    it too. An actual of another shape reads as none, the line
//                                    stays. Lines written before ticket 07 have none
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
// On Windows, in Git Bash, the file is "$APPDATA/worfy/autopilot/<run>.jsonl".
//
// Reading. A line that is not JSON (the last line cut off by a crash), a line of an unknown kind
// and a line whose fields do not match its kind are skipped and counted; the other lines are
// read in file order. Keys the format does not declare are dropped. Blank lines are ignored.
//
// Everything here is pure; src/main/autopilot/journal.ts reads and writes the files.
import { z } from 'zod'
import { AUTO_APPROVAL_LINE_MODES, AUTO_APPROVAL_OUTCOMES } from '../agent/auto-approval'
import { limitStateSchema, type LimitWindow, type LimitWindowId, type LimitsState } from '../agent/limits'
import { vendorIdSchema } from '../vendors/vendor'
import { RUN_MODES, WINDOW_WAIT_REASONS } from './run-mode'

/** Every kind of event, in the order a run usually meets them. */
export const JOURNAL_EVENT_KINDS = [
  'run-started',
  'harness-behind',
  'forecast',
  'wave-started',
  'ticket-status',
  'narrow-round',
  'wave-finished',
  'start-window',
  'budget-stop',
  'limits-hit',
  'waiting-until',
  'resumed',
  'turn-retry',
  'retry-refused',
  'session-error',
  'refused-dialog',
  'auto-approval',
  'human-input',
  'background-tasks',
  'run-stopping',
  'gate-queue',
  'gate-queue-finished',
  'run-stopped',
  'orchestrator-returned',
  'tasks-killed',
] as const
export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[number]

/** Who wrote a `human-input` line. */
export const HUMAN_INPUT_SOURCES = ['worfy', 'observer'] as const
export type HumanInputSource = (typeof HUMAN_INPUT_SOURCES)[number]

/** What an `auto-approval` line says the policy did, and the modes it names: the words of src/shared/agent/auto-approval.ts. */
export { AUTO_APPROVAL_LINE_MODES, AUTO_APPROVAL_OUTCOMES }
export type { AutoApprovalOutcome } from '../agent/auto-approval'

/** What a `limits-hit` line says of a refusal without a window that resets (worfy-multi-vendor ticket 38). */
export const LIMITS_HIT_REASONS = ['quota'] as const

/** Why a `retry-refused` line says the run did not retry a failed turn (src/shared/agent/continue-plan.ts, RefusedReason). */
export const RETRY_REFUSED_REASONS = ['not-transient', 'in-flight', 'cap'] as const

/** What a `budget-stop` line says stopped the run (src/shared/autopilot/budget.ts, BudgetCause). */
export const BUDGET_CAUSES = ['daily-share', 'five-hour'] as const

/** Who started a run, as `run-started` says it (src/main/autopilot/run.ts, AutopilotStartedBy). */
export const RUN_STARTED_BY = ['button', 'command', 'tool'] as const
export type RunStartedBy = (typeof RUN_STARTED_BY)[number]

/** The states a `ticket-status` line names: the Ticket's `Status:` as the Harness writes it. */
export const TICKET_STATUS_STATES = ['claimed', 'blocked', 'done', 'open'] as const
export type TicketStatusState = (typeof TICKET_STATUS_STATES)[number]

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
/** How much of Claude Code's reason for a permission request `refused-dialog` keeps. */
export const REASON_MAX = 200
/** How much of a command, and of each target path, `auto-approval` keeps. */
export const COMMAND_MAX = 200
/** How much of the turn's error text `turn-retry` keeps. */
export const RETRY_MESSAGE_MAX = 300
const skipped = z.array(z.object({ num: text, state: z.enum(['blocked', 'none']) }))
const session = z.string().min(1).nullable()
const tasks = z.array(z.object({ id: text, type: z.string().nullable(), description: z.string().nullable() }))
const limitsWindow = z.object({ utilization: z.number().nonnegative().nullable(), receivedAt: isoTime, resetsAt: isoTime.nullable() }).nullable()
/** The `limits` of a Wave's line of a run on Claude: the share of each of its two windows when the line was written. */
export const claudeJournalLimitsSchema = z.object({ five_hour: limitsWindow, seven_day: limitsWindow })
/** One window of the `limits` of a run on another Vendor: a LimitWindow, its times as ISO. */
const journalLimitWindowSchema = z.object({
  vendor: z.string().min(1),
  provider: z.string().optional(),
  id: z.string().min(1),
  label: z.string(),
  usedPercent: z.number().nonnegative().nullable(),
  windowMinutes: z.number().positive().nullable(),
  resetsAt: isoTime.nullable(),
  receivedAt: isoTime,
  state: limitStateSchema.nullable(),
  source: z.string(),
})
export type JournalLimitWindow = z.output<typeof journalLimitWindowSchema>
/** The `limits` of a Wave's line of a run on a Vendor other than Claude (worfy-multi-vendor ticket 38): every window of that Vendor. */
export const vendorJournalLimitsSchema = z.object({ windows: z.array(journalLimitWindowSchema).min(1) })
export type VendorJournalLimits = z.output<typeof vendorJournalLimitsSchema>
/** The `limits` field of wave-started and wave-finished: the share of the windows when the line was written, in the shape of the run's Vendor. */
export const journalLimitsSchema = z.union([claudeJournalLimitsSchema, vendorJournalLimitsSchema])
export type JournalLimits = z.output<typeof journalLimitsSchema>
// A value outside the shape reads as no value: the Wave's line itself is not lost for it.
const limits = journalLimitsSchema.optional().catch(undefined)
const count = z.number().int().nonnegative()
const share = z.number().nonnegative()
const hour = z.number().int().min(0).max(23)
/** The 7-day number at the start of the run, as `forecast` keeps it; another shape reads as none. */
const forecastWeek = z.object({ utilization: share, resetsAt: isoTime.nullable() }).nullable().catch(null)
/** `run-stopped.actual`: another shape, or more counted Waves than finished, reads as no value. */
const actual = z
  .object({ share, waves: z.number().int().positive(), counted: count })
  .refine((value) => value.counted <= value.waves)
  .optional()
  .catch(undefined)

const common = {
  at: isoTime,
  run: z.string().regex(RUN_ID_PATTERN),
  project: text,
  epic: text,
}

const event = <K extends JournalEventKind, F extends z.ZodRawShape>(kind: K, fields: F) =>
  z.object({ ...common, kind: z.literal(kind), ...fields })

export const journalEventSchema = z.discriminatedUnion('kind', [
  event('run-started', { origin: text.optional(), override: z.literal(true).optional(), unasked: z.array(text).optional(), by: z.enum(RUN_STARTED_BY).optional().catch(undefined), tickets: z.array(text).optional(), mode: z.enum(RUN_MODES).optional().catch(undefined), vendor: vendorIdSchema.optional().catch(undefined), autoApproval: z.enum(['off', 'shadow', 'on']).optional().catch(undefined) }),
  event('harness-behind', { harness: text, main: text, commits: z.number().int().positive() }),
  event('forecast', {
    mode: z.enum(RUN_MODES).optional().catch(undefined),
    waves: count,
    tickets: count,
    uncounted: count,
    samples: count,
    low: share.nullable(),
    high: share.nullable(),
    fit: count.nullable(),
    week: forecastWeek,
    durationP90Ms: count.nullable(),
    durationSamples: count,
    window: z.object({ from: hour, to: hour }).optional().catch(undefined),
  }),
  event('wave-started', { ...wave, text: z.string().optional(), skipped: skipped.optional(), limits, session: text.optional() }),
  event('ticket-status', { ticket: text, state: z.enum(TICKET_STATUS_STATES), statusAt: text.optional(), reason: text.optional(), waits: text.optional() }),
  event('narrow-round', { ticket: text, outcome: z.enum(NARROW_OUTCOMES), text: text.max(LAST_TEXT_MAX) }),
  event('wave-finished', { ...wave, limits }),
  event('start-window', { reason: z.enum(WINDOW_WAIT_REASONS), until: isoTime, text, durationP90Ms: z.number().int().nonnegative().optional() }),
  event('budget-stop', { cause: z.enum(BUDGET_CAUSES), share: z.number().nonnegative(), used: z.number().nonnegative(), need: z.number().nonnegative(), until: isoTime, text }),
  event('limits-hit', { window: z.string().min(1).nullable(), resetsAt: isoTime.nullable(), reason: z.enum(LIMITS_HIT_REASONS).optional().catch(undefined), message: z.string().max(LAST_TEXT_MAX).optional() }),
  event('waiting-until', { until: isoTime }),
  event('resumed', {}),
  event('turn-retry', { attempt: z.number().int().positive(), of: z.number().int().positive(), error: text, message: z.string().max(RETRY_MESSAGE_MAX), until: isoTime }),
  event('retry-refused', { reason: z.enum(RETRY_REFUSED_REASONS), actions: z.array(text.max(COMMAND_MAX)).optional() }),
  event('session-error', { session, message: z.string() }),
  event('refused-dialog', { session, what: text, agent: text.optional(), reason: text.max(REASON_MAX).optional() }),
  event('auto-approval', {
    session,
    agent: text.optional(),
    vendor: vendorIdSchema,
    mode: z.enum(AUTO_APPROVAL_LINE_MODES),
    outcome: z.enum(AUTO_APPROVAL_OUTCOMES),
    rule: text,
    tool: text,
    targets: z.array(text.max(COMMAND_MAX)),
    command: z.string().max(COMMAND_MAX).optional(),
  }),
  event('human-input', { source: z.enum(HUMAN_INPUT_SOURCES), what: text }),
  event('background-tasks', { tasks }),
  event('run-stopping', { reason: text, ...wave, inWork: z.array(text) }),
  event('gate-queue', { text }),
  event('gate-queue-finished', {}),
  event('run-stopped', { reason: text, tasks: tasks.optional(), tickets: z.array(text).optional(), lastText: z.string().max(LAST_TEXT_MAX).optional(), actual }),
  event('orchestrator-returned', {}),
  event('tasks-killed', { reason: text, tasks }),
])
export type JournalEvent = z.output<typeof journalEventSchema>

/** The start of a text: at most `max` UTF-16 units (as the format checks it), without half of a surrogate pair at the cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The start of an answer as `run-stopped` keeps it: at most LAST_TEXT_MAX UTF-16 units. */
export function clipLastText(answer: string): string {
  return clip(answer, LAST_TEXT_MAX)
}

/** The start of a turn's error text as `turn-retry` keeps it: at most RETRY_MESSAGE_MAX UTF-16 units. */
export function clipRetryMessage(message: string): string {
  return clip(message, RETRY_MESSAGE_MAX)
}

/**
 * Where a path that starts with a separator (`/Users/ann`, the MSYS `/c/Users/Ann`) may start in a
 * reason: anywhere but right after a character of a path name — a letter, a digit, `.`, `_`, `-` —
 * or a separator. The start of the text counts.
 */
const PATH_START = String.raw`(?<![\p{L}\p{N}._\\/-])`
/**
 * Where a drive path (`C:\Users\Ann`) may start: anywhere but right after a character of a path
 * name. A separator before it does not stop it: `\\?\C:\…`, `\\.\C:\…`, `/C:\…`, `file:///C:/…`.
 */
const DRIVE_START = String.raw`(?<![\p{L}\p{N}._-])`
/** Any run of path separators, of either platform. */
const SEPARATOR = String.raw`[\\/]+`
/** What may not follow the home folder: more of a folder name (`/Users/ann2` is not `/Users/ann`). */
const NAME_GOES_ON = String.raw`(?![\p{L}\p{N}_-])`

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Claude Code's reason for a permission request as `refused-dialog` keeps it: the home folder
 * (`home`, the user's) written as `~` wherever a path starts with it, then at most REASON_MAX
 * UTF-16 units. The same rule on every platform: case is ignored and `\` and `/` are one
 * separator, so `c:\users\ann`, `C:/Users/Ann` and the MSYS form `/c/Users/Ann` are all the home
 * `C:\Users\Ann`, and `/Users/Ann` is the home `/Users/ann`. Only a path is replaced, one that
 * does not go on from a path name (PATH_START: `/mnt/Users/ann` and `x/Users/ann` stay, while
 * `,/Users/ann` or `[/Users/ann` is replaced; DRIVE_START: `\\?\C:\Users\Ann` is replaced,
 * `xC:\Users\Ann` stays); a folder
 * whose name only goes on from the home's (`/Users/ann2`) stays; a dot after the home (the end of
 * a sentence) does not stop the replacement.
 */
export function journalReason(reason: string, home: string): string {
  return clip(homeAsTilde(reason, home), REASON_MAX)
}

/** `text` with the home folder `home` written as `~` wherever a path starts with it (journalReason). */
function homeAsTilde(text: string, home: string): string {
  const parts = home.split(/[\\/]+/).filter((part) => part !== '')
  if (parts.length === 0) return text
  const drive = /^([A-Za-z]):$/.exec(parts[0] ?? '')
  const rest = parts.slice(drive === null ? 0 : 1).map((part) => `${SEPARATOR}${escapeRegExp(part)}`).join('')
  // `C:` or `/c` before a drive home's folders; a separator before any other home's.
  const prefix = drive === null ? `${PATH_START}${rest}` : `(?:${DRIVE_START}${drive[1]}:|${PATH_START}[\\\\/]${drive[1]})${rest}`
  return text.replace(new RegExp(`${prefix}${NAME_GOES_ON}`, 'giu'), '~')
}

/** A value as a shell word holds it: quoted, or up to the next blank. */
const VALUE = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]\S*)`

/** A value as VALUE, but a bare one ends at a quote too: a word inside a quoted script. */
const WORD = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]+)`

/** Any assignment `NAME=value`; secretName decides whether its value is hidden. */
const ASSIGNMENT = new RegExp(String.raw`(?<![\p{L}\p{N}_-])([\p{L}_][\p{L}\p{N}_]*)=(${VALUE}|(?=\s|$))`, 'gu')

/** The parts of a variable's name, split at `_`, that make it a secret's (any case). */
const SECRET_PARTS = new Set(['pat', 'pass', 'pw', 'pwd', 'auth', 'credential', 'credentials', 'cookie'])

/** Whether a variable named so holds a secret: GH_TOKEN, api_key, PASSWORD, GITHUB_PAT, AUTH, DB_PASS… */
function secretName(name: string): boolean {
  return name
    .toLowerCase()
    .split('_')
    .some((part) => SECRET_PARTS.has(part) || /token|secret|passw|apikey|key$/.test(part))
}

/**
 * A JSON pair with a string value, `"name": "value"`, its quotes also escaped for a shell's double quotes
 * (`\"name\":\"value\"`); secretName decides whether the value is hidden.
 */
const JSON_PAIR = /((\\?)"([\w.-]+)\2"\s*:\s*)(\2")(?:\\\\|\\(?!")|[^"\\])*\4/gu

// The forms of a secret that the exceptions below name. Each stays as round 3 of PR #1460 wrote it.
/** An option that takes a secret: --token x, --password=x, --api-key x, --client-secret x. */
const OPTION_FORM = new RegExp(String.raw`((?:^|\s)--?(?:[a-z0-9]+[-_])*(?:token|password|passwd|pass|secret|api-?key|apikey|auth|key)(?:[-_][a-z0-9]+)*(?:=|\s+))${VALUE}`, 'giu')
/** A password word of .netrc and its kind: machine x login y password secret. */
const PASSWORD_WORD_FORM = new RegExp(String.raw`(\b(?:password|passwd)\s+)${WORD}`, 'giu')
/** A quoted header whose name says secret: "X-Api-Key: x", 'Cookie: a=b; c=d'. */
const HEADER_FORM = /((['"])[\w-]*?(?:key|token|secret|cookie|auth|password|session)[\w-]*\s*:\s*)(?:(?!\2).)+/giu
/** curl's user and password: -u user:secret, -uuser:secret, --user user:secret, -u "user:a b". */
const USER_QUOTED_FORM = /((?:^|\s)(?:-u\s*|--user(?:=|\s+))(['"])[^:'"]+:)[^'"]*/giu
const USER_FORM = /((?:^|\s)(?:-u\s*|--user(?:=|\s+))[^\s:'"]+:)[^\s'"]+/giu

/** The forms of a secret outside `NAME=value`, each replaced by its kept part and `***`. */
const SECRET_FORMS: readonly [RegExp, string][] = [
  // The word must be a whole part of the option's name: --author and -psecret are no such option.
  [OPTION_FORM, '$1***'],
  [PASSWORD_WORD_FORM, '$1***'],
  [HEADER_FORM, '$1***'],
  // A header or a word that carries one: Authorization: Bearer x, Bearer x, Basic x.
  [/(authorization\s*:\s*)(?:(?:bearer|basic|token|digest)\s+)?[^\s'"]+/giu, '$1***'],
  [/(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/giu, '$1***'],
  // The password of a URL: https://user:secret@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)[^\s@/]+@/giu, '$1***@'],
  [USER_QUOTED_FORM, '$1***'],
  [USER_FORM, '$1***'],
  // The password of mysql and its tools, joined to -p: mysql -psecret.
  [/(\bmysql\w*\b[^|;&\n]*?\s-p)[^\s'"]\S*/giu, '$1***'],
  // The password of docker login (podman's too) and of sshpass: -p secret.
  [new RegExp(String.raw`(\b(?:(?:docker|podman)\s+login|sshpass)\b[^|;&\n]*?\s-p\s*)${WORD}`, 'giu'), '$1***'],
  // The token forms that say what they are: GitHub, OpenAI and Anthropic, Slack, AWS.
  // Not after a letter or a digit, but after `_` too: `key_ghp_…` names one.
  [/(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abeprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])/gu, '***'],
]

/**
 * Where a program starts: at the start of the command, of a line or of a segment after `|`, `;`, `&` or `(` (`$(` too)
 * that stands outside every quote counted from the start — `'…'`, `"…"`, and the ANSI-C `$'…'`, which `\'` does not
 * end — after assignments and words that run the next one (sudo, env, xargs, time, nice, command, exec) with their
 * options. A `;rg` inside another program's quoted argument starts nothing.
 */
const PROGRAM_AT = String.raw`(?:^|^(?:[^'"\\$]|\$(?!')|\\[\s\S]|\$'(?:[^'\\]|\\[\s\S])*'|'[^']*'|"(?:[^"\\]|\\[\s\S])*")*?[|;&(\n])\s*(?:(?:[\p{L}_][\p{L}\p{N}_]*=\S*|sudo|env|xargs|time|nice|command|exec)\s+(?:-\S+\s+)*)*`
/**
 * The words between a program and the text an exception keeps: within one segment, and across no quote, `(`, `)` or
 * backquote, so the text is the program's own and not one of a command inside it (`$(curl …)`). Where it cannot
 * tell, the form stays.
 */
const IN_SEGMENT = String.raw`[^|;&\n()\x60'"]*?`
/** A program that searches text: the word after it is a pattern, not a secret. */
const SEARCH = String.raw`(?:git\s+grep|[ef]?grep|rg|ag|ack)`

/**
 * The commands the forms above hid though they hold no secret (worfy-auto-approve ticket 13): each names the
 * forms it lets through, and the text it lets them through in. A match of one of those forms is kept as it is
 * when it lies wholly inside such a text, in the command as it stands when that form runs. Each is bound to one
 * program and to the shape of the value it keeps; whatever else the text holds is hidden as before. Narrow by
 * design: where it is not sure, the form hides.
 */
const SECRET_EXCEPTIONS: readonly { forms: readonly RegExp[]; text: RegExp }[] = [
  // sort's key definition: sort --key=2, --key 2,3n.
  { forms: [OPTION_FORM], text: new RegExp(String.raw`(?<=${PROGRAM_AT}sort\b${IN_SEGMENT})\s--key(?:=|\s+)\d+(?:\.\d+)?[bdfgiMhnRrV]*(?:,\d+(?:\.\d+)?[bdfgiMhnRrV]*)?(?=\s|$)`, 'gu') },
  // The message of git commit: -m "auth: …", -am '…', --message="…". It goes into the repository's history anyway.
  { forms: [HEADER_FORM], text: new RegExp(String.raw`(?<=${PROGRAM_AT}git\s(?:${IN_SEGMENT}\s)?commit\b${IN_SEGMENT}\s(?:-[a-zA-Z]*m\s*|--message(?:=|\s+)))(?:"(?:[^"\\]|\\.)*"|'[^']*')`, 'gu') },
  // The pattern of a search, bare: grep -rn password src/.
  { forms: [PASSWORD_WORD_FORM], text: new RegExp(String.raw`(?<=${PROGRAM_AT}${SEARCH}\b${IN_SEGMENT}\s)(?:password|passwd)\s+[^\s'"]+`, 'giu') },
  // The pattern of a search, quoted, whose value is words of letters only (a type, a keyword): rg "apiKey: string".
  { forms: [HEADER_FORM], text: new RegExp(String.raw`(?<=${PROGRAM_AT}${SEARCH}\b${IN_SEGMENT}\s)(['"])[\w-]+\s*:\s*[\p{L}_ |?<>[\].]+\1`, 'gu') },
  // A numeric user and group of a container, before the image: docker run --rm -u 1000:1000 image. Only options stand
  // between the subcommand and -u: a later -u is one of the command the container runs.
  { forms: [USER_FORM, USER_QUOTED_FORM], text: new RegExp(String.raw`(?<=${PROGRAM_AT}(?:docker|podman)\s+(?:container\s+)?(?:run|exec|create)(?:\s+-[^\s'"\x60()]+)*?)\s(?:-u\s*|--user(?:=|\s+))\d+:\d+(?=\s|$)`, 'gu') },
]

/** `text` with each form of SECRET_FORMS hidden, but where SECRET_EXCEPTIONS keep it. */
function hideSecretForms(text: string): string {
  let out = text
  for (const [form, kept] of SECRET_FORMS) {
    const exceptions = SECRET_EXCEPTIONS.filter((exception) => exception.forms.includes(form))
    const spans = exceptions.flatMap((exception) => [...out.matchAll(exception.text)].map((match) => [match.index, match.index + match[0].length] as const))
    out = out.replace(form, (...args: unknown[]) => {
      // The arguments of a replacer: the match, each group (a string or undefined), then the offset.
      const whole = args[0] as string
      const at = args.findIndex((arg, n) => n > 0 && typeof arg === 'number')
      const offset = args[at] as number
      if (spans.some(([from, to]) => from <= offset && offset + whole.length <= to)) return whole
      return kept.replace(/\$(\d)/g, (_dollar: string, group: string) => {
        const value = Number(group) < at ? args[Number(group)] : undefined
        return typeof value === 'string' ? value : ''
      })
    })
  }
  return out
}

/** `text` with the value of each assignment and JSON pair whose name says secret, and each form of a secret, as `***`. */
function hideSecrets(text: string): string {
  let out = text.replace(ASSIGNMENT, (whole: string, name: string) => (secretName(name) ? `${name}=***` : whole))
  out = out.replace(JSON_PAIR, (whole: string, before: string, _slash: string, name: string, quote: string) => (secretName(name.replaceAll('-', '_')) ? `${before}${quote}***${quote}` : whole))
  return hideSecretForms(out)
}

/**
 * A command as `auto-approval` keeps it (spec of worfy-auto-approve, how it works, item 7; security,
 * item 7): the value of an assignment whose name says secret as `NAME=***`, every form of SECRET_FORMS
 * hidden but where SECRET_EXCEPTIONS keep it, the home folder as `~` (as journalReason), then at most
 * COMMAND_MAX UTF-16 units. The secrets go first, so a cut never leaves half of one.
 */
export function journalCommand(command: string, home: string): string {
  return clip(homeAsTilde(hideSecrets(command), home), COMMAND_MAX)
}

/**
 * A path as `auto-approval` keeps it in `targets`: its secrets hidden as in journalCommand (`touch <wt>/ghp_…` names a
 * token in its target), the home folder as `~`, at most COMMAND_MAX units.
 */
export function journalTarget(path: string, home: string): string {
  return clip(homeAsTilde(hideSecrets(path), home), COMMAND_MAX)
}

/**
 * The `limits` field for the Limits state `state` (LimitsTracker.snapshot); undefined when nothing
 * is known of either window, so the line goes without the field.
 */
export function journalLimits(state: LimitsState): JournalLimits | undefined {
  const window = (id: LimitWindowId): z.output<typeof claudeJournalLimitsSchema>[LimitWindowId] => {
    const known = state.windows[id]
    if (known === undefined) return null
    return { utilization: known.utilization, receivedAt: new Date(known.receivedAt).toISOString(), resetsAt: known.resetsAt === null ? null : new Date(known.resetsAt * 1000).toISOString() }
  }
  const out = { five_hour: window('five_hour'), seven_day: window('seven_day') }
  return out.five_hour === null && out.seven_day === null ? undefined : out
}

/**
 * The `limits` field of a run on a Vendor other than Claude (worfy-multi-vendor ticket 38): the
 * windows of `vendor` among `windows` (LimitsTracker.windowsOf), their times as ISO; undefined when
 * there is none, so the line goes without the field.
 */
export function journalVendorLimits(vendor: string, windows: readonly LimitWindow[]): VendorJournalLimits | undefined {
  // A value the format refuses would cost the Wave's whole line (formatJournalLine throws): a number
  // out of range is written as unknown, a window without an id or a time is left out. A time is
  // written only when it is a date of years 0–9999 (isoTime): `new Date(1e13 * 1000).toISOString()`
  // throws, and a year of six digits is outside the format.
  const known = (value: number | null, positive: boolean): number | null => (value !== null && Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : null)
  const isoOf = (ms: number | null): string | null => {
    if (ms === null || !Number.isFinite(ms)) return null
    const date = new Date(ms)
    const year = date.getUTCFullYear()
    return Number.isNaN(date.getTime()) || year < 0 || year > 9999 ? null : date.toISOString()
  }
  const own = windows.flatMap((window) => {
    const receivedAt = isoOf(window.receivedAt)
    return window.vendor === vendor && window.id !== '' && receivedAt !== null ? [{ window, receivedAt }] : []
  })
  if (own.length === 0 || vendor === '') return undefined
  return {
    windows: own.map(({ window, receivedAt }) => {
      const resetsAt = known(window.resetsAt, false)
      return {
        vendor: window.vendor,
        ...(window.provider === undefined ? {} : { provider: window.provider }),
        id: window.id,
        label: window.label,
        usedPercent: known(window.usedPercent, false),
        windowMinutes: known(window.windowMinutes, true),
        resetsAt: resetsAt === null ? null : isoOf(resetsAt * 1000),
        receivedAt,
        state: window.state,
        source: window.source,
      }
    }),
  }
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
