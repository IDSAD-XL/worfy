// The Projects of this Machine that screens of Linked machines show (worfy-link ticket 09,
// src/main/projects/holds.ts): held per client and screen, let go when the screen shows none or
// the client leaves the registry of clients.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ProjectHolds } from '../../src/main/projects/holds'

class FakeClient extends EventEmitter {
  private gone = false
  constructor(readonly id: string) {
    super()
  }
  isDestroyed(): boolean {
    return this.gone
  }
  destroy(): void {
    this.gone = true
    this.emit('destroyed')
  }
}

describe('ProjectHolds', () => {
  it('holds a Project while some screen of some client shows it', () => {
    const holds = new ProjectHolds()
    const changes: string[][] = []
    holds.onChange(() => changes.push([...holds.projectIds()].sort()))
    const a = new FakeClient('link:a/1')
    const b = new FakeClient('link:b/2')
    expect(holds.set(a, '1', 'demo')).toBe(true)
    expect(holds.set(a, '2', 'other')).toBe(true)
    expect(holds.set(b, '1', 'demo')).toBe(true)
    // The same again changes nothing.
    expect(holds.set(a, '1', 'demo')).toBe(true)
    expect(changes).toEqual([['demo'], ['demo', 'other'], ['demo', 'other']])
    holds.set(a, '1', null)
    expect([...holds.projectIds()].sort()).toEqual(['demo', 'other'])
    holds.set(b, '1', null)
    expect([...holds.projectIds()]).toEqual(['other'])
    // Letting go of a screen that holds nothing changes nothing.
    holds.set(b, '9', null)
    expect(changes).toHaveLength(5)
  })

  it('lets go of everything a client held when it leaves, and refuses a client already gone', () => {
    const holds = new ProjectHolds()
    const a = new FakeClient('link:a/1')
    holds.set(a, '1', 'demo')
    holds.set(a, '2', 'other')
    a.destroy()
    expect([...holds.projectIds()]).toEqual([])
    expect(holds.set(a, '1', 'demo')).toBe(false)
    expect([...holds.projectIds()]).toEqual([])
  })

  it('a new client under an old id takes over: the old one held nothing of the new one', () => {
    const holds = new ProjectHolds()
    const before = new FakeClient('link:a/1')
    holds.set(before, '1', 'demo')
    const after = new FakeClient('link:a/1')
    holds.set(after, '2', 'other')
    expect([...holds.projectIds()]).toEqual(['other'])
    // The old client's late `destroyed` does not end the new one's hold.
    before.destroy()
    expect([...holds.projectIds()]).toEqual(['other'])
  })
})
