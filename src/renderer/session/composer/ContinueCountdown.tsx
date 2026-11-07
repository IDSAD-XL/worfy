import { useEffect, useState } from 'react'
import { countdownLine, type ContinueWaitView } from '../../../shared/ipc/auto-continue'
import { failureReason } from '../../../shared/ipc/channels'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { invoke, readableReason, subscribe } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'
import type { ComposerItemProps } from './index'

// The countdown of Auto-continue over the Orchestrator's input field (worfy-retry ticket 07): while the
// Orchestrator waits to be continued — a retry after a temporary API error, or the reset of the Limits —
// a line says what for and how long, by the second, in local time:
//
//   API error 529 (overloaded) · retry 2 of 5 in 4:12           Retry now  Cancel
//   Limits: 7-day window · resumes 14:20 (in 2:13:05)                      Cancel
//   Limits: no reset time reported · next try in 27:40                     Cancel
//
// The wait is main's (`autoContinue.wait`, src/main/ipc/auto-continue.ts): the Project's Autopilot run
// when one waits, else the Auto-continue of manual turns. A change of a manual wait comes as
// `autoContinue.waitChanged`; a run's comes with its state (`autopilot.changed`), and the wait is read
// again then. Only the Orchestrator has the line: a regular Session has none. On a read-only screen the
// buttons show and do nothing.
//
// An item of the bar (composer/index.ts) on the hint line, drawn over the field (session.css,
// `.w-continue`): the field's bar has no room for a line of its own.

export const order = 5
export const line = 'hint'

/** What the Orchestrator of `projectId` waits for, as main says; null while nothing waits or it is not known. */
function useContinueWait(projectId: string): [ContinueWaitView, () => void] {
  const [wait, setWait] = useState<ContinueWaitView>(null)
  /** Counts the reads asked for: an answer to an older one is not taken. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    void invoke('autoContinue.wait', { projectId }).then((result) => {
      if (!active) return
      if (result.ok) setWait(result.value)
      else console.warn('autoContinue.wait failed:', result.error)
    })
    return () => {
      active = false
    }
  }, [projectId, generation])

  useEffect(() => {
    const again = () => setGeneration((count) => count + 1)
    const offWait = subscribe('autoContinue.waitChanged', (change) => {
      if (change.projectId === projectId) again()
    })
    const offRun = subscribe('autopilot.changed', (state) => {
      if (state.projectId === projectId) again()
    })
    return () => {
      offWait()
      offRun()
    }
  }, [projectId])

  return [wait, () => setGeneration((count) => count + 1)]
}

/** The clock of the line, in milliseconds: it moves by the second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    // At once too: the line may come long after the clock was last read.
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [running])
  return now
}

/** The line of the Orchestrator of `projectId`. */
function Countdown({ projectId }: { projectId: string }) {
  const [wait, readAgain] = useContinueWait(projectId)
  const now = useNow(wait !== null)
  const readOnly = useReadOnly()
  const [acting, setActing] = useState(false)
  if (wait === null) return null

  const act = (channel: 'autoContinue.retryNow' | 'autoContinue.cancel', what: string) => {
    // readOnlyNow: the level may have gone read-only since the line was drawn.
    if (acting || readOnlyNow() !== null) return
    setActing(true)
    void invoke(channel, { projectId }).then((result) => {
      setActing(false)
      if (!result.ok) showToast({ kind: 'error', key: 'continue-countdown', projectId, text: `${what} did not go through: ${readableReason(failureReason(channel, result.error))}`, testId: 'continue-countdown-toast' })
      readAgain()
    })
  }

  return (
    <div className="w-continue" role="status" data-testid="continue-countdown" data-kind={wait.kind} data-source={wait.source}>
      <span className="w-continue__text w-mono" data-testid="continue-countdown-text">
        {countdownLine(wait, now)}
      </span>
      {wait.kind === 'retry' ? (
        <button
          type="button"
          className="w-session__button"
          data-testid="continue-retry-now"
          disabled={acting}
          {...writeAction(readOnly, () => act('autoContinue.retryNow', 'Retry now'), 'Send the continuation now')}
        >
          Retry now
        </button>
      ) : null}
      <button
        type="button"
        className="w-session__button"
        data-testid="continue-cancel"
        disabled={acting}
        {...writeAction(readOnly, () => act('autoContinue.cancel', 'Cancel'), wait.source === 'run' ? 'Stop waiting: the run stops' : 'Stop waiting: nothing is sent')}
      >
        Cancel
      </button>
    </div>
  )
}

/** The countdown of the Orchestrator's chat; nothing in a regular Session. */
export default function ContinueCountdown({ sessionId }: ComposerItemProps) {
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <Countdown key={projectId} projectId={projectId} />
}
