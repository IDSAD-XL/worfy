import { checksSourcesOfTicket, pullOfTicket, worktreeOfCwd, worktreeOfTicket, type GateOutcome, type ProjectRepoView, type PullRequest, type WorktreeChecks } from '../../../shared/ipc/checks'
import { TEMP_FOLDER_LABEL, TEMP_FOLDER_WARNING } from '../../../shared/temp-folder'
import type { Ticket } from '../../../shared/workflow/types'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { useWorkflow } from '../../workflow/useWorkflow'
import { Chip, type Status } from '../../theme/Chip'
import type { SlotProps } from './index'
import { useChecks, useProjectRepos } from './use-checks'
import '../epic-frame.css'
import './checks-badges.css'

// Gate, PR, CI and the reviewer's verdict on a Ticket, and the gate on a Session (ticket 17). Under
// the Ticket's stepper (worfy-pipeline ticket 05) they are the details of its Stage. The verdict is
// the `review` mark on the PR's head commit (ADR-0067), as main reads it into the snapshot.
//
// The snapshot comes from use-checks.ts, one copy per Project for all badges — per repository in a
// Project over several, where a Ticket's badges come from its own repository's copy. A Ticket over
// several repositories (ADR-0104) has a row of badges per repository its `Repo:` lines name, each
// from that repository's copy and led by its name; nothing is summed across them. Colours are the
// ready / working / blocked tokens, always with a label.

export const order = 10

// ── the chips ────────────────────────────────────────────────────────────────

/** A neutral chip that names no state: no icon, so the row keeps the width ticket-card.ts gives it room for. */
function Neutral({ label, title, testId }: { label: string; title?: string; testId: string }) {
  return <Chip variant="neutral" icon={null} label={label} data-testid={testId} title={title} />
}

/** A status chip in the box that carries its test id and its value: the tests read the face inside it. */
function Badge({ status, label, testId, value, title }: { status: Status; label: string; testId: string; value?: string; title?: string }) {
  return (
    <span data-testid={testId} data-value={value} title={title}>
      <Chip variant={status} label={label} />
    </span>
  )
}

const GATE: Record<Exclude<GateOutcome, 'none'>, { status: Status; label: string }> = {
  green: { status: 'ready', label: 'gate green' },
  red: { status: 'blocked', label: 'gate red' },
  unverified: { status: 'working', label: 'gate unverified' },
}

function GateBadge({ outcome, path }: { outcome: GateOutcome; path: string }) {
  // The tooltip adds the worktree's path to the label; the label itself is never cut (checks-badges.css).
  if (outcome === 'none') return <Neutral label="gate: no data" title={`gate: no data — ${path}`} testId="checks-gate" />
  const { status, label } = GATE[outcome]
  return <Badge status={status} label={label} testId="checks-gate" value={outcome} title={`${label} — ${path}`} />
}

/** The worktree lies inside %TEMP% of Windows (worfy-windows ticket 61): the sign of the "Add project" Folder step. */
function TempBadge({ path }: { path: string }) {
  return <Badge status="working" label={TEMP_FOLDER_LABEL} testId="checks-temp" title={`${TEMP_FOLDER_WARNING} — ${path}`} />
}

const CI: Record<NonNullable<PullRequest['ci']>, Status> = { passing: 'ready', failing: 'blocked', running: 'working' }

function PullBadges({ pull }: { pull: PullRequest }) {
  const label = pull.state === 'OPEN' ? `PR #${pull.number}` : `PR #${pull.number} ${pull.state === 'MERGED' ? 'merged' : 'closed'}`
  return (
    <>
      <span className="w-checks__pr" data-testid="checks-pr" data-value={pull.state} title={pull.url}>
        {label}
      </span>
      {pull.ci ? <Badge status={CI[pull.ci]} label={`CI ${pull.ci}`} testId="checks-ci" value={pull.ci} /> : null}
      {pull.verdict ? <Badge status={pull.verdict === 'VERIFIED' ? 'ready' : 'blocked'} label={pull.verdict} testId="checks-verdict" value={pull.verdict} title={`${pull.verdict} — the review mark on the PR's head commit`} /> : null}
    </>
  )
}

