// The Start Autopilot window inside worfy (worfy-autopilot-queue ticket 09, owner's decisions 10, 11, 13
// and 15 of the spec; prototype Card card-918c77d9, views "Canvas button" and "Orchestrator busy"). It
// stands where the Autopilot button used to start a run at once: the button asks through askStart
// (start-modal.ts) and the window shows over everything, as the windows of a Linked machine do
// (machines/ChangeAddressDialog.tsx: a portal, role="dialog", aria-modal, Esc).
//
// - The facts come from main (`autopilot.prepare`): the Project, the Epic, its Tickets and Waves left,
//   the Orchestrator's Vendor and Session, the forecast against the budget, the Limits now and whether
//   the Orchestrator is busy. The Modes (Eco mode, Auto-approval, Auto-continue) are read as the Modes
//   menu reads them and are shown only; "change in Modes" closes the window and opens that menu. Facts
//   that cannot be read say so in the window; the start still works: main checks it again anyway.
// - Mode: Fastest, Budget-aware and Start window, the default of Settings → Autopilot marked
//   "(default)" and chosen; under them a line on the chosen mode, with its forecast line when main has
//   one (the recommendation, the Fastest warning, the Start window line of the autopilot_start dialog).
// - The Orchestrator busy (a turn, queued messages, background tasks): a notice in the blocked colours,
//   and the main button is "Start when free" — the run is accepted and waits for it (ticket 07).
// - Keys: the focus is on Cancel when the window opens, Tab and Shift+Tab go round the window's
//   controls only, Esc is Cancel, ⌘↩ (Ctrl+Enter off macOS) starts. A click outside does nothing: a
//   start is not asked about by accident.
// - The start goes to main with the chosen mode; the window closes once main answers — started,
//   waiting for the Orchestrator, or refused (the refusal is a toast, as before, and the button's reason).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ticketNumber } from '../../shared/actions/render-template'
import { duration } from '../../shared/autopilot/limits-estimate'
import { hourText, RUN_MODE_LABELS, RUN_MODES, type RunMode } from '../../shared/autopilot/run-mode'
import { shareRangeText } from '../../shared/autopilot/share-percent'
import { autopilotPrepareAnswerSchema, type AutopilotPrepareAnswer } from '../../shared/ipc/autopilot-prepare'
import { failureReason } from '../../shared/ipc/channels'
import { autopilotRunOf } from '../../shared/settings/app-settings'
import { vendorLabel } from '../../shared/vendors/vendor'
import { invoke, readableReason } from '../ipc'
import { isMac, isPrimary } from '../platform'
import { AUTO_APPROVAL_LABELS, AUTO_APPROVAL_TITLES, useAutoApproval } from '../session/modes/auto-approval'
import { useAutoContinue } from '../session/modes/auto-continue'
import { useEcoMode } from '../session/modes/eco-mode'
import { focusablesOf } from '../settings/settings-window'
import { useAppSettings } from '../settings/useAppSettings'
import { openOrchestratorModes, useStartModal, type OpenStart } from './start-modal'
import './autopilot-modal.css'

/** The line under the modes when main has no forecast line for the chosen one. */
const MODE_HINTS: Readonly<Record<RunMode, string>> = {
  fastest: 'Waves go one after another: no budget, no window.',
  'budget-aware': 'The daily budget of the Limits, with the reserve.',
  'start-window': 'New Waves start only inside the window; the daily budget too, when it is on.',
}

/** The words of the notice while the Orchestrator is busy, as the prototype has them. */
function busyText(busy: NonNullable<AutopilotPrepareAnswer['busy']>): string {
  const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
  const parts = [
    ...(busy.turn ? ['a turn is running'] : []),
    ...(busy.queued > 0 ? [count(busy.queued, 'queued message')] : []),
    ...(busy.tasks.length > 0 ? [count(busy.tasks.length, 'background task')] : []),
  ]
  return `${parts.join(' · ')}. Autopilot will wait and start when it is free.`
}

/**
 * The forecast line of the dialog for `mode`, without its trailing dot: "Budget-aware: …" and
 * "Fastest: …" lose their label, the Start window line stays whole; null when main has none.
 */
