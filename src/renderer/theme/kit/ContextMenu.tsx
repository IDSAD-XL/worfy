/**
 * The kit's ContextMenu (worfy-ui-kit ticket 12, ADR-0106): a menu that a right click opens at the
 * point of the click. It is the Menu kit (Menu.tsx, ticket 11) without a trigger: the same items
 * (MenuItem, MenuCheckboxItem, MenuRadioGroup, MenuSeparator of Menu.tsx), the same keys and the same
 * focus. Base UI gives the behaviour:
 * - the popup is a `menu` named by `label`, its items `menuitem`;
 * - the arrows move between the items, Home and End go to the ends, typing a letter goes to the item
 *   that starts with it;
 * - a press outside closes it;
 * - the popup stands at the point, below and to the right of it, and flips above it or slides along
 *   the edge where the window has no room for it.
 * The shared part (layer.ts) adds Esc that closes only this menu and is marked handled, the close on
 * a blur of the window and on a switch of the view, the layer of the scale and the in-node mark. The
 * kit adds its own:
 * - opening moves the focus to the first item (or the one `focusOnOpen` names);
 * - closing gives the focus back to the opener — `opener`, else what had the focus when the menu
 *   opened — when the focus is in the menu or lost to the page. It does so at once, in the same event
 *   as the choice: a window of the kit an item opens (theme/kit/Dialog.tsx) then finds the opener as
 *   what had the focus, and gives it back there when it closes;
 * - the focus going anywhere else in the window closes it and stays where it went;
 * - Tab closes it and moves on from the opener;
 * - the wheel outside a menu of a Node closes it: the Canvas pans or zooms and carries the point away.
 *
 * It is Base UI's Menu with an anchor at the point, not Base UI's ContextMenu: the root of Base UI's
 * ContextMenu is always modal — a backdrop over the whole window and the rest of the page hidden from a
 * screen reader — and a menu on the Canvas is `modal={false}` (ADR-0106, item 8). The places open it
 * themselves, from their own `contextmenu` listener: the Canvas listens on its pane, the Binding menu on
 * the window, the transcript on its log. The popup is drawn into document.body.
 */
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { layerStyle, useKitLayer, type LayerName } from './layer'
import { MenuSeparator } from './Menu'
import './menu.css'
import './context-menu.css'

/** A point in window coordinates: where the right click was. */
export interface ContextMenuPoint {
  x: number
  y: number
}

export interface ContextMenuProps {
  /** Where the menu stands: the point of the right click. `null` — the menu is closed. */
  at: ContextMenuPoint | null
  /** The menu closes: by a choice, Esc, Tab, a press outside, the focus elsewhere, a blur, a view switch. */
  onClose: () => void
  /** The menu's accessible name. */
  label: string
  children: ReactNode
  /**
   * What the focus goes back to when the menu closes: the element the menu was opened on (a Project's
   * row). Without it, what had the focus when the menu opened.
   */
  opener?: HTMLElement | null
  /** The menu's own classes, after the kit's frame (`w-kit-menu`). */
  className?: string
  /** The menu's own inline style, for a place drawn with inline styles. */
  style?: CSSProperties
  testId?: string
  /** More attributes and handlers of the popup: a `data-*` mark of its place, `onMouseDown`. */
  popupProps?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style' | 'role' | 'onKeyDown'> & { [data: `data-${string}`]: string | undefined }
  /** The gap between the point and the menu, down (or up, flipped), in px. */
  sideOffset?: number
  /** The shift of the menu from the point to the right, in px. */
  alignOffset?: number
  /** The item that takes the focus when the menu opens: a CSS selector inside it; the default is the first item. */
  focusOnOpen?: string
  /** The menu belongs to a Node on the Canvas (theme/kit/layer.ts). */
  inNode?: boolean
  /** The layer of the scale (theme/layers.ts) the menu is drawn on. */
  layer?: LayerName
}

/** Every item of a menu, whatever its role. */
const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
/** An inactive item, which keeps the focus. */
const INACTIVE_ITEM = ':is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[aria-disabled="true"]'

/** Stops a click inside the menu from reaching the Node it was opened from, through React's tree. */
const keepFromNode = (event: MouseEvent) => event.stopPropagation()

/** A box of no size at the point: what Base UI's positioner places the popup against. */
const pointAnchor = (point: ContextMenuPoint) => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) })

