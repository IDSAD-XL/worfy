/**
 * The kit's Menu (worfy-ui-kit ticket 11, ADR-0106): a menu button and its menu. Base UI gives the
 * behaviour:
 * - the popup is a `menu` named by `label`, its items `menuitem`, `menuitemcheckbox` and
 *   `menuitemradio`; the trigger gets `aria-haspopup="menu"` and `aria-expanded`;
 * - the arrows move between the items, Home and End go to the first and the last, typing a letter
 *   goes to the item that starts with it; ArrowDown on the trigger opens the menu;
 * - opening moves the focus to the first item (or the one `focusOnOpen` names), closing gives it back
 *   to the trigger; a press outside closes the menu;
 * - the popup sits next to its trigger and flips to the other side or slides along the edge where
 *   the window has no room for it.
 * The shared part (layer.ts) adds the rest: Esc closes only this menu and is marked handled, a blur
 * of the window and a switch of the view close it, the layer comes from the scale, a menu of a Node on
 * the Canvas carries the in-node mark. The kit adds three of its own: Tab closes the menu and moves on
 * from the trigger; the focus anywhere else in the window closes it; and the wheel outside a menu of a
 * Node closes it — the Canvas pans or zooms under the wheel and carries the trigger away from the menu.
 *
 * The menu is always `modal={false}`: a modal menu of Base UI lays a backdrop over the whole window
 * (`InternalBackdrop`), and a Node under it cannot be dragged while the menu is open (spike,
 * .scratch/worfy-ui-kit/spike-base-ui.md, step 2 item 3; ADR-0106, item 8). The popup is drawn into
 * document.body: inside a Node the Canvas's zoom would scale it and an Epic frame would cut it off.
 */
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { useCallback, useEffect, useId, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type Ref } from 'react'
import { layerStyle, useKitLayer, type LayerName } from './layer'
import './menu.css'

export interface MenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The trigger: a `<button>` element. Base UI renders it with its own props merged in — the toggle on
   * a press, ArrowDown, `aria-expanded`, `aria-haspopup` — so its own class, name and handlers stay.
   */
  trigger: ReactElement<Record<string, unknown>>
  /** The menu's accessible name. */
  label: string
  children: ReactNode
  /** The menu's own classes, after the kit's frame (`w-kit-menu`). */
  className?: string
  /** The menu's own inline style, for a place drawn with inline styles. */
  style?: CSSProperties
  testId?: string
  /** Which side of the trigger the menu is drawn on while there is room; the default is under it. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** How the menu lines up with the trigger along that side. */
  align?: 'start' | 'center' | 'end'
  /** The gap between the trigger and the menu, in px. */
  sideOffset?: number
  /** Whether the arrows go round from the last item to the first; the default is yes. */
  loopFocus?: boolean
  /**
   * The item that takes the focus when the menu opens, by a key or by a press: a CSS selector inside it
   * (the checked answer of a choice, `[aria-checked="true"]`). The default is the first item, as every
   * menu of worfy did before the kit; Base UI alone would focus the menu itself on a press.
   */
  focusOnOpen?: string
  /** The menu belongs to a Node on the Canvas (theme/kit/layer.ts). */
  inNode?: boolean
  /** The layer of the scale (theme/layers.ts) the menu is drawn on; `dialogMenu` for a menu over a dialog. */
  layer?: LayerName
}

/** Every item of a menu, whatever its role. */
const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
/** An inactive item, which keeps the focus. */
const INACTIVE_ITEM = ':is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[aria-disabled="true"]'

/** Stops a click inside the menu from reaching the Node it was opened from, through React's tree: it must not select or open the Node. */
const keepFromNode = (event: MouseEvent) => event.stopPropagation()

export function Menu({ open, onOpenChange, trigger, label, children, className, style, testId, side = 'bottom', align = 'start', sideOffset = 4, loopFocus = true, focusOnOpen = ITEMS, inNode = false, layer = 'popover' }: MenuProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const kit = useKitLayer({ open, close, inNode })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // The wheel outside a menu of a Node pans or zooms the Canvas, and the trigger goes with it.
  useEffect(() => {
    if (!open || !inNode) return
    const wheel = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target) === true) return
      close()
    }
    window.addEventListener('wheel', wheel, true)
    return () => window.removeEventListener('wheel', wheel, true)
  }, [open, inNode, close])

  // The focus elsewhere in the window closes the menu, even before it took the focus in (the Command
  // palette's field on ⌘K): Base UI closes it only when the focus leaves from inside it.
  useEffect(() => {
    if (!open) return
    const elsewhere = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node) || popupRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('focusin', elsewhere)
    return () => document.removeEventListener('focusin', elsewhere)
  }, [open, close])

  // Once the menu is open, after Base UI's own first focus: the menu itself on a press, the first item
  // on a key.
  const focusFirst = (opened: boolean) => {
    if (opened) popupRef.current?.querySelector<HTMLElement>(focusOnOpen)?.focus()
  }

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Base UI marks every key but Tab on an inactive item handled (useFocusableWhenDisabled), so the
    // shared part would take Esc there for a field of the menu that kept it, and the menu would stay.
    // No field took it: Esc on an inactive item closes the menu as on any other.
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.target instanceof Element && event.target.matches(INACTIVE_ITEM)) {
      event.stopPropagation()
      close()
      return
    }
    kit.popup.onKeyDown(event)
    if (event.key !== 'Tab' || event.defaultPrevented) return
    // The focus goes back to the trigger before the menu goes, so Tab moves on from there.
    triggerRef.current?.focus()
    close()
  }

  const popupClass = ['w-kit-menu', kit.popup.className, className].filter(Boolean).join(' ')
  return (
    <BaseMenu.Root open={open} onOpenChange={(next) => onOpenChange(next)} onOpenChangeComplete={focusFirst} modal={false} loopFocus={loopFocus}>
      <BaseMenu.Trigger {...kit.trigger} ref={triggerRef} render={trigger} />
      <BaseMenu.Portal style={layerStyle(layer)}>
        <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8}>
          <BaseMenu.Popup
            {...kit.popup}
            ref={popupRef}
            className={popupClass}
            style={style}
            aria-label={label}
            data-testid={testId}
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

