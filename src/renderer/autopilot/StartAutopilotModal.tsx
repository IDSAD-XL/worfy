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
// - An agent's `autopilot_start` (worfy-autopilot-queue ticket 11, view "Agent asks"): main asks one
//   window of its Machine (`autopilot.confirm.ask`, start-modal.ts). Under the title — «Asked by Session
//   "<id>" in a chat · answer within 9:59», counted down to main's deadline, the last minute in the
//   blocked colours. The choice goes back to main, which starts the run; Cancel, Esc and "change in
//   Modes" answer `cancel`. Time up (the countdown at 0:00, or main's `autopilot.confirm.close`): «time
//   is up — the Session got "declined"», every control off, and the window closes after TIME_UP_CLOSE_MS.
//   The facts of such an ask are read on this Machine, whichever Machine the window shows.
// - The "Queue" view (worfy-autopilot-queue ticket 16): "Run all accepted" of the Command palette, and an
//   agent's ask with a list of Epics. The title counts the ticked Epics and their Waves ("Start Autopilot ·
//   3 Epics, 6 Waves"); under it "N Epics are accepted and waiting…" (or the agent's "Asked by …"); the
//   grid leaves the Epic and its Tickets out, and below it the queue (QueueList.tsx) shows each Epic with
//   its Waves and acceptance date. The facts are asked again for the ticked Epics in their order whenever
//   they change, so the forecast is theirs; the last facts stay on screen while the next are read. Nothing
//   ticked: the start is off. The start goes with the ticked Epics in the order of the list — for an
//   agent's ask, as the answer to main, which starts over exactly those.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ticketNumber } from '../../shared/actions/render-template'
import { duration } from '../../shared/autopilot/limits-estimate'
import { hourText, RUN_MODE_LABELS, RUN_MODES, type RunMode } from '../../shared/autopilot/run-mode'
import { shareRangeText } from '../../shared/autopilot/share-percent'
import { autopilotPrepareAnswerSchema, type AutopilotPrepareAnswer } from '../../shared/ipc/autopilot-prepare'
import { failureReason } from '../../shared/ipc/channels'
import { autopilotRunOf } from '../../shared/settings/app-settings'
import { vendorLabel } from '../../shared/vendors/vendor'
import { hasPreloadBridge, invoke, invokeOn, readableReason, subscribe } from '../ipc'
import { isMac, isPrimary } from '../platform'
import { AUTO_APPROVAL_LABELS, AUTO_APPROVAL_TITLES, useAutoApproval } from '../session/modes/auto-approval'
import { useAutoContinue } from '../session/modes/auto-continue'
import { useEcoMode } from '../session/modes/eco-mode'
import { focusablesOf } from '../settings/settings-window'
import { useAppSettings } from '../settings/useAppSettings'
import { QueueList, type QueueFacts, type QueueRow } from './QueueList'
import { agentTimeUp, askFromAgent, openOrchestratorModes, useStartModal, type OpenStart } from './start-modal'
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

const wavesCount = (waves: number): string => `${waves} ${waves === 1 ? 'Wave' : 'Waves'}`

/** The most Ticket numbers the Tickets row lists; the rest are counted. */
const TICKETS_SHOWN = 12

function ticketsText(tickets: readonly number[]): string {
  const shown = tickets.slice(0, TICKETS_SHOWN).map(ticketNumber).join(', ')
  return tickets.length > TICKETS_SHOWN ? `${shown} +${tickets.length - TICKETS_SHOWN} more` : shown
}

/** How long the window of an agent's ask stays after its time is up, saying so, before it closes. */
export const TIME_UP_CLOSE_MS = 4000

/** The Session's name as the window gives it: the first 8 characters of its id, as the Session Nodes do. */
const sessionName = (session: string): string => session.slice(0, 8)

