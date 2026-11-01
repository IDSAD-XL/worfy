import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import type { LimitsState } from '../../../shared/agent/limits'
import { epicForecast, remainingWaves, type EpicForecast } from '../../../shared/autopilot/forecast'
import { fitBeforeReset, forecastLine, modeLine, recommendationLine, warningLine, windowLine } from '../../../shared/autopilot/forecast-lines'
import type { RunMode, StartWindow } from '../../../shared/autopilot/run-mode'
import {
  autopilotEstimateAnswerSchema,
  autopilotStatusLine,
  HARNESS_BEHIND_LABEL,
  harnessBehindTitle,
  type AutopilotEstimateAnswer,
  type AutopilotState,
  type RunningElsewhereRefusal,
} from '../../../shared/ipc/autopilot'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, subscribe } from '../../ipc'
import { autopilotBudgetOf, autopilotRunOf } from '../../../shared/settings/app-settings'
import { openRunHistory } from '../../flight-recorder/open'
import { useLimits, useNow } from '../../limits/useLimits'
import { useReadOnly } from '../../projects/useProjects'
import { useAppSettings } from '../../settings/useAppSettings'
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
//   kept to this Epic. So "⋯" is there with no run too, with this one item.
// - "History", right of the status line of this Epic's stopped run whose Journal main names
//   (`run`): the screen at that Run. It goes with the start of the next run. The toast of the stop
//   (flight-recorder/stop-toast.ts) opens the same.
// Autopilot can start when "Run wave" could (the same verdict, gates.ts) with a template that names
// the Wave's Tickets ({tickets}, ADR-0033), and the Project has no run; main checks again and may still refuse (the Orchestrator is in a turn, worfy's own
// repository in a development build): the button then shows main's reason. The Project's run state
// is asked once (`autopilot.state`), then taken from `autopilot.changed`; a state replaces the one
// before it only with a higher revision.
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
}

const useAutopilotStore = create<AutopilotStore>(() => ({ byProject: {}, pending: {}, elsewhere: {} }))

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
  useAutopilotStore.setState(({ byProject }) => {
    const known = byProject[state.projectId]
    if (known !== undefined && known.revision >= state.revision) return {}
    return { byProject: { ...byProject, [state.projectId]: state } }
  })
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
 * for a run on another Machine is kept for "Start anyway". `override` is that button's start.
 */
async function start(projectId: string, epic: string, override = false): Promise<string | undefined> {
  setElsewhere(projectId, null)
  const result = await invoke('autopilot.start', override ? { projectId, epic, override } : { projectId, epic })
  if (!result.ok) return failureReason('autopilot.start', result.error)
  if ('runningElsewhere' in result.value) {
    setElsewhere(projectId, result.value.runningElsewhere)
    return result.value.runningElsewhere.message
  }
  take(result.value)
  return undefined
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
 * the Start window line. A line with nothing to say is left out.
 */
function forecastHint(answer: AutopilotEstimateAnswer | null, forecast: EpicForecast | null, limits: LimitsState, settings: HintSettings, now: number): string[] {
  const lines = [modeLine(settings.mode)]
  if (answer === null || forecast === null) return lines
  lines.push(forecastLine({ forecast, limits, now }))
  const budgetActs = settings.mode === 'budget-aware' || (settings.mode === 'start-window' && settings.budgetOn)
  const advice = budgetActs
    ? recommendationLine(fitBeforeReset({ forecast, limits, now, reserve: settings.reserve }), forecast.waves)
    : warningLine(fitBeforeReset({ forecast, limits, now, reserve: null }), forecast.waves)
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

function Autopilot({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const state = useAutopilot(projectId)
  const mine = state?.epic === epic.epic
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
  // The Limits as the toolbar shows them, kept current by limits.changed.
  const limits = useLimits()
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
    () => (wave.enabled ? forecastHint(estimate, forecast, limits, { mode, window: { from: windowFrom, to: windowTo }, budgetOn, reserve: reservePercent / 100 }, now) : null),
    [wave.enabled, estimate, forecast, limits, mode, windowFrom, windowTo, budgetOn, reservePercent, now],
  )
  if (!hasRunWave(epic.epic, tickets) && !(mine && running) && line === null && pending === undefined && refused === undefined) return null

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
        run={() => start(projectId, epic.epic)}
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
  const more = (
    <ActionMenu
      label={`More Autopilot actions for ${epic.epic}`}
      title="More Autopilot actions"
      testId="action-autopilot-more"
      menuLabel={`Autopilot over ${epic.epic}`}
      items={mine && running ? [forceStop, runHistory] : [runHistory]}
    />
  )
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
            title={state?.message ?? (running ? `${line}. ${DISPLAY_STAYS_ON}` : line)}
            style={{ minWidth: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }}
          >
            {line}
          </span>
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
      {behind === null && ledBy === null && refused === undefined ? null : (
        <div style={{ position: 'absolute', right: 0, top: '100%', display: 'flex', gap: 'var(--space-1)' }}>
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
    </div>
  )
}

export default function AutopilotAction({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <Autopilot {...subject} /> : null
}
