import { useEffect, useState } from 'react'
import { NodeResizer, useStore } from '@xyflow/react'
import { CARD_ID_PATTERN, type CardInfo } from '../../../shared/ipc/cards'
import type { LayoutNode } from '../../../shared/layout/types'
import { invoke, subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
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
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-note__header" data-testid="card-title">
        {title}
      </div>
      <div style={bodyStyle}>{body}</div>
    </div>
  )
}
