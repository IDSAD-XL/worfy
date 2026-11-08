import { lightNode, pickNode, type NodeChip, type NodeRef } from './node-chips'
import './mind-map.css'

// The chips under an advisor's message in a Product Session's chat (Epic worfy-product-session, ticket 09):
// one per Mind map node the turn's `mind_map_*` calls wrote (node-chips.ts, transcriptChips). A click
// selects the node on the Mind map and brings it into view; the pointer or the focus on a chip lights
// the node there.

const ICON: Readonly<Record<NodeChip['node']['kind'], string>> = { idea: '✦', question: '?', decision: '✓', objection: '!' }

function iconOf({ node }: NodeChip): string {
  return node.kind === 'decision' && node.status === 'rejected' ? '✕' : ICON[node.kind]
}

export function NodeChips({ projectId, chips }: { projectId: string; chips: readonly NodeChip[] }) {
  if (chips.length === 0) return null
  return (
    <ul className="w-chips" aria-label="Mind map nodes of this answer" data-testid="node-chips">
      {chips.map((chip) => {
        const ref: NodeRef = { projectId, topic: chip.topic, id: chip.node.id }
        const rejected = chip.node.kind === 'decision' && chip.node.status === 'rejected'
        return (
          <li key={`${chip.topic}\n${chip.node.id}`} className="w-chips__item">
            <button
              type="button"
              className={`w-chips__chip w-chips__chip--${rejected ? 'rejected' : chip.node.kind}`}
              data-testid="node-chip"
              data-id={chip.node.id}
              data-topic={chip.topic}
              title={chip.node.text}
              aria-label={`Show on the Mind map: ${chip.node.text}`}
              onClick={() => pickNode(ref)}
              onMouseEnter={() => lightNode(ref)}
              onMouseLeave={() => lightNode(null)}
              onFocus={() => lightNode(ref)}
              onBlur={() => lightNode(null)}
            >
              <span className="w-mind__icon" aria-hidden="true">
                {iconOf(chip)}
              </span>
              <span className="w-chips__text">{chip.node.text}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
