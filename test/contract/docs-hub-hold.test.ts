// DocsHub.hold (src/main/docs/watch.ts): "Remove project…" (worfy-polish ticket 79, src/main/projects/remove.ts) closes
// the documents watch of a Project while the Harness renames its Profile folder (Windows refuses that while a
// watch holds a folder inside it), then watches again. A real folder and the real recursive watch.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsHub, DocsWatcher } from '../../src/main/docs/watch'
import type { DocsState } from '../../src/shared/ipc/docs'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

let root: string
let hub: DocsHub

const pause = (wait: number): Promise<void> => new Promise((done) => setTimeout(done, wait))

async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + ms(5000)
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await pause(10)
  }
}

const withHandoff = (states: readonly DocsState[]): DocsState[] => states.filter((state) => state.handoff !== null)

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-hold-')))
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  hub = new DocsHub({ debounceMs: 20 })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await hub.closeAll()
  removeTestTree(root)
})

describe('DocsHub.hold: the watch closes, the subscribers stay', () => {
  it('sends the state after the release, nothing while held, and follows changes again after it', async () => {
    const states: DocsState[] = []
    const first = await hub.open('p', root, { id: 1, send: (state) => void states.push(state) })
    expect(first.handoff).toBeNull()

    const watchAgain = await hub.hold('p')
    writeFileSync(join(root, 'HANDOFF.md'), '# Handoff\n\nFirst.\n')
    await pause(ms(500))
    expect(states).toStrictEqual([])

    await watchAgain()
    expect(withHandoff(states)).toHaveLength(1)
    writeFileSync(join(root, 'HANDOFF.md'), '# Handoff\n\nSecond.\n')
    await until('a change after the release', () => new Set(withHandoff(states).map((state) => state.handoff?.version)).size === 2)
  })

  it('two holds: the watch stays closed until both let go, then starts once; an open meanwhile starts nothing and gets the state too', async () => {
    const states: DocsState[] = []
    const later: DocsState[] = []
    await hub.open('p', root, { id: 1, send: (state) => void states.push(state) })
    const starts = vi.spyOn(DocsWatcher, 'start')

    const one = await hub.hold('p')
    const two = await hub.hold('p')
    const opened = await hub.open('p', root, { id: 2, send: (state) => void later.push(state) })
    expect(opened.projectId).toBe('p')
    expect(hub.projects).toStrictEqual(['p'])
    writeFileSync(join(root, 'HANDOFF.md'), '# Handoff\n\nWhile held.\n')
    await one()
    await one()
    await pause(ms(500))
    expect(starts).not.toHaveBeenCalled()
    expect(states).toStrictEqual([])

    await two()
    expect(starts).toHaveBeenCalledTimes(1)
    expect(withHandoff(states)).toHaveLength(1)
    expect(withHandoff(later)).toHaveLength(1)
  })

  it('the last subscriber leaving during a hold: nothing is watched again after the release', async () => {
    const states: DocsState[] = []
    await hub.open('p', root, { id: 1, send: (state) => void states.push(state) })
    const starts = vi.spyOn(DocsWatcher, 'start')

    const watchAgain = await hub.hold('p')
    expect(await hub.close('p', 1)).toBe(true)
    expect(hub.projects).toStrictEqual([])
    await watchAgain()
    expect(starts).not.toHaveBeenCalled()
    expect(hub.projects).toStrictEqual([])
    expect(states).toStrictEqual([])
  })

  it('holds nothing for a Project that is not watched', async () => {
    const starts = vi.spyOn(DocsWatcher, 'start')
    await (await hub.hold('none'))()
    expect(starts).not.toHaveBeenCalled()
    expect(hub.projects).toStrictEqual([])
  })

  it('the last subscriber leaves during a hold and a new open starts at the old root: the release moves that watch to the new root', async () => {
    const moved = join(root, 'moved')
    mkdirSync(join(moved, 'docs', 'adr'), { recursive: true })
    writeFileSync(join(moved, 'HANDOFF.md'), '# Handoff\n\nAt the new root.\n')
    await hub.open('p', root, { id: 1, send: () => undefined })
    const watchAgain = await hub.hold('p')
    await hub.close('p', 1)
    const states: DocsState[] = []
    const opened = await hub.open('p', root, { id: 2, send: (state) => void states.push(state) })
    expect(opened.handoff).toBeNull()

    await watchAgain({ root: moved, adrStatusLabel: undefined, productDir: undefined })
    await until('the state of the new root', () => withHandoff(states).length > 0)
    writeFileSync(join(moved, 'docs', 'adr', '0001-a.md'), '# 0001 — a\n')
    await until('a change at the new root', () => states.some((state) => state.adrs.length === 1))
  })
})
