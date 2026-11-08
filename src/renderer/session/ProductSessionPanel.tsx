import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PRODUCT_SESSION_SPLIT_DEFAULT, PRODUCT_SESSION_SPLIT_MIN, productSessionSplitOf } from '../../shared/settings/app-settings'
import { flattenSubagents } from '../../shared/transcript/subagents'
import { hiddenIdsOf, useHiddenSubagents, useSubagentTree, withoutHidden } from '../claude-home/subagents'
import { useProjects } from '../projects/useProjects'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { PRODUCT_SESSION_HIDDEN_BLOCKS, ProductSessionContext } from './product-session'
import type { RailBlock, RailBlockProps } from './rail/index'
import { SplitDivider } from './SplitDivider'

// The body of a Product Session's view (worfy-product-session ticket 07), in place of the plain
// Session's body: the Mind map on the left, a divider, the chat — the same transcript and input field
// as any Session — and at the right edge the agents strip.
//
// The divider starts at 60 / 40 and goes where the person drags it; the share is one per Machine, in
// the app settings (`productSession.split`), written when a drag ends, so every window and the next
// start of worfy show the same split. A double click puts it back to 60 / 40.
//
// The agents strip stands for the rail of a plain Session: a column of icons with the number of the
// Session's Subagents; a click opens the rail blocks over the chat. The Binding block is left out: a
// Product Session is bound to no Ticket and no Epic.
//
// The Mind map itself is ticket 08: until then the left pane holds its empty state.

export interface ProductSessionPanelProps extends RailBlockProps {
  /** The rail blocks of the plain Session; those of PRODUCT_SESSION_HIDDEN_BLOCKS are left out. */
  blocks: readonly RailBlock[]
  /** The chat: the transcript and the input field, as the plain body has them. */
  children: ReactNode
}

/** How many Subagents the Session's Subagents block lists: every one in its tree, the hidden ones left out. */
function useSubagentCount(projectId: string, session: string | null): number {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const tree = useSubagentTree(root, session)
  const hidden = useHiddenSubagents(projectId)
  return useMemo(() => flattenSubagents(withoutHidden(tree, hiddenIdsOf(hidden, session))).length, [tree, hidden, session])
}

/** The share of the Mind map: the one being dragged, else the one in the app settings. */
function useSplit(): { share: number; move: (share: number) => void; commit: (share: number) => void } {
  const saved = useAppSettings(productSessionSplitOf)
  const [moving, setMoving] = useState<number | null>(null)
  // Only the answer to the last write lets go of the dragged share: an earlier one must not show an older split.
  const writes = useRef(0)
  const commit = (share: number) => {
    setMoving(share)
    const write = ++writes.current
    void setAppSettings({ productSession: { split: share } }).then((problem) => {
      if (problem !== undefined) console.error('appSettings.set failed:', problem)
      if (write === writes.current) setMoving(null)
    })
  }
  return { share: moving ?? saved, move: setMoving, commit }
}

function AgentsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="3" />
      <circle cx="14" cy="8.5" r="2.4" />
      <path d="M1.8 17c.6-3 2.6-4.6 5.2-4.6s4.6 1.6 5.2 4.6M12.5 12.6c2.6-.4 4.8.9 5.5 3.9" />
    </svg>
  )
}

/** The strip at the right edge; its list opens over the chat. */
function AgentsStrip({ count, blocks, rail }: { count: number; blocks: readonly RailBlock[]; rail: RailBlockProps }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    close()
  }
  return (
    <aside className="w-product__agents" aria-label="Agents" data-testid="product-agents">
      <button
        ref={toggle}
        type="button"
        className="w-product__agents-button"
        aria-expanded={open}
        aria-controls={listId}
        title={`Agents (${count})`}
        data-testid="product-agents-toggle"
        onClick={() => setOpen((was) => !was)}
      >
        <AgentsIcon />
        <span className="w-product__agents-count w-mono" data-testid="product-agents-count">
          {count}
        </span>
      </button>
      {open ? (
        <div id={listId} className="w-product__agents-panel" role="region" aria-label="Agents" data-testid="product-agents-panel" onKeyDown={onKeyDown}>
          <div className="w-product__agents-head">
            Agents <span className="w-product__agents-head-count w-mono">{count}</span>
            <button type="button" className="w-product__agents-close" title="Collapse" aria-label="Collapse the agents list" data-testid="product-agents-close" onClick={close}>
              ›
            </button>
          </div>
          {blocks.map(({ id, Component }) => (
            <section key={id} className="w-session__rail-block" data-block={id}>
              <Component {...rail} />
            </section>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

export function ProductSessionPanel({ blocks, children, ...rail }: ProductSessionPanelProps) {
  const { share, move, commit } = useSplit()
  const shown = useMemo(() => blocks.filter((block) => !PRODUCT_SESSION_HIDDEN_BLOCKS.includes(block.id)), [blocks])
  const count = useSubagentCount(rail.projectId, rail.claudeSessionId ?? rail.sessionId)
  return (
    <div className="w-product" data-testid="product-session-panel">
      <div className="w-product__split">
        <section className="w-product__map" aria-label="Mind map" data-testid="product-session-map" style={{ flexBasis: `${Math.round(share * 1000) / 10}%` }}>
          <p className="w-product__map-empty" data-testid="product-session-map-empty">
            The Mind map appears once the advisor adds its first node
          </p>
        </section>
        <SplitDivider
          share={share}
          min={PRODUCT_SESSION_SPLIT_MIN}
          reset={PRODUCT_SESSION_SPLIT_DEFAULT}
          onMove={move}
          onCommit={commit}
          label="Resize the Mind map and the chat"
          title="Drag to resize. Double-click: 60 / 40"
          testId="product-session-divider"
        />
        <ProductSessionContext value={true}>{children}</ProductSessionContext>
      </div>
      <AgentsStrip count={count} blocks={shown} rail={rail} />
    </div>
  )
}
