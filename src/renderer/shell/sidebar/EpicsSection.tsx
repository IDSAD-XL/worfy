import type { CSSProperties } from 'react'
import { focusEpic } from '../../canvas/sources/epics'
import { progressOf } from '../../canvas/epic-layout'
import { activeProject, useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import '../../canvas/epic-frame.css'

/**
 * The Epics of the active Project, under its Projects (design F). A row has two lines, as in the F
 * mockups: the Epic's whole name, wrapped when it is long, then its progress.
 */
export const order = 20

const styles = {
  header: { display: 'flex', alignItems: 'center', height: 24, padding: '0 8px' },
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
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
    cursor: 'pointer',
  },
  name: { display: 'block', fontSize: 'var(--text-12)', lineHeight: '16px', fontWeight: 600, overflowWrap: 'anywhere' },
  progress: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  count: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  working: { marginLeft: 'auto', fontSize: 'var(--text-11)', color: 'var(--working-text)' },
} satisfies Record<string, CSSProperties>

export default function EpicsSection() {
  const project = activeProject(useProjects())
  const { model, error } = useWorkflow(project?.path)
  if (!project) return null

  let body
  if (error !== undefined) body = <p style={styles.message}>The epics could not be read: {error}</p>
  else if (model === undefined) body = null
  else if (model.error !== null) body = <p style={styles.message}>{model.error.message}</p>
  else if (!model.epics.length) body = <p style={styles.message}>No epics in .scratch/</p>
  else
    body = (
      <ul style={styles.list}>
        {model.epics.map((epic) => {
          const progress = progressOf(model.tickets.filter((ticket) => ticket.epic === epic.epic))
          return (
            <li key={epic.epic}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                data-testid="sidebar-epic"
                data-epic={epic.epic}
                title={epic.title ?? epic.epic}
                onClick={() => focusEpic(project.id, epic.epic)}
              >
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
                  {progress.working ? (
                    <span style={styles.working} aria-label={`${progress.working} in work`}>
                      {progress.working} in work
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )

  return (
    <section aria-label="Epics">
      <div style={styles.header}>
        <h2 style={styles.heading}>Epics</h2>
      </div>
      {body}
    </section>
  )
}
