import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import type { AgentEvent } from '../../../shared/agent/events'
import { chatCommandToast } from '../../../shared/autopilot/chat-command'
import { TRANSCRIPT_WINDOW_BYTES } from '../../../shared/ipc/claude-home'
import type { ProjectView } from '../../../shared/ipc/projects'
import type { WorfySessionNodeData } from '../../../shared/ipc/sessions'
import {
  readSessionNodeData,
  readWorfySessionNodeData,
  sessionSourceLabel,
  sessionStatus,
  sessionTitleElementId,
  worfySessionTitle,
  type SESSION_HEIGHT,
  type SESSION_KIND,
  type SESSION_WIDTH,
} from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { useInFocusTile } from '../../focus/focus-tile'
import { invoke } from '../../ipc'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { checkFiles, readFiles, roomFor, takeAttached } from '../../session/attach-files'
import { STATE_CHIPS } from '../../session/format'
import { AttachmentChips, type Chip } from '../../session/MessageInput'
import { openSession } from '../../session/navigation'
import { isRunning, useSessionNodeView } from '../../session/node-sessions'
import { useSessionLog } from '../../session/store'
import { StatusChip, type Status } from '../../theme/primitives'
import { showToast } from '../../toast/toasts'
import { badges, type SlotSubject } from '../badges'
import { KIND, type NodeKindColour } from '../kind-colours'
import { KindBand, KindIcon } from '../kind-icons'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { NODE_HEADER } from '../node-header'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// A Session of Claude Code on the Canvas (CONTEXT.md, "Session": one Session — one Node, wherever it
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
//   A file or an image dropped on the Node goes with the next message, as one dropped on the input
//   field of the Session view does (session/attach-files.ts): main checks it, it shows as a chip
//   above the Node's input field, and a refusal shows in the Node's problem line. A drop on a Node
//   whose Session is not running resumes it first: an attachment belongs to a running Session.
//   A read-only Node takes no files.
//
// The registry (index.ts) needs the kind and size here as literals; `satisfies` fails the
// typecheck the moment they differ from those of claude-home/session-nodes.ts.
export const kind = 'session' satisfies typeof SESSION_KIND
export const defaultWidth = 300 satisfies typeof SESSION_WIDTH
export const defaultHeight = 120 satisfies typeof SESSION_HEIGHT
/** Its kind colour on the band, the icon and the minimap (kind-colours.ts). */
export const kindColour: NodeKindColour = 'session'

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  // The kind band and icon of a Session, on the pale ground of its kind (kind-icons.tsx, ADR-0077).
  header: {
    position: 'relative',
    flex: 'none',
    height: 'var(--row-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 var(--space-3)',
    borderBottom: '1px solid var(--border)',
    background: KIND.session.tint,
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
  error: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-secondary)', overflowWrap: 'anywhere', whiteSpace: 'pre-line' },
  // Files over the Node: the accent ring of a selected Node, dashed like the Session view's field.
  dragging: { borderColor: 'var(--accent)', borderStyle: 'dashed', boxShadow: 'var(--shadow-node), 0 0 0 1px var(--accent)' },
  chips: { flex: 'none', maxHeight: 64, overflow: 'auto', paddingBottom: 'var(--space-1)' },
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

/** The Node's accessible name names its kind (kind-icons.tsx), unless its title already does ("New session", "Session 1a2b3c4d"). */
const sessionLabel = (title: string): string => (/^(new )?session\b/i.test(title) ? title : `Session ${title}`)

/** A drag that carries files, not text or a Node. */
const hasFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files')

/**
 * The drag handlers of a Node that takes no files: the cursor says no, and a drop neither opens
 * the file in the window nor reaches the Canvas.
 */
const refuseFiles = {
  onDragOver: (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'none'
  },
  onDrop: (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
  },
}

/** The last answer of the Session itself (not a Subagent's, not text Claude Code wrote), or null. */
function lastAnswer(events: readonly AgentEvent[]): string | null {
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at]
    if (event?.type === 'text' && event.parentToolUseId === null && !event.synthetic) return event.text
  }
  return null
}

/**
 * The last answer a Session's transcript file holds, read from the window at its end (ticket 21);
 * null while reading, for no `sessionId`, or when that window has none. It calls
 * `claudeHome.transcript` itself rather than useSessionTranscript: that one keeps a single state
 * per transcript, which the Session view of the same Session uses at the same time, and whichever
 * of the two let go first would drop the state of the other.
 */
