import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LinkedMachineView } from '../../../shared/ipc/link'
import { LinkMachineDialog } from '../../machines/LinkMachineDialog'
import { revokeMachine, setKeepAwake, setProjectsAccess, useMachines } from '../../machines/useMachines'
import { ListRow, StatusChip } from '../../theme/primitives'

/** Between Projects (10) and Epics (20): the Machines the Projects will be grouped by (worfy-link ticket 09). */
export const order = 15

const ACCESS_LABEL = 'Linked machines can work with my Projects'
const KEEP_AWAKE_LABEL = 'Keep this computer awake while linked machines are connected'

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

/**
 * A Machine name whose trailing "(…)" — "(dev)" of a development build — stays visible when the
 * row is too narrow: the name before it is cut with an ellipsis instead. Two worfy on one Mac
 * differ only by it.
 */
export function MachineName({ name }: { name: string }) {
  const match = /^(.*\S)(\s+\([^()]+\))$/.exec(name)
  const base = match?.[1] ?? name
  const suffix = match?.[2] ?? ''
  return (
    <span style={{ display: 'flex', minWidth: 0, fontWeight: 600 }}>
      <span data-testid="machine-name" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {base}
      </span>
      {suffix ? (
        <span data-testid="machine-name-suffix" style={{ flex: 'none', whiteSpace: 'pre' }}>
          {suffix}
        </span>
      ) : null}
    </span>
  )
}

/** The state of a row in words, always with its colour (F-SPEC: a status colour never stands alone). */
function MachineState({ machine }: { machine: LinkedMachineView }) {
  if (machine.certificateChanged) return <StatusChip status="blocked" label="Certificate changed" />
  if (machine.state === 'online') return <StatusChip status="ready" label="Online" />
  return (
    <span className="w-chip" style={styles.unavailable}>
      {machine.state === 'sleeping' ? 'Sleeping' : 'Unavailable'}
    </span>
  )
}

const rowTitle = (machine: LinkedMachineView): string =>
  machine.certificateChanged
    ? `${machine.name} answered with another certificate. Revoke it, then link it again with Link a machine`
    : machine.state === 'online'
      ? `${machine.name} is connected`
      : machine.state === 'sleeping'
        ? `${machine.name} went to sleep; worfy reconnects when it wakes`
        : `${machine.name} cannot be reached; worfy keeps trying`

interface SwitchProps {
  label: string
  testId: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}

/** A switch of the section, its label to the right. */
function SectionSwitch({ label, testId, checked, disabled, onToggle }: SwitchProps) {
  return (
    <label style={styles.switchRow}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        style={{ ...styles.track, background: checked ? 'var(--primary)' : 'var(--segment-track)', borderColor: checked ? 'var(--primary)' : 'var(--border-strong)' }}
        onClick={onToggle}
      >
        <span aria-hidden="true" style={{ ...styles.thumb, left: checked ? 11 : 1 }} />
      </button>
      <span>{label}</span>
    </label>
  )
}

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
 * a row's context menu; "Link a machine…" and the switches "Linked machines can work with my
 * Projects" and (worfy-link ticket 14) "Keep this computer awake while linked machines are
 * connected" under the list. With no Linked machine, only the button and the switches.
 */
export default function MachinesSection() {
  const state = useMachines()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menu, setMenu] = useState<{ machine: LinkedMachineView; x: number; y: number }>()
  const [error, setError] = useState<string>()
  const access = state?.projectsAccess ?? false
  const keepAwake = state?.keepAwake ?? false
  const noMachine = state?.machine == null

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
            <ListRow label={<MachineName name={machine.name} />} icon={machineIcon} trailing={<MachineState machine={machine} />} />
          </li>
        ))}
      </ul>

      <div style={styles.footer}>
        <button type="button" style={styles.linkButton} data-testid="link-machine-button" onClick={() => setDialogOpen(true)}>
          Link a machine…
        </button>
        <SectionSwitch label={ACCESS_LABEL} testId="link-access-switch" checked={access} disabled={noMachine} onToggle={() => void run(setProjectsAccess(!access))} />
        <SectionSwitch label={KEEP_AWAKE_LABEL} testId="link-keep-awake-switch" checked={keepAwake} disabled={noMachine} onToggle={() => void run(setKeepAwake(!keepAwake))} />
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
