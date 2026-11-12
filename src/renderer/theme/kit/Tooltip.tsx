/**
 * Tooltip kit (worfy-ui-kit ticket 13, ADR-0106): the app's own tooltip in place of the native `title`,
 * which Chromium shows only under the mouse. A kit tooltip shows when the pointer rests on its element
 * and when the keyboard moves the focus there; Esc hides it; a screen reader hears its text as the
 * element's description (`aria-description`); it is drawn on the topmost layer of the scale
 * (theme/layers.ts), over dialogs, menus and focus mode.
 *
 * Two ways to give an element a tooltip:
 * - `<Tooltip label="…">{element}</Tooltip>` — Base UI's Tooltip with its trigger on the element: for
 *   a place that draws its own element (the icon buttons of the toolbar, the sidebar and focus mode).
 * - `hintProps(text)` (hint.ts) — attributes only, for a place that can only spread props on an
 *   element it does not draw: `writeAction` (projects/read-only.ts) hands its "why inactive" hint this
 *   way to 46 places. `HintTooltips`, mounted once in main.tsx, shows the tooltip of whichever marked
 *   element the pointer rests on or the keyboard focuses.
 *
 * Both close on a blur of the window and on a view switch (the shared part of kit popups, layer.ts).
 * A tooltip is not a layer the user is in, and Esc treats it so:
 * - with the focus on its element, Esc hides it and goes no further: an ancestor with an Esc of its
 *   own (a dialog, the rail panel) acts on the next press, as for a popup's trigger (ADR-0106, item 7);
 * - with the focus anywhere else (the pointer showed it), Esc hides it and goes on, unmarked, to
 *   whoever acts on Esc there — focus mode leaves, the chat field interrupts the turn. Base UI would
 *   take that press on the document (preventDefault, stopPropagation); the kit lets it through. So the
 *   popup carries no kit popup mark (`escapeBelongsToPopup` must not count it) and no toast keep-out
 *   mark: drawn on the top layer, over the toasts, it needs no room from them.
 * The tooltip never takes a pointer (tooltip.css).
 */
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { HINT_ATTRIBUTE } from './hint'
import { layerStyle, useKitLayer, type KitLayer } from './layer'
import './tooltip.css'

/** How long the pointer rests on an element before its tooltip shows; the keyboard focus shows it at once. */
export const TOOLTIP_DELAY_MS = 600

type Side = 'top' | 'bottom' | 'left' | 'right'

interface PopupProps {
  layer: KitLayer
  side: Side
  /** The element to point at when the tooltip has no Base UI trigger (`HintTooltips`). */
  anchor?: Element
  children: ReactNode
}

/**
 * Base UI's own Esc on the document, with the focus away from the element: the tooltip hides, and the
 * press goes on unmarked (see the head of the file).
 */
function passEscapeOn(open: boolean, details: BaseTooltip.Root.ChangeEventDetails): void {
  if (open || details.reason !== 'escape-key') return
  details.cancel()
  details.allowPropagation()
}

