/// <reference types="vite/client" />
// Search over the Canvas (⌘F, ticket 31), and the Canvas side of the command palette's requests
// (canvas-requests.ts). It is a Canvas overlay (canvas/overlays/CanvasFind.tsx draws it inside
// React Flow), so it can move the viewport.
//
// ⌘F opens a bar over the Canvas. It searches Node titles, Ticket titles, the transcripts of the
// Sessions open in this window, HANDOFF.md and the visible text of Cards (`card.text`, ticket 26);
// with Nodes selected when it opens, only those (and what is inside them). It shows the count;
// Enter / ⇧Enter go to the next / previous match: the Canvas moves to its Node and outlines it.
// Esc closes. The index (search-index.ts) is updated when its sources change, not per keystroke.
//
// Everything here only reads: the search, the outline and the tag filter are this window's view,
// nothing is saved, and nothing reaches the Project (ADR-0002, ADR-0005). A new Node and "Tidy up"
// from the palette go through the Canvas's LayoutOps like a click in the Canvas menu.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Panel, useReactFlow, useStore, useStoreApi, type ReactFlowInstance } from '@xyflow/react'
import { shownOnCanvas } from '../../shared/layout/derived'
import { ZOOM_MAX, ZOOM_MIN, type LayoutNode } from '../../shared/layout/types'
import { SHORTCUTS } from '../../shared/shortcuts'
import { requestCardText } from '../canvas/card-bridge'
import { nodeTypes, type CanvasFlowNode } from '../canvas/nodes'
import { createItems } from '../canvas/overlays/create-items'
import { useTidyUp } from '../canvas/tidy'
import { useLayout, useLayoutOps } from '../canvas/useLayout'
import { useDocs, useDocText } from '../docs/useDocs'
import { activeProject, useProjects } from '../projects/useProjects'
import { useSessionLogs } from '../session/store'
import { label, matches as matchesShortcut } from '../shortcuts/match'
import { useWorkflow } from '../workflow/useWorkflow'
import { closeFind, drawnUnderTagFilter, openFind, useCanvasRequests } from './canvas-requests'
import { rectOf, type Rect } from './node-rect'
import { FIND_LIMIT, findDocs, FindIndex, MIN_FIND_QUERY, orderMatches, selectionScope, snippet, stepMatch, type FindField, type FindMatch } from './search-index'

export const order = 60

/** The Canvas menu's "New …" items (the same glob as CanvasMenu.tsx), for the palette's commands. */
const menuItems = createItems(import.meta.glob('../canvas/nodes/*Node.tsx', { eager: true }), nodeTypes).map(({ label, type }) => ({ label, kind: type.kind }))

/** Frames a request waits for its Node to reach React Flow, shown: about a second. */
const FOCUS_TRIES = 60
/** Frames a Ticket is waited for before its frame is centered instead. */
const FALLBACK_AFTER = 20
/** A Card is asked for its text again this long after the Canvas stopped moving. */
const CARD_TEXT_DELAY_MS = 250
/** How often a Card without an answer is asked again while the bar is open. */
const CARD_RETRY_MS = 1500
/** Nodes outlined as matches at most; the current one is always outlined. */
const OUTLINED = 200

type Flow = ReactFlowInstance<CanvasFlowNode>

/** Moves the viewport so the rectangle is in the middle, zoomed in far enough to read and out far enough to fit. */
function centerOn(flow: Flow, viewWidth: number, viewHeight: number, rect: Rect): void {
  const fit = Math.min(viewWidth / (rect.w + 64), viewHeight / (rect.h + 64))
  const zoom = Math.min(ZOOM_MAX, fit, Math.max(ZOOM_MIN, flow.getZoom(), 0.6))
  void flow.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom: Math.max(ZOOM_MIN, zoom), duration: 250 })
}

const cssId = (id: string): string => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'))

// ── requests from the palette ───────────────────────────────────────────────

/**
 * Centers the Canvas on the Node a request names. The selection stays as it was: it is what ⌘F
 * searches in, and going somewhere must not narrow the next search.
 */
function useFocusRequests(projectId: string): void {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const request = useCanvasRequests((state) => state.focus)
  // A request made before this Canvas was drawn (another Project's) is not carried out.
  const handled = useRef(useCanvasRequests.getState().focus?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const { width, height } = store.getState()
      let rect = rectOf(flow, request.nodeId)
      if (!rect && request.fallbackId !== undefined && tries >= FALLBACK_AFTER) rect = rectOf(flow, request.fallbackId)
      if (!rect || !width || !height) {
        tries += 1
        if (tries < FOCUS_TRIES) frame = requestAnimationFrame(attempt)
        return
      }
      centerOn(flow, width, height, rect)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [request, projectId, flow, store])
}

