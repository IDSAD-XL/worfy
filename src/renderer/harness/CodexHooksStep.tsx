import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { codexHooksCommand, type HarnessHooksTrust, type HarnessStatus } from '../../shared/ipc/harness'
import { invoke } from '../ipc'
import { Button } from '../theme/Button'

// The step "Approve the Harness hooks in Codex" (worfy-multi-vendor ticket 39; ADR-0094, risk 3). Codex
// keeps a plugin's hooks off after each install or update of it until the user approves them in Codex
// (`/hooks`), and without them the gate and the guards of the workflow do not run there, so a Codex
// Autopilot Run does not start. The toolbar's Harness item opens the step when an install or update in
// Codex leaves hooks to approve (`hooksToApprove` of the Codex part), and again on a click of its
// "Codex: approve hooks". The step says what to open, and "Check again" asks Codex through main
// (`harness.codexHooks`): approved — the toolbar item no longer asks; not approved, or worfy could not
// tell, — the step says so and stays.
//
// Step 1 names the Codex to open (worfy-polish ticket 54): worfy runs the Codex binary of its build, and
// the user may have no `codex` on PATH at all. Main answers with that binary (`harness.codexBinary`), and
// the step shows a command that starts it from the home folder, with Copy: started from a folder that no
// longer exists (a removed worktree), Codex stops with "No such file or directory (os error 2)". Only a
// command to copy, no button that opens a terminal: the same text works in any terminal of either system.

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
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
  title: { margin: '0 0 var(--space-2)', fontSize: 'var(--text-15)', fontWeight: 600 },
  text: { margin: '0 0 var(--space-2)', color: 'var(--text-secondary)', lineHeight: 1.45 },
  steps: { margin: '0 0 var(--space-3)', paddingLeft: 20, lineHeight: 1.6 },
  code: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)' },
  command: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', margin: 'var(--space-1) 0 var(--space-1)' },
  commandText: {
    flex: 1,
    minWidth: 0,
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border)',
    background: 'var(--surface-raised)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    userSelect: 'text',
  },
  result: { margin: '0 0 var(--space-3)', fontSize: 'var(--text-12)', minHeight: 18 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)' },
} satisfies Record<string, CSSProperties>

/** What the step says after a check, by its answer; the tone of the line. */
const RESULTS: Record<HarnessHooksTrust, { text: string; color: string }> = {
  approved: { text: 'Approved: Codex runs the Harness hooks, and a Codex Autopilot Run can start.', color: 'var(--ready-text)' },
  'not-approved': { text: 'The Harness hooks are still off in Codex. Approve them in /hooks, then check again.', color: 'var(--blocked-text)' },
  unknown: { text: 'worfy could not read the hooks from Codex. Check that the Harness is installed in Codex, then check again.', color: 'var(--blocked-text)' },
}

/** The binary main answered with: not yet, a path with the platform's form of the command, or none. */
type Binary = { kind: 'asking' } | { kind: 'found'; path: string; windows: boolean } | { kind: 'missing' }

/** How long the Copy button says "Copied". */
const COPIED_MS = 2000

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'answered'; trust: HarnessHooksTrust } | { kind: 'failed'; error: string }

export interface CodexHooksStepProps {
  onClose: () => void
  /** The status main answered with after a check; the Harness item shows it. */
  onStatus: (status: HarnessStatus) => void
}

/** The step as a dialog over the window. */
export default function CodexHooksStep({ onClose, onStatus }: CodexHooksStepProps) {
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const checking = check.kind === 'checking'
  // Whether a check runs, for the Escape listener: set where the check starts and ends, so a key pressed
  // right after the answer is drawn sees it even before React re-runs the listener's effect.
  const checkingNow = useRef(false)
  const [binary, setBinary] = useState<Binary>({ kind: 'asking' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void invoke('harness.codexBinary').then((answer) => {
      if (!live) return
      setBinary(answer.ok && answer.value.path !== null ? { kind: 'found', path: answer.value.path, windows: answer.value.windows } : { kind: 'missing' })
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !checkingNow.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const checkAgain = (): void => {
    checkingNow.current = true
    setCheck({ kind: 'checking' })
    void invoke('harness.codexHooks').then((answer) => {
      checkingNow.current = false
      if (!answer.ok) {
        setCheck({ kind: 'failed', error: answer.error })
        return
      }
      setCheck({ kind: 'answered', trust: answer.value.trust })
      onStatus(answer.value.status)
    })
  }

  const result = check.kind === 'answered' ? RESULTS[check.trust] : check.kind === 'failed' ? { text: `The check failed: ${check.error}`, color: 'var(--blocked-text)' } : null
  const approved = check.kind === 'answered' && check.trust === 'approved'

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !checking) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="codex-hooks-step-title" style={styles.dialog} data-testid="codex-hooks-step">
        <h2 id="codex-hooks-step-title" style={styles.title}>
          Approve the Harness hooks in Codex
        </h2>
        <p style={styles.text}>
          Codex turns the Harness hooks off after every install or update of the Harness, until you approve them. Without them the gate and the guards of the workflow do not run in Codex,
          so a Codex Autopilot Run does not start.
        </p>
        <ol style={styles.steps} data-testid="codex-hooks-step-steps">
          <li>
            <OpenCodex binary={binary} copied={copied} onCopy={(command) => void navigator.clipboard?.writeText(command).then(() => setCopied(true))} />
          </li>
          <li>
            Type <code style={styles.code}>/hooks</code>
          </li>
          <li>
            Approve the hooks of the plugin <code style={styles.code}>worfy</code>
          </li>
          <li>Come back here and press Check again.</li>
        </ol>
        <p role="status" aria-live="polite" style={{ ...styles.result, color: result?.color ?? 'var(--text-muted)' }} data-testid="codex-hooks-step-result" data-trust={check.kind === 'answered' ? check.trust : check.kind}>
          {checking ? 'Asking Codex…' : (result?.text ?? '')}
        </p>
        <div style={styles.footer}>
          <Button onClick={onClose} disabled={checking} data-testid="codex-hooks-step-close">
            {approved ? 'Done' : 'Close'}
          </Button>
          {approved ? null : (
            <Button variant="primary" onClick={checkAgain} disabled={checking}>
              Check again
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Step 1: the command that starts the Codex of this build from the home folder, or why there is none. */
function OpenCodex({ binary, copied, onCopy }: { binary: Binary; copied: boolean; onCopy: (command: string) => void }) {
  if (binary.kind === 'asking') return <>Open a terminal and start the Codex of worfy.</>
  if (binary.kind === 'missing') return <>worfy could not find the Codex of this build. Start Codex in a terminal from your home folder.</>
  const command = codexHooksCommand(binary.path, binary.windows)
  return (
    <>
      Open {binary.windows ? 'PowerShell' : 'Terminal'} and start the Codex of worfy from your home folder:
      <div style={styles.command}>
        <code style={styles.commandText} data-testid="codex-hooks-step-command">
          {command}
        </code>
        <Button aria-label="Copy the command" onClick={() => onCopy(command)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </>
  )
}