function modeLine(lines: readonly string[], mode: RunMode): string | null {
  const strip = (line: string): string => line.replace(/\.$/u, '')
  if (mode === 'start-window') {
    const line = lines.find((each) => each.startsWith('Start window '))
    return line === undefined ? null : strip(line)
  }
  const label = `${RUN_MODE_LABELS[mode]}: `
  const line = lines.find((each) => each.startsWith(label))
  return line === undefined ? null : strip(line.slice(label.length))
}

/** The most Ticket numbers the Tickets row lists; the rest are counted. */
const TICKETS_SHOWN = 12

function ticketsText(tickets: readonly number[]): string {
  const shown = tickets.slice(0, TICKETS_SHOWN).map(ticketNumber).join(', ')
  return tickets.length > TICKETS_SHOWN ? `${shown} +${tickets.length - TICKETS_SHOWN} more` : shown
}

type Facts = { kind: 'reading' } | { kind: 'read'; answer: AutopilotPrepareAnswer } | { kind: 'failed'; reason: string }

/** The facts of `open`, asked once. */
function useFacts(open: OpenStart): Facts {
  const [facts, setFacts] = useState<Facts>({ kind: 'reading' })
  const { projectId, epics, tickets } = open
  useEffect(() => {
    let active = true
    void invoke('autopilot.prepare', { projectId, epics: [...epics], ...(tickets === undefined ? {} : { tickets: [...tickets] }) }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setFacts({ kind: 'failed', reason: readableReason(failureReason('autopilot.prepare', result.error)) })
        return
      }
      const parsed = autopilotPrepareAnswerSchema.safeParse(result.value)
      setFacts(parsed.success ? { kind: 'read', answer: parsed.data } : { kind: 'failed', reason: 'the answer of worfy could not be read' })
    })
    return () => {
      active = false
    }
  }, [projectId, epics, tickets])
  return facts
}

function Fact({ name, testId, children }: { name: string; testId: string; children: ReactNode }) {
  return (
    <>
      <dt>{name}</dt>
      <dd data-testid={testId}>{children}</dd>
    </>
  )
}