// shortcut: an answer older than the last TRANSCRIPT_WINDOW_BYTES of the file is not found, redo when a Node shows no answer for a Session whose last turn wrote megabytes of tool output.
function usePastAnswer(root: string, sessionId: string | null): string | null {
  const [read, setRead] = useState<{ sessionId: string; answer: string | null } | null>(null)
  useEffect(() => {
    if (sessionId === null) return
    let current = true
    void (async () => {
      let result = await invoke('claudeHome.transcript', { projectRoot: root, sessionId, back: { bytes: TRANSCRIPT_WINDOW_BYTES } })
      let answer: string | null = null
      // An older main (a Linked machine) drops `back`, reads from the start and answers without
      // `earlier`: read on to the end, as before ticket 21.
      for (let round = 0; round < 1000; round += 1) {
        if (!current) return
        if (!result.ok) {
          console.error(`claudeHome.transcript ${sessionId} failed:`, result.error)
          return
        }
        const { value } = result
        if (value.reset) answer = null
        answer = lastAnswer(value.events) ?? answer
        if (!value.found || value.earlier !== undefined || !value.more) break
        result = await invoke('claudeHome.transcript', { projectRoot: root, sessionId, cursor: value.cursor, maxBytes: TRANSCRIPT_WINDOW_BYTES })
      }
      setRead({ sessionId, answer })
    })()
    return () => {
      current = false
    }
  }, [root, sessionId])
  return read !== null && read.sessionId === sessionId ? read.answer : null
}

/**
 * Keep (ADR-0076): the automatic archive and «Archive finished sessions now» leave the Node on the
 * Canvas while it is pressed. A step of ⌘Z; inactive on a read-only screen.
 */
function KeepButton({ id, keep, readOnly }: { id: string; keep: boolean; readOnly: string | null }) {
  const ops = useLayoutOps()
  const hint = keep ? 'Kept: the archive leaves this Session on the Canvas. Click to let it go' : 'Keep this Session on the Canvas: the archive leaves it'
  return (
    <button type="button" style={styles.tool} data-testid="session-node-keep" aria-pressed={keep} {...writeAction(readOnly, () => void ops.apply({ op: 'keep', id, keep: !keep }), hint)}>
      {keep ? 'Kept' : 'Keep'}
    </button>
  )
}

/**
 * The id that names the Node's React Flow wrapper (flow-nodes.ts), on the Canvas copy alone: focus
 * mode draws the Node in a tile while the Canvas keeps its own copy, and an id twice in the document
 * is invalid, with the wrapper named by whichever copy comes first.
 */
const useTitleElementId = (id: string): string | undefined => (useInFocusTile() ? undefined : sessionTitleElementId(id))

