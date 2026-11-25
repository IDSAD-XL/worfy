// A Project's settings (`<Project data folder>/settings.json`): the action templates, for
// Windows the shell of the Terminals, the Default vendor, the answer to the team reviewer's
// offer (worfy-human-review ticket 09), the date of the last reminder to update it (ticket 10),
// the folders a Product Session may also write in (worfy-polish ticket 82), the Integrations of
// the Machine the Project uses (worfy-integrations ticket 03) and the Assistant's rules of the Project
// (worfy-assistant ticket 07).
// The schema and the defaults live in src/shared/projects/action-templates.ts. The defaults are
// those of the Harness found on the machine (src/main/harness/locate.ts, worfy-harness ticket 12),
// looked up again on every call unless the caller names it.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultProjectSettings,
  LATER_ACTIONS,
  migrateProjectSettings,
  projectSettingsSchema,
  savedProjectSettingsSchema,
  type HarnessKind,
  type HumanReviewSettings,
  type ProjectSettings,
  type ProjectSettingsInput,
} from '../../shared/projects/action-templates'
import type { ProjectRule } from '../../shared/assistant/duties'
import type { ProjectIntegration } from '../../shared/integrations/types'
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
 * without `gateQueue` (a Linked machine on a build from before "Process gate queue"), without `prReply`
 * (one from before "Draft replies", worfy-pr-inbox ticket 04) or without `fixChecks`, `resolveConflicts` and
 * `addressComments` (one from before worfy-pr-follow ticket 01) — LATER_ACTIONS — keep the saved template, or the
 * default when none is saved. Settings without `defaultVendor` keep the saved one (a
 * Linked machine on a build from before the field), and `defaultVendor: null` clears it: "Default
 * vendor" set back to none in Project settings (worfy-multi-vendor ticket 24). Settings without
 * `humanReview` keep the saved one: "Save" of Project settings does not send it. Settings without
 * `productWriteFolders` keep the saved list (worfy-polish ticket 82), and the folders of
 * `productWriteFoldersRemoved` leave it: "Save" sends the folders removed in the dialog, so one «Always
 * allow» added meanwhile stays. Settings without `prInbox` keep the saved one too (worfy-pr-inbox ticket 02):
 * a save that does not know the switch does not turn the PR inbox back on. The Integrations the Project uses (`integrations`, worfy-integrations ticket 03) always
 * stay as saved: only writeProjectIntegrations changes them. So do the Assistant's rules (`assistantRules`, worfy-assistant
 * ticket 07): only writeProjectAssistantRules changes them.
 */
export function writeProjectSettings(projectDataDir: string, settings: ProjectSettingsInput, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  let saved: ProjectSettings | undefined
  const read = (): ProjectSettings => (saved ??= readProjectSettings(projectDataDir, harness))
  const later = Object.fromEntries(LATER_ACTIONS.map((action) => [action, settings.actionTemplates[action] ?? read().actionTemplates[action]])) as Record<(typeof LATER_ACTIONS)[number], string>
  const { defaultVendor: asked, humanReview: review, prInbox: askedInbox, ...rest } = settings
  const defaultVendor = asked === null ? undefined : (asked ?? read().defaultVendor)
  const humanReview = review ?? read().humanReview
  const { productWriteFolders: listed, productWriteFoldersRemoved: removed = [], ...others } = rest
  const productWriteFolders = (listed ?? read().productWriteFolders)?.filter((folder) => !removed.includes(folder))
  const prInbox = askedInbox ?? read().prInbox
  // `integrations` of the input is never written here: only writeProjectIntegrations changes the field.
  const integrations = read().integrations
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, {
    ...others,
    // `assistantRules` of the input is never written here either: only writeProjectAssistantRules changes the field.
    assistantRules: read().assistantRules,
    ...(defaultVendor === undefined ? {} : { defaultVendor }),
    ...(humanReview === undefined ? {} : { humanReview }),
    ...(productWriteFolders === undefined ? {} : { productWriteFolders }),
    ...(prInbox === undefined ? {} : { prInbox }),
    integrations,
    actionTemplates: { ...settings.actionTemplates, ...later },
  })
  return readProjectSettings(projectDataDir, harness)
}

