// The scripts of the fake agent (fake-query.ts, WORFY_AGENT=fake): test/fixtures/agent-scripts/<name>.jsonl
// read into the lines the fake agent plays.
//
// Each line of a script is either an SDK message, yielded as is, or a directive:
//   {"fake":"account","info":{...}}  what accountInfo() answers (first line only; default: a subscription login)
//   {"fake":"account","error":"..."} accountInfo() rejects with this message (first line only)
//   {"fake":"models","models":[...]} what supportedModels() answers (a head line; default: FAKE_MODELS)
//   {"fake":"commands","commands":[...]} what supportedCommands() answers: rows of {name, description,
//                                    argumentHint} (a head line; default: the slash_commands of the
//                                    script's first system/init, without descriptions)
//   {"fake":"wait_message"}          wait for the next user message (the turn starts)
//   {"fake":"wait_interrupt"}        wait until interrupt() is called
//   {"fake":"wait_release","name":"tasks"} wait until a test releases `name` (FakeReleases.release:
//                                    each release lets one such wait pass, also one made earlier);
//                                    the script stands, as Claude Code does while its background
//                                    tasks run (worfy-daily ticket 29)
//   {"fake":"stderr","text":"..."}   Claude Code writes this to its stderr
//   {"fake":"context","usage":{...}} what getContextUsage() answers from here on: an object of the
//                                    SDK's shape (totalTokens, rawMaxTokens, percentage,
//                                    autoCompactThreshold, isAutoCompactEnabled, …; worfy-polish
//                                    ticket 23). Before any such line getContextUsage() rejects, as
//                                    a Claude Code with no usage to report
//   {"fake":"context","error":"..."} getContextUsage() rejects with this message from here on
//   {"fake":"mcp","fixture":"<path>"} what mcpServerStatus() answers from here on (worfy-mcp-live
//                                    ticket 02): an answer the spike of ticket 01 recorded, its path
//                                    relative to the script's folder (../mcp-live/mcp-live-<name>.json)
//                                    — a list of servers, or a record whose `status_after` is one. Its
//                                    scrub kept only the names of the tools (`tool_names`); they become
//                                    the SDK's `tools` again. Before any such line mcpServerStatus()
//                                    answers no servers (`[]`), quietly
//   {"fake":"mcp","servers":[...]}   the same with the servers in the SDK's shape (McpServerStatus)
//   {"fake":"mcp","error":"..."}     mcpServerStatus() rejects with this message from here on
//                                    reconnectMcpServer(name) of a server the last answer lists makes
//                                    it `connected`, without an error, as Claude Code did
//                                    (F:restart-user-reconnect); any other name rejects with
//                                    "Server not found: <name>" (F:allowed-reconnect-unknown).
//                                    toggleMcpServer(name, enabled) makes it `disabled` / `connected`;
//                                    worfy never calls it (it writes the user's .claude.json), and the
//                                    record shows a call that would. A server the request turns off
//                                    (QueryRequest.mcpOff, worfy-mcp-live ticket 03) is never in an
//                                    answer, as Claude Code left out a server its managedSettings
//                                    did not allow (F:turnoff-restart-allowlist-without, F:turnoff-restart-denied).
//                                    A server with "inventory_only":true is in the answers of the MCP
//                                    inventory's query only, never of a Session's: Claude Code did not start
//                                    it although the list names it (a claude.ai connector in the owner's
//                                    live case, worfy-mcp-live tickets 10 and 11), so the Session shows it
//                                    as not started; the field itself is in no answer
//   {"fake":"mcp_added","fixture":"<path>"} a server written into the user's config while the query
//                                    runs (worfy-mcp-live ticket 03): mcpServerStatus() still does not
//                                    list it (F:allowed-status-5s-after-write-no-call); the next
//                                    reloadPlugins() answers the recorded `answer` and from then on
//                                    mcpServerStatus() its `status_after` (F:allowed-reload-plugins).
//                                    A reloadPlugins() with nothing added answers the servers as they are.
//                                    With a Profile list (FakeQueryOptions.mcpAllowlist, worfy-mcp-live
//                                    ticket 05) no answer names a server the list leaves out, as Claude
//                                    Code's policy tier cut it (F:cut-status-start). mcpAuthenticate(name) of a
//                                    server the last answer lists answers a sign-in page of the shape the
//                                    spike recorded (F:oauth-authenticate), on a host that never resolves;
//                                    a claude.ai connector's has no callback (callbackExpected false). The
//                                    sign-in lands when a test releases `sign-in:<name>` (FakeReleases): a
//                                    server in needs-auth is then `connected`, as Claude Code's own listener
//                                    on localhost would make it. Any other name: "Server not found: <name>"
//   {"fake":"crash","error":"..."}   Claude Code dies: the message iterator throws
//   {"fake":"exit"}                  Claude Code exits quietly: the message iterator ends
//   {"fake":"permission","toolName":"Bash","toolUseId":"toolu_…","input":{...},"suggestions":[...]}
//                                    the model calls a tool (ticket 21): an assistant tool_use, then —
//                                    unless the mode is bypassPermissions — canUseTool of the request
//                                    with these suggestions, waiting for the answer; then the tool's
//                                    result: what it "ran", or the refusal as an error. Interrupt and
//                                    close abort the request's signal, as Claude Code does — unless
//                                    "keepSignal":true: then only worfy's own refusal ends the request.
//                                    With "crash":"..." Claude Code dies while the request is open
//                                    (the message iterator throws; the signal is never aborted).
//                                    An answer's `updatedPermissions` are applied as Claude Code would:
//                                    localSettings / projectSettings write <cwd>/.claude/settings.local.json
//                                    / settings.json, userSettings writes <settingsHome>/settings.json
//                                    (FakeQueryOptions; not applied without it).
//                                    "decisionReason" and "agentID" go to canUseTool as Claude Code
//                                    gives them: why it asks, which Subagent asks. "cwd" and
//                                    "scratchpad" go to the query's PreToolUse hook first
//                                    (QueryRequest.toolUse), as Claude Code's hook input gives them:
//                                    the shell's folder for the call (the Session's cwd when absent)
//                                    and the scratchpad (worfy-auto-approve ticket 04). With
//                                    "bypassImmune":true it asks in bypassPermissions too, as Claude
//                                    Code does for a few of its own checks (dangerousRemoval).
//                                    The query's PreToolUse hooks (FakeQueryOptions.preToolUse: a
//                                    Product Session's guard, worfy-polish ticket 82) run first, in
//                                    every mode, as Claude Code runs them: a `deny` refuses the call
//                                    with its reason and an `allow` lets it run, canUseTool not asked.
//                                    With "writes":true a call that ran writes input.content to
//                                    input.file_path, as the Write tool would
//   {"fake":"question","toolUseId":"toolu_…","questions":[...]}
//                                    the model asks the user questions with answer options (Claude
//                                    Code's AskUserQuestion, worfy-ui ticket 17): a `permission` line
//                                    of that tool with input {questions}, asked in every mode,
//                                    bypassPermissions included, with requiresUserInteraction, as
//                                    Claude Code does. Its result is the text Claude Code gives the
//                                    model for the answer (questionResultText), recorded from the real
//                                    binary in test/contract/ask-user-question-sdk.test.ts. "agentID":
//                                    the Subagent that asks, as for a `permission` line
// In SDK messages, "{{session}}" becomes the SDK session id (the id passed as `resume`, else the one
// passed as `sessionId`, else a new uuid), "{{cwd}}" the Session's cwd, "{{folder}}" the first extra
// folder of a single request (its `additionalDirectories`: the Project folder the profile draft reads
// from worfy's own folder), else the cwd, and "{{home}}" the user's home folder (os.homedir()). After the last line the
// script starts over, so one script serves any number of turns; it ends when the Session closes its
// input.
//
// Head lines (account, models, commands) configure the fake agent and are not played; they may
// stand anywhere, the first of each kind counts. A new directive is one entry in DIRECTIVES and,
// for a head line, one field of FakeConfig.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { ASK_USER_QUESTION } from '../../shared/agent/questions'
import type { CommandInfoLike } from './commands'
import type { AccountInfoLike, ModelInfoLike, QueryRequest } from './session'

