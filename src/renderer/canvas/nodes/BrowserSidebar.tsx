// The settings sidebar of a Browser (worfy-browser ticket 18): a panel over the right side of the
// frame's body, opened by the button right of the address bar. It covers the page as any Node or menu
// over the frame does, and takes the mouse and the wheel for itself. Each setting is a <fieldset> of
// its own, so the next ones (clear this site's cookies or localStorage, save a response from the
// Network tab — the owner's ideas for later) go in under the first. The first one is the page
// viewport: «Fit to card» — the page is as large as the frame's body — or a width × height of its own,
// ready-made or typed (browser-viewport.ts, ADR-0087). Only the page's width and height change, so the
// ready sizes are named by their size, not by a device. The choice goes into the Node's data as
// `data.viewport` through a Layout operation, as the address does; «Fit to card» writes null.
// The sidebar takes the keyboard focus when it opens, so Esc closes it at once.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useLayoutOps } from '../useLayout'
import { BROWSER_VIEWPORT_MAX, BROWSER_VIEWPORT_MIN, BROWSER_VIEWPORT_PRESETS, viewportSide, type BrowserPageViewport } from './browser-viewport'

/** The page viewport setting: «Fit to card», a ready size, or a size of its own. */
function ViewportSetting({ id, viewport }: { id: string; viewport: BrowserPageViewport | null }) {
  const ops = useLayoutOps()
  const name = useId()
  const preset = viewport === null ? -1 : BROWSER_VIEWPORT_PRESETS.findIndex((each) => each.w === viewport.w && each.h === viewport.h)
  /** «Custom» picked and not applied yet: the fields show, nothing is written. */
  const [customPicked, setCustomPicked] = useState(false)
  const custom = customPicked || (viewport !== null && preset === -1)
  const [typed, setTyped] = useState({ w: String(viewport?.w ?? 1440), h: String(viewport?.h ?? 900) })
  const w = viewportSide(Number(typed.w))
  const h = viewportSide(Number(typed.h))

  const write = (next: BrowserPageViewport | null) => {
    setCustomPicked(false)
    if (next?.w === viewport?.w && next?.h === viewport?.h) return
    void ops.apply({ op: 'patchData', id, data: { viewport: next } })
  }
  const apply = (event: FormEvent) => {
    event.preventDefault()
    if (w !== null && h !== null) write({ w, h })
  }

  return (
    <fieldset className="w-browser-sidebar__setting" data-testid="browser-viewport-setting">
      <legend className="w-browser-sidebar__legend">Viewport</legend>
      <label className="w-browser-sidebar__choice">
        <input type="radio" name={name} data-testid="browser-viewport-card" checked={viewport === null && !custom} onChange={() => write(null)} />
        Fit to card
      </label>
      {BROWSER_VIEWPORT_PRESETS.map((each, index) => (
        <label key={`${each.w}x${each.h}`} className="w-browser-sidebar__choice">
          <input type="radio" name={name} data-testid={`browser-viewport-${each.w}x${each.h}`} checked={!custom && preset === index} onChange={() => write({ w: each.w, h: each.h })} />
          <span className="w-mono">
            {each.w} × {each.h}
          </span>
        </label>
      ))}
      <label className="w-browser-sidebar__choice">
        <input type="radio" name={name} data-testid="browser-viewport-custom" checked={custom} onChange={() => setCustomPicked(true)} />
        Custom
      </label>
      {custom ? (
        <form className="w-browser-sidebar__custom" onSubmit={apply}>
          <input
            type="number"
            className="w-browser-sidebar__number w-mono"
            data-testid="browser-viewport-width"
            aria-label="Viewport width"
            min={BROWSER_VIEWPORT_MIN}
            max={BROWSER_VIEWPORT_MAX}
            step={1}
            value={typed.w}
            aria-invalid={w === null}
            onChange={(event) => setTyped({ ...typed, w: event.currentTarget.value })}
          />
          <span aria-hidden="true">×</span>
          <input
            type="number"
            className="w-browser-sidebar__number w-mono"
            data-testid="browser-viewport-height"
            aria-label="Viewport height"
            min={BROWSER_VIEWPORT_MIN}
            max={BROWSER_VIEWPORT_MAX}
            step={1}
            value={typed.h}
            aria-invalid={h === null}
            onChange={(event) => setTyped({ ...typed, h: event.currentTarget.value })}
          />
          <button type="submit" className="w-browser-frame__open-button" data-testid="browser-viewport-apply" disabled={w === null || h === null}>
            Apply
          </button>
        </form>
      ) : null}
      <p className="w-browser-sidebar__hint">
        {viewport === null ? 'The page is as large as the card.' : `The page is ${viewport.w} × ${viewport.h} px, scaled into the card.`}{' '}
        {'Only the width and height of the page change: no device is emulated.'}
      </p>
    </fieldset>
  )
}

/** The sidebar of Browser `id`; Esc or its close button closes it. */
export function BrowserSidebar({ id, viewport, onClose }: { id: string; viewport: BrowserPageViewport | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  // Opened from the header's button, the focus would stay there and Esc would go to the Canvas.
  useEffect(() => {
    const radios = [...(panel.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]
    const chosen = radios.find((radio) => radio.checked)
    if (chosen !== undefined) chosen.focus()
    else panel.current?.focus()
  }, [])
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="w-browser-sidebar nodrag nowheel nopan"
      data-testid="browser-sidebar"
      aria-label="Browser settings"
      onKeyDown={(event) => {
        // Esc closes the sidebar and nothing else (the Esc of an active Node, of Focus mode).
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="w-browser-sidebar__head">
        <span className="w-browser-sidebar__title">Browser settings</span>
        <button type="button" className="w-browser-frame__nav-button" data-testid="browser-sidebar-close" aria-label="Close" title="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <ViewportSetting id={id} viewport={viewport} />
    </aside>
  )
}
