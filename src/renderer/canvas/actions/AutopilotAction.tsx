import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import type { LimitsState } from '../../../shared/agent/limits'
import { vendorLimitsOf, type VendorLimits } from '../../../shared/autopilot/budget-window'
import { epicForecast, remainingWaves, type EpicForecast } from '../../../shared/autopilot/forecast'
import { fitBeforeReset, forecastLine, modeLine, recommendationLine, warningLine, windowLine } from '../../../shared/autopilot/forecast-lines'
import type { RunMode, StartWindow } from '../../../shared/autopilot/run-mode'
import { MAX_QUEUE_EPICS } from '../../../shared/autopilot/epic-queue'
import {
  autopilotEstimateAnswerSchema,
  autopilotStatusLine,
  HARNESS_BEHIND_LABEL,
  harnessBehindTitle,
  queueAction,
  queueChip,
  queueTitle,
  type AutopilotEstimateAnswer,
  type AutopilotQueueEdit,
  type AutopilotState,
  type QueueEdits,
  type RunningElsewhereRefusal,
} from '../../../shared/ipc/autopilot'
import { failureReason } from '../../../shared/ipc/channels'
import { askStart, runAllAccepted } from '../../autopilot/start-modal'
import { StartNowModal, type OrchestratorBusy } from '../../autopilot/StartNowModal'
import { invoke, subscribe } from '../../ipc'
import { autopilotBudgetOf, autopilotRunOf } from '../../../shared/settings/app-settings'
import { openRunHistory } from '../../flight-recorder/open'
import { useLimits, useNow } from '../../limits/useLimits'
import { useReadOnly } from '../../projects/useProjects'
import { useAppSettings } from '../../settings/useAppSettings'
import { showToast } from '../../toast/toasts'
import { useWorkflow } from '../../workflow/useWorkflow'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { ActionMenu, type ActionMenuItem } from './action-menu'
import { hasRunWave, useRunWaveState } from './gates'

