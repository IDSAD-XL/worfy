import { useEffect } from 'react'
import { AssistantPanel } from '../../assistant/AssistantPanel'
import { Spark } from '../../assistant/icons'
import { followAssistant, useAssistant } from '../../assistant/useAssistant'
import { windowMachine } from '../../ipc'
import { SidebarSection } from '../SidebarSection'
import '../../assistant/assistant.css'

/**
 * The Assistant's section (worfy-assistant ticket 14; spec, UI, variant A; owner's decision 17): first on the rail, above
 * the sections of the work, after the prototype Card the owner accepted. What waits over every Project of this Machine,
 * with the reason, the source and the duty of each item; the proposals with Dismiss, Snooze, Open and Prepare; like and
 * dislike; the journal; the summary; the conversation; the line of usage. Its badge and its speech card are drawn by
 * AssistantSpeech (assistant/AssistantSpeech.tsx), which the shell keeps mounted while the sidebar is hidden too.
 */
export const order = 1
export const railTitle = 'Assistant'
/** A window that never chose a section starts on the Projects, not here: the Assistant is off until the user turns it on. */
export const railDefault = false

export function RailIcon() {
  return <Spark size={18} />
}

export default function AssistantSection() {
  const view = useAssistant((state) => state.view)
  useEffect(() => { return followAssistant() }, [])
  const scope = view === null ? null : view.on ? 'This machine' : 'Off on this machine'
  return (
    <SidebarSection id="AssistantSection" title="Assistant" meta={scope} testId="assistant-section">
      {windowMachine() !== null ? (
        <p className="w-sidebar-section__empty">Assistant works with the Projects of its own machine. Open it there.</p>
      ) : view === null ? (
        <p className="w-sidebar-section__empty">Loading…</p>
      ) : (
        <AssistantPanel view={view} />
      )}
    </SidebarSection>
  )
}
