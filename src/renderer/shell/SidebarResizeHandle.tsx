import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MIN } from '../../shared/settings/app-settings'
import { Divider } from '../theme/kit/Divider'
import { SIDEBAR_KEY_STEP, useSidebarWidth } from './sidebar-width'

// The right edge of the sidebar, dragged to change its width (worfy-polish ticket 158): the kit's
// Divider counting in CSS pixels. It lies inside the sidebar's <nav>, so the shell's focus keeper
// (AppShell.tsx, SidebarFocusKeeper) still sees a focus on it as a focus inside the sidebar.

const pixelPerPixel = (): number => 1

export function SidebarResizeHandle() {
  const { width, max, move, commit, cancel } = useSidebarWidth()
  return (
    <Divider
      className="w-sidebar__resize"
      value={width}
      min={SIDEBAR_WIDTH_MIN}
      max={max}
      step={SIDEBAR_KEY_STEP}
      reset={SIDEBAR_WIDTH_DEFAULT}
      perPixel={pixelPerPixel}
      round={Math.round}
      onMove={move}
      onCommit={commit}
      onCancel={cancel}
      label="Resize the sidebar"
      title={`Drag to resize. Double-click: ${SIDEBAR_WIDTH_DEFAULT} px`}
      testId="sidebar-resize"
    />
  )
}
