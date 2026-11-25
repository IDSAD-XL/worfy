// The sources of the attention core (worfy-assistant ticket 03; spec, implementation decisions, the attention core, its sources): what main
// already has, turned into the core's events. Each function here reads one source and calls the core; none runs a
// timer, gh, git or a model. install.ts connects them to the app.
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { AttentionSubject } from '../../../shared/assistant/attention'
import type { AgentEvent } from '../../../shared/agent/events'
import type { LimitsState } from '../../../shared/agent/limits'
import type { JournalEvent } from '../../../shared/autopilot/journal'
import type { FirstRunReport } from '../../../shared/ipc/first-run'
import { PR_INBOX_GROUP_TITLES, PR_NEED_YOU, type PrInboxSnapshot } from '../../../shared/ipc/pr-inbox'
import { ticketKey, type Ticket, type WorkflowDelta, type WorkflowModel } from '../../../shared/workflow/types'
import { waitBody, waitKey, waitsForPerson } from '../../workflow/waits-notify'
import type { AttentionCore } from './attention-core'

type Core = Pick<AttentionCore, 'ingest' | 'resolve' | 'expect'>

/**
 * How long a Session may stay silent after the end of its turn before it waits for the user: 15 minutes, the
 * measure of rule (e) of the events measurement (the events measurement of the proactive-runtime map, docs/product/proactive-runtime/).
 * Decided without the owner (ticket 03, result section).
 */
export const SESSION_WAIT_MS = 15 * 60_000

/** The Autopilot journal lines that are items (rules (d) and the failure lines of the measurement). */
export const AUTOPILOT_ITEM_KINDS: ReadonlySet<string> = new Set(['run-stopped', 'ticket-set-aside', 'session-error', 'limits-hit', 'retry-refused'])

/**
 * The Project whose folder holds `cwd` (a worktree under it too); null when none does. Both paths are real paths (a link
 * followed, /var as /private/var on a Mac), or resolved by the rules of `platform` when they cannot be read (a folder
 * gone); on Windows `/` and `\` are one separator and letters compare in either case.
 */
export function projectOfPath(projects: readonly { id: string; path: string }[], cwd: string, platform: NodeJS.Platform = process.platform): string | null {
  const path = platform === 'win32' ? win32 : posix
  const real = (folder: string): string => {
    if (platform === process.platform) {
      try {
        return realpathSync.native(folder)
      } catch {
        // Gone or unreadable: the path as it is.
      }
    }
    return path.resolve(folder)
  }
  const plain = (folder: string): string => (platform === 'win32' ? real(folder).toLowerCase() : real(folder))
  const at = plain(cwd)
  let best: { id: string; length: number } | null = null
  for (const project of projects) {
    const root = plain(project.path)
    const inside = at === root || at.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
    if (inside && (best === null || root.length > best.length)) best = { id: project.id, length: root.length }
  }
  return best?.id ?? null
}

const clip = (text: string): string => (text.length > 160 ? `${text.slice(0, 159)}…` : text)

/**
 * The events of the Sessions worfy runs (SessionRegistry.observe): a question, a permission request, an error, the end
 * of a turn, a `quiet` turn. The end of a turn names the condition «nothing since for SESSION_WAIT_MS»; a prompt of the
 * person or an answer to a request closes the Session's items.
 */
export function sessionAttention(core: Core, projectOf: (cwd: string) => string | null, now: () => number, departing: () => boolean = () => false): (sessionId: string, event: AgentEvent) => void {
  const projects = new Map<string, string | null>()
  return (sessionId, event) => {
    // worfy quits (SessionRegistry.depart, then haltAll closes every Session): what the Sessions send now is the quit,
    // not news. Their items stay open and their conditions armed; the Sessions go on after the start (ADR-0108).
    if (departing()) return
    if (event.type === 'init') {
      projects.set(sessionId, projectOf(event.cwd))
      return
    }
    if (event.type === 'renamed') {
      projects.set(sessionId, projects.get(event.from) ?? null)
      projects.delete(event.from)
      return
    }
    const projectId = projects.get(sessionId) ?? null
    const subject: AttentionSubject = { kind: 'session', id: sessionId, label: sessionId }
    const at = event.at ?? now()
    const take = (kind: string, revision: string, text: string): void => {
      core.ingest({ source: 'session', id: `${sessionId}:${kind}`, revision, projectId, subject, kind, text: clip(text), at })
    }
    switch (event.type) {
      case 'question_request':
        return take('question', event.requestId, `Asks: ${event.questions[0]?.question ?? ''}`)
      case 'permission_request':
        return take('permission', event.requestId, `Needs permission: ${event.toolName}`)
      case 'state':
        if (event.state === 'error') take('error', String(at), event.error ?? 'The Session stopped with an error')
        if (event.state === 'closed') {
          // A closed Session waits for no one: its items close and its «nothing happened» condition is disarmed.
          core.resolve(projectId, subject)
          projects.delete(sessionId)
        }
        return
      case 'quiet':
        if (event.quietSince !== null) take('quiet', String(event.quietSince), 'The turn has gone quiet')
        return
      case 'result':
        if (event.interrupted) return
        take(event.isError ? 'error' : 'turn-end', String(at), event.isError ? (event.error ?? 'The turn ended with an error') : 'Finished its turn')
        core.expect({ source: 'session', id: `${sessionId}:waiting`, revision: String(at), projectId, subject, kind: 'waiting', text: 'Waits for you since the end of its turn', quietMs: SESSION_WAIT_MS, from: at })
        return
      case 'prompt':
      case 'permission_resolved':
      case 'question_resolved':
        core.resolve(projectId, subject)
        return
      default:
        return
    }
  }
}