/** The attributes an item passes on to its element: `title`, `aria-busy`, `data-*` and the like. */
type ItemAttributes = Omit<HTMLAttributes<HTMLElement>, 'children' | 'onClick' | 'role' | 'tabIndex'> & {
  [data: `data-${string}`]: string | undefined
}

/**
 * An inactive item carries `aria-disabled="true"`; an active one what its caller gave (the Canvas's
 * action menu says `"false"`), else none at all, as the menus before the kit drew it — not Base UI's `"false"`.
 */
const activeless = (disabled: boolean, own: ItemAttributes['aria-disabled']): ItemAttributes['aria-disabled'] => (disabled ? 'true' : own)

interface ItemCommon extends ItemAttributes {
  children: ReactNode
  ref?: Ref<HTMLElement>
  /** Inactive: it stays in the list and keeps the focus and its tooltip (`aria-disabled`), but a choice does nothing. */
  disabled?: boolean
  testId?: string
}

export interface MenuItemProps extends ItemCommon {
  onClick?: (event: MouseEvent<HTMLElement>) => void
  /** Whether choosing the item closes the menu; the default is yes. */
  closeOnClick?: boolean
}

/**
 * An item of the menu: a `menuitem`. It is Base UI's own element, not a `<button>`: Base UI then
 * takes Enter and Space itself, the same in the browser and in a test, where a `<button>` leaves Enter
 * to the browser's own activation.
 */
export function MenuItem({ children, disabled = false, testId, onClick, closeOnClick = true, ...rest }: MenuItemProps) {
  return (
    <BaseMenu.Item data-testid={testId} {...rest} disabled={disabled} aria-disabled={activeless(disabled, rest['aria-disabled'])} closeOnClick={closeOnClick} onClick={onClick}>
      {children}
    </BaseMenu.Item>
  )
}

export interface MenuCheckboxItemProps extends ItemCommon {
  checked: boolean
  /** The choice: what the item asks for, the other state; the caller decides what shows. */
  onCheckedChange: (checked: boolean) => void
  /** Whether choosing the item closes the menu; the default is no: the new state shows in it. */
  closeOnClick?: boolean
}

/** A `menuitemcheckbox`: an item that is on or off. */
export function MenuCheckboxItem({ children, disabled = false, testId, checked, onCheckedChange, closeOnClick = false, ...rest }: MenuCheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem
      data-testid={testId}
      {...rest}
      disabled={disabled}
      aria-disabled={activeless(disabled, rest['aria-disabled'])}
      closeOnClick={closeOnClick}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      {children}
    </BaseMenu.CheckboxItem>
  )
}

export interface MenuRadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role' | 'onChange'> {
  [data: `data-${string}`]: string | undefined
  /** The value of the item in force; null when none is. */
  value: string | null
  /** A choice of another item; without it, the items' own `onClick` acts. */
  onValueChange?: (value: string) => void
  /** The heading over the items, which names the group; without it the group goes unnamed, or takes `aria-label`. */
  heading?: string
  headingClassName?: string
  children: ReactNode
}

/** A group of `menuitemradio` items, one of them in force, under a heading that names it. */
export function MenuRadioGroup({ value, onValueChange, heading, headingClassName, children, ...rest }: MenuRadioGroupProps) {
  const id = useId()
  return (
    <BaseMenu.RadioGroup
      {...rest}
      {...(heading === undefined ? {} : { 'aria-labelledby': id })}
      value={value}
      onValueChange={(next: unknown) => onValueChange?.(next as string)}
    >
      {heading === undefined ? null : (
        <span id={id} className={headingClassName}>
          {heading}
        </span>
      )}
      {children}
    </BaseMenu.RadioGroup>
  )
}

export interface MenuRadioItemProps extends ItemCommon {
  value: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  /** Whether choosing the item closes the menu; the default is no: the new state shows in it. */
  closeOnClick?: boolean
}

/** A `menuitemradio` of a MenuRadioGroup. */
export function MenuRadioItem({ children, disabled = false, testId, value, onClick, closeOnClick = false, ...rest }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem data-testid={testId} {...rest} disabled={disabled} aria-disabled={activeless(disabled, rest['aria-disabled'])} closeOnClick={closeOnClick} value={value} onClick={onClick}>
      {children}
    </BaseMenu.RadioItem>
  )
}

/** A line between items: a `separator`. */
export function MenuSeparator({ className }: { className?: string }) {
  return <BaseMenu.Separator className={className} />
}
