// A Project's settings (`<Project data folder>/settings.json`): the action templates, for
// Windows the shell of the Terminals, the Default vendor, and the answer to the team reviewer's
// offer (worfy-human-review ticket 09).
// The schema and the defaults live in src/shared/projects/action-templates.ts. The defaults are
// those of the Harness found on the machine (src/main/harness/locate.ts, worfy-harness ticket 12),
// looked up again on every call unless the caller names it.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultProjectSettings,
  migrateProjectSettings,
  projectSettingsSchema,
  savedProjectSettingsSchema,
  type HarnessKind,
  type HumanReviewSettings,
  type ProjectSettings,
  type ProjectSettingsInput,
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
  const saved = readJsonFile(settingsPath(projectDataDir), savedProjectSettingsSchema)
  return saved === undefined ? defaultProjectSettings(harness) : migrateProjectSettings(saved, harness)
}

/**
 * Saves the settings; a template with an unknown placeholder throws and nothing is written. Settings
 * without `gateQueue` (a Linked machine on a build from before "Process gate queue") keep the saved
 * one, or the default when none is saved. Settings without `defaultVendor` keep the saved one (a
 * Linked machine on a build from before the field), and `defaultVendor: null` clears it: "Default
 * vendor" set back to none in Project settings (worfy-multi-vendor ticket 24). Settings without
 * `humanReview` keep the saved one: "Save" of Project settings does not send it.
 */
export function writeProjectSettings(projectDataDir: string, settings: ProjectSettingsInput, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  let saved: ProjectSettings | undefined
  const read = (): ProjectSettings => (saved ??= readProjectSettings(projectDataDir, harness))
  const gateQueue = settings.actionTemplates.gateQueue ?? read().actionTemplates.gateQueue
  const { defaultVendor: asked, humanReview: review, ...rest } = settings
  const defaultVendor = asked === null ? undefined : (asked ?? read().defaultVendor)
  const humanReview = review ?? read().humanReview
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, {
    ...rest,
    ...(defaultVendor === undefined ? {} : { defaultVendor }),
    ...(humanReview === undefined ? {} : { humanReview }),
    actionTemplates: { ...settings.actionTemplates, gateQueue },
  })
  return readProjectSettings(projectDataDir, harness)
}

/**
 * Records the answer to the team reviewer's offer (worfy-human-review ticket 09) and keeps every
 * other setting as it is saved: `"later"` — the offer made after the Project was added is not made
 * again. Returns the settings as saved.
 */
export function writeHumanReviewOffer(projectDataDir: string, offer: NonNullable<HumanReviewSettings['offer']>, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  const current = readProjectSettings(projectDataDir, harness)
  return writeProjectSettings(projectDataDir, { ...current, humanReview: { ...current.humanReview, offer } }, harness)
}

/**
 * Writes the defaults for a Project that has no settings yet. They are written once, when the
 * Project is added, so a later change of the defaults does not silently rewrite the owner's own
 * templates; a written default still follows the Harness, as readProjectSettings says.
 */
export function ensureProjectSettings(projectDataDir: string, harness: HarnessKind = currentHarness().kind): void {
  if (!existsSync(settingsPath(projectDataDir))) writeProjectSettings(projectDataDir, defaultProjectSettings(harness), harness)
}
