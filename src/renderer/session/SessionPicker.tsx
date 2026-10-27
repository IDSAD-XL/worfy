import { useEffect, useMemo, type CSSProperties } from 'react'
import { useOrchestratorView, useOrchestratorViews } from '../canvas/nodes/orchestrator-view'
import { useLayout } from '../canvas/useLayout'
import { useClaudeHome } from '../claude-home/useClaudeHome'
import { useProjects } from '../projects/useProjects'
import { Select, type SelectOption } from '../theme/Select'
import { openSession, type OpenedSession } from './navigation'
import { ensureProject, useSessionNodeViews } from './node-sessions'
import { pickerSessions, pickerValue } from './session-picker'

// The Session picker in the header of the Session view (worfy-polish ticket 44): the shared Select
// (theme/Select.tsx) over the rows of session-picker.ts. A pick shows that Session at once, as a
// double click on its Node does (navigation.ts, openSession); on a read-only screen it writes nothing.

const PICKER_STYLE: CSSProperties = { flex: '0 1 auto', maxWidth: 240 }

/** Asks main for the Orchestrator's view, so its row has its state while another Session is shown. */
function FollowOrchestrator({ nodeId }: { nodeId: string }) {
  useOrchestratorView(nodeId)
  return null
}

export interface SessionPickerProps {
  projectId: string
  /** What the Session view shows now. */
  shown: OpenedSession
  /** Its title, for the row that stands for it when no Node of the list does. */
  shownTitle: string
}

export function SessionPicker({ projectId, shown, shownTitle }: SessionPickerProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { live, history } = useClaudeHome(root)
  const nodes = useLayout(projectId).state?.layout.nodes
  const orchestrators = useOrchestratorViews()
  const sessionNodes = useSessionNodeViews()
  useEffect(() => ensureProject(projectId), [projectId])
  const entries = useMemo(() => pickerSessions({ projectId, nodes: nodes ?? [], orchestrators, sessionNodes, live, history }), [projectId, nodes, orchestrators, sessionNodes, live, history])
  const value = pickerValue(shown)
  const options: SelectOption[] = entries.map((entry) => ({ value: entry.nodeId, label: entry.title, detail: entry.chip.label }))
  if (!options.some((option) => option.value === value)) options.unshift({ value, label: shownTitle, detail: 'shown', disabled: true })
  const orchestratorNode = nodes?.find((node) => node.kind === 'orchestrator')
  return (
    <>
      {orchestratorNode !== undefined ? <FollowOrchestrator nodeId={orchestratorNode.id} /> : null}
      <Select
        value={value}
        options={options}
        aria-label="Session"
        title="Show another Session of this Project"
        data-testid="session-picker"
        // Gives way with the model when the header is short of room; a long title ends in «…».
        style={PICKER_STYLE}
        onChange={(nodeId) => {
          const entry = entries.find((each) => each.nodeId === nodeId)
          if (entry !== undefined) openSession(entry.opens)
        }}
      />
    </>
  )
}
