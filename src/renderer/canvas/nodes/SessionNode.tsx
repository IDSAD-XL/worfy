import { memo, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { AgentEvent } from '../../../shared/agent/events'
import type { ProjectView } from '../../../shared/ipc/projects'
import type { WorfySessionNodeData } from '../../../shared/ipc/sessions'
import {
  readSessionNodeData,
  readWorfySessionNodeData,
  sessionSourceLabel,
  sessionStatus,
  worfySessionTitle,
  type SESSION_HEIGHT,
  type SESSION_KIND,
  type SESSION_WIDTH,
} from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { invoke } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { STATE_CHIPS } from '../../session/format'
import { openSession } from '../../session/navigation'
import { isRunning, useSessionNodeView } from '../../session/node-sessions'
import { useSessionLog } from '../../session/store'
import { StatusChip, type Status } from '../../theme/primitives'
import { badges, type SlotSubject } from '../badges'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// A Session of Claude Code on the Canvas (CONTEXT.md, «Сессия»: one Session — one Node, wherever it
// was started). Two modes:
//
// - Read-only (ticket 14): a Session started outside worfy — `claude` in a terminal, the Claude
//   desktop app: where it runs, its title and its status, followed from the registry under
//   ~/.claude (claude-home/useClaudeHome.ts). The overlay overlays/SessionNodes.tsx makes the Node
//   when the Session starts; the Node stays, «finished», after the process is gone. Hiding or
//   removing the Node changes nothing about the Session. A double click opens its transcript in the
//   Session view (session/ExternalSessionPanel.tsx).
// - Live (ticket 18): a Session worfy runs (`data.origin: 'worfy'`, src/shared/ipc/sessions.ts),
//   made by "New session" or by Resume. It shows main's view of the Session (session/node-sessions.ts),
//   its last answer and an input field. A Node whose Session is not running offers Resume, under
//   the rule of src/main/agent/resume.ts; a message sent to it resumes it first. Until the live
//   Session answers, a resumed Node shows the last answer of its transcript (worfy-daily ticket 22).
//
// The registry (index.ts) needs the kind and size here as literals; `satisfies` fails the
// typecheck the moment they differ from those of claude-home/session-nodes.ts.
export const kind = 'session' satisfies typeof SESSION_KIND
export const defaultWidth = 300 satisfies typeof SESSION_WIDTH
export const defaultHeight = 120 satisfies typeof SESSION_HEIGHT
export const minimapColor = 'var(--text-secondary)'

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    flex: 'none',
    height: 'var(--row-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 var(--space-3)',
    borderBottom: '1px solid var(--border)',
    cursor: 'grab',
  },
  title: { flex: 1, minWidth: 0, fontSize: 'var(--text-13)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2) var(--space-3)' },
  line: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  source: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  readOnly: {
    flex: 'none',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-chip)',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    color: 'var(--text-secondary)',
  },
  badges: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' },
  tools: { flex: 'none', display: 'flex', gap: 2 },
  tool: {
    padding: '0 4px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    cursor: 'pointer',
  },
  broken: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  answer: {
    flex: 1,
    minHeight: 0,
    margin: 0,
    overflow: 'auto',
    fontSize: 'var(--text-12)',
    lineHeight: '17px',
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    cursor: 'text',
  },
  quiet: { flex: 1, minHeight: 0, fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  error: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
  form: { flex: 'none', display: 'flex', gap: 'var(--space-1)', padding: '0 var(--space-3) var(--space-2)' },
  input: {
    flex: 1,
    minWidth: 0,
    height: 24,
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--bg)',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
  },
} satisfies Record<string, CSSProperties>

/** The last answer of the Session itself (not a Subagent's, not text Claude Code wrote), or null. */
function lastAnswer(events: readonly AgentEvent[]): string | null {
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at]
    if (event?.type === 'text' && event.parentToolUseId === null && !event.synthetic) return event.text
  }
  return null
}

/** How much of a transcript file one `claudeHome.transcript` call reads, as claude-home/useClaudeHome.ts reads it. */
const CHUNK_BYTES = 1024 * 1024

/**
 * The last answer a Session's transcript file holds, read once to its end; null while reading,
 * for no `sessionId`, or when the file has none. It calls `claudeHome.transcript` itself rather
 * than useSessionTranscript: that one keeps a single state per transcript, which the Session view
 * of the same Session uses at the same time, and whichever of the two let go first would drop
 * the state of the other.
 */
