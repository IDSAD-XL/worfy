// The signals of a Binding (resolve.ts) in a Claude Code transcript: the last `ticket claim` the
// agent ran, its cwd and git branch (a Session's only), its last `/ship-ticket` or `/epic-wave` call, and for a
// Subagent the Ticket path in its task. Pure and incremental: main folds the lines of a transcript
// into a state as they are appended (src/main/claude-home/binding-signals.ts), so a long
// transcript is read once.
//
// The record format is internal to Claude Code (src/shared/transcript/parse.ts): what this module
// does not recognise is skipped, and nothing here throws on input.
import { harnessName } from '../agent/subagent-type'
import { parseTranscriptRecord } from '../transcript/parse'
import { ARGS_MAX, BRANCH_MAX, COMMAND_MAX, EMPTY_AGENT_SIGNALS, PATH_MAX, SKILL_NAMES, type AgentSignals, type TicketRef } from './resolve'

export interface SignalState {
  signals: AgentSignals
  /** A Subagent's first prompt (its task) has been read: later prompts are not its task. */
  promptSeen: boolean
}

export interface SignalOptions {
  /**
   * The lines are a Subagent's own file: every record is the Subagent's, and its first prompt is
   * its task. Otherwise they are a Session's file, where records a Subagent wrote (`isSidechain`,
   * older versions of Claude Code) are not the Session's.
   */
  subagent: boolean
}

export const emptySignalState = (): SignalState => ({ signals: EMPTY_AGENT_SIGNALS, promptSeen: false })

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const cap = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)

/** `ticket claim <epic> <NN>` or `ticket claim <epic>/<NN>` as a word of a shell command (any path before `ticket`). */
const CLAIM = /(?:^|[\s;&|()/'"`])ticket\s+claim\s+([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\/|\s+)(\d+)(?![\w-])/gu
/** A Ticket file's path: `.scratch/<epic>/issues/<NN>-…`. */
const TICKET_PATH = /(?:^|[^A-Za-z0-9._-])\.scratch\/([A-Za-z0-9][A-Za-z0-9._-]*)\/issues\/(\d+)-/u

/** The last claim in a Bash command; null when it has none. */
export function claimIn(command: string): (TicketRef & { command: string }) | null {
  let last: RegExpExecArray | null = null
  for (const match of command.matchAll(CLAIM)) last = match
  if (last === null) return null
  return { epic: last[1]!, num: Number(last[2]), command: cap(command.trim(), COMMAND_MAX) }
}

/** The first Ticket path in a text; null when it has none. */
export function ticketPathIn(text: string): TicketRef | null {
  const match = TICKET_PATH.exec(text)
  return match ? { epic: match[1]!, num: Number(match[2]) } : null
}

/**
 * `/ship-ticket`, `ship-ticket`, `/worfy:ship-ticket` or `worfy:ship-ticket` → `ship-ticket`; null
 * for any other skill, a skill of the same name from another plugin (`other:ship-ticket`) included.
 */
function skillName(name: string): (typeof SKILL_NAMES)[number] | null {
  const short = harnessName(name.trim().replace(/^\//u, ''))
  return short !== null && (SKILL_NAMES as readonly string[]).includes(short) ? (short as (typeof SKILL_NAMES)[number]) : null
}

/** The text of a user record: its string content, or its text blocks joined. */
function promptText(record: Json): string | null {
  const message = record.message
  if (!isObject(message)) return null
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return null
  const texts = message.content.filter((block): block is { text: string } => isObject(block) && block.type === 'text' && typeof block.text === 'string').map((block) => block.text)
  return texts.length > 0 ? texts.join('\n') : null
}

/** Folds one record into the signals. */
function extendOne(state: SignalState, record: Json, options: SignalOptions): SignalState {
  if (!options.subagent && record.isSidechain === true) return state
  let { signals, promptSeen } = state
  const set = (change: Partial<AgentSignals>) => {
    signals = { ...signals, ...change }
  }
  // In a Subagent's file every record carries the parent Session's cwd and git branch (the process
  // runs in the Session's checkout, wherever the Subagent works): they say nothing about the
  // Subagent, and the Session's checkout branch would beat the Ticket path in its task.
  if (!options.subagent) {
    if (typeof record.cwd === 'string' && record.cwd !== '') set({ cwd: cap(record.cwd, PATH_MAX) })
    if (typeof record.gitBranch === 'string' && record.gitBranch !== '') set({ gitBranch: cap(record.gitBranch, BRANCH_MAX) })
  }

  if (options.subagent && !promptSeen && record.type === 'user') {
    const text = promptText(record)
    if (text !== null) {
      promptSeen = true
      set({ task: ticketPathIn(text) })
    }
  }

  for (const { event } of parseTranscriptRecord(record)) {
    if (event.type === 'tool_use' && isObject(event.input)) {
      const input = event.input
      if (event.name === 'Bash' && typeof input.command === 'string') {
        const claim = claimIn(input.command)
        if (claim) set({ claim })
      } else if (event.name === 'Skill' && typeof input.skill === 'string') {
        const name = skillName(input.skill)
        if (name) set({ skill: { name, args: cap(typeof input.args === 'string' ? input.args.trim() : '', ARGS_MAX) } })
      }
    } else if (event.type === 'command') {
      const name = skillName(event.name)
      if (name) set({ skill: { name, args: cap(event.args.trim(), ARGS_MAX) } })
    }
  }
  return { signals, promptSeen }
}

/** Folds transcript lines (JSONL, in file order) into the state; lines that are not records are skipped. */
export function extendSignals(state: SignalState, lines: readonly string[], options: SignalOptions): SignalState {
  let next = state
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (isObject(record)) next = extendOne(next, record, options)
  }
  return next
}
