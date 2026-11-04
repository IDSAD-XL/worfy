// The plan of a retry after a temporary API error (worfy-retry ticket 03): how long to pause before
// each retry, when to stop retrying, which actions of the failed turn reached outside the Session,
// and the text the Orchestrator gets instead of its original message.
//
// Pure: no timers, no clock, no randomness of its own. The caller passes the attempt number and a
// random number, keeps the count of attempts and resets it after a turn that ends without an error
// (worfy-retry tickets 04 and 06).
//
// The rule for external actions (spec, Q9 (a)) is safe by default:
// - The turn is never sent again: the retry is a new message that asks the model to continue, and
//   it names what the turn already did outside the Session, so the model checks before it repeats.
// - An external action that has a `tool_use` but no `tool_result` (the turn broke off while a push
//   or a merge was running) may or may not have happened: no retry (`in-flight`).
// - What counts as external is a list of what changes something; a tool this module does not know
//   is read the safe way: an MCP tool of another server counts as external, a worfy MCP tool must
//   be classified here before it builds (WORFY_CANVAS_TOOLS, WORFY_BROWSER_TOOLS).
// Only the turn's own calls count (`parentToolUseId` null). A call inside a Subagent belongs to the
// Subagent: when the Agent call itself has its result, the Subagent goes on (or ended) on its own,
// and continuing the Orchestrator's turn does not repeat it; when it has none, the Agent call is the
// action in flight.
import { BROWSER_SERVER_NAME, type BrowserToolName } from '../browser/tools'
import { CANVAS_SERVER_NAME, type CanvasToolName } from '../canvas/tools'
import type { AgentEvent } from './events'
import type { TransientError, TurnFailure } from './turn-failure'

/**
 * The pause before each retry, by attempt (spec, Q3 (a)): 1, 5, 15, 30, 60 minutes, about 1 h 50 min
 * in all — an outage of the API is usually shorter than two hours, and a night run that gave up after
 * 20 minutes loses the night. Each pause is spread by JITTER so that several Sessions refused at once
 * do not come back at the same second.
 */
export const RETRY_DELAYS_MS: readonly number[] = [1, 5, 15, 30, 60].map((minutes) => minutes * 60_000)
/** Retries in a row before the caller gives up (`cap`); a turn that ends without an error resets the count. */
export const MAX_RETRIES = RETRY_DELAYS_MS.length
/** The spread of a pause: ±20 % of it. */
export const JITTER = 0.2

/**
 * The pause before retry `attempt` (1…MAX_RETRIES), spread by `random` in [0, 1): 0 gives the pause
 * less 20 %, 0.5 the pause itself, a number near 1 the pause plus 20 %.
 */
export function retryDelay(attempt: number, random: number): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES) throw new RangeError(`retry attempt ${attempt} is not 1…${MAX_RETRIES}`)
  if (!(random >= 0 && random < 1)) throw new RangeError(`random ${random} is not in [0, 1)`)
  const base = RETRY_DELAYS_MS[attempt - 1] as number
  return Math.round(base * (1 - JITTER + 2 * JITTER * random))
}

/** One action of a turn that changed, or may have changed, something outside the Session. */
export interface ExternalAction {
  toolUseId: string
  /** The tool's name: `Bash`, `Agent`, `mcp__worfy-canvas__create_card`, … */
  tool: string
  /** A short line for the continuation text and the transcript: the command, the Agent's description. */
  description: string
  /** The call has its `tool_result`: it ran (successfully or not). False: it may or may not have run. */
  done: boolean
}

/** Tools that run a command line: Claude Code's Bash and PowerShell (on Windows), Codex's `commandExecution`. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'commandExecution'])
/** Tools that start work which goes on outside the turn: a Subagent (`Agent`; `Task` before 2.1.222), a workflow script. */
const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'Workflow'])
/** A message to another agent. */
const SEND_TOOL = 'SendMessage'

/** Which tools of worfy's canvas MCP server change something (src/main/mcp/canvas-server.ts). */
const WORFY_CANVAS_TOOLS: Record<CanvasToolName, boolean> = {
  list_nodes: false,
  create_card: true,
  create_note: true,
  update_node: true,
  move_node: true,
  resize_node: true,
  hide_node: true,
  link_card: true,
  autopilot_start: true,
}
/** Which tools of worfy's Browser MCP server change something (src/main/mcp/browser-server.ts). */
const WORFY_BROWSER_TOOLS: Record<BrowserToolName, boolean> = {
  browser_list: false,
  browser_open: true,
  browser_navigate: true,
  browser_click: true,
  browser_type: true,
  browser_screenshot: false,
  browser_read: false,
  browser_console: false,
  browser_network: false,
}
const WORFY_MCP_TOOLS: ReadonlyMap<string, Readonly<Record<string, boolean>>> = new Map<string, Readonly<Record<string, boolean>>>([
  [CANVAS_SERVER_NAME, WORFY_CANVAS_TOOLS],
  [BROWSER_SERVER_NAME, WORFY_BROWSER_TOOLS],
])