function usePastAnswer(root: string, sessionId: string | null): string | null {
  const [read, setRead] = useState<{ sessionId: string; answer: string | null } | null>(null)
  useEffect(() => {
    if (sessionId === null) return
    let current = true
    void (async () => {
      let cursor: { offset: number; fileId: string | null } | undefined
      let answer: string | null = null
      for (let round = 0; round < 1000; round += 1) {
        const result = await invoke('claudeHome.transcript', { projectRoot: root, sessionId, maxBytes: CHUNK_BYTES, ...(cursor ? { cursor } : {}) })
        if (!current) return
        if (!result.ok) {
          console.error(`claudeHome.transcript ${sessionId} failed:`, result.error)
          return
        }
        const { found, events, reset, more } = result.value
        if (reset) answer = null
        answer = lastAnswer(events) ?? answer
        cursor = result.value.cursor
        if (!found || !more) break
      }
      setRead({ sessionId, answer })
    })()
    return () => {
      current = false
    }
  }, [root, sessionId])
  return read !== null && read.sessionId === sessionId ? read.answer : null
}

/** A Session worfy runs, or ran: main's view while it runs, its saved session id otherwise. */
function LiveSessionNode({ id, selected, info, project }: Pick<CanvasNodeProps, 'id' | 'selected'> & { info: WorfySessionNodeData; project: ProjectView }) {
  const ops = useLayoutOps()
  const { history } = useClaudeHome(project.path)
  const view = useSessionNodeView(project.id, id)
  const running = isRunning(view)
  const log = useSessionLog(running ? view.sessionId : null)
  const liveAnswer = useMemo(() => lastAnswer(log.events), [log.events])
  // A resumed Session: the answer from before Resume, until the live Session brings one.
  const pastAnswer = usePastAnswer(project.path, running && liveAnswer === null ? view.sdkSessionId : null)
  const answer = liveAnswer ?? pastAnswer
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const saved = info.sessionId
  const recorded = saved === undefined ? undefined : history.find((each) => each.sessionId === saved)
  const title = worfySessionTitle(saved, history)
  const chip: { status: Status; label: string } = running ? STATE_CHIPS[view.state] : saved === undefined ? { status: 'ready', label: 'new' } : { status: 'done', label: 'finished' }
  const cwd = (running ? view.cwd : undefined) ?? recorded?.cwd ?? project.path
  const busy = running && view.state === 'busy'
  const subject: SlotSubject | null = saved === undefined ? null : { kind: 'session', projectId: project.id, root: project.path, sessionId: saved }

  /** Starts (or resumes) the Session behind this Node; answers its id for `agent.*`, or null. */
  const ensure = async (): Promise<string | null> => {
    if (running) return view.sessionId
    const result = await invoke('sessions.start', { projectId: project.id, nodeId: id })
    if (result.ok) return result.value.sessionId
    setProblem(result.error)
    return null
  }

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    if (text === '') return
    setProblem(null)
    const sessionId = await ensure()
    if (sessionId === null) return
    setDraft('')
    // The transcript shows the message when main gives it to Claude Code (a `prompt` event).
    const result = await invoke('agent.send', { sessionId, text })
    if (!result.ok) {
      setDraft(text)
      setProblem(result.error)
    }
  }

  const act = (run: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setProblem(null)
    void run().then((result) => {
      if (!result.ok) setProblem(result.error)
    })
  }

  return (
    <div
      className="w-node-surface"
      style={styles.root}
      data-testid="session-node"
      data-live="true"
      data-node-id={id}
      data-session-id={(running ? view.sdkSessionId : null) ?? saved}
      data-cwd={cwd}
      data-status={chip.label}
      onDoubleClick={() => {
        if (running) openSession({ nodeId: id, projectId: project.id })
        else if (saved !== undefined) openSession({ nodeId: id, projectId: project.id, external: { sessionId: saved } })
      }}
    >
      <NodeResizeClamp
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div style={styles.header} title="Double-click to open the Session">
        <span style={styles.title} data-testid="session-node-title" title={title}>
          {title}
        </span>
        <span data-testid="session-node-status" title={running ? (view.error ?? undefined) : undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="nodrag" style={styles.tools}>
          {busy ? (
            <button type="button" style={styles.tool} data-testid="session-node-interrupt" onClick={() => act(() => invoke('agent.interrupt', { sessionId: view.sessionId }))}>
              Interrupt
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              style={styles.tool}
              data-testid="session-node-close"
              disabled={busy}
              title={busy ? 'Interrupt the turn before closing the Session' : 'Close the Session; the Node stays'}
              onClick={() => act(() => invoke('sessions.close', { nodeId: id }))}
            >
              Close
            </button>
          ) : saved !== undefined ? (
            <button type="button" style={styles.tool} data-testid="session-node-resume" title="Continue this Session in worfy" onClick={() => act(() => invoke('sessions.start', { projectId: project.id, nodeId: id }))}>
              Resume
            </button>
          ) : null}
          <button type="button" style={styles.tool} title="Hide the Node; the Session goes on" onClick={() => void ops.apply({ op: 'hide', id, hidden: true })}>
            Hide
          </button>
          <button
            type="button"
            style={styles.tool}
            data-testid="session-node-remove"
            disabled={running}
            title={running ? 'Close the Session before removing its Node' : 'Remove the Node; the transcript stays'}
            onClick={() => void ops.apply({ op: 'remove', id })}
          >
            Remove
          </button>
        </span>
      </div>
      <div style={styles.body}>
        <div style={styles.line}>
          <span className="w-mono" style={styles.source} data-testid="session-node-source" title={cwd}>
            worfy · {cwd}
          </span>
        </div>
        {answer !== null ? (
          <pre className="w-mono nodrag nowheel" style={styles.answer} data-testid="session-node-answer">
            {answer}
          </pre>
        ) : (
          <div style={styles.quiet}>{running ? (busy ? 'Working…' : 'No answer yet') : 'Not running'}</div>
        )}
        {problem !== null ? (
          <div style={styles.error} role="alert" data-testid="session-node-error">
            {problem}
          </div>
        ) : null}
        {subject !== null && badges.length ? (
          <div style={styles.badges}>
            {badges.map(({ id: badgeId, Component }) => (
              <Component key={badgeId} subject={subject} />
            ))}
          </div>
        ) : null}
      </div>
      <form className="nodrag" style={styles.form} onSubmit={(event) => void send(event)}>
        <input
          style={styles.input}
          data-testid="session-node-input"
          aria-label="Message to the Session"
          placeholder={running ? 'Message the Session' : saved === undefined ? 'Start the Session' : 'Resume with a message'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" style={styles.tool} data-testid="session-node-send" disabled={draft.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  )
}

function SessionNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const worfy = readWorfySessionNodeData(data.node.data)
  const info = readSessionNodeData(data.node.data)
  const project = activeProject(useProjects())
  const { live, history } = useClaudeHome(project?.path)

  if (worfy !== null && project !== undefined) return <LiveSessionNode id={id} selected={selected} info={worfy} project={project} />

  if (info === null || project === undefined) {
    return (
      <div className="w-node-surface" style={styles.root} data-testid="session-node" data-node-id={id}>
        <div style={styles.broken}>This Session Node has no Session</div>
      </div>
    )
  }

  const session = live?.find((each) => each.sessionId === info.sessionId)
  const chip = live === undefined ? { status: 'ready' as const, label: '…' } : sessionStatus(session)
  const title = session?.name ?? history.find((each) => each.sessionId === info.sessionId)?.title ?? info.name ?? `Session ${info.sessionId.slice(0, 8)}`
  const subject: SlotSubject = { kind: 'session', projectId: project.id, root: project.path, sessionId: info.sessionId }

  return (
    <div
      className="w-node-surface"
      style={styles.root}
      data-testid="session-node"
      data-node-id={id}
      data-session-id={info.sessionId}
      data-status={chip.label}
      onDoubleClick={() => openSession({ nodeId: id, projectId: project.id, external: { sessionId: info.sessionId } })}
    >
      <NodeResizeClamp
        isVisible={selected}
        minWidth={200}
        minHeight={80}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div style={styles.header} title="Double-click to open the transcript">
        <span style={styles.title} data-testid="session-node-title" title={title}>
          {title}
        </span>
        <span data-testid="session-node-status">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="nodrag" style={styles.tools}>
          <button type="button" style={styles.tool} title="Hide the Node; the Session goes on" onClick={() => void ops.apply({ op: 'hide', id, hidden: true })}>
            Hide
          </button>
          <button type="button" style={styles.tool} title="Remove the Node; the Session goes on" onClick={() => void ops.apply({ op: 'remove', id })}>
            Remove
          </button>
        </span>
      </div>
      <div style={styles.body}>
        <div style={styles.line}>
          <span style={styles.readOnly} data-testid="session-node-read-only">
            read-only
          </span>
          <span className="w-mono" style={styles.source} data-testid="session-node-source" title={sessionSourceLabel(info)}>
            {sessionSourceLabel(info)}
          </span>
        </div>
        {badges.length ? (
          <div style={styles.badges}>
            {badges.map(({ id: badgeId, Component }) => (
              <Component key={badgeId} subject={subject} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default memo(SessionNode)
