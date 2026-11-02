// The session part of the Codex driver (ADR-0094 item 2, worfy-multi-vendor ticket 20): one
// `codex app-server` process per Session handle (app-server.ts, ticket 19), or the fake app-server under
// WORFY_CODEX=fake, behind worfy's SessionHandle.
//
// - start: `thread/start {cwd, approvalPolicy, sandbox, model}`; resume: `thread/resume {threadId, …}`.
//   The start check of a Codex Session is that thread answering: the handle then gives `account`, and the
//   Session takes messages. Whether the user is signed in to Codex is the account part's question
//   (ticket 21); a turn of a signed-out Codex fails with Codex's own error.
// - send: `turn/start` when no turn runs, `turn/steer {expectedTurnId}` into the one that does. The
//   Session's queue stays worfy's own (src/main/agent/queue.ts), not `thread/queue/*`, which is
//   experimental. Sends go one after the other, so a message sent while a turn is being started steers it.
// - setModel, setEffort, setPermissionPreset: what the next `turn/start` takes — only what changed
//   since the thread was last told (the stable surface: a change does not reach a running turn). null
//   — "Default" — is the model `model/list` marks as default, and that model's default effort.
// - interrupt: every open approval is answered `cancel`, then `turn/interrupt`.
// - close: open approvals are answered `cancel`, then the process ends (CodexAppServer.close).
// - presets → approval policy and sandbox (capabilities.ts, codexPresetFor); notifications → events
//   (items.ts); approvals → permission requests (approvals.ts). An unattended Session (Autopilot)
//   declines every approval at once and reports it through `refused`, so its turn never waits for a person.
//
// The process is reported to the Session (SessionStart.spawned) the moment it is spawned, before its
// handshake: a Session closed while the start runs waits for that process too, every failure of the
// start closes it (CodexAppServer.start and open() below), and the Session closes a handle that comes
// after it closed. So the start needs no way of its own to be stopped, and leaves no process behind.
//
// Texts out of the process: its stderr goes, as it comes, to SessionStart.stderr, which the Session
// keeps a bounded tail of and adds to the error of a process that died (as for Claude Code); the error
// the events end with names only the exit code. An error text of the app-server that goes into an
// event is bounded (items.ts, boundedText).
//
// app-server.ts is loaded at the first start, not with this file: its JSON-RPC client checks every
// message against the JSON Schema bundle of the pinned Codex (rpc.ts), and the driver is loaded at
// every start of worfy, also for users who never start Codex.
import { spawn } from 'node:child_process'
import { messageText } from '../../../shared/agent/attachments'
import type { SlashCommand } from '../../../shared/agent/commands'
import type { AgentEvent } from '../../../shared/agent/events'
import type { ModelOption } from '../../../shared/agent/settings'
import { InputQueue } from '../../agent/session/input-queue'
import { hasExited, within } from '../../agent/session/process'
import type { SessionHandle, SessionMessage, SessionPart, SessionStart } from '../session'
import type { CodexAppServer } from './app-server'
import { approvalAsk, decisionOf, isApprovalRequest, UNATTENDED_DECLINED_MESSAGE, type CodexDecision } from './approvals'
import type { CodexRuntime } from './binary'
import { codexModelOptions, codexPermissionPreset, codexPresetFor, codexSandboxPolicy, type CodexModelSource } from './capabilities'
import { boundedText, CodexItems } from './items'
import type { SpawnProcess } from './launch'
import type { RequestId } from './protocol/ts/RequestId'
import type { ServerNotification } from './protocol/ts/ServerNotification'
import type { ServerRequest } from './protocol/ts/ServerRequest'
import type { Model } from './protocol/ts/v2/Model'
import type { ModelListResponse } from './protocol/ts/v2/ModelListResponse'
import type { ThreadStartResponse } from './protocol/ts/v2/ThreadStartResponse'
import type { TurnStartParams } from './protocol/ts/v2/TurnStartParams'
import type { TurnStartResponse } from './protocol/ts/v2/TurnStartResponse'
import type { UserInput } from './protocol/ts/v2/UserInput'
import type { ClientMethod, CodexRpcEvent, ParamsOf } from './rpc'

