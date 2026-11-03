// Settings → Vendors (worfy-multi-vendor ticket 29): one row per Vendor this build runs (`vendors.list`),
// with who is signed in to it (`vendors.account`: the email and the plan, as the first-run sign-in check
// shows Claude Code's) or a button that starts the sign-in (`vendors.startLogin`). Codex signs in in the
// browser, which main opens; the row waits for the end and shows the account. A Vendor that signs in in its
// own terminal (Claude Code) gets the command to run and "Check again". A Vendor this build does not carry
// says so and offers nothing.
//
// Nothing here pops up: a check that fails or a sign-in that fails is a line in its row, never a toast or
// a dialog. The Vendor picker of "New session" asks the same sign-in again each time it opens, so a Vendor
// signed in here can start a Session at once. The rows never look at which Vendor they draw: the labels
// and logos come from src/shared/vendors/vendor.ts, how a sign-in goes from main's answer.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { VendorConnection, VendorEntry } from '../../shared/ipc/vendors'
import { vendorLabel } from '../../shared/vendors/vendor'
import { invoke, readableReason } from '../ipc'
import { VendorBadge } from '../session/VendorBadge'

export const order = 58
export const title = 'Vendors'

const styles = {
  lead: { margin: '0 0 var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  row: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-12)',
    color: 'var(--text)',
  },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-13)', fontWeight: 600 },
  note: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  account: { margin: 0, color: 'var(--text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  problem: { margin: 0, color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  code: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)' },
} satisfies Record<string, CSSProperties>

/** A connection as the first-run sign-in check shows one: «email · plan», or «signed in» when it names neither. */
function connectionLine(connection: VendorConnection): string {
  const who = [connection.email, connection.plan].filter((part): part is string => typeof part === 'string' && part !== '')
  return who.length > 0 ? who.join(' · ') : 'signed in'
}

/** What a row knows of its Vendor's sign-in. */
type RowState =
  | { kind: 'checking' }
  | { kind: 'known'; connections: VendorConnection[] }
  | { kind: 'unknown'; reason: string }
  | { kind: 'signing-in' }
  | { kind: 'in-terminal'; command: string }