/** Creates a Node of the requested kind in the middle of the Canvas, as the Canvas menu does at the pointer. */
function useCreateRequests(projectId: string): void {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const ops = useLayoutOps()
  const request = useCanvasRequests((state) => state.create)
  const handled = useRef(useCanvasRequests.getState().create?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    const type = nodeTypes.get(request.kind)
    if (!type) return
    let frame = 0
    let tries = 0
    // The Canvas may have been hidden behind the Session view a moment ago: wait for its size.
    const attempt = (): void => {
      const box = store.getState().domNode?.getBoundingClientRect()
      if (!box || box.width === 0 || box.height === 0) {
        tries += 1
        if (tries < FOCUS_TRIES) frame = requestAnimationFrame(attempt)
        return
      }
      const center = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
      void ops.apply({
        op: 'create',
        node: { kind: type.kind, x: Math.round(center.x - type.defaultWidth / 2), y: Math.round(center.y - type.defaultHeight / 2), w: type.defaultWidth, h: type.defaultHeight, data: {} },
      })
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [request, projectId, flow, store, ops])
}

/** Carries out the palette's "Tidy up" (canvas/tidy.ts) through the Canvas's LayoutOps, as the Canvas menu item does. */
function useTidyRequests(projectId: string, root: string): void {
  const tidyUp = useTidyUp(projectId, root)
  const request = useCanvasRequests((state) => state.tidy)
  const handled = useRef(useCanvasRequests.getState().tidy?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    void tidyUp()
  }, [request, projectId, tidyUp])
}

const filterStyles = {
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    height: 'var(--row-height)',
    padding: '0 var(--space-1) 0 var(--space-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-control)',
    fontSize: 'var(--text-12)',
    color: 'var(--text-secondary)',
  },
  button: { height: 20, padding: '0 6px', border: 0, borderRadius: 'var(--radius-chip)', background: 'var(--surface-raised)', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-11)', cursor: 'pointer' },
} satisfies Record<string, CSSProperties>

/** "Show only tag": every Node without the tag, and the edges that touch one, are not drawn. */
function TagFilterView({ projectId }: { projectId: string }) {
  const filter = useCanvasRequests((state) => state.tagFilter)
  const nodes = useStore((state) => state.nodes as CanvasFlowNode[])
  const edges = useStore((state) => state.edges)
  const active = filter !== null && filter.projectId === projectId ? filter : null
  const css = useMemo(() => {
    if (active === null) return ''
    const hidden = new Set(nodes.filter((node) => !drawnUnderTagFilter(active, projectId, node.data.node.tags)).map((node) => node.id))
    const rules = [...hidden].map((id) => `.react-flow__node[data-id="${cssId(id)}"]`)
    for (const edge of edges) if (hidden.has(edge.source) || hidden.has(edge.target)) rules.push(`.react-flow__edge[data-id="${cssId(edge.id)}"]`)
    return rules.length ? `${rules.join(',\n')} { visibility: hidden; pointer-events: none; }` : ''
  }, [active, projectId, nodes, edges])
  if (active === null) return null
  return (
    <>
      <style data-testid="tag-filter-style">{css}</style>
      <Panel position="bottom-center">
        <div style={filterStyles.chip} data-testid="tag-filter" data-tag={active.tag}>
          Only tag <span className="w-mono">{active.tag}</span>
          <button type="button" style={filterStyles.button} onClick={() => useCanvasRequests.setState({ tagFilter: null })}>
            Show all
          </button>
        </div>
      </Panel>
    </>
  )
}

// ── the find bar ────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<FindField, string> = { node: 'title', ticket: 'ticket', transcript: 'transcript', handoff: 'HANDOFF', card: 'card' }

const barStyles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    width: 'min(520px, calc(100vw - 48px))',
    minHeight: 36,
    padding: '0 var(--space-1) 0 var(--space-3)',
    boxSizing: 'border-box',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-popover)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
    color: 'var(--text-muted)',
    fontSize: 'var(--text-12)',
  },
  input: { flex: 1, minWidth: 80, height: 34, border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-13)' },
  count: { flex: 'none', fontVariantNumeric: 'tabular-nums' },
  scope: { flex: 'none', padding: '1px 6px', borderRadius: 'var(--radius-chip)', background: 'var(--working-bg)', color: 'var(--working-text)', fontSize: 'var(--text-11)' },
  button: { flex: 'none', width: 24, height: 24, padding: 0, border: 0, borderRadius: 'var(--radius-button)', background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', cursor: 'pointer' },
  where: {
    width: 'min(520px, calc(100vw - 48px))',
    marginTop: 4,
    padding: '4px var(--space-3)',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-12)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
} satisfies Record<string, CSSProperties>