/**
 * The Integrations of the Machine this Project uses (worfy-integrations ticket 03, ADR-0111): the field
 * `integrations` of its settings.json; empty for a file saved before the field, and for one whose field does not read.
 */
export function readProjectIntegrations(projectDataDir: string, harness: HarnessKind = currentHarness().kind): ProjectIntegration[] {
  return readProjectSettings(projectDataDir, harness).integrations ?? []
}

/**
 * Writes the Integrations this Project uses and keeps every other setting as it is saved. Only the Project's
 * settings.json is written: never the Profile, the repository, `~/.claude.json`, `.mcp.json` or Codex's
 * `config.toml`, in Full and Silent mode alike. Returns the list as saved.
 */
export function writeProjectIntegrations(projectDataDir: string, integrations: readonly ProjectIntegration[], harness: HarnessKind = currentHarness().kind): ProjectIntegration[] {
  const current = readProjectSettings(projectDataDir, harness)
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, { ...current, integrations: [...integrations] })
  return readProjectIntegrations(projectDataDir, harness)
}

/** The Assistant's rules of this Project (worfy-assistant ticket 07): empty for a file saved before the field. */
export function readProjectAssistantRules(projectDataDir: string, harness: HarnessKind = currentHarness().kind): ProjectRule[] {
  return readProjectSettings(projectDataDir, harness).assistantRules ?? []
}

/**
 * Writes the Assistant's rules of this Project and keeps every other setting as it is saved. Only the Project's
 * settings.json in worfy's data folder is written, never the repository. Returns the rules as saved.
 */
export function writeProjectAssistantRules(projectDataDir: string, rules: readonly ProjectRule[], harness: HarnessKind = currentHarness().kind): ProjectRule[] {
  const current = readProjectSettings(projectDataDir, harness)
  writeJsonFile(settingsPath(projectDataDir), projectSettingsSchema, { ...current, assistantRules: [...rules] })
  return readProjectAssistantRules(projectDataDir, harness)
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
 * Records when the reminder to update the team reviewer was shown (worfy-human-review ticket 10), as
 * an ISO date, and keeps every other setting as it is saved. Returns the settings as saved.
 */
export function writeHumanReviewReminder(projectDataDir: string, at: Date, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  const current = readProjectSettings(projectDataDir, harness)
  return writeProjectSettings(projectDataDir, { ...current, humanReview: { ...current.humanReview, remindedAt: at.toISOString() } }, harness)
}

/**
 * Adds `folder` to «Product Session may also write here» (worfy-polish ticket 82: «Always allow in
 * <folder>» of a Product Session's write outside its folder) and keeps every other setting as it is
 * saved; a folder already listed is not added twice. Returns the settings as saved.
 */
export function addProductWriteFolder(projectDataDir: string, folder: string, harness: HarnessKind = currentHarness().kind): ProjectSettings {
  const current = readProjectSettings(projectDataDir, harness)
  const listed = current.productWriteFolders ?? []
  if (listed.includes(folder)) return current
  return writeProjectSettings(projectDataDir, { ...current, productWriteFolders: [...listed, folder] }, harness)
}

/**
 * Writes the defaults for a Project that has no settings yet. They are written once, when the
 * Project is added, so a later change of the defaults does not silently rewrite the owner's own
 * templates; a written default still follows the Harness, as readProjectSettings says.
 */
export function ensureProjectSettings(projectDataDir: string, harness: HarnessKind = currentHarness().kind): void {
  if (!existsSync(settingsPath(projectDataDir))) writeProjectSettings(projectDataDir, defaultProjectSettings(harness), harness)
}
