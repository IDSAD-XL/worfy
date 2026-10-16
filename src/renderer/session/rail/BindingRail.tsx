import type { CSSProperties } from 'react'
import { bindingReason, bindingTargetLabel, bindingWorkflowOf, resolveBinding, type Binding } from '../../../shared/binding/resolve'
import { bindingTargetTitle, launchOf, manualOf, removeManualBinding, useManualBindings, useSessionSignals } from '../../binding/store'
import { useLayout } from '../../canvas/useLayout'
import { focusEpic } from '../../canvas/sources/epics'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { setView } from '../navigation'
import type { RailBlockProps } from './index'

// The Binding in the Session rail (ticket 16): what the Session is bound to — a Ticket or an Epic,
// with its title — and why: «branch worfy-mvp/07», «ticket claim», «/epic-wave», «manual». A
// Binding made by hand can be removed here, as from the Node's menu on the Canvas; the automatic
// one then applies again. "Show on Canvas" centers the Canvas on the Epic's frame.

// First in the rail: before the Subagents (20).
export const order = 10

const styles = {
  header: { height: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  link: { padding: 0, border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 'var(--text-11)', cursor: 'pointer' },
  card: { marginTop: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-node)', background: 'var(--surface)' },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  target: { fontSize: 'var(--text-12)', fontWeight: 600 },
  kind: { marginLeft: 'auto', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  title: { marginTop: 4, fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  reason: { marginTop: 6, fontSize: 'var(--text-11)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  remove: {
    marginTop: 8,
    padding: '1px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>

export interface BindingCardProps {
  binding: Binding | null
  /** The Ticket's or the Epic's title, when the workflow model has one. */
  title: string | null
  onShow?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}

/** The block for a Binding; exported for tests, which pass their own. */
export function BindingCard({ binding, title, onShow, onRemove }: BindingCardProps) {
  return (
    <div data-testid="binding-rail">
      <div style={styles.header}>
        <h2 style={styles.heading}>Binding</h2>
        {binding && onShow ? (
          <button type="button" style={styles.link} onClick={onShow}>
            Show on Canvas
          </button>
        ) : null}
      </div>
      <div style={styles.card}>
        {binding === null ? (
          <span style={styles.empty} data-testid="binding-none">
            Not bound. Drop the Session's Node on a Ticket or an Epic frame to bind it.
          </span>
        ) : (
          <>
            <div style={styles.row}>
              <span className="w-mono" style={styles.target} data-testid="binding-target">
                {bindingTargetLabel(binding.target)}
              </span>
              <span style={styles.kind}>{binding.target.kind === 'ticket' ? 'Ticket' : 'Epic'}</span>
            </div>
            {title ? <div style={styles.title}>{title}</div> : null}
            <div className="w-mono" style={styles.reason} title={binding.detail ?? undefined} data-testid="binding-reason" data-source={binding.source}>
              {bindingReason(binding)}
            </div>
            {binding.source === 'manual' && onRemove ? (
              <button type="button" style={styles.remove} onClick={onRemove} data-testid="binding-remove">
                Remove binding
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export default function BindingRail({ projectId, nodeId, sessionId, claudeSessionId }: RailBlockProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const node = useLayout(projectId).state?.layout.nodes.find((each) => each.id === nodeId)
  const fromNode = typeof node?.data.sessionId === 'string' ? node.data.sessionId : null
  // The id that names the Session's transcript: Claude Code's, once known.
  const session = claudeSessionId ?? fromNode ?? sessionId
  const manual = useManualBindings(projectId)
  const signals = useSessionSignals(root, session === null ? [] : [session])
  const { model } = useWorkflow(root)
  const agent = session === null ? null : { sessionId: session, agentId: null }
  const binding =
    agent === null ? null : resolveBinding(
          { manual: manualOf(manual, agent)?.target, launch: launchOf(manual, agent)?.target, signals: signals.get(agent.sessionId)?.session },
          bindingWorkflowOf(model),
        )
  return (
    <BindingCard
      binding={binding}
      title={bindingTargetTitle(binding, model)}
      onShow={
        binding
          ? () => {
              setView('canvas')
              focusEpic(projectId, binding.target.epic)
            }
          : undefined
      }
      onRemove={
        agent
          ? () =>
              void removeManualBinding(projectId, agent).then((error) => {
                if (error !== undefined) console.error('bindings.remove failed:', error)
              })
          : undefined
      }
    />
  )
}

