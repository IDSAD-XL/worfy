// Terminal AI settings in main: <WORFY_DATA_DIR>/terminal-ai.json (spec, "Decided without the owner",
// point 4: they belong to the Machine, not to a Project). The schema and defaults are in
// src/shared/terminal-ai/settings.ts. A missing file means the defaults; a broken field takes its
// default; a file that is not JSON at all is set aside by readJsonFile and the defaults apply.
import { join } from 'node:path'
import {
  DEFAULT_TERMINAL_AI_SETTINGS,
  terminalAiSettingsFileSchema,
  terminalAiSettingsSchema,
  type TerminalAiSettings,
  type TerminalAiSettingsPatch,
} from '../../shared/terminal-ai/settings'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const TERMINAL_AI_SETTINGS_FILE = 'terminal-ai.json'

export class TerminalAiSettingsStore {
  private readonly file: string
  private settings: TerminalAiSettings

  constructor(dataDir: string) {
    this.file = join(dataDir, TERMINAL_AI_SETTINGS_FILE)
    this.settings = readJsonFile(this.file, terminalAiSettingsFileSchema) ?? { ...DEFAULT_TERMINAL_AI_SETTINGS }
  }

  get(): TerminalAiSettings {
    return this.settings
  }

  /** Applies `patch`, writes the file and answers the new settings. A failed write throws, and nothing changes. */
  set(patch: TerminalAiSettingsPatch): TerminalAiSettings {
    const next = terminalAiSettingsSchema.parse({ ...this.settings, ...stripUndefined(patch) })
    writeJsonFile(this.file, terminalAiSettingsSchema, next)
    this.settings = next
    return next
  }
}

function stripUndefined(patch: TerminalAiSettingsPatch): TerminalAiSettingsPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as TerminalAiSettingsPatch
}