export function ContextMenu({
  at,
  onClose,
  label,
  children,
  opener,
  className,
  style,
  testId,
  popupProps,
  sideOffset = 2,
  alignOffset = 2,
  focusOnOpen = ITEMS,
  inNode = false,
  layer = 'popover',
}: ContextMenuProps) {
  const open = at !== null
  const popupRef = useRef<HTMLDivElement>(null)
  // What gets the focus back on closing, read as the menu opens, before the focus moves into it.
  const back = useRef<HTMLElement | null>(null)
  // The last point: the menu keeps its place while Base UI takes it out.
  const [place, setPlace] = useState<ContextMenuPoint>(at ?? { x: 0, y: 0 })
  if (at !== null && (at.x !== place.x || at.y !== place.y)) setPlace(at)
  const anchor = useMemo(() => pointAnchor(place), [place])

  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    back.current = opener ?? (active instanceof HTMLElement && active !== document.body ? active : null)
    // Once per opening: the opener of this opening, whatever the place renders next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * Gives the focus back to the opener when it is in the menu or lost to the page; a close caused by
   * the focus going elsewhere leaves it there. At once, in the event that closes the menu.
   */
  const giveFocusBack = useCallback(() => {
    const active = document.activeElement
    const lost = active === null || active === document.body || popupRef.current?.contains(active) === true
    const target = back.current
    if (lost && target?.isConnected === true) target.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    giveFocusBack()
    onClose()
  }, [giveFocusBack, onClose])
  const kit = useKitLayer({ open, close, inNode })

  // Once more as the commit that closes the menu lays out: Base UI's list navigation focuses the item
  // under the pointer again in its own layout effect of that commit, inside this one, so before this
  // one runs. A window of the kit opened in the same commit and drawn after the menu reads the focus
  // after this.
  useLayoutEffect(() => {
    if (!open) giveFocusBack()
  }, [open, giveFocusBack])

  // A place that unmounts the menu while it is open still gives the focus back. Unmounted, the menu is
  // closed for good: Base UI may still report a close it queued before (its focus-out check runs in a
  // microtask), and that must not close the menu a next right click has opened in the meantime.
  const openNow = useRef(open)
  useLayoutEffect(() => {
    openNow.current = open
  })
  useLayoutEffect(
    () => () => {
      if (openNow.current) giveFocusBack()
      openNow.current = false
    },
    [giveFocusBack],
  )

  // The wheel outside a menu of a Node pans or zooms the Canvas, and the point goes with it.
  useEffect(() => {
    if (!open || !inNode) return
    const wheel = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target) === true) return
      close()
    }
    window.addEventListener('wheel', wheel, true)
    return () => window.removeEventListener('wheel', wheel, true)
  }, [open, inNode, close])

  // The focus elsewhere in the window closes the menu (the Command palette's field on ⌘K) and stays
  // there. The opener taking it back is the menu closing, not a move elsewhere.
  useEffect(() => {
    if (!open) return
    const elsewhere = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node) || popupRef.current?.contains(target) === true || target === back.current) return
      onClose()
    }
    document.addEventListener('focusin', elsewhere)
    return () => document.removeEventListener('focusin', elsewhere)
  }, [open, onClose])

  // Once the menu is open, after Base UI's own first focus, which is the menu itself.
  const focusFirst = (opened: boolean) => {
    if (opened) popupRef.current?.querySelector<HTMLElement>(focusOnOpen)?.focus()
  }

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Base UI marks every key but Tab on an inactive item handled, so the shared part would take Esc
    // there for a field of the menu that kept it, and the menu would stay (Menu.tsx says the same).
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.target instanceof Element && event.target.matches(INACTIVE_ITEM)) {
      event.stopPropagation()
      event.preventDefault()
      close()
      return
    }
    kit.popup.onKeyDown(event)
    if (event.key !== 'Tab' || event.defaultPrevented) return
    // The focus goes back to the opener before the menu goes, so Tab moves on from there.
    close()
  }

  const popupClass = ['w-kit-menu', kit.popup.className, className].filter(Boolean).join(' ')
  return (
    <BaseMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && openNow.current) close()
      }}
      onOpenChangeComplete={focusFirst}
      modal={false}
      loopFocus
    >
      <BaseMenu.Portal style={layerStyle(layer)}>
        <BaseMenu.Positioner anchor={anchor} positionMethod="fixed" side="bottom" align="start" sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={8}>
          <BaseMenu.Popup
            {...popupProps}
            {...kit.popup}
            ref={popupRef}
            className={popupClass}
            style={style}
            aria-label={label}
            data-testid={testId}
            finalFocus={false}
            onKeyDown={onPopupKeyDown}
            {...(inNode ? { onClick: keepFromNode, onDoubleClick: keepFromNode } : {})}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

/** A line between the items of a context menu: a `separator`, with the look of the Canvas menu unless `className` gives another. */
export function ContextMenuSeparator({ className = 'w-kit-context-menu__separator' }: { className?: string }) {
  return <MenuSeparator className={className} />
}
