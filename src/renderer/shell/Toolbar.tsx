import { DEFAULT_VIEW_BUTTONS } from '../../shared/layout/view-buttons'
import { collectExtensions, type ShellExtension } from './registry'
import { CommandPalette } from '../palette/CommandPalette'
import { SidebarToggle } from './sidebar-visibility'
import { ViewZone, type ViewLayout } from './ViewZone'

// Each toolbar item is its own file, src/renderer/shell/toolbar/<Name>.tsx, with a
// default-exported component and `export const order = <number>`. Items sit between the View
// buttons of the header and the command palette field; this file never changes when an item is added.
const items = collectExtensions(import.meta.glob('./toolbar/*.tsx', { eager: true }))

/**
 * The views of the main area; their names, buttons and palette rows are in the registry (views.tsx), and which zone
 * each View button stands in is the layout (ViewZone.tsx). `history` — the Run history of Flight Recorder
 * (flight-recorder/RunHistoryView.tsx) — has the `Runs` button, which opens it at the active
 * Project's newest Run (openRunHistory); its other entries open it too, Esc leaves it.
 * `pull-requests` — the PR inbox of the active Project (pr-inbox/PrInboxView.tsx).
 * `acceptance` — the checks that wait for the owner in every Project (acceptance/AcceptanceView.tsx) — has the count
 * of Ready to check; it needs no open Project.
 * `story` — a Code story (stories/StoryView.tsx) — has no button: openStory (stories/open.ts) opens it, Esc leaves it.
 * `changes` — the Changes of a Ticket (changes/ChangesView.tsx) — has no button either: without a Ticket it has nothing
 * to show; openChanges (changes/open.ts) opens it, its button back and Esc leave it.
 */
export type ShellView = 'canvas' | 'session' | 'pipeline' | 'history' | 'pull-requests' | 'acceptance' | 'story' | 'changes'

/** The Project the window shows. Until Projects exist (ticket 04) the toolbar shows none. */
export interface ToolbarProject {
  /** The id of the Project: the `Runs` tab opens the Run history of it. */
  id: string
  name: string
  branch: string
}

export interface ToolbarViewProps {
  items: readonly ShellExtension[]
  project?: ToolbarProject
  view: ShellView
  onViewChange: (view: ShellView) => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
  /** Which View buttons stand in the header, and on the rail (drawn here while the sidebar is hidden); the default without it. */
  layout?: ViewLayout
}

export function ToolbarView({ items, project, view, onViewChange, sidebarVisible, onToggleSidebar, layout = DEFAULT_VIEW_BUTTONS }: ToolbarViewProps) {
  // The sidebar's strip carries the wordmark «worfy» (worfy-polish ticket 94): next to it the title names the Project
  // alone, so «worfy» is not said twice side by side. With the sidebar hidden the title says it, as before.
  const title = sidebarVisible ? (project?.name ?? 'No Project open') : project ? `worfy — ${project.name}` : 'worfy'
  return (
    <header className="w-toolbar" data-toast-keep-out="" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {/* Shows the hidden sidebar; View ▸ Toggle Sidebar (Cmd/Ctrl+B) does the same. While the sidebar is
          shown, the button that hides it is in the sidebar's own strip (Sidebar.tsx, worfy-polish ticket 94). */}
      {sidebarVisible ? null : <SidebarToggle className="w-toolbar__icon-button" visible={false} onToggle={onToggleSidebar} />}

      {/* The title is the one item that gives way: a long Project name ends with an ellipsis
          (the full text is the tooltip), and the controls to its right stay whole. */}
      <div className="w-toolbar__title">
        <span className="w-toolbar__name" title={title}>
          {title}
        </span>
        <span className="w-toolbar__subtitle" title={project ? `${project.name} · ${project.branch}` : undefined}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="5" cy="3.5" r="1.5" />
            <circle cx="5" cy="12.5" r="1.5" />
            <circle cx="11" cy="5" r="1.5" />
            <path d="M5 5v6M11 6.5c0 2.5-6 2-6 4.5" />
          </svg>
          {project ? (
            <span className="w-toolbar__subtitle-text">
              {project.name} · <span className="w-mono">{project.branch}</span>
            </span>
          ) : (
            'No project'
          )}
        </span>
      </div>

      {/* The View buttons of the Header zone; with the sidebar hidden, the rail's after a line (ViewZone.tsx). */}
      <ViewZone zone="header" views={{ layout, view, project, onViewChange }} withRail={!sidebarVisible} />

      <div className="w-toolbar__spacer" />

      {items.map(({ id, Component }) => (
        <div key={id} className="w-toolbar__item" data-item={id}>
          <Component />
        </div>
      ))}

      {/* The "Search or run… ⌘K" field: it opens the command palette (ticket 31). */}
      <CommandPalette />
    </header>
  )
}

export type ToolbarProps = Omit<ToolbarViewProps, 'items'>

export function Toolbar(props: ToolbarProps) {
  return <ToolbarView items={items} {...props} />
}
