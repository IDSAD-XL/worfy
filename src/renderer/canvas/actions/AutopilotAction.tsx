import { useEffect } from 'react'
import { create } from 'zustand'
import { autopilotStatusLine, HARNESS_BEHIND_LABEL, harnessBehindTitle, type AutopilotState } from '../../../shared/ipc/autopilot'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, subscribe } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { ActionMenu } from './action-menu'
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
// - "Force stop", the one item of the "⋯" menu right of Stop, interrupts the Orchestrator and its
//   background tasks (worfy-week ticket 17, ADR-0050): main halts the turn, up to 15 s, and gives
//   the Orchestrator back with its old process closed; worktrees and branches stay. It works while
//   a graceful Stop goes on too. Until main answers, the button says "Stopping…" and the item is
//   inactive. A later Autopilot over the Epic takes the interrupted Wave's Tickets that are still in
//   work into its first Wave (`resumable`, only after Force stop), so the button is available for
//   them too. "⋯" is there while this Epic's run is running or waiting, stopping included.
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

/** The title of the button while Force stop waits for main. */
export const STOPPING_TITLE = 'Stopping Autopilot: the Orchestrator\'s turn is being interrupted'

/** A stop on its way to main: the graceful Stop (`autopilot.stop`) or Force stop (`autopilot.forceStop`). */
type StopKind = 'stop' | 'force'

interface AutopilotStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, AutopilotState>>
  /** Projects whose stop has not answered yet, and which one. */
  pending: Readonly<Record<string, StopKind>>
}

const useAutopilotStore = create<AutopilotStore>(() => ({ byProject: {}, pending: {} }))

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

/** Starts a run; its first state is taken at once. Resolves to main's reason when refused. */
async function start(projectId: string, epic: string): Promise<string | undefined> {
  const result = await invoke('autopilot.start', { projectId, epic })
  if (!result.ok) return failureReason('autopilot.start', result.error)
  take(result.value)
  return undefined
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

function Autopilot({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const state = useAutopilot(projectId)
  const mine = state?.epic === epic.epic
  // Only the frame of the Epic being stopped says so.
  const pendingKind = useAutopilotStore((store) => store.pending[projectId])
  const pending = mine ? pendingKind : undefined
  const running = state?.status === 'running' || state?.status === 'waiting'
  const stopping = running && state?.stopping === true
  // After a Force stop of this Epic, the Tickets it interrupted count as ready while still in work.
  const wave = useRunWaveState(projectId, epic.epic, tickets, true, mine && !running ? (state?.resumable ?? []) : [])
  const line = mine && state !== undefined ? autopilotStatusLine(state) : null
  if (!hasRunWave(epic.epic, tickets) && !(mine && running) && line === null && pending === undefined) return null

  const button =
    pending !== undefined || (mine && stopping) ? (
      <ActionButton label="Stopping…" testId="action-stop-autopilot" enabled={false} title={pending === 'force' ? STOPPING_TITLE : stoppingTitle(epic.epic)} run={noRun} />
    ) : mine && running ? (
      <ActionButton label="Stop autopilot" testId="action-stop-autopilot" enabled title={stopTitle(epic.epic)} run={() => stop(projectId, 'stop')} />
    ) : (
      <ActionButton
        label="Autopilot"
        testId="action-autopilot"
        enabled={!running && wave.enabled}
        title={
          running
            ? `Autopilot is ${stopping ? 'stopping' : 'running'} Epic ${state?.epic ?? ''}`
            : wave.enabled
              ? `Run the Waves of ${epic.epic} one after another, without a person. ${DISPLAY_STAYS_ON}`
              : wave.reason
        }
        run={() => start(projectId, epic.epic)}
      />
    )
  // Force stop, behind "⋯" right of Stop, while this Epic's run goes on (stopping included).
  const more =
    mine && running ? (
      <ActionMenu
        label={`More Autopilot actions for ${epic.epic}`}
        title="More Autopilot actions"
        testId="action-autopilot-more"
        menuLabel={`Autopilot over ${epic.epic}`}
        items={[{ label: 'Force stop', title: forceStopTitle(epic.epic), testId: 'action-force-stop-autopilot', disabled: pending === 'force', run: () => stop(projectId, 'force') }]}
      />
    ) : null
  const controls =
    more === null ? (
      button
    ) : (
      <div className="nodrag" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        {button}
        {more}
      </div>
    )
  const behind = state?.harnessBehind ?? null
  if (line === null && behind === null) return controls
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
        <span
          data-testid="autopilot-status"
          data-status={state?.status}
          title={state?.message ?? (running ? `${line}. ${DISPLAY_STAYS_ON}` : line)}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 2px)',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 'var(--text-11)',
            lineHeight: '14px',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          {line}
        </span>
      )}
      {behind === null ? null : (
        <span className="w-chip w-chip--open" data-testid="autopilot-harness-behind" title={harnessBehindTitle(behind)} style={{ position: 'absolute', right: 0, top: '100%' }}>
          {HARNESS_BEHIND_LABEL}
        </span>
      )}
    </div>
  )
}

export default function AutopilotAction({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <Autopilot {...subject} /> : null
}
