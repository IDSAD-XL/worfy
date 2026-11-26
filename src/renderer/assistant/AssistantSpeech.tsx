// The Assistant's own notification in the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): a speech card
// next to its icon on the rail, at the left edge of the window, in its colour — apart from worfy's toasts at the right
// edge. It carries the item, like and dislike, Open, Prepare and Snooze; one card at a time, the rest is the number on the
// icon (speech.ts). The section's rail badge is set here, as the card and the count go together. The card follows the
// rail button; with the sidebar hidden it stands at the left edge under the toolbar.
import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react'
import { inWindowOf } from '../../shared/assistant/settings'
import { windowMachine } from '../ipc'
import { useAppSettings } from '../settings/useAppSettings'
import { setRailBadge, useSidebarScope } from '../shell/sidebar-scope'
import { Icon, Spark } from './icons'
import { ItemActions, ItemHead, ItemMeta, ItemSource } from './parts'
import { PrepareDialog } from './PrepareDialog'
import { assistantBadge, shownItemIds, speechQueue } from './speech'
import { ASSISTANT_SECTION, closeCard, followAssistant, reportShown, revealAssistant, useAssistant } from './useAssistant'

/** Where the card stands: right of the rail button, its top at the button's, or the left edge under the toolbar. */
function useAnchor(): { left: number; top: number } {
  const [anchor, setAnchor] = useState({ left: 12, top: 60 })
  useLayoutEffect(() => {
    const place = () => {
      const button = document.querySelector(`[data-section-tab="${ASSISTANT_SECTION}"]`)
      if (button === null) return setAnchor({ left: 12, top: 60 })
      const box = button.getBoundingClientRect()
      setAnchor({ left: box.right + 10, top: Math.max(8, box.top - 6) })
    }
    place()
    window.addEventListener('resize', place)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [])
  return anchor
}

/** `sidebarVisible`: whether the sidebar is on screen, as the shell knows it (AppShell.tsx). */
export function AssistantSpeech({ sidebarVisible }: { sidebarVisible: boolean }): ReactElement | null {
  const view = useAssistant((state) => state.view)
  const closed = useAssistant((state) => state.closed)
  const tab = useAssistant((state) => state.tab)
  const saved = useSidebarScope((state) => state.section)
  // Urgent and batched, urgent only, or none (Settings → Assistant → In the window, ticket 25).
  const inWindow = useAppSettings(inWindowOf)
  const anchor = useAnchor()
  useEffect(() => followAssistant(), [])
  // The section is in front while the sidebar is shown and its panel holds the section: a window starts on another one
  // (`railDefault`), so it holds this one only once chosen.
  const sectionShown = sidebarVisible && saved === ASSISTANT_SECTION
  // A window of a Linked machine shows that Machine's Projects; the Assistant is this Machine's.
  const queue = windowMachine() === null ? speechQueue(view, new Set(closed), sectionShown, inWindow) : []
  const badge = windowMachine() === null ? assistantBadge(view, queue) : undefined
  useEffect(() => setRailBadge(ASSISTANT_SECTION, badge), [badge?.count, badge?.label]) // eslint-disable-line react-hooks/exhaustive-deps -- the badge is a fresh object each render
  useEffect(() => () => setRailBadge(ASSISTANT_SECTION, undefined), [])
  // What the user sees now counts as shown at its duty; the view main sends counts nothing.
  const shown = windowMachine() === null ? shownItemIds(view, sectionShown, tab, queue).join('\n') : ''
  useEffect(() => reportShown(shown === '' ? [] : shown.split('\n')), [shown])
  const item = queue[0]
  return (
    <>
      <PrepareDialog />
      {item === undefined ? null : (
        <div className="w-asst-say" role="status" aria-label="Assistant" data-testid="assistant-say" data-item-id={item.id} style={{ left: anchor.left, top: anchor.top }}>
          <div className="w-asst-say__inner">
            <div className="w-asst-say__head">
              <span className="w-asst-avatar w-asst-avatar--small">
                <Spark size={11} />
              </span>
              <b>Assistant</b>
              {item.urgent ? (
                <span className="w-asst-chip w-asst-chip--urgent">
                  <Icon name="bolt" size={12} />
                  Urgent
                </span>
              ) : null}
              <span className="w-asst-say__gap" />
              <button type="button" className="w-asst-icon-button" aria-label="Close" title="Close: it stays in the Assistant list" onClick={() => closeCard(item.id)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="w-asst-say__body">
              <ItemHead item={item} />
              <ItemMeta item={item} />
              <ItemSource item={item} />
            </div>
            <ItemActions item={item} from="say" />
            {queue.length > 1 ? (
              <button type="button" className="w-asst-say__more" onClick={() => revealAssistant()}>
                <Spark size={12} />
                <span>
                  <b>{queue.length - 1} more</b> in Assistant — the number on its icon
                </span>
                <Icon name="chevr" size={12} />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
