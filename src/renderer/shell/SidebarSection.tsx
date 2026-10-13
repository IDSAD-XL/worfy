import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import './sidebar-section.css'

export interface SidebarSectionProps {
  /**
   * The section's id: the name of its file without the extension (`EpicsSection`), as
   * ShellExtension.id. It is the key of `sidebar.collapsed` in the app settings.
   */
  id: string
  /** The text of the heading, and the name of the region. */
  title: string
  /**
   * The height of one row of the section's list, in px, when it is not the common row
   * (`--row-height`). The list is 3 to 15 of these rows high (sidebar-section.css).
   */
  rowHeight?: number
  /** Whether the section is collapsed while the app settings have no key for it. */
  defaultCollapsed?: boolean
  /** Shown right after the heading: a count. A click on it does not collapse the section. */
  meta?: ReactNode
  /** Shown at the right edge of the header: the section's own buttons. They do not collapse it. */
  trailing?: ReactNode
  /** A message about an action of the header, above the list. A collapsed section shows it too. */
  notice?: ReactNode
  /** Popovers, menus and dialogs of the section. They are outside the body, so a collapsed section shows them too. */
  overlay?: ReactNode
  testId?: string
  /** The body: the list, with whatever belongs under it. It scrolls by itself and is hidden while collapsed. */
  children?: ReactNode
}

const chevron = (collapsed: boolean) => (
  <svg className="w-sidebar-section__chevron" width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* Right while collapsed, down while expanded. */}
    <path d={collapsed ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'} />
  </svg>
)

/**
 * The frame every sidebar section is drawn in: a region named by its heading, the heading a button
 * that collapses and expands the section, and the body under it.
 *
 * Collapsed or not is `sidebar.collapsed[id]` of the app settings: it outlives the window and is
 * the same in every window of this Machine. A collapsed body stays in the DOM with `hidden`.
 */
export function SidebarSection({ id, title, rowHeight, defaultCollapsed = false, meta, trailing, notice, overlay, testId, children }: SidebarSectionProps) {
  const headingId = useId()
  const bodyId = useId()
  const saved = useAppSettings((settings) => settings.sidebar.collapsed[id])
  // What the last click asked for, while its write is on its way to main or was refused. It is shown
  // at once, and a refusal (app-settings.json cannot be written) does not leave the button dead.
  const [clicked, setClicked] = useState<boolean | null>(null)
  const clicks = useRef(0)
  const collapsed = clicked ?? saved ?? defaultCollapsed

  const toggle = () => {
    const next = !collapsed
    const click = ++clicks.current
    setClicked(next)
    void setAppSettings({ sidebar: { collapsed: { [id]: next } } }).then((refused) => {
      // The answer to an earlier click: a later one decides.
      if (click !== clicks.current) return
      // Saved: the settings say it now, and a change made in another window is followed again.
      if (refused === undefined) setClicked(null)
      else console.error(`appSettings.set failed, the ${title} section stays ${next ? 'collapsed' : 'expanded'} in this window only:`, refused)
    })
  }

  const style = rowHeight === undefined ? undefined : ({ '--w-section-row': `${rowHeight}px` } as CSSProperties)

  return (
    <section className="w-sidebar-section" aria-labelledby={headingId} data-section-id={id} data-collapsed={collapsed ? 'true' : undefined} data-testid={testId} style={style}>
      <div className="w-sidebar-section__header">
        <h2 id={headingId} className="w-sidebar-section__heading">
          <button type="button" className="w-sidebar-section__toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
            {chevron(collapsed)}
            {title}
          </button>
        </h2>
        {meta !== undefined && meta !== null ? <span className="w-sidebar-section__meta">{meta}</span> : null}
        {trailing !== undefined && trailing !== null ? <span className="w-sidebar-section__trailing">{trailing}</span> : null}
      </div>
      <div className="w-sidebar-section__notice">{notice}</div>
      {/* No height of its own: a popover placed against the section starts here, under the header. */}
      <div className="w-sidebar-section__overlay">{overlay}</div>
      <div id={bodyId} className="w-sidebar-section__body" hidden={collapsed}>
        {children}
      </div>
    </section>
  )
}