/** Seconds as m:ss ("9:59"). */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** The whole seconds left until `deadline` (Date.now() time), counted down once a second; never below 0. */
function useSecondsLeft(deadline: number | null): number | null {
  const left = (): number | null => (deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
  const [seconds, setSeconds] = useState(left)
  useEffect(() => {
    if (deadline === null) return
    const timer = setInterval(() => {
      const now = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSeconds(now)
      if (now === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [deadline])
  return seconds
}

/** The line under the title: where the ask comes from, and for an agent's the time left. */
function AskedLine({ open, seconds, timeUp }: { open: OpenStart; seconds: number | null; timeUp: boolean }) {
  if (open.from === 'accepted') {
    const count = open.epics.length
    return (
      <div className="w-apstart__asked" data-testid="start-autopilot-accepted">
        {count === 1 ? '1 Epic is' : `${count} Epics are`} accepted and waiting. Autopilot runs them one after another.
      </div>
    )
  }
  if (open.agent === undefined) return <div className="w-apstart__asked">From the Autopilot button on the Canvas</div>
  const session = <b>"{sessionName(open.agent.session)}"</b>
  if (timeUp) {
    return (
      <div className="w-apstart__asked" data-testid="start-autopilot-asked">
        Asked by Session {session} · <span className="w-apstart__count w-apstart__count--late">time is up — the Session got "declined"</span>
      </div>
    )
  }
  const late = seconds !== null && seconds <= 60
  return (
    <div className="w-apstart__asked" data-testid="start-autopilot-asked">
      Asked by Session {session} in a chat · answer within{' '}
      <span className={`w-apstart__count${late ? ' w-apstart__count--late' : ''}`} data-testid="start-autopilot-countdown" data-late={late ? '' : undefined}>
        {clock(seconds ?? 0)}
      </span>
    </div>
  )
}

/** The facts of the window: the last answer of main stays while the next is read. */
type Facts = { kind: 'reading'; answer: AutopilotPrepareAnswer | null } | { kind: 'read'; answer: AutopilotPrepareAnswer } | { kind: 'failed'; reason: string; answer: null }

/**
 * The facts of `open` for `epics` (the ticked Epics of a queue, in order), asked again whenever they
 * change; with none, the last facts stay. `known` keeps what main said of every Epic asked so far.
 */
function useFacts(open: OpenStart, epics: readonly string[]): { facts: Facts; known: Readonly<Record<string, QueueFacts>> } {
  // The last facts main answered, with the Epics they were asked for.
  const [last, setLast] = useState<{ key: string; facts: Facts } | null>(null)
  const [known, setKnown] = useState<Readonly<Record<string, QueueFacts>>>({})
  const { projectId, tickets } = open
  // An agent's ask is about a Project of this Machine, whichever Machine the window shows.
  const local = open.from === 'agent'
  const key = epics.join('\n')
  useEffect(() => {
    if (key === '') return
    let active = true
    const input = { projectId, epics: key.split('\n'), ...(tickets === undefined ? {} : { tickets: [...tickets] }) }
    void (local ? invokeOn(null, 'autopilot.prepare', input) : invoke('autopilot.prepare', input)).then((result) => {
      if (!active) return
      if (!result.ok) {
        setLast({ key, facts: { kind: 'failed', reason: readableReason(failureReason('autopilot.prepare', result.error)), answer: null } })
        return
      }
      const parsed = autopilotPrepareAnswerSchema.safeParse(result.value)
      if (!parsed.success) {
        setLast({ key, facts: { kind: 'failed', reason: 'the answer of worfy could not be read', answer: null } })
        return
      }
      setLast({ key, facts: { kind: 'read', answer: parsed.data } })
      setKnown((now) => ({ ...now, ...Object.fromEntries(parsed.data.epics.map((each) => [each.epic, { waves: each.waves, accepted: each.accepted }])) }))
    })
    return () => {
      active = false
    }
  }, [projectId, key, tickets, local])
  // Facts of other Epics than those ticked now: the next are being read, the last stay on screen.
  const facts: Facts = last === null ? { kind: 'reading', answer: null } : last.key === key || key === '' ? last.facts : { kind: 'reading', answer: last.facts.answer }
  return { facts, known }
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

function ModesFact({ projectId, onChange, off }: { projectId: string; onChange: () => void; off: boolean }) {
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
      <button type="button" className="w-apstart__link" data-testid="start-autopilot-change-modes" disabled={off} onClick={onChange}>
        change in Modes
      </button>
    </Fact>
  )
}

function FactsGrid({ facts, open, queue, empty, onChangeModes, off }: { facts: Facts; open: OpenStart; queue: boolean; empty: boolean; onChangeModes: () => void; off: boolean }) {
  const answer = facts.answer
  const pending = <span className="w-apstart__muted">{facts.kind === 'reading' ? '…' : '—'}</span>
  // The queue view lists its Epics in the queue below, not here.
  const epics = queue ? [] : (answer?.epics ?? open.epics.map((epic) => ({ epic, tickets: [], waves: 0, accepted: null })))
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
                · {wavesCount(epics[0]?.waves ?? 0)} left
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
        {empty ? (
          <span className="w-apstart__muted">No Epic is ticked</span>
        ) : forecast === undefined ? (
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
      <ModesFact projectId={open.projectId} onChange={onChangeModes} off={off} />
    </dl>
  )
}

function StartWindow({ open }: { open: OpenStart }) {
  const queue = open.from === 'accepted' || open.epics.length > 1
  const [rows, setRows] = useState<QueueRow[]>(() => open.epics.map((epic) => ({ epic, on: true })))
  // The queue of the run: the ticked Epics, in the order of the list.
  const ticked = useMemo(() => rows.filter((row) => row.on).map((row) => row.epic), [rows])
  const { facts, known } = useFacts(open, ticked)
  const answer = facts.answer
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
  const seconds = useSecondsLeft(open.agent?.deadline ?? null)
  // An agent's ask whose time is up, here or in main: nothing can be chosen any more.
  const timeUp = open.agent !== undefined && (open.timeUp === true || seconds === 0)
  const off = starting || timeUp
  const empty = ticked.length === 0
  const tickedWaves = ticked.map((epic) => known[epic]?.waves)

  const cancel = (): void => {
    if (off) return
    open.cancel?.()
    open.settle(undefined)
  }
  const start = (): void => {
    if (off || empty) return
    setStarting(true)
    void open.start(mode, ticked).then(
      (reason) => open.settle(reason),
      (error: unknown) => open.settle(error instanceof Error ? error.message : String(error)),
    )
  }
  const changeModes = (): void => {
    if (off) return
    open.cancel?.()
    open.settle(undefined)
    openOrchestratorModes(open.projectId)
  }
  // The newest handlers for the key listener, which is added once.
  const keys = useRef({ cancel, start })
  useLayoutEffect(() => {
    keys.current = { cancel, start }
  })

  const { settle } = open
  // Time up: the window says so for a while, then closes; main has answered the Session already.
  useEffect(() => {
    if (!timeUp) return
    const timer = setTimeout(() => settle(undefined), TIME_UP_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [timeUp, settle])

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
      <div
        ref={frame}
        className="w-apstart"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="start-autopilot"
        data-from={open.from}
        data-busy={busy === null ? undefined : ''}
        data-facts={facts.kind}
        data-time-up={timeUp ? '' : undefined}
      >
        <div className="w-apstart__head">
          <h2 id={titleId}>
            Start Autopilot
            {queue ? (
              <span className="w-apstart__count-line" data-testid="start-autopilot-queue-count">
                {' '}
                · {ticked.length} {ticked.length === 1 ? 'Epic' : 'Epics'}
                {tickedWaves.every((waves) => waves !== undefined) ? `, ${wavesCount(tickedWaves.reduce<number>((sum, waves) => sum + (waves ?? 0), 0))}` : null}
              </span>
            ) : null}
          </h2>
          <AskedLine open={open} seconds={seconds} timeUp={timeUp} />
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
          <FactsGrid facts={facts} open={open} queue={queue} empty={empty} onChangeModes={changeModes} off={off} />
          {queue ? (
            <div className="w-apstart__section">
              <h3>
                Queue{' '}
                <span className="w-apstart__queue-hint" data-testid="start-autopilot-queue-hint">
                  {open.from === 'agent' ? 'In the order the Session asked' : open.from === 'accepted' ? 'Ordered by acceptance date' : 'In the order asked'} · drag to reorder, untick to drop
                </span>
              </h3>
              <QueueList rows={rows} facts={known} onChange={setRows} off={off} />
            </div>
          ) : null}
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
                  disabled={timeUp}
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
          <button ref={cancelButton} type="button" className="w-apstart__button" data-testid="start-autopilot-cancel" disabled={off} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="w-apstart__button w-apstart__button--primary"
            data-testid="start-autopilot-start"
            aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}
            disabled={off || empty}
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

/** The window of the start asked for, if any; mounted once, in the shell. It also listens for main's asks of an agent's `autopilot_start`. */
export function StartAutopilotModal() {
  const open = useStartModal((store) => store.open)
  useEffect(() => {
    // Without the preload (a unit test of the shell that sets none) there is no main to ask.
    if (!hasPreloadBridge()) return
    const offAsk = subscribe('autopilot.confirm.ask', (ask) => askFromAgent(ask))
    const offClose = subscribe('autopilot.confirm.close', ({ id }) => agentTimeUp(id))
    return () => {
      offAsk()
      offClose()
    }
  }, [])
  return open === null ? null : <StartWindow key={open.id} open={open} />
}
