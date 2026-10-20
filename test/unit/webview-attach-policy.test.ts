// The check main runs on every <webview> that asks to attach (src/main/browser/attach-policy.ts,
// ADR-0078 item 3): the guest page gets no preload, no Node, an isolated and sandboxed renderer,
// and only a Browser partition. The preferences here are the ones Electron hands to
// `will-attach-webview`: what the <webview> element's attributes ask for, after the embedder's
// security options were inherited.
import { describe, expect, it } from 'vitest'
import { webviewAttachRefusal, type WebviewAttach } from '../../src/main/browser/attach-policy'

const PARTITIONS = ['worfy-browser-test']

/** What a correct <webview> of the Browser layer attaches with. */
function good(): WebviewAttach {
  return {
    webPreferences: { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, partition: 'worfy-browser-test' },
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
  })
})
