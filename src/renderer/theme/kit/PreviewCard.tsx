/**
 * The kit's PreviewCard (worfy-ui-kit ticket 10, ADR-0106): a hover card. Base UI gives the behaviour:
 * - the card opens when the pointer rests on its trigger or the trigger takes the focus, and closes
 *   when the pointer leaves both the trigger and the card, or the focus leaves them;
 * - the pointer may cross the gap from the trigger to the card: the card waits `closeDelay`;
 * - Esc and a press outside close it;
 * - the card sits next to its trigger and flips or slides where the window has no room.
 * The shared part (layer.ts) adds the rest, as for every popup of the kit: Esc in the card is marked
 * handled, a blur of the window and a view switch close it, the layer comes from the scale, and the
 * toasts keep clear of it.
 *
 * A card without a trigger is opened by its place alone and placed against its `anchor`: a box on the
 * screen, as the light of a quote comment in the chat is (session/QuoteComments.tsx). Base UI then
 * tracks no hover of its own; the place keeps the card open while the pointer rests on the light or
 * on the card (`popupProps.onMouseEnter`, `onMouseLeave`).
 *
 * The card is a `dialog` named by `label`: it holds actions, and while it is open it is a layer over
 * the page (theme/open-layers.ts), so Esc closes it first.
 */
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { useCallback, type HTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { layerStyle, useKitLayer, type LayerName } from './layer'
import type { PopupAnchor } from './Popover'
import './popover.css'

export interface PreviewCardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The element the card is about, as Base UI renders its trigger: its own props stay, the hover and focus handlers are merged in. */
  trigger?: ReactElement<Record<string, unknown>>
  /** What the card is placed against when it has no trigger. */
  anchor?: PopupAnchor
  /** The card's accessible name. */
  label: string
  children: ReactNode
  /** The card's own classes, after the kit's frame (`w-kit-preview-card`). */
  className?: string
  testId?: string
  /** How long the pointer rests on the trigger before the card opens, in ms. */
  delay?: number
  /** How long the card waits after the pointer left before it closes, in ms. */
  closeDelay?: number
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** The layer of the scale (theme/layers.ts) the card is drawn on. */
  layer?: LayerName
  /** Props of the card the place needs (the pointer entering and leaving it); its `onKeyDown` runs before the kit's. */
  popupProps?: HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | undefined }
}

export function PreviewCard({
  open,
  onOpenChange,
  trigger,
  anchor,
  label,
  children,
  className,
  testId,
  delay = 600,
  closeDelay = 300,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
  layer = 'popover',
  popupProps,
}: PreviewCardProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const kit = useKitLayer({ open, close })
  const popupClass = ['w-kit-popover', 'w-kit-preview-card', className].filter(Boolean).join(' ')
  const { onKeyDown: placeKeyDown, ...placeProps } = popupProps ?? {}
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    placeKeyDown?.(event)
    kit.popup.onKeyDown(event)
  }
  return (
    <BasePreviewCard.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {trigger !== undefined ? <BasePreviewCard.Trigger {...kit.trigger} delay={delay} closeDelay={closeDelay} render={trigger} /> : null}
      <BasePreviewCard.Portal style={layerStyle(layer)}>
        <BasePreviewCard.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} {...(anchor !== undefined ? { anchor } : {})}>
          <BasePreviewCard.Popup {...kit.popup} {...placeProps} className={popupClass} role="dialog" aria-label={label} data-testid={testId} onKeyDown={onKeyDown}>
            {children}
          </BasePreviewCard.Popup>
        </BasePreviewCard.Positioner>
      </BasePreviewCard.Portal>
    </BasePreviewCard.Root>
  )
}