/** One Vendor's row. */
export function VendorRow({ entry }: { entry: VendorEntry }) {
  const { vendor } = entry
  const label = vendorLabel(vendor)
  const [state, setState] = useState<RowState>({ kind: 'checking' })
  const [failure, setFailure] = useState<string | null>(null)
  // Answers that come after the row is gone, or after a newer ask, are dropped.
  const generation = useRef(0)
  const cancelled = useRef(false)

  /** Asks main who is signed in; the answer replaces the row's state. */
  const askAccount = useCallback(() => {
    const ask = ++generation.current
    void invoke('vendors.account', { vendor }).then((result) => {
      if (ask !== generation.current) return
      setState(result.ok ? { kind: 'known', connections: result.value.connections } : { kind: 'unknown', reason: readableReason(result.error) })
    })
  }, [vendor])

  const check = (): void => {
    setState({ kind: 'checking' })
    askAccount()
  }

  // The row starts as «checking»: the first ask needs no state of its own.
  useEffect(() => {
    if (entry.inBuild) askAccount()
    return () => {
      generation.current += 1
    }
  }, [entry.inBuild, askAccount])

  const signIn = (): void => {
    const ask = ++generation.current
    cancelled.current = false
    setFailure(null)
    setState({ kind: 'signing-in' })
    void invoke('vendors.startLogin', { vendor }).then((result) => {
      if (ask !== generation.current) return
      if (!result.ok) {
        if (!cancelled.current) setFailure(readableReason(result.error))
        check()
        return
      }
      const { connections, command } = result.value
      if (command !== null) setState({ kind: 'in-terminal', command })
      else if (connections !== null) setState({ kind: 'known', connections })
      else check()
    })
  }

  const cancel = (): void => {
    cancelled.current = true
    void invoke('vendors.cancelLogin', { vendor })
  }

  const signedIn = state.kind === 'known' ? state.connections.filter((connection) => connection.signedIn) : []
  const signInButton = (
    <button type="button" className="w-action w-action--primary" onClick={signIn} data-testid="vendor-sign-in">
      Sign in to {label}
    </button>
  )

  return (
    <li style={styles.row} data-testid="vendor-row" data-vendor={vendor} data-state={!entry.inBuild ? 'absent' : signedIn.length > 0 ? 'signed-in' : state.kind}>
      <div style={styles.head}>
        <VendorBadge vendor={vendor} testId="vendor-row-badge" />
        {entry.required ? <span style={{ ...styles.note, fontWeight: 400 }}>· required</span> : <span style={{ ...styles.note, fontWeight: 400 }}>· optional</span>}
      </div>
      {!entry.inBuild ? (
        <p style={styles.note} data-testid="vendor-absent">
          {label} is not part of this build of worfy.
        </p>
      ) : state.kind === 'checking' ? (
        <p style={styles.note}>Checking the sign-in…</p>
      ) : state.kind === 'signing-in' ? (
        <div style={styles.actions}>
          <span style={styles.note} role="status" data-testid="vendor-signing-in">
            Finish the sign-in in your browser…
          </span>
          <button type="button" className="w-action" onClick={cancel} data-testid="vendor-cancel-sign-in">
            Cancel
          </button>
        </div>
      ) : state.kind === 'in-terminal' ? (
        <>
          <p style={styles.note} data-testid="vendor-terminal-hint">
            Run <code style={styles.code}>{state.command}</code> in a Terminal Node and sign in there, then check again.
          </p>
          <div style={styles.actions}>
            <button type="button" className="w-action" onClick={check} data-testid="vendor-check-again">
              Check again
            </button>
          </div>
        </>
      ) : state.kind === 'unknown' ? (
        <>
          <p style={styles.note} data-testid="vendor-unknown">
            Could not check the sign-in: {state.reason}
          </p>
          <div style={styles.actions}>
            <button type="button" className="w-action" onClick={check} data-testid="vendor-check-again">
              Check again
            </button>
          </div>
        </>
      ) : signedIn.length > 0 ? (
        signedIn.map((connection) => (
          <p key={connection.provider} style={styles.account} data-testid="vendor-account">
            Signed in: {connectionLine(connection)}
          </p>
        ))
      ) : (
        <>
          <p style={styles.note} data-testid="vendor-signed-out">
            Not signed in. {entry.required ? `worfy needs ${label} for its Sessions.` : `Sign in to start Sessions on ${label} too.`}
          </p>
          <div style={styles.actions}>{signInButton}</div>
        </>
      )}
      {failure !== null ? (
        <p style={styles.problem} data-testid="vendor-sign-in-failed">
          The sign-in did not finish: {failure}
        </p>
      ) : null}
    </li>
  )
}

/** The section: a row per Vendor. */
export default function VendorsSection() {
  const [entries, setEntries] = useState<VendorEntry[] | { error: string }>()

  useEffect(() => {
    let active = true
    void invoke('vendors.list').then((result) => {
      if (active) setEntries(result.ok ? result.value.vendors : { error: readableReason(result.error) })
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <>
      <p style={styles.lead}>The agents worfy runs Sessions on. Each keeps its sign-in in its own home folder; worfy keeps no tokens.</p>
      {entries === undefined ? (
        <p style={styles.note}>Reading the Vendors…</p>
      ) : 'error' in entries ? (
        <p style={styles.problem} data-testid="vendors-failed">
          Could not read the Vendors: {entries.error}
        </p>
      ) : (
        <ul style={styles.list} aria-label="Vendors">
          {entries.map((entry) => (
            <VendorRow key={entry.vendor} entry={entry} />
          ))}
        </ul>
      )}
    </>
  )
}
