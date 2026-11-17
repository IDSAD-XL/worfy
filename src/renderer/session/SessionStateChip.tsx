// The state chip of the Session view's header: the state's own (STATE_CHIPS, format.ts), and `busy · quiet N min`
// while main reports the running turn quiet (worfy-stuck-agents ticket 06; the minutes from the renderer's store).
import type { SessionState } from '../../shared/agent/events'
import { StatusChip } from '../theme/primitives'
import { stateChip } from './format'
import { useQuietMinutes } from './store'

export function SessionStateChip({ sessionId, state }: { sessionId: string | null; state: SessionState }) {
  const chip = stateChip(state, useQuietMinutes(sessionId))
  return <StatusChip status={chip.status} label={chip.label} />
}
