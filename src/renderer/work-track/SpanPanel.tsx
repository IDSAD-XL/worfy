// The Span panel of Work track (worfy-work-track ticket 10; spec «What the owner sees», 7–8; owner decisions 7,
// 11): a click on a Span of the lanes or on a merged PR's diamond opens it on the right, as the prototype on Card
// card-dcf3918a has it — the Span's name, what it is and whose, the table When, Duration, Epic, Ticket, PR,
// Outcome, the buttons and the line «Source: …». Esc and ✕ close it.
//
// - Open Session: the Session the work is of — on its Node when the Canvas holds one (live while worfy runs
//   it), else its transcript read-only in the Session view, as the Run history's detail panel opens one
//   (src/renderer/flight-recorder/DetailPanel.tsx). A Subagent opens its Session.
// - Open Run: Run history on the Run the Span is part of (openRunHistory, src/renderer/flight-recorder/open.ts).
//   The service names a Run's fact `run:<run id>` (src/main/work-track/service.ts); a Wave started by hand has
//   only its marker and no Run.
// - Open PR: the PR's page on GitHub, at the repository page main found from the Project's `origin`
//   (the workflow model's `repoUrl`); without one the button stays off and says why.
//
// Only names reach the panel, as they reach the facts: no text of a turn (owner decision 7). The view gives the
// panel a `key` of the Span, so another Span starts with no problem shown.
import { useEffect, useState } from 'react'
import { agentSubkind } from '../../shared/flight-recorder/spans'
import type { WorkTrackView } from '../../shared/ipc/work-track'
import { WORK_SOURCE_LABELS, type WorkFact, type WorkFactKind } from '../../shared/work-track/facts'
import type { WorkSpan } from '../../shared/work-track/lanes'
import { orchestratorViewOf } from '../canvas/nodes/orchestrator-view'
import { currentLayout } from '../canvas/useLayout'
import { sessionNodeId } from '../claude-home/session-nodes'
import { openRunHistory } from '../flight-recorder/open'
import { formatClock, formatDuration, formatLocal } from '../flight-recorder/store'
import { invoke } from '../ipc'
import { useProjects } from '../projects/useProjects'
import { nodeSession, openSession, type OpenedSession } from '../session/navigation'
import { sessionNodeViewOf } from '../session/node-sessions'
import { useWorkflow } from '../workflow/useWorkflow'
import { startOfDay } from './store'

const KIND_WORDS: Readonly<Record<WorkFactKind, string>> = {
  run: 'Autopilot Run',
  wave: 'Wave',
  turn: 'Session turn',
  subagent: 'Subagent',
  pr: 'PR',
  ci: 'CI run',
  gate: 'Gate run',
  'ticket-status': 'Ticket status change',
}

const RUN_PREFIX = 'run:'
const NO_REPO = 'No page of the repository: remote origin of the Project is not a repository on a GitHub host'

function kindWords(span: WorkSpan): string {
  if (span.kind !== 'subagent') return KIND_WORDS[span.kind]
  const subkind = agentSubkind(span.title)
  return subkind === 'other' ? 'Subagent' : `Subagent · ${subkind}`
}

/** The Run of the Span: the Span itself or the nearest Run up its parent chain; null — none. */
function runOf(fact: WorkFact | undefined, facts: ReadonlyMap<string, WorkFact>): string | null {
  const seen = new Set<string>()
  for (let at = fact; at !== undefined && !seen.has(at.id); at = at.parent === undefined ? undefined : facts.get(at.parent)) {
    if (at.kind === 'run') return at.id.startsWith(RUN_PREFIX) ? at.id.slice(RUN_PREFIX.length) : at.id
    seen.add(at.id)
  }
  return null
}

/**
 * Where Open Session shows a Session of the Project: the Session Node or the Orchestrator that runs it live,
 * else the Node of the Canvas that holds it, else its transcript read-only.
 */
function sessionTarget(projectId: string, sessionId: string): OpenedSession {
  const node = sessionNodeViewOf(sessionId)
  if (node !== undefined && node.projectId === projectId) return { nodeId: node.nodeId, projectId }
  const orchestrator = orchestratorViewOf(sessionId)
  if (orchestrator !== undefined && orchestrator.projectId === projectId) return { nodeId: orchestrator.nodeId, projectId }
  for (const each of currentLayout(projectId)?.nodes ?? []) {
    const opens = nodeSession(each, projectId, false)
    if (opens?.external?.sessionId === sessionId) return opens
  }
  return { nodeId: sessionNodeId(sessionId), projectId, external: { sessionId } }
}

