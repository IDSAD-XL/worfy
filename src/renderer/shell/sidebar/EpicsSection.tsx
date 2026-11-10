import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { ProjectView } from '../../../shared/ipc/projects'
import { epicsOlderAfterOf } from '../../../shared/settings/app-settings'
import { focusEpic } from '../../canvas/sources/epics'
import { progressOf } from '../../canvas/epic-layout'
import { useNow } from '../../limits/useLimits'
import { ageText } from '../../pr-inbox/usePrInbox'
import { readableReason, windowMachine } from '../../ipc'
import { activeProject, openProject, useProjects } from '../../projects/useProjects'
import { setAppSettings, useAppSettings } from '../../settings/useAppSettings'
import { useWorkflow } from '../../workflow/useWorkflow'
import { projectsInScope, useSidebarScope } from '../sidebar-scope'
import { NoProjectSection, SidebarSection } from '../SidebarSection'
import { arrangeEpics, olderFoldKey, type EpicRow } from './epics-order'
import '../../canvas/epic-frame.css'

/**
 * The Epics of the Projects the Project switcher shows (worfy-polish ticket 94, sidebar-scope.ts): the
 * open Project's, or — under «All» with more than one Project — the open Project's first and then those
 * of every other Project of the window's Machine that has Epics, each under its name. A click centres
 * the Epic on the Canvas, after opening its Project when it is another one. A row has two lines, as in
 * the F mockups: the Epic's whole name, wrapped when it is long, then its progress and how long ago its
 * last work was.
 *
 * Order and the «Older» group (worfy-polish ticket 98, epics-order.ts): Epics with a Ticket in work
 * first, then the rest by last work, newest first. An Epic with no work for the threshold of Settings →
 * General (`epicsOlderAfter`, 7 days by default) and no Ticket in work goes into «Older · N» at the
 * bottom, folded until a click opens it. The fold is kept per Project in `sidebar.collapsed` of the app
 * settings, as the sections' own folds are (olderFoldKey).
 */
export const order = 20
export const railTitle = 'Epics'

export function RailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 14V2.5M3 3h8.5l-1.8 2.7L11.5 8.5H3" />
    </svg>
  )
}

const styles = {
  list: { margin: 0, padding: 0, listStyle: 'none' },
  project: { padding: '6px 8px 2px', fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'block',
    width: '100%',
    height: 'auto',
    minHeight: 'var(--row-height)',
    padding: '5px 8px 6px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
  },
  name: { display: 'block', fontSize: 'var(--text-12)', lineHeight: '16px', fontWeight: 600, overflowWrap: 'anywhere' },
  progress: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  count: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  age: { fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  working: { marginLeft: 'auto', fontSize: 'var(--text-11)', color: 'var(--working-text)' },
  older: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    minHeight: 'var(--row-height)',
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    textAlign: 'left',
  },
} satisfies Record<string, CSSProperties>

/**
 * How long a read must run before "Reading epics…" shows. The first read of an app run waits for
 * the login shell's environment, up to 10 s; every later one answers in about 25 ms, and a row
 * shown for that long only flickers on each opening of a Project.
 */
export const READING_ROW_DELAY_MS = 300

/**
 * True once `reading` has stayed true for READING_ROW_DELAY_MS; false again as soon as it is not.
 * A switch from one Project being read to another keeps it as it is: the section is still reading.
 */
function useReadingRow(reading: boolean): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!reading) return
    const timer = setTimeout(() => setShown(true), READING_ROW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [reading])
  return reading && shown
}

const chevron = (folded: boolean) => (
  <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* Right while folded, down while open: the chevron of the section headers. */}
    <path d={folded ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'} />
  </svg>
)

/**
 * Whether the «Older» group of Project `projectId` is folded, and the click that turns it: folded until
 * the person opens it. As in SidebarSection, a click shows at once, and a refused write leaves it so in
 * this window only.
 */
function useOlderFold(projectId: string | undefined): [boolean, () => void] {
  const key = projectId === undefined ? undefined : olderFoldKey(projectId)
  const saved = useAppSettings((settings) => (key === undefined ? undefined : settings.sidebar.collapsed[key]))
  const [clicked, setClicked] = useState<{ key: string; folded: boolean } | null>(null)
  const clicks = useRef(0)
  const folded = (clicked !== null && clicked.key === key ? clicked.folded : saved) ?? true
  const toggle = (): void => {
    if (key === undefined) return
    const next = !folded
    const click = ++clicks.current
    setClicked({ key, folded: next })
    void setAppSettings({ sidebar: { collapsed: { [key]: next } } }).then((refused) => {
      if (click !== clicks.current) return
      if (refused === undefined) setClicked(null)
      else console.error(`appSettings.set failed, the older Epics stay ${next ? 'folded' : 'open'} in this window only:`, refused)
    })
  }
  return [folded, toggle]
}

