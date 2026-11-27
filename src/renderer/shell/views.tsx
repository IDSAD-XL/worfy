// The registry of the views of the main area (worfy-layout ticket 01): one list for all eight ShellView values. The
// toolbar's View switch draws its six buttons from it (Toolbar.tsx), and the View rows of the Command palette are built
// from it (palette/commands.ts), so a view's name, icon, tooltip and what opens it are written here once.
// `story` (a Code story) and `changes` (the Changes of a Ticket) have no button: they open from their Ticket.
import type { ComponentType, ReactNode } from 'react'
import { openAcceptance } from '../acceptance/open'
import { useReadyCount } from '../acceptance/useAcceptance'
import { openRunHistory } from '../flight-recorder/open'
import { openPrInboxOf } from '../pr-inbox/open'
import { setView } from '../session/navigation'
import { setRunsTab } from '../work-track/store'
import type { RailBadge } from './sidebar-scope'
import type { ShellView } from './Toolbar'

/** The Project a View button opens its view for: the one the window shows. */
export interface ViewProject {
  id: string
}

/** What opening a view answers: a reason when it could not (the palette shows it), undefined when it did. */
export type ViewOpened = Promise<string | undefined> | undefined

/** The row of the Command palette that opens the view (group View). */
export interface ViewCommand {
  id: string
  title: string
  /** The row's second line while the view is not shown; while it is, the line says «shown now». */
  detail?: string
  keys?: readonly string[]
  /** What the row does when it does more than the View button: without it, the row opens the view as the button does. */
  open?: (project: ViewProject | undefined) => ViewOpened
}

/** A View button: a button that switches the main area to its view. */
export interface ViewButton {
  /** The text on the button, and its accessible name. */
  label: string
  /** The tooltip of the usable button. */
  title: string
  Icon: ComponentType
  /** Set when the view shows the open Project: the button is inactive without one, and this is its tooltip. */
  needsProject?: string
  /** A count or a dot on the button; `label` is what its tooltip and a screen reader say. */
  useBadge: () => RailBadge | undefined
  /**
   * What a press opens when it is more than the switch of the main area to the view (the switch is the default): Runs
   * opens the Run history at the newest Run. Pull requests and Acceptance switch, as their tabs did; their palette rows
   * ask their views a little more (ViewCommand.open).
   */
  open?: (project: ViewProject | undefined) => ViewOpened
  command: ViewCommand
  testId?: string
}

export interface ViewEntry {
  id: ShellView
  /** The name of the main area while it shows the view (its `aria-label`). */
  area: string
  button?: ViewButton
}

const noBadge = (): RailBadge | undefined => undefined

function useReadyBadge(): RailBadge | undefined {
  const ready = useReadyCount()
  return ready > 0 ? { tone: 'working', count: ready, label: ready === 1 ? '1 check ready to check' : `${ready} checks ready to check` } : undefined
}

function icon(paths: ReactNode): ComponentType {
  const Icon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  )
  return Icon
}

