// The channel of this screen's recorded gestures (canvas/useLayout.ts screenChannel), which the
// Canvas and the gestures outside it (Show, "Archive finished sessions now") share: sent with the
// screen's id; a refusal reaches the Canvas's own answer to it; the Layout is main's latest answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { EMPTY_LAYOUT, type Layout, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'

let answer: { ok: true; value: LayoutState } | { ok: false; error: string }
let sent: unknown[]

const layoutWith = (id: string): Layout => ({
  nodes: [{ id, kind: 'note', x: 0, y: 0, w: 100, h: 50, hidden: false, locked: false, pinned: false, tags: [], data: {} }],
  viewport: { x: 0, y: 0, zoom: 1 },
})

beforeEach(() => {
  vi.resetModules()
  sent = []
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      if (channel !== 'layout.apply') return Promise.resolve({ ok: false, error: `no ${channel}` })
      sent.push(input)
      return Promise.resolve(answer)
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('screenChannel', () => {
  const hide: LayoutOpInput = { op: 'hide', id: 'n1', hidden: true }

  it("sends with the screen's id; only a refusal calls onRefused, and the refusal is still the answer", async () => {
    const { screenChannel } = await import('../../src/renderer/canvas/useLayout')
    const { screenId } = await import('../../src/renderer/canvas/screen')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onRefused = vi.fn()
    const channel = screenChannel('p1', { onRefused })
    answer = { ok: false, error: 'the Node is gone' }
    await expect(channel.send(hide)).resolves.toBe('the Node is gone')
    expect(onRefused).toHaveBeenCalledTimes(1)
    answer = { ok: true, value: { projectId: 'p1', layout: layoutWith('n1'), revision: 2 } }
    await expect(channel.send(hide)).resolves.toEqual({ revision: 2 })
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      { projectId: 'p1', op: hide, screen: screenId() },
      { projectId: 'p1', op: hide, screen: screenId() },
    ])
  })

  it("its Layout is main's latest answer, before it the fallback, without one an empty Layout", async () => {
    const { acceptLayoutState, screenChannel } = await import('../../src/renderer/canvas/useLayout')
    const own = layoutWith('drawn')
    expect(screenChannel('p2').layout()).toEqual(EMPTY_LAYOUT)
    expect(screenChannel('p2', { fallback: () => own }).layout()).toBe(own)
    const mains = layoutWith('from-main')
    acceptLayoutState({ projectId: 'p2', layout: mains, revision: 1 })
    expect(screenChannel('p2', { fallback: () => own }).layout()).toBe(mains)
  })
})