/** How a Codex app-server is started for a Session; the app's own unless a test gives one. */
export interface CodexServerOptions {
  runtime: CodexRuntime
  /** app.getAppPath(): where the fake and its scripts are under WORFY_CODEX=fake. */
  appPath: string
  /** worfy's version, as clientInfo.version. */
  clientVersion: string
  /** The environment of the process; process.env by default. */
  env?: NodeJS.ProcessEnv
  /** child_process.spawn by default. */
  spawnProcess?: SpawnProcess
  /** How long a request waits for its answer; rpc.ts's REQUEST_TIMEOUT_MS by default. */
  timeoutMs?: number
  log?: (line: string) => void
}

/** The JSON-RPC error a server→client request worfy does not answer gets (rpc.ts's METHOD_NOT_FOUND). */
const METHOD_NOT_FOUND = -32601

/** How many pages of `model/list` a Session reads at most. */
const MODEL_PAGES = 10

/** What a turn runs with: the model and effort (null: Codex's default) and the id of a Codex preset. */
interface TurnSettings {
  model: string | null
  effort: string | null
  preset: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** The exit of the app-server an error tells of (CodexAppServerExit), or null for any other error. */
function exitOf(error: unknown): ProcessExit | null {
  if (!(error instanceof Error) || error.name !== 'CodexAppServerExit') return null
  const { code, signal } = error as Error & Partial<ProcessExit>
  return { code: code ?? null, signal: signal ?? null }
}

/** How the process ended, without its stderr: the Session has that from SessionStart.stderr. */
export function exitText({ code, signal }: ProcessExit): string {
  return `Codex app-server ${signal !== null ? `was stopped by ${signal}` : `exited with code ${code ?? 'unknown'}`}`
}

/** The error a start rejects with: how the process ended, or the error bounded. */
function startError(error: unknown): Error {
  const exit = exitOf(error)
  return new Error(exit !== null ? `${exitText(exit)} before the Session started` : boundedText(`Codex did not start the Session: ${messageOf(error)}`), { cause: error })
}

/** The user's message as Codex's input: each image as a data URL, then the text with the attached files' paths. */
export function userInput(message: SessionMessage): UserInput[] {
  const images: UserInput[] = message.attachments.flatMap((each) => (each.kind === 'image' ? [{ type: 'image' as const, url: `data:${each.mediaType};base64,${each.data}` }] : []))
  const text = messageText(message.text, message.attachments)
  return text === '' && images.length > 0 ? images : [...images, { type: 'text', text, text_elements: [] }]
}

/** One `codex app-server` process of a Session, behind worfy's SessionHandle. */
class CodexSession implements SessionHandle, CodexModelSource {
  private server: CodexAppServer | null = null
  private threadId = ''
  private readonly out = new InputQueue<AgentEvent>()
  /** Set once the events ended or the handle was closed: nothing more goes out. */
  private done = false
  /** The turn that runs, once Codex named it; null between turns. */
  private activeTurn: string | null = null
  /** The turn that ended last: its `turn/start` answer, if late, does not make it run again. */
  private lastEnded: string | null = null
  /** The sends so far, one after the other; never rejects. */
  private sending: Promise<void> = Promise.resolve()
  /** Open approvals, by the id of their request: the controller withdraws the Session's request. */
  private readonly approvals = new Map<RequestId, AbortController>()
  private modelList: Promise<Model[]> | null = null
  /** The model the thread runs on, as Codex last named it. */
  private model = ''
  /** The version of Codex that runs the thread, as the thread names it. */
  private version: string | null = null
  /** What the next turn is to run with. */
  private readonly wanted: TurnSettings
  /** What the thread was last told: by its start, then by each `turn/start` that named a change. */
  private told: TurnSettings
  private readonly items: CodexItems

  constructor(
    private readonly opts: SessionStart,
    preset: string,
  ) {
    // Effort is not part of thread/start: the thread starts on Codex's own, and the first turn names the Session's.
    this.told = { model: opts.settings.model, effort: null, preset }
    this.wanted = { model: opts.settings.model, effort: opts.settings.effort, preset }
    this.items = new CodexItems({
      threadId: () => this.threadId,
      cwd: () => opts.cwd,
      version: () => this.version,
      model: () => this.model,
      preset: () => this.told.preset,
    })
  }

  /** The process, once its handshake is done: what it sends from now on reaches this handle. */
  started(server: CodexAppServer): void {
    this.server = server
  }

