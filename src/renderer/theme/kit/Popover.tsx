/**
 * The kit's Popover (worfy-ui-kit ticket 09, ADR-0106): a non-modal popup with a name, opened by its
 * trigger. Base UI gives the behaviour:
 * - the popup is a `dialog` named by `label`; the trigger gets `aria-expanded` and `aria-haspopup`;
 * - opening moves the focus into the popup, closing gives it back to the trigger;
 * - a press outside closes it, but a press on the toasts does not: they are not what the user works
 *   with in the popup (toast/ToastRegion.tsx);
 * - the focus going to anything else of the window closes it too (the wrapper's own listener, ticket 10);
 * - the popup sits next to its trigger and flips to the other side or slides along the edge where
 *   the window has no room for it.
 * The shared part (layer.ts) adds the rest: Esc closes only this popup and is marked handled, a blur
 * of the window (a press inside a Browser Node's <webview>) and a switch of the view close it, the
 * layer comes from the scale, and a popup of a Node on the Canvas carries the in-node mark.
 *
 * A popover without a trigger (worfy-ui-kit ticket 10) is opened by its place alone and placed against
 * its `anchor`: an element (the version chip of What's new) or a box on the screen (a quote of the
 * chat). Its place may keep it open on a press outside, a blur or a view switch (`onDismiss`).
 *
 * The popup is drawn into document.body: inside a Node the Canvas's zoom would scale it and an Epic
 * frame would cut it off. The Canvas does not get its presses, so it stays `modal={false}`, as every
 * popup on the Canvas (ADR-0106, item 8).
 */
import { Popover as BasePopover } from '@base-ui/react/popover'
import { useCallback, useEffect, useEffectEvent, useRef, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { layerStyle, useKitLayer, type KitCloseReason, type LayerName } from './layer'
import './popover.css'

/** The area of the toasts (toast/ToastRegion.tsx): a press there is not a press outside the popover. */
const TOASTS_SELECTOR = '.w-toasts'

/** Base UI's focus guards around a popup: the focus lands on one on its way out by Tab, and Base UI closes the popup itself. */
const FOCUS_GUARD_SELECTOR = '[data-base-ui-focus-guard]'

/** A box on the screen a popup is placed against, as an element has (`getBoundingClientRect`). */
export interface AnchorBox {
  getBoundingClientRect: () => DOMRect
  /** The element the box lies in: its scroll moves the box, and the popup follows. */
  contextElement?: Element
}

/** What a popup without a trigger is placed against. */
export type PopupAnchor = Element | AnchorBox | RefObject<Element | null> | (() => Element | AnchorBox | null)

/** What would close a popover its place may keep open (`onDismiss`). */
export type DismissReason = 'outside-press' | 'focus-out' | 'blur' | 'view'

export interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The trigger: a `<button>` element. Base UI renders it with its own props merged in — the toggle on
   * click, `aria-expanded`, `aria-haspopup` — so its own class, name and handlers stay as they are.
   * Without it the popover is placed against `anchor` and opened by its place alone.
   */
  trigger?: ReactElement<Record<string, unknown>>
  /** The popup's accessible name. */
  label: string
  children: ReactNode
  /** The popup's own classes, after the kit's frame (`w-kit-popover`). */
  className?: string
  testId?: string
  /** Which side of the trigger the popup is drawn on while there is room; the default is under it. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** How the popup lines up with the trigger along that side. */
  align?: 'start' | 'center' | 'end'
  /** The gap between the trigger and the popup, in px. */
  sideOffset?: number
  /** The popup belongs to a Node on the Canvas (theme/kit/layer.ts). */
  inNode?: boolean
  /** The layer of the scale (theme/layers.ts) the popup is drawn on. */
  layer?: LayerName
  /** What the popup is placed against instead of its trigger. */
  anchor?: PopupAnchor
  /** Where the focus goes on opening; by default the first field or button inside; `'popup'` — the popup itself. */
  initialFocus?: RefObject<HTMLElement | null> | 'popup'
  /** Where the focus goes on closing; by default back to the trigger. */
  finalFocus?: RefObject<HTMLElement | null>
  /**
   * Asked before a press outside, the focus leaving, a blur of the window or a view switch closes the
   * popover: `false` keeps it open, as a comment with unsaved text keeps its popover. Esc always closes it.
   */
  onDismiss?: (reason: DismissReason) => boolean
  /**
   * Props of the popup the place needs: its own keys, its drag and drop, its data attributes. Its
   * `onKeyDown` runs before the kit's: an Esc it marks handled leaves the popover open.
   */
  popupProps?: HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | undefined }
}

