// A Project's settings (`<Project data folder>/settings.json`): today only the action templates.
// The schema and the defaults live in src/shared/projects/action-templates.ts.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defaultProjectSettings, migrateProjectSettings, projectSettingsSchema, type ProjectSettings } from '../../shared/projects/action-templates'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export function settingsPath(projectDataDir: string): string {
  return join(projectDataDir, 'settings.json')
}

/**
 * The saved settings, or the defaults when there are none (or they were unreadable and set aside).
 * A saved "Run wave" template equal to the old default reads as the new one (ADR-0033); the file
 * is not rewritten here, the next save writes it.
 */
export function readProjectSettings(projectDataDir: string): ProjectSettings {
  const saved = readJsonFile(settingsPath(projectDataDir), projectSettingsSchema)
  return saved === undefined ? defaultProjectSettings() : migrateProjectSettings(saved)
}

/** Saves the settings; a template with an unknown placeholder throws and nothing is written. */
export function writeProjectSettings(projectDataDir: string, settings: ProjectSettings): ProjectSettings {
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, settings)
  return readProjectSettings(projectDataDir)
}

/**
 * Writes the defaults for a Project that has no settings yet. They are written once, when the
 * Project is added, so a later change of the defaults does not silently rewrite its templates.
 */
export function ensureProjectSettings(projectDataDir: string): void {
  if (!existsSync(settingsPath(projectDataDir))) writeProjectSettings(projectDataDir, defaultProjectSettings())
}