export type Account = { info: AccountInfoLike } | { error: string }

/** What getContextUsage() answers: the usage as the SDK gives it, or a rejection. */
export type ContextAnswer = { usage: unknown } | { error: string }

/** What mcpServerStatus() answers: the servers in the SDK's shape, or a rejection. */
export type McpAnswer = { servers: Record<string, unknown>[] } | { error: string }

/**
 * The servers of an `mcp` line: its own `servers`, or those of the recorded answer its `fixture` names
 * (relative to the script's folder), `tool_names` turned back into the SDK's `tools`.
 */
function mcpAnswerOf(value: Record<string, unknown>, scriptPath: string): McpAnswer {
  if (typeof value.error === 'string') return { error: value.error }
  let servers: unknown = value.servers
  if (typeof value.fixture === 'string') {
    const recorded = JSON.parse(readFileSync(resolve(dirname(scriptPath), value.fixture), 'utf8')) as unknown
    servers = Array.isArray(recorded) ? recorded : (recorded as { status_after?: unknown }).status_after
  }
  if (!Array.isArray(servers)) throw new Error(`${scriptPath}: an mcp line names no servers`)
  return { servers: sdkServers(servers) }
}

/** Recorded servers in the SDK's shape: the scrub kept only the names of the tools (`tool_names`). */
const sdkServers = (servers: unknown[]): Record<string, unknown>[] =>
  (servers as Record<string, unknown>[]).map(({ tool_names: names, ...server }) => (Array.isArray(names) ? { ...server, tools: names.map((name: unknown) => ({ name })) } : server))

