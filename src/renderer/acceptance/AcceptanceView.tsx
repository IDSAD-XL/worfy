// The Acceptance view (worfy-acceptance ticket 05): the checks that wait for the owner in every Project of the
// window's Machine, in two panes as Pull requests has them. On the left the groups of main's queue with their counts
// (In work and Older closed); on the right the selected row: for an item, its Ticket, its text, where to check it, the
// Stable copy line, its Evidence (the matrix of the one item, with the screenshots and the clip), what the Orchestrator
// prepared, and the decision row — a comment, where it was checked, Pass and Fail; for a Ticket of Waits for you, its
// `Blocked reason:` with Open Ticket and Open Orchestrator, no Pass and Fail. ↑ and ↓ move along the list as in Pull
// requests. Pass and Fail send `actions.ownerCheck`; worfy writes nothing into the Ticket (ADR-0002).
//
// In a window on a Linked machine (worfy-acceptance ticket 07) the queue is that Machine's: `acceptance.get` and
// `acceptance.changed` go there by their access mark (src/renderer/ipc.ts), and so does the decision, to the Orchestrator
// of the Project on its Machine. With read-only access Pass and Fail are inactive with the read-only hint. The decision
// names the platform of the window's Machine and the commit of its build, from its `hello` (`linked.state`); an item
// whose `needs:` names another platform shows the build of the Linked machine of that platform, or that none is
// connected (src/shared/acceptance/linked-build.ts). A worfy there without the Acceptance view is told to be updated.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { linkedBuildLine, linkedCommit, olderWorfyText, type BuildMachine } from '../../shared/acceptance/linked-build'
import { OWNER_CHECK_AUTOPILOT_HINT } from '../../shared/actions/render-template'
import { MAIN_WAITS_FOR_CI, NO_UPDATE_CHECK, UPDATE_NOT_HERE, type AcceptanceGroupName, type AcceptanceItemRow, type AcceptanceRow, type AcceptanceSent, type AcceptanceStable, type AcceptanceTicket } from '../../shared/ipc/acceptance'
import { OWNER_CHECK_COPIES, OWNER_CHECK_PLATFORMS, OWNER_CHECK_SHA, type OwnerCheckCopy, type OwnerCheckPlatform, type OwnerCheckVerdict } from '../../shared/projects/action-templates'
import type { EvidenceItem } from '../../shared/workflow/types'
import { markdownText } from '../../shared/markdown/visible-text'
import type { WorkflowModel } from '../../shared/workflow/types'
import { ticketTitle } from '../canvas/epic-layout'
import { EvidenceMatrix } from '../canvas/nodes/EvidenceMatrix'
import { linkFolderOf, useTicketText } from '../canvas/nodes/ticket-text'
import { invoke, windowMachine } from '../ipc'
import { useMachines } from '../machines/useMachines'
import { Markdown } from '../markdown/Markdown'
import { currentPlatform } from '../platform'
import { useLinked, useProjects, useReadOnly } from '../projects/useProjects'
import { useNavigation } from '../session/navigation'
import { Button } from '../theme/Button'
import { layerOf } from '../theme/open-layers'
import { Select } from '../theme/Select'
import { showToast } from '../toast/toasts'
import { installUpdateTelling, useUpdate } from '../update/store'
import { useWorkflow } from '../workflow/useWorkflow'
import { openAcceptanceOrchestrator, openAcceptanceTicket } from './open'
import { GROUP_TITLES, moveSelection, rowKey, selectRow, sendDecision, sentOf, toggleGroup, useAcceptance, useAutopilotRuns, useProjectMode, type CheckedIn } from './useAcceptance'
import './acceptance.css'

/** Why Fail is inactive with an empty comment. */
const FAIL_NEEDS_WORDS = 'Write what is wrong: Fail needs a comment'

/** Under the comment in a Full mode Project: the `owner-check` line carries the words into the repository. */
const WORDS_GO_PUBLIC = 'Your words go into the repository with the owner-check line'

const nn = (num: number): string => String(num).padStart(2, '0')
const ref = (ticket: AcceptanceTicket): string => `${ticket.epic} ${nn(ticket.num)}`

/** Tells a refusal of Open Ticket or Open Orchestrator, which selects another Project first. */
function tell(refused: string | undefined): void {
  if (refused !== undefined) showToast({ kind: 'error', text: refused })
}