/** The drawn part: the portal on the topmost layer, the positioner, the popup. */
function TooltipPopup({ layer, side, anchor, children }: PopupProps) {
  // Of the shared part's popup props only the classes of a popup in a Node: the tooltip takes no key
  // press, and the two marks do not apply to it (see the head of the file).
  const className = layer.popup.className
  return (
    <BaseTooltip.Portal style={layerStyle('top')}>
      <BaseTooltip.Positioner className="w-tooltip-positioner" side={side} sideOffset={6} collisionPadding={6} anchor={anchor}>
        <BaseTooltip.Popup role="tooltip" className={className === undefined ? 'w-tooltip' : `w-tooltip ${className}`}>
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

export interface TooltipProps {
  /** The text. */
  label: string
  /** The one element the tooltip belongs to; it takes the trigger's props. */
  children: ReactElement<Record<string, unknown>>
  /** The side of the element it shows on. */
  side?: Side
}

/**
 * The tooltip of an element this place draws. The element keeps its name and props; it gets the
 * label as its description, unless it says a description of its own or the label only repeats its name.
 */
export function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const layer = useKitLayer({ open, close })
  const own = children.props
  const description = typeof own['aria-description'] === 'string' ? own['aria-description'] : label === own['aria-label'] ? undefined : label
  return (
    <BaseTooltip.Root
      open={open}
      onOpenChange={(next, details) => {
        passEscapeOn(next, details)
        setOpen(next)
      }}
      disableHoverablePopup
    >
      {/* The shared part's Esc on the trigger: with the focus there, the press hides the tooltip and stops. */}
      <BaseTooltip.Trigger render={children} delay={TOOLTIP_DELAY_MS} {...layer.trigger} aria-description={description} />
      <TooltipPopup layer={layer} side={side}>
        {label}
      </TooltipPopup>
    </BaseTooltip.Root>
  )
}

interface Shown {
  anchor: HTMLElement
  text: string
  /** What showed it: the hover hides it when the pointer leaves, the focus when the focus leaves. */
  by: 'pointer' | 'focus'
}

/** The marked element `target` is or lies in. */
function marked(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${HINT_ATTRIBUTE}]`) : null
}

/**
 * The tooltips of the elements marked with `hintProps`, mounted once for the window (main.tsx). It
 * watches the document: the pointer resting on a marked element for TOOLTIP_DELAY_MS, or the keyboard
 * moving the focus onto one, shows its text next to it; leaving it, a press anywhere or Esc hides it.
 * A focus that a press gave (a click, a dialog that takes the focus after a click) shows nothing, as
 * `:focus-visible` would have it.
 */
export function HintTooltips() {
  const [shown, setShown] = useState<Shown | null>(null)
  const close = useCallback(() => setShown(null), [])
  const layer = useKitLayer({ open: shown !== null, close })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let hovered: HTMLElement | null = null
    // Whether the last input was a press: then the focus that follows is the pointer's, not the keyboard's.
    let pressed = false
    const show = (anchor: HTMLElement, by: Shown['by']) => {
      const text = anchor.getAttribute(HINT_ATTRIBUTE)
      if (text !== null && text !== '') setShown({ anchor, text, by })
    }
    const hide = (by: Shown['by'], anchor?: HTMLElement) =>
      setShown((now) => (now !== null && now.by === by && (anchor === undefined || now.anchor === anchor) ? null : now))
    const onOver = (event: MouseEvent) => {
      const anchor = marked(event.target)
      if (anchor === hovered) return
      clearTimeout(timer)
      hovered = anchor
      hide('pointer')
      if (anchor !== null) timer = setTimeout(() => show(anchor, 'pointer'), TOOLTIP_DELAY_MS)
    }
    const onOut = (event: MouseEvent) => {
      // Only the pointer leaving the window: a move onto another element comes as `mouseover` too.
      if (event.relatedTarget !== null) return
      clearTimeout(timer)
      hovered = null
      hide('pointer')
    }
    const onPress = () => {
      pressed = true
      clearTimeout(timer)
      setShown(null)
    }
    const onKey = () => {
      pressed = false
    }
    const onFocusIn = (event: FocusEvent) => {
      const anchor = marked(event.target)
      if (anchor !== null && anchor === event.target && !pressed) show(anchor, 'focus')
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) hide('focus', event.target)
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('mousedown', onPress, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Esc on the marked element (the focus is there) while the tooltip shows: taken on the element
  // itself, before React hands the press to any ancestor of it. Esc pressed anywhere else reaches
  // Base UI's listener on the document, and passEscapeOn lets it go on.
  useEffect(() => {
    if (shown === null) return
    const anchor = shown.anchor
    const onAnchorKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    anchor.addEventListener('keydown', onAnchorKey)
    return () => anchor.removeEventListener('keydown', onAnchorKey)
  }, [shown, close])

  return (
    <BaseTooltip.Root
      open={shown !== null}
      onOpenChange={(open, details) => {
        passEscapeOn(open, details)
        if (!open) close()
      }}
      disableHoverablePopup
    >
      {shown === null ? null : (
        <TooltipPopup layer={layer} side="bottom" anchor={shown.anchor}>
          {shown.text}
        </TooltipPopup>
      )}
    </BaseTooltip.Root>
  )
}
