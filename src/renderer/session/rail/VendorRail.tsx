import type { CSSProperties } from 'react'
import { SESSION_NODE_KIND, worfySessionNodeDataSchema } from '../../../shared/ipc/sessions'
import { UNNAMED_VENDOR } from '../../../shared/vendors/vendor'
import { useLayout } from '../../canvas/useLayout'
import { useSessionNodeView } from '../node-sessions'
import { VendorBadge } from '../VendorBadge'
import type { RailBlockProps } from './index'

// The Vendor in the Session rail (worfy-multi-vendor ticket 24): whose agent runs a Session worfy runs on
// a Session Node — main's view of it, else the Vendor its Node saved (Claude Code for a Node saved
// without one). Nothing for the Orchestrator and for a Session started outside worfy.

// First in the rail: before the Binding (10).
export const order = 5

const styles = {
  heading: { margin: 0, height: 20, display: 'flex', alignItems: 'center', fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

export default function VendorRail({ projectId, nodeId }: RailBlockProps) {
  const view = useSessionNodeView(projectId, nodeId)
  const node = useLayout(projectId).state?.layout.nodes.find((each) => each.id === nodeId)
  const saved = node?.kind === SESSION_NODE_KIND ? worfySessionNodeDataSchema.safeParse(node.data) : undefined
  const vendor = view?.vendor ?? (saved?.success ? (saved.data.vendor ?? UNNAMED_VENDOR) : null)
  if (vendor === null) return null
  return (
    <div data-testid="vendor-rail">
      <h2 style={styles.heading}>Vendor</h2>
      <VendorBadge vendor={vendor} testId="vendor-rail-badge" />
    </div>
  )
}
