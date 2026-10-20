// The partition of the Browsers' pages (ADR-0078 item 3), shared by main, which lets a <webview>
// attach only on it and denies its pages every permission (src/main/window.ts), and the Browser
// layer, which puts it on every <webview> (src/renderer/canvas/overlays/BrowserLayer.tsx).

/**
 * The one partition of every Browser until Browser profiles exist (worfy-browser ticket 03). It
 * has no `persist:` prefix: the session lives in memory and its cookies and storage are gone after
 * a restart; the Browser keeps only its address. The owner's answer to open question 1 of
 * worfy-browser ticket 02 may switch it to a `persist:` partition.
 */
export const BROWSER_PARTITION = 'worfy-browser'

/** Every partition a <webview> may attach on. Browser profiles (ticket 03) add theirs here. */
export const BROWSER_PARTITIONS: readonly string[] = [BROWSER_PARTITION]
