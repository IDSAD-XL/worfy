// ClientHolders (src/main/clients.ts): every hub of main holds the windows it serves until their `destroyed`. A window
// subscribes to a dozen hubs, and Node warns at the 11th listener of one event of one emitter
// (MaxListenersExceededWarning, "11 destroyed listeners added to [WebContents]"): all holders of a client share one
// `destroyed` listener of it (worfy-acceptance ticket 05, where the Acceptance tab made the 11th hub of a window).
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ClientHolders, type ClientId } from '../../src/main/clients'

/** A client as a window's webContents is to main: an emitter with an id that can be destroyed. */
class FakeClient extends EventEmitter {
  destroyed = false
  constructor(readonly id: ClientId) {
    super()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

describe('ClientHolders', () => {
  it('twelve hubs that hold one window add one destroyed listener to it, and each hub still lets it go', () => {
    const client = new FakeClient(7)
    const left: string[] = []
    const hubs = Array.from({ length: 12 }, (_, index) => new ClientHolders((id) => left.push(`${index}:${String(id)}`)))
    for (const hub of hubs) expect(hub.hold(client)).toBe(true)
    expect(client.listenerCount('destroyed')).toBe(1)
    client.destroy()
    expect(left).toEqual(hubs.map((_, index) => `${index}:7`))
    for (const hub of hubs) expect(hub.ids()).toEqual([])
  })

  it('a client that takes over the id of an old one is not let go by the old one\'s late destroyed', () => {
    const old = new FakeClient('link:a')
    const next = new FakeClient('link:a')
    const left: ClientId[] = []
    const hub = new ClientHolders((id) => left.push(id))
    hub.hold(old)
    hub.hold(next)
    expect(left).toEqual(['link:a'])
    old.destroy()
    expect(left).toEqual(['link:a'])
    expect(hub.ids()).toEqual(['link:a'])
    next.destroy()
    expect(left).toEqual(['link:a', 'link:a'])
    expect(hub.ids()).toEqual([])
  })

  it('a destroyed client is not held', () => {
    const client = new FakeClient(3)
    client.destroyed = true
    expect(new ClientHolders(() => undefined).hold(client)).toBe(false)
    expect(client.listenerCount('destroyed')).toBe(0)
  })
})