/** A Session worfy runs, or ran: main's view while it runs, its saved session id otherwise. */
function LiveSessionNode({ id, selected, info, project, keep }: Pick<CanvasNodeProps, 'id' | 'selected'> & { info: WorfySessionNodeData; project: ProjectView; keep: boolean }) {
  const ops = useLayoutOps()
  const titleId = useTitleElementId(id)
  const { history } = useClaudeHome(project.path)
  const view = useSessionNodeView(project.id, id)
  const running = isRunning(view)
  const log = useSessionLog(running ? view.sessionId : null)
  const liveAnswer = useMemo(() => lastAnswer(log.events), [log.events])
  // A resumed Session: the answer from before Resume, until the live Session brings one.
  const pastAnswer = usePastAnswer(project.path, running && liveAnswer === null ? view.sdkSessionId : null)
  const answer = liveAnswer ?? pastAnswer
  // On a read-only screen (worfy-link ticket 25) every action that writes is inactive, with the reason.
  const readOnly = useReadOnly()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [chips, setChips] = useState<Chip[]>([])
  const [dragging, setDragging] = useState(false)
  const nextKey = useRef(1)
  // The chips as they are now, ahead of the next render: attaching and sending are async, and each
  // counts against the chips there are by then. Every change of the chips goes through changeChips.
  const chipsNow = useRef<Chip[]>([])
  // The attachments of a message being sent; set while one is on its way, so it goes once.
  const sendingNow = useRef<Chip[] | null>(null)

  const saved = info.sessionId
  const recorded = saved === undefined ? undefined : history.find((each) => each.sessionId === saved)
  const title = worfySessionTitle(saved, history)
  // Not running (no view, or a closed one) after it has run: finished.
  const finished = !running && saved !== undefined
  const chip: { status: Status; label: string } = running ? STATE_CHIPS[view.state] : finished ? { status: 'done', label: 'finished' } : { status: 'ready', label: 'new' }
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

  const changeChips = (change: (current: Chip[]) => Chip[]) => {
    chipsNow.current = change(chipsNow.current)
    setChips(chipsNow.current)
  }

  /** How many more attachments the message takes, counting those of a message on its way. */
  const room = () => roomFor(chipsNow.current.length + (sendingNow.current?.length ?? 0))

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    const attached = chipsNow.current
    if (readOnly !== null || sendingNow.current !== null || (text === '' && attached.length === 0)) return
    // The message leaves the field at once, as in the Session view's field: what is typed, dropped
    // or removed while it is on its way (Resume can take a while) belongs to the next message.
    sendingNow.current = attached
    setProblem(null)
    setDraft('')
    changeChips(() => [])
    // Why the message was not sent; null when it was. `named: true` — ensure() has shown why.
    let failure: { named: true } | { named: false; problem: string } | null = null
    try {
      const sessionId = await ensure()
      if (sessionId === null) failure = { named: true }
      else {
        // The transcript shows the message when main gives it to Claude Code (a `prompt` event).
        const result = await invoke('agent.send', { sessionId, text, attachments: attached.map((chip) => chip.attachment) })
        if (!result.ok) failure = { named: false, problem: result.error }
        // An Autopilot command started Autopilot, or was refused, instead of reaching the agent (worfy-flight-recorder ticket 22).
        else if (result.value?.autopilot) showToast(chatCommandToast(result.value.autopilot))
      }
    } catch (error) {
      failure = { named: false, problem: error instanceof Error ? error.message : String(error) }
    } finally {
      sendingNow.current = null
    }
    if (failure === null) return
    // Not sent: the text and the attachments come back, ahead of what came since, so nothing is lost.
    setDraft((current) => (current === '' ? text : current))
    changeChips((current) => [...attached, ...current])
    if (!failure.named) setProblem(failure.problem)
  }

  /** Dropped files: read here; the Session started if it is not running; checked in main. */
  const attachDropped = async (files: readonly File[]): Promise<void> => {
    if (readOnly !== null) return setProblem(readOnly)
    setProblem(null)
    const read = await readFiles(files, 'dropped', room())
    // Nothing to attach: no reason to start the Session.
    const sessionId = read.sources.length === 0 ? null : await ensure()
    if (read.sources.length > 0 && sessionId === null) return
    const outcome = sessionId === null ? { results: [], refused: read.refused } : await checkFiles(read, sessionId, invoke)
    const { taken, problem: refused } = takeAttached(outcome, room())
    if (taken.length > 0) changeChips((current) => [...current, ...taken.map((attachment) => ({ key: nextKey.current++, attachment }))])
    setProblem(refused)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Moving onto a child of the Node leaves the Node's own box but not the Node.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDragging(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    // Never let the window open a dropped file in place of the app, nor the Canvas see the drop.
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    void attachDropped([...event.dataTransfer.files])
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
      style={dragging ? { ...styles.root, ...styles.dragging } : styles.root}
      role="group"
      id={titleId}
      aria-label={sessionLabel(title)}
      data-testid="session-node"
      data-live="true"
      data-node-id={id}
      data-finished={finished || undefined}
      data-session-id={(running ? view.sdkSessionId : null) ?? saved}
      data-cwd={cwd}
      data-status={chip.label}
      data-dragging={dragging || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
      <div style={styles.header} title="Double-click to open the Session" {...NODE_HEADER}>
        <KindBand kind="session" />
        <KindIcon kind="session" />
        <span style={styles.title} data-testid="session-node-title" title={title}>
          {title}
        </span>
        <span data-testid="session-node-status" title={running ? (view.error ?? undefined) : undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="nodrag" style={styles.tools}>
          {busy ? (
            <button type="button" style={styles.tool} data-testid="session-node-interrupt" {...writeAction(readOnly, () => act(() => invoke('agent.interrupt', { sessionId: view.sessionId })))}>
              Interrupt
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              style={styles.tool}
              data-testid="session-node-close"
              disabled={busy}
              {...writeAction(readOnly, () => act(() => invoke('sessions.close', { nodeId: id })), busy ? 'Interrupt the turn before closing the Session' : 'Close the Session; the Node stays')}
            >
              Close
            </button>
          ) : saved !== undefined ? (
            <button
              type="button"
              style={styles.tool}
              data-testid="session-node-resume"
              {...writeAction(readOnly, () => act(() => invoke('sessions.start', { projectId: project.id, nodeId: id })), 'Continue this Session in worfy')}
            >
              Resume
            </button>
          ) : null}
          <KeepButton id={id} keep={keep} readOnly={readOnly} />
          <button type="button" style={styles.tool} {...writeAction(readOnly, () => void ops.apply({ op: 'hide', id, hidden: true }), 'Hide the Node; the Session goes on')}>
            Hide
          </button>
          <button
            type="button"
            style={styles.tool}
            data-testid="session-node-remove"
            disabled={running}
            {...writeAction(readOnly, () => void ops.apply({ op: 'remove', id }), running ? 'Close the Session before removing its Node' : 'Remove the Node; the transcript stays')}
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
      {chips.length > 0 ? (
        <div className="nodrag nowheel" style={styles.chips}>
          <AttachmentChips chips={chips} onRemove={(key) => changeChips((current) => current.filter((chip) => chip.key !== key))} />
        </div>
      ) : null}
      <form className="nodrag" style={styles.form} onSubmit={(event) => void send(event)}>
        <input
          style={styles.input}
          data-testid="session-node-input"
          aria-label="Message to the Session"
          placeholder={readOnly ?? (running ? 'Message the Session' : saved === undefined ? 'Start the Session' : 'Resume with a message')}
          readOnly={readOnly !== null}
          title={readOnly ?? undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          style={styles.tool}
          data-testid="session-node-send"
          disabled={readOnly === null && draft.trim() === '' && chips.length === 0}
          {...(readOnly === null ? {} : { 'aria-disabled': 'true' as const, 'data-read-only': '', title: readOnly })}
        >
          Send
        </button>
      </form>
    </div>
  )
}

function SessionNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const worfy = readWorfySessionNodeData(data.node.data)
  const info = readSessionNodeData(data.node.data)
  const project = activeProject(useProjects())
  const { live, history } = useClaudeHome(project?.path)
  const titleId = useTitleElementId(id)

  if (worfy !== null && project !== undefined) return <LiveSessionNode id={id} selected={selected} info={worfy} project={project} keep={data.node.keep === true} />

  if (info === null || project === undefined) {
    return (
      <div className="w-node-surface" style={styles.root} data-testid="session-node" data-node-id={id} {...refuseFiles}>
        <div style={styles.broken}>This Session Node has no Session</div>
      </div>
    )
  }

  const session = live?.find((each) => each.sessionId === info.sessionId)
  const chip = live === undefined ? { status: 'ready' as const, label: '…' } : sessionStatus(session)
  // The registry is read and has no process for it: finished (sessionStatus).
  const finished = live !== undefined && session === undefined
  const title = session?.name ?? history.find((each) => each.sessionId === info.sessionId)?.title ?? info.name ?? `Session ${info.sessionId.slice(0, 8)}`
  const subject: SlotSubject = { kind: 'session', projectId: project.id, root: project.path, sessionId: info.sessionId }
  // What Hide and Remove leave behind (worfy-week ticket 12): a Session that runs goes on; any other
  // keeps its transcript — also true while the registry has not been read yet.
  const leaves = session !== undefined ? 'the Session goes on' : 'the transcript stays'

  return (
    <div
      className="w-node-surface"
      style={styles.root}
      role="group"
      id={titleId}
      aria-label={sessionLabel(title)}
      data-testid="session-node"
      data-node-id={id}
      data-finished={finished || undefined}
      data-session-id={info.sessionId}
      data-status={chip.label}
      {...refuseFiles}
      onDoubleClick={() => openSession({ nodeId: id, projectId: project.id, external: { sessionId: info.sessionId } })}
    >
      <NodeResizeClamp
        isVisible={selected}
        minWidth={200}
        minHeight={80}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div style={styles.header} title="Double-click to open the transcript" {...NODE_HEADER}>
        <KindBand kind="session" />
        <KindIcon kind="session" />
        <span style={styles.title} data-testid="session-node-title" title={title}>
          {title}
        </span>
        <span data-testid="session-node-status">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="nodrag" style={styles.tools}>
          <KeepButton id={id} keep={data.node.keep === true} readOnly={readOnly} />
          <button type="button" style={styles.tool} {...writeAction(readOnly, () => void ops.apply({ op: 'hide', id, hidden: true }), `Hide the Node; ${leaves}`)}>
            Hide
          </button>
          <button type="button" style={styles.tool} {...writeAction(readOnly, () => void ops.apply({ op: 'remove', id }), `Remove the Node; ${leaves}`)}>
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
