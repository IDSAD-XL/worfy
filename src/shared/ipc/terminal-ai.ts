// The `terminalAi` domain (Epic worfy-terminal-ai, ADR-0058): Settings → "Terminal AI", whether each
// feature is on, off or paused by the Limits, and the state of the assist process. Handled in
// src/main/ipc/terminal-ai.ts.
//
// Every channel here is `local` (src/shared/ipc/channels.ts): the settings and the assist process
// belong to the screen's own Machine, as the Limits do, and a Linked machine never reaches them.
import { z } from 'zod'
import { TERMINAL_AI_FEATURES, terminalAiSettingsPatchSchema, terminalAiSettingsSchema } from '../terminal-ai/settings'
import { eventChannel, invokeChannel } from './channels'

/** Whether a feature may ask the model now. */
export const terminalAiFeatureStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('on') }),
  /** Turned off in Settings. */
  z.object({ state: z.literal('off') }),
  /** Stopped by the Limits until `until` (milliseconds since the epoch), when it comes back by itself. */
  z.object({ state: z.literal('paused'), until: z.number(), window: z.string() }),
])
export type TerminalAiFeatureState = z.output<typeof terminalAiFeatureStateSchema>

/** `idle` — no process; `warm` — a spare process is parked or starting; `busy` — a request is in flight. */
export const ASSIST_PROCESS_STATES = ['idle', 'warm', 'busy'] as const
export type AssistProcessState = (typeof ASSIST_PROCESS_STATES)[number]

export const terminalAiStateSchema = z.object({
  settings: terminalAiSettingsSchema,
  features: z.object(Object.fromEntries(TERMINAL_AI_FEATURES.map((feature) => [feature, terminalAiFeatureStateSchema])) as Record<(typeof TERMINAL_AI_FEATURES)[number], typeof terminalAiFeatureStateSchema>),
  process: z.enum(ASSIST_PROCESS_STATES),
})
export type TerminalAiState = z.output<typeof terminalAiStateSchema>

/** The state now; the calling window then receives `terminalAi.changed` until it is gone. */
export const terminalAiState = invokeChannel('terminalAi.state', z.void(), terminalAiStateSchema, 'local')

/** Changes some settings; answers the whole new state. */
export const terminalAiSetSettings = invokeChannel('terminalAi.setSettings', terminalAiSettingsPatchSchema, terminalAiStateSchema, 'local')

/**
 * The whole new state after a change: of the settings, of the assist process, of the Limits, and
 * at the moment a Limits pause lifts by itself.
 */
export const terminalAiChanged = eventChannel('terminalAi.changed', terminalAiStateSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'terminalAi.state': typeof terminalAiState
    'terminalAi.setSettings': typeof terminalAiSetSettings
    'terminalAi.changed': typeof terminalAiChanged
  }
}
