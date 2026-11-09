import type { AgentEvent } from '../../shared/agent/events'
import { DRAFTS_DIR, isProductTopicName, PRODUCT_SILENT_DIR } from '../../shared/product/paths'
import { linesOutsideCodeBlocks } from '../../shared/product/share'
import { harnessName } from '../../shared/agent/subagent-type'
import type { SubagentInfo, SubagentStatus } from '../../shared/transcript/subagents'

// The words of the agents list of a Product Session (ProductAgentsList.tsx, worfy-product-session
// tickets 20 and 22; Q6 of the owner's decisions of 2026-11-08): each agent by a name a person reads and
// its state with its time — «Critic» · «working · 1 min · 3 objections», «Idea generator» · «done · 4 min
// ago».
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

const MINUTE_MS = 60 * 1000

/** A span of time in whole minutes, as the prototype words it: «1 min», «1 h 05 min»; under a minute, null. */
function minutesOf(ms: number): string | null {
  const minutes = Math.floor(ms / MINUTE_MS)
  if (minutes < 1) return null
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/**
 * The time on an agent's state line (ticket 22), at `now`: how long a running agent has worked — «1 min»,
 * «under 1 min» — and how long ago a finished one ended — «4 min ago», «just now». Undefined when the
 * Subagent tree has no time for it.
 */
export function productAgentTime(info: Pick<SubagentInfo, 'status' | 'startedAt' | 'durationMs'>, now: number): string | undefined {
  if (info.startedAt === null) return undefined
  if (info.status === 'running') return minutesOf(now - info.startedAt) ?? 'under 1 min'
  if (info.durationMs === null) return undefined
  const ago = minutesOf(now - (info.startedAt + info.durationMs))
  return ago === null ? 'just now' : `${ago} ago`
}

/**
 * The state line under an agent's name and task: «working · 1 min · 3 objections», «done · 4 min ago»;
 * `time` from productAgentTime when known, `objections` only when the review is known.
 */
export function productAgentState(status: SubagentStatus, objections?: number, time?: string): string {
  const count = objections === undefined ? undefined : objections === 0 ? 'no objections' : objections === 1 ? '1 objection' : `${objections} objections`
  return [STATES[status], time, count].filter((part) => part !== undefined).join(' · ')
}

/** Later started first; an agent the tree has no start for goes after those it has. */
const byLaterStart = (a: SubagentInfo, b: SubagentInfo): number => (b.startedAt ?? Number.NEGATIVE_INFINITY) - (a.startedAt ?? Number.NEGATIVE_INFINITY)

/**
 * The order of the agents list (ticket 24, as the prototype: the working Critic above the Idea generator that
 * is done): the working agents first, the later started higher in each group, at every level of the tree, so a
 * nested agent stays under its parent. A new tree; the Subagent tree keeps its start order for other screens.
 */
export function productAgentOrder(tree: readonly SubagentInfo[]): SubagentInfo[] {
  const working = (info: SubagentInfo): number => (info.status === 'running' ? 0 : 1)
  return [...tree].sort((a, b) => working(a) - working(b) || byLaterStart(a, b)).map((info) => (info.children.length === 0 ? info : { ...info, children: productAgentOrder(info.children) }))
}

/** A file of the critic folder, with `/` or `\`. */
const CRITIC_FILE = /(?:^|[\\/])critic[\\/][^\\/]+\.md$/u

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The ids of the tool calls of `events` that ended well: their tool_result is there and is no error. A call the
 * owner refused in the permission card, one Claude Code refused (a Write of a file not read first) or one that
 * failed (an Edit whose old text is not in the file) changed no file; a call with no result yet may still be
 * refused, so it counts only once its result is in (ticket 27, review round 1).
 */
function doneCalls(events: readonly AgentEvent[]): ReadonlySet<string> {
  const done = new Set<string>()
  for (const event of events) if (event.type === 'tool_result' && !event.isError) done.add(event.toolUseId)
  return done
}

/**
 * The file and the text of the last review the critic wrote with Write in these events, a Write that ended well
 * (doneCalls); undefined when it wrote none.
 */
export function criticWriteOf(events: readonly AgentEvent[]): { path: string; text: string } | undefined {
  const done = doneCalls(events)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'tool_use' || event.name !== 'Write' || !isObject(event.input) || !done.has(event.id)) continue
    const { file_path: path, content } = event.input
    if (typeof path === 'string' && typeof content === 'string' && CRITIC_FILE.test(path)) return { path, text: content }
  }
  return undefined
}

/** The text of the last review the critic wrote with Write in these events; undefined when it wrote none. */
export function criticReviewOf(events: readonly AgentEvent[]): string | undefined {
  return criticWriteOf(events)?.text
}

/** The last name of a path, with `/` or `\`. */
export function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** `worfy:product-ideas` (or the bare `product-ideas`): the Idea generator. */
export const isIdeaGenerator = (info: Pick<SubagentInfo, 'subagentType'>): boolean => harnessType(info) === 'product-ideas'

/**
 * The agent of `agents` (the whole flattened tree) the Critic or Idea generator button opens (ticket 27): the one
 * that `is` and started last; one with no start time only when none has one. Undefined when the Session has none.
 */
export function latestAgent(agents: readonly SubagentInfo[], is: (info: SubagentInfo) => boolean): SubagentInfo | undefined {
  return agents.filter(is).sort(byLaterStart)[0]
}

