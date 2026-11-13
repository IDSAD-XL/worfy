// Terminal AI on Claude Code (ADR-0058): it stays on Claude Code only (worfy-multi-vendor decision
// 07), so it is a part of the Claude driver and of no other. The assist service
// (src/main/terminal-ai/assist.ts) asks this part for the options of its processes and, through
// realBackend, for the Agent SDK; it sees the options as its own AssistProcessOptions and
// AssistClaimOptions and hands them back unread, except the folder of a claim.
//
// The options (ADR-0058, points 1–3), pure functions, so a unit test reads exactly what goes to the SDK:
// - prewarmOptions(): what the spare process starts with and keeps for life — no settings of the
//   user or a Project (`settingSources: []`), no MCP servers, no tools, no transcript, one turn, the
//   shared system prompt, the agent environment without API keys (sign-in by subscription,
//   ADR-0007). No `cwd`: at prewarm() it is only the parking folder, never a Session's folder.
// - claimOptions(): what one request sets at claim() — the empty folder <WORFY_DATA_DIR>/terminal-ai
//   as `cwd` (worfy takes a process with its cwd inside a Project for a Session of that Project,
//   src/main/claude-home/registry.ts), the model, thinking and effort of the feature, its
//   instruction (`appendSystemPrompt`) and title.
// - coldQueryOptions(): both together, for the one retry through query() when a claim was refused
//   before the prompt went out.
//
// The SDK is loaded at the first real request (loadSdk), never under vitest (realBackend) and never
// with WORFY_AGENT=fake, where the service takes the file fake (src/main/terminal-ai/fake-backend.ts).
import type { ClaimOptions, Options } from '@anthropic-ai/claude-agent-sdk'
import type { TerminalAiFeature, TerminalAiSettings } from '../../../shared/terminal-ai/settings'
import { API_KEY_VARS, withoutApiKeys, type Env } from '../../agent/env'
import type { AssistBackend, AssistClaimOptions, AssistProcessOptions, AssistQuery } from '../../terminal-ai/assist'
import { ASSIST_SYSTEM_PROMPT, assistDir, FEATURE_PROMPTS, FEATURE_TITLES, featureModel } from '../../terminal-ai/options'
import { claudeExecutablePath, type RuntimeInfo } from './options'

export interface PrewarmOptionsInput {
  /** The agent environment (agentEnv()); its API keys are dropped again here. */
  env: Readonly<Env>
  runtime: RuntimeInfo
  /** Claude Code's stderr; the service keeps it out of the log (it may quote the request). */
  stderr?: (data: string) => void
}

/** What the spare process starts with (`prewarm({options})`). */
export function prewarmOptions(input: PrewarmOptionsInput): Options {
  const env = withoutApiKeys(input.env)
  for (const key of API_KEY_VARS) delete env[key]
  const executable = claudeExecutablePath(input.runtime)
  return {
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    tools: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    // No transcript in ~/.claude/projects. Claude Code still writes ~/.claude/sessions/<pid>.json (cwd
    // here, outside every Project, so worfy never shows it) from the claim to the exit, with a
    // messaging socket other sessions can see: an accepted risk (owner, 2026-10-23).
    persistSession: false,
    includePartialMessages: true,
    // Every hook that runs in the process sends hook_started (not only SessionStart and Setup), so the
    // log names each hook of the built-in plugins that sees a request (ADR-0058, point 1).
    includeHookEvents: true,
    systemPrompt: ASSIST_SYSTEM_PROMPT,
    env,
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  }
}

/**
 * The Haiku a request without thinking names, by its id. Not the alias `haiku`: since Claude Code 2.1.322
 * (Agent SDK 0.3.322) the alias resolves to Haiku 5.5, whose catalog entry says `rejects_disabled_thinking`,
 * and Claude Code then turns thinking-off into adaptive thinking. A Suggestion that thinks is cancelled
 * (ADR-0058, point 3), and the narrator's thinking would spend its short output limit. When Haiku 4.5 is
 * retired, the request fails like any other: no Suggestion from the model, a silent narrator, a line in the log.
 */
export const HAIKU_WITHOUT_THINKING = 'claude-haiku-4-5'

/** What one request sets at claim(). Haiku runs without thinking, Sonnet at low effort. */
export function claimOptions(feature: TerminalAiFeature, settings: TerminalAiSettings, dataDir: string): ClaimOptions {
  const model = featureModel(feature, settings)
  return {
    cwd: assistDir(dataDir),
    ...(model === 'haiku' ? { model: HAIKU_WITHOUT_THINKING, maxThinkingTokens: 0 } : { model, settings: { effortLevel: 'low' } }),
    appendSystemPrompt: FEATURE_PROMPTS[feature],
    title: FEATURE_TITLES[feature],
  }
}

/**
 * The options of a cold query() with the same effect as a claim of a spare started with `prewarm`.
 * Both come back from the service as it got them from prewarmOptions() and claimOptions().
 */
export function coldQueryOptions(prewarmed: AssistProcessOptions, claimed: AssistClaimOptions): Options {
  const prewarm = prewarmed as Options
  const claim = claimed as ClaimOptions
  return {
    ...prewarm,
    cwd: claim.cwd,
    ...(claim.model === undefined ? {} : { model: claim.model }),
    ...(claim.maxThinkingTokens === undefined || claim.maxThinkingTokens === null ? {} : { maxThinkingTokens: claim.maxThinkingTokens }),
    ...(claim.settings?.effortLevel === undefined || claim.settings.effortLevel === null ? {} : { effort: claim.settings.effortLevel }),
    systemPrompt: claim.appendSystemPrompt === undefined ? prewarm.systemPrompt : `${String(prewarm.systemPrompt ?? '')}\n\n${claim.appendSystemPrompt}`,
  }
}

/** The part of `@anthropic-ai/claude-agent-sdk` the service uses, with the options as the service holds them. */
export interface AssistSdk {
  prewarm(params?: { options?: AssistProcessOptions }): Promise<{
    claim(params: { prompt: string; options: AssistClaimOptions }): AssistQuery
    readonly claimed: Promise<unknown>
    readonly exited: Promise<void>
    close(): void
  }>
  query(params: { prompt: string; options?: AssistProcessOptions }): AssistQuery
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

/** Loads the Agent SDK; the one place Terminal AI imports it. */
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

export interface ClaudeTerminalAi {
  /** The backend Terminal AI asks: the fake under WORFY_AGENT=fake, Claude Code otherwise (assist.ts, backendFromEnv). */
  backend(env?: NodeJS.ProcessEnv): Promise<AssistBackend>
  /** The options of prewarm(), made for every spare. */
  prewarmOptions(input: PrewarmOptionsInput): AssistProcessOptions
  /** What a request of `feature` sets when it claims the spare. */
  claimOptions(feature: TerminalAiFeature, settings: TerminalAiSettings, dataDir: string): AssistClaimOptions
  /** The options of the cold query that retries a refused claim. */
  coldQueryOptions(prewarm: AssistProcessOptions, claim: AssistClaimOptions): AssistProcessOptions
}

export const claudeTerminalAi: ClaudeTerminalAi = {
  // Loaded at the call: Terminal AI and its imports stay out of the Session registry's.
  backend: async (env) => (await import('../../terminal-ai/assist')).backendFromEnv(env),
  prewarmOptions,
  claimOptions,
  coldQueryOptions,
}
