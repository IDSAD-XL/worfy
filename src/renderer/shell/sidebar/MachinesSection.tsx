import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LinkedMachineView } from '../../../shared/ipc/link'
import { LinkMachineDialog } from '../../machines/LinkMachineDialog'
import { revokeMachine, setProjectsAccess, useMachines } from '../../machines/useMachines'
import { ListRow, StatusChip } from '../../theme/primitives'

/** Between Projects (10) and Epics (20): the Machines the Projects will be grouped by (worfy-link ticket 09). */
export const order = 15

const ACCESS_LABEL = 'Linked machines can work with my Projects'

const styles = {
  header: { display: 'flex', alignItems: 'center', height: 24, padding: '0 4px 0 8px' },
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  unavailable: { border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-muted)' },
  footer: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: '2px 8px 4px' },
  linkButton: {
    alignSelf: 'flex-start',
    height: 22,
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border)',
    background: 'var(--surface-raised)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
  },
  switchRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-12)', color: 'var(--text-secondary)', lineHeight: '16px' },
  track: {
    flex: 'none',
    position: 'relative',
    width: 26,
    height: 16,
    padding: 0,
    border: '1px solid var(--border-strong)',
    borderRadius: 8,
    boxSizing: 'border-box',
  },
  thumb: {
    position: 'absolute',
    top: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-control)',
    transition: 'left 120ms ease',
  },
  menu: {
    position: 'fixed',
    zIndex: 90,
    minWidth: 180,
    padding: 'var(--space-1)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
  },
} satisfies Record<string, CSSProperties>

const machineIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="8" rx="1.5" />
    <path d="M6 13.5h4M8 11v2.5" />
  </svg>
)

/** The state of a row in words, always with its colour (F-SPEC: a status colour never stands alone). */
function MachineState({ machine }: { machine: LinkedMachineView }) {
  if (machine.certificateChanged) return <StatusChip status="blocked" label="Certificate changed" />
  if (machine.state === 'online') return <StatusChip status="ready" label="Online" />
  return (
    <span className="w-chip" style={styles.unavailable}>
      Unavailable
    </span>
  )
}

const rowTitle = (machine: LinkedMachineView): string =>
  machine.certificateChanged
    ? `${machine.name} answered with another certificate. Revoke it, then link it again with Link a machine`
    : machine.state === 'online'
      ? `${machine.name} is connected`
      : `${machine.name} cannot be reached; worfy keeps trying`

interface MenuProps {
  machine: LinkedMachineView
  x: number
  y: number
  onRevoke: () => void
  onClose: () => void
}

/** The context menu of a Machine row. Escape, a click elsewhere or leaving the window closes it. */
function MachineMenu({ machine, x, y, onRevoke, onClose }: MenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
    const outside = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) close.current()
    }
    const blur = (): void => close.current()
    document.addEventListener('mousedown', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', blur)
    }
  }, [])

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`Machine ${machine.name}`}
      style={{ ...styles.menu, left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <button type="button" role="menuitem" className="w-row" onClick={onRevoke}>
        Revoke
      </button>
    </div>
  )
}

/**
 * The "Machines" section (worfy-link ticket 02): the Linked machines with their state, revoked from
 * a row's context menu; "Link a machine…" and the switch "Linked machines can work with my
 * Projects" under the list. With no Linked machine, only the button and the switch.
 */
export default function MachinesSection() {
  const state = useMachines()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menu, setMenu] = useState<{ machine: LinkedMachineView; x: number; y: number }>()
  const [error, setError] = useState<string>()
  const access = state?.projectsAccess ?? false

  const run = async (work: Promise<string | undefined>): Promise<void> => {
    setError(await work)
  }

  return (
    <section aria-labelledby="sidebar-machines-heading" data-testid="machines-section">
      <div style={styles.header}>
        <h2 id="sidebar-machines-heading" style={styles.heading}>
          Machines
        </h2>
      </div>

      {error ? (
        <p role="alert" data-testid="machines-error" style={styles.message}>
          {error}
        </p>
      ) : null}

      <ul style={styles.list} aria-label="Linked machines">
        {state?.linked.map((machine) => (
          <li
            key={machine.id}
            data-testid="machine-row"
            data-machine-id={machine.id}
            data-state={machine.certificateChanged ? 'certificate-changed' : machine.state}
            title={rowTitle(machine)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ machine, x: event.clientX, y: event.clientY })
            }}
          >
            <ListRow label={<span style={{ fontWeight: 600 }}>{machine.name}</span>} icon={machineIcon} trailing={<MachineState machine={machine} />} />
          </li>
        ))}
      </ul>

      <div style={styles.footer}>
        <button type="button" style={styles.linkButton} data-testid="link-machine-button" onClick={() => setDialogOpen(true)}>
          Link a machine…
        </button>
        <label style={styles.switchRow}>
          <button
            type="button"
            role="switch"
            aria-checked={access}
            aria-label={ACCESS_LABEL}
            data-testid="link-access-switch"
            disabled={state?.machine == null}
            style={{ ...styles.track, background: access ? 'var(--primary)' : 'var(--segment-track)', borderColor: access ? 'var(--primary)' : 'var(--border-strong)' }}
            onClick={() => void run(setProjectsAccess(!access))}
          >
            <span aria-hidden="true" style={{ ...styles.thumb, left: access ? 11 : 1 }} />
          </button>
          <span>{ACCESS_LABEL}</span>
        </label>
      </div>

      {menu ? (
        <MachineMenu
          machine={menu.machine}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          onRevoke={() => {
            const id = menu.machine.id
            setMenu(undefined)
            void run(revokeMachine(id))
          }}
        />
      ) : null}

      {dialogOpen ? <LinkMachineDialog onClose={() => setDialogOpen(false)} /> : null}
    </section>
  )
}
