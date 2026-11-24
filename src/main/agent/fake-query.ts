// The fake agent (WORFY_AGENT=fake): instead of starting Claude Code, a Session plays a script
// from test/fixtures/agent-scripts/<name>.jsonl. Tests and e2e runs never call the real model.
//
// What a script holds — its directives, placeholders and head lines — and how it is read: fake-script.ts.
// What lets its `wait_release` lines pass: FakeReleases (fake-releases.ts).
//
// The query of the MCP inventory (fakeInventoryStarter, worfy-mcp-live ticket 05) reads no message and
// plays nothing: mcpServerStatus() answers the first `mcp` line of the script — the user's servers as
// they are, no Profile list cutting any — and it is recorded as `inventory`, not as `start`.
//
// With `registryHome` (FakeQueryOptions) the fake agent registers itself as Claude Code does as
// soon as it starts, before any system/init (worfy-daily ticket 24): <registryHome>/sessions/<n>.json
// with that session id, its cwd and `entrypoint: "sdk-ts"`, removed when the query ends or closes.
// The entry's pid is the process the fake agent runs in, so the registry finds it alive; `n` is a
// number of its own per query, as each Claude Code process has its own pid. Without the option it
// writes nothing.
//
// The fake agent reads the Session's input as soon as a message arrives, as Claude Code does, and
// reports what it gets to `record` (FakeQueryOptions): each user message whole — its text, and its
// content as Claude Code got it, image blocks included (ticket 20) —, each control call
// (setModel, setPermissionMode, applyFlagSettings for effort, reconnectMcpServer, toggleMcpServer, reloadPlugins) and
// the settings it started with. getContextUsage() and mcpServerStatus() are reads, not control calls,
// and are not recorded.
// After setModel or setPermissionMode, its system/init messages carry the new model and mode, as
// Claude Code's next turn does (ticket 06, question 6). Effort is not in system/init, here as in
// Claude Code. Each answer canUseTool gave is recorded with the tool and its input. close() while
// background tasks live — by the last system/background_tasks_changed the fake agent played, not
// counting ambient ones — is recorded with their ids: Claude Code would kill them (ticket 29).
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ASK_USER_QUESTION, MULTI_SELECT_SEPARATOR } from '../../shared/agent/questions'
import type { SessionSettings } from '../../shared/agent/settings'
import type { CommandInfoLike } from './commands'
import { FakeReleases } from './fake-releases'
import { configOf, folderOf, initCommands, isInit, parseScript, type Account, type ContextAnswer, type McpAdded, type McpAnswer, type Step } from './fake-script'
import type { PermissionAnswer, PermissionRequestOptions } from './permissions'
import type { AccountInfoLike, ModelInfoLike, QueryFactory, QueryHandle, QueryRequest } from './session'
import { removeFile } from '../storage/remove'

export { FakeReleases }

/** What the fake agent was asked to do, in the order it happened. */
export type FakeCall =
  /** `orchestrator`: present, and true, only for the Session of a Project's Orchestrator (QueryRequest.orchestrator). */
  | { kind: 'start'; resume: string | null; settings: SessionSettings; orchestrator?: true }
  /** `text`: the message's text blocks; `content`: the message content as sent, image blocks included. */
  | { kind: 'message'; text: string; content: unknown }
  | { kind: 'setModel'; model: string | null }
  | { kind: 'setPermissionMode'; mode: string }
  | { kind: 'applyFlagSettings'; settings: Record<string, unknown> }
  /** What canUseTool answered for a tool call of a `permission` line. */
  | { kind: 'permission'; toolName: string; input: Record<string, unknown>; result: PermissionAnswer }
  /** An MCP server reconnected (worfy-mcp-live ticket 02). */
  | { kind: 'reconnectMcpServer'; name: string }
  /** An MCP server turned off or on: worfy never asks for it (it writes the user's .claude.json). */
  | { kind: 'toggleMcpServer'; name: string; enabled: boolean }
  /** The user's plugins and MCP servers read again: how a server added while the query runs is taken in (worfy-mcp-live ticket 03). */
  | { kind: 'reloadPlugins' }
  /** close() while background tasks lived: Claude Code would have killed these (task ids). */
  | { kind: 'close'; backgroundTasks: string[] }
  /** A query of the MCP inventory started (fakeInventoryStarter, worfy-mcp-live ticket 05): no message, no Profile list. */
  | { kind: 'inventory'; cwd: string }
  /** The sign-in to an MCP server began (mcpAuthenticate, worfy-mcp-live ticket 05). */
  | { kind: 'mcpAuthenticate'; name: string }

