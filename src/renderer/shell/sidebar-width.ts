// The width of the sidebar (worfy-polish ticket 158). The app settings keep the width the person
// dragged it to (`sidebar.width`, src/shared/settings/app-settings.ts); the window shows it within
// SIDEBAR_WIDTH_MIN … SIDEBAR_WIDTH_MAX and never wider than leaves SIDEBAR_CANVAS_ROOM for the rest of
// the window. A narrower window only shows it narrower: nothing is written, and a wider one shows the
// saved width again.
//
// The width is written on <html> as `--sidebar-width`, over the token of tokens.css, so that every
// style that counts with it (shell.css, the ADR panel of AdrSection.tsx) follows. The default width
// writes nothing: the token counts. CSS pixels throughout — window.innerWidth and the pointer's
// clientX are in them too — so the interface scale, a zoom of the whole window, enlarges the sidebar
// once, as it did the fixed 264 px.
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { SIDEBAR_CANVAS_ROOM, SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, sidebarWidthOf } from '../../shared/settings/app-settings'
import { hasPreloadBridge } from '../ipc'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'

/** How far one arrow key moves the edge of the sidebar, in CSS pixels. */
export const SIDEBAR_KEY_STEP = 16

/**
 * The widest the sidebar may be in a window `windowWidth` CSS pixels wide: SIDEBAR_WIDTH_MAX, or what
 * leaves SIDEBAR_CANVAS_ROOM to the rest of the window — but never below the default, which the
 * sidebar had at any window size before its width could change.
 */
export function sidebarWidthMax(windowWidth: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_DEFAULT, Math.floor(windowWidth) - SIDEBAR_CANVAS_ROOM))
}

/** `width` as a window `windowWidth` CSS pixels wide shows it. */
export function sidebarWidthIn(width: number, windowWidth: number): number {
  return Math.min(Math.max(Math.round(width), SIDEBAR_WIDTH_MIN), sidebarWidthMax(windowWidth))
}

/** The width while its edge is dragged, or after a write until main answers; null — the settings decide. */
const useMoving = create<{ width: number | null }>(() => ({ width: null }))
/** How many writes there were: only the answer to the last one lets go of the width it showed. */
let writes = 0

function followResize(changed: () => void): () => void {
  window.addEventListener('resize', changed)
  return () => window.removeEventListener('resize', changed)
}
const windowWidth = (): number => window.innerWidth

export interface SidebarWidth {
  /** The width the window shows now. */
  width: number
  /** The widest it may be in this window. */
  max: number
  /** Shows `width` at once, without writing it: a drag under way, or a drag cancelled. */
  move: (width: number) => void
  /** Shows `width` and writes it to the app settings; the default takes the field away. */
  commit: (width: number) => void
  /** A drag cancelled: the settings decide again. */
  cancel: () => void
}

export function useSidebarWidth(): SidebarWidth {
  const saved = useAppSettings(sidebarWidthOf)
  const moving = useMoving((state) => state.width)
  const inWindow = useSyncExternalStore(followResize, windowWidth)
  const move = (width: number) => useMoving.setState({ width })
  const commit = (width: number) => {
    useMoving.setState({ width })
    // No main to save it in (a unit test of a component): the width holds in this window only.
    if (!hasPreloadBridge()) return
    const mine = ++writes
    void setAppSettings({ sidebar: { width: width === SIDEBAR_WIDTH_DEFAULT ? null : width } }).then((refused) => {
      if (refused !== undefined) console.error('appSettings.set failed, the sidebar keeps this width in this window only:', refused)
      else if (mine === writes) useMoving.setState({ width: null })
    })
  }
  const cancel = () => useMoving.setState({ width: null })
  return { width: sidebarWidthIn(moving ?? saved, inWindow), max: sidebarWidthMax(inWindow), move, commit, cancel }
}

/**
 * Keeps `--sidebar-width` on <html> at the width the window shows, for as long as the shell is
 * mounted — also while the sidebar is hidden, so it comes back at the same width. In a layout effect:
 * the sidebar is resized before the frame that shows the new width is painted.
 */
export function useSidebarWidthVariable(): void {
  const { width } = useSidebarWidth()
  useLayoutEffect(() => {
    const root = document.documentElement
    if (width === SIDEBAR_WIDTH_DEFAULT) root.style.removeProperty('--sidebar-width')
    else root.style.setProperty('--sidebar-width', `${width}px`)
  }, [width])
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty('--sidebar-width')
    },
    [],
  )
}
