// The active source of the Limits: every USAGE_REFRESH_MS main asks Claude Code for the plan's
// usage (the data behind `/usage`) and records the 5-hour and 7-day windows in the app's
// LimitsTracker, next to the two passive sources (src/main/agent/limits.ts). The ask is skipped
// while the passive sources keep the windows fresh.
//
// The ask spends no model tokens and leaves no Session behind: a short-lived Claude Code process
// started through the Agent SDK in streaming-input mode never gets a user message. It answers the
// usage control request and is closed. It runs with `persistSession: false` (no transcript), no
// settings of the user or a Project, no MCP servers and no tools, without API keys (the plan's
// limits come with the subscription sign-in, ADR-0007), in worfy's own empty folder outside every
// Project (<WORFY_DATA_DIR>/terminal-ai, ADR-0058), so its ~/.claude/sessions entry, removed when
// it closes, is never taken for a Session of a Project (src/main/claude-home/registry.ts).
//
// The SDK method is experimental; its name is in one place, askUsage(). A missing method, an answer
// without rate limits (an API key, Bedrock, Vertex) or a failure is logged once at debug level and
// the Limits stay with the passive sources; the next try is the next tick, never a loop.
import { mkdirSync } from 'node:fs'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { LIMIT_WINDOWS, limitUpdatesFromUsage, type LimitUpdate, type LimitsState } from '../../shared/agent/limits'

/** How often the usage is asked, and how fresh the data must be for an ask to be skipped. */
export const USAGE_REFRESH_MS = 1_800_000
/** How long one ask may take before its process is closed. */
export const USAGE_TIMEOUT_MS = 30 * 1000

/** The SDK's name for the usage request; an SDK rename is a change of this line. */
export const USAGE_METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'

/** A Query of the SDK as the ask uses it. */
export interface UsageQuery {
  close(): void
}

/**
 * The usage answer of `query`, or null when the SDK has no such method. The transcript scan
 * behind the answer's `behaviors` is skipped: only the rate limits are needed.
 */
export async function askUsage(query: UsageQuery): Promise<unknown> {
  const method: unknown = (query as unknown as Record<string, unknown>)[USAGE_METHOD]
  if (typeof method !== 'function') return null
  return (await (method as (opts: { skipBehaviors: boolean }) => Promise<unknown>).call(query, { skipBehaviors: true })) ?? null
}

/**
 * One ask: the SDK's answer, null when there is none to give; throws on a failure. `signal` aborts
 * when the app quits: the ask then closes its process at once.
 */
export type UsageReader = (signal: AbortSignal) => Promise<unknown>

/** The part of the LimitsTracker the refresher uses. */
export interface LimitsStore {
  snapshot(): LimitsState
  record(updates: readonly LimitUpdate[]): void
}

export interface LimitsRefresherOptions {
  limits: LimitsStore
  read: UsageReader
  /** Clock in milliseconds; tests pass a fake one. */
  now?: () => number
  intervalMs?: number
  /** Where the one line about an ask with no result goes; console.debug by default. */
  log?: (message: string, error?: unknown) => void
}

/**
 * Asks the usage at start() when the shown windows are older than the interval, and then every
 * interval unless the passive sources (a Session's `rate_limit_event`, the status line file)
 * brought every shown window in the last interval. One ask at a time; stop() ends it all.
 */
export class LimitsRefresher {
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly log: (message: string, error?: unknown) => void
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private stopped = false
  private readonly quit = new AbortController()
  /** Whether the line for "no rate limits" or for a failure was logged since the last answer. */
  private logged = { unavailable: false, failed: false }

  constructor(private readonly options: LimitsRefresherOptions) {
    this.now = options.now ?? Date.now
    this.intervalMs = options.intervalMs ?? USAGE_REFRESH_MS
    this.log = options.log ?? ((message, error) => console.debug(message, ...(error === undefined ? [] : [error])))
  }

