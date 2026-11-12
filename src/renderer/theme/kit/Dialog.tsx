/**
 * The modal window of the kit (worfy-ui-kit ticket 04, ADR-0106): Base UI's Dialog for the behaviour,
 * worfy's classes for the look. Settings, Keyboard shortcuts and the worfy Guide are drawn in it; the
 * other modal windows move onto it in tickets 05–08.
 *
 * What a window gets here:
 * - the role `dialog` with `aria-modal`, its name from `label` or from the element `labelledBy` names;
 * - Base UI's focus trap: Tab and Shift+Tab go round the window's controls; the page behind is hidden
 *   from a screen reader and a press on it does not reach it;
 * - the focus goes into the window on opening (`initialFocus`, else the window itself) and back to
 *   what had it before on closing, if that is still on the page;
 * - Esc closes the window and is marked handled (theme/kit/layer.ts): a layer above it (the open list
 *   of a Select, a menu of the kit) closes on its Esc first, and the window stays;
 * - a press on the backdrop closes it, unless `closeOnBackdrop` is false; a press on the toasts
 *   (toast/ToastRegion.tsx, above the window's layer) neither closes it nor is hidden from a screen
 *   reader: Base UI closes a modal window only on a press on its own backdrop, and leaves a live
 *   region (`aria-live`) visible;
 * - the layer of the scale (theme/layers.ts) on the portal;
 * - the list of a Select inside the window is drawn into the window (theme/Select.tsx), so the trap,
 *   the hiding and the press outside count it as part of the window (spike, step 3);
 * - it stays open when the app window loses the focus and when the view of the shell switches.
 *
 * The keys of the app. Its shortcuts listen on `window` (⌘K, ⌘F, ⌘↩ of focus mode, Esc of focus mode,
 * the Canvas's keys), some of them in the capture phase, where a handler on the window itself cannot
 * stop them. So while a window of the kit is open, the listeners at the end of this file — added when
 * the file loads, before every listener a component adds — keep them quiet: a ⌘ or Ctrl key pressed
 * in the window reaches no listener of the app (what the key does itself — copy, paste — still
 * happens, and so do the accelerators of the app menu); any other key goes to the window's own
 * controls and stops at `document`; a key pressed with the focus outside the window (it fell to the
 * page) reaches nothing behind: Esc closes the window, Tab brings the focus into it. A layer drawn
 * above the window keeps its keys. These listeners never move the focus while it is inside the
 * window: the trap is Base UI's alone.
 */
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { LAYERS } from '../layers'
import { KIT_POPUP_ATTRIBUTE } from '../open-layers'
import { SelectListContainer } from '../select-container'
import './dialog.css'
import { layerStyle, useKitLayer, type LayerName } from './layer'

/** The mark of a window of the kit, besides the mark of a kit popup every window carries too. */
export const KIT_DIALOG_ATTRIBUTE = 'data-kit-dialog'

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'title' | 'aria-label' | 'aria-labelledby' | 'aria-modal'> {
  open: boolean
  /** Closes the window: Esc, a press on the backdrop, and Base UI asking for it. */
  onClose: () => void
  /** The accessible name of the window, when no element of it holds the name. */
  label?: string
  /** The id of the element that names the window: its title. */
  labelledBy?: string
  /** The class of the window itself. */
  className: string
  /** A class of the window's own for the backdrop, besides the kit's. */
  backdropClassName?: string
  /** The `data-testid` of the backdrop. */
  backdropTestId?: string
  /** Whether a press on the backdrop closes the window; true by default. */
  closeOnBackdrop?: boolean
  /** The element the focus goes to on opening; the window itself when it gives none. */
  initialFocus?: (window: HTMLElement) => HTMLElement | null | undefined
  /** The layer of the scale; `dialog` by default. */
  layer?: LayerName
  children: ReactNode
}

