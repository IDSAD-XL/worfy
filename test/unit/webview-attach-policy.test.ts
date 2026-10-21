// The check main runs on every <webview> that asks to attach (src/main/browser/attach-policy.ts,
// ADR-0078 item 3): the guest page gets no preload, no Node, an isolated and sandboxed renderer,
// only a Browser partition, and nothing that weakens the page (web security off, insecure content,
// Blink or experimental features, plugins, a nested <webview>). The preferences here are the ones Electron hands to
// `will-attach-webview`: what the <webview> element's attributes ask for, after the embedder's
// security options were inherited.
import { describe, expect, it } from 'vitest'
import { webviewAttachRefusal, type WebviewAttach } from '../../src/main/browser/attach-policy'
import { browserPartition, browserPartitions } from '../../src/shared/browser/partition'

const PARTITIONS = ['worfy-browser-test']

/** What a correct <webview> of the Browser layer attaches with. */
function good(): WebviewAttach {
  return {
    // webSecurity, plugins and enableBlinkFeatures as Electron fills them from a <webview> without
    // the disablewebsecurity, plugins and blinkfeatures attributes.
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'worfy-browser-test',
      webSecurity: true,
      plugins: false,
      enableBlinkFeatures: '',
    },
    params: { src: 'http://127.0.0.1:8080/page.html', partition: 'worfy-browser-test' },
  }
}

const refused = (attach: WebviewAttach, partitions: readonly string[] = PARTITIONS): boolean => webviewAttachRefusal(attach, partitions) !== null

describe('webviewAttachRefusal', () => {
  it('refuses a <webview> with a preload, whether it comes as a preference or as the attribute', () => {
    const withPreference = good()
    withPreference.webPreferences.preload = '/tmp/evil.js'
    expect(webviewAttachRefusal(withPreference, PARTITIONS)).toMatch(/preload/)
    const withAttribute = good()
    withAttribute.params.preload = 'file:///tmp/evil.js'
    expect(webviewAttachRefusal(withAttribute, PARTITIONS)).toMatch(/preload/)
  })

  it('refuses a <webview> with Node, in the page or in its frames', () => {
    const node = good()
    node.webPreferences.nodeIntegration = true
    expect(webviewAttachRefusal(node, PARTITIONS)).toMatch(/nodeIntegration/)
    const frames = good()
    frames.webPreferences.nodeIntegrationInSubFrames = true
    expect(webviewAttachRefusal(frames, PARTITIONS)).toMatch(/nodeIntegrationInSubFrames/)
  })

  it('refuses a <webview> without context isolation or without the sandbox, also when the preference is missing', () => {
    for (const key of ['contextIsolation', 'sandbox'] as const) {
      const off = good()
      off.webPreferences[key] = false
      expect(webviewAttachRefusal(off, PARTITIONS), key).toMatch(new RegExp(key))
      const missing = good()
      delete missing.webPreferences[key]
      expect(refused(missing), `${key} missing`).toBe(true)
    }
  })

  it('refuses a <webview> with web security off (the disablewebsecurity attribute, webSecurity=no)', () => {
    const off = good()
    off.webPreferences.webSecurity = false
    expect(webviewAttachRefusal(off, PARTITIONS)).toMatch(/webSecurity/)
  })

  it('refuses a <webview> whose webSecurity is not a boolean: Electron reads an empty string as off', () => {
    const odd = good()
    odd.webPreferences.webSecurity = '' as unknown as boolean
    expect(webviewAttachRefusal(odd, PARTITIONS)).toMatch(/webSecurity/)
  })

  it('refuses a <webview> that runs insecure content', () => {
    const insecure = good()
    insecure.webPreferences.allowRunningInsecureContent = true
    expect(webviewAttachRefusal(insecure, PARTITIONS)).toMatch(/allowRunningInsecureContent/)
  })

  it('refuses a <webview> with Blink features turned on (the blinkfeatures attribute)', () => {
    const blink = good()
    blink.webPreferences.enableBlinkFeatures = 'CSSPseudoHas'
    expect(webviewAttachRefusal(blink, PARTITIONS)).toMatch(/enableBlinkFeatures/)
  })

  it('refuses a <webview> with experimental features', () => {
    const experimental = good()
    experimental.webPreferences.experimentalFeatures = true
    expect(webviewAttachRefusal(experimental, PARTITIONS)).toMatch(/experimentalFeatures/)
  })

  it('refuses a <webview> with plugins (the plugins attribute)', () => {
    const plugins = good()
    plugins.webPreferences.plugins = true
    expect(webviewAttachRefusal(plugins, PARTITIONS)).toMatch(/plugins/)
  })

  it('refuses a <webview> whose page may itself hold a <webview>', () => {
    const nested = good()
    nested.webPreferences.webviewTag = true
    expect(webviewAttachRefusal(nested, PARTITIONS)).toMatch(/webviewTag/)
  })

  it('refuses a weakening preference given as a string, which Electron reads as a truthy boolean', () => {
    for (const key of ['allowRunningInsecureContent', 'experimentalFeatures', 'plugins', 'webviewTag'] as const) {
      const odd = good()
      odd.webPreferences[key] = 'maybe' as unknown as boolean
      expect(webviewAttachRefusal(odd, PARTITIONS), key).toMatch(new RegExp(key))
    }
  })

  it('refuses a partition that is not in the list: another one, a persist: twin, the default (empty or missing)', () => {
    for (const partition of ['persist:worfy-browser-test', 'other', '', undefined]) {
      const attach = good()
      if (partition === undefined) delete attach.webPreferences.partition
      else attach.webPreferences.partition = partition
      expect(webviewAttachRefusal(attach, PARTITIONS), String(partition)).toMatch(/partition/)
    }
  })

  it('checks the partition the guest really gets: the preferences, not the attribute', () => {
    const attach = good()
    attach.params.partition = 'worfy-browser-test'
    attach.webPreferences.partition = 'other'
    expect(refused(attach)).toBe(true)
  })

  it('refuses every partition when the list is empty', () => {
    expect(refused(good(), [])).toBe(true)
  })

  it('allows a <webview> without a preload, without Node, isolated, sandboxed, on a partition of the list', () => {
    expect(webviewAttachRefusal(good(), PARTITIONS)).toBeNull()
    // An empty preload attribute is no preload.
    const empty = good()
    empty.params.preload = ''
    expect(webviewAttachRefusal(empty, PARTITIONS)).toBeNull()
    // Any partition of the list, not only the first.
    const second = good()
    second.webPreferences.partition = 'b'
    expect(webviewAttachRefusal(second, ['a', 'b'])).toBeNull()
    // The weakening preferences absent (Electron's defaults are the safe ones) or set to their safe value.
    const absent = good()
    delete absent.webPreferences.webSecurity
    delete absent.webPreferences.plugins
    delete absent.webPreferences.enableBlinkFeatures
    expect(webviewAttachRefusal(absent, PARTITIONS)).toBeNull()
    const safe = good()
    Object.assign(safe.webPreferences, { allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false })
    expect(webviewAttachRefusal(safe, PARTITIONS)).toBeNull()
  })
})

