// The duty «CI of the main branch is red» (worfy-assistant ticket 07; spec, story 8): a read of a Project's main branch
// becomes a «nothing happened» condition of the attention core — the branch stays red for the duty's threshold — so the
// item comes only after N minutes from the first red run, names the PR after which the branch went red, and is
// raised once per red commit. Green again closes the item and disarms the condition. Nothing here reads GitHub: the
// caller gives what it read.
import type { AttentionCore } from '../core/attention-core'

/** One read of the CI of a Project's main branch. */
export type MainCiObservation = {
  projectId: string
  /** `owner/name`. */
  repo: string
  branch: string
} & (
  | {
      state: 'red'
      /** The first commit of the red run: one item per red run. */
      commit: string
      /** When the branch went red, ms since the epoch. */
      redSince: number
      /** The PR whose merge made that commit; null for a push without a PR. */
      pr: { number: number; title: string } | null
    }
  | { state: 'green' }
)

/** Gives one read of the main branch to the core; the item comes `thresholdMs` after the branch went red. */
export function mainCiAttention(core: Pick<AttentionCore, 'expect' | 'resolve'>, read: MainCiObservation, thresholdMs: number): void {
  const id = `ci:${read.repo}@${read.branch}`
  const subject = { kind: 'check' as const, id, label: `CI of ${read.branch} · ${read.repo}` }
  if (read.state === 'green') {
    core.resolve(read.projectId, subject)
    return
  }
  const cause = read.pr === null ? read.commit.slice(0, 9) : `${read.repo}#${read.pr.number} ${read.pr.title}`
  core.expect({
    source: 'ci',
    id,
    revision: read.commit,
    projectId: read.projectId,
    subject,
    kind: 'main-red',
    text: `The CI of ${read.branch} is red since ${cause}`,
    duty: 'main-ci-red',
    ...(read.pr === null ? {} : { pr: { repo: read.repo, number: read.pr.number, title: read.pr.title } }),
    quietMs: thresholdMs,
    from: read.redSince,
  })
}
