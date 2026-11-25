// The CI of a repository's main branch (worfy-assistant ticket 21): one read-only `gh api graphql` call gives the
// newest commits of the default branch with their checks (`statusCheckRollup`) and the PRs each belongs to
// (`associatedPullRequests`). The reader says whether the branch is red or green and, when red, which commit started the
// red run, when it went red and the PR merged as that commit. The caller runs gh as the Project's account
// (PrTracker.gh); this file runs nothing itself.
//
// - The state of the branch is that of its newest settled commit: a commit whose checks still run, or that has none (a
//   push CI skipped), says nothing, and the one before it decides. The agents' marks (`review`, `check/*`, `deploy`,
//   MARK_CONTEXTS) are left out, as ciOf leaves them out for a PR.
// - A red run starts at the oldest red commit after the newest green one; it went red when the first of that commit's
//   checks failed (its committer date when no check says).
// - The PR of a commit is the one merged as it (its merge commit); else a merged PR into the branch that holds it (a
//   rebase merge); none for a push without a PR.
import { z } from 'zod'
import { ciOf } from './prs'

/** How many of the newest commits of the branch one read looks at. */
export const MAIN_CI_HISTORY = 20

/** How many checks of one commit one read looks at. */
export const MAIN_CI_CHECKS = 100

/** What a read of a main branch says. */
export type MainBranchCi = {
  /** `owner/name`. */
  repo: string
  branch: string
} & (
  | {
      state: 'red'
      /** The first commit of the red run. */
      commit: string
      /** When the branch went red, ms since the epoch. */
      redSince: number
      pr: { number: number; title: string } | null
    }
  | { state: 'green' }
)

const checkSchema = z
  .object({
    __typename: z.string().optional(),
    name: z.string().nullish(),
    context: z.string().nullish(),
    status: z.string().nullish(),
    conclusion: z.string().nullish(),
    state: z.string().nullish(),
    startedAt: z.string().nullish(),
    completedAt: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .loose()

const pullSchema = z.object({ number: z.number().int().positive(), title: z.string(), state: z.string().nullish(), baseRefName: z.string().nullish(), mergeCommit: z.object({ oid: z.string() }).nullish() }).loose()

const commitSchema = z
  .object({
    oid: z.string(),
    committedDate: z.string().nullish(),
    statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(checkSchema.nullable()) }) }).nullish(),
    associatedPullRequests: z.object({ nodes: z.array(pullSchema.nullable()) }).nullish(),
  })
  .loose()
type Commit = z.output<typeof commitSchema>

const answerSchema = z.object({
  data: z.object({
    repository: z.object({
      defaultBranchRef: z.object({ name: z.string(), target: z.object({ history: z.object({ nodes: z.array(commitSchema) }) }) }).nullish(),
    }),
  }),
})

// shortcut: the newest MAIN_CI_HISTORY commits and MAIN_CI_CHECKS checks of each; a red run longer than that starts at the oldest red commit seen, page `history` when that matters.
const MAIN_CI_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      name
      target {
        ... on Commit {
          history(first: ${MAIN_CI_HISTORY}) {
            nodes {
              oid
              committedDate
              statusCheckRollup {
                contexts(first: ${MAIN_CI_CHECKS}) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion startedAt completedAt }
                    ... on StatusContext { context state createdAt }
                  }
                }
              }
              associatedPullRequests(first: 5) { nodes { number title state baseRefName mergeCommit { oid } } }
            }
          }
        }
      }
    }
  }
}`

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

const checksOf = (commit: Commit) => (commit.statusCheckRollup?.contexts.nodes ?? []).filter((check) => check !== null)

/** A commit's CI: failing, passing, or null while it says nothing yet (checks running, or none). */
function stateOf(commit: Commit): 'failing' | 'passing' | null {
  const state = ciOf(checksOf(commit))
  return state === 'failing' || state === 'passing' ? state : null
}

/** When the first check of a red commit failed; its committer date when no failed check gives a time. */
function failedAt(commit: Commit): number | null {
  const times = checksOf(commit).flatMap((check) => {
    const failed = (check.conclusion != null && FAILED.has(check.conclusion)) || (check.status == null && check.state != null && FAILED.has(check.state))
    const at = failed ? Date.parse(check.completedAt ?? check.createdAt ?? '') : Number.NaN
    return Number.isNaN(at) ? [] : [at]
  })
  if (times.length > 0) return Math.min(...times)
  const committed = Date.parse(commit.committedDate ?? '')
  return Number.isNaN(committed) ? null : committed
}

function prOf(commit: Commit, branch: string): { number: number; title: string } | null {
  const pulls = (commit.associatedPullRequests?.nodes ?? []).filter((pull) => pull !== null)
  const pull = pulls.find((each) => each.mergeCommit?.oid === commit.oid) ?? pulls.find((each) => each.state === 'MERGED' && each.baseRefName === branch)
  return pull === undefined ? null : { number: pull.number, title: pull.title }
}

/**
 * The CI of the default branch of `repo` (`owner/name`) by one `gh api graphql` call `gh` runs; null when the branch
 * says nothing yet (no settled commit among the newest, an empty repository). A failed call or an answer that cannot
 * be read rejects.
 */
export async function readMainBranchCi(gh: (args: readonly string[]) => Promise<string>, repo: string, now: () => number = Date.now): Promise<MainBranchCi | null> {
  const [owner = '', name = ''] = repo.split('/')
  const stdout = await gh(['api', 'graphql', '-f', `query=${MAIN_CI_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`])
  const ref = answerSchema.parse(JSON.parse(stdout)).data.repository.defaultBranchRef
  if (ref == null) return null
  const branch = ref.name
  const commits = ref.target.history.nodes
  const newest = commits.findIndex((commit) => stateOf(commit) !== null)
  if (newest === -1) return null
  if (stateOf(commits[newest]!) === 'passing') return { repo, branch, state: 'green' }
  let first = commits[newest]!
  for (const commit of commits.slice(newest + 1)) {
    const state = stateOf(commit)
    if (state === 'passing') break
    if (state === 'failing') first = commit
  }
  return { repo, branch, state: 'red', commit: first.oid, redSince: failedAt(first) ?? now(), pr: prOf(first, branch) }
}
