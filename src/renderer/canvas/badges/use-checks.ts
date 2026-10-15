// The renderer's copy of each Project's checks (`checks.get`, src/shared/ipc/checks.ts), shared by
// every checks badge (ChecksBadges.tsx): the first badge of a Project starts asking, the last one
// to leave stops. The renderer asks on start, when the Ticket branches in work change, when the
// window gets focus, and every POLL_MS while the window has focus; main runs `gh` at most once a
// minute whatever the rate (src/main/github/prs.ts) and reads the gate's files every time.
//
// A Project over several repositories (ADR-0045, `checks.repos`) is asked one repository at a
// time: a Ticket's badges come from the snapshot of the repository its `Repo:` line names, and a
// Ticket that names none has no badges. A copy is kept per Project and folder asked, the Project
// root or a repository; the Ticket branches sent with it are those of that folder's Tickets in that
// Project. The same folder may be a repository of one Project and a Project of its own: each
// Canvas asks with its own Project (`project` of `checks.get`) and keeps its own copy.
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
  /** By Project and folder asked (`keyOf`): the Project root, or one of its repositories. */
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

/** What a copy of the checks is kept by: the Project that asks and the folder it asks about. */
const keyOf = (project: string, folder: string): string => JSON.stringify([project, folder])

interface Poller {
  /** The root of the Project that asks. */
  project: string
  /** The folder asked: the Project root or one of its repositories. */
  folder: string
  users: number
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
  /** Asked again while a read was in flight: read once more when it ends. */
  again: boolean
  onFocus: () => void
}

/** By `keyOf`. */
const pollers = new Map<string, Poller>()
/** Ticket branches in work, by `keyOf`, as the badges last computed them. */
const branchesByKey = new Map<string, readonly string[]>()

async function fetchChecks(key: string): Promise<void> {
  const poller = pollers.get(key)
  if (!poller) return
  if (poller.inFlight) {
    poller.again = true
    return
  }
  poller.inFlight = true
  poller.again = false
  const { project, folder } = poller
  try {
    const result = await invoke('checks.get', { root: folder, branches: [...(branchesByKey.get(key) ?? [])], project })
    if (!pollers.has(key)) return
    if (result.ok) useChecksStore.setState(({ byRoot }) => ({ byRoot: { ...byRoot, [key]: result.value } }))
    else console.error(`checks.get ${folder} of ${project} failed:`, result.error)
  } finally {
    poller.inFlight = false
  }
  if (poller.again && pollers.get(key) === poller) await fetchChecks(key)
}

const focused = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()

function acquire(project: string, folder: string): void {
  const key = keyOf(project, folder)
  const existing = pollers.get(key)
  if (existing) {
    existing.users += 1
    return
  }
  const onFocus = () => void fetchChecks(key)
  const timer = setInterval(() => {
    if (focused()) void fetchChecks(key)
  }, POLL_MS)
  pollers.set(key, { project, folder, users: 1, timer, inFlight: false, again: false, onFocus })
  window.addEventListener('focus', onFocus)
  // Let the first render of the other badges record their branches before the first ask.
  queueMicrotask(() => void fetchChecks(key))
}

function release(key: string): void {
  const poller = pollers.get(key)
  if (!poller) return
  poller.users -= 1
  if (poller.users > 0) return
  clearInterval(poller.timer)
  window.removeEventListener('focus', poller.onFocus)
  pollers.delete(key)
  branchesByKey.delete(key)
  useChecksStore.setState(({ byRoot }) => {
    const rest = { ...byRoot }
    delete rest[key]
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
  const folder = repo === undefined ? root : repo === null ? null : repo.path
  const key = folder === null ? null : keyOf(root, folder)
  const repoName = repo?.name
  useEffect(() => {
    if (!model || key === null) return
    const tickets = repoName === undefined ? model.tickets : model.tickets.filter((ticket) => ticket.repo === repoName)
    const branches = branchesInWork(tickets)
    const before = branchesByKey.get(key)
    if (before !== undefined && before.join('\n') === branches.join('\n')) return
    branchesByKey.set(key, branches)
    // New Tickets in work: ask now rather than at the next focused tick.
    void fetchChecks(key)
  }, [key, repoName, model])
  useEffect(() => {
    if (key === null || folder === null) return
    acquire(root, folder)
    return () => release(key)
  }, [key, root, folder])
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
