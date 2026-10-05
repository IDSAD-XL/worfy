// Search over the Canvas (⌘F) and the Canvas side of the command palette (ticket 31). The code
// lives in src/renderer/find/CanvasFind.tsx; this file only makes it a Canvas overlay, which the
// Canvas finds by file name (canvas/extensions.ts).
export { default, order } from '../../find/CanvasFind'