/** The page of the Project's repository on GitHub: undefined while it is read, null when there is none. */
function useRepoUrl(projectId: string): string | null | undefined {
  const path = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { model, error } = useWorkflow(path)
  if (error !== undefined) return null
  return model === undefined ? undefined : (model.repoUrl ?? null)
}

function Row({ name, children }: { name: string; children: string }) {
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>{children}</td>
    </tr>
  )
}

export interface SpanPanelProps {
  projectId: string
  span: WorkSpan
  view: WorkTrackView
  onClose: () => void
}

export function SpanPanel({ projectId, span, view, onClose }: SpanPanelProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const repoUrl = useRepoUrl(projectId)
  const facts = new Map(view.facts.map((fact) => [fact.id, fact]))
  const fact = facts.get(span.id)
  const session = span.session === null || span.session === '' ? null : span.session
  const sessionName = session === null ? null : (view.sessions.find((each) => each.id === session)?.name ?? `Session ${session.slice(0, 4)}`)
  const run = runOf(fact, facts)

  // Esc closes the panel, unless another dialog or a menu is open, or the press is in a text field: then it
  // is theirs. The panel is a dialog itself, so Run history's Esc back to the Canvas leaves it this press.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return
      const others = [...document.querySelectorAll('[role="dialog"], [role="menu"]')].filter((popup) => !popup.matches('[data-testid="work-track-panel"]') && popup.closest('[hidden]') === null)
      if (others.length > 0) return
      event.preventDefault()
      onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose])

  // The times as the sources have them, not cut to the period.
  const start = fact === undefined ? span.start : Date.parse(fact.start)
  const end = fact?.end == null ? span.end : Date.parse(fact.end)
  const until = span.open ? 'now' : startOfDay(start) === startOfDay(end) ? formatClock(end) : formatLocal(end)
  let outcome: string
  if (span.kind === 'pr') outcome = span.open ? 'not merged' : 'merged'
  else outcome = span.outcome ?? (span.open ? 'going on' : '—')

  let prTitle = `PR #${span.pr ?? ''} on GitHub`
  if (span.pr === undefined) prTitle = 'No PR is known for this work'
  else if (repoUrl === null) prTitle = NO_REPO
  else if (repoUrl === undefined) prTitle = "Reading the repository's page…"
  const prUrl = span.pr === undefined || typeof repoUrl !== 'string' ? null : `${repoUrl.replace(/\/+$/u, '')}/pull/${span.pr}`

  return (
    <aside className="w-wt-panel" role="dialog" aria-label={`Details of ${span.title}`} data-testid="work-track-panel">
      <button type="button" className="w-wt-panel__close" aria-label="Close the details" title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
      <h2 className="w-wt-panel__title">{span.title}</h2>
      <p className="w-wt-panel__what" data-testid="work-track-panel-what">
        {[kindWords(span), sessionName].filter((part) => part !== null).join(' · ')}
      </p>
      <table className="w-wt-panel__table">
        <tbody>
          <Row name="When">{`${formatLocal(start)} – ${until}`}</Row>
          <Row name="Duration">{formatDuration(end - start)}</Row>
          <Row name="Epic">{span.epic ?? '—'}</Row>
          <Row name="Ticket">{span.ticket ?? '—'}</Row>
          <Row name="PR">{span.pr === undefined ? '—' : `#${span.pr}`}</Row>
          <Row name="Outcome">{outcome}</Row>
        </tbody>
      </table>
      <div className="w-wt-panel__actions">
        <button
          type="button"
          className="w-wt-action"
          disabled={session === null}
          title={session === null ? 'This work is of no Session' : `Open ${sessionName ?? 'the Session'}`}
          onClick={() => {
            if (session !== null) openSession(sessionTarget(projectId, session))
          }}
        >
          Open Session
        </button>
        <button
          type="button"
          className="w-wt-action"
          disabled={run === null}
          title={run === null ? 'Not part of an Autopilot Run' : `Run ${run} in Run history`}
          onClick={() => {
            if (run !== null) void openRunHistory(projectId, run)
          }}
        >
          Open Run
        </button>
        <button
          type="button"
          className="w-wt-action"
          disabled={prUrl === null}
          title={prTitle}
          onClick={() => {
            if (prUrl === null) return
            setProblem(null)
            void invoke('shell.openExternal', { url: prUrl }).then((result) => {
              if (!result.ok) setProblem(`The page could not be opened: ${result.error}`)
            })
          }}
        >
          Open PR
        </button>
      </div>
      {problem !== null ? (
        <p className="w-wt-panel__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <p className="w-wt-panel__source" data-testid="work-track-panel-source">
        Source: {WORK_SOURCE_LABELS[span.source]}. Only titles are shown here; the contents of turns never enter Work track.
      </p>
    </aside>
  )
}
