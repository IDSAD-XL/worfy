import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { StartAutopilotModal } from '../autopilot/StartAutopilotModal'
import { underFocusCover } from '../focus/cover'
import { setFocusSlot } from '../focus/focus-state'
import { GettingStartedPanel } from '../getting-started/GettingStartedPanel'
import { GuideHost } from '../guide/GuideHost'
import { MachineDialogs } from '../machines/MachineDialogs'
import { PullRequestsView } from '../pr-inbox/PrInboxView'
import { useInterfaceScale } from '../settings/interface-scale'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShortcutsOverlay } from '../shortcuts/ShortcutsOverlay'
import { FirstRun } from './FirstRun'
import { Sidebar } from './Sidebar'
import { followSidebarCommand, SIDEBAR_TOGGLE_SELECTOR, useSidebarVisibility } from './sidebar-visibility'
import { Toolbar, type ShellView, type ToolbarProject } from './Toolbar'
import './shell.css'

export interface AppShellProps {
  project?: ToolbarProject
  /** Content of the Canvas view (ticket 05). */
  canvas?: ReactNode
  /** Content of the Session view (ticket 33). */
  session?: ReactNode
  /** Content of the Pipeline view: the board of the active Project (worfy-pipeline ticket 04). */
  pipeline?: ReactNode
  /** Content of the Run history view: the timeline of an Autopilot Run (worfy-flight-recorder ticket 18). */
  history?: ReactNode
  /**
   * The view on screen, when the caller decides it (main.tsx: a double click on a Session's Node
   * opens the Session view). Without it the shell keeps the view itself.
   */
  view?: ShellView
  onViewChange?: (view: ShellView) => void
}

/**
 * Keeps the keyboard focus when the sidebar comes or goes with the focus on a button that goes away
 * with it: the browser would leave it on <body>, where Tab starts from the top of the page.
 * - The sidebar goes away with the focus inside it — the sidebar's own button hid it: the focus goes
 *   to the button that brings the sidebar back — the one of the focus mode bar while focus mode is
 *   on screen (the toolbar is inert or hidden then), else the one of the toolbar.
 * - The sidebar comes back by the toolbar's «Show sidebar», which the toolbar has only while the
 *   sidebar is hidden (worfy-polish ticket 94): the focus goes to «Hide sidebar» in the sidebar's
 *   strip. The button of the focus mode bar stays where it is, and so does its focus.
 *
 * A class, for getSnapshotBeforeUpdate: the one place React lets a component read the DOM after
 * the render and before the sidebar, or the toolbar's button, is taken out of it.
 */
class SidebarFocusKeeper extends Component<{ visible: boolean; shell: RefObject<HTMLElement | null> }, object, Element | null> {
  override getSnapshotBeforeUpdate(previous: { visible: boolean }): Element | null {
    if (previous.visible === this.props.visible) return null
    const focused = document.activeElement
    if (focused == null) return null
    if (previous.visible) {
      const sidebar = this.props.shell.current?.querySelector('.w-sidebar')
      return sidebar != null && sidebar.contains(focused) ? focused : null
    }
    return focused.matches(SIDEBAR_TOGGLE_SELECTOR) ? focused : null
  }

  override componentDidUpdate(_props: unknown, _state: unknown, focused: Element | null): void {
    // Only a focus that went away with its button is moved: one that is still on screen stays.
    if (focused == null || focused.isConnected) return
    const toggles = this.props.shell.current?.querySelectorAll<HTMLElement>(SIDEBAR_TOGGLE_SELECTOR) ?? []
    // A layout effect: focus mode has made the toolbar inert — or hidden, while a tile is
    // see-through — or taken that off, before this runs.
    const toggle = [...toggles].find((button) => !underFocusCover(button))
    toggle?.focus({ preventScroll: true })
  }

  override render(): ReactNode {
    return null
  }
}

/** The name of the main area for each view, as its tab in the toolbar says it (Run history has no tab). */
const VIEW_NAMES: Record<ShellView, string> = { canvas: 'Canvas', session: 'Session', pipeline: 'Pipeline', history: 'Run history', 'pull-requests': 'Pull requests' }