/** supportedModels() of the fake agent: the shape of SDK 0.3.322 (as in 0.3.289), extra keys included. */
export const FAKE_MODELS: ModelInfoLike[] = [
  { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'haiku', displayName: 'Haiku', supportsEffort: false },
].map((model) => ({ ...model, description: `${model.displayName} (fake)`, resolvedModel: `claude-${model.value}-fake` }))

const SUBSCRIPTION: AccountInfoLike = { apiProvider: 'firstParty', subscriptionType: 'Claude Max', tokenSource: 'claude.ai' }

const contentOf = (message: unknown): unknown => (message as { message?: { content?: unknown } }).message?.content

/** The text of a user message: the content when it is a string, else its text blocks. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content
    .flatMap((block) => (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' ? [String((block as { text?: unknown }).text ?? '')] : []))
    .join('\n\n')
}

/** The ids of the live, not ambient tasks of a system/background_tasks_changed message; null for any other message. */
function liveTaskIds(message: unknown): string[] | null {
  const value = message as { type?: unknown; subtype?: unknown; tasks?: unknown }
  if (value?.type !== 'system' || value.subtype !== 'background_tasks_changed' || !Array.isArray(value.tasks)) return null
  return (value.tasks as { task_id?: unknown; ambient?: unknown }[]).filter((task) => task.ambient !== true).map((task) => String(task.task_id))
}

/** Registry entries written by fake queries of this process; numbers their files. */
let registered = 0

/**
 * Writes the registry entry of a fake Claude Code that has just started, as the real one writes
 * ~/.claude/sessions/<pid>.json (src/main/claude-home/registry.ts reads it): the file's path.
 */
function register(home: string, sessionId: string, cwd: string): string {
  const dir = join(home, 'sessions')
  mkdirSync(dir, { recursive: true })
  registered += 1
  const file = join(dir, `${process.pid}${String(registered).padStart(4, '0')}.json`)
  const entry = { pid: process.pid, sessionId, cwd, entrypoint: 'sdk-ts', kind: 'sdk', name: `auto-${sessionId.slice(0, 8)}`, startedAt: Date.now() }
  writeFileSync(file, JSON.stringify(entry))
  return file
}

class FakeQuery implements QueryHandle {
  private closed = false
  private interruptRequested = false
  private wakeInterrupt: (() => void) | null = null
  /** Ends a wait_release line that close() cut short. */
  private cancelRelease: (() => void) | null = null
  /** The background tasks the last background_tasks_changed played left alive. */
  private liveTasks: string[] = []
  private readonly steps: Step[]
  private readonly account: Account
  private readonly models: ModelInfoLike[]
  private readonly commands: CommandInfoLike[]
  /** User messages read from the input and not yet taken by a wait_message line. */
  private readonly inbox: unknown[] = []
  private inputEnded = false
  private wakeInbox: (() => void) | null = null
  private reading = false
  private model: string | null
  private permissionMode: string
  /** The SDK session id the messages carry. */
  private readonly session: string
  /** Signals of the permission requests now open; Interrupt and close abort them. */
  private readonly requests = new Set<AbortController>()
  /** The file of this query's entry in the registry of live Sessions, while it stands there. */
  private registryEntry: string | null
  /** What getContextUsage() answers, set by the last `context` line played. */
  private context: ContextAnswer = { error: 'the fake agent has no context usage to report' }
  /** What mcpServerStatus() answers, set by the last `mcp` line played and by the MCP calls since; no servers before any. */
  private mcp: McpAnswer = { servers: [] }
  /** What the last `mcp_added` line wrote into the user's config, until reloadPlugins() takes it in. */
  private added: McpAdded | null = null
  /** Ends the waits of sign-ins that close() cut short. */
  private readonly signIns = new Set<() => void>()
  /** The query's PreToolUse hooks (FakeQueryOptions.preToolUse), made when the query starts; null: none. */
  private readonly preToolUse: Promise<FakePreToolUse | undefined> | null

