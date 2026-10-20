import type { CanvasNodeProps } from './index'
import { BROWSER_HEADER_HEIGHT, browserUrl } from './browser-frame'
import './BrowserNode.css'

// A Browser Node (ADR-0078) as the prototype of the Browser layer draws it (worfy-browser ticket
// 01): an empty frame with a header. The page itself is not drawn here but by the Browser layer
// (../overlays/BrowserLayer.tsx), under the frame's body, at browserPageRect() of the frame. The
// body is transparent and lets the mouse through, so the page shows and takes the mouse through
// it, and any Node or menu over the frame covers the page. No `createLabel`: the Canvas menu does
// not offer the Node yet, only a test puts one into the Layout.
// The same kind as BROWSER_KIND of browser-frame.ts: a literal here, as fast refresh wants.
export const kind = 'browser'
export const defaultWidth = 640
export const defaultHeight = 440

export default function BrowserNode({ id, data }: CanvasNodeProps) {
  const url = browserUrl(data.node)
  return (
    <div className="w-node-surface w-browser-frame" data-testid="browser-frame" data-node-id={id}>
      <div className="w-browser-frame__header" style={{ height: BROWSER_HEADER_HEIGHT }}>
        <span className="w-browser-frame__title">Browser</span>
        <span className="w-browser-frame__url w-mono">{url === null ? 'No address' : new URL(url).host}</span>
      </div>
      <div className="w-browser-frame__body" data-testid="browser-frame-body" />
    </div>
  )
}
