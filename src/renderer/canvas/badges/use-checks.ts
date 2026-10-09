// The renderer's copy of each Project's checks (`checks.get`, src/shared/ipc/checks.ts), shared by
// every checks badge (ChecksBadges.tsx): the first badge of a Project starts asking, the last one
// to leave stops. The renderer asks on start, when the Ticket branches in work change, when the
// window gets focus, and every POLL_MS while the window has focus; main runs `gh` at most once a
// minute whatever the rate (src/main/github/prs.ts) and reads the gate's files every time.
//
// A Project over several repositories (ADR-0045, `checks.repos`) is asked one repository at a
// time: a Ticket's badges come from the snapshot of the repository its `Repo:` line names, and a
// Ticket that names none has no badges. A copy is kept per folder asked, the Project root or a
// repository; the Ticket branches sent with it are those of that folder's Tickets.
import { useEffect } from 'react'
import { create } from 'zustand'
import {
  branchNameSchema,
  checksSourceOfTicket,
  projectReposSchema,
  type ChecksSnapshot,
  type ProjectRepos,
  type ProjectRepoView,
} from '../../../shared/ipc/checks'
import { parseTicketBranch } from '../../../shared/workflow/ticket-ref'
import type { Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { useWorkflow } from '../../workflow/useWorkflow'

/** How often the checks are asked again while the window has focus. */
export const POLL_MS = 10_000

interface ChecksStore {
  /** By the folder asked: the Project root, or one of its repositories. */
  byRoot: Readonly<Record<string, ChecksSnapshot>>
  /** The mode and repositories of each Project root, once `checks.repos` answered. */
  repos: Readonly<Record<string, ProjectRepos>>
}

const useChecksStore = create<ChecksStore>(() => ({ byRoot: {}, repos: {} }))

/** A Project of one repository, as worfy saw every Project before: its root is asked. */
const SINGLE: ProjectRepos = Object.freeze({ mode: 'full', repos: [] })
const reposAsked = new Set<string>()

/**
 * Asks main once per Project root which repositories it has. An answer of another shape, or none
 * (an older Linked machine has no `checks.repos`), counts as one repository: the root is asked.
 */
function fetchRepos(root: string): void {
  if (reposAsked.has(root)) return
  reposAsked.add(root)
  void invoke('checks.repos', { root }).then((result) => {
    const parsed = result.ok ? projectReposSchema.safeParse(result.value) : null
    if (!parsed?.success) console.warn(`checks.repos ${root}: one repository is assumed`, result.ok ? 'unexpected answer' : result.error)
    // A failed call is asked again by the next badge that mounts; an answer is kept.
    if (!result.ok) reposAsked.delete(root)
    const repos = parsed?.success ? parsed.data : SINGLE
    useChecksStore.setState((store) => ({ repos: { ...store.repos, [root]: repos } }))
  })
}

/** The mode and repositories of the Project at `root`; undefined until main answered. */
export function useProjectRepos(root: string): ProjectRepos | undefined {
  useEffect(() => fetchRepos(root), [root])
  return useChecksStore((store) => store.repos[root])
}

interface Poller {
  users: number
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
  /** Asked again while a read was in flight: read once more when it ends. */
  again: boolean
  onFocus: () => void
}

const pollers = new Map<string, Poller>()
/** Ticket branches in work, by Project, as the badges last computed them. */
const branchesByRoot = new Map<string, readonly string[]>()

async function fetchChecks(root: string): Promise<void> {
  const poller = pollers.get(root)
  if (!poller) return
  if (poller.inFlight) {
    poller.again = true
    return
  }
  poller.inFlight = true
  poller.again = false
  try {
    const result = await invoke('checks.get', { root, branches: [...(branchesByRoot.get(root) ?? [])] })
    if (!pollers.has(root)) return
    if (result.ok) useChecksStore.setState(({ byRoot }) => ({ byRoot: { ...byRoot, [root]: result.value } }))
    else console.error(`checks.get ${root} failed:`, result.error)
  } finally {
    poller.inFlight = false
  }
  if (poller.again && pollers.get(root) === poller) await fetchChecks(root)
}

const focused = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()

function acquire(root: string): void {
  const existing = pollers.get(root)
  if (existing) {
    existing.users += 1
    return
  }
  const onFocus = () => void fetchChecks(root)
  const timer = setInterval(() => {
    if (focused()) void fetchChecks(root)
  }, POLL_MS)
  pollers.set(root, { users: 1, timer, inFlight: false, again: false, onFocus })
  window.addEventListener('focus', onFocus)
  // Let the first render of the other badges record their branches before the first ask.
  queueMicrotask(() => void fetchChecks(root))
}

function release(root: string): void {
  const poller = pollers.get(root)
  if (!poller) return
  poller.users -= 1
  if (poller.users > 0) return
  clearInterval(poller.timer)
  window.removeEventListener('focus', poller.onFocus)
  pollers.delete(root)
  branchesByRoot.delete(root)
  useChecksStore.setState(({ byRoot }) => {
    const rest = { ...byRoot }
    delete rest[root]
    return { byRoot: rest }
  })
}

const pad = (num: number): string => String(num).padStart(2, '0')

/**
 * The branch of a Ticket in work: the worktree branch it was claimed in, else the branch its
 * `Branch:` line names (Silent mode), else `<epic>/<NN>`.
 */
export function ticketBranch(ticket: Pick<Ticket, 'epic' | 'num' | 'fromBranch' | 'branch'>): string {
  return ticket.fromBranch ?? (ticket.branch || `${ticket.epic}/${pad(ticket.num)}`)
}

/**
 * The branches whose PRs are worth a lookup: those of Tickets in work or claimed in a branch.
 * Only branches `checks.get` takes are sent — `<epic>/<NN>`, or the Ticket's own `Branch:` — a
 * branch it refuses (`аудит/03`, `Q4 work/05` from an Epic named so) would make it refuse the
 * whole call, and every badge of the Project would go.
 */
export function branchesInWork(tickets: readonly Ticket[]): string[] {
  const branches = tickets
    .filter((ticket) => ticket.state === 'work' || ticket.fromBranch !== null)
    .flatMap((ticket) => {
      const branch = ticketBranch(ticket)
      const taken = branchNameSchema.safeParse(branch).success && (parseTicketBranch(branch) !== null || branch === ticket.branch)
      return taken ? [branch] : []
    })
  return [...new Set(branches)].sort()
}

/**
 * The checks of one folder of the Project at `root`, kept current while the calling component is
 * mounted: of the root itself when `repo` is undefined, of that repository (with its Tickets'
 * branches) when it is one, of nothing — no asking at all — when it is null.
 */
export function useChecks(root: string, repo?: ProjectRepoView | null): ChecksSnapshot | undefined {
  const { model } = useWorkflow(root)
  const key = repo === undefined ? root : repo === null ? null : repo.path
  const repoName = repo?.name
  useEffect(() => {
    if (!model || key === null) return
    const tickets = repoName === undefined ? model.tickets : model.tickets.filter((ticket) => ticket.repo === repoName)
    const branches = branchesInWork(tickets)
    const before = branchesByRoot.get(key)
    if (before !== undefined && before.join('\n') === branches.join('\n')) return
    branchesByRoot.set(key, branches)
    // New Tickets in work: ask now rather than at the next focused tick.
    void fetchChecks(key)
  }, [key, repoName, model])
  useEffect(() => {
    if (key === null) return
    acquire(key)
    return () => release(key)
  }, [key])
  return useChecksStore((store) => (key === null ? undefined : store.byRoot[key]))
}

/**
 * A Ticket's checks: from the Project root in a Project of one repository, from the Ticket's own
 * repository in a Project over several; none for a Ticket there that names no repository of it,
 * and none until main said which repositories the Project has.
 */
export function useTicketChecks(root: string, ticket: Pick<Ticket, 'repo'>): ChecksSnapshot | undefined {
  const repos = useProjectRepos(root)
  const source = repos === undefined ? null : checksSourceOfTicket(repos.repos, ticket)
  return useChecks(root, source === null || source.kind === 'none' ? null : source.kind === 'repo' ? source.repo : undefined)
}
