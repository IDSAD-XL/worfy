import type { AgentEvent } from '../../shared/agent/events'
import { subagentTypeLabel } from '../../shared/agent/subagent-type'

// The status line of a Product Session's chat (worfy-product-session ticket 29, owner 2026-11-09): the chat
// hides tool calls, thinking and Subagents (product-session.ts, shownInProductChat), so while a turn runs one
// line says what the advisor is doing right now — «Reading map.md», «Searching the docs», «Thinking…». It is
// derived from the Session's latest events only; the model is not asked for it.

/** What the advisor does now: the line, the step it belongs to, and when that step began (ms, null when unknown). */
export interface AdvisorStatusLine {
  /** Changes when a new step begins: the line's timer starts again then. */
  key: string
  text: string
  since: number | null
}

const THINKING = 'Thinking…'
const ANSWERING = 'Writing the answer'
/** The longest argument the line quotes; the chat column is narrow (ticket 24). */
const ARGUMENT_MAX = 48

/** One line of an argument, cut to ARGUMENT_MAX characters with an ellipsis. */
function short(value: string): string {
  const line = (value.split('\n')[0] ?? '').trim()
  return line.length > ARGUMENT_MAX ? `${line.slice(0, ARGUMENT_MAX - 1)}…` : line
}

/** The file name of a path, POSIX or Windows, without a qmd `:line` suffix. */
function fileName(path: string): string {
  const name = path.replace(/:\d+(?::\d+)?$/u, '').split(/[/\\]/u).filter((part) => part !== '').pop() ?? path
  return short(name)
}