  start(): void {
    if (this.timer !== null || this.stopped) return
    // At start any fresh data counts, the usage recorded by the last run of the app included.
    void this.check(false)
    this.timer = setInterval(() => void this.check(true), this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.quit.abort()
  }

  /**
   * One tick: asks unless an ask runs or every shown window is fresh. `passiveOnly` counts only
   * the passive sources as fresh, so the usage this refresher recorded a tick ago does not skip
   * the next ask.
   */
  async check(passiveOnly: boolean): Promise<void> {
    if (this.running || this.stopped || this.fresh(passiveOnly)) return
    this.running = true
    try {
      const answer = await this.options.read(this.quit.signal)
      if (this.stopped) return
      const updates = limitUpdatesFromUsage(answer, this.now())
      if (updates.length === 0) {
        if (!this.logged.unavailable) this.log('[limits] the usage request gave no rate limits (no method, an API key, Bedrock or Vertex): the Limits come from Sessions and the status line only')
        this.logged.unavailable = true
        return
      }
      this.logged = { unavailable: false, failed: false }
      this.options.limits.record(updates)
    } catch (error) {
      if (!this.logged.failed) this.log('[limits] the usage request failed: the Limits come from Sessions and the status line only', error)
      this.logged.failed = true
    } finally {
      this.running = false
    }
  }

  private fresh(passiveOnly: boolean): boolean {
    const { windows } = this.options.limits.snapshot()
    const since = this.now() - this.intervalMs
    return LIMIT_WINDOWS.every((id) => {
      const known = windows[id]
      return known !== undefined && known.receivedAt > since && !(passiveOnly && known.source === 'usage')
    })
  }
}

/** A prompt that never sends anything: the process only answers control requests. */
const silence = (): AsyncIterable<never> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) })

/** The part of `@anthropic-ai/claude-agent-sdk` an ask uses. */
export interface UsageSdk {
  query(params: { prompt: AsyncIterable<never>; options: Options }): UsageQuery
}

export interface SdkUsageReaderOptions {
  loadSdk: () => Promise<UsageSdk>
  /** The options of the process; built for each ask, so a changed environment reaches the next one. */
  options: () => Promise<Options>
  timeoutMs?: number
}

/**
 * Asks through a fresh Claude Code process, closed after the answer, the failure, the timeout or
 * the abort of `signal`.
 */
export function sdkUsageReader({ loadSdk, options, timeoutMs = USAGE_TIMEOUT_MS }: SdkUsageReaderOptions): UsageReader {
  return async (signal) => {
    const [{ query }, built] = await Promise.all([loadSdk(), options()])
    if (signal.aborted) throw new Error('the app quits')
    const handle = query({ prompt: silence(), options: built })
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort = (): void => undefined
    const ended = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Claude Code did not answer the usage request within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
      onAbort = () => reject(new Error('the app quits'))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      // Promise.race subscribes to both promises, so a usage method that rejects after the timeout
      // or the abort leaves no unhandled rejection.
      return await Promise.race([askUsage(handle), ended])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      try {
        handle.close()
      } catch (error) {
        console.debug('[limits] closing the usage process failed', error)
      }
    }
  }
}

export interface UsageOptionsInput {
  env: Readonly<Record<string, string | undefined>>
  /** The folder the process runs in: empty, worfy's own, outside every Project. */
  cwd: string
  /** The Claude Code binary of a packaged build; the SDK's own when undefined. */
  executable: string | undefined
}

/**
 * The options of the usage process: no transcript, no settings, no MCP, no tools, no API keys, no
 * telemetry (without a network each start would leave a file of about 150 KB in telemetry/; the
 * usage request still answers with it off).
 */
export function usageOptions({ env, cwd, executable }: UsageOptionsInput): Options {
  const clean: Record<string, string | undefined> = { ...env, DISABLE_TELEMETRY: '1' }
  delete clean.ANTHROPIC_API_KEY
  delete clean.ANTHROPIC_AUTH_TOKEN
  return {
    cwd,
    env: clean,
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    tools: [],
    permissionMode: 'dontAsk',
    persistSession: false,
    // Claude Code's stderr is not worfy's log.
    stderr: () => undefined,
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
  }
}

/**
 * Starts the app's refresher over appLimits(); answers the function that stops it (for
 * `will-quit`). With WORFY_AGENT=fake (e2e runs) or under vitest nothing starts: no Claude Code.
 */
export async function installLimitsRefresh(env: NodeJS.ProcessEnv = process.env): Promise<() => void> {
  if (env.WORFY_AGENT === 'fake' || env.VITEST) return () => undefined
  const [{ app }, { appLimits }, { agentEnv }, { dataRoot }, { assistDir }, { claudeExecutablePath }] = await Promise.all([
    import('electron'),
    import('./limits'),
    import('./env'),
    import('../storage/paths'),
    import('../terminal-ai/options'),
    import('./options'),
  ])
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  const refresher = new LimitsRefresher({
    limits: appLimits(),
    read: sdkUsageReader({
      loadSdk: async () => (await import('@anthropic-ai/claude-agent-sdk')) as unknown as UsageSdk,
      options: async () => {
        const cwd = assistDir(dataRoot())
        mkdirSync(cwd, { recursive: true })
        return usageOptions({ env: (await agentEnv()).env, cwd, executable: claudeExecutablePath(runtime) })
      },
    }),
  })
  refresher.start()
  return () => refresher.stop()
}