/** The Cards' visible text, asked when the bar opens and again after the Canvas or its Cards change. */
function useCardTexts(cards: readonly { nodeId: string; cardId: string }[]): Readonly<Record<string, string>> {
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({})
  // A Card runs only while it is on screen and zoomed in enough (CardNode.tsx): moving the Canvas
  // can bring one in. Its last answer stays when it leaves the screen.
  const viewport = useStore((state) => state.transform.join(','))
  const key = cards.map((card) => `${card.nodeId}:${card.cardId}`).join('|')
  // A Card that has not answered yet (its page was still loading) is asked again now and then.
  const missing = cards.some((card) => texts[card.nodeId] === undefined)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!missing) return
    const timer = setInterval(() => setRetry((count) => count + 1), CARD_RETRY_MS)
    return () => clearInterval(timer)
  }, [missing])
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      for (const { nodeId, cardId } of cards) {
        void requestCardText(cardId).then((text) => {
          if (!live || text === null) return
          setTexts((known) => (known[nodeId] === text ? known : { ...known, [nodeId]: text }))
        })
      }
    }, CARD_TEXT_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `key` stands for `cards`: the same Cards in a new array ask nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewport, retry])
  return texts
}

const cardIdOf = (node: LayoutNode): string => (typeof node.data.cardId === 'string' ? node.data.cardId : node.id)
const EMPTY_NODES: readonly LayoutNode[] = []

/** The Nodes the selection covers now, with what is inside them; undefined when nothing is selected. */
function currentScope(store: ReturnType<typeof useStoreApi<CanvasFlowNode>>): ReturnType<typeof selectionScope> {
  const { nodes } = store.getState()
  return selectionScope(
    nodes.filter((node) => node.selected === true).map((node) => node.id),
    nodes.map((node) => ({ id: node.id, parentId: node.parentId })),
  )
}

const sameScope = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.size === b.size && [...a].every((id) => b.has(id)))

interface FindBarProps {
  projectId: string
  root: string
}

