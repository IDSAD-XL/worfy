// The renderer's copy of each Project's checks (`checks.get`, src/shared/ipc/checks.ts), shared by
// every checks badge (ChecksBadges.tsx): the first badge of a Project starts asking, the last one
// to leave stops. The renderer asks on start, when the Ticket branches in work change, when the
// window gets focus, and every POLL_MS while the window has focus; main runs `gh` at most once a
// minute whatever the rate (src/main/github/prs.ts) and reads the gate's files every time.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ChecksSnapshot } from '../../../shared/ipc/checks'
import type { Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { useWorkflow } from '../../workflow/useWorkflow'

/** How often the checks are asked again while the window has focus. */
export const POLL_MS = 10_000

interface ChecksStore {
  byRoot: Readonly<Record<string, ChecksSnapshot>>
}

const useChecksStore = create<ChecksStore>(() => ({ byRoot: {} }))

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

/** The branch of a Ticket in work: the worktree branch it was claimed in, else `<epic>/<NN>`. */
export function ticketBranch(ticket: Pick<Ticket, 'epic' | 'num' | 'fromBranch'>): string {
  return ticket.fromBranch ?? `${ticket.epic}/${pad(ticket.num)}`
}

/** The branches whose PRs are worth a lookup: those of Tickets in work or claimed in a branch. */
export function branchesInWork(tickets: readonly Ticket[]): string[] {
  return [...new Set(tickets.filter((ticket) => ticket.state === 'work' || ticket.fromBranch !== null).map(ticketBranch))].sort()
}

/** The Project's checks, kept current while the calling component is mounted. */
export function useChecks(root: string): ChecksSnapshot | undefined {
  const { model } = useWorkflow(root)
  useEffect(() => {
    if (!model) return
    const branches = branchesInWork(model.tickets)
    const before = branchesByRoot.get(root)
    if (before !== undefined && before.join('\n') === branches.join('\n')) return
    branchesByRoot.set(root, branches)
    // New Tickets in work: ask now rather than at the next focused tick.
    void fetchChecks(root)
  }, [root, model])
  useEffect(() => {
    acquire(root)
    return () => release(root)
  }, [root])
  return useChecksStore((store) => store.byRoot[root])
}
