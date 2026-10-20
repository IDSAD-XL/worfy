// The check of every <webview> that asks to attach to a page of worfy (ADR-0078 item 3). The guest
// page of a Browser is any site, so it attaches with none of the app's powers: no preload, no Node
// in the page or its frames, an isolated and sandboxed renderer, and only on a Browser partition,
// never on the app's own session. Nor with anything that weakens the page itself: web security
// stays on, and no insecure content, Blink or experimental features, plugins or nested <webview>s. main runs it in `will-attach-webview` (installWebPolicy,
// src/main/window.ts) and destroys the guest when it refuses.
//
// A pure function of what Electron hands to the event, so it is tested without Electron.

/** The preferences of `will-attach-webview` the check reads: Electron's WebPreferences, as far as they matter here. */
export interface WebviewPreferences {
  preload?: string
  nodeIntegration?: boolean
  nodeIntegrationInSubFrames?: boolean
  contextIsolation?: boolean
  sandbox?: boolean
  partition?: string
  webSecurity?: boolean
  allowRunningInsecureContent?: boolean
  enableBlinkFeatures?: string
  experimentalFeatures?: boolean
  plugins?: boolean
  webviewTag?: boolean
}

/** The preferences that weaken the guest page unless they are absent or false. */
const OFF_ONLY = ['allowRunningInsecureContent', 'experimentalFeatures', 'plugins', 'webviewTag'] as const

/** What `will-attach-webview` gives the check: the guest's preferences and the <webview> element's parameters. */
export interface WebviewAttach {
  webPreferences: WebviewPreferences
  params: Record<string, string>
}

/**
 * Why the <webview> may not attach, or null when it may. `partitions` are the partitions of the
 * Browsers; the guest's own partition must be one of them. The partition and the security options
 * are read from the preferences, which are what the guest really gets (the `webpreferences`
 * attribute can override the `partition` attribute). A missing contextIsolation or sandbox counts
 * as off: Electron sets both from the embedder, so a guest without them did not inherit them.
 *
 * The preferences that weaken the page pass only with their safe value or when absent (Electron's
 * default is then the safe one), never with anything else: the `webpreferences` attribute can hand
 * them any string, and Electron reads a string as a truthy or falsy boolean, so `webSecurity=` would
 * turn web security off and `plugins=maybe` would turn plugins on.
 */
export function webviewAttachRefusal({ webPreferences, params }: WebviewAttach, partitions: readonly string[]): string | null {
  if ((webPreferences.preload ?? '') !== '' || (params.preload ?? '') !== '') return 'a <webview> may not have a preload'
  if (webPreferences.nodeIntegration === true) return 'a <webview> may not have nodeIntegration'
  if (webPreferences.nodeIntegrationInSubFrames === true) return 'a <webview> may not have nodeIntegrationInSubFrames'
  if (webPreferences.contextIsolation !== true) return 'a <webview> must have contextIsolation'
  if (webPreferences.sandbox !== true) return 'a <webview> must have the sandbox'
  if (webPreferences.webSecurity !== undefined && webPreferences.webSecurity !== true) return 'a <webview> must have webSecurity'
  for (const key of OFF_ONLY) {
    if (webPreferences[key] !== undefined && webPreferences[key] !== false) return `a <webview> may not have ${key}`
  }
  if ((webPreferences.enableBlinkFeatures ?? '') !== '') return 'a <webview> may not have enableBlinkFeatures'
  const partition = webPreferences.partition ?? ''
  if (!partitions.includes(partition)) return `a <webview> may attach only on a Browser partition, not ${JSON.stringify(partition)}`
  return null
}
