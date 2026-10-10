// The frame of the main window by system (worfy-windows ticket 11). No Electron at run time here,
// so the choice is tested without a window (test/unit/window-options.test.ts).
import type { BrowserWindowConstructorOptions } from 'electron'

/** `--bg` of the light and the dark theme (src/renderer/theme/tokens.css); the test keeps them in step. */
export const WINDOW_BACKGROUND = { light: '#f7f7f9', dark: '#121110' } as const

export type FrameOptions = Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition' | 'vibrancy' | 'visualEffectState' | 'backgroundColor'>

/**
 * macOS: the native frame of design F — no title bar, traffic lights inset into the unified
 * toolbar, a translucent sidebar. The page keeps its own background transparent where the sidebar
 * is, so the vibrancy shows through.
 *
 * Windows and Linux: the system's own frame, with its title bar and the menu under it, and an
 * opaque background of the theme (`dark`), which is what shows until the page has painted. The
 * styles follow `data-platform` on <html> (shell.css, focus.css).
 */
export function frameOptions(platform: NodeJS.Platform, dark: boolean): FrameOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 19 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    }
  }
  return { backgroundColor: dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light }
}
