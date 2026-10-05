import { collectExtensions, type ShellExtension } from './registry'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { CommandPalette } from '../palette/CommandPalette'

// Each toolbar item is its own file, src/renderer/shell/toolbar/<Name>.tsx, with a
// default-exported component and `export const order = <number>`. Items sit between the view
// switch and the command palette field; this file never changes when an item is added.
const items = collectExtensions(import.meta.glob('./toolbar/*.tsx', { eager: true }))

export type ShellView = 'canvas' | 'session'

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
  return (
    <header className="w-toolbar" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      <button
        type="button"
        className="w-toolbar__icon-button"
        aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={sidebarVisible}
        onClick={onToggleSidebar}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M6 2.75v10.5" />
        </svg>
      </button>

      <div className="w-toolbar__title">
        <span className="w-toolbar__name">{project ? `worfy — ${project.name}` : 'worfy'}</span>
        <span className="w-toolbar__subtitle">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="5" cy="3.5" r="1.5" />
            <circle cx="5" cy="12.5" r="1.5" />
            <circle cx="11" cy="5" r="1.5" />
            <path d="M5 5v6M11 6.5c0 2.5-6 2-6 4.5" />
          </svg>
          {project ? (
            <>
              {project.name} · <span className="w-mono">{project.branch}</span>
            </>
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
