/// <reference types="vite/client" />
import { collectExtensions, type ShellExtension } from '../shell/registry'

/**
 * A section of the Settings window: one file src/renderer/settings/<Name>Section.tsx that
 * default-exports a component and exports a numeric `order` and a string `title`. Lower orders
 * come first: General 10, Health 20, Shortcuts 30, Machines 40, the sections of other Epics from
 * 50. Adding a file is all it takes: the window finds the files with import.meta.glob.
 */
export interface SettingsSection extends ShellExtension {
  /** The heading of the section and its row in the list, e.g. "General". */
  title: string
}

/**
 * Turns the result of an eager import.meta.glob into sections sorted by `order`, then by file
 * name. A file without a component, a finite `order` or a non-empty `title` is a programming error
 * and throws with the file's path, so a forgotten export stops the renderer instead of hiding the
 * section.
 */
export function collectSections(modules: Record<string, unknown>): SettingsSection[] {
  return Object.entries(modules)
    .map(([path, module]) => {
      const [extension] = collectExtensions({ [path]: module })
      const { title } = (module ?? {}) as { title?: unknown }
      if (extension === undefined || typeof title !== 'string' || title.trim() === '') {
        throw new Error(`${path} must export a non-empty string \`title\``)
      }
      return { ...extension, title }
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** The section files next to this one. */
export const settingsSections: readonly SettingsSection[] = collectSections(import.meta.glob('./*Section.tsx', { eager: true }))
