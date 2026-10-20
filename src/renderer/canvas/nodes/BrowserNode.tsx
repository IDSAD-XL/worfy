import { useState } from 'react'
import { useReadOnly } from '../../projects/useProjects'
import { useLayoutOps } from '../useLayout'
import { BROWSER_HEADER_HEIGHT, addressUrl, browserUrl, navigateBrowserPage } from './browser-frame'
import type { CanvasNodeProps } from './index'
import './BrowserNode.css'

// A Browser Node (ADR-0078): a frame with a header that holds the address bar. The page itself is
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

export default function BrowserNode({ id, data }: CanvasNodeProps) {
  return (
    <div className="w-node-surface w-browser-frame" data-testid="browser-frame" data-node-id={id}>
      <div className="w-browser-frame__header" style={{ height: BROWSER_HEADER_HEIGHT }}>
        <span className="w-browser-frame__title">Browser</span>
        <AddressBar id={id} url={browserUrl(data.node)} />
      </div>
      <div className="w-browser-frame__body" data-testid="browser-frame-body" />
    </div>
  )
}
