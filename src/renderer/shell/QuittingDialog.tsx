// The window «Quitting worfy» (worfy-continuity ticket 04): while worfy quits, restarts for an Update or the system
// shuts down, the quit's coordinator (src/main/quit-grace.ts) waits up to 60 s for the external calls of the
// Sessions that have no result yet (`git push`, `gh pr merge`), and every window shows them here with the time left.
// Quit now ends the wait at once. Once the wait is over the window says the agents are being stopped, until the app
// is gone. Without such calls the quit goes on at once and the window never opens. Main owns the view: the window
// reads it at its load (`quitGrace.state`) and then follows `quitGrace.changed`. A modal Dialog of the kit
// (theme/kit/Dialog.tsx): neither Esc nor a press on the backdrop closes it — the quit is under way.
import { useEffect, useId, useState, type CSSProperties } from 'react'
import type { QuitGraceView } from '../../shared/ipc/quit-grace'
import { hasPreloadBridge, invoke, showSubscribeError, subscribe } from '../ipc'
import { Dialog } from '../theme/kit/Dialog'

const styles = {
  dialog: {
    width: 480,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
    outline: 'none',
  },
  header: { padding: 'var(--space-4) var(--space-4) var(--space-3)', borderBottom: '1px solid var(--border)' },
  title: { margin: 0, fontSize: 'var(--text-20)', fontWeight: 600 },
  body: { padding: 'var(--space-3) var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  text: { margin: 0 },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2, overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)' },
  muted: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

/** `seconds` as `m:ss`. */
function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export interface QuittingDialogViewProps {
  view: NonNullable<QuitGraceView>
  /** Seconds the wait may still last. */
  secondsLeft: number
  onQuitNow: () => void
}

/** The window over a view of main; QuittingDialog follows main's view and the time. */
export function QuittingDialogView({ view, secondsLeft, onQuitNow }: QuittingDialogViewProps) {
  const titleId = useId()
  const waiting = view.stage === 'waiting'
  const more = view.total - view.calls.length
  return (
    <Dialog open onClose={() => undefined} labelledBy={titleId} className="" style={styles.dialog} closeOnBackdrop={false} data-testid="quitting-worfy">
      <div style={styles.header}>
        <h2 id={titleId} style={styles.title}>
          Quitting worfy
        </h2>
      </div>
      <div style={styles.body}>
        {waiting ? (
          <>
            <p style={styles.text}>worfy waits for {view.total === 1 ? 'this command' : 'these commands'} of the agents to finish, so that none is cut off halfway:</p>
            <ul style={styles.list} data-testid="quitting-worfy-calls">
              {view.calls.map((call) => (
                <li key={call.id}>{call.description}</li>
              ))}
              {more > 0 ? <li>and {more} more</li> : null}
            </ul>
            <p style={styles.muted} role="timer" data-testid="quitting-worfy-left">
              worfy quits in {clockOf(secondsLeft)} at the latest. Autopilot runs continue after the next start.
            </p>
          </>
        ) : (
          <p style={styles.text} role="status" data-testid="quitting-worfy-stopping">
            Stopping the agents…
          </p>
        )}
      </div>
      <div style={styles.footer}>
        <button type="button" className="w-action w-action--primary" disabled={!waiting} data-testid="quitting-worfy-quit-now" onClick={onQuitNow}>
          Quit now
        </button>
      </div>
    </Dialog>
  )
}

/**
 * Main's view and the moment it came (performance.now()), from the window's load. Without the preload bridge (a unit
 * test of the shell) it follows nothing; a subscription that fails shows the error toast (showSubscribeError).
 */
function useQuitGrace(): { view: QuitGraceView; at: number } {
  const [state, setState] = useState<{ view: QuitGraceView; at: number }>({ view: null, at: 0 })
  useEffect(() => {
    if (!hasPreloadBridge()) return
    let changed = false
    let unsubscribe: () => void
    try {
      unsubscribe = subscribe('quitGrace.changed', (view) => {
        changed = true
        setState({ view, at: performance.now() })
      })
    } catch (error) {
      showSubscribeError('quitGrace.changed', error)
      return
    }
    void invoke('quitGrace.state').then((result) => {
      // A change that came before the answer is newer than it.
      if (result.ok && !changed) setState({ view: result.value, at: performance.now() })
    })
    return unsubscribe
  }, [])
  return state
}

/** The window «Quitting worfy» while main's quit waits; nothing otherwise. */
export function QuittingDialog() {
  const { view, at } = useQuitGrace()
  const [now, setNow] = useState(() => performance.now())
  const waiting = view?.stage === 'waiting'
  // A view newer than the last tick counts from its own moment (Math.max below) until the next tick.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting, at])
  if (view === null) return null
  const secondsLeft = (view.leftMs - Math.max(0, now - at)) / 1000
  return <QuittingDialogView view={view} secondsLeft={secondsLeft} onQuitNow={() => void invoke('quitGrace.quitNow')} />
}
