import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { SessionVendors } from '../../shared/ipc/sessions'
import { invoke } from '../ipc'
import { Menu, MenuItem } from '../theme/kit/Menu'
import { VendorBadge } from './VendorBadge'

// The Vendor picker of "New session" (worfy-multi-vendor ticket 24): "New session" in the sidebar is its
// menu button, and the menu lists the Vendors main offers (`sessions.vendors`, asked each time it opens)
// in its order — the Project's Default vendor first, marked "default". A Vendor that cannot start a
// Session now (nobody is signed in to it) stays in the list, inactive, its tooltip main's reason ("Sign
// in to Codex in Settings → Vendors"). A pick starts the Session on that Vendor. The menu is the kit's
// Menu (theme/kit/Menu.tsx, worfy-ui-kit ticket 11) under the button: the arrows, Esc that closes only
// it, a press outside and the focus back on the button are the kit's.
//
// A Machine that does not answer `sessions.vendors` (a Linked machine on a build from before the
// picker) gets New session as before: on its Project's default Vendor, with no list.

export interface NewSessionVendorProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "New session": a `<button>`, the menu's trigger. */
  trigger: ReactElement<Record<string, unknown>>
  /** Starts the Session: on `vendor`, or on the Project's default when undefined. */
  onPick: (vendor: string | undefined) => void
}

/** The first Vendor that can start: it takes the focus, so Enter picks it. */
const FIRST_FREE = '[role="menuitem"]:not([aria-disabled="true"])'

const styles = {
  root: {
    minWidth: 'var(--anchor-width)',
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

export function NewSessionVendor({ projectId, open, onOpenChange, trigger, onPick }: NewSessionVendorProps) {
  return (
    <Menu open={open} onOpenChange={onOpenChange} trigger={trigger} label="New session on" style={styles.root} testId="new-session-vendor" focusOnOpen={FIRST_FREE}>
      {open ? <Vendors projectId={projectId} onPick={onPick} /> : null}
    </Menu>
  )
}

/** The list of the open menu: asked of main as it opens. */
function Vendors({ projectId, onPick }: { projectId: string; onPick: (vendor: string | undefined) => void }) {
  const [vendors, setVendors] = useState<SessionVendors>()
  // The latest callback, so the answer does not depend on the parent's render.
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
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

  // The first Vendor that can start takes the focus once the list is there, so Enter picks it.
  const first = useRef<HTMLElement>(null)
  useEffect(() => first.current?.focus(), [vendors])
  const firstFree = vendors?.choices.findIndex((choice) => choice.refusal === null) ?? -1

  return (
    <>
      <p style={styles.heading} aria-hidden="true">
        New session on
      </p>
      {vendors === undefined ? (
        <p style={styles.quiet}>Checking the Vendors…</p>
      ) : (
        vendors.choices.map(({ vendor, refusal }, index) => (
          <MenuItem
            key={vendor}
            ref={index === firstFree ? first : undefined}
            className="w-row"
            style={{ ...styles.row, ...(refusal === null ? {} : styles.inactive) }}
            testId="new-session-vendor-option"
            data-vendor={vendor}
            // Inactive, not disabled: the item keeps its tooltip (aria-disabled, as writeAction does).
            disabled={refusal !== null}
            title={refusal ?? undefined}
            onClick={() => onPick(vendor)}
          >
            <VendorBadge vendor={vendor} />
            {vendor === vendors.defaultVendor ? <span style={styles.mark}>default</span> : null}
          </MenuItem>
        ))
      )}
    </>
  )
}
