import { useCallback, useEffect, useState } from 'react'
import { capabilitiesSchema, CLAUDE_CAPABILITIES, type Capabilities } from '../../shared/vendors/capabilities'
import { invoke } from '../ipc'

// What the Vendor of a Session can do, for its pickers and slash menu (worfy-multi-vendor ticket 25):
// `agent.capabilities` answers the driver's capabilities for the Session's live agent. The interface
// reads the flags and lists, never the Vendor's name. A Session whose capabilities main cannot give
// is taken for Claude Code's, as a Session Node saved without a Vendor is.

/**
 * The capabilities of a Session's Vendor (`agent.capabilities`): undefined until main answers, Claude
 * Code's when it cannot. `refresh` asks again: a live agent may list more (its models' effort levels).
 */
export function useCapabilities(sessionId: string | null): { capabilities: Capabilities | undefined; refresh: () => void } {
  const [found, setFound] = useState<{ sessionId: string; capabilities: Capabilities } | null>(null)
  const refresh = useCallback(() => {
    if (sessionId === null) return
    void invoke('agent.capabilities', { sessionId }).then((result) => {
      const parsed = result.ok ? capabilitiesSchema.safeParse(result.value) : null
      if (parsed?.success !== true) console.warn(`agent.capabilities ${sessionId} gave nothing:`, result.ok ? 'not capabilities' : result.error)
      setFound({ sessionId, capabilities: parsed?.success === true ? parsed.data : CLAUDE_CAPABILITIES })
    })
  }, [sessionId])
  useEffect(refresh, [refresh])
  return { capabilities: found !== null && found.sessionId === sessionId ? found.capabilities : undefined, refresh }
}