// "Autopilot" and "Stop autopilot" on an Epic frame (worfy-daily ticket 04, ADR-0024), with the
// run's status line: "Wave 3 · running", "Wave 3 · 4 background tasks" (ticket 29, ADR-0029: the
// Orchestrator's background tasks still run), "waiting for limits · resumes 14:20" (ticket 05),
// "stopping · 2 tickets in work", "stopped: no ready wave". A run that waits for the Limits or for
// background tasks is still a run: Stop is offered and stops it.
//
// Two ways to stop (worfy-week ticket 18, ADR-0051):
// - "Stop autopilot" is graceful: the run takes no new Ticket, tells the Orchestrator so, and the
//   Tickets in work finish (merge or blocked). Main answers at once; while the run is stopping the
//   button says "Stopping…" and takes no click, and the status line counts the Wave's Tickets in
//   work.
// - "Force stop", an item of the "⋯" menu right of the button, interrupts the Orchestrator and its
//   background tasks (worfy-week ticket 17, ADR-0050): main halts the turn, up to 15 s, and gives
//   the Orchestrator back with its old process closed; worktrees and branches stay. It works while
//   a graceful Stop goes on too. Until main answers, the button says "Stopping…" and the item is
//   inactive. A later Autopilot over the Epic takes the Tickets main left `resumable` that are still
//   in work into its first Wave — after a Force stop those of the Wave it interrupted; after a run
//   over named Tickets those it did not take; after a run that sent no Wave those it was given — so
//   the button is available for them too. Force stop is in "⋯" while this Epic's run is running or
//   waiting, stopping included.
//
// The entries into the Run history screen (worfy-flight-recorder ticket 20, decision 06; the screen
// opens through flight-recorder/open.ts):
// - "Run history", an item of "⋯" whenever the action is drawn: the screen with the list of Runs
//   kept to this Epic. So "⋯" is there with no run too, with this one item. An Epic with nothing to
//   start, stop or say (all its Tickets done) draws no button, but keeps "⋯" with this item when the
//   Run history has Runs of it (`runs.list`).
// - "History", right of the status line of this Epic's stopped run whose Journal main names
//   (`run`): the screen at that Run. It goes with the start of the next run. The toast of the stop
//   (flight-recorder/stop-toast.ts) opens the same.
// Autopilot can start when "Run wave" could (the same verdict, gates.ts) with a template that names
// the Wave's Tickets ({tickets}, ADR-0033), and the Project has no run. The button does not start a
// run itself: it opens the Start Autopilot window (worfy-autopilot-queue ticket 09,
// src/renderer/autopilot/StartAutopilotModal.tsx), which starts it in the Run mode chosen there, and
// stays inactive while the window is open. Main checks again and may still refuse (worfy's own
// repository in a development build, an empty "Run wave" template): the window closes, the button
// then shows main's reason, and an error toast says it too (worfy-polish ticket 50; also for "Start
// anyway", which starts at once, in the default mode). A start while the Orchestrator is busy is not
// refused: the run waits for it (ticket 07). The Project's run state
// is asked once (`autopilot.state`), then taken from `autopilot.changed`; a state replaces the one
// before it only with a higher revision.
//
// A run that waits for its Orchestrator (worfy-autopilot-queue tickets 07, 10; `waitingFor:
// 'orchestrator'`) says so in the status line, "waiting for the Orchestrator · 4 min" (the minutes
// counted at each redraw, useNow), with "Start now" and "Cancel" beside it:
// - "Cancel" ends the wait at once, with no window (`autopilot.stop`: the run stops `start-cancelled`
//   and the Orchestrator is not touched), and the toast "Autopilot cancelled; the Orchestrator was not
//   touched".
// - "Start now" opens the "Start now?" window (src/renderer/autopilot/StartNowModal.tsx) over the
//   state's live `busy`; its "Interrupt and start" sends `autopilot.startNow`, and the toast says what
//   stopped, as the window listed it at the click: "Turn interrupted, 3 background tasks stopped ·
//   Autopilot started". A start main refuses as the run takes the Orchestrator (`start-refused`) is an
//   error toast with main's words. The window closes by itself once the run no longer waits.
// The "Stop autopilot" button stays as for any run; it cancels a waiting run too.
//
// A run keeps the display on from its start to its end (ticket 32, ADR-0034): the hints of the
// "Autopilot" button and of the status line while running or waiting say so. The visible line does
// not: 220px is already taken by its longest lines.
//
// When the Harness in worfy's main is newer than the Harness of this build (worfy-harness ticket 21,
// `harnessBehind` of the state; packaged builds over worfy's own repository only), the chip "Harness
// in main is newer than the Stable copy" stands under the button, right-aligned to it (the status
// line is above), while a run goes on and when none does. Its hint counts the commits and names the
// rebuild between runs.
//
// One Autopilot per Epic and origin across the Linked machines (worfy-link ticket 15, ADR-0053, Q13):
// - While a run goes on and its Machine has Linked machines, the chip "on <Machine>" under the button
//   says which Machine runs it; its hint names the Linked machines the start could not ask.
// - A start refused because the Epic of this repository runs (or starts) on another Machine shows
//   main's reason on the button, and under it the chip "running on <Machine>" with "Start anyway"
//   beside it: out of the header's row, so they take no width from the Epic title. "Start anyway" is
//   the one way past: it starts with `override`, main asks the Linked machines again, and the journal
//   says `override` only when the start did go past a run (the other run may have ended since). The
//   refusal stays until the next start of the Project or a run of it.
// - Each button role has its own key: "Stop autopilot" after "Start anyway" is a new button, not
//   the Autopilot button with its refusal still on.
//
// The Epic forecast (worfy-resource-planner ticket 06, ADR-0093; it replaced the Wave line of
// worfy-throughput ticket 40): the hint of an active "Autopilot" ends with the Run mode the button
// starts in, the default of Settings → Autopilot ("Mode: Budget-aware (Settings → Autopilot)",
// modeLine), then the forecast line ("This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the
// week. Used now: 41%, resets in 2 d 5 h", forecastLine), then for that mode: the recommendation
// when the budget acts in it (Budget-aware, or Start window with the budget on), the Fastest warning
// when it does not, and the Start window line in Start window (forecastHint). The forecast counts the
// Waves left of the Tickets this frame holds; the samples and the Wave duration come from main, which
// reads the run journals (`autopilot.estimate`, asked when the button appears and again whenever the
// run's status changes). The Limits — "Used now" and the 30-minute freshness of the 7-day number the
// recommendation and the warning need — are the live state the toolbar shows (useLimits), not the
// window in that answer: an idle canvas asks main nothing for hours. An answer that does not parse
// leaves the hint with the mode line alone. The bootstrap runs again only when the samples or the
// Tickets change; the lines whenever the Limits, Settings or the minute do.
//
// A run over a queue of Epics (worfy-autopilot-queue ticket 17; the queue of the state, ticket 14, ADR-0100):
// - The line, on the frame of the Epic the run is on, puts its place in the queue first: "Epic 2/3: checkout ·
//   Wave 1 · running". Its tooltip lists the queue, each Epic with its status (queueTitle).
// - The frame of each other Epic of the queue has a chip under the button while the run goes on: "In queue 3/3"
//   for one not started, "Waits for owner" for one the run passed with only the owner's Tickets left, "Runs
//   elsewhere" for one another Machine ran (queueChip).
// - "⋯" has "Add to queue" on the frame of an Epic outside the queue, and "Remove from queue" on one not started,
//   while the run goes on and no Stop was asked (`autopilot.queue`). Main makes the change at once between Waves
//   and at the end of the Wave during one; the toast then says "applies after this Wave", and until the state
//   shows the change made the frame has the chip "Joins after this Wave" or "Leaves after this Wave" (the edits
//   this window made, kept per Project and run: main's state carries the queue as it is, not the edits that
//   wait). "Remove from queue" on an Epic that waits to join takes it back. Main's refusal is an error toast and
//   the title of "⋯".
// - With no run in the Project, "⋯" has "Run all accepted": the Start Autopilot window over the accepted Epics,
//   as the Command palette's (worfy-autopilot-queue ticket 16, runAllAccepted).

export const order = 30

/** Added to the hints of a run that holds keep-awake (ADR-0034). */
export const DISPLAY_STAYS_ON = 'The display stays on until the run ends'

/** The title of Stop: what it does (worfy-week ticket 18). */
const stopTitle = (epic: string): string => `Stop Autopilot over ${epic}: takes no new Tickets; the Tickets in work finish (merge or blocked)`

/** The title of the button while the run is stopping gracefully. */
const stoppingTitle = (epic: string): string => `Autopilot over ${epic} is stopping: no new Tickets; it waits for the Tickets in work. Force stop is under ⋯`

