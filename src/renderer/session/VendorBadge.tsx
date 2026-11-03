import type { CSSProperties } from 'react'
import { vendorIcon, vendorLabel } from '../../shared/vendors/vendor'

// The Vendor whose agent runs a Session (worfy-multi-vendor ticket 24): its logo in the text colour and
// its text label (owner, 2026-11-03: the real Claude and OpenAI marks, reversing Q10 of the spec, which
// had a neutral shape). Shown on a Session Node, in the Session view's header and rail, in the Vendor
// picker of "New session", and as the logo alone on each section of the Limits panel. The label and the
// logo come from src/shared/vendors/vendor.ts: this component never looks at which Vendor it draws.

export interface VendorBadgeProps {
  /** The VendorId; one this build does not know (a later worfy's) shows its id and a generic icon. */
  vendor: string
  /**
   * `short` where room is scarce (a Node's header); `icon` — the logo alone, with the whole name as its
   * tooltip and accessible name (the Limits panel); the whole name otherwise.
   */
  form?: 'name' | 'short' | 'icon'
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

/** The badge of `vendor`: its logo and label; the whole name is its tooltip when the label is short or absent. */
export function VendorBadge({ vendor, form = 'name', muted = false, testId = 'vendor-badge' }: VendorBadgeProps) {
  const name = vendorLabel(vendor)
  const label = form === 'icon' ? null : vendorLabel(vendor, form)
  return (
    <span
      style={{ ...styles.badge, color: muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}
      title={label === name ? undefined : name}
      role={label === null ? 'img' : undefined}
      aria-label={label === null ? name : undefined}
      data-testid={testId}
      data-vendor={vendor}
    >
      {/* Decoration beside the label; the badge itself is named when there is no label. */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={styles.icon} data-testid="vendor-badge-icon">
        <path d={vendorIcon(vendor)} />
      </svg>
      {label === null ? null : <span>{label}</span>}
    </span>
  )
}