/**
 * The last answer of an agent in its own transcript: the text of its last assistant message, its parts joined.
 * Undefined while it has written no text.
 */
export function lastAnswerOf(events: readonly AgentEvent[]): string | undefined {
  let messageId: string | undefined
  const parts: string[] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'text' || event.synthetic) continue
    if (messageId === undefined) messageId = event.messageId
    else if (event.messageId !== messageId) break
    parts.unshift(event.text)
  }
  const text = parts.join('\n\n').trim()
  return text === '' ? undefined : text
}

/**
 * A draft of the advisor (`docs/product/<topic>/drafts/<epic>.md`, or `<Workflow folder>/product/…` in Silent
 * mode; src/shared/product/paths.ts): the topic, the file name, its path — relative to the Project's root when it
 * is inside it, with `/` — the text of its last Write — null when the chat holds only Edits of it — whether an
 * Edit came after that Write, and how many times the chat wrote or edited it.
 */
export interface ProductDraft {
  path: string
  topic: string
  file: string
  text: string | null
  editedSince: boolean
  writes: number
}

const WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

const DRIVE = /^[A-Za-z]:$/u

/**
 * A path with `/`, without `.` and `..` steps or doubled separators: `C:\p\.\docs\..\x.md` is `C:/p/x.md`. A `..`
 * above the start of a relative path stays; one above the root of an absolute path is dropped, as the file system
 * does.
 */
export function normalPath(path: string): string {
  const slashed = path.replaceAll('\\', '/')
  const absolute = slashed.startsWith('/')
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0 && parts.at(-1) !== '..' && !(parts.length === 1 && DRIVE.test(parts[0]!))) parts.pop()
    else if (!absolute && !(parts.length === 1 && DRIVE.test(parts[0]!))) parts.push('..')
  }
  return (absolute ? '/' : '') + parts.join('/')
}

/**
 * `path` relative to the Project's `root` when it is inside it, both made normal (normalPath); else the normal path
 * itself. macOS and Windows ignore case by default, so the root is matched without it.
 */
function projectPath(path: string, root: string | undefined): string {
  const normal = normalPath(path)
  if (root === undefined) return normal
  const base = normalPath(root)
  return normal.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? normal.slice(base.length + 1) : normal
}

/**
 * The topic and the file of a draft at `path` (normal, with `/`): `…/product/<topic>/drafts/<file>.md`, the topic a
 * topic name of the Product Session folder (isProductTopicName: not `critic`, no `..`). Null for any other file.
 */
function draftAt(path: string): { topic: string; file: string } | null {
  const parts = path.split('/')
  const [folder, topic, drafts, file] = parts.slice(-4)
  if (parts.length < 4 || folder !== PRODUCT_SILENT_DIR || drafts !== DRAFTS_DIR || file === undefined || !file.endsWith('.md') || file === '.md') return null
  if (topic === undefined || !isProductTopicName(topic)) return null
  return { topic, file }
}

/**
 * The drafts these events of a Session wrote (ticket 27): one per file, the last written first. Only calls that
 * ended well count (doneCalls): a refused Write lists nothing, a failed Edit neither counts nor marks the text as
 * edited. One file is one draft however its path was written (absolute or relative to the Project's `root`, `\`
 * or `/`). The renderer lists no folder of the Project (no IPC serves `drafts/`), so the list is what the loaded
 * part of the chat wrote; a draft written before it, or by hand, is not in it.
 */
export function draftsOf(events: readonly AgentEvent[], root?: string): ProductDraft[] {
  const done = doneCalls(events)
  const drafts = new Map<string, ProductDraft>()
  for (const event of events) {
    if (event.type !== 'tool_use' || !WRITING_TOOLS.has(event.name) || !isObject(event.input) || !done.has(event.id)) continue
    const { file_path: written, content } = event.input
    if (typeof written !== 'string') continue
    const path = projectPath(written, root)
    const at = draftAt(path)
    if (at === null) continue
    const key = path.toLowerCase()
    const was = drafts.get(key)
    const whole = event.name === 'Write' && typeof content === 'string'
    const text = whole ? content : (was?.text ?? null)
    drafts.delete(key)
    drafts.set(key, { path, ...at, text, editedSince: !whole && text !== null, writes: (was?.writes ?? 0) + 1 })
  }
  return [...drafts.values()].reverse()
}

/**
 * The objections of a review: the `### N.` headings of its `## Objections` section, outside code blocks;
 * 0 when that section says `None.`. Undefined when the review has neither — a heading or a numbering
 * other than the template's (harness/agents/critic.md), or a review wrapped whole in a code block: the
 * list then shows no number rather than a wrong one.
 */
export function objectionCount(text: string): number | undefined {
  let count = 0
  let none = false
  let section = ''
  for (const line of linesOutsideCodeBlocks(text)) {
    const heading = /^##[ \t]+(.*?)[ \t]*$/u.exec(line)
    if (heading !== null) section = heading[1]!
    else if (section !== 'Objections') continue
    else if (/^###[ \t]+\d+\.(?:[ \t]|$)/u.test(line)) count += 1
    else if (line.trim() === 'None.') none = true
  }
  return count > 0 ? count : none ? 0 : undefined
}