/** Whether ↑ or ↓ of this event is the view's: the view is shown, no field, menu or dialog has the key, no modifier. */
function listKey(event: KeyboardEvent, frame: HTMLElement | null): 1 | -1 | null {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return null
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (frame === null || frame.closest('[hidden]') !== null) return null
  const target = event.target
  if (target instanceof Element && target !== document.body && target !== document.documentElement && !frame.contains(target)) return null
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, input, select, [role="listbox"]') !== null || layerOf(target) !== null)) return null
  return event.key === 'ArrowDown' ? 1 : -1
}

/** The item's text without the manual mark it starts with: the pane says "manual" itself. Sent as it is, never so. */
function shownText(item: EvidenceItem): string {
  return item.manual ? item.text.replace(/^\([^)]*\)\s*/, '') : item.text
}

/** The item as plain text, without the manual mark and the markdown markers: the list row and the Evidence matrix. */
function plainText(item: EvidenceItem): string {
  return markdownText(shownText(item)).replace(/\s+/g, ' ').trim()
}

/** The short line under a row of the list: the item's text, the Ticket's reason, or the words of the last fail. */
function rowDetail(group: AcceptanceGroupName, row: AcceptanceRow): string {
  if (row.kind === 'ticket') return row.ticket.blockedReason ?? 'Waits for you'
  const fail = group === 'failed' ? row.item.evidence.findLast((line) => line.verdict === 'fail') : undefined
  return fail?.ref ?? plainText(row.item)
}

function ListRow({ group, row, selected, sent }: { group: AcceptanceGroupName; row: AcceptanceRow; selected: boolean; sent: AcceptanceSent | null }) {
  return (
    <li>
      <button type="button" className="w-acc-row" aria-current={selected} data-testid="acceptance-row" data-key={rowKey(row)} data-selected={selected} onClick={() => selectRow(rowKey(row))}>
        <span className="w-acc-row__head">
          <span className="w-acc-row__ref">
            {ref(row.ticket)}
            {row.kind === 'item' ? ` · ${row.item.index}` : null}
          </span>
          <span className="w-acc-row__side">{sent !== null ? (sent.state === 'sent' ? 'Sent' : 'Not recorded') : row.kind === 'item' ? (row.item.needs?.platform ?? '') : ''}</span>
        </span>
        <span className="w-acc-row__detail" title={rowDetail(group, row)}>
          {rowDetail(group, row)}
        </span>
        <span className="w-acc-row__project">{row.ticket.projectName}</span>
      </button>
    </li>
  )
}

function GroupList({ selected }: { selected: string | null }) {
  const { state, open, sentHere } = useAcceptance()
  return (
    <nav className="w-acc-list" aria-label="Acceptance groups">
      {(state?.groups ?? [])
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.group} className="w-acc-group" data-testid="acceptance-group" data-group={group.group} data-open={open[group.group]}>
            <h3 className="w-acc-group__title">
              <button type="button" aria-expanded={open[group.group]} onClick={() => toggleGroup(group.group)} data-testid="acceptance-group-title">
                <span aria-hidden="true">{open[group.group] ? '▾' : '▸'}</span> {GROUP_TITLES[group.group]} · {group.rows.length}
              </button>
            </h3>
            {open[group.group] ? (
              <ul className="w-acc-group__rows">
                {group.rows.map((row) => (
                  <ListRow key={rowKey(row)} group={group.group} row={row} selected={rowKey(row) === selected} sent={row.kind === 'item' ? sentOf(row, sentHere) : null} />
                ))}
              </ul>
            ) : null}
          </section>
        ))}
    </nav>
  )
}

/** The Linked machines as the view reads them: what main knows of each (online, build, platform) with its name. */
function useBuildMachines(): BuildMachine[] {
  const linked = useLinked()
  const names = useMachines()?.linked
  return (linked?.machines ?? []).map(({ id, online, build, platform }) => ({ id, name: names?.find((machine) => machine.id === id)?.name ?? 'the Linked machine', online, build, platform }))
}

/** The name of the window's Machine when it is a Linked machine; null in a window of this Machine. */
function useWindowMachineName(): string | null {
  const machine = windowMachine()
  const name = useMachines()?.linked.find((each) => each.id === machine)?.name
  return machine === null ? null : (name ?? 'the Linked machine')
}

/** The build of the Linked machine an item is checked on, when its `needs:` names another platform than this Machine's. */
function LinkedBuild({ platform }: { platform: string }) {
  const line = linkedBuildLine(platform, currentPlatform(), windowMachine(), useBuildMachines())
  if (line === null) return null
  return (
    <p className="w-acc-stable" data-testid="acceptance-linked-build" data-state={line.state}>
      <span className="w-acc-stable__dot" aria-hidden="true" />
      <span>{line.text}</span>
    </p>
  )
}