/** The title of Force stop: what it does (worfy-week tickets 17, 18). */
const forceStopTitle = (epic: string): string =>
  `Stop Autopilot over ${epic} now: interrupts the Orchestrator and its background tasks; worktrees stay. The next Autopilot takes the interrupted Tickets first`

/** The title of "Run history" in "⋯" (worfy-flight-recorder ticket 20). */
const runHistoryTitle = (epic: string): string => `Show the Autopilot Runs of ${epic}: where the time of each went`

/** The title of "History" by the status line of a stopped run. */
export const HISTORY_TITLE = 'Show the Run history of this run'

/** "History" by the status line: a text button in the link colour (F-SPEC: link / accent text), the line's 11px. */
const historyStyle: CSSProperties = { border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', textDecoration: 'underline', cursor: 'pointer', flex: 'none' }

/**
 * The widest line of a run over a queue (ticket 17): "Epic 2/3: <name> · " goes before the 220px of the line of one
 * Epic, so its Wave part stays whole for an Epic name of up to about 20 letters; a longer one ends in "…", whole in
 * the tooltip.
 */
const QUEUE_LINE_WIDTH = 340

/** The title of the button while Force stop waits for main. */
export const STOPPING_TITLE = 'Stopping Autopilot: the Orchestrator\'s turn is being interrupted'

/** A stop on its way to main: the graceful Stop (`autopilot.stop`) or Force stop (`autopilot.forceStop`). */
type StopKind = 'stop' | 'force'

interface AutopilotStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, AutopilotState>>
  /** Projects whose stop has not answered yet, and which one. */
  pending: Readonly<Record<string, StopKind>>
  /** By projectId: the last start refused for a run of its Epic on another Machine (worfy-link ticket 15). */
  elsewhere: Readonly<Record<string, RunningElsewhereRefusal>>
  /** By projectId: the edits of the queue this window made that wait for the end of the Wave, and the run they are for. */
  edits: Readonly<Record<string, QueueEdits & { run: string | null }>>
}

const useAutopilotStore = create<AutopilotStore>(() => ({ byProject: {}, pending: {}, elsewhere: {}, edits: {} }))

/** No edit of the queue waits. */
const NO_EDITS: QueueEdits = { add: [], remove: [] }

/**
 * The edits of the Project's queue that still wait once `state` is the run's: those the queue shows made leave,
 * and all of them once the run has stopped or another run began (main drops the edits not made at a stop).
 */
function settleEdits(state: AutopilotState): void {
  useAutopilotStore.setState(({ edits }) => {
    const own = edits[state.projectId]
    if (own === undefined) return {}
    const queue = (state.queue ?? []).map((each) => each.epic)
    const add = own.add.filter((epic) => !queue.includes(epic))
    const remove = own.remove.filter((epic) => queue.includes(epic))
    const next = { ...edits }
    if (state.status === 'stopped' || (state.run ?? null) !== own.run || add.length + remove.length === 0) delete next[state.projectId]
    else next[state.projectId] = { run: own.run, add, remove }
    return { edits: next }
  })
}

/** Keeps an edit of the run's queue that waits for the end of the Wave (`add` or `remove` one Epic), or drops a waiting addition (`unadd`). */
function noteEdit(state: AutopilotState, kind: 'add' | 'remove' | 'unadd', epic: string): void {
  useAutopilotStore.setState(({ edits }) => {
    const own = edits[state.projectId] ?? { run: state.run ?? null, add: [], remove: [] }
    const without = (list: readonly string[]) => list.filter((each) => each !== epic)
    const changed =
      kind === 'add' ? { ...own, add: [...without(own.add), epic] } : kind === 'remove' ? { ...own, remove: [...without(own.remove), epic] } : { ...own, add: without(own.add) }
    return { edits: { ...edits, [state.projectId]: changed } }
  })
}

function setElsewhere(projectId: string, refusal: RunningElsewhereRefusal | null): void {
  useAutopilotStore.setState(({ elsewhere }) => {
    if (refusal === null && elsewhere[projectId] === undefined) return {}
    const next = { ...elsewhere }
    if (refusal === null) delete next[projectId]
    else next[projectId] = refusal
    return { elsewhere: next }
  })
}

function setPending(projectId: string, kind: StopKind, on: boolean): void {
  useAutopilotStore.setState(({ pending }) => {
    // An answer clears only its own kind: a Force stop sent while Stop was on its way stays pending.
    if (!on && pending[projectId] !== kind) return {}
    const next = { ...pending }
    if (on) next[projectId] = kind
    else delete next[projectId]
    return { pending: next }
  })
}

const asked = new Set<string>()
let subscribed = false

function take(state: AutopilotState): void {
  // A run of the Project goes on: a refusal from before it is over.
  if (state.status !== 'stopped') setElsewhere(state.projectId, null)
  const known = useAutopilotStore.getState().byProject[state.projectId]
  if (known !== undefined && known.revision >= state.revision) return
  useAutopilotStore.setState(({ byProject }) => ({ byProject: { ...byProject, [state.projectId]: state } }))
  settleEdits(state)
}

function ensure(projectId: string): void {
  if (!subscribed) {
    subscribed = true
    try {
      subscribe('autopilot.changed', take)
    } catch (error) {
      subscribed = false
      console.error('autopilot.changed: cannot subscribe', error)
    }
  }
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('autopilot.state', { projectId }).then((result) => {
    if (result.ok) take(result.value)
    else {
      asked.delete(projectId)
      console.error('autopilot.state failed:', result.error)
    }
  })
}

