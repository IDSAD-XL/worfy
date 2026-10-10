// Terminal AI settings (Epic worfy-terminal-ai, ADR-0058, point 4): the switches of Settings →
// "Terminal AI". They belong to the Machine, not to a Project: main keeps them in
// <WORFY_DATA_DIR>/terminal-ai.json (src/main/terminal-ai/settings.ts).
//
// By default everything is on and Next command asks Sonnet (owner's decisions 1(b) and 8(b),
// 2026-10-09). "Suggestion" turns off the Suggestion from history too; "Ask Claude when history has
// nothing" turns off only the model behind it.
import { z } from 'zod'

/** What the assist process is asked for: a Suggestion, a Next command, a Command request, a Fix. */
export const TERMINAL_AI_FEATURES = ['suggest', 'next', 'request', 'fix'] as const
export type TerminalAiFeature = (typeof TERMINAL_AI_FEATURES)[number]

/** Features worfy asks for by itself; they give way to the on-demand ones and to the Limits sooner. */
export const AUTOMATIC_FEATURES: readonly TerminalAiFeature[] = ['suggest', 'next']

export const isAutomatic = (feature: TerminalAiFeature): boolean => AUTOMATIC_FEATURES.includes(feature)

export const NEXT_COMMAND_MODELS = ['sonnet', 'haiku'] as const
export type NextCommandModel = (typeof NEXT_COMMAND_MODELS)[number]

export const terminalAiSettingsSchema = z.object({
  /** "Terminal AI": every feature. */
  enabled: z.boolean(),
  /** "Suggestion": grey text after the cursor, from history and from the model. */
  suggestion: z.boolean(),
  /** "Ask Claude when history has nothing": the model behind Suggestion. */
  suggestionAsksModel: z.boolean(),
  /** "Next command". */
  nextCommand: z.boolean(),
  /** The model of Next command. */
  nextCommandModel: z.enum(NEXT_COMMAND_MODELS),
  /** "Command request". */
  commandRequest: z.boolean(),
  /** "Fix". */
  fix: z.boolean(),
})
export type TerminalAiSettings = z.infer<typeof terminalAiSettingsSchema>

export const DEFAULT_TERMINAL_AI_SETTINGS: TerminalAiSettings = {
  enabled: true,
  suggestion: true,
  suggestionAsksModel: true,
  nextCommand: true,
  nextCommandModel: 'sonnet',
  commandRequest: true,
  fix: true,
}

/** A change of some settings; the rest stay as they are. */
export const terminalAiSettingsPatchSchema = terminalAiSettingsSchema.partial()
export type TerminalAiSettingsPatch = z.infer<typeof terminalAiSettingsPatchSchema>

/**
 * The settings file read leniently: a missing or broken field takes its default, so a file written
 * by an older or newer worfy keeps the switches it does carry.
 */
const D = DEFAULT_TERMINAL_AI_SETTINGS
export const terminalAiSettingsFileSchema = z.object({
  enabled: z.boolean().catch(D.enabled),
  suggestion: z.boolean().catch(D.suggestion),
  suggestionAsksModel: z.boolean().catch(D.suggestionAsksModel),
  nextCommand: z.boolean().catch(D.nextCommand),
  nextCommandModel: z.enum(NEXT_COMMAND_MODELS).catch(D.nextCommandModel),
  commandRequest: z.boolean().catch(D.commandRequest),
  fix: z.boolean().catch(D.fix),
}) satisfies z.ZodType<TerminalAiSettings, unknown>

/** Whether the settings let the assist process be asked for `feature`. */
export function featureEnabled(settings: TerminalAiSettings, feature: TerminalAiFeature): boolean {
  if (!settings.enabled) return false
  switch (feature) {
    case 'suggest':
      return settings.suggestion && settings.suggestionAsksModel
    case 'next':
      return settings.nextCommand
    case 'request':
      return settings.commandRequest
    case 'fix':
      return settings.fix
  }
}