/** A modal window of the kit; see the head of the file. */
export function Dialog(props: DialogProps) {
  const { open, onClose, label, labelledBy, className, backdropClassName, backdropTestId, closeOnBackdrop = true, initialFocus, layer = 'dialog', children, onKeyDown, ...rest } = props
  const [popup, setPopup] = useState<HTMLDivElement | null>(null)
  const kit = useKitLayer({ open, close: onClose, modal: true })
  const closeNow = useEffectEvent(onClose)
  const firstFocus = useEffectEvent((element: HTMLElement): HTMLElement => initialFocus?.(element) ?? element)

  // What had the focus before the window opened: it gets it back on closing. Read in a layout effect,
  // before the focus moves into the window; given back in a passive one, after the commit that
  // closes: Base UI keeps the closing window in the DOM for that commit, and React gives the focus
  // back to the element that had it when the commit began — the window — at its end.
  const previous = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [open])
  useEffect(() => {
    if (!open) return
    return () => {
      const back = previous.current
      previous.current = null
      if (back?.isConnected === true) back.focus()
    }
  }, [open])

  // Base UI draws the window into its portal a render after `open`: the window is known here then.
  useLayoutEffect(() => {
    if (!open || popup === null) return
    const shown: OpenDialog = { element: popup, close: () => closeNow(), layer: LAYERS[layer] }
    openDialogs.push(shown)
    firstFocus(popup).focus()
    return () => {
      openDialogs.splice(openDialogs.indexOf(shown), 1)
    }
  }, [open, popup, layer])

  // Esc and the backdrop are the kit's alone. Base UI would also close on an Esc anywhere on the page —
  // one a layer above the window took for itself (a form over Settings) included — and on a press on
  // its own backdrop, which the window's backdrop below covers. The kit takes Esc in the window
  // (theme/kit/layer.ts) and on the page (the listeners at the end of this file), and a press on the
  // backdrop on mousedown, as the windows always did: Base UI's ask is turned down and the key goes on.
  const onOpenChange = useCallback(
    (next: boolean, details: BaseDialog.Root.ChangeEventDetails) => {
      if (next) return
      if (details.reason === 'escape-key' || details.reason === 'outside-press') {
        details.cancel()
        details.allowPropagation()
        return
      }
      onClose()
    },
    [onClose],
  )

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    kit.popup.onKeyDown(event)
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} modal>
      <BaseDialog.Portal style={layerStyle(layer)}>
        <div
          className={backdropClassName === undefined ? 'w-kit-dialog__backdrop' : `w-kit-dialog__backdrop ${backdropClassName}`}
          data-testid={backdropTestId}
          // A press on the backdrop does not take the focus out of the window first.
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            if (closeOnBackdrop) onClose()
          }}
        >
          <BaseDialog.Popup
            {...rest}
            {...kit.popup}
            ref={setPopup}
            className={className}
            aria-modal="true"
            aria-label={label}
            aria-labelledby={labelledBy}
            onKeyDown={onPopupKeyDown}
            // The focus is moved here, in the layout effect above: at once, not a frame later.
            initialFocus={false}
            finalFocus={false}
            {...{ [KIT_DIALOG_ATTRIBUTE]: '' }}
          >
            <SelectListContainer value={popup}>{children}</SelectListContainer>
          </BaseDialog.Popup>
        </div>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

// The keys of the app while a window of the kit is open (see the head of the file).

interface OpenDialog {
  element: HTMLElement
  close: () => void
  /** The z-index of the window's layer. */
  layer: number
}

/** The windows of the kit on screen, in the order they opened: the last one is on top. */
const openDialogs: OpenDialog[] = []

function topDialog(): OpenDialog | undefined {
  const top = openDialogs.at(-1)
  return top?.element.isConnected === true ? top : undefined
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** The z-index of the layer `element` is in: of its ancestor right under `body`; NaN without one. */
function zIndexOf(element: Element): number {
  let layer = element
  while (layer.parentElement !== null && layer.parentElement !== document.body) layer = layer.parentElement
  if (layer.parentElement !== document.body) return Number.NaN
  return Number.parseInt(getComputedStyle(layer).zIndex, 10)
}

/**
 * Whether `target` lies in a layer above `dialog`: a popup of the kit that is not a window (a menu, a
 * popover), or a layer on <body> with a higher z-index (a form a section of Settings opens over it, a
 * toast). Such a layer keeps its keys.
 */
function above(target: EventTarget | null, dialog: OpenDialog): boolean {
  if (!(target instanceof Element) || dialog.element.contains(target)) return false
  const popup = target.closest(`[${KIT_POPUP_ATTRIBUTE}]`)
  if (popup !== null && !popup.hasAttribute(KIT_DIALOG_ATTRIBUTE)) return true
  return zIndexOf(target) > dialog.layer
}

/** On `window`, capture phase, added when this file loads: before every listener a component adds. */
function guardKeys(event: globalThis.KeyboardEvent): void {
  const dialog = topDialog()
  if (dialog === undefined) return
  const target = event.target
  if (target instanceof Node && dialog.element.contains(target)) {
    // Some of the app's shortcuts listen in the capture phase on `window` (⌘↩ of focus mode), so
    // they are stopped here; only propagation stops, not what the key itself does.
    if (event.metaKey || event.ctrlKey) event.stopImmediatePropagation()
    return
  }
  if (above(target, dialog)) return
  // The focus fell out of the window, to the page: the key is the window's or nobody's.
  event.stopImmediatePropagation()
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    dialog.close()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const focusable = [...dialog.element.querySelectorAll<HTMLElement>(FOCUSABLE)]
    ;((event.shiftKey ? focusable.at(-1) : focusable[0]) ?? dialog.element).focus()
  }
}

/** On `document`, bubble phase, added when this file loads: before the listeners on `window`. */
function stopKeysAtDocument(event: globalThis.KeyboardEvent): void {
  const dialog = topDialog()
  if (dialog === undefined || above(event.target, dialog)) return
  event.stopImmediatePropagation()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('keydown', guardKeys, true)
  document.addEventListener('keydown', stopKeysAtDocument)
}