  constructor(
    path: string,
    private readonly request: QueryRequest,
    private readonly record: (call: FakeCall) => void,
    private readonly settingsHome: string | null,
    private readonly releases: FakeReleases,
    registryHome: string | null,
    preToolUse: FakeQueryOptions['preToolUse'] = undefined,
    /** The Profile's list of MCP servers the query starts with; null: none, every server is listed. */
    private readonly listed: readonly string[] | null = null,
    /** A query of the MCP inventory (fakeInventoryStarter): its servers from the start, recorded as `inventory`. */
    private readonly inventory = false,
    /** The Integrations of the request's Project, after the servers of the script (FakeQueryOptions.integrations). */
    private readonly integrations: readonly FakeIntegration[] = [],
  ) {
    // A failure to make them leaves the query without hooks, as a Claude Code without them would run.
    this.preToolUse = preToolUse?.(request)?.catch(() => undefined) ?? null
    this.session = request.resume ?? request.sessionId ?? randomUUID()
    this.registryEntry = registryHome === null ? null : register(registryHome, this.session, request.cwd)
    const lines = parseScript(path, this.session, request.cwd, folderOf(request))
    this.steps = lines.filter((line): line is Step => line.kind !== 'config')
    const config = configOf(lines)
    this.account = config.account ?? { info: SUBSCRIPTION }
    this.models = config.models ?? FAKE_MODELS
    this.commands = config.commands ?? initCommands(this.steps)
    this.model = request.settings.model
    this.permissionMode = request.settings.permissionMode
    if (inventory) {
      const first = this.steps.find((step) => step.kind === 'mcp')
      if (first?.kind === 'mcp') this.mcp = first.answer
      record({ kind: 'inventory', cwd: request.cwd })
      return
    }
    record({ kind: 'start', resume: request.resume ?? null, settings: { ...request.settings }, ...(request.orchestrator === true ? { orchestrator: true as const } : {}) })
  }

  accountInfo(): Promise<AccountInfoLike> {
    return 'error' in this.account ? Promise.reject(new Error(this.account.error)) : Promise.resolve(this.account.info)
  }

  setModel(model?: string): Promise<void> {
    this.model = model ?? null
    this.record({ kind: 'setModel', model: model ?? null })
    return Promise.resolve()
  }

  setPermissionMode(mode: string): Promise<void> {
    this.permissionMode = mode
    this.record({ kind: 'setPermissionMode', mode })
    return Promise.resolve()
  }

  applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.record({ kind: 'applyFlagSettings', settings: { ...settings } })
    return Promise.resolve()
  }

  supportedModels(): Promise<ModelInfoLike[]> {
    return Promise.resolve(this.models.map((model) => ({ ...model })))
  }

  supportedCommands(): Promise<CommandInfoLike[]> {
    return Promise.resolve(this.commands.map((command) => ({ ...command })))
  }

  /** Answers what the last `context` line set, as it stood when called. */
  getContextUsage(): Promise<unknown> {
    const answer = this.context
    return 'error' in answer ? Promise.reject(new Error(answer.error)) : Promise.resolve(structuredClone(answer.usage))
  }

  /** Answers what the last `mcp` line set, as it stood when called; the servers the request turned off are not in it. */
  mcpServerStatus(): Promise<unknown> {
    const answer = this.mcp
    return 'error' in answer ? Promise.reject(new Error(answer.error)) : Promise.resolve([...this.withoutOff(answer.servers), ...this.integrationServers()])
  }

  /** The Integrations as servers in the SDK's shape, without those the request turned off; never on the Profile's list. */
  private integrationServers(): Record<string, unknown>[] {
    const off = this.request.mcpOff ?? []
    return this.integrations
      .filter((each) => !off.includes(each.name))
      .map((each) => ({ name: each.name, status: 'connected', scope: 'sdk', tools: each.tools.map((name) => ({ name })) }))
  }

  /** Takes in what an `mcp_added` line wrote, as Claude Code did (F:allowed-reload-plugins); the SDK's shape of the answer. */
  reloadPlugins(): Promise<unknown> {
    this.record({ kind: 'reloadPlugins' })
    const added = this.added
    this.added = null
    if (added !== null) this.mcp = { servers: added.after }
    const answer = this.mcp
    const servers = added?.reloaded ?? ('error' in answer ? [] : answer.servers)
    return Promise.resolve({ commands: [], agents: [], plugins: [], mcpServers: this.withoutOff(servers), error_count: 0 })
  }

  /**
   * `servers` without those the request turned off (QueryRequest.mcpOff), those the Profile's list leaves out and,
   * but for the inventory's query, those marked `inventory_only`; copied, without that mark.
   */
  private withoutOff(servers: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const off = this.request.mcpOff ?? []
    const listed = this.listed
    return servers
      .filter((server) => !off.includes(String(server.name)) && (listed === null || listed.includes(String(server.name))) && (this.inventory || server.inventory_only !== true))
      .map((server) => {
        const copy = structuredClone(server)
        delete copy.inventory_only
        return copy
      })
  }

  /**
   * The sign-in to the server `serverName` (worfy-mcp-live ticket 05): the answer of the shape the spike
   * recorded (F:oauth-authenticate), its page on a host that never resolves. Released as `sign-in:<name>`,
   * a server in needs-auth becomes connected. Not part of QueryHandle: the SDK has it undocumented.
   */
  mcpAuthenticate(serverName: string): Promise<unknown> {
    this.record({ kind: 'mcpAuthenticate', name: serverName })
    const answer = this.mcp
    const server = 'error' in answer ? undefined : this.withoutOff(answer.servers).find((each) => each.name === serverName)
    if (server === undefined) return Promise.reject(new Error(`Server not found: ${serverName}`))
    const connector = server.source === 'claudeai'
    const state = randomUUID()
    const port = 40_000 + Math.floor(Math.random() * 1000)
    const page = new URL('https://auth.example.invalid/authorize')
    const params = { client_id: 'fake-client', code_challenge: randomUUID(), code_challenge_method: 'S256', redirect_uri: `http://localhost:${port}/callback`, resource: 'https://mcp.example.invalid/mcp', response_type: 'code', state }
    for (const [key, value] of Object.entries(params)) page.searchParams.set(key, value)
    let stop: () => void = () => undefined
    const cancel = (): void => stop()
    this.signIns.add(cancel)
    void this.releases
      .wait(`sign-in:${serverName}`, { onCancel: (given) => (stop = given) })
      .then(() => {
        this.signIns.delete(cancel)
        if (this.closed) return
        const now = this.mcp
        if ('error' in now) return
        this.mcp = { servers: now.servers.map((each) => (each.name === serverName && each.status === 'needs-auth' ? { ...each, status: 'connected' } : each)) }
      })
    return Promise.resolve(connector ? { authUrl: page.toString(), requiresUserAction: true, callbackExpected: false } : { authUrl: page.toString(), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state, callbackPort: port })
  }

  reconnectMcpServer(serverName: string): Promise<void> {
    this.record({ kind: 'reconnectMcpServer', name: serverName })
    return this.setMcpStatus(serverName, 'connected')
  }

  /** Not part of QueryHandle: worfy never calls it; the record shows a call that would. */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    this.record({ kind: 'toggleMcpServer', name: serverName, enabled })
    return this.setMcpStatus(serverName, enabled ? 'connected' : 'disabled')
  }

  /** The server `name` of the last answer gets `status` and loses its error; a server it does not list is not found. */
  private setMcpStatus(name: string, status: string): Promise<void> {
    const answer = this.mcp
    if ('error' in answer || !answer.servers.some((server) => server.name === name)) return Promise.reject(new Error(`Server not found: ${name}`))
    this.mcp = {
      servers: answer.servers.map((server) => {
        if (server.name !== name) return server
        const rest = { ...server }
        delete rest.error
        return { ...rest, status }
      }),
    }
    return Promise.resolve()
  }

  /** Reads the Session's input as messages arrive, like Claude Code reading its stdin. */
  private readInput(): void {
    if (this.reading) return
    this.reading = true
    void (async () => {
      try {
        for await (const message of this.request.prompt) {
          const content = contentOf(message)
          this.record({ kind: 'message', text: textOf(content), content })
          this.inbox.push(message)
          this.wake()
        }
      } finally {
        this.inputEnded = true
        this.wake()
      }
    })()
  }

  private wake(): void {
    const resolve = this.wakeInbox
    this.wakeInbox = null
    resolve?.()
  }

  /** Waits for the next user message; false when the input ended or the query closed first. */
  private async nextMessage(): Promise<boolean> {
    while (this.inbox.length === 0) {
      if (this.inputEnded || this.closed) return false
      await new Promise<void>((resolve) => {
        this.wakeInbox = resolve
      })
    }
    this.inbox.shift()
    return !this.closed
  }

  /** A system/init as Claude Code would send it after setModel / setPermissionMode. */
  private current(message: unknown): unknown {
    if (!isInit(message)) return message
    return { ...message, ...(this.model !== null ? { model: this.model } : {}), permissionMode: this.permissionMode }
  }

  /**
   * A tool call of a `permission` line: what canUseTool answered, or null in bypassPermissions,
   * where nothing is asked unless the line is `bypassImmune`.
   */
  private async ask(line: Extract<Step, { kind: 'permission' }>): Promise<PermissionAnswer | null> {
    // Awaited only with hooks: a query without them asks canUseTool in the same tick as before.
    const hooked = this.preToolUse === null ? null : await this.hooks(line, this.preToolUse)
    if (hooked !== null) return hooked
    if (this.permissionMode === 'bypassPermissions' && !line.bypassImmune) return null
    // Claude Code runs the PreToolUse hooks before it asks canUseTool.
    this.request.toolUse?.({ toolUseId: line.toolUseId, cwd: line.cwd ?? this.request.cwd, scratchpad: line.scratchpad })
    const controller = new AbortController()
    if (!line.keepSignal && line.crash === null) this.requests.add(controller)
    const description = typeof line.input.description === 'string' ? line.input.description : undefined
    const options: PermissionRequestOptions = {
      signal: controller.signal,
      suggestions: line.suggestions,
      toolUseID: line.toolUseId,
      description,
      ...(line.decisionReason === null ? {} : { decisionReason: line.decisionReason }),
      ...(line.agentID === null ? {} : { agentID: line.agentID }),
      ...(line.toolName === ASK_USER_QUESTION ? { requiresUserInteraction: true } : {}),
    }
    const answer = this.request
      .canUseTool(line.toolName, { ...line.input }, options)
      .then((result) => {
        this.record({ kind: 'permission', toolName: line.toolName, input: { ...line.input }, result: { ...result } })
        this.applyUpdates(result)
        return result
      })
      .finally(() => this.requests.delete(controller))
    if (line.crash !== null) {
      // The answer still comes (from worfy's own refusal) and is recorded; nobody reads it.
      void answer.catch(() => undefined)
      throw new Error(line.crash)
    }
    return answer
  }

  /**
   * What the query's PreToolUse hooks decided on the call of a `permission` line, as canUseTool's answer:
   * a refusal with their reason, or an allowance; null when they decided nothing (or there are none).
   * Interrupt and close abort their signal, as Claude Code does.
   */
  private async hooks(line: Extract<Step, { kind: 'permission' }>, made: Promise<FakePreToolUse | undefined>): Promise<PermissionAnswer | null> {
    const run = await made
    if (run === undefined) return null
    const controller = new AbortController()
    this.requests.add(controller)
    try {
      const said = await run({ toolName: line.toolName, toolUseId: line.toolUseId, input: { ...line.input }, cwd: line.cwd ?? this.request.cwd }, controller.signal)
      if (said.decision === null) return null
      const result: PermissionAnswer = said.decision === 'deny' ? { behavior: 'deny', message: said.reason ?? 'Refused by a PreToolUse hook.' } : { behavior: 'allow', updatedInput: { ...line.input } }
      this.record({ kind: 'permission', toolName: line.toolName, input: { ...line.input }, result: { ...result } })
      return result
    } finally {
      this.requests.delete(controller)
    }
  }

  /** The file a `writes` line's call writes, when it ran. */
  private written(line: Extract<Step, { kind: 'permission' }>, answer: PermissionAnswer | null): void {
    if (!line.writes || answer?.behavior === 'deny') return
    const file = line.input.file_path
    if (typeof file !== 'string') return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof line.input.content === 'string' ? line.input.content : '')
  }

  /** Writes an answer's `updatedPermissions` to the settings files they name, as Claude Code does. */
  private applyUpdates(result: PermissionAnswer): void {
    const updates = (result as { updatedPermissions?: unknown }).updatedPermissions
    if (!Array.isArray(updates)) return
    for (const update of updates as unknown[]) {
      const destination = typeof update === 'object' && update !== null ? (update as { destination?: unknown }).destination : undefined
      const file =
        destination === 'localSettings'
          ? join(this.request.cwd, '.claude', 'settings.local.json')
          : destination === 'projectSettings'
            ? join(this.request.cwd, '.claude', 'settings.json')
            : destination === 'userSettings' && this.settingsHome !== null
              ? join(this.settingsHome, 'settings.json')
              : null
      if (file === null) continue
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, `${JSON.stringify({ fakeUpdatedPermissions: [update] }, null, 2)}\n`)
    }
  }

  private abortRequests(): void {
    for (const controller of this.requests) controller.abort()
  }

  /** The assistant message that calls the tool of a `permission` line. */
  private toolUse(line: Extract<Step, { kind: 'permission' }>): unknown {
    return {
      type: 'assistant',
      message: { id: `msg_${line.toolUseId}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: line.toolUseId, name: line.toolName, input: line.input }], stop_reason: null },
      parent_tool_use_id: null,
      session_id: this.session,
      uuid: randomUUID(),
    }
  }

  /** The tool's result as Claude Code reports it to the model: what ran, or the refusal. */
  private toolResult(line: Extract<Step, { kind: 'permission' }>, answer: PermissionAnswer | null): unknown {
    const command = typeof line.input.command === 'string' ? line.input.command : JSON.stringify(line.input)
    const refused = answer?.behavior === 'deny'
    const ran = line.toolName === ASK_USER_QUESTION ? questionResultText(line.input, answer) : `(fake) ${line.toolName} ran: ${command}`
    return {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: line.toolUseId, content: refused ? answer.message : ran, is_error: refused }] },
      parent_tool_use_id: null,
      session_id: this.session,
      uuid: randomUUID(),
    }
  }

  interrupt(): Promise<unknown> {
    this.interruptRequested = true
    this.abortRequests()
    this.wakeInterrupt?.()
    return Promise.resolve({ still_queued: [] })
  }

  close(): void {
    if (!this.closed && this.liveTasks.length > 0) this.record({ kind: 'close', backgroundTasks: [...this.liveTasks] })
    this.closed = true
    this.cancelRelease?.()
    for (const stop of this.signIns) stop()
    this.signIns.clear()
    this.abortRequests()
    this.wakeInterrupt?.()
    this.wake()
    this.unregister()
  }

  /** Claude Code's entry leaves the registry with its process. */
  private unregister(): void {
    const file = this.registryEntry
    this.registryEntry = null
    if (file !== null) removeFile(file)
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    try {
      yield* this.play()
    } finally {
      // The process ended: by exit, crash or close.
      this.unregister()
    }
  }

  private async *play(): AsyncGenerator<unknown> {
    this.readInput()
    const body = this.steps
    if (body.length === 0) return
    for (;;) {
      for (const line of body) {
        if (this.closed) return
        switch (line.kind) {
          case 'message':
            // Lets the consumer react between messages, as a real stream would.
            await Promise.resolve()
            this.liveTasks = liveTaskIds(line.message) ?? this.liveTasks
            yield this.current(line.message)
            break
          case 'wait_message':
            if (!(await this.nextMessage())) return
            break
          case 'wait_interrupt':
            if (!this.interruptRequested) {
              await new Promise<void>((resolve) => {
                this.wakeInterrupt = resolve
              })
              this.wakeInterrupt = null
            }
            this.interruptRequested = false
            break
          case 'wait_release':
            await this.releases.wait(line.name, {
              onCancel: (stop) => {
                this.cancelRelease = stop
              },
            })
            this.cancelRelease = null
            break
          case 'stderr':
            this.request.stderr(line.text)
            break
          case 'context':
            this.context = line.answer
            break
          case 'mcp':
            this.mcp = line.answer
            break
          case 'mcp_added':
            this.added = line.added
            break
          case 'crash':
            throw new Error(line.error)
          case 'exit':
            return
          case 'permission': {
            await Promise.resolve()
            yield this.toolUse(line)
            const answer = await this.ask(line)
            if (this.closed) return
            this.written(line, answer)
            yield this.toolResult(line, answer)
            break
          }
        }
      }
    }
  }
}

/**
 * What Claude Code tells the model for an allowed AskUserQuestion call, as its binary (SDK 0.3.289)
 * does: no `answers` — the user did not answer; every answer one of its question's labels (a
 * multiSelect answer split at ", ") — "have been answered"; any other text — the user's own words.
 */
export function questionResultText(input: Record<string, unknown>, answer: PermissionAnswer | null): string {
  const given = answer?.behavior === 'allow' ? answer.updatedInput.answers : undefined
  const answers = typeof given === 'object' && given !== null ? Object.entries(given as Record<string, unknown>).filter((each): each is [string, string] => typeof each[1] === 'string') : []
  if (answers.length === 0) return 'The user did not answer the questions.'
  const questions = Array.isArray(input.questions) ? (input.questions as { question?: unknown; multiSelect?: unknown; options?: { label?: unknown }[] }[]) : []
  const picked = answers.every(([text, value]) => {
    const question = questions.find((each) => each.question === text)
    const labels = (question?.options ?? []).map((option) => option.label)
    return (question?.multiSelect === true ? value.split(MULTI_SELECT_SEPARATOR) : [value]).every((part) => labels.includes(part))
  })
  const said = answers.map(([text, value]) => `"${text}"="${value}"`).join(', ')
  return picked
    ? `Your questions have been answered: ${said}. You can now continue with these answers in mind.`
    : `The user answered: ${said}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`
}

export interface FakeQueryOptions {
  scriptsDir: string
  /** The script to play for a request; a test may pick one per Session or per resume. */
  script: string | ((request: QueryRequest) => string)
  /** Gets what every fake query was asked to do (FakeCall). */
  record?: ((call: FakeCall) => void) | undefined
  /**
   * Stands for ~/.claude when an answer's `updatedPermissions` write `userSettings`; without it
   * such an update is not applied, so a fake run never writes the real ~/.claude.
   */
  settingsHome?: string | undefined
  /**
   * What lets the `wait_release` lines pass. Without it the factory makes its own and puts its
   * `release` on `globalThis.worfyFakeRelease`, where an e2e test reaches it (app.evaluate).
   */
  releases?: FakeReleases | undefined
  /**
   * Stands for ~/.claude when the fake agent registers itself in <registryHome>/sessions, as Claude
   * Code does before system/init; without it nothing is written.
   */
  registryHome?: string | undefined
  /**
   * The query's PreToolUse hooks for a request (worfy-polish ticket 82: a Product Session's guard,
   * src/main/vendors/claude/query.ts productHooks), run before canUseTool on each `permission` line;
   * undefined — from the option or from its promise —, or absent: none.
   */
  preToolUse?: ((request: QueryRequest) => Promise<FakePreToolUse | undefined> | undefined) | undefined
  /**
   * The Profile's list of MCP servers of a request (worfy-mcp-live ticket 05): the fake agent's answers leave
   * out every server it does not name, as Claude Code's policy tier does, and the request is told it
   * (QueryRequest.mcpListed). Absent: no list, every server the script names; told null.
   */
  mcpAllowlist?: ((request: QueryRequest) => Promise<readonly string[] | null>) | undefined
  /**
   * The Integrations of the request's Project (worfy-integrations ticket 08): each is listed by mcpServerStatus() as a
   * connected server of worfy's (scope sdk) with the tools its proxy listed — asked of the service once, at the start,
   * as Claude Code lists an SDK server's tools — and `label` marks its row as an Integration's. Absent: none.
   */
  integrations?: ((request: QueryRequest) => Promise<readonly FakeIntegration[]>) | undefined
  /** Marks the rows of the Integrations of `query` (src/main/vendors/claude/mcp.ts, labelIntegrations). */
  labelIntegrations?: ((query: QueryHandle, servers: readonly FakeIntegration[], request: QueryRequest) => void) | undefined
}

/** An Integration as the fake agent lists it: its server name, its label and the names of the tools its proxy gave. */
export interface FakeIntegration {
  /** The Integration's id, for its row (worfy-integrations ticket 09); absent in a script's own list. */
  id?: string | undefined
  name: string
  label: string
  tools: readonly string[]
}

/** One tool call as the PreToolUse hooks get it: the tool, its id, its input and the shell's folder. */
export interface FakeToolCall {
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  cwd: string
}

/** Runs the query's PreToolUse hooks on one call: what they decided (`allow`, `deny` or nothing) and the reason they gave. */
export type FakePreToolUse = (call: FakeToolCall, signal: AbortSignal) => Promise<{ decision: 'allow' | 'deny' | null; reason: string | null }>

export function fakeQueryFactory(options: FakeQueryOptions): QueryFactory {
  const record = options.record ?? (() => {})
  let releases = options.releases
  if (releases === undefined) {
    const own = new FakeReleases()
    releases = own
    ;(globalThis as { worfyFakeRelease?: (name: string) => void }).worfyFakeRelease = (name) => own.release(name)
  }
  const shared = releases
  return async (request) => {
    const name = typeof options.script === 'string' ? options.script : options.script(request)
    const listed = options.mcpAllowlist === undefined ? null : await options.mcpAllowlist(request)
    request.mcpListed?.(listed)
    const integrations = options.integrations === undefined ? [] : await options.integrations(request).catch(() => [])
    const query = new FakeQuery(join(options.scriptsDir, `${name}.jsonl`), request, record, options.settingsHome ?? null, shared, options.registryHome ?? null, options.preToolUse, listed, false, integrations)
    options.labelIntegrations?.(query, integrations, request)
    return query
  }
}

/**
 * The query of the MCP inventory on the fake agent (worfy-mcp-live ticket 05; mcp-inventory.ts): the script
 * of `options` read as the user's config — mcpServerStatus() answers its first `mcp` line, no Profile list
 * applied —, no message read, nothing played; recorded as `inventory`. `prompt` is its input, never read.
 */
export function fakeInventoryStarter(options: FakeQueryOptions): (cwd: string, prompt: AsyncIterable<never>) => Promise<QueryHandle> {
  const record = options.record ?? (() => {})
  const releases = options.releases ?? new FakeReleases()
  return (cwd, prompt) => {
    const request: QueryRequest = {
      prompt,
      cwd,
      resume: undefined,
      stderr: () => undefined,
      settings: { model: null, effort: null, permissionMode: 'default' },
      canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'The inventory runs no tool.' }),
    }
    const name = typeof options.script === 'string' ? options.script : options.script(request)
    return Promise.resolve(new FakeQuery(join(options.scriptsDir, `${name}.jsonl`), request, record, null, releases, null, undefined, null, true))
  }
}
