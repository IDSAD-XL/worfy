import { useState } from 'react'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, readableReason } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { useQuietMinutes, useSessionLogs } from '../store'
import type { ComposerItemProps } from './index'

// The line of a quiet turn over the input field (worfy-stuck-agents ticket 06): once main reports the running turn
// quiet — no event of its agent, no hook running, no output growing for QUIET_MARK_MS (src/shared/agent/quiet.ts,
// ticket 03) — a line says for how long, in whole minutes, with Interrupt and Restart:
//
//   No sign of life for 14 min: no events, no hook, no output.                  Interrupt  Restart
//
// Interrupt is the Session's own (`agent.interrupt`). Restart (`agent.restart`) interrupts the turn, waits for the
// old process to exit and starts a new one on the same conversation; while background tasks of the Session live it
// restarts nothing, and the line shows main's reason instead of its text. Nothing here acts by itself (ADR-0050).
// The line goes with the quiet: at the next sign of life, the end of the turn, or a permission request (the store
// ends the quiet at any state but `busy`). On a read-only screen the buttons show and do nothing.
//
// An item of the bar (composer/index.ts) on the hint line, drawn over the field as the countdown of Auto-continue
// is (session.css, `.w-continue`): that one shows while the Orchestrator waits between turns, this one only in a turn.

export const order = 6
export const line = 'hint'

/** The line of a quiet turn of `sessionId`, quiet for `minutes`. Keyed by the quiet: a new one starts without a reason. */
function Line({ sessionId, minutes }: { sessionId: string; minutes: number }) {
  const readOnly = useReadOnly()
  const [acting, setActing] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  const act = (channel: 'agent.interrupt' | 'agent.restart') => {
    // readOnlyNow: the level may have gone read-only since the line was drawn.
    if (acting || readOnlyNow() !== null) return
    setActing(true)
    setReason(null)
    void invoke(channel, { sessionId }).then((result) => {
      setActing(false)
      if (!result.ok) setReason(`${channel === 'agent.restart' ? 'Restart' : 'Interrupt'} did not go through: ${readableReason(failureReason(channel, result.error))}`)
      else if ('reason' in result.value) setReason(result.value.reason)
    })
  }

  return (
    <div className="w-continue" role="status" data-testid="quiet-turn">
      {reason === null ? (
        <span className="w-continue__text w-mono" data-testid="quiet-turn-text">
          {`No sign of life for ${minutes} min: no events, no hook, no output.`}
        </span>
      ) : (
        <span className="w-continue__text w-mono" data-testid="quiet-turn-reason" title={reason}>
          {reason}
        </span>
      )}
      <button type="button" className="w-session__button" data-testid="quiet-turn-interrupt" disabled={acting} {...writeAction(readOnly, () => act('agent.interrupt'), 'Stop the turn')}>
        Interrupt
      </button>
      <button
        type="button"
        className="w-session__button"
        data-testid="quiet-turn-restart"
        disabled={acting}
        {...writeAction(readOnly, () => act('agent.restart'), 'Interrupt the turn and restart the agent with the same conversation')}
      >
        Restart
      </button>
    </div>
  )
}

/** The line of the chat's Session while its turn is quiet; nothing otherwise. */
export default function QuietTurn({ sessionId }: ComposerItemProps) {
  const minutes = useQuietMinutes(sessionId)
  const since = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.quietSince ?? null)))
  if (sessionId === null || minutes === null || since === null) return null
  return <Line key={since} sessionId={sessionId} minutes={minutes} />
}
