// A Project's settings (`<Project data folder>/settings.json`): today only the action templates.
// The schema and the defaults live in src/shared/projects/action-templates.ts.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defaultProjectSettings, projectSettingsSchema, type ProjectSettings } from '../../shared/projects/action-templates'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export function settingsPath(projectDataDir: string): string {
  return join(projectDataDir, 'settings.json')
}

/** The saved settings, or the defaults when there are none (or they were unreadable and set aside). */
export function readProjectSettings(projectDataDir: string): ProjectSettings {
  return readJsonFile(settingsPath(projectDataDir), projectSettingsSchema) ?? defaultProjectSettings()
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
