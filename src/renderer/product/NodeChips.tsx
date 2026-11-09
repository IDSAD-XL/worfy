import { chipLabel, lightNode, pickNode, type NodeChip, type NodeRef } from './node-chips'
import './mind-map.css'

// The chips under a message of a Product Session's chat (Epic worfy-product-session, tickets 09 and 22):
// one per Mind map node the `mind_map_*` calls after that message wrote (node-chips.ts, transcriptChips).
// As the owner's prototype draws them: a pill with a small square of the node's kind colour and a muted
// line that names the kind — «+ Idea: …» for a node the calls added, «Idea: …» for one they changed — and
// a red «↺ “…” → rejected» for a Decision they overturned. A click selects the node on the Mind map and
// brings it into view; the pointer or the focus on a chip lights the node there.

/** The class of the chip's colour: the kind, a rejected Decision's grey, an overturn's red. */
function look({ node, change }: NodeChip): string {
  if (change === 'overturned') return 'overturned'
  return node.kind === 'decision' && node.status === 'rejected' ? 'rejected' : node.kind
}

export function NodeChips({ projectId, chips }: { projectId: string; chips: readonly NodeChip[] }) {
  if (chips.length === 0) return null
  return (
    <ul className="w-chips" aria-label="Mind map nodes of this message" data-testid="node-chips">
      {chips.map((chip) => {
        const ref: NodeRef = { projectId, topic: chip.topic, id: chip.node.id }
        const label = chipLabel(chip)
        return (
          <li key={`${chip.topic}\n${chip.node.id}`} className="w-chips__item">
            <button
              type="button"
              className={`w-chips__chip w-chips__chip--${look(chip)}`}
              data-testid="node-chip"
              data-id={chip.node.id}
              data-topic={chip.topic}
              data-change={chip.change}
              title={label}
              aria-label={`Show on the Mind map: ${label}`}
              onClick={() => pickNode(ref)}
              onMouseEnter={() => lightNode(ref)}
              onMouseLeave={() => lightNode(null)}
              onFocus={() => lightNode(ref)}
              onBlur={() => lightNode(null)}
            >
              <span className="w-chips__mark" aria-hidden="true" />
              <span className="w-chips__text">{label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
