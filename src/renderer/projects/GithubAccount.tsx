// The "GitHub account" step of the "Add project" form (worfy-harness ticket 25): the accounts gh
// knows for the hosts of the folder's origins, each with its write access and the finish it allows
// (`projects.connect.accounts`), "No account", and "Sign in with gh", which runs `gh auth login` in a
// terminal inside the dialog. The user answers gh there; when gh exits the accounts are read again.
// The choice goes into the draft through `onChoose`; nothing is written before "Connect".
//
// The sign-in runs in main's pseudo-terminal of its own (`projects.connect.signIn`), not in a
// Terminal Node: a Project being connected has no Canvas yet.
//
// On a Linked machine (worfy-link ticket 11) the step reads that Machine's accounts and offers no
// sign-in and no first-run screen: both are of the Machine whose screen shows them, and gh is
// signed in on the Machine itself (decided without the owner, to confirm).
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { failureReason } from '../../shared/ipc/channels'
import { githubChoice, type GithubAccountsStep, type GithubChoice } from '../../shared/ipc/projects'
import { invoke, invokeOn, subscribe } from '../ipc'

export interface GithubAccountProps {
  root: string
  /**
   * The Machine of the folder: null — this Machine, a Linked machine's id — that one: its accounts
   * only, no sign-in. Left out: the window's Machine, as `invoke` routes.
   */
  machine?: string | null
  /** The name of a Linked machine, for "sign in on <name>". */
  machineName?: string
  disabled: boolean
  /** The account and the finish for the draft: on every load and every choice. */
  onChoose: (choice: GithubChoice) => void
  /** True while the accounts are read again, false when they came: "Connect" waits for them. The first read is busy from the start. */
  onBusy: (busy: boolean) => void
  /** gh is missing: the first-run screen says how to install it. */
  onFirstRun: () => void
}