function field(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

const capitalized = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

/** A Subagent the Task / Agent tool started: the critic reviews, any other works on its description. */
function subagentStatus(input: unknown): string {
  const type = field(input, 'subagent_type')
  const label = type === null ? null : subagentTypeLabel(type)
  const description = field(input, 'description')
  const who = label === null ? 'A Subagent is working' : label === 'critic' ? 'Critic is reviewing' : `${capitalized(label)} is working`
  if (description === null) return who
  return label === 'critic' ? `${who}: ${short(description)}` : `${who} on: ${short(description)}`
}

const NODE_KIND_ARTICLE: Readonly<Record<string, string>> = { idea: 'an idea', question: 'a question', decision: 'a decision', objection: 'an objection' }

/** The tools of the Mind map server (src/shared/product/tools.ts) and of qmd, in plain English; null for any other. */
function mcpStatus(server: string, tool: string, input: unknown): string | null {
  switch (tool) {
    case 'mind_map_read': {
      const topic = field(input, 'topic')
      return topic === null ? 'Reading the Mind map topics' : `Reading the ${short(topic)} Mind map`
    }
    case 'mind_map_add':
      return `Adding ${NODE_KIND_ARTICLE[field(input, 'kind') ?? ''] ?? 'a node'} to the Mind map`
    case 'mind_map_update':
      return 'Changing a Mind map node'
    case 'mind_map_decide':
      return 'Recording a decision on the Mind map'
    case 'mind_map_remove':
      return 'Removing a Mind map node'
    case 'product_save':
      return 'Asking to save the work'
  }
  if (!server.includes('qmd')) return null
  if (tool === 'query' || tool === 'search') return 'Searching the docs'
  if (tool === 'get') {
    const file = field(input, 'file')
    return file === null ? 'Reading the docs' : `Reading ${fileName(file)}`
  }
  if (tool === 'multi_get') return 'Reading the docs'
  return 'Checking the docs index'
}

function host(url: string): string {
  try {
    return new URL(url).host || short(url)
  } catch {
    return short(url)
  }
}

/** The line of one tool call: the tool as a verb and its main argument made short. */
export function toolStatus(name: string, input: unknown): string {
  const file = field(input, 'file_path') ?? field(input, 'notebook_path')
  switch (name) {
    case 'Read':
      return file === null ? 'Reading a file' : `Reading ${fileName(file)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return file === null ? 'Editing a file' : `Editing ${fileName(file)}`
    case 'Write':
      return file === null ? 'Writing a file' : `Writing ${fileName(file)}`
    case 'Grep': {
      const pattern = field(input, 'pattern')
      return pattern === null ? 'Searching the files' : `Searching the files for “${short(pattern)}”`
    }
    case 'Glob': {
      const pattern = field(input, 'pattern')
      return pattern === null ? 'Looking for files' : `Looking for ${short(pattern)}`
    }
    case 'Bash':
    case 'commandExecution': {
      const description = field(input, 'description')
      if (description !== null) return short(description)
      const command = field(input, 'command')
      return command === null ? 'Running a command' : `Running ${short(command)}`
    }
    case 'WebSearch': {
      const query = field(input, 'query')
      return query === null ? 'Searching the web' : `Searching the web for “${short(query)}”`
    }
    case 'WebFetch': {
      const url = field(input, 'url')
      return url === null ? 'Reading a web page' : `Reading ${host(url)}`
    }
    case 'TodoWrite':
      return 'Updating the plan'
    case 'Skill': {
      const skill = field(input, 'skill')
      return skill === null ? 'Using a skill' : `Using the ${short(subagentTypeLabel(skill))} skill`
    }
    case 'Task':
    case 'Agent':
      return subagentStatus(input)
    case 'AskUserQuestion':
      return 'Asking you a question'
    case 'ToolSearch':
      return 'Loading tools'
    case 'fileChange':
      return 'Editing files'
  }
  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length)
    const cut = rest.indexOf('__')
    const server = cut < 0 ? rest : rest.slice(0, cut)
    const tool = cut < 0 ? rest : rest.slice(cut + 2)
    return mcpStatus(server, tool, input) ?? `Using ${short(tool)}`
  }
  return `Using ${short(name)}`
}

/** What an event says about the advisor's step; null for the Session's housekeeping, which leaves the line alone. */
type Step = 'thinking' | 'answer' | 'call' | 'answered' | 'start' | 'end'

function stepOf(event: AgentEvent): Step | null {
  // What a Subagent does inside its run stays under its own line: the Task call's.
  if ('parentToolUseId' in event && event.parentToolUseId !== null) return null
  switch (event.type) {
    case 'thinking':
      return 'thinking'
    case 'delta':
      return event.kind === 'thinking' ? 'thinking' : 'answer'
    case 'text':
      return event.synthetic ? null : 'answer'
    case 'tool_use':
      return 'call'
    case 'tool_result':
      return 'answered'
    case 'prompt':
      return 'start'
    case 'notice':
      return event.kind === 'user' ? 'start' : null
    case 'result':
      return 'end'
    default:
      return null
  }
}

const at = (event: AgentEvent): number | null => event.at ?? null
const keyOf = (kind: string, since: number | null, index: number): string => (since === null ? `${kind}#${index}` : `${kind}@${since}`)

/**
 * The status line from the latest events of a turn. A tool call that has not answered names the step (of calls
 * made together, the latest that still runs); after its answer the advisor is «Thinking…» from that answer until
 * the next event. Thinking is «Thinking…» from the message or the answer it follows; the answer as it comes is
 * «Writing the answer». The events of a Subagent and the Session's housekeeping do not change the line.
 */
export function advisorStatus(events: readonly AgentEvent[]): AdvisorStatusLine {
  let last = events.length - 1
  while (last >= 0 && stepOf(events[last]!) === null) last -= 1
  if (last < 0) return { key: 'thinking', text: THINKING, since: null }
  const latest = events[last]!
  const step = stepOf(latest)
  if (step === 'start') return { key: keyOf('thinking', at(latest), last), text: THINKING, since: at(latest) }
  if (step === 'end') return { key: 'thinking', text: THINKING, since: null }

  if (step === 'call' || step === 'answered') {
    // The calls made together stand next to each other, their answers after them: the latest one still running wins.
    const answered = new Set<string>()
    for (let index = last; index >= 0; index -= 1) {
      const event = events[index]!
      const kind = stepOf(event)
      if (kind === null) continue
      if (event.type === 'tool_result') answered.add(event.toolUseId)
      else if (event.type === 'tool_use') {
        if (!answered.has(event.id)) return { key: `tool:${event.id}`, text: toolStatus(event.name, event.input), since: at(event) }
      } else break
    }
    return { key: keyOf('thinking', at(latest), last), text: THINKING, since: at(latest) }
  }

  // A run of thinking or of the answer: one step from its first part. Thinking after the message or a call's
  // answer is the same step as the «Thinking…» that answer began, so the timer does not start again.
  let first = last
  for (let index = last - 1; index >= 0; index -= 1) {
    const kind = stepOf(events[index]!)
    if (kind === null) continue
    if (kind === step) {
      first = index
      continue
    }
    if (step === 'thinking' && (kind === 'start' || kind === 'answered')) first = index
    break
  }
  const since = at(events[first]!)
  return step === 'thinking' ? { key: keyOf('thinking', since, first), text: THINKING, since } : { key: keyOf('answer', since, first), text: ANSWERING, since }
}
