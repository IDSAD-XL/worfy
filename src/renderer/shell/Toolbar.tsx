import { collectExtensions, type ShellExtension } from './registry'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { CommandPalette } from '../palette/CommandPalette'
import { SidebarToggle } from './sidebar-visibility'
import { openView, VIEW_BUTTONS, type ViewButton } from './views'

// Each toolbar item is its own file, src/renderer/shell/toolbar/<Name>.tsx, with a
// default-exported component and `export const order = <number>`. Items sit between the view
// switch and the command palette field; this file never changes when an item is added.
const items = collectExtensions(import.meta.glob('./toolbar/*.tsx', { eager: true }))

/**
 * The views of the main area; their names, buttons and palette rows are in the registry (views.tsx). `history` — the Run history of Flight Recorder
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

/** The icon of a View button, with its badge after the label (views.tsx). */
function ViewIcon({ button }: { button: ViewButton }) {
  const badge = button.useBadge()
  const { Icon } = button
  if (badge === undefined) return <Icon />
  // The wrapper of the icon lets the count out (acceptance.css places it): it follows the label, and with the label
  // hidden in a narrow window it stays next to the icon. Only Acceptance has a badge yet.
  return (
    <span className="w-acc-tab">
      <Icon />
      {badge.count !== undefined ? (
        <span className="w-acc-tab__count" data-testid={button.testId === undefined ? undefined : `${button.testId}-count`}>
          {badge.count}
        </span>
      ) : null}
    </span>
  )
}

function viewSegments(project: ToolbarProject | undefined): readonly SegmentOption<ShellView>[] {
  return VIEW_BUTTONS.map(({ id, button }) => {
    const inactive = button.needsProject !== undefined && project === undefined
    return {
      value: id,
      label: button.label,
      icon: <ViewIcon button={button} />,
      disabled: inactive,
      title: inactive ? button.needsProject : button.title,
      ...(button.testId === undefined ? {} : { testId: button.testId }),
    }
  })
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
        options={viewSegments(project)}
        value={view}
        // A press opens the view as its entry says (views.tsx): Runs at the newest Run through the Run history entry;
        // the others switch the shell's view.
        onChange={(next) => {
          const entry = VIEW_BUTTONS.find((each) => each.id === next)
          if (entry !== undefined) void openView(entry, project, onViewChange)
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
