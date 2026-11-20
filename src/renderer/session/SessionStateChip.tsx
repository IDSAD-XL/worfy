// The state chip of the Session view's header: the state's own (STATE_CHIPS, format.ts), and `busy · quiet N min`
// while main reports the running turn quiet (worfy-stuck-agents ticket 06; the minutes from the renderer's store).
// The word sits in an element of its own: a narrow Product Session header shows the icon alone and hides the word
// from sight only (session.css), so a screen reader still reads it; the kit tooltip says it, or the Session's
// error when there is one (worfy-polish ticket 137).
import type { SessionState } from '../../shared/agent/events'
import { Chip } from '../theme/Chip'
import { hintProps } from '../theme/kit/hint'
import { stateChip } from './format'
import { useQuietMinutes } from './store'

export function SessionStateChip({ sessionId, state, error }: { sessionId: string | null; state: SessionState; error?: string | null }) {
  const chip = stateChip(state, useQuietMinutes(sessionId))
  const hint = error === undefined || error === null || error === '' ? chip.label : error
  return (
    <span className="w-session__state" data-testid="session-state" {...hintProps(hint)}>
      <Chip variant={chip.status} label={<span className="w-session__state-word">{chip.label}</span>} />
    </span>
  )
}
