// A Project's settings (`<Project data folder>/settings.json`): today only the action templates.
// The schema and the defaults live in src/shared/projects/action-templates.ts. The defaults are
// those of the Harness found on the machine (src/main/harness/locate.ts, worfy-harness ticket 12),
// looked up again on every call unless the caller names it.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultProjectSettings,
  migrateProjectSettings,
  projectSettingsSchema,
  type HarnessKind,
  type ProjectSettings,
} from '../../shared/projects/action-templates'
import { currentHarness } from '../harness/locate'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export function settingsPath(projectDataDir: string): string {
  return join(projectDataDir, 'settings.json')
}

/**
 * The saved settings, or the defaults when there are none (or they were unreadable and set aside).
 * A saved template equal to any default an action has had reads as the default of `harness`
 * (migrateProjectSettings); the file is not rewritten here, the next save writes it.
 */
export function readProjectSettings(projectDataDir: string, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  const saved = readJsonFile(settingsPath(projectDataDir), projectSettingsSchema)
  return saved === undefined ? defaultProjectSettings(harness) : migrateProjectSettings(saved, harness)
}

/** Saves the settings; a template with an unknown placeholder throws and nothing is written. */
export function writeProjectSettings(projectDataDir: string, settings: ProjectSettings, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, settings)
  return readProjectSettings(projectDataDir, harness)
}

/**
 * Writes the defaults for a Project that has no settings yet. They are written once, when the
 * Project is added, so a later change of the defaults does not silently rewrite the owner's own
 * templates; a written default still follows the Harness, as readProjectSettings says.
 */
export function ensureProjectSettings(projectDataDir: string, harness: HarnessKind = currentHarness().kind): void {
  if (!existsSync(settingsPath(projectDataDir))) writeProjectSettings(projectDataDir, defaultProjectSettings(harness), harness)
}
