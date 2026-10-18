import { collectExtensions, type ShellExtension } from './registry'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { CommandPalette } from '../palette/CommandPalette'
import { SidebarToggle } from './sidebar-visibility'

// Each toolbar item is its own file, src/renderer/shell/toolbar/<Name>.tsx, with a
// default-exported component and `export const order = <number>`. Items sit between the view
// switch and the command palette field; this file never changes when an item is added.
const items = collectExtensions(import.meta.glob('./toolbar/*.tsx', { eager: true }))

export type ShellView = 'canvas' | 'session' | 'pipeline'

/** The Project the window shows. Until Projects exist (ticket 04) the toolbar shows none. */
export interface ToolbarProject {
  name: string
  branch: string
}

const viewOptions: readonly SegmentOption<ShellView>[] = [
  {
    value: 'canvas',
    label: 'Canvas',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    value: 'session',
    label: 'Session',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />
      </svg>
    ),
  },
  {
    // The board of the active Project: a column per Stage of its Pipeline (pipeline/PipelineBoard.tsx).
    value: 'pipeline',
    label: 'Pipeline',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2.5" width="3.2" height="11" rx="1" />
        <rect x="6.4" y="2.5" width="3.2" height="7.5" rx="1" />
        <rect x="10.8" y="2.5" width="3.2" height="4.5" rx="1" />
      </svg>
    ),
  },
]

export interface ToolbarViewProps {
  items: readonly ShellExtension[]
  project?: ToolbarProject
  view: ShellView
  onViewChange: (view: ShellView) => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function ToolbarView({ items, project, view, onViewChange, sidebarVisible, onToggleSidebar }: ToolbarViewProps) {
  const title = project ? `worfy — ${project.name}` : 'worfy'
  return (
    <header className="w-toolbar" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {/* Hides and shows the sidebar; View ▸ Toggle Sidebar (Cmd/Ctrl+B) does the same. */}
      <SidebarToggle className="w-toolbar__icon-button" visible={sidebarVisible} onToggle={onToggleSidebar} />

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

      <SegmentedControl label="View" options={viewOptions} value={view} onChange={onViewChange} />

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
