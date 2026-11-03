import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SessionVendors } from '../../shared/ipc/sessions'
import { invoke } from '../ipc'
import { VendorBadge } from './VendorBadge'

// The Vendor picker of "New session" (worfy-multi-vendor ticket 24): opened by "New session" in the
// sidebar, it lists the Vendors main offers (`sessions.vendors`) in its order — the Project's Default
// vendor first, marked "default". A Vendor that cannot start a Session now (nobody is signed in to it)
// stays in the list, inactive, its tooltip main's reason ("Sign in to Codex in Settings → Vendors").
// A pick starts the Session on that Vendor; Esc or a click outside closes the list.
//
// A Machine that does not answer `sessions.vendors` (a Linked machine on a build from before the
// picker) gets New session as before: on its Project's default Vendor, with no list.

export interface NewSessionVendorProps {
  projectId: string
  /** Starts the Session: on `vendor`, or on the Project's default when undefined. */
  onPick: (vendor: string | undefined) => void
  onClose: () => void
}

const styles = {
  root: {
    position: 'absolute',
    zIndex: 20,
    left: 8,
    right: 8,
    padding: 4,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-card, 8px)',
    background: 'var(--bg)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  heading: { margin: 0, padding: '2px 4px 4px', fontSize: 'var(--text-11)', fontWeight: 600, color: 'var(--text-muted)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    height: 'var(--row-height)',
    padding: '0 6px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    textAlign: 'left',
  },
  inactive: { opacity: 0.5, cursor: 'default' },
  mark: { marginLeft: 'auto', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  quiet: { margin: 0, padding: '2px 6px 4px', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

export function NewSessionVendor({ projectId, onPick, onClose }: NewSessionVendorProps) {
  const [vendors, setVendors] = useState<SessionVendors>()
  const root = useRef<HTMLDivElement>(null)
  // The latest callbacks, so the answer and the outside click do not depend on the parent's render.
  const pick = useRef(onPick)
  const close = useRef(onClose)
  useEffect(() => {
    pick.current = onPick
    close.current = onClose
  })

  useEffect(() => {
    let live = true
    void invoke('sessions.vendors', { projectId }).then((result) => {
      if (!live) return
      if (result.ok) setVendors(result.value)
      else {
        console.warn('sessions.vendors failed; New session on the default Vendor:', result.error)
        pick.current(undefined)
      }
    })
    return () => {
      live = false
    }
  }, [projectId])

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close.current()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  // The first Vendor that can start takes the focus once the list is there, so Enter picks it.
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [vendors])
  const firstFree = vendors?.choices.findIndex((choice) => choice.refusal === null) ?? -1

  return (
    <div ref={root} style={styles.root} role="menu" aria-label="New session on" data-testid="new-session-vendor">
      <p style={styles.heading} aria-hidden="true">
        New session on
      </p>
      {vendors === undefined ? (
        <p style={styles.quiet}>Checking the Vendors…</p>
      ) : (
        vendors.choices.map(({ vendor, refusal }, index) => (
          <button
            key={vendor}
            ref={index === firstFree ? first : undefined}
            type="button"
            role="menuitem"
            className="w-row"
            style={{ ...styles.row, ...(refusal === null ? {} : styles.inactive) }}
            data-testid="new-session-vendor-option"
            data-vendor={vendor}
            // aria-disabled rather than disabled: a disabled button shows no tooltip (as writeAction does).
            {...(refusal === null ? { onClick: () => onPick(vendor) } : { 'aria-disabled': 'true' as const, title: refusal, onClick: () => undefined })}
          >
            <VendorBadge vendor={vendor} />
            {vendor === vendors.defaultVendor ? <span style={styles.mark}>default</span> : null}
          </button>
        ))
      )}
    </div>
  )
}
