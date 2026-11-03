import type { CSSProperties } from 'react'
import { vendorIcon, vendorLabel } from '../../shared/vendors/vendor'

// The Vendor whose agent runs a Session (worfy-multi-vendor ticket 24): its text label with a neutral
// icon — a plain shape in the text colour, never the Vendor's logo (owner, Q10 of the spec). Shown on a
// Session Node, in the Session view's header and rail, in the Vendor picker of "New session" and on a
// section of the Limits panel. The label and the icon come from src/shared/vendors/vendor.ts: this
// component never looks at which Vendor it draws.

export interface VendorBadgeProps {
  /** The VendorId; one this build does not know (a later worfy's) shows its id and a generic icon. */
  vendor: string
  /** `short` where room is scarce (a Node's header, the Limits panel); the whole name otherwise. */
  form?: 'name' | 'short'
  /** Muted text, for a badge beside other secondary text. */
  muted?: boolean
  testId?: string
}

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    flex: 'none',
    minWidth: 0,
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  icon: { flex: 'none', display: 'block' },
} satisfies Record<string, CSSProperties>

/** The badge of `vendor`: its neutral icon and label; the whole name is its tooltip when the label is short. */
export function VendorBadge({ vendor, form = 'name', muted = false, testId = 'vendor-badge' }: VendorBadgeProps) {
  const name = vendorLabel(vendor)
  const label = vendorLabel(vendor, form)
  return (
    <span
      style={{ ...styles.badge, color: muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}
      title={label === name ? undefined : name}
      data-testid={testId}
      data-vendor={vendor}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        style={styles.icon}
        data-testid="vendor-badge-icon"
      >
        {vendorIcon(vendor).map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span>{label}</span>
    </span>
  )
}