function useAutopilot(projectId: string): AutopilotState | undefined {
  useEffect(() => ensure(projectId), [projectId])
  return useAutopilotStore((store) => store.byProject[projectId])
}

/**
 * Starts a run; its first state is taken at once. Resolves to main's reason when refused; a refusal
 * for a run on another Machine is kept for "Start anyway". `override` is that button's start; `mode`
 * the Run mode chosen in the Start Autopilot window (absent: the default of Settings, in main).
 */
async function start(projectId: string, epic: string, override = false, mode?: RunMode): Promise<string | undefined> {
  setElsewhere(projectId, null)
  const result = await invoke('autopilot.start', { projectId, epic, ...(override ? { override } : {}), ...(mode === undefined ? {} : { mode }) })
  if (!result.ok) return refused(projectId, failureReason('autopilot.start', result.error))
  if ('runningElsewhere' in result.value) {
    setElsewhere(projectId, result.value.runningElsewhere)
    return refused(projectId, result.value.runningElsewhere.message)
  }
  take(result.value)
  return undefined
}

/** The key and `data-testid` of the toast of a refused start (worfy-polish ticket 50). */
const START_REFUSED_TOAST = 'autopilot-start-refused'

/**
 * A refused start is an error toast with main's reason too, not only the button's tooltip, which
 * no one sees without hovering (worfy-polish ticket 50). One toast per Project: a new refusal
 * replaces it.
 */
function refused(projectId: string, reason: string): string {
  showToast({ kind: 'error', key: `${START_REFUSED_TOAST}:${projectId}`, testId: START_REFUSED_TOAST, projectId, text: reason })
  return reason
}

/** What the chip of the run's Machine says on hover; the Linked machines not asked, when any. */
function machineTitle(state: AutopilotState, name: string): string {
  const unasked = state.unasked ?? []
  const asked = unasked.length > 0 ? `. Could not ask ${unasked.join(', ')} whether they run it` : ''
  return `${name} runs Autopilot over ${state.epic ?? ''}${asked}`
}

/** The title of "Start anyway". */
const startAnywayTitle = (epic: string, machine: string): string =>
  `Start Autopilot over ${epic} here although ${machine} runs it: both runs take the same Tickets`

/**
 * "Start anyway": the shared action button, 18px tall to fit the chip row under the header's
 * buttons (the 18px of the header below them). Inactive while its start is in flight; a refused
 * start shows main's reason, as any action button.
 */