/** What an `mcp_added` line sets: what the next reloadPlugins() answers, and mcpServerStatus() after it. */
export interface McpAdded {
  reloaded: Record<string, unknown>[]
  after: Record<string, unknown>[]
}

/** The `answer` and `status_after` of a recorded reloadPlugins() (F:allowed-reload-plugins), named by an `mcp_added` line. */
function mcpAddedOf(value: Record<string, unknown>, scriptPath: string): McpAdded {
  if (typeof value.fixture !== 'string') throw new Error(`${scriptPath}: an mcp_added line names no fixture`)
  const recorded = JSON.parse(readFileSync(resolve(dirname(scriptPath), value.fixture), 'utf8')) as { answer?: { mcpServers?: unknown }; status_after?: unknown }
  const reloaded = recorded.answer?.mcpServers
  const after = recorded.status_after
  if (!Array.isArray(reloaded) || !Array.isArray(after)) throw new Error(`${scriptPath}: ${value.fixture} is no recorded reloadPlugins()`)
  return { reloaded: sdkServers(reloaded), after: sdkServers(after) }
}

/** What the head lines of a script set; absent fields keep the defaults. */
export interface FakeConfig {
  account?: Account
  models?: ModelInfoLike[]
  commands?: CommandInfoLike[]
}

/** A line the fake agent plays, in order. */
export type Step =
  | { kind: 'message'; message: unknown }
  | { kind: 'wait_message' }
  | { kind: 'wait_interrupt' }
  | { kind: 'wait_release'; name: string }
  | { kind: 'stderr'; text: string }
  | { kind: 'context'; answer: ContextAnswer }
  | { kind: 'mcp'; answer: McpAnswer }
  | { kind: 'mcp_added'; added: McpAdded }
  | { kind: 'crash'; error: string }
  | { kind: 'exit' }
  | {
      kind: 'permission'
      toolName: string
      toolUseId: string
      input: Record<string, unknown>
      suggestions: unknown[]
      /** Interrupt and close leave the request's signal alone. */
      keepSignal: boolean
      /** Claude Code dies with this error while the request is open. */
      crash: string | null
      /** Asked in bypassPermissions too. */
      bypassImmune: boolean
      /** canUseTool's decisionReason and agentID; null: not given. */
      decisionReason: string | null
      agentID: string | null
      /** What the PreToolUse hook says of the call (QueryRequest.toolUse): the shell's folder (null: the Session's cwd) and the scratchpad. */
      cwd: string | null
      scratchpad: string | null
      /** A call that ran writes `input.content` to `input.file_path`, as Write would. */
      writes: boolean
    }

export type Line = Step | { kind: 'config'; config: FakeConfig }

