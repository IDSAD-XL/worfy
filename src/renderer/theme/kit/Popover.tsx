/**
 * The kit's Popover (worfy-ui-kit ticket 09, ADR-0106): a non-modal popup with a name, opened by its
 * trigger. Base UI gives the behaviour:
 * - the popup is a `dialog` named by `label`; the trigger gets `aria-expanded` and `aria-haspopup`;
 * - opening moves the focus into the popup, closing gives it back to the trigger;
 * - a press outside closes it, but a press on the toasts does not: they are not what the user works
 *   with in the popup (toast/ToastRegion.tsx);
 * - the popup sits next to its trigger and flips to the other side or slides along the edge where
 *   the window has no room for it.
 * The shared part (layer.ts) adds the rest: Esc closes only this popup and is marked handled, a blur
 * of the window (a press inside a Browser Node's <webview>) and a switch of the view close it, the
 * layer comes from the scale, and a popup of a Node on the Canvas carries the in-node mark.
 *
 * The popup is drawn into document.body: inside a Node the Canvas's zoom would scale it and an Epic
 * frame would cut it off. The Canvas does not get its presses, so it stays `modal={false}`, as every
 * popup on the Canvas (ADR-0106, item 8).
 */
import { Popover as BasePopover } from '@base-ui/react/popover'
import { useCallback, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { layerStyle, useKitLayer, type LayerName } from './layer'
import './popover.css'

/** The area of the toasts (toast/ToastRegion.tsx): a press there is not a press outside the popover. */
const TOASTS_SELECTOR = '.w-toasts'

export interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The trigger: a `<button>` element. Base UI renders it with its own props merged in — the toggle on
   * click, `aria-expanded`, `aria-haspopup` — so its own class, name and handlers stay as they are.
   */
  trigger: ReactElement<Record<string, unknown>>
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
}

/** Stops a click inside the popup from reaching the Node it was opened from, through React's tree: it must not select or open the Node. */
const keepFromNode = (event: MouseEvent) => event.stopPropagation()

export function Popover({ open, onOpenChange, trigger, label, children, className, testId, side = 'bottom', align = 'center', sideOffset = 4, inNode = false, layer = 'popover' }: PopoverProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const kit = useKitLayer({ open, close, inNode })
  const change = (next: boolean, details: BasePopover.Root.ChangeEventDetails) => {
    if (!next && details.reason === 'outside-press' && details.event.target instanceof Element && details.event.target.closest(TOASTS_SELECTOR) !== null) {
      details.cancel()
      return
    }
    onOpenChange(next)
  }
  const popupClass = ['w-kit-popover', kit.popup.className, className].filter(Boolean).join(' ')
  return (
    <BasePopover.Root open={open} onOpenChange={change} modal={false}>
      <BasePopover.Trigger {...kit.trigger} render={trigger} />
      <BasePopover.Portal style={layerStyle(layer)}>
        <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8}>
          <BasePopover.Popup
            {...kit.popup}
            className={popupClass}
            aria-label={label}
            data-testid={testId}
            {...(inNode ? { onClick: keepFromNode, onDoubleClick: keepFromNode } : {})}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
