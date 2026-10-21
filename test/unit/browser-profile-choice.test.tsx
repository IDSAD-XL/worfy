// Which Browser profile a Browser Node is opened under (worfy-browser ticket 03; browserProfileChoice,
// src/renderer/canvas/nodes/browser-frame.ts): the profile the Node keeps; for a Node without one, an
// old Browser (a page address) stays on `default` and a new one takes the only profile or asks.
import { describe, expect, it } from 'vitest'
import { browserProfileChoice } from '../../src/renderer/canvas/nodes/browser-frame'

describe('which Browser profile a Browser Node is opened under (browserProfileChoice)', () => {
  const p = (...ids: string[]) => ids.map((id) => ({ id }))
  const page = 'http://127.0.0.1:3000/page.html'

  it('waits while the profiles are not read', () => {
    expect(browserProfileChoice({ profile: 'default', url: page }, undefined)).toEqual({ kind: 'loading' })
  })

  it('opens the profile the Node keeps, and asks for another when it was deleted (the owner\'s decision 3)', () => {
    expect(browserProfileChoice({ profile: 'admin-aaaaaa' }, p('default', 'admin-aaaaaa'))).toEqual({ kind: 'use', id: 'admin-aaaaaa', write: false })
    expect(browserProfileChoice({ profile: 'admin-aaaaaa', url: page }, p('default'))).toEqual({ kind: 'choose', reason: 'deleted' })
    // Deleted even when only one profile is left: the Browser does not move to it by itself.
    expect(browserProfileChoice({ profile: 'gone-000000' }, p('user-bbbbbb'))).toEqual({ kind: 'choose', reason: 'deleted' })
  })

  it('keeps a Browser opened before profiles existed — one with a page address — on `default` while it exists, and writes it into the Node', () => {
    expect(browserProfileChoice({ url: page }, p('default', 'admin-aaaaaa', 'user-bbbbbb'))).toEqual({ kind: 'use', id: 'default', write: true })
    expect(browserProfileChoice({ url: page }, p('default'))).toEqual({ kind: 'use', id: 'default', write: true })
  })

  it('takes the only profile for a new Browser (no address) and writes it; with several or none the frame asks', () => {
    expect(browserProfileChoice({}, p('default'))).toEqual({ kind: 'use', id: 'default', write: true })
    expect(browserProfileChoice({}, p('admin-aaaaaa'))).toEqual({ kind: 'use', id: 'admin-aaaaaa', write: true })
    expect(browserProfileChoice({}, p('default', 'admin-aaaaaa'))).toEqual({ kind: 'choose', reason: 'several' })
    expect(browserProfileChoice({}, p())).toEqual({ kind: 'choose', reason: 'none' })
  })

  it('counts an empty address and one that is not http(s) as no address', () => {
    for (const url of ['', 'about:blank', 'file:///etc/passwd', 'worfy-card://x/', 'not a url', 42, null]) {
      expect(browserProfileChoice({ url }, p('default', 'admin-aaaaaa')), String(url)).toEqual({ kind: 'choose', reason: 'several' })
    }
  })

  it('treats a profile that is not a string as none', () => {
    for (const profile of [null, 7, { id: 'default' }]) expect(browserProfileChoice({ profile }, p('default', 'admin-aaaaaa')), JSON.stringify(profile)).toEqual({ kind: 'choose', reason: 'several' })
  })

  it('a Browser with a page whose `default` was deleted asks, as any Browser of a deleted profile does, even with one profile left', () => {
    expect(browserProfileChoice({ url: page }, p('admin-aaaaaa'))).toEqual({ kind: 'choose', reason: 'deleted' })
    expect(browserProfileChoice({ url: page }, p('admin-aaaaaa', 'user-bbbbbb'))).toEqual({ kind: 'choose', reason: 'deleted' })
    expect(browserProfileChoice({ url: page }, p())).toEqual({ kind: 'choose', reason: 'deleted' })
  })
})
