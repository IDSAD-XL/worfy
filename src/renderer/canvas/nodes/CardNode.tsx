import { useEffect, useState } from 'react'
import { useStore } from '@xyflow/react'
import { linkedCardUrl, machineLabel } from '../../../shared/cards/bridge'
import { CARD_ID_PATTERN, type CardInfo } from '../../../shared/ipc/cards'
import type { LayoutNode } from '../../../shared/layout/types'
import { invoke, subscribe, windowMachine } from '../../ipc'
import { useInFocusTile } from '../../focus/focus-tile'
import { activeProject, useProjects } from '../../projects/useProjects'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { NODE_HEADER } from '../node-header'
import { useLayoutOps } from '../useLayout'
import { useFramesStepAsideWhilePressed } from './frames-step-aside'
import type { CanvasNodeProps } from './index'

// A Card (CONTEXT.md, "Card"): a small HTML app an agent wrote into
// <Project data folder>/cards/<id>/. It runs in an iframe on its own origin, worfy-card://
// (src/main/cards/protocol.ts), so it reaches neither the worfy window nor another Card; main
// keeps the frame from navigating away or opening windows. The Node reloads the Card when main
// reports a change of its files. It runs from zoom LIVE_ZOOM_MIN up, and at any zoom when pinned (a
// pinned Node keeps its screen size) or in a tile of focus mode; otherwise it draws its title and a
// frame instead of the page.
//
// In a window on Linked machine M (worfy-link ticket 10) the Card's address from M gets M's machine
// label (frameUrl): the frame then has an origin of its own, and this Machine's main fetches the
// files from M. M's own address never goes into the frame.
export const kind = 'card'
export const defaultWidth = 360
export const defaultHeight = 280

/** Below this zoom a Card that is not pinned nor in a focus tile is not running: a frame with its title is drawn instead. */
export const LIVE_ZOOM_MIN = 0.4

/**
 * Scripts run, and the Card keeps its own origin (its storage, its own files). That origin is
 * worfy-card://<card id>.<project label>, never the window's, so allow-same-origin gives no access
 * to the window. No popups, no top navigation, no forms.
 */
export const CARD_SANDBOX = 'allow-scripts allow-same-origin'

/**
 * The address the frame loads: the Card's own on this Machine; in a window on a Linked machine,
 * that Machine's address with its machine label, or null when it is not a Card address of its own.
 */
function frameUrl(url: string, machine: string | null): string | null {
  return machine === null ? url : linkedCardUrl(url, machineLabel(machine))
}

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
/** A long title ends in "…" on one line; the whole of it is in the tooltip. */
const titleStyle = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const
const frameStyle = { flex: 1, width: '100%', height: '100%', border: 0, background: 'white' } as const

export default function CardNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const projectId = activeProject(useProjects())?.id
  const cardId = cardIdOf(data.node)
  const { info, error } = useCard(projectId, cardId)
  const zoomedIn = useStore((store) => store.transform[2] >= LIVE_ZOOM_MIN)
  const inFocusTile = useInFocusTile()
  const live = zoomedIn || data.node.pinned || inFocusTile
  useFramesStepAsideWhilePressed(useStore((store) => store.domNode))
  const title = info?.title ?? 'Card'
  const src = info === undefined ? null : frameUrl(info.url, windowMachine())

  let body
  if (error !== undefined) body = <div style={messageStyle}>{error}</div>
  else if (info === undefined) body = null
  else if (src === null) body = <div style={messageStyle}>{`"${info.url}" is not the address of a Card`}</div>
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
        key={`${src}#${info.revision}`}
        className="nodrag nowheel"
        style={frameStyle}
        src={src}
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
      <div className="w-note__header" data-testid="card-title" {...NODE_HEADER}>
        <span style={titleStyle} title={title}>
          {title}
        </span>
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
