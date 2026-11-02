// The settings of the assist process (ADR-0058) that are Terminal AI's own, whatever runs it: the
// folder every request runs in, how long each feature waits, the shared system prompt, each
// feature's instruction and title, and the model a feature asks. The Claude driver turns them into
// the Agent SDK's options (src/main/vendors/claude/terminal-ai.ts).
import { join } from 'node:path'
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

/** Each feature's instruction, appended to the shared system prompt. */
export const FEATURE_PROMPTS: Record<TerminalAiFeature, string> = {
  suggest:
    'Task: complete the command the user is typing. "Typed so far" is the start of the line. Answer with the whole command line, starting with exactly what was typed, so it can be shown after the cursor.',
  next: 'Task: suggest the command the user is most likely to run next, given the folder, the branch and the recent commands. The input line is empty.',
  request: 'Task: write the command that does what "Request" asks for, for this folder and branch.',
  fix: 'Task: the last command failed with the exit code and output shown. Write the corrected command that does what the user meant.',
}

/** Each feature's title of the Claude Code process. */
export const FEATURE_TITLES: Record<TerminalAiFeature, string> = {
  suggest: 'worfy Terminal AI: Suggestion',
  next: 'worfy Terminal AI: Next command',
  request: 'worfy Terminal AI: Command request',
  fix: 'worfy Terminal AI: Fix',
}

/** The model a feature asks, with the settings in force. */
export function featureModel(feature: TerminalAiFeature, settings: TerminalAiSettings): 'haiku' | 'sonnet' {
  if (feature === 'suggest') return 'haiku'
  if (feature === 'next') return settings.nextCommandModel
  return 'sonnet'
}