/**
 * git subcommands that make a commit, move a branch or reach the remote: the ticket's list (commit,
 * push, merge, rebase, reset, tag) and the ones that make a commit or a merge the same way.
 */
const GIT_EXTERNAL: ReadonlySet<string> = new Set(['commit', 'push', 'merge', 'rebase', 'reset', 'tag', 'pull', 'cherry-pick', 'revert', 'am'])
/** git options before the subcommand that take the next word as their value (`git -C <path> push`). */
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])
/** gh commands that only read or act on this machine; every other `gh <group> <verb>` counts as external. */
const GH_READ_GROUPS: ReadonlySet<string> = new Set(['search', 'status', 'browse', 'help', 'version', 'completion'])
const GH_READ_VERBS: ReadonlySet<string> = new Set(['view', 'list', 'status', 'checks', 'diff', 'checkout', 'watch', 'download'])
/** `gh api` options that send a body: without -X, gh then sends a POST. */
const GH_API_BODY = /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)|^-[fF]./
/** HTTP methods that only read. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/** Longest description kept of an action. */
const DESCRIPTION_MAX = 160

/** The external actions of a turn, given its events, in the order they were called. */
export function externalActions(events: readonly AgentEvent[]): ExternalAction[] {
  const results = new Set<string>()
  for (const event of events) if (event.type === 'tool_result') results.add(event.toolUseId)
  const actions: ExternalAction[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool_use' || event.parentToolUseId !== null || seen.has(event.id)) continue
    seen.add(event.id)
    const description = externalDescription(event.name, event.input)
    if (description !== null) actions.push({ toolUseId: event.id, tool: event.name, description: shorten(description), done: results.has(event.id) })
  }
  return actions
}

/** What the call did outside the Session, as a short line, or null when it was not external. */
function externalDescription(tool: string, input: unknown): string | null {
  const fields = record(input)
  if (SHELL_TOOLS.has(tool)) {
    const command = commandText(fields.command)
    if (fields.run_in_background === true) return `background task: ${command}`
    const found = externalCommands(command)
    return found.length === 0 ? null : found.join('; ')
  }
  if (AGENT_TOOLS.has(tool)) {
    const what = text(fields.description) ?? text(fields.subagent_type) ?? text(fields.name)
    return what === null ? tool : `${tool}: ${what}`
  }
  if (tool === SEND_TOOL) {
    const to = text(fields.to)
    return to === null ? 'message to another agent' : `message to ${to}`
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp !== null) {
    const known = WORFY_MCP_TOOLS.get(mcp[1] as string)
    // An MCP tool worfy does not know may change anything: read the safe way.
    if (known === undefined || known[mcp[2] as string] !== false) return tool
  }
  return null
}

/**
 * The simple commands of a command line that run git or gh in a way that changes something (see
 * GIT_EXTERNAL, GH_*), each as one line; empty when there is none.
 */
function externalCommands(command: string): string[] {
  const found: string[] = []
  for (const words of shellSegments(command)) {
    let external = false
    for (let i = 0; i < words.length && !external; i++) {
      const program = programName(words[i] as string)
      external = (program === 'git' && gitExternal(words, i + 1)) || (program === 'gh' && ghExternal(words, i + 1))
    }
    if (external) found.push(words.map((word) => (/\s/.test(word) ? `"${word}"` : word)).join(' '))
    // A quoted command inside the command: `bash -c 'git push'`, `ssh host "cd x && git push"`.
    // The quotes are gone from the word, so each level is shorter than the one above it.
    else for (const word of words) if (/\s/.test(word)) found.push(...externalCommands(word))
  }
  return found
}

/** `git`, `/usr/bin/git`, `git.exe` → `git`. */
function programName(word: string): string {
  const name = word.split(/[\\/]/).pop() ?? word
  return name.toLowerCase().replace(/\.exe$/, '')
}

function gitExternal(words: readonly string[], from: number): boolean {
  let i = from
  while (i < words.length && (words[i] as string).startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i] as string) ? 2 : 1
  const subcommand = words[i]
  return subcommand !== undefined && GIT_EXTERNAL.has(subcommand)
}

function ghExternal(words: readonly string[], from: number): boolean {
  const rest = words.slice(from)
  const at = rest.findIndex((word) => !word.startsWith('-'))
  const group = rest[at]
  if (group === 'api') return ghApiExternal(rest.slice(at + 1))
  // `gh` alone or `gh --version`: no group.
  if (group === undefined || GH_READ_GROUPS.has(group)) return false
  const verb = rest.slice(at + 1).find((word) => !word.startsWith('-'))
  // `gh pr` alone prints help.
  return verb !== undefined && !GH_READ_VERBS.has(verb)
}

