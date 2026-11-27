/// <reference types="vite/client" />
import { collectExtensions, type ShellExtension } from '../shell/registry'

/**
 * The groups of the Settings window's section list, in the order the list shows them (worfy-polish ticket 166): the
 * app itself, the agents it runs, the workflow they follow, and the workspace around them.
 */
export const SETTINGS_GROUPS = ['App', 'Agents', 'Workflow', 'Workspace'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

/** The glyphs a section may name in its `icon` export; icons.tsx draws each of them. */
export const SETTINGS_ICONS = ['sliders', 'heart', 'keyboard', 'monitor', 'spark', 'terminal', 'layers', 'chat', 'autopilot', 'list', 'columns', 'pr', 'canvas', 'globe', 'plug'] as const
export type SettingsIconName = (typeof SETTINGS_ICONS)[number]

/**
 * A section of the Settings window: one file src/renderer/settings/<Name>Section.tsx that
 * default-exports a component and exports a numeric `order`, a string `title`, its `group` (one of
 * SETTINGS_GROUPS) and its `icon` (one of SETTINGS_ICONS). The list shows the groups in their order and,
 * inside a group, lower orders first: General 10, Health 20, Shortcuts 30, Machines 40, the sections
 * of other Epics from 50. Adding a file is all it takes: the window finds the files with import.meta.glob.
 */
export interface SettingsSection extends ShellExtension {
  /** The heading of the section and its row in the list, e.g. "General". */
  title: string
  /** The group of the list the row stands in, e.g. "App". */
  group: SettingsGroup
  /** The glyph before the row's title. */
  icon: SettingsIconName
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)

/**
 * Turns the result of an eager import.meta.glob into sections sorted by group, then by `order`, then
 * by file name. A file without a component, a finite `order`, a non-empty `title`, a known `group` or
 * a known `icon` is a programming error and throws with the file's path, so a forgotten export stops
 * the renderer instead of hiding the section.
 */
export function collectSections(modules: Record<string, unknown>): SettingsSection[] {
  return Object.entries(modules)
    .map(([path, module]) => {
      const [extension] = collectExtensions({ [path]: module })
      const { title, group, icon } = (module ?? {}) as { title?: unknown; group?: unknown; icon?: unknown }
      if (extension === undefined || typeof title !== 'string' || title.trim() === '') {
        throw new Error(`${path} must export a non-empty string \`title\``)
      }
      if (!isOneOf(SETTINGS_GROUPS, group)) {
        throw new Error(`${path} must export a \`group\`, one of ${SETTINGS_GROUPS.join(', ')}`)
      }
      if (!isOneOf(SETTINGS_ICONS, icon)) {
        throw new Error(`${path} must export an \`icon\`, one of ${SETTINGS_ICONS.join(', ')}`)
      }
      return { ...extension, title, group, icon }
    })
    .sort((a, b) => SETTINGS_GROUPS.indexOf(a.group) - SETTINGS_GROUPS.indexOf(b.group) || a.order - b.order || a.id.localeCompare(b.id))
}

export interface SettingsSectionGroup {
  group: SettingsGroup
  sections: SettingsSection[]
}

/**
 * The sections under their groups, in the order of SETTINGS_GROUPS; inside a group they keep the order
 * they came in. A group without sections is left out.
 */
export function groupSections(sections: readonly SettingsSection[]): SettingsSectionGroup[] {
  return SETTINGS_GROUPS.map((group) => ({ group, sections: sections.filter((each) => each.group === group) })).filter((each) => each.sections.length > 0)
}

/** The section files next to this one. */
export const settingsSections: readonly SettingsSection[] = collectSections(import.meta.glob('./*Section.tsx', { eager: true }))