/** Whether `target` lies in the element a popover is placed against (not a box on the screen). */
function onAnchor(anchor: PopupAnchor | undefined, target: Element): boolean {
  const placed = typeof anchor === 'function' ? anchor() : anchor !== undefined && 'current' in anchor ? anchor.current : anchor
  return placed instanceof Element && placed.contains(target)
}

/** Stops a click inside the popup from reaching the Node it was opened from, through React's tree: it must not select or open the Node. */
const keepFromNode = (event: MouseEvent) => event.stopPropagation()

export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  children,
  className,
  testId,
  side = 'bottom',
  align = 'center',
  sideOffset = 4,
  inNode = false,
  layer = 'popover',
  anchor,
  initialFocus,
  finalFocus,
  onDismiss,
  popupProps,
}: PopoverProps) {
  const close = useCallback(
    (reason: KitCloseReason) => {
      if (reason !== 'escape' && onDismiss !== undefined && !onDismiss(reason)) return
      onOpenChange(false)
    },
    [onOpenChange, onDismiss],
  )
  const kit = useKitLayer({ open, close, inNode })
  const popup = useRef<HTMLDivElement | null>(null)
  const triggerElement = useRef<HTMLButtonElement | null>(null)
  // The focus going to anything else of the window closes the popover: a field the Command palette
  // opens on ⌘K, a button of another panel. Base UI closes a non-modal popup when the focus leaves it by
  // Tab (its focus guards), not when something else takes the focus. The toasts are not a press outside,
  // nor is the element the popover is placed against.
  const focusOut = useEffectEvent((target: Element) => {
    // Not drawn yet: a field of the popup that takes the focus as it is drawn does so before the popup's own ref is set.
    if (popup.current === null || popup.current.contains(target) || triggerElement.current?.contains(target)) return
    if (target.closest(TOASTS_SELECTOR) !== null || target.closest(FOCUS_GUARD_SELECTOR) !== null || onAnchor(anchor, target)) return
    if (onDismiss !== undefined && !onDismiss('focus-out')) return
    onOpenChange(false)
  })
  useEffect(() => {
    if (!open) return
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Element) focusOut(event.target)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open])

  const change = (next: boolean, details: BasePopover.Root.ChangeEventDetails) => {
    // A press on the toasts is not a press outside, nor one on the element the popover is placed
    // against: that element's own click opens and closes it (the version chip of What's new).
    const target = details.event.target
    if (!next && details.reason === 'outside-press' && target instanceof Element && (target.closest(TOASTS_SELECTOR) !== null || onAnchor(anchor, target))) {
      details.cancel()
      return
    }
    if (!next && onDismiss !== undefined && (details.reason === 'outside-press' || details.reason === 'focus-out') && !onDismiss(details.reason)) {
      details.cancel()
      return
    }
    onOpenChange(next)
  }
  const popupClass = ['w-kit-popover', kit.popup.className, className].filter(Boolean).join(' ')
  const { onKeyDown: placeKeyDown, ...placeProps } = popupProps ?? {}
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    placeKeyDown?.(event)
    kit.popup.onKeyDown(event)
  }
  return (
    <BasePopover.Root open={open} onOpenChange={change} modal={false}>
      {trigger !== undefined ? <BasePopover.Trigger {...kit.trigger} ref={triggerElement} render={trigger} /> : null}
      <BasePopover.Portal style={layerStyle(layer)}>
        <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} {...(anchor !== undefined ? { anchor } : {})}>
          <BasePopover.Popup
            {...kit.popup}
            {...placeProps}
            ref={popup}
            className={popupClass}
            aria-label={label}
            data-testid={testId}
            onKeyDown={onKeyDown}
            {...(initialFocus !== undefined ? { initialFocus: initialFocus === 'popup' ? popup : initialFocus } : {})}
            {...(finalFocus !== undefined ? { finalFocus } : {})}
            {...(inNode ? { onClick: keepFromNode, onDoubleClick: keepFromNode } : {})}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
