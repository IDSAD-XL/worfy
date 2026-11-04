import { evidenceSummary } from '../../../shared/workflow/evidence'
import type { EvidenceItem } from '../../../shared/workflow/types'
import { StatusChip } from '../../theme/primitives'
import type { SlotProps } from './index'
import '../epic-frame.css'
import './evidence.css'

// The chip «Evidence n/m» on a Ticket card (worfy-evidence ticket 06): how many checkbox items of the done section
// are verified by their Evidence lines, of all of them. Green when every item is verified, red when one is
// failed, neutral otherwise; the tooltip counts the three states. A Ticket without checkbox items has no
// chip. The states come with the Ticket from main (shared/workflow/evidence.ts); worfy checks no link of a line
// against its source (spec of the Epic, decided without the owner, item 6). In focus mode the Ticket shows
// the whole matrix (nodes/EvidenceMatrix.tsx). The card has a line of room for the chip (ticket-card.ts).

export const order = 20

type EvidenceTone = 'ready' | 'blocked' | 'open'

interface EvidenceChipFace {
  tone: EvidenceTone
  label: string
  title: string
}

/** What the chip shows for the items of a done section; null for none. */
function evidenceChip(items: readonly Pick<EvidenceItem, 'state'>[]): EvidenceChipFace | null {
  if (!items.length) return null
  const { verified, total, failed } = evidenceSummary(items)
  const tone: EvidenceTone = failed > 0 ? 'blocked' : verified === total ? 'ready' : 'open'
  return { tone, label: `Evidence ${verified}/${total}`, title: `${verified} verified, ${total - verified - failed} not verified, ${failed} failed` }
}

export default function Evidence({ subject }: SlotProps) {
  if (subject.kind !== 'ticket') return null
  const face = evidenceChip(subject.ticket.evidence ?? [])
  if (face === null) return null
  return (
    <span className="w-evidence-chip" data-testid="evidence-chip" data-value={face.tone} title={face.title}>
      {face.tone === 'open' ? <span className="w-chip w-chip--open">{face.label}</span> : <StatusChip status={face.tone} label={face.label} />}
    </span>
  )
}
