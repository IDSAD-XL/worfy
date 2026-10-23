// The options of the assist process (ADR-0058, points 1–3): pure functions, so a unit test reads
// exactly what goes to the SDK.
//
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
import { join } from 'node:path'
import type { ClaimOptions, Options } from '@anthropic-ai/claude-agent-sdk'
import { API_KEY_VARS, withoutApiKeys, type Env } from '../agent/env'
import { claudeExecutablePath, type RuntimeInfo } from '../agent/options'
import type { TerminalAiFeature, TerminalAiSettings } from '../../shared/terminal-ai/settings'

/** The folder every request runs in: empty, worfy's own, outside every Project. */
export const ASSIST_DIR = 'terminal-ai'
export const assistDir = (dataDir: string): string => join(dataDir, ASSIST_DIR)

/** How long each feature waits for its answer (spec, "Decided without the owner", point 2). */
export const FEATURE_TIMEOUT_MS: Record<TerminalAiFeature, number> = { suggest: 5_000, next: 8_000, request: 30_000, fix: 30_000 }

export const ASSIST_SYSTEM_PROMPT = [
  'You help a developer at a zsh prompt on macOS by writing one shell command.',
  'Answer with the command only, on a single line: no backticks, no code block, no explanation, no prompt sign.',
  'Never run anything; the user reads the command and decides whether to press Enter.',
  'If no sensible command fits, answer with an empty line.',
].join(' ')

const FEATURE_PROMPTS: Record<TerminalAiFeature, string> = {
  suggest:
    'Task: complete the command the user is typing. "Typed so far" is the start of the line. Answer with the whole command line, starting with exactly what was typed, so it can be shown after the cursor.',
  next: 'Task: suggest the command the user is most likely to run next, given the folder, the branch and the recent commands. The input line is empty.',
  request: 'Task: write the command that does what "Request" asks for, for this folder and branch.',
  fix: 'Task: the last command failed with the exit code and output shown. Write the corrected command that does what the user meant.',
}

const FEATURE_TITLES: Record<TerminalAiFeature, string> = {
  suggest: 'worfy Terminal AI: Suggestion',
  next: 'worfy Terminal AI: Next command',
  request: 'worfy Terminal AI: Command request',
  fix: 'worfy Terminal AI: Fix',
}

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

/** The model a feature asks, with the settings in force. */
export function featureModel(feature: TerminalAiFeature, settings: TerminalAiSettings): 'haiku' | 'sonnet' {
  if (feature === 'suggest') return 'haiku'
  if (feature === 'next') return settings.nextCommandModel
  return 'sonnet'
}

/** What one request sets at claim(). Haiku runs without thinking, Sonnet at low effort. */
export function claimOptions(feature: TerminalAiFeature, settings: TerminalAiSettings, dataDir: string): ClaimOptions {
  const model = featureModel(feature, settings)
  return {
    cwd: assistDir(dataDir),
    model,
    ...(model === 'haiku' ? { maxThinkingTokens: 0 } : { settings: { effortLevel: 'low' } }),
    appendSystemPrompt: FEATURE_PROMPTS[feature],
    title: FEATURE_TITLES[feature],
  }
}

/** The options of a cold query() with the same effect as a claim of a spare started with `prewarm`. */
export function coldQueryOptions(prewarm: Options, claim: ClaimOptions): Options {
  return {
    ...prewarm,
    cwd: claim.cwd,
    ...(claim.model === undefined ? {} : { model: claim.model }),
    ...(claim.maxThinkingTokens === undefined || claim.maxThinkingTokens === null ? {} : { maxThinkingTokens: claim.maxThinkingTokens }),
    ...(claim.settings?.effortLevel === undefined || claim.settings.effortLevel === null ? {} : { effort: claim.settings.effortLevel }),
    systemPrompt: claim.appendSystemPrompt === undefined ? prewarm.systemPrompt : `${String(prewarm.systemPrompt ?? '')}\n\n${claim.appendSystemPrompt}`,
  }
}
