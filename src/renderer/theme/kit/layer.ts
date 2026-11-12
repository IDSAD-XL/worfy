/**
 * The shared part of every kit popup (worfy-ui-kit ticket 03, ADR-0106). A kit wrapper takes Base UI
 * for the behaviour, spreads `popup` on its popup and `trigger` on its trigger; the portal takes
 * `layerStyle`. Base UI is imported only under theme/kit/ (the lint rule in eslint.config.js); this
 * file needs none of it.
 *
 * What every popup gets here:
 * - it closes when the window loses the focus (a press inside a Browser Node's <webview> takes the
 *   focus out of the renderer, and Base UI does not see it as a press outside: Base UI #5410) and
 *   when the view of the shell switches, so it never hangs over another view;
 * - Esc pressed in the popup or on its trigger is taken in React's phase, there: it closes the popup
 *   and is marked handled (`preventDefault`, `stopPropagation`), so an ancestor in the React tree
 *   with its own Esc (the rail panel of session/ProductSessionPanel.tsx) does not act on the same
 *   press. Base UI 1.9.0 does the same from onKeyDown handlers of its own on the popup and the
 *   trigger, but that is its internal (ADR-0106, item 7); the kit does not rely on it. An Esc
 *   pressed anywhere else Base UI takes only in its listener on the document, after every React
 *   handler: a field that keeps the focus asks `escapeBelongsToPopup` (theme/open-layers.ts);
 * - toasts keep clear of it (`data-toast-keep-out`, toast/ToastRegion.tsx);
 * - a popup of a Node on the Canvas carries `nodrag`, `nopan` and `nowheel` for React Flow and the
 *   in-node mark: a press inside it leaves the Node active (canvas/Canvas.tsx).
 */
import { useEffect, useEffectEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { LAYERS } from '../layers'
import { KIT_POPUP_ATTRIBUTE } from '../open-layers'

/** The mark of a popup drawn for a Node on the Canvas. */
const IN_NODE_ATTRIBUTE = 'data-kit-in-node'

/** React Flow's classes: a press, a drag or the wheel inside the popup is not the Canvas's. */
const IN_NODE_CLASSES = 'nodrag nopan nowheel'

/** A view of the shell (shell/AppShell.tsx): the views stay mounted, the hidden ones carry `hidden`. */
const VIEW_SELECTOR = '.w-shell__view'

export type LayerName = keyof typeof LAYERS

/**
 * The style of a popup's portal: the layer of the scale (theme/layers.ts) on a positioned element.
 * A z-index without `position` does nothing, and the backdrop of a window with a lower z-index then
 * covers the popup (spike, .scratch/worfy-ui-kit/spike-base-ui.md, step 2 item 4).
 */
export function layerStyle(layer: LayerName): CSSProperties {
  return { position: 'relative', zIndex: LAYERS[layer] }
}

/** Whether `target` (of a press, say) lies inside a kit popup drawn for a Node. */
export function insideNodePopup(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${IN_NODE_ATTRIBUTE}]`) !== null
}

export interface KitLayerOptions {
  /** Whether the popup is open. */
  open: boolean
  /** Closes the popup: the wrapper's own state, the same as Base UI's onOpenChange(false). */
  close: () => void
  /** The popup is drawn for a Node on the Canvas. */
  inNode?: boolean
}

/** The props a kit wrapper spreads on its Base UI popup element. */
export interface KitPopupProps {
  className: string | undefined
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  [KIT_POPUP_ATTRIBUTE]: ''
  'data-toast-keep-out': ''
  [IN_NODE_ATTRIBUTE]?: ''
}

/** The props a kit wrapper spreads on the trigger of its popup. */
export interface KitTriggerProps {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface KitLayer {
  popup: KitPopupProps
  trigger: KitTriggerProps
}

/** The shared part of a kit popup: closing on a blur of the window and on a view switch, and the props of the popup and its trigger. */
export function useKitLayer({ open, close, inNode = false }: KitLayerOptions): KitLayer {
  const closeNow = useEffectEvent(close)

  useEffect(() => {
    if (!open) return
    const onBlur = () => closeNow()
    // A view switch sets `hidden` on the view left and takes it off the view shown.
    const views = new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof Element && record.target.matches(VIEW_SELECTOR))) closeNow()
    })
    window.addEventListener('blur', onBlur)
    views.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
    return () => {
      window.removeEventListener('blur', onBlur)
      views.disconnect()
    }
  }, [open])

  const onPopupKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    event.stopPropagation()
    if (event.defaultPrevented) {
      // Something inside the popup took the press already (a field's own Esc): the popup stays.
      // Base UI's own Esc handler on the popup runs after this one; this press skips it.
      ;(event as { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.()
      return
    }
    event.preventDefault()
    close()
  }

  // On the trigger only while the popup is open: with it closed, Esc on the trigger is its
  // ancestor's, as for any other button.
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
    event.stopPropagation()
    event.preventDefault()
    close()
  }

  return {
    popup: {
      className: inNode ? IN_NODE_CLASSES : undefined,
      onKeyDown: onPopupKeyDown,
      [KIT_POPUP_ATTRIBUTE]: '',
      'data-toast-keep-out': '',
      ...(inNode ? { [IN_NODE_ATTRIBUTE]: '' as const } : {}),
    },
    trigger: { onKeyDown: onTriggerKeyDown },
  }
}