  /** The thread answered: the Session takes messages, and the end of the process ends the events. */
  attach(response: ThreadStartResponse, outputAfterExitMs: number): void {
    const server = this.server as CodexAppServer
    this.threadId = response.thread.id
    this.model = response.model
    this.version = typeof response.thread.cliVersion === 'string' ? response.thread.cliVersion : null
    const child = server.process
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    const ended = (code: number | null, signal: NodeJS.Signals | null): void => {
      void within(closed, outputAfterExitMs).then(() => this.finish(new Error(exitText({ code, signal }))))
    }
    if (hasExited(child)) ended(child.exitCode, child.signalCode)
    else child.once('exit', ended)
    this.out.push({ type: 'account', loggedIn: true, subscriptionType: null, apiProvider: null, tokenSource: null })
  }

  readonly events: AsyncIterable<AgentEvent> = { [Symbol.asyncIterator]: () => this.out[Symbol.asyncIterator]() }

  /** One message of the app-server. */
  receive(event: CodexRpcEvent): void {
    if (this.done) return
    switch (event.type) {
      case 'notification':
        return this.notified(event.notification)
      case 'request':
        return this.asked(event.request)
      case 'unknown':
        return this.out.push({ type: 'unknown', sdkType: event.method ?? 'message' })
      case 'error':
        return this.out.push({ type: 'unknown', sdkType: 'not-json' })
    }
  }

  send(message: SessionMessage): Promise<void> {
    const input = userInput(message)
    this.sending = this.sending.then(() => this.deliver(input))
    return this.sending
  }

  async interrupt(): Promise<void> {
    this.cancelApprovals()
    await this.sending
    const turn = this.activeTurn
    if (turn === null || this.done) return
    try {
      await this.request('turn/interrupt', { threadId: this.threadId, turnId: turn })
    } catch (error) {
      // The turn ended before the request reached it (a `cancel` stops it too), or the process is gone.
      if (this.done || this.activeTurn !== turn || exitOf(error) !== null) return
      throw new Error(boundedText(`Codex did not interrupt the turn: ${messageOf(error)}`), { cause: error })
    }
  }

  close(): void {
    this.cancelApprovals()
    this.done = true
    this.out.end()
    void this.server?.close()
  }

  async setModel(model: string | null): Promise<void> {
    this.live()
    this.wanted.model = model
  }

  async setEffort(effort: string | null): Promise<void> {
    this.live()
    this.wanted.effort = effort
  }

  async setPermissionPreset(id: string): Promise<void> {
    const preset = codexPresetFor(id)
    if (preset === undefined) throw new Error(`${id} is no permission preset of Codex`)
    this.live()
    this.wanted.preset = preset.id
  }

  async models(): Promise<ModelOption[]> {
    try {
      return codexModelOptions(await this.codexModels())
    } catch (error) {
      console.warn(`[codex] model/list of thread ${this.threadId} failed`, error)
      return []
    }
  }

  /** The slash menu is the commands part's (ticket 22). */
  commands(): Promise<SlashCommand[]> {
    return Promise.resolve([])
  }

  /** The models of `model/list`, asked once per process; a failed ask is asked again next time. */
  codexModels(): Promise<Model[]> {
    if (this.server === null || this.done) return Promise.reject(new Error('Codex is not running'))
    const list = (this.modelList ??= this.listModels())
    list.catch(() => {
      if (this.modelList === list) this.modelList = null
    })
    return list
  }

  private async listModels(): Promise<Model[]> {
    const models: Model[] = []
    let cursor: string | null = null
    for (let page = 0; page < MODEL_PAGES; page++) {
      const answer: ModelListResponse = await this.request<ModelListResponse>('model/list', cursor === null ? {} : { cursor })
      models.push(...answer.data)
      cursor = answer.nextCursor ?? null
      if (cursor === null) break
    }
    return models
  }

  private live(): void {
    if (this.server === null || this.done) throw new Error('Codex is not running')
  }

  private request<R = unknown, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>): Promise<R> {
    const server = this.server
    return server === null ? Promise.reject(new Error('Codex is not running')) : server.request<R, M>(method, params)
  }

