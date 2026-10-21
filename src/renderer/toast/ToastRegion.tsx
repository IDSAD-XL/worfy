// The toasts of the window (worfy-ui ticket 16): one component, mounted once in main.tsx, shows what
// the store holds (toasts.ts). It is drawn on <body>, above the Canvas, the Session view, focus mode
// and the Settings window (toast.css), in the top right corner below the toolbar and the headers
// under it: away from the Command palette and Canvas find at the top centre, and from the Session's
// message field with Send and the Minimap at the bottom.
//
// Accessibility: the area is a landmark "Notifications"; `info`, `success` and `action` toasts are in
// a polite live region (role="status"), `error` toasts in role="alert". Both regions stay in the DOM
// while empty, so a toast added later is announced. A toast never takes the focus; its buttons are
// reached by Tab, and Escape on a toast in focus closes it and gives the focus back to where it was.
//
// The file is not named Toasts.tsx: next to toasts.ts, on a file system that ignores case (macOS,
// Windows), `./toasts` and `./Toasts` resolve to the same file.
import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import './toast.css'
import { dismissToast, holdToast, pressToastAction, setToastProject, shownToasts, toasts, type Toast } from './toasts'

function ToastView({ toast }: { toast: Toast }) {
  const { id } = toast
  // Where the keyboard focus was before it came onto this toast: it goes back there when the toast
  // closes under it, rather than to <body>.
  const before = useRef<HTMLElement | null>(null)
  const self = useRef<HTMLDivElement>(null)
  // A toast can leave the screen without a mouseleave or a blur (a switch of Project, a key shown
  // again as another kind): its pause goes with it, or its time would never run again.
  useEffect(
    () => () => {
      holdToast(id, 'hover', false)
      holdToast(id, 'focus', false)
    },
    [id],
  )
  const enterFocus = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) before.current = from
    holdToast(id, 'focus', true)
  }
  const leaveFocus = (event: FocusEvent<HTMLDivElement>) => {
    // The focus moving between the toast's own buttons does not leave it.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    holdToast(id, 'focus', false)
  }
  /**
   * Gives the focus back to where it was, if it is on the toast, and then runs `close`, which takes the
   * toast down. Back first: React removes the toast only after the handler, and an action's handler
   * may still move the focus where it wants.
   */
  const closing = (close: () => void) => {
    const back = before.current
    if (self.current?.contains(document.activeElement) === true && back !== null && back.isConnected) back.focus()
    close()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closing(() => dismissToast(id))
  }
  return (
    <div
      ref={self}
      className={`w-toast w-toast--${toast.kind}`}
      data-kind={toast.kind}
      data-testid={toast.testId}
      onMouseEnter={() => holdToast(id, 'hover', true)}
      onMouseLeave={() => holdToast(id, 'hover', false)}
      onFocus={enterFocus}
      onBlur={leaveFocus}
      onKeyDown={onKeyDown}
    >
      {/* A new version remounts only the text: it is announced again, and the focus stays on the buttons. */}
      <span key={toast.version} className="w-toast__text" title={toast.text}>
        {toast.text}
      </span>
      {toast.actions?.map((action, index) => (
        <button key={index} type="button" className="w-toast__action" onClick={() => closing(() => pressToastAction(id, index))}>
          {action.label}
        </button>
      ))}
      <button type="button" className="w-toast__close" aria-label="Dismiss" title="Dismiss (Esc)" onClick={() => closing(() => dismissToast(id))}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** The toasts of `projectId`, the active Project, and those of no Project. */
export function ToastRegion({ projectId }: { projectId: string | undefined }) {
  // Before paint: a toast of the Project just left never flashes on the new one.
  useLayoutEffect(() => setToastProject(projectId), [projectId])
  const shown = shownToasts(useStore(toasts))
  const alerts = shown.filter((toast) => toast.kind === 'error')
  const polite = shown.filter((toast) => toast.kind !== 'error')
  return createPortal(
    <section className="w-toasts" aria-label="Notifications" data-testid="toasts">
      <div role="alert" className="w-toasts__list">
        {alerts.map((toast) => (
          <ToastView key={toast.id} toast={toast} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="w-toasts__list">
        {polite.map((toast) => (
          <ToastView key={toast.id} toast={toast} />
        ))}
      </div>
    </section>,
    document.body,
  )
}
