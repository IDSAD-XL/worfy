// The toasts of the window (worfy-ui ticket 16): one component, mounted once in main.tsx, shows what
// the store holds (toasts.ts). It is drawn on <body>, above the Canvas, the Session view, focus mode
// and the Settings window (toast.css), at the right edge of the window. Its height in that column is
// measured, not fixed: while a toast is shown, the region finds what the user works with there —
// the toolbar, a view's header with its buttons (focus mode, a focused Ticket, the Session view, an
// ADR, an Epic frame on the Canvas), an open popup (the Command palette, Settings, a menu) — and puts the stack into the first
// free band from the top that holds it (placement.ts). An element marks itself with
// `data-toast-keep-out` (the toolbar, the headers, the Session's message field with Send); a dialog
// or a menu is kept clear of without a mark, unless it says `data-toast-over` (the ADR panel, a
// whole column high: only its header is kept clear). The minimap is kept clear of by its class:
// React Flow's MiniMap passes no other attribute to its element.
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
import { PLACE_MS, placeStack, type Span } from './placement'
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

/** What the stack keeps clear of (see the head of the file). */
const KEEP_OUT = '[data-toast-keep-out], [role="dialog"]:not([data-toast-over]), [role="menu"], .w-focus [data-node-header], .w-minimap'

/** Measures what lies in the column of `region` and moves the stack into the free band (placement.ts). */
function place(region: HTMLElement): void {
  const column = region.getBoundingClientRect()
  const blocked: Span[] = []
  for (const element of document.querySelectorAll(KEEP_OUT)) {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || rect.right <= column.left || rect.left >= column.right) continue
    blocked.push({ top: rect.top, bottom: rect.bottom })
  }
  const placement = placeStack(blocked, region.scrollHeight, window.innerHeight)
  const top = placement === null ? '' : `${placement.top}px`
  const cut = placement?.maxHeight ?? null
  if (region.style.top !== top) region.style.top = top
  region.style.maxHeight = cut === null ? '' : `${cut}px`
  region.style.overflowY = cut === null ? '' : 'auto'
}

/** The toasts of `projectId`, the active Project, and those of no Project. */
export function ToastRegion({ projectId }: { projectId: string | undefined }) {
  // Before paint: a toast of the Project just left never flashes on the new one.
  useLayoutEffect(() => setToastProject(projectId), [projectId])
  const shown = shownToasts(useStore(toasts))
  const alerts = shown.filter((toast) => toast.kind === 'error')
  const polite = shown.filter((toast) => toast.kind !== 'error')
  const region = useRef<HTMLElement>(null)
  // Placed before paint whenever the toasts change, then again every PLACE_MS and on a resize while
  // any is shown; with none shown nothing is measured.
  const any = shown.length > 0
  const lineup = shown.map((toast) => `${toast.id}:${toast.version}`).join(' ')
  useLayoutEffect(() => {
    const element = region.current
    if (!any || element === null) return
    const again = () => place(element)
    again()
    const timer = setInterval(again, PLACE_MS)
    window.addEventListener('resize', again)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', again)
    }
  }, [any, lineup])
  return createPortal(
    <section ref={region} className="w-toasts" aria-label="Notifications" data-testid="toasts">
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
