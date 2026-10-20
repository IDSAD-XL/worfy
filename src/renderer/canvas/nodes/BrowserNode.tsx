import { useState } from 'react'
import { useReadOnly } from '../../projects/useProjects'
import { useLayoutOps } from '../useLayout'
import { BROWSER_HEADER_HEIGHT, addressUrl, browserUrl, navigateBrowserPage, stepBrowserPage, useBrowserHistory } from './browser-frame'
import type { CanvasNodeProps } from './index'
import './BrowserNode.css'

// A Browser Node (ADR-0078): a frame with a header that holds the back, forward and reload buttons
// and the address bar. The page itself is
// not drawn here but by the Browser layer (../overlays/BrowserLayer.tsx), under the frame's body,
// at browserPageRect() of the frame. The body is transparent and lets the mouse through, so the
// page shows and takes the mouse through it, and any Node or menu over the frame covers the page.
// The frame has the neutral colours of a surface: no minimapColor, no kind-* role (ADR-0077 item 2).
// The same kind as BROWSER_KIND of browser-frame.ts: a literal here, as fast refresh wants.
export const kind = 'browser'
export const defaultWidth = 640
export const defaultHeight = 440
export const createLabel = 'New browser'

/**
 * The address bar: it shows the address the Node keeps in `data.url` and, on Enter, sends the page
 * to the typed address and keeps it there. The address goes into the Node's data as a `patchData`
 * that is not a step of ⌘Z (history.ts): typing an address is not a gesture over the Node. A new
 * Browser has no address and shows an empty page.
 */
function AddressBar({ id, url }: { id: string; url: string | null }) {
  const ops = useLayoutOps()
  // On a read-only screen (worfy-link ticket 25) the address is shown and cannot be changed.
  const readOnly = useReadOnly()
  /** What is being typed, while the bar has the focus; null otherwise. */
  const [draft, setDraft] = useState<string | null>(null)
  /** The address sent last and the Node's address then: shown until the Node's address changes. */
  const [sent, setSent] = useState<{ address: string; over: string | null } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const shown = sent !== null && sent.over === url ? sent.address : url

  const go = (input: HTMLInputElement) => {
    const next = addressUrl(draft ?? '')
    if (next === null) {
      setInvalid(true)
      return
    }
    setSent({ address: next, over: url })
    setDraft(null)
    input.blur()
    navigateBrowserPage(id, next)
    if (next !== url) void ops.apply({ op: 'patchData', id, data: { url: next } })
  }

  return (
    <input
      className="w-browser-frame__address w-mono nodrag"
      data-testid="browser-address"
      aria-label="Address"
      aria-invalid={invalid}
      placeholder="Enter an address"
      spellCheck={false}
      autoComplete="off"
      value={draft ?? shown ?? ''}
      readOnly={readOnly !== null}
      title={readOnly ?? undefined}
      onFocus={(event) => {
        if (readOnly !== null) return
        setDraft(event.currentTarget.value)
        event.currentTarget.select()
      }}
      onChange={(event) => {
        setInvalid(false)
        setDraft(event.currentTarget.value)
      }}
      onBlur={() => {
        setDraft(null)
        setInvalid(false)
      }}
      onKeyDown={(event) => {
        if (readOnly !== null) return
        if (event.key === 'Enter') {
          event.preventDefault()
          go(event.currentTarget)
        } else if (event.key === 'Escape') {
          // Esc leaves the bar as it was and does nothing else (the Esc of an active Node, of Focus mode).
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** The paths of the buttons' icons, in a 16 × 16 box. */
const NAV_ICONS = {
  back: 'M10 3.5L5.5 8l4.5 4.5',
  forward: 'M6 3.5L10.5 8 6 12.5',
  reload: 'M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3',
} as const

/**
 * Back, forward and reload of the page, left of the address bar (worfy-browser ticket 10). Back
 * and forward are inactive when the page has nowhere to go that way; all three are inactive while
 * this window has no ready page for the Browser.
 */
function NavButtons({ id }: { id: string }) {
  const history = useBrowserHistory(id)
  const buttons = [
    { step: 'back', label: 'Back', enabled: history?.canGoBack === true },
    { step: 'forward', label: 'Forward', enabled: history?.canGoForward === true },
    { step: 'reload', label: 'Reload', enabled: history !== undefined },
  ] as const
  return (
    <span className="w-browser-frame__nav">
      {buttons.map(({ step, label, enabled }) => (
        <button
          key={step}
          type="button"
          className="w-browser-frame__nav-button nodrag"
          data-testid={`browser-${step}`}
          aria-label={label}
          title={label}
          disabled={!enabled}
          onClick={() => stepBrowserPage(id, step)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={NAV_ICONS[step]} />
          </svg>
        </button>
      ))}
    </span>
  )
}

export default function BrowserNode({ id, data }: CanvasNodeProps) {
  return (
    <div className="w-node-surface w-browser-frame" data-testid="browser-frame" data-node-id={id}>
      <div className="w-browser-frame__header" style={{ height: BROWSER_HEADER_HEIGHT }}>
        <span className="w-browser-frame__title">Browser</span>
        <NavButtons id={id} />
        <AddressBar id={id} url={browserUrl(data.node)} />
      </div>
      <div className="w-browser-frame__body" data-testid="browser-frame-body" />
    </div>
  )
}
