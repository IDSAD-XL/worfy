import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LinkedMachineView } from '../../../shared/ipc/link'
import { LinkMachineDialog } from '../../machines/LinkMachineDialog'
import { askRemoveMachine, openChangeAddress } from '../../machines/machine-dialogs'
import { machinesDot } from '../../machines/machines-dot'
import '../../machines/machines.css'
import { machineAccessLines, reconnectMachine, useMachines } from '../../machines/useMachines'
import { useLinked } from '../../projects/useProjects'
import { ListRow, StatusChip } from '../../theme/primitives'
import { SidebarSection } from '../SidebarSection'

/** Between Projects (10) and Epics (20): the Machines the Projects will be grouped by (worfy-link ticket 09). */
export const order = 15

const styles = {
  list: { margin: 0, padding: 0, listStyle: 'none' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  unavailable: { border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-muted)' },
  details: { display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 4px 31px', fontSize: 'var(--text-12)', lineHeight: '16px' },
  access: { margin: 0, color: 'var(--text-secondary)' },
  hint: { margin: 0, color: 'var(--text-muted)', overflowWrap: 'anywhere' },
  // Under the icon too: the three buttons fit one line of the sidebar at its narrowest.
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', margin: '2px 0 0 -23px' },
  action: {
    height: 22,
    padding: '0 6px',
    whiteSpace: 'nowrap',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border)',
    background: 'var(--surface-raised)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
  },
  footer: { display: 'flex', padding: '2px 8px 4px' },
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
      {machine.state === 'sleeping' ? 'Sleeping' : 'Offline'}
    </span>
  )
}

const rowTitle = (machine: LinkedMachineView): string =>
  machine.certificateChanged
    ? `${machine.name} answered with another certificate. Remove it, then link it again with Link a machine`
    : machine.state === 'online'
      ? `${machine.name} is connected`
      : machine.state === 'sleeping'
        ? `${machine.name} went to sleep; worfy reconnects when it wakes`
        : `${machine.name} is offline; worfy keeps trying`

/** Not connected, whatever the reason: the row offers Reconnect, Change address… and Remove. */
const offline = (machine: LinkedMachineView): boolean => machine.certificateChanged || machine.state !== 'online'

interface MenuProps {
  machine: LinkedMachineView
  x: number
  y: number
  onReconnect: () => void
  onChangeAddress: () => void
  onRemove: () => void
  onClose: () => void
}

/** The context menu of a Machine row. Escape, a click elsewhere or leaving the window closes it. */
function MachineMenu({ machine, x, y, onReconnect, onChangeAddress, onRemove, onClose }: MenuProps) {
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
      {offline(machine) ? (
        <button type="button" role="menuitem" className="w-row" disabled={machine.dialing === true} onClick={onReconnect}>
          {machine.dialing === true ? 'Connecting…' : 'Reconnect'}
        </button>
      ) : null}
      <button type="button" role="menuitem" className="w-row" onClick={onChangeAddress}>
        Change address…
      </button>
      <button type="button" role="menuitem" className="w-row" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

/**
 * The details under a Machine's row (worfy-link ticket 37): the access both ways, the Windows
 * firewall hint main gives (worfy-link ticket 36), and for a Machine without a connection the
 * buttons Reconnect, Change address… and Remove. Reconnect is inactive while worfy dials it.
 */
function MachineDetails({ machine, access, onReconnect }: { machine: LinkedMachineView; access: string[]; onReconnect: () => void }) {
  const dialing = machine.dialing === true
  return (
    <div style={styles.details}>
      {access.map((line) => (
        <p key={line} style={styles.access} data-testid="machine-access-line">
          {line}
        </p>
      ))}
      {machine.hint ? (
        <p style={styles.hint} data-testid="machine-hint">
          {machine.hint}
        </p>
      ) : null}
      {offline(machine) ? (
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.action}
            data-testid="machine-reconnect"
            disabled={dialing}
            title={dialing ? `worfy is connecting to ${machine.name}` : `Connect to ${machine.name} now`}
            onClick={onReconnect}
          >
            {dialing ? 'Connecting…' : 'Reconnect'}
          </button>
          <button type="button" style={styles.action} data-testid="machine-change-address" onClick={() => openChangeAddress(machine.id)}>
            Change address…
          </button>
          <button type="button" style={styles.action} data-testid="machine-remove" onClick={() => askRemoveMachine(machine.id)}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The "Machines" section (worfy-link ticket 02): the Linked machines with their state and access,
 * Reconnect, Change address… and Remove on a Machine without a connection and in a row's context
 * menu (worfy-link ticket 37), and "Link a machine…" under the list. With no Linked machine, only
 * the button.
 *
 * Collapsed until the user expands it. Next to the heading, a collapsed section too, a dot says
 * whether a Linked machine is online (machines-dot.ts). The switches of the link are in
 * Settings → Machines (src/renderer/settings/MachinesSection.tsx).
 */
export default function MachinesSection() {
  const state = useMachines()
  const linked = useLinked()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [menu, setMenu] = useState<{ machine: LinkedMachineView; x: number; y: number }>()
  const [error, setError] = useState<string>()
  const dot = machinesDot(state?.linked ?? [])

  const run = async (work: Promise<string | undefined>): Promise<void> => {
    setError(await work)
  }

  return (
    <SidebarSection
      id="MachinesSection"
      title="Machines"
      testId="machines-section"
      defaultCollapsed
      // The status colour without a caption: the dot says it in its tooltip and to a screen reader.
      meta={dot ? <span className="w-machines-dot" role="img" aria-label={dot.label} title={dot.label} data-state={dot.kind} data-testid="machines-dot" /> : null}
      notice={
        error ? (
          <p role="alert" data-testid="machines-error" style={styles.message}>
            {error}
          </p>
        ) : null
      }
      overlay={
        <>
          {menu ? (
            <MachineMenu
              machine={menu.machine}
              x={menu.x}
              y={menu.y}
              onClose={() => setMenu(undefined)}
              onReconnect={() => {
                const id = menu.machine.id
                setMenu(undefined)
                void run(reconnectMachine(id))
              }}
              onChangeAddress={() => {
                setMenu(undefined)
                openChangeAddress(menu.machine.id)
              }}
              onRemove={() => {
                setMenu(undefined)
                askRemoveMachine(menu.machine.id)
              }}
            />
          ) : null}
          {dialogOpen ? <LinkMachineDialog onClose={() => setDialogOpen(false)} /> : null}
        </>
      }
    >
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
            <MachineDetails
              machine={machine}
              access={machineAccessLines(machine, state?.projectsAccess ?? false, linked?.machines.find((each) => each.id === machine.id)?.sharing)}
              onReconnect={() => void run(reconnectMachine(machine.id))}
            />
          </li>
        ))}
      </ul>

      <div style={styles.footer}>
        <button type="button" style={styles.linkButton} data-testid="link-machine-button" onClick={() => setDialogOpen(true)}>
          Link a machine…
        </button>
      </div>
    </SidebarSection>
  )
}