/** Each directive of a script (`{"fake": <name>, ...}`) and the line it makes. */
const DIRECTIVES: Record<string, (value: Record<string, unknown>, path: string) => Line> = {
  wait_message: () => ({ kind: 'wait_message' }),
  wait_interrupt: () => ({ kind: 'wait_interrupt' }),
  wait_release: (value) => ({ kind: 'wait_release', name: String(value.name ?? '') }),
  stderr: (value) => ({ kind: 'stderr', text: String(value.text ?? '') }),
  context: (value) => ({ kind: 'context', answer: typeof value.error === 'string' ? { error: value.error } : { usage: value.usage } }),
  mcp: (value, path) => ({ kind: 'mcp', answer: mcpAnswerOf(value, path) }),
  mcp_added: (value, path) => ({ kind: 'mcp_added', added: mcpAddedOf(value, path) }),
  crash: (value) => ({ kind: 'crash', error: String(value.error ?? 'Claude Code crashed') }),
  exit: () => ({ kind: 'exit' }),
  permission: (value) => ({
    kind: 'permission',
    toolName: String(value.toolName ?? 'Bash'),
    toolUseId: String(value.toolUseId ?? 'toolu_fake'),
    input: typeof value.input === 'object' && value.input !== null ? (value.input as Record<string, unknown>) : {},
    suggestions: Array.isArray(value.suggestions) ? (value.suggestions as unknown[]) : [],
    keepSignal: value.keepSignal === true,
    crash: typeof value.crash === 'string' ? value.crash : null,
    bypassImmune: value.bypassImmune === true,
    decisionReason: typeof value.decisionReason === 'string' ? value.decisionReason : null,
    agentID: typeof value.agentID === 'string' ? value.agentID : null,
    cwd: typeof value.cwd === 'string' ? value.cwd : null,
    scratchpad: typeof value.scratchpad === 'string' ? value.scratchpad : null,
    writes: value.writes === true,
  }),
  question: (value) => ({
    kind: 'permission',
    toolName: ASK_USER_QUESTION,
    toolUseId: String(value.toolUseId ?? 'toolu_fake_question'),
    input: { questions: Array.isArray(value.questions) ? (value.questions as unknown[]) : [] },
    suggestions: [],
    keepSignal: false,
    crash: null,
    bypassImmune: true,
    decisionReason: null,
    agentID: typeof value.agentID === 'string' ? value.agentID : null,
    cwd: null,
    scratchpad: null,
    writes: false,
  }),
  account: (value) => ({ kind: 'config', config: { account: typeof value.error === 'string' ? { error: value.error } : { info: value.info as AccountInfoLike } } }),
  models: (value) => ({ kind: 'config', config: { models: value.models as ModelInfoLike[] } }),
  commands: (value) => ({ kind: 'config', config: { commands: value.commands as CommandInfoLike[] } }),
}

/** The folder "{{folder}}" stands for: a single request's first extra folder, else the cwd. */
export function folderOf(request: QueryRequest): string {
  const extra = (request as { additionalDirectories?: readonly string[] | undefined }).additionalDirectories
  return extra?.[0] ?? request.cwd
}

/** The lines of the script at `path`, its placeholders filled in; an unknown directive throws with its line number. */
export function parseScript(path: string, session: string, cwd: string, folder: string): Line[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((text, index): Line => {
      const value = JSON.parse(
        text
          .replaceAll('{{session}}', session)
          .replaceAll('{{cwd}}', JSON.stringify(cwd).slice(1, -1))
          .replaceAll('{{folder}}', JSON.stringify(folder).slice(1, -1))
          .replaceAll('{{home}}', JSON.stringify(homedir()).slice(1, -1)),
      ) as Record<string, unknown>
      if (value.fake === undefined) return { kind: 'message', message: value }
      const directive = typeof value.fake === 'string' && Object.hasOwn(DIRECTIVES, value.fake) ? DIRECTIVES[value.fake] : undefined
      if (directive === undefined) throw new Error(`${path}:${index + 1}: unknown directive ${JSON.stringify(value.fake)}`)
      return directive(value, path)
    })
}

/** The head lines of a script, the first of each kind winning. */
export function configOf(lines: readonly Line[]): FakeConfig {
  const config: FakeConfig = {}
  for (const line of lines) {
    if (line.kind !== 'config') continue
    for (const [key, value] of Object.entries(line.config) as [keyof FakeConfig, FakeConfig[keyof FakeConfig]][]) {
      if (config[key] === undefined) Object.assign(config, { [key]: value })
    }
  }
  return config
}

export const isInit = (message: unknown): message is Record<string, unknown> =>
  typeof message === 'object' && message !== null && (message as Record<string, unknown>).type === 'system' && (message as Record<string, unknown>).subtype === 'init'

/** The commands of the script's first system/init, as Claude Code knows them before the first turn. */
export function initCommands(steps: readonly Step[]): CommandInfoLike[] {
  const init = steps.find((step) => step.kind === 'message' && isInit(step.message))
  const names = init?.kind === 'message' && isInit(init.message) ? init.message.slash_commands : undefined
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').map((name) => ({ name, description: '', argumentHint: '' })) : []
}