function EpicButton({ row, now, onFocus }: { row: EpicRow; now: number; onFocus: () => void }) {
  const { epic, tickets, lastWork } = row
  const progress = progressOf(tickets)
  const when = lastWork === null ? null : new Date(lastWork)
  return (
    <button type="button" className="w-row" style={styles.row} data-testid="sidebar-epic" data-epic={epic.epic} title={epic.title ?? epic.epic} onClick={onFocus}>
      <span className="w-mono" style={styles.name}>
        {epic.epic}
      </span>
      <span style={styles.progress}>
        <span className="w-progress" role="img" aria-label={`Progress: ${progress.done} of ${progress.total} done`}>
          {progress.segments.map((state, index) => (
            <span key={index} className={`w-progress__segment w-progress__segment--${state}`} style={{ width: 4, height: 8 }} />
          ))}
        </span>
        <span className="w-mono" style={styles.count}>
          {progress.done}/{progress.total}
        </span>
        {when === null ? null : (
          <span className="w-mono" style={styles.age} title={`Last work ${when.toLocaleString()}`} data-testid="sidebar-epic-age">
            {ageText(when.toISOString(), now)}
          </span>
        )}
        {progress.working ? (
          <span style={styles.working} aria-label={`${progress.working} in work`}>
            {progress.working} in work
          </span>
        ) : null}
      </span>
    </button>
  )
}

interface ProjectEpicsProps {
  project: ProjectView
  /** The open Project: its messages (reading, an error, no Epics) show; another Project without Epics shows nothing. */
  active: boolean
  /** Under «All» with more than one Project: the Project's name above its Epics. */
  named: boolean
  onFocus: (project: ProjectView, epic: string) => void
}

/** One Project's Epics: the order, the age and the «Older» fold of polish 98, per Project. */
function ProjectEpics({ project, active, named, onFocus }: ProjectEpicsProps) {
  const { model, error } = useWorkflow(project.path)
  const readingRow = useReadingRow(model === undefined && error === undefined)
  const after = useAppSettings(epicsOlderAfterOf)
  const now = useNow()
  const [folded, toggleOlder] = useOlderFold(project.id)
  const olderId = useId()

  // The message stands in a live region that is always there, so a screen reader announces
  // "Reading epics…" and whatever replaces it; the list itself is not announced.
  let message: string | null = null
  let list = null
  if (error !== undefined) message = `The epics could not be read: ${error}`
  else if (model === undefined) message = readingRow ? 'Reading epics…' : null
  else if (model.error !== null) message = model.error.message
  else if (!model.epics.length) message = 'No epics in .scratch/'
  else {
    const { recent, older } = arrangeEpics(model.epics, model.tickets, now, after)
    const item = (row: EpicRow) => (
      <li key={row.epic.epic}>
        <EpicButton row={row} now={now} onFocus={() => onFocus(project, row.epic.epic)} />
      </li>
    )
    list = (
      <>
        <ul style={styles.list}>{recent.map(item)}</ul>
        {older.length ? (
          <>
            <button type="button" className="w-row" style={styles.older} aria-expanded={!folded} aria-controls={olderId} onClick={toggleOlder} data-testid="sidebar-epics-older">
              {chevron(folded)}
              <span>Older · {older.length}</span>
            </button>
            <ul id={olderId} style={styles.list} hidden={folded} data-testid="sidebar-epics-older-list">
              {folded ? null : older.map(item)}
            </ul>
          </>
        ) : null}
      </>
    )
  }
  if (!active && list === null) return null

  return (
    <div data-testid="sidebar-epics-project" data-project={project.id}>
      {named ? (
        <div style={styles.project} title={project.path}>
          {project.name}
        </div>
      ) : null}
      {active ? <div role="status">{message === null ? null : <p style={styles.message}>{message}</p>}</div> : null}
      {list}
    </div>
  )
}

export default function EpicsSection() {
  const state = useProjects()
  const project = activeProject(state)
  const scope = useSidebarScope((store) => store.scope)
  const [failure, setFailure] = useState<string | null>(null)
  const onFocus = useCallback(
    (of: ProjectView, epic: string) => {
      setFailure(null)
      if (of.id === project?.id) {
        focusEpic(of.id, epic)
        return
      }
      // The Canvas of the other Project takes the request once it shows (canvas/sources/epics.ts).
      void openProject(windowMachine(), of.id).then((refused) => {
        if (refused === undefined) focusEpic(of.id, epic)
        else setFailure(`${of.name} could not be opened: ${readableReason(refused)}`)
      })
    },
    [project?.id],
  )
  if (!project) return <NoProjectSection id="EpicsSection" title="Epics" what="Epics" />

  // The open Project first, then the others in the order of the Projects section.
  const shown = projectsInScope(state?.projects ?? [], scope, project.id)
  const projects = [project, ...shown.filter((each) => each.id !== project.id)]
  const named = projects.length > 1

  return (
    <SidebarSection id="EpicsSection" title="Epics" scope="filtered" notice={failure === null ? null : <p style={styles.message} role="alert">{failure}</p>}>
      {projects.map((each) => (
        // The open Project's block keeps its key across a switch: "Reading epics…" stays without a gap
        // when the next Project is still being read (useReadingRow).
        <ProjectEpics key={each.id === project.id ? '' : each.id} project={each} active={each.id === project.id} named={named} onFocus={onFocus} />
      ))}
    </SidebarSection>
  )
}