/** A Mode chip: on in the ready colours, off neutral, `…` while it is read. */
function Chip({ label, on, title }: { label: string; on: boolean | null; title: string }) {
  return (
    <span className={`w-apstart__chip${on === true ? ' w-apstart__chip--on' : ''}`} title={title} data-on={on === null ? undefined : String(on)}>
      <span className="w-apstart__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

function ModesFact({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const eco = useEcoMode(projectId)
  const auto = useAutoApproval(projectId)
  const cont = useAutoContinue(projectId)
  // `…` while a mode is read, `—` when it could not be (its tooltip says why).
  const unknown = (reading: boolean): string => (reading ? '…' : '—')
  const word = (on: boolean | null, reading: boolean): string => (on === null ? unknown(reading) : on ? 'on' : 'off')
  return (
    <Fact name="Modes" testId="start-autopilot-modes">
      <Chip label={`Eco ${word(eco.on, eco.reading)}`} on={eco.on} title={eco.unavailable ?? eco.title} />
      <Chip label={`Auto-approval ${auto.mode === null ? unknown(auto.reading) : AUTO_APPROVAL_LABELS[auto.mode]}`} on={auto.mode === null ? null : auto.mode !== 'off'} title={auto.unavailable ?? (auto.mode === null ? 'Auto-approval' : AUTO_APPROVAL_TITLES[auto.mode])} />
      <Chip label={`Auto-continue ${word(cont.on, cont.reading)}`} on={cont.on} title={cont.unavailable ?? cont.title} />
      <button type="button" className="w-apstart__link" data-testid="start-autopilot-change-modes" onClick={onChange}>
        change in Modes
      </button>
    </Fact>
  )
}

function FactsGrid({ facts, open, onChangeModes }: { facts: Facts; open: OpenStart; onChangeModes: () => void }) {
  const answer = facts.kind === 'read' ? facts.answer : null
  const pending = <span className="w-apstart__muted">{facts.kind === 'reading' ? '…' : '—'}</span>
  const epics = answer?.epics ?? open.epics.map((epic) => ({ epic, tickets: [], waves: 0, accepted: null }))
  const forecast = answer?.forecast
  const used = answer?.limits.utilization ?? null
  const usedPercent = used === null ? null : Math.min(100, Math.max(0, Math.round(used * 100)))
  return (
    <dl className="w-apstart__grid" data-testid="start-autopilot-facts">
      <Fact name="Project" testId="start-autopilot-project">
        {answer?.project.name ?? pending}
      </Fact>
      {epics.map((each) => (
        <Fact key={each.epic} name={epics.length === 1 ? 'Epic' : `Epic ${epics.indexOf(each) + 1}`} testId="start-autopilot-epic">
          <span className="w-mono">{each.epic}</span>
        </Fact>
      ))}
      {epics.length === 1 ? (
        <Fact name="Tickets" testId="start-autopilot-tickets">
          {answer === null ? (
            pending
          ) : (
            <>
              <span className="w-mono">{ticketsText(epics[0]?.tickets ?? [])}</span>
              <span className="w-apstart__muted">
                · {epics[0]?.waves ?? 0} {(epics[0]?.waves ?? 0) === 1 ? 'Wave' : 'Waves'} left
              </span>
            </>
          )}
        </Fact>
      ) : null}
      <div className="w-apstart__sep" role="presentation" />
      <Fact name="Orchestrator" testId="start-autopilot-orchestrator">
        {answer === null ? (
          pending
        ) : (
          <>
            {vendorLabel(answer.orchestrator.vendor)}
            <span className="w-apstart__muted">
              vendor · {answer.orchestrator.session === null ? 'no Session yet' : <span className="w-mono">Session {answer.orchestrator.session.slice(0, 8)}</span>}
            </span>
          </>
        )}
      </Fact>
      <Fact name="Forecast" testId="start-autopilot-forecast">
        {forecast === undefined ? (
          pending
        ) : forecast.range === null && forecast.duration === null ? (
          <span className="w-apstart__muted" title={forecast.lines.join('\n')}>
            Not enough data for a forecast
          </span>
        ) : (
          <span className="w-apstart__forecast" title={forecast.lines.join('\n')}>
            {forecast.duration === null ? null : <span className="w-mono">≈ {duration(forecast.duration)}</span>}
            {forecast.duration !== null && forecast.range !== null ? <span className="w-apstart__muted">·</span> : null}
            {forecast.range === null ? null : <span>usually {shareRangeText(forecast.range)} of the week</span>}
            {answer?.budget.enabled === true ? <span className="w-apstart__muted">· reserve {Math.round(answer.budget.reserve * 100)}%</span> : null}
          </span>
        )}
      </Fact>
      <Fact name="Limits now" testId="start-autopilot-limits">
        {answer === null ? (
          pending
        ) : (
          <>
            {usedPercent === null ? null : (
              <span className="w-apstart__meter" role="img" aria-label={`${usedPercent}% of the week used`}>
                <i style={{ width: `${usedPercent}%` }} />
              </span>
            )}
            <span>{answer.limits.text}</span>
          </>
        )}
      </Fact>
      <ModesFact projectId={open.projectId} onChange={onChangeModes} />
    </dl>
  )
}

function StartWindow({ open }: { open: OpenStart }) {
  const facts = useFacts(open)
  const answer = facts.kind === 'read' ? facts.answer : null
  const settingsMode = useAppSettings((settings) => autopilotRunOf(settings).mode)
  const windowFrom = useAppSettings((settings) => autopilotRunOf(settings).window.from)
  const windowTo = useAppSettings((settings) => autopilotRunOf(settings).window.to)
  const defaultMode = answer?.mode ?? settingsMode
  const [picked, setPicked] = useState<RunMode | null>(null)
  const mode = picked ?? defaultMode
  const [starting, setStarting] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const busy = answer?.busy ?? null
  const hours = answer?.window ?? { from: windowFrom, to: windowTo }

  const cancel = (): void => {
    if (!starting) open.settle(undefined)
  }
  const start = (): void => {
    if (starting) return
    setStarting(true)
    void open.start(mode).then(
      (reason) => open.settle(reason),
      (error: unknown) => open.settle(error instanceof Error ? error.message : String(error)),
    )
  }
  const changeModes = (): void => {
    if (starting) return
    open.settle(undefined)
    openOrchestratorModes(open.projectId)
  }
  // The newest handlers for the key listener, which is added once.
  const keys = useRef({ cancel, start })
  useLayoutEffect(() => {
    keys.current = { cancel, start }
  })

  // The focus goes to Cancel, so Enter right after opening starts nothing; it goes back where it was
  // when the window closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButton.current?.focus()
    return () => {
      if (before?.isConnected === true) before.focus({ preventScroll: true })
    }
  }, [])

  // On `window` in the capture phase: before the Canvas's and focus mode's own keys. Esc, ⌘↩ and Tab
  // are the window's while it is open, wherever the focus is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const dialog = frame.current
      if (dialog === null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        keys.current.cancel()
      } else if (event.key === 'Enter' && isPrimary(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        keys.current.start()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const focusable = focusablesOf(dialog)
        if (focusable.length === 0) return
        const at = focusable.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? (event.shiftKey ? focusable.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
        focusable[next]?.focus()
      }
    }
    // Focus that lands behind the window (a click on the backdrop) comes back to it.
    const keep = (event: FocusEvent): void => {
      const dialog = frame.current
      if (dialog === null || (event.target instanceof Node && dialog.contains(event.target))) return
      cancelButton.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', keep)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', keep)
    }
  }, [])

  const hint = [MODE_HINTS[mode], ...(answer === null ? [] : [modeLine(answer.forecast.lines, mode)])].filter((line): line is string => line !== null).join(' ')
  const label = busy === null ? 'Start Autopilot' : 'Start when free'
  return createPortal(
    <div className="w-apstart-backdrop">
      <div ref={frame} className="w-apstart" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="start-autopilot" data-busy={busy === null ? undefined : ''} data-facts={facts.kind}>
        <div className="w-apstart__head">
          <h2 id={titleId}>Start Autopilot</h2>
          <div className="w-apstart__asked">From the Autopilot button on the Canvas</div>
        </div>
        <div className="w-apstart__body">
          {busy === null ? null : (
            <div className="w-apstart__notice" role="status" data-testid="start-autopilot-busy">
              <p>
                <span className="w-apstart__notice-title">The Orchestrator is busy:</span> {busyText(busy)}
              </p>
              {busy.tasks.length === 0 ? null : (
                <p className="w-apstart__notice-sub">
                  Background tasks: <span className="w-mono">{busy.tasks.map((task) => task.description ?? task.id).join(', ')}</span>
                </p>
              )}
            </div>
          )}
          {facts.kind === 'failed' ? (
            <p className="w-apstart__error" role="alert" data-testid="start-autopilot-error">
              Could not read the facts of this start: {facts.reason}
            </p>
          ) : null}
          <FactsGrid facts={facts} open={open} onChangeModes={changeModes} />
          <div className="w-apstart__section">
            <h3>Mode</h3>
            <div className="w-apstart__modes" role="radiogroup" aria-label="Mode">
              {RUN_MODES.map((each) => (
                <button
                  key={each}
                  type="button"
                  role="radio"
                  aria-checked={mode === each}
                  data-testid={`start-autopilot-mode-${each}`}
                  onClick={() => setPicked(each)}
                >
                  {RUN_MODE_LABELS[each]}
                  {each === 'start-window' ? ` (${hourText(hours.from)}–${hourText(hours.to)})` : ''}
                  {each === defaultMode ? <span className="w-apstart__muted"> (default)</span> : null}
                </button>
              ))}
            </div>
            <div className="w-apstart__mode-hint" data-testid="start-autopilot-mode-hint">
              {hint}
            </div>
          </div>
        </div>
        <div className="w-apstart__foot">
          <span className="w-apstart__keys" aria-hidden="true">
            <kbd>esc</kbd> Cancel · <kbd>tab</kbd> next · <kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd>
            <kbd>↩</kbd> Start
          </span>
          <button ref={cancelButton} type="button" className="w-apstart__button" data-testid="start-autopilot-cancel" disabled={starting} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="w-apstart__button w-apstart__button--primary"
            data-testid="start-autopilot-start"
            aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}
            disabled={starting}
            onClick={start}
          >
            {label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The window of the start asked for, if any; mounted once, in the shell. */
export function StartAutopilotModal() {
  const open = useStartModal((store) => store.open)
  return open === null ? null : <StartWindow key={open.id} open={open} />
}
