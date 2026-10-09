// The assist process of Terminal AI (ADR-0058): one Claude Code process for every Terminal, on the
// subscription, that answers Suggestion, Next command, Command request and Fix with one command.
// It is not a Session: no Node, no Binding, no transcript.
//
// The process (ADR-0058, point 2). The first request starts a spare process (`prewarm()`); a request
// binds it with `claim()` and the settings of its feature, for one turn. After the answer or a
// cancel that process is closed and the next spare is started at once. A spare left without
// requests for IDLE_MS is closed. A request that comes while the spare is still starting waits for
// it and starts no second one.
//
// The queue (spec, "Решено без владельца", point 3). One request in flight. A new automatic request
// (suggest, next) cancels an automatic one in flight; an on-demand request (request, fix) cancels an
// automatic one and is never cancelled itself: the next on-demand request waits for it, and an
// automatic one is refused as `busy` meanwhile.
//
// A request is refused before anything goes out when its feature is off in Settings, a command is
// running or a full-screen program holds the Terminal, a Suggestion's line starts with a space, or
// the Limits stop the feature (limits-gate.ts). In flight it ends on its timeout (options.ts), on a
// Suggestion stream that thinks, on `option_not_applied` of a Suggestion, or on a refused claim. A
// refused claim (the prompt did not go out) of request or fix is retried once with a cold query();
// of suggest or next it is a refusal at once.
//
// Every message of every request goes to the Limits (appLimits().recordSdkMessage), as observe()
// does for Sessions: each process sends its rate_limit_event, so the toolbar's LimitsMeter is fresh
// after every request.
//
// The log has one line per process start (Claude Code version, apiKeySource, plugins, hooks that
// ran) and one per request (the feature and the model). Never the request, the answer or the context.
//
// The SDK is passed in (AssistBackend): tests pass a fake SDK through sdkBackend() or the file fake
// (fake-backend.ts); with WORFY_AGENT=fake the app takes the file fake and never imports the SDK, and
// under vitest the real backend throws rather than start Claude Code.
import { mkdirSync } from 'node:fs'
import type { ClaimOptions, Options } from '@anthropic-ai/claude-agent-sdk'
import type { LimitsState } from '../../shared/agent/limits'
import type { AssistProcessState, TerminalAiFeatureState, TerminalAiState } from '../../shared/ipc/terminal-ai'
import { contextText, isPrivateLine, prepareContext, type TerminalAiContext, type TerminalAiInput } from '../../shared/terminal-ai/context'
import { featureEnabled, isAutomatic, TERMINAL_AI_FEATURES, type TerminalAiFeature, type TerminalAiSettings, type TerminalAiSettingsPatch } from '../../shared/terminal-ai/settings'
import { wallTimer } from '../autopilot/limits-wait'
import { fakeAssistBackend } from './fake-backend'
import { gitBranch } from './git-branch'
import { limitsGate } from './limits-gate'
import { claimOptions, coldQueryOptions, featureModel, FEATURE_TIMEOUT_MS } from './options'

// ---- the backend: the SDK as the service uses it --------------------------------------------------

/** What a backend may use besides the SDK's own parameters: the file fake answers and logs by it. */
export interface AssistMeta {
  feature: TerminalAiFeature
  /** The context after redaction (prepareContext). */
  context: TerminalAiContext
}

/** A Query: its messages, and close() that ends the process. */
export interface AssistQuery extends AsyncIterable<unknown> {
  close(): void
}

/** A spare process (the SDK's SpareProcess). */
export interface AssistSpare {
  claim(params: { prompt: string; options: ClaimOptions }, meta: AssistMeta): AssistQuery
  /** Rejects when the claim is refused; `option_not_applied: …` means the prompt went out anyway. */
  readonly claimed: Promise<unknown>
  readonly exited: Promise<void>
  close(): void
}

export interface AssistBackend {
  prewarm(options: Options): Promise<AssistSpare>
  query(params: { prompt: string; options: Options }, meta: AssistMeta): AssistQuery
}

