import { useEffect, useState } from 'react'
import { useStore } from '@xyflow/react'
import { CARD_ID_PATTERN, type CardInfo } from '../../../shared/ipc/cards'
import type { LayoutNode } from '../../../shared/layout/types'
import { invoke, subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// A Card (CONTEXT.md, «Карточка»): a small HTML app an agent wrote into
// <Project data folder>/cards/<id>/. It runs in an iframe on its own origin, worfy-card://
// (src/main/cards/protocol.ts), so it reaches neither the worfy window nor another Card; main
// keeps the frame from navigating away or opening windows. The Node reloads the Card when main
// reports a change of its files, and draws only the title and a frame when the Canvas is zoomed
// out below LIVE_ZOOM_MIN.
export const kind = 'card'
export const defaultWidth = 360
export const defaultHeight = 280

/** Below this zoom the Card is not running: a frame with its title is drawn instead. */
export const LIVE_ZOOM_MIN = 0.4

/**
 * Scripts run, and the Card keeps its own origin (its storage, its own files). That origin is
 * worfy-card://<card id>.<project label>, never the window's, so allow-same-origin gives no access
 * to the window. No popups, no top navigation, no forms.
 */
export const CARD_SANDBOX = 'allow-scripts allow-same-origin'

/** The Card a Node shows: `data.cardId` when it is set, otherwise the Node's own id. */
function cardIdOf(node: LayoutNode): string {
  const fromData = node.data.cardId
  return typeof fromData === 'string' ? fromData : node.id
}

interface CardState {
  key: string
  info?: CardInfo
  error?: string
}

/** The Card as main describes it, kept current by `cards.changed`. */
function useCard(projectId: string | undefined, cardId: string): CardState {
  const key = `${projectId ?? ''}\n${cardId}`
  const [state, setState] = useState<CardState>({ key })

  useEffect(() => {
    if (projectId === undefined || !CARD_ID_PATTERN.test(cardId)) return
    let active = true
    // A later revision always wins: the answer to cards.get and a change event can cross.
    const accept = (info: CardInfo) =>
      setState((current) => (current.key === key && current.info && current.info.revision > info.revision ? current : { key, info }))
    let unsubscribe = (): void => undefined
    try {
      unsubscribe = subscribe('cards.changed', (info) => {
        if (active && info.projectId === projectId && info.cardId === cardId) accept(info)
      })
    } catch (error) {
      console.error('cards.changed: cannot subscribe', error)
    }
    void invoke('cards.get', { projectId, cardId }).then((result) => {
      if (!active) return
      if (result.ok) accept(result.value)
      else setState({ key, error: result.error })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [key, projectId, cardId])

  if (!CARD_ID_PATTERN.test(cardId)) return { key, error: `"${cardId}" is not a valid Card id` }
  return state.key === key ? state : { key }
}

/** The attribute on the React Flow root while a mouse button pressed on the Canvas is held; canvas.css keys on it. */
export const PRESSED_ATTRIBUTE = 'data-pointer-pressed'

/**
 * Marks the React Flow root with PRESSED_ATTRIBUTE from a press anywhere on the Canvas until its
 * release (worfy-week ticket 09). canvas.css turns mouse events off for every iframe on the Canvas
 * while the mark is there. A Card's page is on another origin: a pointer that runs onto its iframe
 * hands the mouse events to the Card, and the window sees neither the moves nor the release, so a
 * drag, a resize or a pan would stop following the mouse or never end. React Flow's own `dragging`
 * class comes too late for this: it is set on the first move the window sees, and a quick jerk
 * puts the pointer on an iframe with that very first move. A press inside a Card's page never
 * reaches this document, so clicks on the Card are untouched.
 */
function useFramesStepAsideWhilePressed(root: HTMLElement | null): void {
  useEffect(() => {
    if (root === null) return
    let release: number | undefined
    // Off only after the release has been handled: the mouseup that ends React Flow's gesture comes
    // after the pointerup, and it must not land on an iframe either.
    const released = () => {
      window.clearTimeout(release)
      release = window.setTimeout(() => root.removeAttribute(PRESSED_ATTRIBUTE), 0)
    }
    // The main button only: React Flow drags and resizes with it. A pan with the middle button
    // marks the plane `dragging` on the press itself, and a right press opens a menu whose release
    // may never come back to the window.
    const pressed = (event: PointerEvent) => {
      if (event.button !== 0) return
      window.clearTimeout(release)
      root.setAttribute(PRESSED_ATTRIBUTE, '')
    }
    root.addEventListener('pointerdown', pressed, true)
    window.addEventListener('pointerup', released, true)
    window.addEventListener('pointercancel', released, true)
    window.addEventListener('blur', released)
    return () => {
      root.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('pointerup', released, true)
      window.removeEventListener('pointercancel', released, true)
      window.removeEventListener('blur', released)
      window.clearTimeout(release)
      root.removeAttribute(PRESSED_ATTRIBUTE)
    }
  }, [root])
}

const bodyStyle = { flex: 1, minHeight: 0, position: 'relative', display: 'flex' } as const
const messageStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-3)',
  fontSize: 'var(--text-13)',
  color: 'var(--text-muted)',
  textAlign: 'center',
} as const
const frameStyle = { flex: 1, width: '100%', height: '100%', border: 0, background: 'white' } as const

export default function CardNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const projectId = activeProject(useProjects())?.id
  const cardId = cardIdOf(data.node)
  const { info, error } = useCard(projectId, cardId)
  const live = useStore((store) => store.transform[2] >= LIVE_ZOOM_MIN)
  useFramesStepAsideWhilePressed(useStore((store) => store.domNode))
  const title = info?.title ?? 'Card'

  let body
  if (error !== undefined) body = <div style={messageStyle}>{error}</div>
  else if (info === undefined) body = null
  else if (!info.exists)
    body = (
      <div style={messageStyle} data-testid="card-missing">
        Card files missing
      </div>
    )
  else if (live)
    body = (
      <iframe
        // A new frame for every revision: reloading means a fresh document from the protocol.
        key={`${info.url}#${info.revision}`}
        className="nodrag nowheel"
        style={frameStyle}
        src={info.url}
        sandbox={CARD_SANDBOX}
        referrerPolicy="no-referrer"
        title={title}
        data-testid="card-frame"
        data-revision={info.revision}
      />
    )
  else
    body = (
      <div style={{ ...messageStyle, margin: 'var(--space-2)', border: '1px dashed var(--border)' }} data-testid="card-placeholder">
        {title}
      </div>
    )

  return (
    <div className="w-node-surface w-note" data-testid="card-node" data-node-id={id} data-card-id={cardId}>
      <NodeResizeClamp
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-note__header" data-testid="card-title">
        {title}
      </div>
      {/* Until the Card is the active Node its iframe takes no mouse (canvas.css), so the click that
          activates it lands here. nodrag keeps React Flow's drag from swallowing that click when the
          mouse shifts by a pixel; the Card is dragged by its title. The placeholder drawn when zoomed
          out has no page to click into and stays draggable. */}
      <div className={live ? 'nodrag' : undefined} style={bodyStyle}>
        {body}
      </div>
    </div>
  )
}
