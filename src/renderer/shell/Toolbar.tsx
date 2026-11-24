import { collectExtensions, type ShellExtension } from './registry'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { CommandPalette } from '../palette/CommandPalette'
import { SidebarToggle } from './sidebar-visibility'
import { openRunHistory } from '../flight-recorder/open'
import { useReadyCount } from '../acceptance/useAcceptance'

// Each toolbar item is its own file, src/renderer/shell/toolbar/<Name>.tsx, with a
// default-exported component and `export const order = <number>`. Items sit between the view
// switch and the command palette field; this file never changes when an item is added.
const items = collectExtensions(import.meta.glob('./toolbar/*.tsx', { eager: true }))

/**
 * The views of the main area. `history` — the Run history of Flight Recorder
 * (flight-recorder/RunHistoryView.tsx) — has the `Runs` tab here, which opens it at the active
 * Project's newest Run (openRunHistory); its other entries open it too, Esc leaves it.
 * `pull-requests` — the PR inbox of the active Project (pr-inbox/PrInboxView.tsx) — is the fifth tab.
 * `acceptance` — the checks that wait for the owner in every Project (acceptance/AcceptanceView.tsx) — is the sixth,
 * with the count of Ready to check; it needs no open Project.
 * `story` — a Code story (stories/StoryView.tsx) — has no tab: openStory (stories/open.ts) opens it, Esc leaves it.
 * `changes` — the Changes of a Ticket (changes/ChangesView.tsx) — has no tab either: without a Ticket it has nothing to
 * show; openChanges (changes/open.ts) opens it, its button back and Esc leave it.
 */
export type ShellView = 'canvas' | 'session' | 'pipeline' | 'history' | 'pull-requests' | 'acceptance' | 'story' | 'changes'

/** The Project the window shows. Until Projects exist (ticket 04) the toolbar shows none. */
export interface ToolbarProject {
  /** The id of the Project: the `Runs` tab opens the Run history of it. */
  id: string
  name: string
  branch: string
}

function viewOptions(project: ToolbarProject | undefined, ready: number): readonly SegmentOption<ShellView>[] {
  return [
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
    {
      // The Run history of the active Project (flight-recorder/RunHistoryView.tsx): a clock face.
      value: 'history',
      label: 'Runs',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.75V8l2.25 1.5" />
        </svg>
      ),
      disabled: project === undefined,
      title: project === undefined ? 'Open a Project to see its Runs' : 'Runs',
    },
    {
      // The PR inbox of the active Project (pr-inbox/PrInboxView.tsx, worfy-pr-inbox ticket 03): a pull request's two branches.
      value: 'pull-requests',
      label: 'Pull requests',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="12.5" r="1.5" />
          <path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
        </svg>
      ),
      disabled: project === undefined,
      title: project === undefined ? 'Open a Project to see its pull requests' : 'Pull requests',
    },
    {
      // The checks that wait for the owner (acceptance/AcceptanceView.tsx, worfy-acceptance ticket 05): a checked box.
      // The count of Ready to check follows the label: the wrapper of the icon lets it out (shell.css has none of it,
      // acceptance.css places it), and with the label hidden in a narrow window it stays next to the icon.
      value: 'acceptance',
      label: 'Acceptance',
      icon: (
        <span className="w-acc-tab">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M5.5 8.2l1.8 1.8 3.4-3.8" />
          </svg>
          {ready > 0 ? (
            <span className="w-acc-tab__count" data-testid="acceptance-tab-count">
              {ready}
            </span>
          ) : null}
        </span>
      ),
      title: 'Checks that wait for you',
      testId: 'acceptance-tab',
    },
  ]
}

export interface ToolbarViewProps {
  items: readonly ShellExtension[]
  project?: ToolbarProject
  view: ShellView
  onViewChange: (view: ShellView) => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function ToolbarView({ items, project, view, onViewChange, sidebarVisible, onToggleSidebar }: ToolbarViewProps) {
  // The sidebar's strip carries the wordmark «worfy» (worfy-polish ticket 94): next to it the title names the Project
  // alone, so «worfy» is not said twice side by side. With the sidebar hidden the title says it, as before.
  const title = sidebarVisible ? (project?.name ?? 'No Project open') : project ? `worfy — ${project.name}` : 'worfy'
  const ready = useReadyCount()
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

      <SegmentedControl
        label="View"
        options={viewOptions(project, ready)}
        value={view}
        // `Runs` opens the screen through the Run history entry, which also shows the newest Run.
        onChange={(next) => {
          if (next !== 'history') onViewChange(next)
          else if (project !== undefined) void openRunHistory(project.id)
        }}
      />

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