/** The Stable copy line as the spec draws it: the line, and in Update first what the owner can do about it. */
export function StableLine({ stable }: { stable: AcceptanceStable }) {
  const update = useUpdate()
  // In a window on a Linked machine the line is that Machine's Stable copy: Update worfy here would update this one.
  const elsewhere = useWindowMachineName()
  let after: ReactNode = null
  if (stable.update === 'available' && elsewhere !== null) after = <span className="w-acc-muted">Update worfy on {elsewhere}</span>
  else if (stable.update === 'available')
    after = (
      <Button variant="secondary" onClick={() => void installUpdateTelling(update)} data-testid="acceptance-update">
        Update worfy
      </Button>
    )
  else if (stable.update !== null) after = <span className="w-acc-muted">{{ 'waits-ci': MAIN_WAITS_FOR_CI, 'no-update-check': NO_UPDATE_CHECK, 'update-not-here': UPDATE_NOT_HERE }[stable.update]}</span>
  return (
    <p className="w-acc-stable" data-testid="acceptance-stable" data-state={stable.state}>
      <span className="w-acc-stable__dot" aria-hidden="true" />
      <span>{stable.text}</span>
      {after}
    </p>
  )
}

/** The copy the decision names at first: the item's `needs:` copy, else the Stable copy when the change is in it, else `installed`. */
function firstCopy(row: AcceptanceItemRow): OwnerCheckCopy {
  const needed = row.item.needs?.copy
  if (needed != null && (OWNER_CHECK_COPIES as readonly string[]).includes(needed)) return needed as OwnerCheckCopy
  return row.stable?.state === 'in' ? 'stable' : 'installed'
}