/** `gh api`: external with a method that writes, or with a body and no method (gh then sends POST). */
function ghApiExternal(args: readonly string[]): boolean {
  let method: string | null = null
  let body = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '-X' || arg === '--method') method = args[++i] ?? ''
    else if (arg.startsWith('--method=')) method = arg.slice('--method='.length)
    else if (arg.startsWith('-X')) method = arg.slice(2)
    else if (GH_API_BODY.test(arg)) body = true
  }
  return method === null ? body : !READ_METHODS.has(method.toUpperCase())
}

/**
 * The simple commands of a command line, each as its words with quotes removed. Splits at `;`,
 * `&`, `|`, newlines, parentheses (so `$(` too) and backticks, so a command after `&&` or inside `$(…)` is
 * read as its own. Not a shell: enough to find a program and its arguments.
 */
function shellSegments(line: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  const endWord = (): void => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string
    if (char === "'" || char === '"') {
      const close = line.indexOf(char, i + 1)
      const end = close === -1 ? line.length : close
      word += line.slice(i + 1, end)
      inWord = true
      i = end
    } else if (char === '\\' && i + 1 < line.length) {
      word += line[++i]
      inWord = true
    } else if (char === ' ' || char === '\t') endWord()
    // `(` also splits `$(…)`: the `$` before it is a word of its own, which runs nothing.
    else if (';&|\n\r()`'.includes(char)) endSegment()
    else {
      word += char
      inWord = true
    }
  }
  endSegment()
  return segments
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** A command as one line: a string, or the argv array some Vendors give. */
function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string').join(' ')
  return typeof value === 'string' ? value : ''
}

function shorten(description: string): string {
  const line = description.replace(/\s+/g, ' ').trim()
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line
}

export type RefusedReason = 'not-transient' | 'in-flight' | 'cap'

export type RetryDecision =
  | { kind: 'retry'; attempt: number; of: number; delayMs: number }
  /** `inFlight`: the external actions without a result, for the line «not retried: … may or may not have run». */
  | { kind: 'refused'; reason: RefusedReason; inFlight: ExternalAction[] }

export interface RetryInput {
  failure: TurnFailure
  /** The retry this would be, 1 for the first after a turn that ended well. */
  attempt: number
  actions: readonly ExternalAction[]
  /** A random number in [0, 1) for the jitter of the pause. */
  random: number
}

/**
 * Whether to continue after the failed turn, and after what pause. Refused, in this order: a failure
 * that is not temporary; an external action without a result (it may or may not have run, so the
 * human looks first, whatever the count); the retries used up.
 */
export function retryDecision({ failure, attempt, actions, random }: RetryInput): RetryDecision {
  if (failure.kind !== 'transient') return { kind: 'refused', reason: 'not-transient', inFlight: [] }
  const inFlight = actions.filter((action) => !action.done)
  if (inFlight.length > 0) return { kind: 'refused', reason: 'in-flight', inFlight }
  if (attempt > MAX_RETRIES) return { kind: 'refused', reason: 'cap', inFlight: [] }
  return { kind: 'retry', attempt, of: MAX_RETRIES, delayMs: retryDelay(attempt, random) }
}

/** The temporary error in the words of the continuation text. */
const ERROR_WORDS: Record<TransientError, string> = {
  'api-500': 'API error 500',
  'api-502': 'API error 502',
  'api-503': 'API error 503',
  'api-504': 'API error 504',
  overloaded: 'the API was overloaded',
  connection: 'the connection to the API was lost',
  timeout: 'the request to the API timed out',
  stream: 'the response stream broke off',
}

export interface RetryTextInput {
  attempt: number
  of: number
  error: TransientError
  /** The turn's external actions; only those that ran (done) are named. */
  actions: readonly ExternalAction[]
}

/**
 * The message the Orchestrator gets instead of its original one (spec, the section on the retry after an API
 * error, item 3). It never carries the turn's original text, a person's message or the Wave command: the Session
 * keeps the turn's history, and the model continues from it.
 */
export function retryText({ attempt, of, error, actions }: RetryTextInput): string {
  const ran = actions.filter((action) => action.done)
  const lines = [
    `The previous turn ended with a temporary API error (${ERROR_WORDS[error]}) before it finished (retry ${attempt} of ${of}). Continue from where you stopped.`,
    ran.length === 0
      ? 'worfy saw no action of that turn that changes something outside this Session.'
      : `These actions of that turn already ran:\n${ran.map((action) => `- ${action.description}`).join('\n')}`,
    'Before you repeat any action that changes something outside this Session (commit, push, PR, merge, an Agent), check whether it already happened — git log, gh pr view, the task list — and do not do it twice.',
  ]
  return lines.join('\n')
}
