import type { CSSProperties } from 'react'
import type { HANDOFF_HEIGHT, HANDOFF_KIND, HANDOFF_WIDTH } from '../../../shared/ipc/docs'
import { useDocs, useDocText } from '../../docs/useDocs'
import { Markdown } from '../../markdown/Markdown'
import { activeProject, useProjects } from '../../projects/useProjects'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// The HANDOFF Node: the Project's HANDOFF.md (CONTEXT.md, «HANDOFF»), rendered as markdown and
// read-only. main creates it locked when the file exists and hides it while the file is gone
// (src/main/ipc/docs.ts); the text is read through `docs.read` and again whenever main reports a
// new version of the file, so an edit by hand or by an agent shows within a second.
//
// The Canvas shows the active Project only (src/renderer/main.tsx), so the Node reads that one.
// The kind and size are main's (src/shared/ipc/docs.ts); the registry (index.ts) needs them here
// as literals, and `satisfies` fails the typecheck the moment they differ.
export const kind = 'handoff' satisfies typeof HANDOFF_KIND
export const defaultWidth = 360 satisfies typeof HANDOFF_WIDTH
export const defaultHeight = 320 satisfies typeof HANDOFF_HEIGHT

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    flex: 'none',
    height: 36,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 10px 0 var(--space-3)',
    background: 'var(--surface-raised)',
    borderBottom: '1px solid var(--border)',
    cursor: 'grab',
  },
  icon: { display: 'inline-flex', color: 'var(--text-secondary)' },
  title: { fontSize: 'var(--text-15)', lineHeight: '18px', fontWeight: 600, color: 'var(--text)' },
  file: { fontSize: 'var(--text-11)', color: 'var(--text-muted)', marginRight: 'auto' },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 18,
    padding: '0 6px',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-chip)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-12)',
    fontWeight: 500,
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 14px 12px', fontSize: 'var(--text-12)', userSelect: 'text', cursor: 'text' },
  message: { margin: 0, fontSize: 'var(--text-12)', color: 'var(--text-muted)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

function DocumentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.75h5l3 3v9.5H4z" />
      <path d="M9 1.75v3h3M6 8h4M6 10.5h4" />
    </svg>
  )
}

export default function HandoffNode({ id, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const projectId = activeProject(useProjects())?.id
  const { state, error: openError } = useDocs(projectId)
  const handoff = state?.handoff ?? null
  const { text, error } = useDocText(projectId, handoff?.path, handoff?.version)

  let body
  if (text !== undefined) body = <Markdown text={text} projectId={projectId} />
  else if (error !== undefined || openError !== undefined) body = <p style={styles.message}>HANDOFF.md could not be read: {error ?? openError}</p>
  else if (state !== undefined && handoff === null) body = <p style={styles.message}>The Project has no HANDOFF.md</p>
  else body = null

  return (
    <article className="w-node-surface" style={styles.root} aria-label="HANDOFF.md" data-testid="handoff-node" data-node-id={id}>
      <NodeResizeClamp
        isVisible={selected}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div style={styles.header}>
        <span style={styles.icon}>
          <DocumentIcon />
        </span>
        <span style={styles.title}>HANDOFF</span>
        <span className="w-mono" style={styles.file}>
          HANDOFF.md
        </span>
        <span style={styles.pill}>markdown</span>
      </div>
      {/* nodrag: text can be selected instead of moving the Node. nowheel: once the Node is active
          (clicked), the wheel scrolls the text; before that it moves the Canvas (wheel-router.ts). */}
      <div className="nodrag nowheel" style={styles.body} data-testid="handoff-body" data-version={handoff?.version}>
        {body}
      </div>
    </article>
  )
}