function StartAnyway({ enabled, title, run }: { enabled: boolean; title: string; run: () => Promise<string | undefined> }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = enabled && !running
  return (
    <button
      type="button"
      className="w-action nodrag"
      style={{ height: 18, lineHeight: '16px' }}
      aria-disabled={active ? 'false' : 'true'}
      title={error ?? title}
      data-testid="action-autopilot-anyway"
      data-error={error ?? undefined}
      onClick={() => {
        if (!active) return
        setRunning(true)
        setError(null)
        void run()
          .then((failure) => setError(failure ?? null))
          .finally(() => setRunning(false))
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      Start anyway
    </button>
  )
}


/**
 * Stops the Project's run; the state main answers is taken at once. The graceful Stop answers as
 * soon as the run is stopping; Force stop once the Orchestrator's turn is interrupted and the
 * Orchestrator given back. Meanwhile the button is "Stopping…". A stop of the same kind, or any
 * stop while Force stop is on its way, asks main nothing more.
 */
async function stop(projectId: string, kind: StopKind): Promise<string | undefined> {
  const pending = useAutopilotStore.getState().pending[projectId]
  if (pending === kind || pending === 'force') return undefined
  setPending(projectId, kind, true)
  const channel = kind === 'force' ? 'autopilot.forceStop' : 'autopilot.stop'
  try {
    const result = await invoke(channel, { projectId })
    if (!result.ok) return failureReason(channel, result.error)
    take(result.value)
    return undefined
  } finally {
    setPending(projectId, kind, false)
  }
}

const noRun = (): Promise<undefined> => Promise.resolve(undefined)

/** The key and `data-testid` of the toasts of "Start now" and "Cancel" in the line of a run that waits for its Orchestrator (ticket 10). */
const WAIT_TOAST = 'autopilot-wait'

/** The toast of "Cancel" in that line. */
const WAIT_CANCELLED_TEXT = 'Autopilot cancelled; the Orchestrator was not touched'

/** The toast of "Start now": what it stopped, as the "Start now?" window listed it at the click. */
function startNowText(busy: OrchestratorBusy): string {
  const tasks = busy.tasks.length
  const stopped = [...(busy.turn ? ['Turn interrupted'] : []), ...(tasks > 0 ? [`${tasks} background ${tasks === 1 ? 'task' : 'tasks'} stopped`] : [])]
  return [...(stopped.length > 0 ? [stopped.join(', ')] : []), 'Autopilot started'].join(' · ')
}

function waitToast(projectId: string, kind: 'info' | 'success' | 'error', text: string): void {
  showToast({ kind, key: `${WAIT_TOAST}:${projectId}`, testId: WAIT_TOAST, projectId, text })
}

/** "Cancel" of the line: the waiting run stops `start-cancelled`; its Orchestrator is not touched. */
async function cancelWait(projectId: string): Promise<void> {
  const result = await invoke('autopilot.stop', { projectId })
  if (!result.ok) {
    waitToast(projectId, 'error', failureReason('autopilot.stop', result.error))
    return
  }
  take(result.value)
  // The Orchestrator was free first and the run had started: the click was a graceful Stop, and the line says so.
  if (result.value.reason === 'start-cancelled') waitToast(projectId, 'info', WAIT_CANCELLED_TEXT)
}

/** "Interrupt and start" of the "Start now?" window: the run takes its Orchestrator at once; `busy` is what the window listed. */
async function startNow(projectId: string, busy: OrchestratorBusy): Promise<void> {
  const result = await invoke('autopilot.startNow', { projectId })
  if (!result.ok) {
    waitToast(projectId, 'error', failureReason('autopilot.startNow', result.error))
    return
  }
  const state = result.value
  take(state)
  if (state.status === 'stopped') waitToast(projectId, 'error', `Autopilot did not start: ${state.message ?? (state.reason ?? 'stopped').replaceAll('-', ' ')}`)
  else if (state.waitingFor !== 'orchestrator') waitToast(projectId, 'success', startNowText(busy))
}

/** The key and `data-testid` of the toasts of "Add to queue" and "Remove from queue" (ticket 17). */
const QUEUE_TOAST = 'autopilot-queue'

/** What the toast of an edit made during a Wave adds: main makes it at the Wave's end. */
export const AFTER_THIS_WAVE = 'applies after this Wave'

function queueToast(projectId: string, kind: 'info' | 'success' | 'error', text: string): void {
  showToast({ kind, key: `${QUEUE_TOAST}:${projectId}`, testId: QUEUE_TOAST, projectId, text })
}

/**
 * "Add to queue" and "Remove from queue" of "⋯": `autopilot.queue` with one Epic. The state main answers is taken;
 * an edit it does not show made waits for the end of the Wave and is kept (noteEdit) with the toast "… · applies
 * after this Wave". Resolves to main's refusal, which an error toast says too.
 */
async function editQueue(projectId: string, edit: AutopilotQueueEdit): Promise<string | undefined> {
  const result = await invoke('autopilot.queue', { projectId, ...edit })
  if (!result.ok) {
    const reason = failureReason('autopilot.queue', result.error)
    queueToast(projectId, 'error', reason)
    return reason
  }
  // A waiting addition taken back: main dropped it, and the queue never had it.
  const takenBack = edit.remove !== undefined && (useAutopilotStore.getState().edits[projectId]?.add.includes(edit.remove) ?? false)
  take(result.value)
  // The newest state: an `autopilot.changed` with the change made may have come before this answer.
  const state = useAutopilotStore.getState().byProject[projectId] ?? result.value
  const queue = (state.queue ?? []).map((each) => each.epic)
  if (edit.add !== undefined) {
    if (queue.includes(edit.add)) queueToast(projectId, 'success', `Added ${edit.add} to the queue`)
    else {
      noteEdit(state, 'add', edit.add)
      queueToast(projectId, 'info', `Added ${edit.add} to the queue · ${AFTER_THIS_WAVE}`)
    }
  }
  if (edit.remove !== undefined) {
    if (takenBack) {
      noteEdit(state, 'unadd', edit.remove)
      queueToast(projectId, 'success', `${edit.remove} will not join the queue`)
    } else if (!queue.includes(edit.remove)) queueToast(projectId, 'success', `Removed ${edit.remove} from the queue`)
    else {
      noteEdit(state, 'remove', edit.remove)
      queueToast(projectId, 'info', `Removed ${edit.remove} from the queue · ${AFTER_THIS_WAVE}`)
    }
  }
  return undefined
}

/** The titles of the queue's items of "⋯". */
const addToQueueTitle = (epic: string, running: string): string => `Run ${epic} after the queue of the Autopilot over ${running}: it joins the end of the queue between Waves`
const removeFromQueueTitle = (epic: string): string => `Take ${epic} out of the Autopilot queue before it starts: between Waves`
const QUEUE_FULL_TITLE = `The queue holds ${MAX_QUEUE_EPICS} Epics at most`
const RUN_ALL_ACCEPTED_TITLE = 'Autopilot over the accepted Epics, one after another: the Start Autopilot window lists them first'

/** The titles of "Start now" and "Cancel" in the line of a run that waits for its Orchestrator. */
const START_NOW_TITLE = 'Start Autopilot now: shows what it interrupts first'
const CANCEL_WAIT_TITLE = 'Cancel this Autopilot: it has not started, and the Orchestrator is not touched'

/** "· Start now · Cancel" after the status line of a run that waits for its Orchestrator; `title` is the read-only reason, when there is one. */
function WaitButtons({ enabled, title, onStartNow, onCancel }: { enabled: boolean; title: string | null; onStartNow: () => void; onCancel: () => void }) {
  const dot = (
    <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
      ·
    </span>
  )
  // Text buttons as "History", greyed while off.
  const style: CSSProperties = enabled ? historyStyle : { ...historyStyle, color: 'var(--text-muted)', textDecoration: 'none', cursor: 'default' }
  const button = (testId: string, label: string, hint: string, run: () => void) => (
    <button
      type="button"
      className="nodrag"
      data-testid={testId}
      aria-disabled={enabled ? 'false' : 'true'}
      title={title ?? hint}
      style={style}
      onClick={() => {
        if (enabled) run()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {label}
    </button>
  )
  return (
    <>
      {dot}
      {button('autopilot-start-now', 'Start now', START_NOW_TITLE, onStartNow)}
      {dot}
      {button('autopilot-cancel-wait', 'Cancel', CANCEL_WAIT_TITLE, onCancel)}
    </>
  )
}

/** What the hint's forecast reads of Settings → Autopilot. */
interface HintSettings {
  /** The default Run mode: the button starts in it. */
  mode: RunMode
  window: StartWindow
  /** Whether "Daily budget of the Limits" is on: the budget acts in Start window only then. */
  budgetOn: boolean
  /** The reserve of the week, 0..1. */
  reserve: number
}

/**
 * The end of the Autopilot button's hint: the mode line, then with an answer of main the forecast
 * line over the live `limits` and, for the mode, the recommendation (the budget acts), the Fastest warning (it does not) and
 * the Start window line. A line with nothing to say is left out. `vendor`: the live windows of the
 * Vendor the answer names (a Project whose Orchestrator is not Claude, worfy-multi-vendor ticket 38);
 * the lines then read its longest window instead of Claude's 7-day one.
 */
function forecastHint(answer: AutopilotEstimateAnswer | null, forecast: EpicForecast | null, limits: LimitsState, settings: HintSettings, now: number, vendor?: VendorLimits): string[] {
  const lines = [modeLine(settings.mode)]
  if (answer === null || forecast === null) return lines
  const own = vendor === undefined ? {} : { vendor }
  lines.push(forecastLine({ forecast, limits, now, ...own }))
  const budgetActs = settings.mode === 'budget-aware' || (settings.mode === 'start-window' && settings.budgetOn)
  const advice = budgetActs
    ? recommendationLine(fitBeforeReset({ forecast, limits, now, reserve: settings.reserve, ...own }), forecast.waves)
    : warningLine(fitBeforeReset({ forecast, limits, now, reserve: null, ...own }), forecast.waves)
  if (advice !== null) lines.push(advice)
  if (settings.mode === 'start-window') lines.push(windowLine(settings.window, answer.durations))
  return lines
}

/**
 * The Project's estimate answer, asked once per `key`; null until main answers or when it fails. The
 * hint reads its samples and Wave duration only: the Limits are live (useLimits).
 */
function useWaveEstimate(projectId: string, key: string): AutopilotEstimateAnswer | null {
  const [answer, setAnswer] = useState<AutopilotEstimateAnswer | null>(null)
  useEffect(() => {
    let active = true
    void invoke('autopilot.estimate', { projectId }).then((result) => {
      if (!active) return
      const parsed = result.ok ? autopilotEstimateAnswerSchema.safeParse(result.value) : null
      setAnswer(parsed?.success === true ? parsed.data : null)
    })
    return () => {
      active = false
    }
  }, [projectId, key])
  return answer
}

/**
 * Whether the Epic has Runs in the Project's Run history (`runs.list`), asked while `ask` holds:
 * the frame of an Epic without the button keeps "⋯" with "Run history" only then. Asked again when
 * `ask` comes back; false until main answers, and when it fails.
 */
function usePastRuns(projectId: string, epic: string, ask: boolean): boolean {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (!ask) return
    let active = true
    void invoke('runs.list', { projectId, epic }).then((result) => {
      const runs: unknown = result.ok ? result.value.runs : undefined
      if (active) setHas(Array.isArray(runs) && runs.length > 0)
    })
    return () => {
      active = false
    }
  }, [projectId, epic, ask])
  return ask && has
}

function Autopilot({ projectId, root, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const state = useAutopilot(projectId)
  const mine = state?.epic === epic.epic
  // The edits of the run's queue that wait for the end of the Wave, and what they and the queue say of this Epic (ticket 17).
  const edits = useAutopilotStore((store) => store.edits[projectId]) ?? NO_EDITS
  const chip = state === undefined ? null : queueChip(state, epic.epic, edits)
  // The accepted Epics of "Run all accepted" come from the workflow model.
  const { model } = useWorkflow(root)
  // Only the frame of the Epic being stopped says so.
  const pendingKind = useAutopilotStore((store) => store.pending[projectId])
  const pending = mine ? pendingKind : undefined
  const running = state?.status === 'running' || state?.status === 'waiting'
  const stopping = running && state?.stopping === true
  // After a stopped run of this Epic, the Tickets it left resumable count as ready while still in work.
  const wave = useRunWaveState(projectId, epic.epic, tickets, true, mine && !running ? (state?.resumable ?? []) : [])
  const line = mine && state !== undefined ? autopilotStatusLine(state) : null
  const refusal = useAutopilotStore((store) => store.elsewhere[projectId])
  const refused = refusal !== undefined && refusal.epic === epic.epic && !running ? refusal : undefined
  // On a read-only screen (worfy-link ticket 25) starting and stopping are inactive; the state shows.
  const readOnly = useReadOnly()
  // Before main's first state the Project counts as without a run: that state asks again only when it is a run.
  const estimate = useWaveEstimate(projectId, state?.status ?? 'stopped')
  const now = useNow()
  // The Limits as the toolbar shows them, kept current by limits.changed: Claude's, and the windows of
  // the Vendor the estimate names when the Project's Orchestrator runs on another one (ticket 38).
  const view = useLimits()
  const limits = view.claude
  const vendorId = estimate?.vendor
  const vendorWindows = vendorId === undefined ? undefined : view.vendors[vendorId]
  const vendor = useMemo(() => (vendorId === undefined ? undefined : vendorLimitsOf(vendorId, vendorWindows)), [vendorId, vendorWindows])
  // Each field alone: a selector that builds an object would give a new one on every read.
  const mode = useAppSettings((settings) => autopilotRunOf(settings).mode)
  const windowFrom = useAppSettings((settings) => autopilotRunOf(settings).window.from)
  const windowTo = useAppSettings((settings) => autopilotRunOf(settings).window.to)
  const budgetOn = useAppSettings((settings) => autopilotBudgetOf(settings).enabled)
  const reservePercent = useAppSettings((settings) => autopilotBudgetOf(settings).reservePercent)
  const samples = estimate?.samples ?? null
  // The bootstrap of FORECAST_DRAWS draws: once per change of the samples or the Tickets, not on every redraw.
  const forecast = useMemo(() => (samples === null ? null : epicForecast({ samples, waves: remainingWaves(tickets, epic.epic) })), [samples, tickets, epic.epic])
  const hint = useMemo(
    () => (wave.enabled ? forecastHint(estimate, forecast, limits, { mode, window: { from: windowFrom, to: windowTo }, budgetOn, reserve: reservePercent / 100 }, now, vendor) : null),
    [wave.enabled, estimate, forecast, limits, mode, windowFrom, windowTo, budgetOn, reservePercent, now, vendor],
  )
  // Nothing to start, stop or say: the button is not drawn, and "⋯" only for an Epic with past Runs.
  const hidden = !hasRunWave(epic.epic, tickets) && !(mine && running) && line === null && pending === undefined && refused === undefined && chip === null
  const pastRuns = usePastRuns(projectId, epic.epic, hidden)
  // A run of this Epic that waits for its Orchestrator: "Start now" and "Cancel" in the line (ticket 10).
  const wait = mine && state?.status === 'waiting' && state.waitingFor === 'orchestrator' && state.busy !== undefined ? { busy: state.busy, since: state.waitingSince ?? 0 } : null
  // The wait the "Start now?" window was opened for: it shows while that wait goes on.
  const [askedFor, setAskedFor] = useState<number | null>(null)
  // "Start now" or "Cancel" on its way to main.
  const [acting, setActing] = useState(false)
  if (hidden && !pastRuns) return null

  const button =
    pending !== undefined || (mine && stopping) ? (
      <ActionButton key="action-stop-autopilot" label="Stopping…" testId="action-stop-autopilot" enabled={false} title={pending === 'force' ? STOPPING_TITLE : stoppingTitle(epic.epic)} run={noRun} />
    ) : mine && running ? (
      <ActionButton
        key="action-stop-autopilot"
        label="Stop autopilot"
        testId="action-stop-autopilot"
        enabled={readOnly === null}
        title={readOnly ?? stopTitle(epic.epic)}
        run={() => stop(projectId, 'stop')}
      />
    ) : (
      <ActionButton
        key="action-autopilot"
        label="Autopilot"
        testId="action-autopilot"
        enabled={readOnly === null && !running && wave.enabled}
        title={
          readOnly !== null
            ? readOnly
            : running
            ? `Autopilot is ${stopping ? 'stopping' : 'running'} Epic ${state?.epic ?? ''}`
            : wave.enabled
              ? `Run the Waves of ${epic.epic} one after another, without a person. ${DISPLAY_STAYS_ON}${hint === null ? '' : `. ${hint.join('. ')}`}`
              : wave.reason
        }
        run={() => askStart({ projectId, epics: [epic.epic], from: 'canvas', start: (chosen) => start(projectId, epic.epic, false, chosen) })}
      />
    )
  // "⋯" right of the button: Force stop while this Epic's run goes on (stopping included), and
  // "Run history" always — reading the Runs changes nothing, so a read-only screen has it too.
  const runHistory: ActionMenuItem = {
    label: 'Run history',
    title: runHistoryTitle(epic.epic),
    testId: 'action-run-history',
    disabled: false,
    run: () => {
      void openRunHistory(projectId, undefined, epic.epic)
      return Promise.resolve(undefined)
    },
  }
  const forceStop: ActionMenuItem = {
    label: 'Force stop',
    title: readOnly ?? forceStopTitle(epic.epic),
    testId: 'action-force-stop-autopilot',
    disabled: readOnly !== null || pending === 'force',
    run: () => stop(projectId, 'force'),
  }
  // The queue of the Project's run (ticket 17): "Add to queue" or "Remove from queue" while it goes on; "Run all
  // accepted" while none does. Not on a frame drawn only for its Run history.
  const queueItems: ActionMenuItem[] = []
  // The frame of an Epic with nothing left keeps Run history alone.
  const edit = hidden ? 'none' : queueAction(state, epic.epic, edits)
  if (edit === 'add') {
    const full = (state?.queue?.length ?? 1) + edits.add.length >= MAX_QUEUE_EPICS
    queueItems.push({
      label: 'Add to queue',
      title: readOnly ?? (full ? QUEUE_FULL_TITLE : addToQueueTitle(epic.epic, state?.epic ?? '')),
      testId: 'action-queue-add',
      disabled: readOnly !== null || full,
      run: () => editQueue(projectId, { add: epic.epic }),
    })
  } else if (edit === 'remove') {
    queueItems.push({
      label: 'Remove from queue',
      title: readOnly ?? removeFromQueueTitle(epic.epic),
      testId: 'action-queue-remove',
      disabled: readOnly !== null,
      run: () => editQueue(projectId, { remove: epic.epic }),
    })
  } else if (edit === null && !running) {
    const usable = model !== undefined && model.error === null ? model : null
    queueItems.push({
      label: 'Run all accepted',
      title: readOnly ?? (usable === null ? 'The workflow of the Project cannot be read' : RUN_ALL_ACCEPTED_TITLE),
      testId: 'action-run-all-accepted',
      disabled: readOnly !== null || usable === null,
      run: () => Promise.resolve(usable === null ? undefined : runAllAccepted(projectId, usable)),
    })
  }
  const more = (
    <ActionMenu
      label={`More Autopilot actions for ${epic.epic}`}
      title="More Autopilot actions"
      testId="action-autopilot-more"
      menuLabel={`Autopilot over ${epic.epic}`}
      items={[...(mine && running ? [forceStop] : []), ...queueItems, runHistory]}
    />
  )
  if (hidden) return <div className="nodrag" style={{ flex: 'none' }}>{more}</div>
  // "History" by the status line of this Epic's stopped run, until the next run starts.
  const shownRun = mine && state?.status === 'stopped' ? (state.run ?? null) : null
  // One structure in every state: a button that moved to another parent would be made anew and lose
  // the reason it shows (ActionButton keeps it), as when a refusal adds the chip row under it.
  const controls = (
    <div className="nodrag" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      {button}
      {more}
    </div>
  )
  const behind = state?.harnessBehind ?? null
  const ledBy = mine && running && state !== undefined ? (state.machine ?? null) : null
  // The line of a run over a queue: its place first, the queue in its tooltip (ticket 17).
  const inQueue = (state?.queue?.length ?? 0) > 1
  const queueList = mine && state !== undefined ? queueTitle(state, edits) : null
  // The status line goes above the button, out of the header's row: it takes no width from the
  // Epic's title, and runs left over the actions beside the button through the header's top margin
  // (56px header: the 20px button centred, 18px free above it). It stays inside the header: below
  // it, a Node placed over the Epic's frame (the Orchestrator lands at 40,40 of the Canvas) would
  // be under the line. 220px holds the longest lines whole, "waiting for limits · resumes 14:20"
  // and "Wave 1 · 2 background tasks" (test/e2e/autopilot.spec.ts checks both).
  // The Harness chip (worfy-harness ticket 21) goes the same way under the button, in the 18px
  // free below it, the chip's own height: out of the row, whole, under the actions beside the button.
  return (
    <div className="nodrag" style={{ flex: 'none', position: 'relative' }}>
      {controls}
      {line === null ? null : (
        <div style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 2px)', display: 'flex', gap: 'var(--space-1)', fontSize: 'var(--text-11)', lineHeight: '14px', whiteSpace: 'nowrap' }}>
          <span
            data-testid="autopilot-status"
            data-status={state?.status}
            title={[state?.message ?? (running ? `${line}. ${DISPLAY_STAYS_ON}` : line), ...(queueList === null ? [] : [queueList])].join('\n')}
            style={{ minWidth: 0, maxWidth: inQueue ? QUEUE_LINE_WIDTH : 220, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }}
          >
            {line}
          </span>
          {wait === null ? null : (
            <WaitButtons
              enabled={readOnly === null && !acting}
              title={readOnly}
              onStartNow={() => setAskedFor(wait.since)}
              onCancel={() => {
                setActing(true)
                void cancelWait(projectId).finally(() => setActing(false))
              }}
            />
          )}
          {shownRun === null ? null : (
            <button
              type="button"
              className="nodrag"
              data-testid="autopilot-history"
              title={HISTORY_TITLE}
              style={historyStyle}
              onClick={() => void openRunHistory(projectId, shownRun)}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              History
            </button>
          )}
        </div>
      )}
      {behind === null && ledBy === null && refused === undefined && chip === null ? null : (
        <div style={{ position: 'absolute', right: 0, top: '100%', display: 'flex', gap: 'var(--space-1)' }}>
          {chip === null ? null : (
            <span className={`w-chip w-chip--${chip.tone}`} data-testid="autopilot-queue-chip" data-epic={epic.epic} title={chip.title} style={{ whiteSpace: 'nowrap' }}>
              {chip.label}
            </span>
          )}
          {ledBy === null || state === undefined ? null : (
            <span className="w-chip w-chip--working" data-testid="autopilot-machine" title={machineTitle(state, ledBy.name)}>
              on {ledBy.name}
            </span>
          )}
          {refused === undefined ? null : (
            <span className="w-chip w-chip--blocked" data-testid="autopilot-elsewhere" title={refused.message}>
              running on {refused.machine}
            </span>
          )}
          {refused === undefined ? null : (
            <StartAnyway
              enabled={readOnly === null && wave.enabled}
              title={readOnly ?? (wave.enabled ? startAnywayTitle(epic.epic, refused.machine) : wave.reason)}
              run={() => start(projectId, epic.epic, true)}
            />
          )}
          {behind === null ? null : (
            <span className="w-chip w-chip--open" data-testid="autopilot-harness-behind" title={harnessBehindTitle(behind)}>
              {HARNESS_BEHIND_LABEL}
            </span>
          )}
        </div>
      )}
      {wait === null || askedFor !== wait.since ? null : (
        <StartNowModal
          epic={epic.epic}
          busy={wait.busy}
          starting={acting}
          onCancel={() => setAskedFor(null)}
          onStart={() => {
            setActing(true)
            void startNow(projectId, wait.busy).finally(() => {
              setActing(false)
              setAskedFor(null)
            })
          }}
        />
      )}
    </div>
  )
}

export default function AutopilotAction({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <Autopilot {...subject} /> : null
}
