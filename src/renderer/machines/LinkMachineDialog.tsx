import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatLinkAddress, isTailscaleHost, parseLinkAddress, type DiscoveredMachineView, type TailscalePeerView } from '../../shared/ipc/link'
import { invoke } from '../ipc'
import { PrimaryButton } from '../theme/primitives'
import { closeLinking, openLinking, pairWith, useMachines } from './useMachines'

export interface LinkMachineDialogProps {
  onClose: () => void
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.25)',
  },
  dialog: {
    width: 480,
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
  },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-15)', fontWeight: 600 },
  subtitle: { margin: '0 0 var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  panel: {
    margin: '0 0 var(--space-4)',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-node)',
    border: '1px solid var(--border)',
    background: 'var(--surface-raised)',
  },
  caption: { margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  code: {
    margin: 'var(--space-1) 0',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 32,
    lineHeight: '40px',
    fontWeight: 600,
    letterSpacing: '0.18em',
    color: 'var(--text)',
  },
  mono: { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  section: { margin: '0 0 var(--space-2)', fontSize: 'var(--text-13)', fontWeight: 600 },
  list: { margin: '0 0 var(--space-3)', padding: 0, listStyle: 'none' },
  found: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' },
  label: { fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
  },
  error: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  hint: { color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  mark: { marginLeft: 'var(--space-1)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)' },
  offlineRow: { color: 'var(--text-muted)', cursor: 'default' },
  linkedRow: { display: 'flex', height: 'auto', minHeight: 'var(--row-height)', flexDirection: 'column', alignItems: 'flex-start', gap: 2, paddingTop: 4, paddingBottom: 4, cursor: 'default' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  secondary: {
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 'var(--text-13)',
  },
} satisfies Record<string, CSSProperties>

type Target = { name: string | null; address: string }

/** Whether `address` (`host:port` as main lists it) is a Tailscale address of this Machine. */
const isTailscaleOwn = (address: string): boolean => {
  const parsed = parseLinkAddress(address)
  return parsed.ok && isTailscaleHost(parsed.address.host)
}

/** An address with nothing after its port colon, IPv6 in brackets: what picking a tailnet machine puts in the field. */
const withoutPort = (host: string): string => (host.includes(':') ? `[${host}]:` : `${host}:`)

/** The shortest wait before the window asks main again whether the pause is over. */
const PAUSE_RECHECK_MS = 1000

const checkIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

/**
 * "Link a machine" (worfy-link ticket 02; ADR-0052, point 4). Opened on both worfy: each shows its
 * own code and address, and on either one the user picks the other worfy — found by Bonjour, or by
 * an address typed by hand — and types the code the other one shows. While it is open the server
 * listens and Bonjour searches; closing it (Close, Esc, a click outside) closes linking again.
 *
 * While "Link through Tailscale" is on it also lists the machines of the user's tailnet (worfy-link
 * ticket 30), when main finds the Tailscale CLI: picking an online one puts its address in the field,
 * and the port is still typed. An offline one is shown greyed and cannot be picked.
 */
export function LinkMachineDialog({ onClose }: LinkMachineDialogProps) {
  const state = useMachines()
  const [openError, setOpenError] = useState<string>()
  const [address, setAddress] = useState('')
  const [addressError, setAddressError] = useState<string>()
  const [target, setTarget] = useState<Target>()
  const [code, setCode] = useState('')
  const [pairError, setPairError] = useState<string>()
  const [pairing, setPairing] = useState(false)
  const [peers, setPeers] = useState<TailscalePeerView[]>([])
  const [picked, setPicked] = useState(0)
  const titleId = useId()
  const addressId = useId()
  const codeId = useId()
  const addressField = useRef<HTMLInputElement>(null)
  const codeField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void openLinking().then(setOpenError)
    return () => void closeLinking()
  }, [])

  useEffect(() => {
    if (target === undefined) addressField.current?.focus()
    else codeField.current?.focus()
  }, [target])

  // The tailnet list is asked for once the state says "Link through Tailscale" is on, and again each
  // time it turns on. No list is an answer, not an error: main gives none without the CLI.
  const tailscaleOn = state?.tailscale === true
  useEffect(() => {
    if (!tailscaleOn) return
    let current = true
    void invoke('link.tailscalePeers').then((result) => {
      if (current) setPeers(result.ok ? result.value : [])
    })
    return () => {
      current = false
      setPeers([])
    }
  }, [tailscaleOn])

  // A picked tailnet machine: back to the field, where its port is typed. Setting the value has put
  // the caret at its end already.
  useEffect(() => {
    if (picked > 0) addressField.current?.focus()
  }, [picked])

  const choose = (next: Target): void => {
    setTarget(next)
    setCode('')
    setPairError(undefined)
  }

  const next = (): void => {
    const parsed = parseLinkAddress(address)
    if (!parsed.ok) return setAddressError(parsed.error)
    setAddressError(undefined)
    choose({ name: null, address: formatLinkAddress(parsed.address) })
  }

  const link = async (): Promise<void> => {
    if (target === undefined || pairing) return
    if (!/^\d{6}$/.test(code)) return setPairError('The code is six digits')
    setPairing(true)
    setPairError(undefined)
    const result = await pairWith(target.address, code)
    setPairing(false)
    if ('reason' in result) {
      setPairError(result.reason)
      setCode('')
      codeField.current?.focus()
    }
  }

  const linking = state?.linking
  const pausedUntil = linking?.pausedUntil
  const linked = linking?.linked ?? null
  const machine = state?.machine ?? null

  // When the pause ends, linking opens again by itself: the window asks main once more and shows the code.
  // Timers stand still while the Mac sleeps, so main may end the pause first: its next state has no
  // pause and no code, cancels the timer, and linking opens from here instead.
  // main may answer that call with the same pause (its clock a moment behind): every answer that is not
  // an error counts as an ask, so the timer is set again, never sooner than PAUSE_RECHECK_MS, and main is not asked in a loop.
  const wasPaused = useRef(false)
  const [asks, setAsks] = useState(0)
  const shownCode = linking?.code ?? null
  useEffect(() => {
    if (pausedUntil !== undefined) {
      wasPaused.current = true
      const ask = (): void =>
        void openLinking().then((error) => {
          setOpenError(error)
          // A failed call is shown once: asking again would only repeat it and restart main's discovery.
          if (error === undefined) setAsks((count) => count + 1)
        })
      const timer = setTimeout(ask, Math.max(PAUSE_RECHECK_MS, pausedUntil - Date.now()))
      return () => clearTimeout(timer)
    }
    if (!wasPaused.current) return
    wasPaused.current = false
    if (shownCode === null) void openLinking().then(setOpenError)
  }, [pausedUntil, shownCode, asks])

  const problem = openError ?? state?.problem ?? null
  const targetLabel = target ? (target.name === null ? target.address : `${target.name} (${target.address})`) : ''

  // The Linked machines Bonjour finds (worfy-link ticket 37): listed so the user sees they are
  // linked, with no way to link them again — one link works both ways. Main gives their ids alone;
  // the name is the one this Machine knows them by.
  const foundLinked = (state?.discoveredLinked ?? []).flatMap((id) => state?.linked.filter((machine) => machine.id === id) ?? [])
  const linkedRow = (machine: { id: string; name: string }) => (
    <li key={`linked:${machine.id}`} data-testid="link-found-linked-row" data-machine-id={machine.id} className="w-row" style={styles.linkedRow}>
      <span style={styles.found}>
        <span style={{ fontWeight: 600 }}>{machine.name}</span>
        <span className="w-chip" style={styles.mark} data-testid="link-found-linked">
          Already linked
        </span>
      </span>
      <span style={styles.hint} data-testid="link-found-linked-hint">
        {`One link works both ways. To open ${machine.name}'s Projects here, turn on "Linked machines can work with my Projects" on ${machine.name}.`}
      </span>
    </li>
  )

  const foundRow = (found: DiscoveredMachineView) => (
    <li key={`${found.id}|${found.host}|${found.port}`} data-testid="link-found-row" data-machine-id={found.id}>
      <button type="button" className="w-row" onClick={() => choose({ name: found.name, address: formatLinkAddress(found) })}>
        <span className="w-row__label" style={styles.found}>
          <span style={{ fontWeight: 600 }}>{found.name}</span>
          <span style={styles.mono}>{formatLinkAddress(found)}</span>
        </span>
        {found.compatible && !found.conflict ? null : (
          <span className="w-row__trailing" style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
            {found.conflict ? (
              <span
                className="w-chip w-chip--blocked"
                data-testid="link-found-conflict"
                title="Two worfy announce this Machine at different addresses: one of them is not it. Link by the address the other worfy shows"
              >
                Two addresses
              </span>
            ) : null}
            {found.compatible ? null : (
              <span className="w-chip w-chip--blocked" title={`It speaks link protocol ${found.protocol ?? 'unknown'}: linking will be refused until both run the same version`}>
                Other version
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  )

  const peerRow = (peer: TailscalePeerView) => (
    <li key={`tailscale:${peer.address}`} data-testid="link-tailscale-row" data-online={peer.online}>
      <button
        type="button"
        className="w-row"
        disabled={!peer.online}
        style={peer.online ? undefined : styles.offlineRow}
        title={peer.online ? 'Puts its Tailscale address in the field: type the port its Link a machine shows' : 'Offline in your tailnet: it can be linked once it is online'}
        onClick={() => {
          setAddress(withoutPort(peer.address))
          setAddressError(undefined)
          setPicked((count) => count + 1)
        }}
      >
        <span className="w-row__label" style={styles.found}>
          <span style={{ fontWeight: 600 }}>{peer.name}</span>
          <span style={peer.online ? styles.mono : { ...styles.mono, color: 'inherit' }}>{peer.address}</span>
        </span>
        {peer.online ? null : (
          <span className="w-row__trailing">
            <span className="w-chip" style={styles.mark} data-testid="link-tailscale-offline">
              Offline
            </span>
          </span>
        )}
      </button>
    </li>
  )

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={styles.dialog}
        data-testid="link-machine-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id={titleId} style={styles.title}>
          Link a machine
        </h2>
        <p style={styles.subtitle}>Open Link a machine on both worfy, then on one of them choose the other and type the code it shows.</p>

        {linked ? (
          <>
            <div style={{ ...styles.panel, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }} data-testid="link-success" role="status">
              <span className="w-chip w-chip--ready">{checkIcon}Linked</span>
              <span>
                Linked with <strong>{linked.name}</strong>. It is listed under Machines.
              </span>
            </div>
            <div style={styles.actions}>
              <span style={{ flex: 1 }} />
              <PrimaryButton onClick={onClose}>Done</PrimaryButton>
            </div>
          </>
        ) : (
          <>
            <div style={styles.panel} aria-label="This Machine">
              <p style={styles.caption}>{machine ? `Code for ${machine.name}` : 'This Machine'}</p>
              {linking?.code ? (
                <p style={styles.code} data-testid="link-code" aria-label="Pairing code">
                  {linking.code}
                </p>
              ) : linking?.pausedUntil !== undefined ? (
                <p role="alert" data-testid="link-paused" style={{ ...styles.error, margin: 'var(--space-2) 0' }}>
                  {`Linking is paused until ${new Date(linking.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} after repeated failed attempts. Restart worfy to link sooner.`}
                </p>
              ) : (
                <p style={{ ...styles.hint, margin: 'var(--space-2) 0' }}>{problem ? '' : 'Opening…'}</p>
              )}
              {state && state.addresses.length > 0 ? (
                <p style={styles.caption}>
                  Address{' '}
                  {state.addresses.map((each, index) => (
                    <span key={each} data-testid="link-own-address-entry">
                      {index > 0 ? ', ' : ''}
                      <span style={styles.mono} data-testid="link-own-address">
                        {each}
                      </span>
                      {isTailscaleOwn(each) ? (
                        <span
                          className="w-chip"
                          style={styles.mark}
                          data-testid="link-tailscale-mark"
                          title={
                            state.tailscale
                              ? 'The address of this Machine in your tailnet: the other worfy can type it, or this Machine\'s MagicDNS name, with this port'
                              : 'The address of this Machine in your tailnet. To link through it, turn on Link through Tailscale in Settings → Machines on both worfy'
                          }
                        >
                          Tailscale
                        </span>
                      ) : null}
                    </span>
                  ))}
                </p>
              ) : null}
              {linking?.failure ? (
                <p role="alert" data-testid="link-failure" style={{ ...styles.error, margin: 'var(--space-1) 0 0' }}>
                  {linking.failure}
                </p>
              ) : null}
              {problem ? (
                <p role="alert" data-testid="link-problem" style={{ ...styles.error, margin: 'var(--space-1) 0 0' }}>
                  {problem}
                </p>
              ) : null}
            </div>

            {target === undefined ? (
              <>
                <h3 style={styles.section}>Link with another worfy</h3>
                {state?.bonjour ? (
                  state.discovered.length > 0 || foundLinked.length > 0 ? (
                    <ul style={styles.list} aria-label="Found in the network">
                      {state.discovered.map(foundRow)}
                      {foundLinked.map(linkedRow)}
                    </ul>
                  ) : (
                    <p style={{ ...styles.hint, margin: '0 0 var(--space-3)' }}>Looking for worfy in the local network…</p>
                  )
                ) : (
                  <p style={{ ...styles.hint, margin: '0 0 var(--space-3)' }}>Search in the network is off. Type the address the other worfy shows.</p>
                )}
                {peers.length > 0 ? (
                  <>
                    <p style={{ ...styles.caption, margin: '0 0 var(--space-1)' }}>In your tailnet</p>
                    <ul style={styles.list} aria-label="In your tailnet" data-testid="link-tailscale-list">
                      {peers.map(peerRow)}
                    </ul>
                  </>
                ) : null}
                <div style={styles.field}>
                  <label htmlFor={addressId} style={styles.label}>
                    Address
                  </label>
                  <input
                    ref={addressField}
                    id={addressId}
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    style={styles.input}
                    value={address}
                    placeholder="192.168.1.20:52000"
                    data-testid="link-address-input"
                    aria-invalid={addressError !== undefined}
                    aria-describedby={addressError ? `${addressId}-hint ${addressId}-error` : `${addressId}-hint`}
                    onChange={(event) => {
                      setAddress(event.target.value)
                      setAddressError(undefined)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') next()
                    }}
                  />
                  <span id={`${addressId}-hint`} data-testid="link-address-hint" style={styles.hint}>
                    The address and its port are under the code in Link a machine on the other worfy.
                    {state?.tailscale ? ' Through Tailscale, type its MagicDNS name or Tailscale address with that port, like pc:52000.' : ''}
                  </span>
                  {addressError ? (
                    <span id={`${addressId}-error`} role="alert" data-testid="link-address-error" style={styles.error}>
                      {addressError}
                    </span>
                  ) : null}
                </div>
                <div style={styles.actions}>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={styles.secondary} onClick={onClose}>
                    Close
                  </button>
                  <PrimaryButton disabled={address.trim() === ''} onClick={next}>
                    Next
                  </PrimaryButton>
                </div>
              </>
            ) : (
              <>
                <h3 style={styles.section}>Link with {targetLabel}</h3>
                <div style={styles.field}>
                  <label htmlFor={codeId} style={styles.label}>
                    Code shown on {target.name ?? 'the other worfy'}
                  </label>
                  <input
                    ref={codeField}
                    id={codeId}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    spellCheck={false}
                    autoComplete="off"
                    style={{ ...styles.input, width: 120, fontSize: 'var(--text-15)', letterSpacing: '0.18em' }}
                    value={code}
                    placeholder="000000"
                    data-testid="link-code-input"
                    aria-invalid={pairError !== undefined}
                    aria-describedby={pairError ? `${codeId}-error` : undefined}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      setPairError(undefined)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void link()
                    }}
                  />
                  {pairError ? (
                    <span id={`${codeId}-error`} role="alert" data-testid="link-error" style={styles.error}>
                      {pairError}
                    </span>
                  ) : null}
                </div>
                <div style={styles.actions}>
                  <button type="button" style={styles.secondary} disabled={pairing} onClick={() => setTarget(undefined)}>
                    Back
                  </button>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={styles.secondary} onClick={onClose}>
                    Close
                  </button>
                  <PrimaryButton disabled={pairing || code.length !== 6} onClick={() => void link()}>
                    {pairing ? 'Linking…' : 'Link'}
                  </PrimaryButton>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