/** The eight views, the six with a button in the order of the toolbar. */
export const VIEWS: readonly ViewEntry[] = [
  {
    id: 'canvas',
    area: 'Canvas',
    button: {
      label: 'Canvas',
      title: 'Canvas',
      Icon: icon(
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </>,
      ),
      useBadge: noBadge,
      command: { id: 'view:canvas', title: 'Switch to Canvas' },
    },
  },
  {
    id: 'session',
    area: 'Session',
    button: {
      label: 'Session',
      title: 'Session view',
      Icon: icon(<path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />),
      useBadge: noBadge,
      command: { id: 'view:session', title: 'Switch to Session' },
    },
  },
  {
    // The board of the active Project: a column per Stage of its Pipeline (pipeline/PipelineBoard.tsx).
    id: 'pipeline',
    area: 'Pipeline',
    button: {
      label: 'Pipeline',
      title: 'Pipeline board',
      Icon: icon(
        <>
          <rect x="2" y="2.5" width="3.2" height="11" rx="1" />
          <rect x="6.4" y="2.5" width="3.2" height="7.5" rx="1" />
          <rect x="10.8" y="2.5" width="3.2" height="4.5" rx="1" />
        </>,
      ),
      useBadge: noBadge,
      command: { id: 'view:pipeline', title: 'Pipeline board', keys: ['pipeline', 'pipeline board', 'board', 'stages'] },
    },
  },
  {
    // The Run history of the active Project (flight-recorder/RunHistoryView.tsx): a clock face. The button opens it at
    // the newest Run and keeps the Project's choice of the Runs tab (Run history or Work track, worfy-work-track
    // ticket 13); the palette row always shows Run history.
    id: 'history',
    area: 'Run history',
    button: {
      label: 'Runs',
      title: 'Run history',
      Icon: icon(
        <>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.75V8l2.25 1.5" />
        </>,
      ),
      needsProject: 'Open a Project to see its Runs',
      useBadge: noBadge,
      open: (project) => {
        if (project !== undefined) void openRunHistory(project.id)
        return undefined
      },
      command: {
        id: 'open-run-history',
        title: 'Open Run history',
        detail: 'Autopilot Runs',
        keys: ['run history', 'autopilot runs', 'flight recorder', 'timeline'],
        open: (project) => {
          if (project === undefined) return undefined
          setRunsTab(project.id, 'history')
          void openRunHistory(project.id)
          return undefined
        },
      },
    },
  },
  {
    // The PR inbox of the active Project (pr-inbox/PrInboxView.tsx, worfy-pr-inbox ticket 03): a pull request's two
    // branches. It only reads GitHub, so a read-only screen has it too.
    id: 'pull-requests',
    area: 'Pull requests',
    button: {
      label: 'Pull requests',
      title: 'Pull requests of the open Project',
      Icon: icon(
        <>
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="12.5" r="1.5" />
          <path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
        </>,
      ),
      needsProject: 'Open a Project to see its pull requests',
      useBadge: noBadge,
      command: {
        id: 'view:pull-requests',
        title: 'Pull requests',
        detail: 'Open PRs and review requests',
        keys: ['pull requests', 'prs', 'pr inbox', 'review requests', 'reviews', 'github'],
        open: (project) => (project === undefined ? undefined : openPrInboxOf(project.id, project.id)),
      },
    },
  },
  {
    // The checks that wait for the owner in every Project (acceptance/AcceptanceView.tsx, worfy-acceptance ticket 05):
    // a checked box, with the count of Ready to check. It needs no open Project.
    id: 'acceptance',
    area: 'Acceptance',
    button: {
      label: 'Acceptance',
      title: 'Checks that wait for you',
      Icon: icon(
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M5.5 8.2l1.8 1.8 3.4-3.8" />
        </>,
      ),
      useBadge: useReadyBadge,
      command: {
        id: 'view:acceptance',
        title: 'Acceptance',
        detail: 'Checks that wait for you',
        keys: ['acceptance', 'owner checks', 'manual checks', 'checks that wait for you', 'pass', 'fail'],
        open: () => {
          openAcceptance()
          return undefined
        },
      },
      testId: 'acceptance-tab',
    },
  },
  { id: 'story', area: 'Code story' },
  { id: 'changes', area: 'Changes' },
]

/** The six views with a View button, in the order of the toolbar. */
export const VIEW_BUTTONS = VIEWS.filter((entry): entry is ViewEntry & { button: ViewButton } => entry.button !== undefined)

/**
 * Opens the view of a View button for the open Project. A button without an `open` of its own switches the main area
 * through `switchTo` — the shell's switch in the toolbar, the window's view (session/navigation.ts) elsewhere.
 */
export function openView(entry: ViewEntry & { button: ViewButton }, project: ViewProject | undefined, switchTo: (view: ShellView) => void = setView): ViewOpened {
  if (entry.button.needsProject !== undefined && project === undefined) return undefined
  if (entry.button.open !== undefined) return entry.button.open(project)
  switchTo(entry.id)
  return undefined
}
