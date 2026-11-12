import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { SessionMcpChip } from '../McpChip'
import type { ComposerItemProps } from './index'

// The chip «MCP n/m» of the Session's MCP servers (McpChip.tsx, worfy-mcp-live ticket 04) in the bar under the
// input field (worfy-mcp-live ticket 09, owner 2026-11-12, Q9 and Q10): it left the Session header, which had
// grown too crowded. The Sessions that show it are the ones whose header had it: an Orchestrator and a Session
// Node; a Product Session's field leaves it out, as its header did (PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS,
// product-session.ts). Nothing is drawn while main has no rows of the Session (SessionMcpChip).

/**
 * On the hint line, just left of the context meter (ContextMeter.tsx, order 5): the pickers keep the line
 * below to themselves, so the chip takes no width from them either (test/e2e/session-controls.spec.ts).
 */
export const order = 4
export const line = 'hint'

export default function McpServers({ sessionId }: ComposerItemProps) {
  // The Orchestrator's Session: Allow there says it takes effect from the next Wave while Autopilot runs.
  const views = useOrchestratorViews()
  const orchestrator = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)
  return <SessionMcpChip sessionId={sessionId} projectId={orchestrator?.projectId ?? ''} orchestrator={orchestrator !== undefined} />
}
