import type { CSSProperties } from 'react'
import { readSessionNodeData, sessionStatus } from '../claude-home/session-nodes'
import { useLayout } from '../canvas/useLayout'
import { useClaudeHome, useSessionTranscript } from '../claude-home/useClaudeHome'
import { useProjects } from '../projects/useProjects'
import { StatusChip } from '../theme/primitives'
import { Transcript } from './Transcript'
import './session.css'

// The Session view of a Session started outside worfy (a terminal, Claude desktop): the same
// transcript as a live Session, its events read from the Session's transcript file under ~/.claude
// and followed as Claude Code appends to it (claude-home/useClaudeHome.ts). worfy cannot write to
// such a Session, so there is no input field: a line says why instead.

export interface ExternalSessionPanelProps {
  projectId: string
  nodeId: string
  sessionId: string
}

const styles = {
  readOnly: { fontSize: 'var(--text-13)', color: 'var(--text-secondary)' },
  source: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
} satisfies Record<string, CSSProperties>

export function ExternalSessionPanel({ projectId, nodeId, sessionId }: ExternalSessionPanelProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { live, history } = useClaudeHome(root)
  const transcript = useSessionTranscript(root, sessionId)
  const saved = useLayout(projectId).state?.layout.nodes.find((node) => node.id === nodeId)
  const data = saved ? readSessionNodeData(saved.data) : null
  const session = live?.find((each) => each.sessionId === sessionId)
  const chip = live === undefined ? { status: 'ready' as const, label: '…' } : sessionStatus(session)
  const title = session?.name ?? history.find((each) => each.sessionId === sessionId)?.title ?? data?.name ?? `Session ${sessionId.slice(0, 8)}`
  // The live entry says where it runs; once it is gone, the Node's data and the transcript do.
  const desktop = session ? session.entrypoint === 'claude-desktop' : data?.source === 'desktop'
  const cwd = session?.cwd ?? data?.cwd ?? history.find((each) => each.sessionId === sessionId)?.cwd
  const startedIn = desktop ? 'Claude desktop' : 'terminal'

  let empty: string | null = null
  if (transcript.error !== undefined) empty = `The transcript could not be read: ${transcript.error}`
  else if (transcript.loaded && !transcript.found) empty = 'No transcript of this Session yet'

  return (
    <div className="w-session" data-testid="session-view" data-session-id={sessionId} data-node-id={nodeId} data-read-only="true">
      <header className="w-session__header">
        <h1 className="w-session__title" title={title}>
          {title}
        </h1>
        <span data-testid="session-state">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="w-session__divider" aria-hidden="true" />
        <span className="w-mono" style={styles.source} data-testid="session-source">
          {desktop ? 'Claude desktop' : `terminal${cwd ? ` · ${cwd}` : ''}`}
        </span>
        <span className="w-session__spacer" />
      </header>
      <div className="w-session__body">
        <section className="w-session__main" aria-label="Session">
          {empty !== null ? (
            <div className="w-session__empty" data-testid="session-transcript-missing">
              {empty}
            </div>
          ) : (
            <Transcript events={transcript.events} firstIndex={transcript.first} sessionId={null} projectId={projectId} assistantLabel="claude" />
          )}
          <div className="w-composer" data-testid="session-read-only" style={styles.readOnly}>
            Read-only: started in {startedIn}
          </div>
        </section>
      </div>
    </div>
  )
}
