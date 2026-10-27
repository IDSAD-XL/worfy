// The loading line of a Project's Canvas (worfy-link ticket 33): while the Project opens, a line at
// the bottom centre says how far the loading is — "Loading workflow… · Laying out Epics 7/20 ·
// Reading Sessions history…". A Project of a Linked machine takes seconds to open over the link,
// and its Canvas used to stay empty all that time. What each part counts: loading-steps.ts.
//
// Canvas.tsx draws it beside the Canvas, not as an overlay inside React Flow: the line is there
// before `layout.get` and the camera have answered, when React Flow is not, and stays the same
// component when React Flow comes. An overlay would be a second component, and the hand-over
// from the first would let go of the workflow and the Sessions of the Project for a moment —
// `workflow.close` and a second `workflow.open` when no other view holds them.
//
// In a window on this Machine the line shows only after SHOW_AFTER_MS, so a small Project opens
// without a flash of it; in a window on a Linked machine it shows at once. It goes once every part
// has been done for SETTLE_MS — the ELK requests go out only after the workflow's Epic frames are
// built — and does not come back while the Canvas stays open.
//
// The line itself is hidden from screen readers: the counter would be read at each step. A
// status region says "Loading the project" when the line shows and "Project loaded" at its end.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { windowMachine } from '../ipc'
import { loadingParts, SETTLE_MS, SHOW_AFTER_MS, useLoadingSteps } from './loading-steps'

const PLACE: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 15,
  zIndex: 5,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
}

const LINE: CSSProperties = {
  maxWidth: 'min(640px, calc(100vw - 48px))',
  padding: 'var(--space-1) var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-control)',
  color: 'var(--text)',
  font: 'var(--text-12) / 18px var(--font-ui)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const DONE_PART: CSSProperties = { color: 'var(--text-secondary)' }

/** Read by screen readers only. */
const SCREEN_READER_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

interface LineProps {
  projectId: string
  canvas: boolean
  visible: boolean
  onDone: () => void
}

/** The line itself; `onDone` is called once every part has stayed done for SETTLE_MS. */
function Line({ projectId, canvas, visible, onDone }: LineProps) {
  const steps = useLoadingSteps(projectId, canvas)
  useEffect(() => {
    if (!steps.done) return
    const timer = setTimeout(onDone, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [steps.done, onDone])
  // Shown while something still loads; a line that would first show with everything done (the
  // threshold passed during SETTLE_MS) stays away, so it does not flash just before its end.
  const [seen, setSeen] = useState(false)
  if (visible && !steps.done && !seen) setSeen(true)
  if (!visible || (steps.done && !seen)) return null
  return (
    <div style={PLACE}>
      <div style={LINE} data-testid="canvas-loading" aria-hidden="true">
        {loadingParts(steps).map((part, at) => (
          <span key={part.id}>
            {at > 0 ? ' · ' : null}
            <span data-testid={`canvas-loading-${part.id}`} data-done={part.done ? 'true' : 'false'} style={part.done ? DONE_PART : undefined}>
              {part.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Whether the line may show yet: at once on a Linked machine, after SHOW_AFTER_MS on this Machine. */
function useShowDelay(startedAt: number): boolean {
  const delay = windowMachine() === null ? SHOW_AFTER_MS : 0
  const [shown, setShown] = useState(() => Date.now() >= startedAt + delay)
  useEffect(() => {
    if (shown) return
    const timer = setTimeout(() => setShown(true), Math.max(0, startedAt + delay - Date.now()))
    return () => clearTimeout(timer)
  }, [shown, startedAt, delay])
  return shown
}

export interface LoadingProgressProps {
  projectId: string
  /** When the Canvas began to open (Date.now()). */
  startedAt: number
  /** React Flow is there: `layout.get` and the camera have answered. */
  canvas: boolean
}

/** The loading line of the Canvas of `projectId`, from the start of its opening until it is done. */
export function LoadingProgress({ projectId, startedAt, canvas }: LoadingProgressProps) {
  const shown = useShowDelay(startedAt)
  // Whether the line had shown when the opening ended: an end nobody saw begin is not announced.
  const [finished, setFinished] = useState<{ shown: boolean } | undefined>()
  const onDone = useCallback(() => setFinished({ shown }), [shown])
  const status = finished === undefined ? (shown ? 'Loading the project' : '') : finished.shown ? 'Project loaded' : ''
  return (
    <>
      {finished !== undefined ? null : <Line projectId={projectId} canvas={canvas} visible={shown} onDone={onDone} />}
      <div role="status" aria-live="polite" style={SCREEN_READER_ONLY} data-testid="canvas-loading-status">
        {status}
      </div>
    </>
  )
}