  /** One message: into the turn that runs, or as a new turn. Never rejects. */
  private async deliver(input: UserInput[]): Promise<void> {
    if (this.done) return
    const turn = this.activeTurn
    try {
      if (turn !== null && (await this.steer(turn, input))) return
      await this.startTurn(input)
    } catch (error) {
      // A process that is gone ends the events itself.
      if (this.done || exitOf(error) !== null) return
      this.out.push({
        type: 'result',
        subtype: 'error',
        isError: true,
        error: boundedText(`Codex did not start the turn: ${messageOf(error)}`),
        text: null,
        costUsd: 0,
        durationMs: 0,
        numTurns: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        terminalReason: 'error',
        interrupted: false,
      })
    }
  }

  /**
   * Steers the turn `turn`. False when the turn ended before the message reached it: the message then
   * starts the next one. A refusal while it still runs leaves the turn as it is and says so in a notice.
   */
  private async steer(turn: string, input: UserInput[]): Promise<boolean> {
    try {
      await this.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: turn })
      return true
    } catch (error) {
      if (this.done || exitOf(error) !== null) return true
      if (this.activeTurn !== turn) return false
      this.out.push({ type: 'notice', kind: 'notification', text: boundedText(`Codex did not take the message into the running turn: ${messageOf(error)}`) })
      return true
    }
  }

  private async startTurn(input: UserInput[]): Promise<void> {
    const { params, told, model } = await this.overrides()
    // The turn's `init` may come before the answer to turn/start: it names what the turn runs with already.
    const before = { told: this.told, model: this.model }
    this.told = told
    this.model = model
    let answer: TurnStartResponse
    try {
      answer = await this.request<TurnStartResponse>('turn/start', { threadId: this.threadId, input, ...params })
    } catch (error) {
      // Codex did not take the changes: the next turn names them again.
      this.told = before.told
      this.model = before.model
      throw error
    }
    if (answer.turn.id !== this.lastEnded) this.activeTurn = answer.turn.id
  }

  /** What the next `turn/start` names besides its input: each setting that changed since the thread was told. */
  private async overrides(): Promise<{ params: Partial<TurnStartParams>; told: TurnSettings; model: string }> {
    const { wanted } = this
    const told = { ...this.told }
    const params: Partial<TurnStartParams> = {}
    let model = this.model
    if (wanted.model !== told.model) {
      const named = wanted.model ?? (await this.listed()).find((each) => each.isDefault)?.model
      if (named !== undefined) {
        params.model = named
        model = named
        told.model = wanted.model
      }
    }
    if (wanted.effort !== told.effort) {
      const effort = wanted.effort ?? (await this.listed()).find((each) => each.model === model)?.defaultReasoningEffort
      if (effort !== undefined) {
        params.effort = effort
        told.effort = wanted.effort
      }
    }
    const preset = wanted.preset !== told.preset ? codexPermissionPreset(wanted.preset) : undefined
    if (preset !== undefined) {
      params.approvalPolicy = preset.approvalPolicy
      params.sandboxPolicy = codexSandboxPolicy(preset.sandbox)
      told.preset = preset.id
    }
    return { params, told, model }
  }

  /** The models of `model/list`; none when Codex cannot say, and the setting waits for a later turn. */
  private async listed(): Promise<Model[]> {
    try {
      return await this.codexModels()
    } catch (error) {
      console.warn(`[codex] model/list of thread ${this.threadId} failed`, error)
      return []
    }
  }

  private notified(notification: ServerNotification): void {
    // Request ids are the process's, not a thread's: Codex withdraws an approval of any of its threads.
    if (notification.method === 'serverRequest/resolved') this.withdraw(notification.params.requestId)
    const { threadId } = (notification.params ?? {}) as { threadId?: unknown }
    // Another thread of the same process (a Subagent's) is not this Session's: none of its events are
    // shown, but its approvals are asked here, and they name their item only by id.
    if (typeof threadId === 'string' && this.threadId !== '' && threadId !== this.threadId) return this.items.follow(notification)
    if (notification.method === 'turn/started') this.activeTurn = notification.params.turn.id
    for (const event of this.items.take(notification)) {
      if (event.type === 'result') this.turnEnded(notification.method === 'error' ? notification.params.turnId : (notification.params as { turn: { id: string } }).turn.id)
      this.out.push(event)
    }
  }

  private turnEnded(turn: string): void {
    this.lastEnded = turn
    if (this.activeTurn === turn) this.activeTurn = null
  }

  private asked(request: ServerRequest): void {
    const server = this.server
    if (server === null) return
    if (!isApprovalRequest(request)) {
      server.respondError(request.id, METHOD_NOT_FOUND, `worfy does not answer ${request.method}`)
      this.out.push({ type: 'unknown', sdkType: request.method })
      return
    }
    const ask = approvalAsk(request, this.items.item(request.params.itemId))
    if (this.opts.unattended) {
      server.respond(request.id, { decision: 'decline' })
      this.opts.refused(ask.subject, UNATTENDED_DECLINED_MESSAGE, ask.description === null ? {} : { reason: ask.description })
      return
    }
    const controller = new AbortController()
    this.approvals.set(request.id, controller)
    this.opts.permissions.ask({ ...ask, signal: controller.signal }).then(
      (picked) => this.answer(request.id, decisionOf(picked)),
      () => this.answer(request.id, 'cancel'),
    )
  }

  /** Answers an approval still open; one Codex withdrew or worfy already answered gets nothing more. */
  private answer(id: RequestId, decision: CodexDecision): void {
    if (this.approvals.delete(id)) this.server?.respond(id, { decision })
  }

  /** Codex resolved a request itself: the Session's request is withdrawn, and worfy answers nothing. */
  private withdraw(id: RequestId): void {
    const controller = this.approvals.get(id)
    if (controller === undefined) return
    this.approvals.delete(id)
    controller.abort()
  }

  /** Answers `cancel` to every open approval at once, then withdraws the Session's requests. */
  private cancelApprovals(): void {
    const open = [...this.approvals]
    this.approvals.clear()
    for (const [id] of open) this.server?.respond(id, { decision: 'cancel' })
    for (const [, controller] of open) controller.abort()
  }

  /** The process is gone: the events end with how it ended. */
  private finish(error: Error): void {
    if (this.done) return
    this.done = true
    for (const controller of this.approvals.values()) controller.abort()
    this.approvals.clear()
    this.out.fail(error)
  }
}

