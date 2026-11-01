// The detail panel of the Run history screen (worfy-flight-recorder ticket 19; decision 05, p. 3, the prototype
// Card card-57714d55): the bottom of the screen, about the span selected on the timeline or in the summary.
//
// - Overview: kind, start, end, duration, self time, outcome, attempt, reason, the path in the tree.
// - Links: the PR and the commit open in the system's browser (`shell.openExternal`) at the page of the
//   Project's repository main found (RunView.repoUrl; without one they stay text); the transcript opens where
//   worfy already shows it — an agent's in the Subagent's view, the Orchestrator's in the Session view, both
//   read-only from the file; a Ticket selects its row.
// - Source: where the start and the end come from, and what limits the source: a lost source, its note
//   (a gate run from the green cache), GitHub that did not answer — with «Retry».
//
// «Retry» (`runs.retry`, ticket 17) reads gh at once; its answer is the new timeline, which replaces the one on
// screen, so «GitHub did not answer» goes once gh answers.
import { useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { type FactSource, type Span } from '../../shared/flight-recorder/spans'
import { selfTime } from '../../shared/flight-recorder/summary'
import type { RunView } from '../../shared/ipc/runs'
import { sessionNodeId } from '../claude-home/session-nodes'
import { invoke } from '../ipc'
import { openSession } from '../session/navigation'
import { firstWaveOf, formatDuration, formatLocal, revealSpan, selectSpan, useRunHistory } from './store'
import { displayName, lostWord, reasonText, spanDuration, tokenOf } from './span-words'

const two = (value: number): string => String(value).padStart(2, '0')
/** A moment to the second in local time: `01:29:32`. */
function clock(ms: number): string {
  const date = new Date(ms)
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}
const moment = (ms: number): string => `${formatLocal(ms)} · ${clock(ms)}`

const KIND_WORDS: Record<string, string> = {
  run: 'Run',
  wave: 'Wave',
  ticket: 'Ticket',
  stage: 'Stage',
  ci: 'CI run',
  gate: 'Gate run',
  script: 'Step',
  wait: 'Wait',
  'orchestrator-turn': 'Orchestrator turn',
}

/** The kind as Overview writes it: an agent with its subkind, a Stage with the Stages it covers, a Wait with its cause. */
function kindWords(span: Span): string {
  if (span.kind === 'agent') return span.subkind === 'other' || span.subkind === null ? 'Agent' : `Agent (${span.subkind})`
  if (span.kind === 'stage') return `Stage (${span.name})`
  if (span.kind === 'wait') return `Wait (${span.waitCause ?? span.name})`
  return KIND_WORDS[span.kind] ?? span.kind
}

const SOURCE_WORDS: Record<FactSource, string> = {
  journal: 'the Autopilot Journal',
  transcript: 'a transcript',
  github: 'GitHub',
  'gate-log': 'a gate log',
  'marks-file': 'the marks file of the Harness',
  git: 'git',
}

/** The rows from the Run down to the span, as the tree draws them: a Ticket under the Wave it started in. */
function pathOf(span: Span, spans: readonly Span[]): string[] {
  const byId = new Map(spans.map((each) => [each.id, each]))
  const names: string[] = []
  let at: Span | undefined = span
  while (at !== undefined) {
    names.unshift(displayName(at))
    if (at.kind === 'ticket') {
      const wave = firstWaveOf(at, spans)
      if (wave !== undefined) names.unshift(displayName(wave))
    }
    at = at.parent === null ? undefined : byId.get(at.parent)
  }
  return names
}

/**
 * «Retry» of each Run, shared by every button of the screen (the notice, the Source tab): one gh read of a
 * Run at a time, whichever button was pressed, and the last failure of the call per Run. Keyed by
 * `<projectId>\n<run>`, so a «Retry» still in flight for another Run neither disables nor fails this one.
 */
interface RetryState {
  running: ReadonlySet<string>
  errors: Readonly<Record<string, string>>
}

const useGithubRetry = create<RetryState>(() => ({ running: new Set(), errors: {} }))

const retryKey = (view: Pick<RunView, 'projectId' | 'run'>): string => `${view.projectId}\n${view.run}`

/**
 * Reads gh for the Run at once, unless a «Retry» of it is in flight; the answer replaces the timeline on
 * screen if the screen still shows that Run. A failed call is kept as the Run's error until its next «Retry».
 */
async function retryGithub(projectId: string, run: string): Promise<void> {
  const key = retryKey({ projectId, run })
  if (useGithubRetry.getState().running.has(key)) return
  useGithubRetry.setState((state) => {
    const errors = { ...state.errors }
    delete errors[key]
    return { running: new Set([...state.running, key]), errors }
  })
  let error: string | null = null
  try {
    const result = await invoke('runs.retry', { projectId, run })
    if (!result.ok) error = result.error
    else {
      const shown = useRunHistory.getState()
      if (shown.projectId === projectId && shown.run === run) useRunHistory.setState({ view: result.value })
    }
  } catch (reason) {
    error = String(reason)
  }
  useGithubRetry.setState((state) => {
    const running = new Set(state.running)
    running.delete(key)
    return { running, errors: error === null ? state.errors : { ...state.errors, [key]: error } }
  })
}

/** «Retry» next to «GitHub did not answer»; `withError` — the button that says when the call failed (the notice's). */
export function RetryButton({ view, withError = false }: { view: RunView; withError?: boolean }) {
  const key = retryKey(view)
  const running = useGithubRetry((state) => state.running.has(key))
  const error = useGithubRetry((state) => state.errors[key])
  return (
    <>
      <button type="button" className="w-fr-button" data-testid="run-history-retry-github" disabled={running} onClick={() => void retryGithub(view.projectId, view.run)}>
        {running ? 'Retrying…' : 'Retry'}
      </button>
      {withError && error !== undefined ? (
        <span className="w-fr-problem-text" data-testid="run-history-retry-error">
          {' '}
          Retry failed: {error}
        </span>
      ) : null}
    </>
  )
}

/** The line over the timeline while gh gives no answer for the Run. */
export function GithubNotice({ view }: { view: RunView }) {
  if (view.github.state !== 'no-answer') return null
  return (
    <div className="w-fr-notice w-fr-notice--github" role="status" data-testid="run-history-github">
      <span>
        GitHub did not answer: {view.github.reason}. The PR and CI bars are drawn from the local sources.
      </span>{' '}
      <RetryButton view={view} withError />
    </div>
  )
}

/** Opens a page of the repository in the system's browser; text only when main found no page. */
function RepoLink({ base, path, children, onError }: { base: string | null; path: string; children: ReactNode; onError: (error: string | null) => void }) {
  if (base === null)
    return (
      <span className="w-fr-link-off" title="No page of the repository: remote origin of the Project is not a repository on a GitHub host">
        {children}
      </span>
    )
  const url = `${base}/${path}`
  return (
    <button
      type="button"
      className="w-fr-link"
      title={url}
      onClick={() => {
        onError(null)
        void invoke('shell.openExternal', { url }).then((result) => {
          if (!result.ok) onError(`The page could not be opened: ${result.error}`)
        })
      }}
    >
      {children}
    </button>
  )
}

type Tab = 'overview' | 'links' | 'source'
const TABS: readonly [Tab, string][] = [
  ['overview', 'Overview'],
  ['links', 'Links'],
  ['source', 'Source'],
]

function Field({ name, id, children }: { name: string; id: string; children: ReactNode }) {
  return (
    <tr data-testid={`run-history-detail-${id}`}>
      <th scope="row">{name}</th>
      <td>{children}</td>
    </tr>
  )
}

function Overview({ span, view }: { span: Span; view: RunView }) {
  const { spans, live } = view.timeline
  const cause = span.retryOf === null ? undefined : spans.find((each) => each.id === span.retryOf)
  const parts = span.segments.length
  let end: ReactNode
  if (span.end === null) end = live ? 'not finished: the span goes on' : 'not finished'
  else if (span.outcome === 'cut-off') end = `${moment(span.end)} — cut off: the last event about it`
  else end = moment(span.end)
  const blocks = span.kind === 'ticket' ? view.timeline.blocks.filter((block) => block.ticket === span.links.ticket) : []
  return (
    <table className="w-fr-detail__table">
      <tbody>
        <Field name="Kind" id="kind">
          {kindWords(span)}
        </Field>
        <Field name="Start" id="start">
          {moment(span.start)}
        </Field>
        <Field name="End" id="end">
          {end}
        </Field>
        <Field name="Duration" id="duration">
          {formatDuration(spanDuration(span))}
          {parts > 1 ? ` in ${parts} parts` : ''}
        </Field>
        <Field name="Self time" id="self-time">
          {formatDuration(selfTime(span, view.timeline))} <span className="w-fr-muted">(the duration minus the spans inside it)</span>
        </Field>
        <Field name="Outcome" id="outcome">
          {span.outcome ?? (live && span.end === null ? 'running' : '—')}
        </Field>
        <Field name="Attempt" id="attempt">
          {span.attempt === 1 ? '1' : `#${span.attempt}`}
          {cause !== undefined ? (
            <>
              {' — retry of '}
              <button type="button" className="w-fr-link" onClick={() => revealSpan(cause.id)}>
                {displayName(cause)}
                {cause.attempt > 1 ? ` #${cause.attempt}` : ''}
              </button>
              {cause.outcome !== null ? ` (${cause.outcome})` : ''}
            </>
          ) : null}
        </Field>
        <Field name="Reason" id="reason">
          {reasonText(span) ?? '—'}
        </Field>
        <Field name="Path" id="path">
          {pathOf(span, spans).join(' › ')}
        </Field>
        {span.note !== null ? (
          <Field name="Note" id="note">
            {span.note}
          </Field>
        ) : null}
        {blocks.map((block, index) => (
          <Field key={index} name="Block" id="block">
            {`${clock(block.at)} — ${block.reason}${block.waits === null ? '' : ` · Waits: ${block.waits}`}${block.cleared ? ` · cleared at ${clock(block.until)}` : ''}`}
          </Field>
        ))}
      </tbody>
    </table>
  )
}

/** Where the transcript of a span opens: an agent in its Subagent's view, a turn or a Wave in the Orchestrator's Session. */
function transcriptOf(span: Span): { sessionId: string; agentId?: string; label: string } | null {
  const { session, agent } = span.links
  if (session === undefined) return null
  if (span.kind === 'agent') return agent === undefined ? null : { sessionId: session, agentId: agent, label: `The transcript of ${span.name}` }
  return { sessionId: session, label: "The Orchestrator's transcript" }
}

function Links({ span, view, onError }: { span: Span; view: RunView; onError: (error: string | null) => void }) {
  const { links } = span
  const transcript = transcriptOf(span)
  const tickets = links.tickets ?? (links.ticket === undefined ? [] : [links.ticket])
  const ticketSpan = (ticket: string) => view.timeline.spans.find((each) => each.kind === 'ticket' && each.links.ticket === ticket)
  const rows: [string, string, ReactNode][] = []
  if (links.pr !== undefined)
    rows.push([
      'PR',
      'pr',
      <RepoLink base={view.repoUrl} path={`pull/${links.pr}`} onError={onError}>
        PR #{links.pr}
      </RepoLink>,
    ])
  if (links.sha !== undefined)
    rows.push([
      'Commit',
      'commit',
      <RepoLink base={view.repoUrl} path={`commit/${links.sha}`} onError={onError}>
        <code>{links.sha.slice(0, 8)}</code>
      </RepoLink>,
    ])
  if (transcript !== null)
    rows.push([
      'Transcript',
      'transcript',
      <button
        type="button"
        className="w-fr-link"
        onClick={() => openSession({ nodeId: sessionNodeId(transcript.sessionId), projectId: view.projectId, external: transcript.agentId === undefined ? { sessionId: transcript.sessionId } : { sessionId: transcript.sessionId, agentId: transcript.agentId } })}
      >
        {transcript.label}
      </button>,
    ])
  if (tickets.length > 0)
    rows.push([
      tickets.length === 1 ? 'Ticket' : 'Tickets',
      'tickets',
      tickets.map((ticket, index) => {
        const target = ticketSpan(ticket)
        return (
          <span key={ticket}>
            {index > 0 ? ', ' : ''}
            {target === undefined || target.id === span.id ? (
              ticket
            ) : (
              <button type="button" className="w-fr-link" onClick={() => revealSpan(target.id)}>
                {ticket}
              </button>
            )}
          </span>
        )
      }),
    ])
  if (links.verdict !== undefined) rows.push(['Verdict', 'verdict', links.verdict])
  if (links.agent !== undefined) rows.push(['Agent id', 'agent', <code>{links.agent}</code>])
  if (links.session !== undefined) rows.push(['Session id', 'session', <code>{links.session}</code>])
  if (rows.length === 0) return <p className="w-fr-muted">No links on this span.</p>
  return (
    <table className="w-fr-detail__table">
      <tbody>
        {rows.map(([name, id, value]) => (
          <Field key={id} name={name} id={id}>
            {value}
          </Field>
        ))}
      </tbody>
    </table>
  )
}

function Source({ span, view }: { span: Span; view: RunView }) {
  const lost = lostWord(span)
  const github = view.github.state === 'no-answer' && (span.lost === 'github-no-answer' || span.startSource === 'github' || span.endSource === 'github')
  let end: string
  if (span.endSource !== null) end = SOURCE_WORDS[span.endSource]
  else if (span.end === null) end = view.timeline.live ? 'none yet: the span goes on' : 'none'
  else if (span.outcome === 'cut-off') end = 'none: cut off at the last event about it in any source'
  else end = '—'
  return (
    <table className="w-fr-detail__table">
      <tbody>
        <Field name="Start from" id="start-source">
          {span.startSource === null ? (lost === null ? '—' : 'none: the source is gone') : SOURCE_WORDS[span.startSource]}
        </Field>
        <Field name="End from" id="end-source">
          {end}
        </Field>
        {lost !== null ? (
          <Field name="Lost source" id="lost">
            {lost}
            {span.lost === 'github-no-answer' && view.github.state === 'no-answer' ? (
              <>
                {' '}
                <RetryButton view={view} />
              </>
            ) : null}
          </Field>
        ) : null}
        {github && span.lost !== 'github-no-answer' ? (
          <Field name="GitHub" id="github">
            did not answer this time <RetryButton view={view} />
          </Field>
        ) : null}
        {span.note !== null ? (
          <Field name="Source note" id="source-note">
            {span.note}
          </Field>
        ) : null}
      </tbody>
    </table>
  )
}

/** The panel at the bottom of the screen; a hint while no span is selected. */
export function DetailPanel({ view }: { view: RunView }) {
  const selected = useRunHistory((state) => state.selected)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState<string | null>(null)
  // A page that could not be opened is about the span it was opened from: another selection clears it,
  // and an answer that comes after the selection changed is dropped. Adjusted while rendering, not in an
  // effect, as React advises for state that follows other state.
  const [seen, setSeen] = useState(selected)
  if (seen !== selected) {
    setSeen(selected)
    setError(null)
  }
  const span = selected === null ? undefined : view.timeline.spans.find((each) => each.id === selected)
  if (span === undefined)
    return (
      <section className="w-fr-detail w-fr-detail--empty" data-testid="run-history-detail" aria-label="Details">
        <p className="w-fr-muted">Click a bar or a row to see its details: Overview, Links and Source.</p>
      </section>
    )
  return (
    <section className="w-fr-detail" data-testid="run-history-detail" data-span-id={span.id} aria-label="Details">
      <div className="w-fr-detail__head">
        <div role="tablist" aria-label="Details" className="w-fr-detail__tabs">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`w-fr-detail__tab${tab === id ? ' is-on' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="w-fr-detail__title" data-testid="run-history-detail-title">
          <span className={`w-fr-dot w-fr-dot--${tokenOf(span)}`} /> {displayName(span)}
          {span.attempt > 1 ? ` #${span.attempt}` : ''}
          <span className="w-fr-muted">
            {' '}
            · {formatDuration(spanDuration(span))}
            {span.outcome === null ? '' : ` · ${span.outcome}`}
          </span>
        </span>
        <button type="button" className="w-fr-button w-fr-detail__close" aria-label="Close the details" onClick={() => selectSpan(null)}>
          ×
        </button>
      </div>
      <div className="w-fr-detail__body" role="tabpanel">
        {tab === 'overview' ? <Overview span={span} view={view} /> : tab === 'links' ? <Links span={span} view={view} onError={(text) => (useRunHistory.getState().selected === span.id ? setError(text) : undefined)} /> : <Source span={span} view={view} />}
        {error !== null ? (
          <p className="w-fr-problem-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}