// worfy-browser ticket 03: the list main hands the check is the partitions of the Browser profiles
// of the Projects of this Machine (browserProfilePartitions, src/main/browser/profiles.ts).
describe('webviewAttachRefusal over the partitions of Browser profiles', () => {
  const ALPHA = 'alpha-0a1b2c3d'
  const BETA = 'beta-99999999'
  /** alpha has Default and admin; beta is not a Project of this Machine; user was deleted from alpha. */
  const partitions = browserPartitions([ALPHA], () => ['default', 'admin-aaaaaa'])
  const on = (partition: string | null): WebviewAttach => {
    const attach = good()
    attach.webPreferences.partition = partition ?? ''
    attach.params.partition = partition ?? ''
    return attach
  }

  it('lets a <webview> attach on a profile of a Project of this Machine', () => {
    expect(webviewAttachRefusal(on(browserPartition(ALPHA, 'default')), partitions)).toBeNull()
    expect(webviewAttachRefusal(on(browserPartition(ALPHA, 'admin-aaaaaa')), partitions)).toBeNull()
  })

  it('refuses the partition of another Project, also under a profile id this Project has', () => {
    expect(webviewAttachRefusal(on(browserPartition(BETA, 'default')), partitions)).toMatch(/only on a Browser partition/)
    expect(webviewAttachRefusal(on(browserPartition(BETA, 'admin-aaaaaa')), partitions)).toMatch(/only on a Browser partition/)
  })

  it('refuses the partition of a deleted Browser profile', () => {
    expect(webviewAttachRefusal(on(browserPartition(ALPHA, 'user-bbbbbb')), partitions)).toMatch(/only on a Browser partition/)
    // Once a profile is deleted, the list main reads at the next attach no longer holds it.
    const afterDelete = browserPartitions([ALPHA], () => ['default'])
    expect(webviewAttachRefusal(on(browserPartition(ALPHA, 'admin-aaaaaa')), afterDelete)).toMatch(/only on a Browser partition/)
  })
})
