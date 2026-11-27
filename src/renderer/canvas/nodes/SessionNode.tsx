import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import type { AgentEvent } from '../../../shared/agent/events'
import { chatCommandToast } from '../../../shared/autopilot/chat-command'
import { TRANSCRIPT_WINDOW_BYTES } from '../../../shared/ipc/claude-home'
import type { ProjectView } from '../../../shared/ipc/projects'
import type { WorfySessionNodeData } from '../../../shared/ipc/sessions'
import { UNNAMED_VENDOR } from '../../../shared/vendors/vendor'
import {
  isCodexSession,
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
import { writeAction, writeItem } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { checkFiles, readFiles, roomFor, takeAttached } from '../../session/attach-files'
import { clearDraft, draftKey, useDraft } from '../../session/drafts'
import { STATE_CHIPS } from '../../session/format'
import { AttachmentChips, type Chip } from '../../session/MessageInput'
import { openSession } from '../../session/navigation'
import { isRunning, useSessionNodeView } from '../../session/node-sessions'
import { useSessionLog } from '../../session/store'
import { VendorBadge } from '../../session/VendorBadge'
import { Menu, MenuCheckboxItem, MenuItem } from '../../theme/kit/Menu'
import { StatusChip, type Status } from '../../theme/primitives'
import { showToast } from '../../toast/toasts'
import { archiveSessionNode } from '../archive-node'
import { badges, type SlotSubject } from '../badges'
import { KIND, type NodeKindColour } from '../kind-colours'
import { KindBand, KindIcon } from '../kind-icons'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { NODE_HEADER } from '../node-header'
import { useElementSize } from '../use-element-size'
import { screenChannel, useLayoutOps } from '../useLayout'
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
//   the Vendor whose agent runs it before its folder (session/VendorBadge.tsx, worfy-multi-vendor
//   ticket 24), its last answer and an input field. A Node whose Session is not running offers Resume, under
//   the rule of src/main/agent/resume.ts; a message sent to it resumes it first. A Session a restart of
//   worfy cut off that worfy did not continue by itself (its view's `restart`, worfy-continuity ticket 05)
//   shows «Interrupted by restart», the reason in its tooltip, and Continue: Resume, then the continuation
//   message main kept for it (src/main/agent/continuity.ts). Until the live
//   Session answers, a resumed Node shows the last answer of its transcript (worfy-daily ticket 22).
//   A file or an image dropped on the Node goes with the next message, as one dropped on the input
//   field of the Session view does (session/attach-files.ts): main checks it, it shows as a chip
//   above the Node's input field, and a refusal shows in the Node's problem line. A drop on a Node
//   whose Session is not running resumes it first: an attachment belongs to a running Session.
//   A read-only Node takes no files.
//   A Product Session (`data.kind: 'product'`, worfy-product-session ticket 06) is such a Node too,
//   told apart by the label «Product Session» under its header and by its name, which says Product
//   Session where a plain one says Session.
// - Read-only, of Codex (worfy-multi-vendor ticket 27): a Codex thread of the Project started outside
//   worfy (`data.vendor: 'codex'`, claude-home/session-nodes.ts). It shows the Codex badge, its
//   transcript comes from Codex (`history.read`), and Resume continues the thread on a live Node in
//   its place (`sessions.resume`). Codex does not say whether the thread still runs in its terminal,
//   so Resume of a thread worfy did not start asks first: «This Session may be open in a terminal».
//
// Every kind has Archive on the line under its header (worfy-product-session ticket 37): the user's own archive of
// the Node, inactive while its Session runs; a Product Session leaves the Canvas for the Archive only so.
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
  // From a zero basis: the source takes the room left on its line and gives it all up before the label beside it.
  source: { flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // The label of a Product Session: an outlined tag, as the Vendor badge beside it is a filled one.
  // It gives way after the source, so Archive at the end of its line stays whole on a 240 px Node.
  kindLabel: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    fontWeight: 600,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
  },
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
  question: { flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)', minWidth: 0, fontSize: 'var(--text-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
  questionText: { flexBasis: '100%', whiteSpace: 'normal' },
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
  // Archive sits at the end of the line under the header, not in the header: there the chip and the
  // other buttons leave the title no room for one more (a 300 px Codex Node, worfy-product-session
  // ticket 37). The source on that line gives way instead.
  archive: {
    flex: 'none',
    marginLeft: 'auto',
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

/** The same for a Product Session's Node: «Product Session» where a plain one says «Session». */
const productSessionLabel = (title: string): string => {
  if (/^(new )?product session\b/i.test(title)) return title
  return /^session\b/i.test(title) ? `Product ${title}` : `Product Session ${title}`
}

/** What a Product Session's Node is called before its Session has an id, where a plain one says «New session». */
const NEW_PRODUCT_SESSION = 'New Product Session'

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
 * A button of a Session Node's header, which goes into the header's «⋯» menu when the header is too
 * narrow for it (useHeaderFit): the same name, tooltip and inactive state in either place.
 */
interface HeaderTool {
  label: string
  testId?: string
  run: () => void
  /** The tooltip: what it does, or why it is inactive. */
  hint?: string
  /** Inactive for a reason of its own (the Session runs); a read-only screen makes every one inactive. */
  disabled?: boolean
  /** A toggle (Keep): whether it is on. */
  pressed?: boolean
}

/**
 * Keep (ADR-0076): the automatic archive and «Archive finished sessions now» leave the Node on the
 * Canvas while it is pressed. A step of ⌘Z; inactive on a read-only screen.
 */
const keepTool = (keep: boolean, toggle: () => void): HeaderTool => ({
  label: keep ? 'Kept' : 'Keep',
  testId: 'session-node-keep',
  run: toggle,
  hint: keep ? 'Kept: the archive leaves this Session on the Canvas. Click to let it go' : 'Keep this Session on the Canvas: the archive leaves it',
  pressed: keep,
})

/**
 * The narrowest the title of a Session Node's header gets while a button of the header can still go
 * into its «⋯» menu (worfy-polish ticket 153): 64 px, about nine characters of the header's 13 px
 * semibold font — «Session 1a2» of a Session's id, «Plan the ro…» of a name. At 31 px (ticket 37's
 * measure of a 340 px finished Node) it showed «Pl…», which named no Session.
 */
export const TITLE_MIN = 64
/** How much wider than it needs a header must get before a button comes back out of the menu: no flicker at the edge. */
const HEADER_SLACK = 8

interface HeaderFit {
  /** The buttons the fit was measured for (useHeaderFit's `key`). */
  key: string
  /** How many buttons, counted from the end, are in the menu. */
  inMenu: number
  /** `needs[n]`: the header's width with `n` buttons in the menu, measured when it was too narrow for them. */
  needs: readonly number[]
  /** Measured for other buttons while the menu was open: measured again from every button outside once it closes. */
  stale: boolean
}

/** `needs` with `need` at `at`: the widths measured for more buttons in the menu no longer hold. */
const withNeed = (needs: readonly number[], at: number, need: number): number[] => {
  const next = needs.slice(0, at)
  next[at] = need
  return next
}

/**
 * How many of `count` header buttons go into the «⋯» menu, counted from the end, so the title keeps
 * TITLE_MIN (worfy-polish ticket 153). The header itself is measured, in layout pixels: the zoom of the
 * Canvas and the font cannot mislead it. Before a paint, while its content overflows it — the title
 * held at TITLE_MIN — one more button goes in, and the width this layout needed is kept; a button comes
 * back when the header has HEADER_SLACK px more than that, so a header at the edge stays as it is. With
 * every button in the menu the title gives up its minimum: a chip as wide as «Interrupted by restart»
 * on a 240 px Node leaves it less. `key` names the buttons and the chip; when it changes, what was
 * measured no longer holds, and the header is measured again from every button outside. While the menu
 * is `open` that waits until it closes: the buttons in it stay there (more may go in), so the open menu
 * neither goes nor takes the focus with it.
 */
function useHeaderFit(count: number, key: string, open: boolean): { onHeader: (element: HTMLDivElement | null) => void; inMenu: number; titleMin: number } {
  const header = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [fit, setFit] = useState<HeaderFit>({ key, inMenu: 0, needs: [], stale: false })
  // What this render draws: the fit as stored, or as it is about to be after a change of `key` or of `open`.
  const next: HeaderFit =
    fit.key !== key
      ? open
        ? { key, inMenu: Math.min(fit.inMenu, count), needs: [], stale: true }
        : { key, inMenu: 0, needs: [], stale: false }
      : fit.stale && !open
        ? { key, inMenu: 0, needs: [], stale: false }
        : fit
  if (next !== fit) setFit(next)

  const onSize = useCallback(({ width: next }: { width: number }) => {
    setWidth(next)
    setFit((now) => {
      let inMenu = now.inMenu
      while (inMenu > 0 && next >= (now.needs[inMenu - 1] ?? Infinity) + HEADER_SLACK) inMenu -= 1
      return inMenu === now.inMenu ? now : { ...now, inMenu }
    })
  }, [])
  const measure = useElementSize<HTMLDivElement>(onSize)
  const onHeader = useCallback(
    (element: HTMLDivElement | null) => {
      header.current = element
      measure(element)
    },
    [measure],
  )

  useLayoutEffect(() => {
    const element = header.current
    if (element === null || fit.key !== key || fit.inMenu >= count || element.scrollWidth <= element.clientWidth) return
    const need = Math.max(element.scrollWidth, element.clientWidth + 1)
    setFit((now) => (now !== fit ? now : { ...now, inMenu: now.inMenu + 1, needs: withNeed(now.needs, now.inMenu, need) }))
  }, [fit, key, width, count])

  const inMenu = Math.min(next.inMenu, count)
  return { onHeader, inMenu, titleMin: inMenu < count ? TITLE_MIN : 0 }
}

/**
 * The header's buttons: those that fit, then the «⋯» menu with the last `inMenu` of them as its items.
 * An item is the same action as its button, with its name and tooltip, inactive when the button would
 * be (writeItem on a read-only screen); Keep is a checkbox item, on while the Node is kept.
 */
function HeaderTools({
  tools,
  inMenu,
  readOnly,
  open,
  onOpenChange,
}: {
  tools: readonly HeaderTool[]
  inMenu: number
  readOnly: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const outside = tools.slice(0, tools.length - inMenu)
  const menu = tools.slice(tools.length - inMenu)
  const trigger = (
    <button type="button" style={styles.tool} data-testid="session-node-more" aria-label="More actions" title="More actions">
      ⋯
    </button>
  )
  return (
    <span className="nodrag" style={styles.tools}>
      {outside.map((tool) => (
        <button
          key={tool.testId ?? tool.label}
          type="button"
          style={styles.tool}
          data-testid={tool.testId}
          disabled={tool.disabled}
          aria-pressed={tool.pressed}
          {...writeAction(readOnly, tool.run, tool.hint)}
        >
          {tool.label}
        </button>
      ))}
      {menu.length > 0 ? (
        <Menu open={open} onOpenChange={onOpenChange} trigger={trigger} label="Session actions" align="end" inNode>
          {menu.map((tool) => {
            const { onClick, disabled, ...marks } = writeItem(readOnly, tool.run)
            const common = { ...marks, className: 'w-row', testId: tool.testId, title: readOnly === null ? tool.hint : undefined, disabled: disabled || tool.disabled === true }
            return tool.pressed === undefined ? (
              <MenuItem key={tool.testId ?? tool.label} {...common} onClick={onClick}>
                {tool.label}
              </MenuItem>
            ) : (
              <MenuCheckboxItem key={tool.testId ?? tool.label} {...common} checked={tool.pressed} onCheckedChange={onClick} closeOnClick>
                {tool.label}
              </MenuCheckboxItem>
            )
          })}
        </Menu>
      ) : null}
    </span>
  )
}

/**
 * Archive (worfy-product-session ticket 37): the user's own archive of this Node, one step of ⌘Z
 * (archive-node.ts, archiveSessionNode); Restore in the Archive brings it back. The only way a Product
 * Session's Node goes into the Archive: the automatic archive never takes it. Inactive, with
 * `blocked` as the reason, while main would refuse it — a Session that runs, or none yet — and on a
 * read-only screen. Main's refusal at the write goes to `onProblem`.
 */
/**
 * Why Archive on a Session Node is inactive, or null when it is not: main drops a kept or pinned Node
 * from a screen's `archive` (archiveFromScreen), so the button says so first; then `session`, the
 * reason the Node's Session gives (it runs, or has not started), if any.
 */
const archiveBlock = (node: { keep: boolean; pinned: boolean }, session: string | null): string | null =>
  node.keep ? 'Kept on the Canvas: press Kept to let it go first' : node.pinned ? 'Pinned to the screen: unpin it first' : session

function ArchiveButton({ projectId, id, blocked, readOnly, onProblem }: { projectId: string; id: string; blocked: string | null; readOnly: string | null; onProblem: (problem: string) => void }) {
  const archive = () =>
    void archiveSessionNode(projectId, id, screenChannel(projectId)).then((problem) => {
      if (problem !== undefined) onProblem(problem)
    })
  return (
    <button
      type="button"
      className="nodrag"
      style={styles.archive}
      data-testid="session-node-archive"
      disabled={blocked !== null}
      {...writeAction(readOnly, archive, blocked ?? 'Archive this Session: it leaves the Canvas, nothing is deleted; Restore in the Archive brings it back')}
    >
      Archive
    </button>
  )
}

/**
 * The header of a Session Node: the kind band and icon, the title, the status chip and the buttons
 * (HeaderTools), as many of them outside as leave the title TITLE_MIN (useHeaderFit). `hint` is the
 * header's own tooltip, `chipTitle` the chip's.
 */
function SessionHeader({
  hint,
  title,
  chip,
  chipTitle,
  tools,
  readOnly,
}: {
  hint: string
  title: string
  chip: { status: Status; label: string }
  chipTitle?: string
  tools: readonly HeaderTool[]
  readOnly: string | null
}) {
  const [open, setOpen] = useState(false)
  const { onHeader, inMenu, titleMin } = useHeaderFit(tools.length, [chip.label, ...tools.map((tool) => tool.label)].join('|'), open)
  // Every button came back out (a wider header, a turn that ended): the menu went, and it is closed,
  // so it does not open by itself when a button goes into it again.
  if (open && inMenu === 0) setOpen(false)
  return (
    <div ref={onHeader} style={styles.header} title={hint} data-testid="session-node-header" {...NODE_HEADER}>
      <KindBand kind="session" />
      <KindIcon kind="session" />
      <span style={{ ...styles.title, minWidth: titleMin }} data-testid="session-node-title" title={title}>
        {title}
      </span>
      <span data-testid="session-node-status" title={chipTitle}>
        <StatusChip status={chip.status} label={chip.label} />
      </span>
      <HeaderTools tools={tools} inMenu={inMenu} readOnly={readOnly} open={open} onOpenChange={setOpen} />
    </div>
  )
}

/**
 * The id that names the Node's React Flow wrapper (flow-nodes.ts), on the Canvas copy alone: focus
 * mode draws the Node in a tile while the Canvas keeps its own copy, and an id twice in the document
 * is invalid, with the wrapper named by whichever copy comes first.
 */
const useTitleElementId = (id: string): string | undefined => (useInFocusTile() ? undefined : sessionTitleElementId(id))

/** A Session worfy runs, or ran: main's view while it runs, its saved session id otherwise. */
function LiveSessionNode({
  id,
  selected,
  info,
  project,
  keep,
  pinned,
}: Pick<CanvasNodeProps, 'id' | 'selected'> & { info: WorfySessionNodeData; project: ProjectView; keep: boolean; pinned: boolean }) {
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
  // What is typed and not sent stays as this field's draft (session/drafts.ts; worfy-polish ticket 95).
  const draftId = draftKey('node', project.id, id)
  const [draft, setDraft] = useDraft(draftId)
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
  // A Product Session (worfy-product-session ticket 06): the kind its data keeps, or main's view while it runs.
  const product = (view?.kind ?? info.kind) === 'product'
  const title = product && saved === undefined ? NEW_PRODUCT_SESSION : worfySessionTitle(saved, history)
  // Not running (no view, or a closed one) after it has run: finished.
  const finished = !running && saved !== undefined
  // A restart of worfy cut it off and worfy did not continue it by itself (worfy-continuity ticket 05): Continue.
  const restartMark = view?.restart ?? null
  const cutOff = running ? null : restartMark
  const chip: { status: Status; label: string } = running
    ? STATE_CHIPS[view.state]
    : cutOff !== null
      ? { status: 'blocked', label: 'Interrupted by restart' }
      : finished
        ? { status: 'done', label: 'finished' }
        : { status: 'ready', label: 'new' }
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
    clearDraft(draftId)
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

  // The header's buttons, the action of the state first (Interrupt, Close, Continue or Resume): the
  // last go into the «⋯» menu first when the header is too narrow (worfy-polish ticket 153).
  const resume = () => act(() => invoke('sessions.start', { projectId: project.id, nodeId: id }))
  const primary: HeaderTool[] = running
    ? [
        ...(busy ? [{ label: 'Interrupt', testId: 'session-node-interrupt', run: () => act(() => invoke('agent.interrupt', { sessionId: view.sessionId })) }] : []),
        {
          label: 'Close',
          testId: 'session-node-close',
          run: () => act(() => invoke('sessions.close', { nodeId: id })),
          hint: busy ? 'Interrupt the turn before closing the Session' : 'Close the Session; the Node stays',
          disabled: busy,
        },
      ]
    : cutOff !== null
      ? [{ label: 'Continue', testId: 'session-node-continue', run: resume, hint: 'Continue the Session where the restart of worfy cut it off' }]
      : saved !== undefined
        ? [{ label: 'Resume', testId: 'session-node-resume', run: resume, hint: 'Continue this Session in worfy' }]
        : []
  const tools: HeaderTool[] = [
    ...primary,
    keepTool(keep, () => void ops.apply({ op: 'keep', id, keep: !keep })),
    { label: 'Hide', run: () => void ops.apply({ op: 'hide', id, hidden: true }), hint: 'Hide the Node; the Session goes on' },
    {
      label: 'Remove',
      testId: 'session-node-remove',
      run: () => void ops.apply({ op: 'remove', id }),
      hint: running ? 'Close the Session before removing its Node' : 'Remove the Node; the transcript stays',
      disabled: running,
    },
  ]

  return (
    <div
      className="w-node-surface"
      style={dragging ? { ...styles.root, ...styles.dragging } : styles.root}
      role="group"
      id={titleId}
      aria-label={product ? productSessionLabel(title) : sessionLabel(title)}
      data-testid="session-node"
      data-live="true"
      data-node-id={id}
      data-session-kind={product ? 'product' : undefined}
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
      <SessionHeader
        hint="Double-click to open the Session"
        title={title}
        chip={chip}
        chipTitle={running ? (view.error ?? undefined) : cutOff !== null ? `Not continued: ${cutOff.reason}` : undefined}
        tools={tools}
        readOnly={readOnly}
      />
      <div style={styles.body}>
        <div style={styles.line}>
          {/* On the line under the header, not in it: the header's chip and buttons leave the title no room for it. */}
          {product ? (
            <span style={styles.kindLabel} data-testid="session-node-kind">
              Product Session
            </span>
          ) : null}
          <VendorBadge vendor={view?.vendor ?? info.vendor ?? UNNAMED_VENDOR} form="short" testId="session-node-vendor" />
          <span className="w-mono" style={styles.source} data-testid="session-node-source" title={cwd}>
            worfy · {cwd}
          </span>
            <ArchiveButton
              projectId={project.id}
              id={id}
              blocked={archiveBlock({ keep, pinned }, running ? 'Close the Session before archiving its Node' : saved === undefined ? 'Nothing to archive yet: the Session has not started' : null)}
              readOnly={readOnly}
              onProblem={setProblem}
            />
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

/** The chip of a Codex thread started outside worfy: Codex does not say whether it still runs. */
const CODEX_OUTSIDE_CHIP = { status: 'done', label: 'unknown' } as const satisfies { status: Status; label: string }

function SessionNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const worfy = readWorfySessionNodeData(data.node.data)
  const info = readSessionNodeData(data.node.data)
  const project = activeProject(useProjects())
  const { live, history } = useClaudeHome(project?.path)
  const titleId = useTitleElementId(id)
  // A Codex Node's Resume: asking whether to go on while the thread may be open in a terminal, and why it failed.
  const [asking, setAsking] = useState(false)
  const [resumeProblem, setResumeProblem] = useState<string | null>(null)

  if (worfy !== null && project !== undefined) return <LiveSessionNode id={id} selected={selected} info={worfy} project={project} keep={data.node.keep === true} pinned={data.node.pinned === true} />

  if (info === null || project === undefined) {
    return (
      <div className="w-node-surface" style={styles.root} data-testid="session-node" data-node-id={id} {...refuseFiles}>
        <div style={styles.broken}>This Session Node has no Session</div>
      </div>
    )
  }

  const session = live?.find((each) => each.sessionId === info.sessionId)
  const past = history.find((each) => each.sessionId === info.sessionId)
  const codex = isCodexSession(info)
  // Codex keeps no registry of live Sessions: whether the thread still runs in its terminal is not known.
  const chip = codex ? CODEX_OUTSIDE_CHIP : live === undefined ? { status: 'ready' as const, label: '…' } : sessionStatus(session)
  // The registry is read and has no process for it: finished (sessionStatus).
  const finished = !codex && live !== undefined && session === undefined
  const title = session?.name ?? past?.title ?? info.name ?? `Session ${info.sessionId.slice(0, 8)}`
  const resume = async (): Promise<void> => {
    setAsking(false)
    setResumeProblem(null)
    const result = await invoke('sessions.resume', { projectId: project.id, sessionId: info.sessionId })
    if (!result.ok) setResumeProblem(result.error)
  }
  // A thread worfy started is not open in a terminal; any other may be, unknown where it was started too.
  const askResume = () => (past?.origin === 'worfy' ? void resume() : setAsking(true))
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
      <SessionHeader
        hint="Double-click to open the transcript"
        title={title}
        chip={chip}
        tools={[
          keepTool(data.node.keep === true, () => void ops.apply({ op: 'keep', id, keep: data.node.keep !== true })),
          { label: 'Hide', run: () => void ops.apply({ op: 'hide', id, hidden: true }), hint: `Hide the Node; ${leaves}` },
          { label: 'Remove', run: () => void ops.apply({ op: 'remove', id }), hint: `Remove the Node; ${leaves}` },
        ]}
        readOnly={readOnly}
      />
      <div style={styles.body}>
        <div style={styles.line}>
          {codex ? <VendorBadge vendor={info.vendor ?? UNNAMED_VENDOR} form="short" testId="session-node-vendor" /> : null}
          <span style={styles.readOnly} data-testid="session-node-read-only">
            read-only
          </span>
          <span className="w-mono" style={styles.source} data-testid="session-node-source" title={sessionSourceLabel(info)}>
            {sessionSourceLabel(info)}
          </span>
            <ArchiveButton
              projectId={project.id}
              id={id}
              blocked={archiveBlock({ keep: data.node.keep === true, pinned: data.node.pinned === true }, session !== undefined ? 'The Session still runs; archive its Node once it ends' : null)}
              readOnly={readOnly}
              onProblem={setResumeProblem}
            />
        </div>
        {codex && !asking ? (
          <div className="nodrag" style={styles.question}>
            {/* Under the header, not in it: the header's chip and buttons leave the title no room for one more. */}
            <button type="button" style={styles.tool} data-testid="session-node-resume" {...writeAction(readOnly, askResume, 'Continue this Session in worfy')}>
              Resume
            </button>
          </div>
        ) : null}
        {asking ? (
          <div className="nodrag" style={styles.question} role="alertdialog" aria-label="Resume the Session" data-testid="session-node-resume-question">
            <span style={styles.questionText}>This Session may be open in a terminal</span>
            <button type="button" style={styles.tool} onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" style={{ ...styles.tool, color: 'var(--text)' }} data-testid="session-node-resume-confirm" onClick={() => void resume()}>
              Resume anyway
            </button>
          </div>
        ) : null}
        {resumeProblem !== null ? (
          <div style={styles.error} role="alert" data-testid="session-node-error">
            {resumeProblem}
          </div>
        ) : null}
        {badges.length && !asking ? (
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