/** The decision row: the comment, "Checked in", Pass and Fail, and what became of the decision. */
function DecisionRow({ row, root }: { row: AcceptanceItemRow; root: string | undefined }) {
  const { sending, sentHere, refused, state } = useAcceptance()
  const key = rowKey(row)
  const [words, setWords] = useState('')
  const machines = useBuildMachines()
  const shownOn = windowMachine()
  // The platform of the window's Machine: on a Linked machine, the one its `hello` names; one whose build names none
  // (before worfy-acceptance ticket 07) — the item's `needs:` platform, else this Machine's.
  const needed = OWNER_CHECK_PLATFORMS.find((each) => each === row.item.needs?.platform)
  const windowPlatform = shownOn === null ? currentPlatform() : (machines.find((machine) => machine.id === shownOn)?.platform ?? needed ?? currentPlatform())
  const [chosen, setPlatform] = useState<OwnerCheckPlatform | null>(null)
  const platform = chosen ?? windowPlatform
  const [copy, setCopy] = useState<OwnerCheckCopy>(() => firstCopy(row))
  const update = useUpdate()
  const autopilot = useAutopilotRuns(row.ticket.projectId)
  const readOnly = useReadOnly()
  const mode = useProjectMode(root)
  const sent = sentOf(row, sentHere)
  // The commit of the copy: on a Linked machine's platform the commit of its build (its `hello`, worfy-acceptance ticket
  // 07), which wins; else, in a window of this Machine, known for its Stable copy, the one the Stable copy line reads
  // (main's snapshot), with its version when this window is that copy. In a window on a Linked machine the snapshot's
  // `stableCommit` is that Machine's, so a decision on this Machine's platform names none.
  const linked = linkedCommit(platform, currentPlatform(), shownOn, machines)
  const here = linked === null && shownOn === null && copy === 'stable' && platform === currentPlatform()
  const commit = linked?.sha ?? (here ? (state?.stableCommit ?? null) : null)
  const version = linked?.build ?? (here ? (update?.enabled === true ? (update.current?.version ?? null) : commit?.slice(0, 7) ?? null) : null)
  const where: CheckedIn = { platform, copy, sha: commit !== null && OWNER_CHECK_SHA.test(commit) ? commit : '-' }
  const elsewhere = useWindowMachineName()
  const refusal = refused[key] === undefined ? undefined : elsewhere === null ? refused[key] : (olderWorfyText('actions.ownerCheck', refused[key], elsewhere) ?? refused[key])
  const blocked = readOnly ?? (autopilot ? OWNER_CHECK_AUTOPILOT_HINT : sending[key] !== undefined ? 'Sending…' : sent?.state === 'sent' ? 'Sent: the decision waits for its line in the Ticket' : null)
  const reason = (verdict: OwnerCheckVerdict): string | null => blocked ?? (verdict === 'fail' && words.trim() === '' ? FAIL_NEEDS_WORDS : null)
  const decide = (verdict: OwnerCheckVerdict) => {
    if (reason(verdict) === null) void sendDecision(row, verdict, where, words.trim())
  }
  const button = (verdict: OwnerCheckVerdict, label: string, variant: 'primary' | 'danger') => (
    <Button variant={variant} quiet={variant === 'danger'} aria-disabled={reason(verdict) !== null} title={reason(verdict) ?? `${label}: send the decision to the Orchestrator`} onClick={() => decide(verdict)} data-testid={`acceptance-${verdict}`}>
      {label}
    </Button>
  )
  return (
    <section className="w-acc-decision" aria-label="Decision" data-testid="acceptance-decision">
      <textarea className="w-acc-decision__words" aria-label="Comment" placeholder="Comment (required for Fail)" value={words} onChange={(event) => setWords(event.target.value)} rows={3} data-testid="acceptance-words" />
      {mode === 'full' ? <p className="w-acc-muted w-acc-decision__note">{WORDS_GO_PUBLIC}</p> : null}
      <div className="w-acc-decision__bar">
        <span className="w-acc-decision__where">Checked in:</span>
        <Select aria-label="Platform" value={platform} options={OWNER_CHECK_PLATFORMS.map((value) => ({ value, label: value }))} onChange={setPlatform} data-testid="acceptance-platform" />
        <Select aria-label="Copy" value={copy} options={OWNER_CHECK_COPIES.map((value) => ({ value, label: value }))} onChange={setCopy} data-testid="acceptance-copy" />
        {version !== null ? <span className="w-mono w-acc-muted">{version}</span> : null}
        <span className="w-acc-decision__spacer" />
        {button('pass', 'Pass', 'primary')}
        {button('fail', 'Fail', 'danger')}
      </div>
      <p className="w-acc-decision__status" role="status" data-testid="acceptance-status">
        {autopilot ? OWNER_CHECK_AUTOPILOT_HINT : null}
        {!autopilot && sent?.state === 'sent' ? `Sent · waits for the line (${sent.verdict})` : null}
        {!autopilot && sent?.state === 'not-recorded' ? (
          <>
            Not recorded yet ({sent.verdict}){' '}
            <Button variant="link" aria-disabled={reason(sent.verdict) !== null} title={reason(sent.verdict) ?? undefined} onClick={() => decide(sent.verdict)} data-testid="acceptance-send-again">
              Send again
            </Button>
          </>
        ) : null}
        {refusal !== undefined ? <span className="w-acc-error">{refusal}</span> : null}
      </p>
    </section>
  )
}