function FindBar({ projectId, root }: FindBarProps) {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const input = useRef<HTMLInputElement>(null)
  const findSeq = useCanvasRequests((state) => state.findSeq)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(-1)
  // The selection at the last ⌘F is what it searches: ⌘F again with the bar open takes the
  // selection anew. Moving to a match does not change it.
  const [scoped, setScoped] = useState(() => ({ seq: findSeq, scope: currentScope(store) }))
  if (scoped.seq !== findSeq) {
    const next = currentScope(store)
    if (sameScope(next, scoped.scope)) setScoped({ seq: findSeq, scope: scoped.scope })
    else {
      setScoped({ seq: findSeq, scope: next })
      // Other matches: the step through them starts again.
      setCurrent(-1)
    }
  }
  const { scope } = scoped

  const layoutNodes = useLayout(projectId).state?.layout.nodes ?? EMPTY_NODES
  const { model } = useWorkflow(root)
  const logs = useSessionLogs((state) => state.logs)
  const { state: docsState } = useDocs(projectId)
  const handoff = useDocText(projectId, docsState?.handoff?.path, docsState?.handoff?.version).text
  const cardNodes = useMemo(() => layoutNodes.filter((node) => node.kind === 'card' && shownOnCanvas(node)).map((node) => ({ nodeId: node.id, cardId: cardIdOf(node) })), [layoutNodes])
  const cards = useCardTexts(cardNodes)

  const docs = useMemo(
    () =>
      findDocs({
        nodes: layoutNodes,
        epics: model?.error === null ? model.epics : [],
        tickets: model?.error === null ? model.tickets : [],
        transcripts: logs,
        handoff: docsState?.handoff ? handoff : undefined,
        cards,
      }),
    [layoutNodes, model, logs, docsState, handoff, cards],
  )
  const [index] = useState(() => new FindIndex())
  // The index changes only here, when a source changed; typing only searches it.
  const version = useMemo(() => index.sync(docs), [index, docs])
  const result = useMemo(() => (version >= 0 ? index.search(query, { scope }) : index.search('')), [index, version, query, scope])
  const matches = useMemo(
    () =>
      orderMatches(result.matches, (id) => {
        const rect = rectOf(flow, id)
        return rect && { x: rect.x, y: rect.y }
      }),
    [result, flow],
  )
  const at = current >= 0 && current < matches.length ? current : -1
  const match: FindMatch | undefined = at >= 0 ? matches[at] : undefined
  const shownId = match === undefined ? undefined : flow.getInternalNode(match.nodeId) !== undefined || match.fallbackId === undefined ? match.nodeId : match.fallbackId

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [findSeq])

  const go = (back: boolean) => {
    const next = stepMatch(at, matches.length, back)
    if (next < 0) return
    setCurrent(next)
    const target = matches[next]!
    const rect = rectOf(flow, target.nodeId) ?? (target.fallbackId === undefined ? undefined : rectOf(flow, target.fallbackId))
    const { width, height } = store.getState()
    if (rect && width && height) centerOn(flow, width, height, rect)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFind()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(event.shiftKey)
    }
  }

  const outlined = useMemo(() => {
    const ids = new Set<string>()
    for (const each of matches) {
      if (ids.size >= OUTLINED) break
      ids.add(each.nodeId)
    }
    return ids
  }, [matches])
  const css = [
    ...[...outlined].map((id) => `.react-flow__node[data-id="${cssId(id)}"] { outline: 1px dashed var(--working-dot); outline-offset: 3px; border-radius: var(--radius-node); }`),
    shownId === undefined ? '' : `.react-flow__node[data-id="${cssId(shownId)}"] { outline: 2px solid var(--working-dot); outline-offset: 3px; border-radius: var(--radius-node); }`,
  ].join('\n')

  const q = query.trim()
  let count: string
  if (q.length < MIN_FIND_QUERY) count = ''
  else if (matches.length === 0) count = 'No matches'
  else {
    const total = result.capped ? `${FIND_LIMIT}+` : String(matches.length)
    count = at >= 0 ? `${at + 1} of ${total}` : `${total} ${matches.length === 1 ? 'match' : 'matches'}`
  }
  const text = match === undefined ? undefined : index.text(match.key)

  return (
    <Panel position="top-center" data-toast-keep-out="">
      <style>{css}</style>
      <div
        role="search"
        aria-label="Find on the Canvas"
        className="nodrag nowheel"
        style={barStyles.bar}
        data-testid="canvas-find"
        data-current-node={shownId ?? ''}
        data-current-field={match?.field ?? ''}
      >
        <input
          ref={input}
          aria-label="Find on the Canvas"
          placeholder="Find on the Canvas"
          spellCheck={false}
          style={barStyles.input}
          data-testid="find-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCurrent(-1)
          }}
          onKeyDown={onKeyDown}
        />
        {scope !== undefined ? (
          <span style={barStyles.scope} title={`Only the Nodes selected at the last ${label(SHORTCUTS.find)}`} data-testid="find-scope">
            in selection
          </span>
        ) : null}
        <span className="w-mono" style={barStyles.count} data-testid="find-count" aria-live="polite">
          {count}
        </span>
        <button type="button" style={barStyles.button} aria-label="Previous match" title={`Previous match (${label(SHORTCUTS.findPrevious)})`} onClick={() => go(true)}>
          ↑
        </button>
        <button type="button" style={barStyles.button} aria-label="Next match" title={`Next match (${label(SHORTCUTS.findNext)})`} onClick={() => go(false)}>
          ↓
        </button>
        <button type="button" style={barStyles.button} aria-label="Close" title={`Close (${label(SHORTCUTS.findClose)})`} onClick={closeFind}>
          ×
        </button>
      </div>
      {match !== undefined && text !== undefined ? (
        <div style={barStyles.where} data-testid="find-where">
          <span style={{ color: 'var(--text-muted)' }}>{FIELD_LABELS[match.field]}</span> · {snippet(text, match.offset, q.length)}
        </div>
      ) : null}
    </Panel>
  )
}

function ProjectFind({ projectId, root }: FindBarProps) {
  const store = useStoreApi<CanvasFlowNode>()
  useEffect(() => {
    useCanvasRequests.setState({ createItems: menuItems })
  }, [])
  const open = useCanvasRequests((state) => state.findOpen)
  useFocusRequests(projectId)
  useCreateRequests(projectId)
  useTidyRequests(projectId, root)

  // ⌘F, while the Canvas is the view on screen (the Session view hides it).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘F on macOS, Ctrl+F elsewhere; on Windows Ctrl+F in a Terminal Node is the shell's (match.ts).
      if (!matchesShortcut(event, SHORTCUTS.find)) return
      const dom = store.getState().domNode
      if (dom === null || dom.offsetParent === null) return
      event.preventDefault()
      openFind()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  return (
    <>
      <TagFilterView projectId={projectId} />
      {open ? <FindBar projectId={projectId} root={root} /> : null}
    </>
  )
}

export default function CanvasFind() {
  const project = activeProject(useProjects())
  return project ? <ProjectFind key={project.id} projectId={project.id} root={project.path} /> : null
}