/** The part of `@anthropic-ai/claude-agent-sdk` the service uses. */
export interface AssistSdk {
  prewarm(params?: { options?: Options }): Promise<{
    claim(params: { prompt: string; options: ClaimOptions }): AssistQuery
    readonly claimed: Promise<unknown>
    readonly exited: Promise<void>
    close(): void
  }>
  query(params: { prompt: string; options?: Options }): AssistQuery
}

/** The backend over an SDK module (the real one, or a test's fake SDK). */
export function sdkBackend(sdk: AssistSdk): AssistBackend {
  return {
    async prewarm(options) {
      const spare = await sdk.prewarm({ options })
      // `claimed` rejects also when a spare is closed unclaimed (spare_closed): never unhandled.
      spare.claimed.catch(() => undefined)
      return {
        claim: (params) => spare.claim(params),
        claimed: spare.claimed,
        exited: spare.exited,
        close: () => spare.close(),
      }
    },
    query: (params) => sdk.query(params),
  }
}

/** Loads the Agent SDK; the one place the service imports it. */
export type SdkLoader = () => Promise<AssistSdk>

const loadSdk: SdkLoader = async () => (await import('@anthropic-ai/claude-agent-sdk')) as AssistSdk

/**
 * The real Claude Code. Throws under vitest before the SDK is loaded: a test never starts Claude
 * Code and never spends the subscription.
 */
export async function realBackend(env: NodeJS.ProcessEnv = process.env, load: SdkLoader = loadSdk): Promise<AssistBackend> {
  if (env.VITEST) throw new Error('the real Terminal AI backend is not started under vitest: use WORFY_AGENT=fake or pass a backend')
  return sdkBackend(await load())
}

/** The fake of fake-backend.ts with WORFY_AGENT=fake (the SDK is not loaded), the real Claude Code otherwise. */
export async function backendFromEnv(env: NodeJS.ProcessEnv = process.env, load: SdkLoader = loadSdk): Promise<AssistBackend> {
  if (env.WORFY_AGENT === 'fake') return fakeAssistBackend({ answersFile: env.WORFY_TERMINAL_AI_ANSWERS, logFile: env.WORFY_TERMINAL_AI_LOG })
  return realBackend(env, load)
}

// ---- answers ---------------------------------------------------------------------------------------

export type AssistRefusalReason =
  | 'off'
  | 'limits'
  | 'command-running'
  | 'alternate-screen'
  | 'private-line'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'thinking'
  | 'option-not-applied'
  | 'not-claimed'
  | 'empty'
  | 'failed'

export type AssistAnswer =
  | { ok: true; command: string; model: string }
  | {
      ok: false
      reason: AssistRefusalReason
      /** For `limits`: when the pause lifts (milliseconds since the epoch). */
      until?: number
      /** A short code of what failed (an SDK refusal code), never text of the request. */
      detail?: string
    }

/**
 * The command out of the model's text: its first line. Backticks around it go, a code block gives
 * its first line, a leading `$ ` prompt goes, and anything after the first line (an explanation) too.
 */
