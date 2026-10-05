// The toolbar above the selected Nodes (ticket 29). It is a row of sections; each section gets
// the selected Nodes' Layout entries and sends its own operations to main. Ticket 29 brings Pin
// and Tags; a later section (ticket 30: delete to the trash, undo) is one more component in
// SELECTION_SECTIONS.
import { useState, type ComponentType, type KeyboardEvent } from 'react'
import { NodeToolbar, Position, useNodes, useReactFlow } from '@xyflow/react'
import type { LayoutNode } from '../../../shared/layout/types'
import type { CanvasFlowNode } from '../nodes'
import { pinOp, unpinOp } from '../pinning'
import { addTagOps, normalizeTag, removeTagOps, selectionTags } from '../tags'
import { useLayoutOps, type LayoutOps } from '../useLayout'
import './selection-toolbar.css'

export const order = 20

export interface SelectionSectionProps {
  /** The selected Nodes as the Layout has them, in Layout order; never empty. */
  nodes: readonly LayoutNode[]
}

/** Sends operations one after another, so main applies them in the order they were made. */
async function applyAll(ops: LayoutOps, list: readonly Parameters<LayoutOps['apply']>[0][]): Promise<void> {
  for (const op of list) await ops.apply(op)
}

/** Pin: keeps the selection at its place on the screen; Unpin puts it back on the plane. */
export function PinSection({ nodes }: SelectionSectionProps) {
  const ops = useLayoutOps()
  const flow = useReactFlow()
  const allPinned = nodes.every((node) => node.pinned)
  return (
    <button
      type="button"
      className="w-selection-toolbar__button"
      aria-pressed={allPinned}
      title={allPinned ? 'Put the selection back on the canvas' : 'Keep the selection at its place on the screen'}
      onClick={() => {
        const viewport = flow.getViewport()
        const list = allPinned ? nodes.map((node) => unpinOp(node, viewport)) : nodes.filter((node) => !node.pinned).map((node) => pinOp(node, viewport))
        void applyAll(ops, list)
      }}
    >
      {allPinned ? 'Unpin' : 'Pin'}
    </button>
  )
}

/** The tags of the selection, each removable from all of it, and a field that adds one to all of it. */
export function TagsSection({ nodes }: SelectionSectionProps) {
  const ops = useLayoutOps()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const tags = selectionTags(nodes)

  const submit = () => {
    const tag = normalizeTag(draft)
    if (tag === undefined) return
    setDraft('')
    void applyAll(ops, addTagOps(nodes, tag))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div className="w-selection-toolbar__tags" role="group" aria-label="Tags">
      {tags.map(({ tag, count }) => (
        <span key={tag} className="w-selection-toolbar__tag" title={`${count} of ${nodes.length} selected`}>
          {tag}
          {count < nodes.length ? <span className="w-selection-toolbar__tag-count">{count}</span> : null}
          <button type="button" className="w-selection-toolbar__tag-remove" aria-label={`Remove tag ${tag}`} onClick={() => void applyAll(ops, removeTagOps(nodes, tag))}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="w-selection-toolbar__tag-input"
          aria-label="New tag"
          placeholder="Tag…"
          maxLength={40}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            submit()
            setAdding(false)
          }}
        />
      ) : (
        <button type="button" className="w-selection-toolbar__button" onClick={() => setAdding(true)}>
          Add tag
        </button>
      )}
    </div>
  )
}

/** The sections of the toolbar, left to right. */
const SELECTION_SECTIONS: readonly ComponentType<SelectionSectionProps>[] = [PinSection, TagsSection]

export default function SelectionToolbar() {
  const selected = useNodes<CanvasFlowNode>().filter((node) => node.selected && !node.hidden)
  if (selected.length === 0) return null
  const nodes = selected.map((node) => node.data.node)
  return (
    <NodeToolbar nodeId={selected.map((node) => node.id)} isVisible position={Position.Top} offset={12}>
      <div className="w-selection-toolbar nodrag nopan nowheel" role="toolbar" aria-label="Selection" data-testid="selection-toolbar">
        {SELECTION_SECTIONS.map((Section, index) => (
          <Section key={Section.displayName ?? Section.name ?? index} nodes={nodes} />
        ))}
      </div>
    </NodeToolbar>
  )
}