/** Everything the row shows, in one line for its tooltip. */
function summary(worktree: WorktreeChecks | null, pull: PullRequest | null, unavailable: boolean): string {
  const parts: string[] = []
  if (worktree) parts.push(worktree.gate.outcome === 'none' ? 'gate: no data' : GATE[worktree.gate.outcome].label)
  if (worktree?.insideTemp) parts.push(TEMP_FOLDER_LABEL)
  if (pull) parts.push(`PR #${pull.number} ${pull.state.toLowerCase()}`, ...(pull.ci ? [`CI ${pull.ci}`] : []), ...(pull.verdict ? [pull.verdict] : []))
  if (unavailable) parts.push('gh unavailable')
  return parts.join(' · ')
}

/**
 * The badges of a Ticket from one folder's checks: the Project root (`repo` undefined) or one of its repositories.
 * `label`: a Ticket over several repositories leads the row with the repository's name.
 */
function TicketChecksIn({ root, ticket, repo, label }: { root: string; ticket: Ticket; repo: ProjectRepoView | undefined; label: boolean }) {
  const snapshot = useChecks(root, repo)
  const { model } = useWorkflow(root)
  if (!snapshot) return null
  const worktree = worktreeOfTicket(snapshot, ticket, model?.tickets ?? [ticket])
  const pull = snapshot.gh.available ? pullOfTicket(snapshot, ticket) : null
  const candidate = worktree !== null || ticket.state === 'work' || ticket.fromBranch !== null
  const unavailable = !snapshot.gh.available && candidate
  if (!worktree && !pull && !unavailable) return null
  const name = label && repo !== undefined ? repo.name : null
  const line = summary(worktree, pull, unavailable)
  return (
    <span className="w-checks" data-testid="checks-badges" data-repo={name ?? undefined} title={name === null ? line : `${name}: ${line}`}>
      {name !== null ? (
        <span className="w-checks__repo w-mono" data-testid="checks-repo">
          {name}
        </span>
      ) : null}
      {worktree ? <GateBadge outcome={worktree.gate.outcome} path={worktree.path} /> : null}
      {worktree?.insideTemp ? <TempBadge path={worktree.path} /> : null}
      {pull ? <PullBadges pull={pull} /> : null}
      {unavailable ? <Neutral label="gh unavailable" title={snapshot.gh.error ?? undefined} testId="checks-gh-unavailable" /> : null}
    </span>
  )
}

/**
 * A Ticket's badges: from the Project root in a Project of one repository; in a Project over several, from each
 * repository the Ticket names — one row, as before, for a Ticket of one of them, a row per repository led by its name
 * for a Ticket over several (ADR-0104); none for a Ticket that names none, and none until main said which
 * repositories the Project has.
 */
function TicketChecks({ root, ticket }: { root: string; ticket: Ticket }) {
  const repos = useProjectRepos(root)
  // The model names the Ticket branches each folder is asked with: read it while main says which repositories there are.
  useWorkflow(root)
  if (repos === undefined) return null
  const sources = checksSourcesOfTicket(repos.repos, ticket)
  if (sources === 'project') return <TicketChecksIn root={root} ticket={ticket} repo={undefined} label={false} />
  if (sources.length === 1) return <TicketChecksIn root={root} ticket={ticket} repo={sources[0]} label={false} />
  if (sources.length === 0) return null
  return (
    <span className="w-checks-repos" data-testid="checks-repos">
      {sources.map((repo) => (
        <TicketChecksIn key={repo.name} root={root} ticket={ticket} repo={repo} label />
      ))}
    </span>
  )
}

function SessionChecks({ root, sessionId }: { root: string; sessionId: string }) {
  const snapshot = useChecks(root)
  const { live, history } = useClaudeHome(root)
  const cwd = live?.find((each) => each.sessionId === sessionId)?.cwd ?? history.find((each) => each.sessionId === sessionId)?.cwd
  if (!snapshot || cwd === undefined) return null
  const worktree = worktreeOfCwd(snapshot, cwd)
  if (!worktree) return null
  return (
    <span className="w-checks" data-testid="checks-badges">
      <GateBadge outcome={worktree.gate.outcome} path={worktree.path} />
      {worktree.insideTemp ? <TempBadge path={worktree.path} /> : null}
    </span>
  )
}

export default function ChecksBadges({ subject }: SlotProps) {
  switch (subject.kind) {
    case 'ticket':
      return <TicketChecks root={subject.root} ticket={subject.ticket} />
    case 'session':
      return <SessionChecks root={subject.root} sessionId={subject.sessionId} />
    case 'epic':
      return null
  }
}