export function commandOf(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first === -1) return ''
  let line = lines[first]?.trim() ?? ''
  if (line.startsWith('```')) line = lines.slice(first + 1).find((inner) => inner.trim() !== '' && !inner.trim().startsWith('```'))?.trim() ?? ''
  const quoted = /^`+([^`]*)`+$/.exec(line)
  if (quoted) line = (quoted[1] ?? '').trim()
  return line.replace(/^\$\s+/, '')
}

// ---- the service ---------------------------------------------------------------------------------

/** A spare without requests for this long is closed (ADR-0058, point 2: "about 10 minutes"). */
export const IDLE_MS = 10 * 60 * 1000

export interface AssistLimits {
  snapshot(): LimitsState
  subscribe(listener: (state: LimitsState) => void): () => void
  recordSdkMessage(message: unknown): void
}

export interface AssistSettings {
  get(): TerminalAiSettings
  set(patch: TerminalAiSettingsPatch): TerminalAiSettings
}

export interface AssistServiceOptions {
  /** Made on the first request that needs a process; a rejection fails that request. */
  backend: () => Promise<AssistBackend>
  /** The options of prewarm() (options.ts, prewarmOptions), made for every spare. */
  prewarmOptions: () => Promise<Options>
  settings: AssistSettings
  limits: AssistLimits
  /** WORFY_DATA_DIR: requests run in its empty `terminal-ai` folder. */
  dataDir: string
  /** The git branch of a folder; gitBranch by default. */
  branchOf?: (cwd: string) => Promise<string | null>
  now?: () => number
  /** Calls `fire` once at wall time `at`; answers the cancel (wallTimer by default). */
  schedule?: (at: number, fire: () => void) => () => void
  /** One line of the log; console.info by default. */
  log?: (line: string) => void
}

class Aborted extends Error {
  constructor(readonly reason: AssistRefusalReason) {
    super(reason)
  }
}

interface Flight {
  feature: TerminalAiFeature
  controller: AbortController
  done: Promise<void>
}

interface SpareSlot {
  promise: Promise<AssistSpare | null>
  spare: AssistSpare | null
}

/** How one attempt (a claim, or the cold query) ended. */
type Attempt = { kind: 'answer'; text: string } | { kind: 'failed'; detail: string } | { kind: 'not-claimed'; detail: string } | { kind: 'aborted'; reason: AssistRefusalReason }

/** What abortable() answers when the signal aborts first. */
const ABORTED: unique symbol = Symbol('aborted')

const reasonOf = (signal: AbortSignal): AssistRefusalReason => (typeof signal.reason === 'string' ? (signal.reason as AssistRefusalReason) : 'cancelled')

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The code of an SDK refusal (`settings_not_applied: …` → `settings_not_applied`): no free text goes to the log. */
const refusalCode = (message: string): string => /^[a-z_]+/.exec(message)?.[0] ?? 'unknown'

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null)

/** A thinking block starts in this message (a stream event or a whole assistant message). */
function isThinking(message: unknown): boolean {
  const m = record(message)
  if (m === null) return false
  const thinkingBlock = (block: unknown): boolean => {
    const type = record(block)?.type
    return type === 'thinking' || type === 'redacted_thinking'
  }
  if (m.type === 'stream_event') {
    const event = record(m.event)
    return event?.type === 'content_block_start' && thinkingBlock(event.content_block)
  }
  if (m.type === 'assistant') {
    const content = record(m.message)?.content
    return Array.isArray(content) && content.some(thinkingBlock)
  }
  return false
}

/**
 * The claim's Query, or the code of its refusal: a spare that exited or was closed after it was
 * taken refuses by throwing, and nothing went out.
 */
function claimOf(spare: AssistSpare, prompt: string, options: ClaimOptions, meta: AssistMeta): AssistQuery | string {
  try {
    return spare.claim({ prompt, options }, meta)
  } catch (error) {
    return refusalCode(messageOf(error))
  }
}

/** The text blocks of an assistant message. */
function assistantText(message: Record<string, unknown>): string {
  const content = record(message.message)?.content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (record(block)?.type === 'text' ? String(record(block)?.text ?? '') : '')).join('')
}

export class AssistService {
  private readonly now: () => number
  private readonly schedule: (at: number, fire: () => void) => () => void
  private readonly log: (line: string) => void
  private readonly branchOf: (cwd: string) => Promise<string | null>
  private readonly listeners = new Set<(state: TerminalAiState) => void>()
  private backendPromise: Promise<AssistBackend> | null = null
  private spare: SpareSlot | null = null
  private current: Flight | null = null
  /** On-demand requests waiting for the one in flight. */
  private waiting = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private cancelPauseTimer: (() => void) | null = null
  private pauseAt: number | null = null
  private lastSent: string | null = null
  private disposed = false
  private readonly unsubscribeLimits: () => void

  constructor(private readonly options: AssistServiceOptions) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? wallTimer(this.now)
    this.log = options.log ?? ((line) => console.info(line))
    this.branchOf = options.branchOf ?? ((cwd) => gitBranch(cwd))
    this.unsubscribeLimits = options.limits.subscribe(() => this.changed())
    this.reschedulePause()
  }

  // ---- state ---------------------------------------------------------------------------------------

  state(): TerminalAiState {
    const settings = this.options.settings.get()
    const limits = this.options.limits.snapshot()
    const now = this.now()
    const features = Object.fromEntries(
      TERMINAL_AI_FEATURES.map((feature): [TerminalAiFeature, TerminalAiFeatureState] => {
        if (!featureEnabled(settings, feature)) return [feature, { state: 'off' }]
        const verdict = limitsGate(limits, feature, now)
        return [feature, verdict.ok ? { state: 'on' } : { state: 'paused', until: verdict.until, window: verdict.window }]
      }),
    ) as TerminalAiState['features']
    return { settings, features, process: this.processState() }
  }

  private processState(): AssistProcessState {
    if (this.current !== null) return 'busy'
    return this.spare !== null ? 'warm' : 'idle'
  }

  /** Calls `listener` with every new state; answers the unsubscribe. */
  subscribe(listener: (state: TerminalAiState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setSettings(patch: TerminalAiSettingsPatch): TerminalAiState {
    this.options.settings.set(patch)
    this.changed()
    return this.state()
  }

  /** Something may have changed: the new state goes to the listeners when it differs from the last one sent. */
  private changed(): void {
    if (this.disposed) return
    this.reschedulePause()
    const state = this.state()
    const text = JSON.stringify(state)
    if (text === this.lastSent) return
    this.lastSent = text
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (error) {
        console.warn('[terminal-ai] a listener threw', error)
      }
    }
  }

  /** A timer at the moment the earliest Limits pause lifts, so `paused` turns `on` without a request. */
  private reschedulePause(): void {
    if (this.disposed) return
    const settings = this.options.settings.get()
    const limits = this.options.limits.snapshot()
    const now = this.now()
    let at: number | null = null
    for (const feature of TERMINAL_AI_FEATURES) {
      if (!featureEnabled(settings, feature)) continue
      const verdict = limitsGate(limits, feature, now)
      if (!verdict.ok && (at === null || verdict.until < at)) at = verdict.until
    }
    if (at === this.pauseAt) return
    this.cancelPauseTimer?.()
    this.cancelPauseTimer = null
    this.pauseAt = at
    if (at === null) return
    this.cancelPauseTimer = this.schedule(at, () => {
      this.cancelPauseTimer = null
      this.pauseAt = null
      this.changed()
    })
  }

  // ---- requests ------------------------------------------------------------------------------------

  /** The refusal that comes before anything goes out, or null. */
  private refusalBefore(feature: TerminalAiFeature, input: TerminalAiInput): AssistAnswer | null {
    if (!featureEnabled(this.options.settings.get(), feature)) return { ok: false, reason: 'off' }
    if (input.commandRunning) return { ok: false, reason: 'command-running' }
    if (input.alternateScreen) return { ok: false, reason: 'alternate-screen' }
    if (feature === 'suggest' && isPrivateLine(input.line)) return { ok: false, reason: 'private-line' }
    const verdict = limitsGate(this.options.limits.snapshot(), feature, this.now())
    if (!verdict.ok) return { ok: false, reason: 'limits', until: verdict.until }
    return null
  }

  /** Asks the assist process for `feature`: a command, or a refusal with its reason. Never throws. */
  async request(feature: TerminalAiFeature, input: TerminalAiInput, signal?: AbortSignal): Promise<AssistAnswer> {
    if (this.disposed) return { ok: false, reason: 'cancelled' }
    const early = this.refusalBefore(feature, input)
    if (early !== null) return early

    if (isAutomatic(feature)) {
      if ((this.current !== null && !isAutomatic(this.current.feature)) || this.waiting > 0) return { ok: false, reason: 'busy' }
    } else if (this.current !== null && !isAutomatic(this.current.feature)) {
      this.waiting++
      try {
        while (this.current !== null && !isAutomatic(this.current.feature)) {
          // A caller that gives up while it waits leaves the queue at once.
          if ((await this.abortable(this.current.done, signal ?? new AbortController().signal)) === ABORTED) return { ok: false, reason: 'cancelled' }
        }
      } finally {
        this.waiting--
      }
      if (signal?.aborted) return { ok: false, reason: 'cancelled' }
      if (this.disposed) return { ok: false, reason: 'cancelled' }
      // Settings or Limits may have changed while it waited.
      const late = this.refusalBefore(feature, input)
      if (late !== null) return late
    }
    // Whatever flies now is automatic: this request takes its place.
    this.current?.controller.abort('cancelled')

    let finish: () => void = () => undefined
    const flight: Flight = { feature, controller: new AbortController(), done: new Promise<void>((resolve) => (finish = resolve)) }
    this.current = flight
    this.changed()
    const onAbort = (): void => flight.controller.abort('cancelled')
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) flight.controller.abort('cancelled')
    const timer = setTimeout(() => flight.controller.abort('timeout'), FEATURE_TIMEOUT_MS[feature])
    try {
      return await this.fly(flight, input)
    } catch (error) {
      this.log(`[terminal-ai] ${feature}: failed: ${refusalCode(messageOf(error))}`)
      return { ok: false, reason: 'failed', detail: 'error' }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (this.current === flight) this.current = null
      finish()
      // The next spare at once (ADR-0058, point 2), unless the service is gone.
      if (!this.disposed) void this.warm()
      this.armIdle()
      this.changed()
    }
  }

  private async fly(flight: Flight, input: TerminalAiInput): Promise<AssistAnswer> {
    const { feature, controller } = flight
    const settings = this.options.settings.get()
    const branch = input.branch !== undefined ? Promise.resolve(input.branch) : this.branchOf(input.cwd).catch(() => null)
    const spare = await this.abortable(this.take(controller.signal), controller.signal)
    if (spare === null) return { ok: false, reason: 'failed', detail: 'no_process' }
    if (spare === ABORTED) return { ok: false, reason: reasonOf(controller.signal) }

    let attempt: Attempt
    const model = featureModel(feature, settings)
    try {
      const context = prepareContext(feature, input, await this.abortable(branch, controller.signal).then((value) => (value === ABORTED ? null : value)))
      if (controller.signal.aborted) return { ok: false, reason: reasonOf(controller.signal) }
      const meta: AssistMeta = { feature, context }
      const prompt = contextText(feature, context)
      const claim = claimOptions(feature, settings, this.options.dataDir)
      mkdirSync(claim.cwd, { recursive: true })
      this.log(`[terminal-ai] ${feature}: model ${model}`)
      const query = claimOf(spare, prompt, claim, meta)
      attempt = typeof query === 'string' ? { kind: 'not-claimed', detail: query } : await this.attempt(feature, controller, query, spare.claimed)
      // Whatever the claim gave, this process is done (a refused one is going away by itself).
      spare.close()
      if (attempt.kind === 'not-claimed') {
        this.log(`[terminal-ai] ${feature}: claim refused (${attempt.detail})${isAutomatic(feature) ? '' : '; retrying with a cold query'}`)
        if (!isAutomatic(feature) && !controller.signal.aborted) {
          const backend = await this.backend()
          const options = coldQueryOptions(await this.options.prewarmOptions(), claim)
          attempt = await this.attempt(feature, controller, backend.query({ prompt, options }, meta), null)
        }
      }
    } finally {
      spare.close()
    }

    switch (attempt.kind) {
      case 'aborted':
        return { ok: false, reason: attempt.reason }
      case 'not-claimed':
        return { ok: false, reason: 'not-claimed', detail: attempt.detail }
      case 'failed':
        return { ok: false, reason: 'failed', detail: attempt.detail }
      case 'answer': {
        const command = commandOf(attempt.text)
        return command === '' ? { ok: false, reason: 'empty' } : { ok: true, command, model }
      }
    }
  }

  /** `promise`, or ABORTED as soon as `signal` aborts. */
  private abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
    if (signal.aborted) return Promise.resolve(ABORTED)
    return new Promise((resolve, reject) => {
      const onAbort = (): void => resolve(ABORTED)
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  }

  /**
   * Reads one query to its end, recording every message in the Limits. Ends early when the flight
   * aborts (timeout, a cancel, a Suggestion that thinks or lost its thinking switch) or when the
   * claim is refused: then the query is closed and nothing of it is used.
   */
  private async attempt(feature: TerminalAiFeature, flight: AbortController, query: AssistQuery, claimed: Promise<unknown> | null): Promise<Attempt> {
    const local = new AbortController()
    const onFlightAbort = (): void => local.abort(flight.signal.reason)
    flight.signal.addEventListener('abort', onFlightAbort, { once: true })
    if (flight.signal.aborted) local.abort(flight.signal.reason)

    let refusal: string | null = null
    const claimSettled = (claimed ?? Promise.resolve()).then(
      () => undefined,
      (error: unknown) => {
        const message = messageOf(error)
        if (message.startsWith('option_not_applied')) {
          if (feature === 'suggest') flight.abort('option-not-applied')
          else this.log(`[terminal-ai] ${feature}: option_not_applied; the answer is taken`)
          return
        }
        refusal = refusalCode(message)
        local.abort('not-claimed')
      },
    )

    const aborted = new Promise<never>((_, reject) => {
      const fail = (): void => reject(new Aborted(reasonOf(local.signal)))
      if (local.signal.aborted) fail()
      else local.signal.addEventListener('abort', fail, { once: true })
    })
    aborted.catch(() => undefined)

    const iterator = query[Symbol.asyncIterator]()
    let text = ''
    let result: string | null = null
    let error: string | null = null
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next.done === true) break
        const message: unknown = next.value
        this.recordLimits(message)
        this.observeSystem(message)
        if (feature === 'suggest' && isThinking(message)) {
          flight.abort('thinking')
          continue
        }
        const m = record(message)
        if (m?.type === 'assistant') text += assistantText(m)
        if (m?.type === 'result') {
          if (m.subtype === 'success' && m.is_error !== true) result = typeof m.result === 'string' ? m.result : ''
          else error = typeof m.result === 'string' ? m.result : String(m.subtype ?? 'error')
        }
      }
      // An error result may come before the claim's refusal does: wait for the claim to settle.
      if (error !== null) await Promise.race([claimSettled, aborted])
    } catch (caught) {
      if (!(caught instanceof Aborted)) throw caught
    } finally {
      flight.signal.removeEventListener('abort', onFlightAbort)
      query.close()
    }
    if (local.signal.aborted) {
      const reason = reasonOf(local.signal)
      return reason === 'not-claimed' ? { kind: 'not-claimed', detail: refusal ?? 'unknown' } : { kind: 'aborted', reason }
    }
    if (error !== null) return error.startsWith('not_claimed') ? { kind: 'not-claimed', detail: 'not_claimed' } : { kind: 'failed', detail: refusalCode(error) }
    return { kind: 'answer', text: result ?? text }
  }

  private recordLimits(message: unknown): void {
    try {
      this.options.limits.recordSdkMessage(message)
    } catch (error) {
      console.warn('[terminal-ai] could not record an SDK message in the Limits', error)
    }
  }

  /** The process's own line in the log: its system/init, and every hook that runs in it. */
  private observeSystem(message: unknown): void {
    const m = record(message)
    if (m?.type !== 'system') return
    if (m.subtype === 'init') {
      const plugins = Array.isArray(m.plugins) ? m.plugins.map((plugin) => String(record(plugin)?.name ?? '?')) : []
      const hooks = Array.isArray(m.hooks) ? m.hooks.map((hook) => String(record(hook)?.name ?? hook)) : null
      this.log(
        `[terminal-ai] assist process: Claude Code ${String(m.claude_code_version ?? '?')}, apiKeySource ${String(m.apiKeySource ?? '?')}, model ${String(m.model ?? '?')}, ` +
          `plugins: ${plugins.length > 0 ? plugins.join(', ') : 'none'}; hooks: ${hooks === null ? 'not reported by init' : hooks.length > 0 ? hooks.join(', ') : 'none'}`,
      )
    } else if (m.subtype === 'hook_started') {
      this.log(`[terminal-ai] assist process ran a hook: ${String(m.hook_event ?? '?')} ${String(m.hook_name ?? '?')}`)
    }
  }

  // ---- the spare process ---------------------------------------------------------------------------

  private backend(): Promise<AssistBackend> {
    if (this.backendPromise !== null) return this.backendPromise
    const made = this.options.backend()
    this.backendPromise = made
    // A backend that could not be made is tried again by the next request.
    made.catch(() => {
      if (this.backendPromise === made) this.backendPromise = null
    })
    return made
  }

  /** The spare: the one parked or starting, or a new one. Null when it could not start. */
  private warm(): Promise<AssistSpare | null> {
    if (this.spare !== null) return this.spare.promise
    const slot: SpareSlot = { promise: Promise.resolve(null), spare: null }
    slot.promise = (async (): Promise<AssistSpare | null> => {
      try {
        const backend = await this.backend()
        const spare = await backend.prewarm(await this.options.prewarmOptions())
        if (this.spare !== slot || this.disposed) {
          // Closed for idleness or disposed while it started.
          spare.close()
          return null
        }
        slot.spare = spare
        void spare.exited.then(() => {
          if (this.spare !== slot) return
          this.spare = null
          this.changed()
        })
        return spare
      } catch (error) {
        this.log(`[terminal-ai] the assist process did not start: ${refusalCode(messageOf(error))}`)
        if (this.spare === slot) {
          this.spare = null
          this.changed()
        }
        return null
      }
    })()
    this.spare = slot
    this.armIdle()
    this.changed()
    return slot.promise
  }

  /** The spare for a request: waits while it starts; the slot is emptied for the next one. */
  private async take(signal: AbortSignal): Promise<AssistSpare | null> {
    const promise = this.warm()
    const slot = this.spare
    const spare = await promise
    // A cancelled request leaves the spare to the request that cancelled it.
    if (signal.aborted) return null
    if (this.spare === slot) this.spare = null
    return spare
  }

  private armIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.disposed || this.spare === null) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.current !== null) return
      this.dropSpare()
      this.changed()
    }, IDLE_MS)
  }

  private dropSpare(): void {
    const slot = this.spare
    this.spare = null
    slot?.spare?.close()
  }

  /** Closes the spare and the request in flight; the service answers nothing after it (the app quits). */
  dispose(): void {
    if (this.disposed) return
    this.current?.controller.abort('cancelled')
    this.disposed = true
    this.unsubscribeLimits()
    this.cancelPauseTimer?.()
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.dropSpare()
    this.listeners.clear()
  }
}

// ---- the app's service -----------------------------------------------------------------------------

let appService: AssistService | null = null

/** The app's assist service over WORFY_DATA_DIR, made on first use; it closes its processes when the app quits. */
export async function appAssist(): Promise<AssistService> {
  if (appService !== null) return appService
  const [{ app }, { appLimits }, { agentEnv }, { dataRoot }, { TerminalAiSettingsStore }, { prewarmOptions }] = await Promise.all([
    import('electron'),
    import('../agent/limits'),
    import('../agent/env'),
    import('../storage/paths'),
    import('./settings'),
    import('./options'),
  ])
  if (appService !== null) return appService
  const dataDir = dataRoot()
  const fake = process.env.WORFY_AGENT === 'fake'
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  const service = new AssistService({
    backend: () => backendFromEnv(),
    // The fake starts no Claude Code and needs no login shell environment.
    prewarmOptions: async () => prewarmOptions({ env: fake ? {} : (await agentEnv()).env, runtime }),
    settings: new TerminalAiSettingsStore(dataDir),
    limits: appLimits(),
    dataDir,
  })
  app.on('will-quit', () => service.dispose())
  appService = service
  return service
}
