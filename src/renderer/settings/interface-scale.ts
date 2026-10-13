// The interface scale in the renderer. Main zooms the whole window (src/main/settings/interface-scale.ts),
// so every CSS pixel grows or shrinks with the scale — but the window buttons of macOS (the traffic
// lights) stay where they are, in pixels of the window. What the page keeps clear for them is
// therefore counted in pixels of the window too: this module writes on <html>
// - `--interface-scale`, for the styles that divide by it (the room left of the toolbar and of the
//   focus mode bar: shell.css, focus.css);
// - `--toolbar-height`, over the token of tokens.css, as 52 px of the window: the toolbar, the strip
//   above the sidebar, the focus mode bar and whatever is placed under them (the palette, the ADR
//   panel) follow it with no change of their own.
// What is inside those strips still scales with the window.
import { useLayoutEffect } from 'react'
import { useAppSettings } from './useAppSettings'

/** The height of the toolbar in pixels of the window: `--toolbar-height` of theme/tokens.css at 100 %. */
export const TOOLBAR_HEIGHT_PX = 52

/** The slider of Settings → General counts in whole percent: 0.8 is 80. */
export function scaleToPercent(scale: number): number {
  return Math.round(scale * 100)
}

/** "120 %", as Settings → General shows the scale. */
export function formatScale(scale: number): string {
  return `${scaleToPercent(scale)} %`
}

/** Writes the two variables for `scale` on `root`, <html> by default. */
export function applyInterfaceScale(scale: number, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--interface-scale', String(scale))
  root.style.setProperty('--toolbar-height', `calc(${TOOLBAR_HEIGHT_PX}px / ${scale})`)
}

/** Takes both variables off `root` again: the token of tokens.css counts once more. */
export function clearInterfaceScale(root: HTMLElement = document.documentElement): void {
  root.style.removeProperty('--interface-scale')
  root.style.removeProperty('--toolbar-height')
}

/**
 * Keeps the two variables on <html> at the interface scale of the app settings, for as long as the
 * component is mounted. In a layout effect: the strips are resized before the frame that shows the
 * new scale is painted.
 */
export function useInterfaceScale(): void {
  const scale = useAppSettings((settings) => settings.interfaceScale)
  useLayoutEffect(() => {
    applyInterfaceScale(scale)
    return () => clearInterfaceScale()
  }, [scale])
}