/** The window of design F: sidebar, unified toolbar and the main area under it. */
export function AppShell({ project, canvas, session, pipeline, history, view: controlledView, onViewChange }: AppShellProps) {
  const [ownView, setOwnView] = useState<ShellView>('canvas')
  const view = controlledView ?? ownView
  const setView = (next: ShellView) => {
    setOwnView(next)
    onViewChange?.(next)
  }
  // Apart for the normal view and focus mode, and kept in the app settings (sidebar-visibility.ts).
  const { visible: sidebarVisible, toggle: toggleSidebar } = useSidebarVisibility()
  // View ▸ Toggle Sidebar (Cmd/Ctrl+B). One subscription for the life of the shell, the switch of the
  // last render — set in a layout effect, so no command finds the one of the render before.
  const latestToggle = useRef(toggleSidebar)
  useLayoutEffect(() => {
    latestToggle.current = toggleSidebar
  })
  useEffect(() => followSidebarCommand(() => latestToggle.current()), [])
  // The strips under the window buttons keep their size in pixels of the window at any interface scale.
  useInterfaceScale()
  const shell = useRef<HTMLDivElement>(null)

  return (
    <div ref={shell} className="w-shell" data-testid="app-shell" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {/* The button that hides it is in its own strip at the top; while it is hidden, the toolbar has the button that shows it. */}
      {sidebarVisible ? <Sidebar onToggle={toggleSidebar} /> : null}
      {/* Focus mode draws its layer in the main area (focus/focus-state.ts): over the toolbar and the
          view, next to the sidebar. */}
      <div ref={setFocusSlot} className="w-shell__main">
        <Toolbar project={project} view={view} onViewChange={setView} sidebarVisible={sidebarVisible} onToggleSidebar={toggleSidebar} />
        <main className={`w-shell__content w-shell__content--${view}`} aria-label={VIEW_NAMES[view]}>
          {/* Both views stay mounted and the inactive one is only hidden: switching must not
              destroy what a view keeps in memory (the React Flow instance, xterm terminals). */}
          <div className="w-shell__view" data-view="canvas" hidden={view !== 'canvas'}>
            {canvas}
          </div>
          <div className="w-shell__view" data-view="session" hidden={view !== 'session'}>
            {session}
          </div>
          <div className="w-shell__view" data-view="pipeline" hidden={view !== 'pipeline'}>
            {pipeline}
          </div>
          <div className="w-shell__view" data-view="history" hidden={view !== 'history'}>
            {history}
          </div>
          {/* The PR inbox of the active Project (worfy-pr-inbox ticket 03): the view finds the Project itself. */}
          <div className="w-shell__view" data-view="pull-requests" hidden={view !== 'pull-requests'}>
            <PullRequestsView />
          </div>
        </main>
      </div>
      <SidebarFocusKeeper visible={sidebarVisible} shell={shell} />
      {/* Getting started (worfy-onboarding ticket 13): a panel in the top right corner while shown, above the window and below its dialogs;
          in the Session view under the Session's header (owner's decision Q22). */}
      <GettingStartedPanel sessionView={view === 'session'} />
      {/* The first-run screen (worfy-harness ticket 19): over the window when open; it asks main at start whether to open. */}
      <FirstRun />
      {/* The Settings window (worfy-ui ticket 2): over everything when open; the menu's "Settings…" and the palette open it. */}
      <SettingsDialog />
      {/* The Keyboard shortcuts window (worfy-ui ticket 11): Cmd/Ctrl+/, "?", the palette; in the layer of Settings. */}
      <ShortcutsOverlay />
      {/* The worfy Guide (worfy-guide ticket 03): Help ▸ worfy Guide and the palette open it; its window is a chunk loaded on the first opening. */}
      <GuideHost />
      <MachineDialogs />
      {/* The Start Autopilot window (worfy-autopilot-queue ticket 09): the Autopilot button of an Epic frame opens it; over everything, Settings included. */}
      <StartAutopilotModal />
    </div>
  )
}