/** Starts the app-server, then its thread; a failure on the way closes the process and rejects. */
async function open(options: CodexServerOptions, opts: SessionStart, resume: string | undefined): Promise<SessionHandle> {
  const preset = codexPresetFor(opts.settings.permissionMode)
  if (preset === undefined) throw new Error(`${opts.settings.permissionMode} is no permission preset of Codex`)
  const session = new CodexSession(opts, preset.id)
  const { CodexAppServer, OUTPUT_AFTER_EXIT_MS } = await import('./app-server')
  const spawnProcess = options.spawnProcess ?? spawn
  let server: CodexAppServer
  try {
    server = await CodexAppServer.start({
      runtime: options.runtime,
      appPath: options.appPath,
      cwd: opts.cwd,
      clientVersion: options.clientVersion,
      env: options.env,
      timeoutMs: options.timeoutMs,
      log: options.log,
      onEvent: (event) => session.receive(event),
      spawnProcess: (file, args, spawnOptions) => {
        const child = spawnProcess(file, args, spawnOptions)
        opts.spawned(child)
        child.stderr?.on('data', (chunk: unknown) => opts.stderr(String(chunk)))
        return child
      },
    })
  } catch (error) {
    throw startError(error)
  }
  session.started(server)
  try {
    const params = { cwd: opts.cwd, approvalPolicy: preset.approvalPolicy, sandbox: preset.sandbox, ...(opts.settings.model === null ? {} : { model: opts.settings.model }) }
    const response =
      resume === undefined
        ? await server.request<ThreadStartResponse, 'thread/start'>('thread/start', params)
        : await server.request<ThreadStartResponse, 'thread/resume'>('thread/resume', { threadId: resume, ...params })
    session.attach(response, OUTPUT_AFTER_EXIT_MS)
  } catch (error) {
    session.close()
    await server.close()
    throw startError(error)
  }
  return session
}

/** The session part of the Codex driver over the app-server `options` give: the app's (codexSession), or a test's. */
export function codexSessions(options: () => Promise<CodexServerOptions>): SessionPart {
  return {
    start: async (opts) => open(await options(), opts, undefined),
    resume: async (id, opts) => open(await options(), opts, id),
  }
}

/** The app's app-server: the pinned Codex of this build, or the fake under WORFY_CODEX=fake. */
async function appServerOptions(): Promise<CodexServerOptions> {
  const { app } = await import('electron')
  return {
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    appPath: app.getAppPath(),
    clientVersion: app.getVersion(),
  }
}

export const codexSession: SessionPart = codexSessions(appServerOptions)