const styles = {
  section: { margin: '0 0 var(--space-4)' },
  title: { margin: '0 0 var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-11)', fontWeight: 600 },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  secondary: { margin: '0 0 var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  error: { margin: '0 0 var(--space-2)', color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', margin: '0 0 var(--space-2)' },
  row: { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-1) var(--space-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--radius-button)' },
  rowOn: { borderColor: 'var(--accent)', background: 'var(--selected)' },
  rowText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  login: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontWeight: 600 },
  detail: { color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  detailBlocked: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' },
  chipNeutral: { background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  chipBlocked: { background: 'var(--blocked-bg)', color: 'var(--blocked-text)', border: '1px solid var(--blocked-ring)' },
  chipWorking: { background: 'var(--working-bg)', color: 'var(--working-text)' },
  terminalBox: { margin: 'var(--space-2) 0 0', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', overflow: 'hidden', background: 'var(--terminal-bg)' },
  terminalHead: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', color: 'var(--terminal-text)', fontSize: 'var(--text-12)' },
  terminalHost: { height: 180, padding: '0 var(--space-1) var(--space-1)' },
} satisfies Record<string, CSSProperties>

type Load = { kind: 'error'; reason: string } | { kind: 'step'; step: GithubAccountsStep }

/** The step's choice for a person's pick (undefined: none yet), else the default of the step. */
function choiceOf(step: GithubAccountsStep, picked: string | null | undefined): GithubChoice {
  if (picked !== undefined && (picked === null || (step.status === 'accounts' && step.accounts.some((account) => account.login === picked)))) return githubChoice(step, picked)
  return githubChoice(step, step.status === 'accounts' ? step.selected : null)
}

export function GithubAccount({ root, machine, machineName, disabled, onChoose, onBusy, onFirstRun }: GithubAccountProps) {
  /** A Linked machine's folder: its gh is not signed in from this screen. */
  const remote = typeof machine === 'string'
  /** The read the answer belongs to, and the answer; a read whose answer has not come is loading. */
  const [answer, setAnswer] = useState<{ read: number; load: Load } | null>(null)
  /** What the person picked: undefined until they pick; null is "No account". */
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [signIn, setSignIn] = useState<string | null>(null)
  const [reads, setReads] = useState(0)

  // The answer of the latest read goes to the draft of now, with the pick of now.
  const answered = useEffectEvent((read: number, load: Load) => {
    setAnswer({ read, load })
    onBusy(false)
    onChoose(load.kind === 'step' ? choiceOf(load.step, picked) : { account: null, finish: 'local-green' })
  })

  useEffect(() => {
    let active = true
    void (machine === undefined ? invoke('projects.connect.accounts', { root }) : invokeOn(machine, 'projects.connect.accounts', { root })).then((result) => {
      if (active) answered(reads, result.ok ? { kind: 'step', step: result.value } : { kind: 'error', reason: failureReason('projects.connect.accounts', result.error) })
    })
    return () => {
      active = false
    }
  }, [root, machine, reads])

  const load: Load | { kind: 'loading' } = answer === null || answer.read !== reads ? { kind: 'loading' } : answer.load
  const step = load.kind === 'step' ? load.step : null
  const chosen = step === null ? null : choiceOf(step, picked).account

  const pick = (login: string | null): void => {
    if (step === null || disabled) return
    setPicked(login)
    onChoose(githubChoice(step, login))
  }

  const again = (): void => {
    onBusy(true)
    setReads((count) => count + 1)
  }
  const busy = load.kind === 'loading'

  let content
  if (load.kind === 'loading') {
    content = (
      <p style={styles.secondary} data-testid="connect-github-loading">
        <span className="w-chip" style={styles.chipWorking}>
          Reading…
        </span>{' '}
        The accounts of gh and their access to origin
      </p>
    )
  } else if (load.kind === 'error' || step?.status === 'failed') {
    content = (
      <>
        <p role="alert" style={styles.error} data-testid="connect-github-error">
          {load.kind === 'error' ? load.reason : step?.status === 'failed' ? step.reason : ''}
        </p>
        <p style={styles.secondary}>Without the accounts the Project gets no account and the local finish.</p>
      </>
    )
  } else if (step?.status === 'no-origin') {
    content = (
      <>
        <p style={styles.secondary} data-testid="connect-github-no-origin">
          {step.reason}
        </p>
        <p style={styles.secondary}>No account is needed: Tickets close with the local finish.</p>
      </>
    )
  } else if (step?.status === 'no-gh') {
    content = (
      <>
        <p role="alert" style={styles.error} data-testid="connect-github-no-gh">
          {step.reason}
        </p>
        <p style={styles.secondary}>The Project can be connected without an account, with the local finish.</p>
      </>
    )
  } else if (step?.status === 'accounts') {
    const name = `connect-github-${root}`
    const hosts = [...new Set(step.repos.map((repo) => repo.host))].join(', ')
    content = (
      <>
        <p style={styles.secondary}>
          origin: <span style={styles.mono}>{step.repos.map((repo) => repo.slug).join(', ')}</span>
          {step.skipped.length > 0 ? ` · without a GitHub origin: ${step.skipped.join(', ')}` : ''}
        </p>
        <div role="radiogroup" aria-label="GitHub account" style={styles.list}>
          {step.accounts.length === 0 ? (
            <p style={styles.secondary} data-testid="connect-github-empty">
              {remote ? `gh on ${machineName ?? 'that Machine'} has no account for ${hosts}. Sign in with gh there, or connect without an account.` : `gh has no account for ${hosts}. Sign in with gh, or connect without an account.`}
            </p>
          ) : null}
          {step.accounts.map((account) => (
            <label key={`${account.host} ${account.login}`} style={{ ...styles.row, ...(chosen === account.login ? styles.rowOn : {}) }} data-testid="connect-github-account" data-login={account.login}>
              <input type="radio" name={name} checked={chosen === account.login} disabled={disabled} onChange={() => pick(account.login)} />
              <span style={styles.rowText}>
                <span style={styles.login}>
                  <span style={styles.mono}>{account.login}</span>
                  {account.active ? (
                    <span className="w-chip" style={styles.chipNeutral}>
                      active
                    </span>
                  ) : null}
                  {account.state !== 'success' ? (
                    <span className="w-chip" style={styles.chipBlocked}>
                      {account.state || 'unknown state'}
                    </span>
                  ) : null}
                  {step.repos.some((repo) => repo.host !== account.host) || account.host !== 'github.com' ? <span style={styles.detail}>{account.host}</span> : null}
                </span>
                {account.push ? (
                  <span style={styles.detail}>Can push: Tickets finish with a PR and green CI</span>
                ) : (
                  <span style={styles.detailBlocked} data-testid="connect-github-reason">
                    {account.reason}
                  </span>
                )}
              </span>
            </label>
          ))}
          <label style={{ ...styles.row, ...(chosen === null ? styles.rowOn : {}) }} data-testid="connect-github-none">
            <input type="radio" name={name} checked={chosen === null} disabled={disabled} onChange={() => pick(null)} />
            <span style={styles.rowText}>
              <span style={styles.login}>No account</span>
              <span style={styles.detail}>gh runs as its active account; Tickets close with the local finish</span>
            </span>
          </label>
        </div>
      </>
    )
  }

  return (
    <section style={styles.section} aria-label="GitHub account" data-testid="connect-github">
      <h3 style={styles.title}>GitHub account</h3>
      {content}
      {step?.status === 'no-origin' ? null : (
        <div style={styles.actions}>
          {remote ? (
            <span style={styles.detail} data-testid="connect-github-remote">
              To sign in with gh, run gh auth login on {machineName ?? 'that Machine'} itself, then Check again.
            </span>
          ) : step?.status === 'no-gh' ? (
            <button type="button" className="w-action" onClick={onFirstRun}>
              First-run checks…
            </button>
          ) : (
            <button
              type="button"
              className="w-action"
              disabled={busy || disabled || signIn !== null}
              title="Runs gh auth login in a terminal here; you answer gh yourself"
              onClick={() => setSignIn(crypto.randomUUID())}
            >
              Sign in with gh
            </button>
          )}
          <button type="button" className="w-action" disabled={busy || disabled} onClick={again}>
            Check again
          </button>
        </div>
      )}
      {signIn !== null && !remote ? (
        <SignInTerminal
          key={signIn}
          signInId={signIn}
          onExit={again}
          onClose={() => {
            setSignIn(null)
          }}
        />
      ) : null}
    </section>
  )
}

type SignInStatus = { state: 'starting' } | { state: 'running' } | { state: 'exited'; exitCode: number } | { state: 'failed'; message: string }

/** `gh auth login` in main's pseudo-terminal: its output, the user's keys, its exit. */
function SignInTerminal({ signInId, onExit, onClose }: { signInId: string; onExit: () => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<SignInStatus>({ state: 'starting' })
  const exited = useEffectEvent(() => onExit())

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const token = (name: string): string => getComputedStyle(element).getPropertyValue(name).trim()
    // The terminal colours of the current appearance, from the tokens of design F, as a Terminal Node has them.
    const theme = () => ({ background: token('--terminal-bg'), foreground: token('--terminal-text'), cursor: token('--terminal-text'), cursorAccent: token('--terminal-bg') })
    const terminal = new Terminal({ fontFamily: token('--font-mono') || 'monospace', fontSize: 12, cursorBlink: true, scrollback: 1000, theme: theme() })
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (): void => {
      terminal.options.theme = theme()
    }
    scheme.addEventListener('change', onScheme)
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    const size = fit.proposeDimensions()
    if (size !== undefined && Number.isFinite(size.cols) && Number.isFinite(size.rows) && size.cols > 0 && size.rows > 0) terminal.resize(size.cols, size.rows)

    let active = true
    let attached = false
    let written = 0
    const queued: { data: string; end: number }[] = []
    const write = (chunk: string, end: number): void => {
      if (end <= written) return
      const start = end - chunk.length
      terminal.write(start < written ? chunk.slice(written - start) : chunk)
      written = end
    }
    const finish = (exitCode: number): void => {
      attached = false
      setStatus({ state: 'exited', exitCode })
      exited()
    }
    const offOutput = subscribe('projects.connect.signInOutput', (payload) => {
      if (payload.signInId !== signInId) return
      if (attached) write(payload.data, payload.end)
      else queued.push(payload)
    })
    const offExit = subscribe('projects.connect.signInExit', (payload) => {
      if (payload.signInId === signInId && active) finish(payload.exitCode)
    })
    const typed = terminal.onData((data) => {
      if (attached) void invoke('projects.connect.signInInput', { signInId, data })
    })
    const resized = terminal.onResize(({ cols, rows }) => {
      if (attached) void invoke('projects.connect.signInResize', { signInId, cols, rows })
    })
    void invoke('projects.connect.signIn', { signInId, cols: terminal.cols, rows: terminal.rows }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setStatus({ state: 'failed', message: failureReason('projects.connect.signIn', result.error) })
        return
      }
      const { replay, end, exited: ended } = result.value
      if (replay !== '') terminal.write(replay)
      written = end
      if (ended !== null) {
        finish(ended.exitCode)
        return
      }
      attached = true
      for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
      setStatus({ state: 'running' })
      terminal.focus()
    })
    return () => {
      active = false
      scheme.removeEventListener('change', onScheme)
      offOutput()
      offExit()
      typed.dispose()
      resized.dispose()
      terminal.dispose()
      void invoke('projects.connect.signInClose', { signInId })
    }
  }, [signInId])

  const label =
    status.state === 'starting'
      ? 'Starting…'
      : status.state === 'running'
        ? 'Running: answer gh here'
        : status.state === 'exited'
          ? `gh exited (${String(status.exitCode)}); the accounts were read again`
          : status.message
  return (
    <div style={styles.terminalBox} data-testid="connect-signin" data-state={status.state}>
      <div style={styles.terminalHead}>
        <span style={{ ...styles.mono, fontWeight: 600 }}>gh auth login</span>
        <span style={{ flex: 1, minWidth: 0 }} role={status.state === 'failed' ? 'alert' : 'status'} data-testid="connect-signin-status">
          {label}
        </span>
        <button type="button" className="w-action" onClick={onClose}>
          {status.state === 'running' ? 'Stop' : 'Close'}
        </button>
      </div>
      <div ref={host} style={styles.terminalHost} data-testid="connect-signin-terminal" />
    </div>
  )
}
