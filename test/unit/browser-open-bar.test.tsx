// The Open bar of a Browser Node (worfy-browser tickets 11 and 12, src/renderer/canvas/nodes/browser-frame.ts):
// how it shows a long address, and which frame a request from main lands in. main names the page that
// asked by its web contents id; every page of the Browser layer hears every request and keeps only its own.
// The bar on screen, in both themes, is driven in test/e2e/browser.spec.ts.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OPEN_BAR_ADDRESS_TAIL,
  dismissBrowserOpenRequest,
  offerOwnBrowserOpenRequest,
  openBarAddress,
  useBrowserOpenRequest,
} from '../../src/renderer/canvas/nodes/browser-frame'

describe('openBarAddress', () => {
  it('keeps a long host whole and cuts only the path, query and fragment', () => {
    const host = `bank.example.com.${'a'.repeat(60)}.evil.net`
    const url = `https://${host}/${'x'.repeat(80)}/bank.example.com/login?next=%2Fhome#top`
    const { site, head, tail } = openBarAddress(url)
    expect(site).toBe(`https://${host}`)
    expect(site.endsWith('.evil.net')).toBe(true)
    expect(tail).toBe(url.slice(-OPEN_BAR_ADDRESS_TAIL))
    expect(head).toBe(url.slice(site.length, -OPEN_BAR_ADDRESS_TAIL))
    expect(site + head + tail).toBe(url)
  })

  it('keeps the port with the host', () => {
    expect(openBarAddress('http://127.0.0.1:8123/next.html')).toEqual({ site: 'http://127.0.0.1:8123', head: '', tail: '/next.html' })
  })

  it('leaves a short path uncut', () => {
    expect(openBarAddress('https://example.com/')).toEqual({ site: 'https://example.com', head: '', tail: '/' })
  })

  it('does not show user info, which could pass for the host', () => {
    const { site, head, tail } = openBarAddress('https://bank.example.com:secret@evil.net/login')
    expect(site).toBe('https://evil.net')
    expect(head + tail).toBe('/login')
  })

  it('shows what is not a URL as a cut tail, with no host', () => {
    expect(openBarAddress('not a url')).toEqual({ site: '', head: '', tail: 'not a url' })
  })
})

describe('offerOwnBrowserOpenRequest', () => {
  const ids = ['browser-a', 'browser-b']
  afterEach(() => {
    for (const id of ids) act(() => dismissBrowserOpenRequest(id))
  })

  /** Two Browsers with their own web contents ids, each hearing every request, as the layer's pages do. */
  function twoBrowsers() {
    const own: Record<string, () => number> = { 'browser-a': () => 11, 'browser-b': () => 22 }
    const deliver = (request: { webContentsId: number; url: string }) =>
      act(() => {
        for (const id of ids) offerOwnBrowserOpenRequest(id, own[id]!, request)
      })
    const a = renderHook(() => useBrowserOpenRequest('browser-a'))
    const b = renderHook(() => useBrowserOpenRequest('browser-b'))
    return { deliver, a, b }
  }

  it("puts the bar on the Browser whose page asked, and not on the other one", () => {
    const { deliver, a, b } = twoBrowsers()
    deliver({ webContentsId: 22, url: 'https://example.com/b' })
    expect(b.result.current).toBe('https://example.com/b')
    expect(a.result.current).toBeUndefined()

    deliver({ webContentsId: 11, url: 'https://example.com/a' })
    expect(a.result.current).toBe('https://example.com/a')
    expect(b.result.current).toBe('https://example.com/b')
  })

  it('puts the bar on no Browser for a page none of them draws', () => {
    const { deliver, a, b } = twoBrowsers()
    deliver({ webContentsId: 33, url: 'https://example.com/c' })
    expect(a.result.current).toBeUndefined()
    expect(b.result.current).toBeUndefined()
  })

  it('ignores a request while the page has no web contents yet', () => {
    const a = renderHook(() => useBrowserOpenRequest('browser-a'))
    act(() =>
      offerOwnBrowserOpenRequest(
        'browser-a',
        () => {
          throw new Error('The WebView must be attached to the DOM')
        },
        { webContentsId: 11, url: 'https://example.com/a' },
      ),
    )
    expect(a.result.current).toBeUndefined()
  })
})
