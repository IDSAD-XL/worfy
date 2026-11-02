// Terminal AI on Claude Code (ADR-0058): it stays on Claude Code only (worfy-multi-vendor decision
// 07), so it is a part of the Claude driver and of no other.
import type { AssistBackend } from '../../terminal-ai/assist'

export interface ClaudeTerminalAi {
  /** The backend Terminal AI asks: the fake under WORFY_AGENT=fake, Claude Code otherwise (assist.ts). */
  backend(env?: NodeJS.ProcessEnv): Promise<AssistBackend>
}

export const claudeTerminalAi: ClaudeTerminalAi = {
  // Loaded at the call: Terminal AI and its imports stay out of the Session registry's.
  backend: async (env) => (await import('../../terminal-ai/assist')).backendFromEnv(env),
}