/** The right pane of an item: what to check, where, its Evidence and what was prepared, and the decision. */
function ItemPane({ row, root, model }: { row: AcceptanceItemRow; root: string | undefined; model: WorkflowModel | undefined }) {
  const { ticket, item } = row
  const full = model?.tickets.find((each) => each.epic === ticket.epic && each.num === ticket.num)
  const text = useTicketText(full === undefined ? null : { projectId: ticket.projectId, ticket: full })
  const baseDir = linkFolderOf(text)
  const repoUrl = model?.repoUrl ?? null
  const prepared = row.prepared.filter((each) => each.state === 'verified').length
  const needs = item.needs === null ? null : `needs ${item.needs.platform}${item.needs.copy === null ? '' : ` ${item.needs.copy}`}`
  return (
    <article className="w-acc-pane" data-testid="acceptance-pane" data-key={rowKey(row)}>
      <h2 className="w-acc-pane__title">
        {ticket.projectName} · {ref(ticket)} — {ticketTitle({ ...ticket, slug: '' })}
      </h2>
      <p className="w-acc-muted">{[full?.evidence === undefined ? `Item ${item.index}` : `Item ${item.index} of ${full.evidence.length}`, 'manual', needs].filter(Boolean).join(' · ')}</p>
      {row.stable !== null ? <StableLine stable={row.stable} /> : null}
      {item.needs !== null ? <LinkedBuild platform={item.needs.platform} /> : null}
      <div className="w-acc-pane__text" data-testid="acceptance-text">
        <Markdown text={shownText(item)} projectId={ticket.projectId} baseDir={baseDir} />
      </div>
      <EvidenceMatrix projectId={ticket.projectId} epic={ticket.epic} items={[{ ...item, text: plainText(item) }]} repoUrl={repoUrl} baseDir={baseDir} />
      {row.prepared.length > 0 ? (
        <section className="w-acc-prepared" data-testid="acceptance-prepared">
          <h3 className="w-acc-pane__subtitle">
            Prepared by the Orchestrator · {prepared} of {row.prepared.length} verified
          </h3>
          <ul>
            {row.prepared.map((each) => (
              <li key={each.index} data-state={each.state}>
                <span aria-hidden="true">{each.state === 'verified' ? '✓' : each.state === 'failed' ? '✕' : '○'}</span> {plainText(each)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="w-acc-links">
        <Button variant="link" onClick={() => void openAcceptanceTicket(ticket).then(tell)} data-testid="acceptance-open-ticket">
          Open Ticket
        </Button>
        {ticket.pr !== null && repoUrl !== null ? (
          <Button variant="link" onClick={() => void invoke('shell.openExternal', { url: `${repoUrl.replace(/\/+$/, '')}/pull/${ticket.pr}` })} data-testid="acceptance-open-pr">
            Open PR #{ticket.pr}
          </Button>
        ) : null}
      </p>
      <DecisionRow key={rowKey(row)} row={row} root={root} />
    </article>
  )
}

/** The right pane of a Ticket of Waits for you: a decision, not a check — its reason and where to make it. */
function TicketPane({ ticket }: { ticket: AcceptanceTicket }) {
  return (
    <article className="w-acc-pane" data-testid="acceptance-pane">
      <h2 className="w-acc-pane__title">
        {ticket.projectName} · {ref(ticket)} — {ticketTitle({ ...ticket, slug: '' })}
      </h2>
      <p className="w-acc-muted">Waits for you</p>
      <p data-testid="acceptance-reason">Blocked reason: {ticket.blockedReason ?? '—'}</p>
      <p className="w-acc-links">
        <Button variant="link" onClick={() => void openAcceptanceTicket(ticket).then(tell)} data-testid="acceptance-open-ticket">
          Open Ticket
        </Button>
        <Button variant="link" onClick={() => void openAcceptanceOrchestrator(ticket.projectId).then(tell)} data-testid="acceptance-open-orchestrator">
          Open Orchestrator
        </Button>
      </p>
    </article>
  )
}

export function AcceptanceView() {
  const { state, error: failed, selected } = useAcceptance()
  const elsewhere = useWindowMachineName()
  // A worfy on the window's Linked machine older than the view has no `acceptance.get`: say to update it there.
  const error = failed === null || elsewhere === null ? failed : (olderWorfyText('acceptance.get', failed, elsewhere) ?? failed)
  const frame = useRef<HTMLDivElement>(null)
  const row = (state?.groups ?? []).flatMap((group) => group.rows).find((each) => rowKey(each) === selected)
  // The model of the selected row's Project, kept while the rows of that Project are walked, and open only while the view
  // is on screen: an open model fetches the Project's main branch (src/main/workflow/watch.ts).
  const shown = useNavigation((navigation) => navigation.view === 'acceptance')
  const root = useProjects()?.projects.find((project) => project.id === row?.ticket.projectId)?.path
  const { model } = useWorkflow(shown ? root : undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const step = listKey(event, frame.current)
      if (step === null) return
      event.preventDefault()
      moveSelection(step)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const item = frame.current?.querySelector<HTMLElement>('[data-testid="acceptance-row"][data-selected="true"]')
    item?.scrollIntoView?.({ block: 'nearest' })
    // The focus in the list follows the selection, so Enter on it never selects the row left behind.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.w-acc-list') !== null) item?.focus()
  }, [selected])
  const empty = state !== null && state.groups.every((group) => group.rows.length === 0)
  return (
    <div ref={frame} className="w-acc" data-testid="acceptance-view">
      <h1 className="w-acc__heading">Acceptance</h1>
      {error !== null ? <p className="w-acc-error">{error}</p> : null}
      {state === null && error === null ? <p className="w-acc-muted">Reading the Tickets…</p> : null}
      {empty ? <p className="w-acc-muted" data-testid="acceptance-empty">No check waits for you</p> : null}
      {state !== null && !empty ? (
        <div className="w-acc__panes">
          <GroupList selected={selected} />
          {row === undefined ? <p className="w-acc-muted w-acc-pane">Select a check</p> : row.kind === 'item' ? <ItemPane row={row} root={root} model={model} /> : <TicketPane ticket={row.ticket} />}
        </div>
      ) : null}
    </div>
  )
}
