import type { AgentEvent } from '../../shared/agent/events'
import { harnessName } from '../../shared/agent/subagent-type'
import type { SubagentInfo, SubagentStatus } from '../../shared/transcript/subagents'

// The words of the agents list of a Product Session (ProductAgentsList.tsx, worfy-product-session
// ticket 20; Q6 of the owner's decisions of 2026-11-08): each agent by a name a person reads and its
// state — «Critic — working · 3 objections», «Idea generator — done».
//
// The critic's number of objections comes from its own transcript: the Write of its review into the
// critic folder (harness/agents/critic.md: `critic/<epic>-<YYYY-MM-DD>.md`, objections `### 1.` to
// `### 3.` under `## Objections`). The renderer reads no file of `docs/product/critic/` itself — `docs.read`
// serves HANDOFF.md and ADRs only, and `product.share` gives the sum of every review — so the review is
// taken as the critic wrote it; a later edit of the file by hand does not change the number.

/** The Harness Subagent types the list names for a person; any other type is shown as it is. */
const NAMES: Readonly<Record<string, string>> = { critic: 'Critic', 'product-ideas': 'Idea generator' }

const harnessType = (info: Pick<SubagentInfo, 'subagentType'>): string | null => (info.subagentType === null ? null : harnessName(info.subagentType))

/** `worfy:critic` (or the bare `critic` of older transcripts). */
export const isCritic = (info: Pick<SubagentInfo, 'subagentType'>): boolean => harnessType(info) === 'critic'

/** The name in the list: «Critic», «Idea generator»; else the Subagent type as it is, its name, «Subagent». */
export function productAgentName(info: Pick<SubagentInfo, 'subagentType' | 'name'>): string {
  const own = harnessType(info)
  if (own !== null && Object.hasOwn(NAMES, own)) return NAMES[own]!
  return info.subagentType ?? info.name ?? 'Subagent'
}

const STATES: Readonly<Record<SubagentStatus, string>> = { running: 'working', done: 'done', error: 'error', interrupted: 'interrupted' }

/** The state after the name: «working», «done · 3 objections»; `objections` only when the review is known. */
export function productAgentState(status: SubagentStatus, objections?: number): string {
  if (objections === undefined) return STATES[status]
  const count = objections === 0 ? 'no objections' : objections === 1 ? '1 objection' : `${objections} objections`
  return `${STATES[status]} · ${count}`
}

/** A file of the critic folder, with `/` or `\`. */
const CRITIC_FILE = /(?:^|[\\/])critic[\\/][^\\/]+\.md$/u

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The text of the last review the critic wrote with Write in these events; undefined when it wrote none. */
export function criticReviewOf(events: readonly AgentEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'tool_use' || event.name !== 'Write' || !isObject(event.input)) continue
    const { file_path: path, content } = event.input
    if (typeof path === 'string' && typeof content === 'string' && CRITIC_FILE.test(path)) return content
  }
  return undefined
}

/**
 * The objections of a review: the `### N.` headings of its `## Objections` section, outside code blocks.
 * `None.` there counts 0.
 */
export function objectionCount(text: string): number {
  let count = 0
  let section = ''
  let fence = ''
  for (const line of text.split(/\r?\n/u)) {
    const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fence !== '') {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    const heading = /^##[ \t]+(.*?)[ \t]*$/u.exec(line)
    if (heading !== null) section = heading[1]!
    else if (section === 'Objections' && /^###[ \t]+\d+\.(?:[ \t]|$)/u.test(line)) count += 1
  }
  return count
}
