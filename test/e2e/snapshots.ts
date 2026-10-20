import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type Page } from '@playwright/test'

/** Paths of the two PNGs one call of snapshotThemes writes. */
export interface ThemeSnapshots {
  light: string
  dark: string
}

const SCHEMES = ['light', 'dark'] as const

/**
 * Painted behind the page only while a snapshot is taken. The sidebar is translucent so that the
 * window's native vibrancy shows through it (src/main/window.ts), but a page screenshot holds only
 * what the page paints: without a backdrop the sidebar comes out see-through, and an image viewer
 * fills it with its own background. The opaque --sidebar token of each theme (F-SPEC "Tokens")
 * stands in for the vibrancy, so the sidebar looks the same in every viewer.
 */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

/**
 * Takes a screenshot of the window in the light and in the dark theme and returns where both PNGs
 * are: test-results/e2e/snapshots/<name>/light.png and dark.png (under the project's output folder,
 * which Playwright empties at the start of each run). A reviewer of a UI ticket compares them with
 * docs/design/F-SPEC.md.
 *
 * The theme is switched by emulating prefers-color-scheme in the page, which is all the renderer
 * reads (src/renderer/theme/tokens.css); the system theme and the native window are not touched.
 * CSS transitions are skipped, so a shot never catches colours halfway through a change.
 * Afterwards the page follows the system theme again: any colour scheme the test emulated before
 * the call is dropped.
 *
 * Call it only from inside a test, on a window of an app started by launchApp (test/e2e/helpers.ts).
 */
export async function snapshotThemes(window: Page, name: string): Promise<ThemeSnapshots> {
  // One folder name: a name with a path in it would write outside test-results/e2e/snapshots.
  if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(`snapshot name must be a single folder name, got ${JSON.stringify(name)}`)
  }
  const folder = join(test.info().project.outputDir, 'snapshots', name)
  await mkdir(folder, { recursive: true })
  const shots: ThemeSnapshots = { light: join(folder, 'light.png'), dark: join(folder, 'dark.png') }
  try {
    for (const scheme of SCHEMES) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: shots[scheme], animations: 'disabled', style: VIBRANCY_BACKDROP })
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
  return shots
}
