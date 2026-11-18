// The pure reads of one row of a PR inbox snapshot (src/shared/ipc/pr-inbox.ts) that both sides need: which Ticket a
// PR belongs to, and how many of its threads wait for the user. The renderer's Pull requests view, its review threads
// badge and main's "Fix checks", "Resolve conflicts" and "Address comments" (src/main/actions/launch.ts,
// worfy-pr-follow ticket 01) read them alike; src/shared imports no renderer module, so they live here.
import type { PrInboxRow } from '../ipc/pr-inbox'
import { repoFactsOf, type Ticket } from '../workflow/types'

/** The same GitHub login, without regard to case, as main compares them (src/main/github/inbox-groups.ts, `same`). */
export const sameLogin = (login: string | null, viewer: string): boolean => login !== null && login.toLowerCase() === viewer.toLowerCase()

const nn = (num: number): string => String(num).padStart(2, '0')

/**
 * The threads of a PR that wait for the user's answer, by main's rule for "Needs my answer" (src/main/github/inbox-groups.ts,
 * `owesAnswer`): unresolved, with a last comment that is not the user's, and on someone else's PR only a thread the user
 * wrote in. Without a viewer — before the first search — none: main then knows no user who could owe an answer.
 */
export function waitingThreads(row: Pick<PrInboxRow, 'threads' | 'author'>, viewer: string | null): number {
  if (viewer === null) return 0
  const mine = sameLogin(row.author, viewer)
  return row.threads.filter((thread) => {
    const last = thread.comments.at(-1)
    if (thread.isResolved || last === undefined || sameLogin(last.author, viewer)) return false
    return mine || thread.comments.some((comment) => sameLogin(comment.author, viewer))
  }).length
}

/**
 * Whether a repository as a Ticket's header names it — a `Repo:` name of the layout (`lib`, harness/bin/TICKETS.md) or
 * an `owner/name` — is the PR's `owner/name`. A layout name is compared with the name part: the renderer does not know
 * which folder's `origin` it is.
 */
// shortcut: a layout name is matched by the GitHub name of the repository; a layout name that differs from it is not found. Map the names through main's remotes (remoteRepos) when such a Project asks for its chips.
export function sameRepo(named: string, repo: string): boolean {
  const name = named.toLowerCase()
  const full = repo.toLowerCase()
  return name.includes('/') ? name === full : name === full.slice(full.indexOf('/') + 1)
}

/**
 * The Ticket a PR belongs to: the one whose `PR:` line names it, else the one whose branch is the PR's, by its
 * `Branch:` line or `<epic>/<NN>`. A `PR:` line with a repository (`PR: lib#41`) names that repository's PR; a bare
 * `PR: #N` names PR N of the Ticket's `Repo:` repositories, or of any repository when it has none (a Project of one
 * repository).
 */
export function ticketOfRow<T extends Ticket>(row: Pick<PrInboxRow, 'repo' | 'number' | 'headRefName'>, tickets: readonly T[]): T | undefined {
  const byPr = tickets.find((ticket) => {
    const facts = repoFactsOf(ticket)
    return facts.prs.some((pr) => {
      if (pr.number !== row.number) return false
      const scope = pr.repo !== null ? [pr.repo] : facts.repos
      return scope.length === 0 || scope.some((named) => sameRepo(named, row.repo))
    })
  })
  if (byPr !== undefined) return byPr
  return tickets.find((ticket) => (ticket.branch ?? `${ticket.epic}/${nn(ticket.num)}`) === row.headRefName)
}
