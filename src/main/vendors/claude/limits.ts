// The limits part of the Claude driver: the Limits probe, Claude Code's answer to the plan's usage
// request (the data behind `/usage`), as Limit windows. Claude Code's windows are kept as
// LimitsState (src/main/agent/limits.ts), fed by rate_limit_event, the status line and this probe;
// the probe's schedule is LimitsRefresher (src/main/agent/limits-usage.ts), which asks it through
// claudeUsageReader and records the answer in that state.
//
// The ask spends no model tokens and leaves no Session behind: a short-lived Claude Code process
// started through the Agent SDK in streaming-input mode never gets a user message. It answers the
// usage control request and is closed. It runs with `persistSession: false` (no transcript), no
// settings of the user or a Project, no MCP servers and no tools, without API keys (the plan's
// limits come with the subscription sign-in, ADR-0007), in worfy's own empty folder outside every
// Project (<WORFY_DATA_DIR>/terminal-ai, ADR-0058), so its ~/.claude/sessions entry, removed when
// it closes, is never taken for a Session of a Project (src/main/claude-home/registry.ts).
// `persistSession: false` does not stop that entry: Claude Code registers every session it starts,
// with a messaging socket, so for the fraction of a second the process lives other Claude Code
// sessions see it and could send it a message. That is an accepted risk (owner, 2026-10-23), the
// same one as the assist processes take; no separate CLAUDE_CONFIG_DIR, no CLAUDE_CODE_CHILD_SESSION.
//
// The SDK method is experimental; its name is in one place, askUsage().
//
// The index of the driver imports this file while the Session registry loads (app-registry.ts): the
// SDK, the app and the environment are loaded at the call.
import { mkdirSync } from 'node:fs'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { emptyLimits, limitUpdatesFromUsage, limitWindows, mergeLimits } from '../../../shared/agent/limits'
import type { LimitsPart } from '../limits'

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

/** A prompt that never sends anything: the process only answers control requests. */
const silence = (): AsyncIterable<never> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) })

/** The part of `@anthropic-ai/claude-agent-sdk` an ask uses; `options` are those of usageOptions, passed through as they are. */
export interface UsageSdk {
  query(params: { prompt: AsyncIterable<never>; options: object }): UsageQuery
}

export interface SdkUsageReaderOptions {
  loadSdk: () => Promise<UsageSdk>
  /** The options of the process (usageOptions); built for each ask, so a changed environment reaches the next one. */
  options: () => Promise<object>
  timeoutMs?: number
}

/**
 * Asks through a fresh Claude Code process, closed after the answer, the failure, the timeout or
 * the abort of `signal` (the app quits). The SDK's answer, null when there is none to give; throws
 * on a failure.
 */
export function sdkUsageReader({ loadSdk, options, timeoutMs = USAGE_TIMEOUT_MS }: SdkUsageReaderOptions): (signal: AbortSignal) => Promise<unknown> {
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
 * The app's Limits probe: sdkUsageReader over the SDK of this build, with the agent environment and
 * the Claude Code binary of a packaged build, in <WORFY_DATA_DIR>/terminal-ai.
 */
export async function claudeUsageReader(): Promise<(signal: AbortSignal) => Promise<unknown>> {
  const [{ app }, { agentEnv }, { dataRoot }, { assistDir }, { claudeExecutablePath }] = await Promise.all([
    import('electron'),
    import('../../agent/env'),
    import('../../storage/paths'),
    import('../../terminal-ai/options'),
    import('./options'),
  ])
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  return sdkUsageReader({
    loadSdk: async () => (await import('@anthropic-ai/claude-agent-sdk')) as unknown as UsageSdk,
    options: async () => {
      const cwd = assistDir(dataRoot())
      mkdirSync(cwd, { recursive: true })
      return usageOptions({ env: (await agentEnv()).env, cwd, executable: claudeExecutablePath(runtime) })
    },
  })
}

export const claudeLimits: LimitsPart = {
  // One probe now, its windows in the neutral view: none when the answer has no rate limits (an API
  // key, Bedrock, Vertex, a renamed method). Rejects on a failure or after USAGE_TIMEOUT_MS.
  async read() {
    const answer = await (await claudeUsageReader())(new AbortController().signal)
    return limitWindows('claude', mergeLimits(emptyLimits(), limitUpdatesFromUsage(answer, Date.now())))
  },
}
