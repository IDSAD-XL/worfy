// The share of accepted advice of a Project (Epic worfy-product-session, ticket 14; the spec, Q9): how
// many of the advisor's proposals the Product owner accepted, rejected or has not decided yet. It counts
// two things, in every file of the Project's Product Session folder (ADR-0101):
//
//   - the Mind map nodes with `advice: true` of every topic: a Decision is accepted or rejected by its
//     status now (mind_map_decide), any other node waits. A node whose source is a critic's review is an
//     objection of that review put on the map: the review counts it, so the node does not, even with
//     `advice: true` — one objection is counted once (the spec of worfy-product-session, decided without the owner, item 10);
//   - the objections of every critic's review (`critic/<epic>-<YYYY-MM-DD>.md`, harness/agents/critic.md):
//     each `Owner decision:` line, `accepted — <reason>` or `rejected — <reason>`, empty while it waits.
//
// It is computed whenever it is read and stored nowhere. Advice without a decision is not in the share.
// It is a count of the owner's decisions, not a measure of how good the advice is (owner, 2026-11-08).
// A file that cannot be read or parsed is left out and named in `skipped`; it never ends the count.
import { z } from 'zod'
import type { MindMapNode } from './mind-map'
import { CRITIC_DIR, MIND_MAP_FILE } from './paths'

export const adviceCountSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
})
export type AdviceCount = z.output<typeof adviceCountSchema>

export const adviceShareSchema = z.object({
  /** The advice nodes of every topic's Mind map. */
  mindMap: adviceCountSchema,
  /** The objections of every critic's review. */
  critic: adviceCountSchema,
  /** The files left out: relative to the Product Session folder with `/`, and why. */
  skipped: z.array(z.object({ file: z.string(), message: z.string() })),
})
export type AdviceShare = z.output<typeof adviceShareSchema>

/** A topic as main reads it (src/main/product/topic.ts): its nodes are empty when mind-map.json has an error. */
export interface ShareTopic {
  name: string
  nodes: readonly MindMapNode[]
  errors: readonly { file: string; message: string }[]
}

/** A file of `critic/`: its text, or why it could not be read. */
export type ShareReview = { file: string; text: string } | { file: string; error: string }

const none = (): AdviceCount => ({ accepted: 0, rejected: 0, pending: 0 })

/**
 * A source that names a file of the critic's folder: `docs/product/critic/<file>.md`, `critic/<file>.md`
 * or the absolute path of Silent mode, with `/` or `\\`, maybe followed by a line or an anchor.
 */
const CRITIC_SOURCE = /(?:^|[\\/])critic[\\/][^\\/]+\.md(?![^\s#:,;)])/u

/** True when the node is an objection of a critic's review put on the Mind map: the review counts it. */
export const fromCriticReview = (node: MindMapNode): boolean => node.source !== undefined && CRITIC_SOURCE.test(node.source)

/**
 * The advice of one Mind map: nodes with `advice: true`, by the status of a Decision; any other kind waits.
 * A node taken from a critic's review is left out: its review's `Owner decision:` line counts it.
 */
export function mindMapAdvice(nodes: readonly MindMapNode[]): AdviceCount {
  const count = none()
  for (const node of nodes) {
    if (node.advice !== true || fromCriticReview(node)) continue
    if (node.kind === 'decision' && node.status !== undefined) count[node.status] += 1
    else count.pending += 1
  }
  return count
}

const DECISION_LINE = /^Owner decision:[ \t]*(.*)$/u
const DECIDED = /^(accepted|rejected)\b/iu

/**
 * The objections of one critic's review, by their `Owner decision:` lines outside code blocks: one that
 * starts with `accepted` or `rejected` is decided, any other — empty included — waits. Text that is no
 * review has no such line and counts nothing.
 */
export function criticAdvice(text: string): AdviceCount {
  const count = none()
  let fence = ''
  for (const line of text.split(/\r?\n/u)) {
    // shortcut: any line of the fence's character, at least as long, closes it, even with text after it
    // (src/main/product/topic.ts is stricter); redo when a review quotes code whose lines start with such a run.
    const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fence !== '') {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    const decision = DECISION_LINE.exec(line)
    if (decision === null) continue
    const word = DECIDED.exec(decision[1]!.trim())?.[1]?.toLowerCase()
    if (word === 'accepted' || word === 'rejected') count[word] += 1
    else count.pending += 1
  }
  return count
}

const add = (into: AdviceCount, more: AdviceCount): void => {
  into.accepted += more.accepted
  into.rejected += more.rejected
  into.pending += more.pending
}

/** The share of every topic and every review of a Project's Product Session folder. */
export function adviceShare({ topics, reviews }: { topics: readonly ShareTopic[]; reviews: readonly ShareReview[] }): AdviceShare {
  const share: AdviceShare = { mindMap: none(), critic: none(), skipped: [] }
  for (const topic of topics) {
    // Only an error of mind-map.json leaves its nodes out; one of map.md or a Ticket of the map does not.
    // One entry per file: checkMindMap names every broken node, the first one says enough.
    const broken = topic.errors.find((error) => error.file === MIND_MAP_FILE)
    if (broken !== undefined) share.skipped.push({ file: `${topic.name}/${MIND_MAP_FILE}`, message: broken.message })
    add(share.mindMap, mindMapAdvice(topic.nodes))
  }
  for (const review of reviews) {
    if ('error' in review) share.skipped.push({ file: `${CRITIC_DIR}/${review.file}`, message: review.error })
    else add(share.critic, criticAdvice(review.text))
  }
  return share
}

/** Both sources together; `decided` — accepted and rejected — is what the share is of. */
export function adviceTotals(share: AdviceShare): AdviceCount & { decided: number } {
  const accepted = share.mindMap.accepted + share.critic.accepted
  const rejected = share.mindMap.rejected + share.critic.rejected
  return { accepted, rejected, pending: share.mindMap.pending + share.critic.pending, decided: accepted + rejected }
}
