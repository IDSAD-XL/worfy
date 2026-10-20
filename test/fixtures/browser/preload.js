/* global document */
// A preload that test/e2e/browser-webview-guard.spec.ts asks a <webview> for. main must refuse the
// <webview> (src/main/browser/attach-policy.ts), so this never runs; if it did, the page would carry the mark.
document.addEventListener('DOMContentLoaded', () => {
  document.body.dataset.preloaded = 'yes'
})