const ticketSubject = (ticket: Pick<Ticket, 'epic' | 'num' | 'title'>): AttentionSubject => ({ kind: 'ticket', id: ticketKey(ticket), label: `${ticket.epic} ${String(ticket.num).padStart(2, '0')} — ${ticket.title}` })

/**
 * A read of a Project's workflow model, or a change of it: a Ticket that waits for a person (the owner or a Machine)
 * is an item of `ticket-waits`, a blocked one of `workflow`; a Ticket that no longer does, or left, closes its items.
 * Unlike the notifications (waits-notify.ts), the first read is not a baseline: what waits at the start is an item
 * unless it was taken before (the key is the wait's, waitKey).
 */
export function workflowAttention(core: Core, projectId: string, read: WorkflowModel | WorkflowDelta): void {
  for (const ticket of read.tickets) {
    const subject = ticketSubject(ticket)
    const person = waitsForPerson(ticket.waits)
    if (!person && ticket.state !== 'blocked') {
      core.resolve(projectId, subject)
      continue
    }
    const statusAt = ticket.statusAt !== null && ticket.statusAt !== undefined ? Date.parse(ticket.statusAt) : NaN
    core.ingest({
      source: person ? 'ticket-waits' : 'workflow',
      id: subject.id,
      revision: waitKey(ticket),
      projectId,
      subject,
      kind: person ? 'waits' : 'blocked',
      text: clip(person ? waitBody(ticket) : (ticket.blockedReason ?? `${subject.label} is blocked`)),
      ...(Number.isNaN(statusAt) ? {} : { at: statusAt }),
    })
  }
  for (const gone of 'removedTickets' in read ? read.removedTickets : []) core.resolve(projectId, { kind: 'ticket', id: ticketKey(gone), label: '' })
}

/** A read of a Project's PR inbox: a PR in a group that needs the user is an item; one in another group closes its items. */
export function prInboxAttention(core: Core, snapshot: PrInboxSnapshot): void {
  if (!snapshot.enabled || snapshot.readAt === null) return
  for (const { group, rows } of snapshot.groups) {
    for (const row of rows) {
      const subject: AttentionSubject = { kind: 'pr', id: `${row.repo.toLowerCase()}#${row.number}`, label: `${row.repo}#${row.number} ${row.title}` }
      if (!PR_NEED_YOU.has(group)) {
        core.resolve(snapshot.projectId, subject)
        continue
      }
      const at = Date.parse(row.updatedAt)
      core.ingest({ source: 'pr-inbox', id: `${subject.id}:${group}`, revision: row.updatedAt, projectId: snapshot.projectId, subject, kind: group, text: clip(`${PR_INBOX_GROUP_TITLES[group]}: ${subject.label}`), ...(Number.isNaN(at) ? {} : { at }) })
    }
  }
}

/** One line of an Autopilot run journal: a stop, a Ticket set aside or a failure line is an item of the run. */
export function autopilotAttention(core: Core, line: JournalEvent): void {
  if (!AUTOPILOT_ITEM_KINDS.has(line.kind)) return
  const finished = line.kind === 'run-stopped' && line.reason === 'tickets-done'
  const detail = line.kind === 'run-stopped' ? line.reason : line.kind === 'ticket-set-aside' ? `Ticket ${line.ticket} set aside` : line.kind === 'session-error' ? line.message : line.kind
  const at = Date.parse(line.at)
  core.ingest({
    source: 'autopilot',
    // One line, by its time, kind and content: two lines of one kind in one run are two events, even in one millisecond.
    id: `${line.run}@${line.at}:${line.kind}`,
    revision: createHash('sha256').update(JSON.stringify(line)).digest('hex').slice(0, 16),
    projectId: line.project,
    subject: { kind: 'run', id: line.run, label: `Autopilot · ${line.epic}` },
    kind: finished ? 'run-finished' : line.kind,
    text: clip(`${line.epic}: ${detail}`),
    ...(Number.isNaN(at) ? {} : { at }),
  })
}

/** The Health check report: a row that fails or warns is an item of its Project (the Machine's without one); `ok` closes it. */
export function healthAttention(core: Core, report: FirstRunReport): void {
  for (const check of report.checks) {
    if (check.status === 'unknown') continue
    const projectId = check.project?.id ?? null
    const subject: AttentionSubject = { kind: 'check', id: check.subject === undefined ? check.id : `${check.id}:${check.subject.id}`, label: check.title }
    if (check.status === 'ok') {
      core.resolve(projectId, subject)
      continue
    }
    core.ingest({ source: 'health', id: subject.id, revision: `${check.status}\0${check.detail}`, projectId, subject, kind: check.status === 'fail' ? 'check-failed' : 'check-warning', text: clip(`${check.title}: ${check.detail}`) })
  }
}

/** The Limits: a window that is reached (`rejected`) or warned of is an item of the Machine; allowed again closes it. */
export function limitsAttention(core: Core, state: LimitsState): void {
  for (const [name, window] of Object.entries(state.windows)) {
    const subject: AttentionSubject = { kind: 'limit', id: name, label: name }
    const kind = window.status === 'rejected' ? 'limit-reached' : window.status === 'allowed_warning' ? 'limit-warning' : null
    if (kind === null) {
      core.resolve(null, subject)
      continue
    }
    core.ingest({ source: 'limits', id: name, revision: `${kind}\0${window.resetsAt ?? ''}`, projectId: null, subject, kind, text: kind === 'limit-reached' ? `Limits: ${name} reached` : `Limits: ${name} close to its end` })
  }
}
