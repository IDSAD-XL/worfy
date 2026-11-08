// useMindMap (worfy-product-session ticket 05): a topic on screen is read once through
// `product.topic` and then replaced by every `product.changed` of it, without a reload; the hook holds
// the Project's documents open, since `product.changed` comes with them.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProductTopicChange, ProductTopicState } from '../../src/shared/ipc/product'
import { useMindMap } from '../../src/renderer/product/useMindMap'

const listeners = vi.hoisted(() => new Map<string, (payload: unknown) => void>())
const invoke = vi.hoisted(() => vi.fn<(channel: string, input?: unknown) => Promise<unknown>>())
vi.mock('../../src/renderer/ipc', () => ({
  invoke,
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener)
    return () => listeners.delete(channel)
  },
  showSubscribeError: () => undefined,
}))
/** What useDocs answers: `docs.open` answered (a state) unless a test says otherwise. */
const docsEntry = vi.hoisted(() => ({ current: { state: {} as unknown, error: undefined as string | undefined } }))
const useDocs = vi.hoisted(() => vi.fn(() => docsEntry.current))
vi.mock('../../src/renderer/docs/useDocs', () => ({ useDocs }))

const topicWith = (text: string): ProductTopicState => ({
  name: 't',
  folder: '/p/docs/product/t',
  title: null,
  sections: [],
  tickets: [],
  nodes: [{ id: 'a', kind: 'idea', text, from: null }],
  errors: [],
})

function Shown({ name }: { name: string }) {
  const { topic, error } = useMindMap('p1', name)
  if (error !== undefined) return <p>error: {error}</p>
  if (topic === undefined) return <p>reading</p>
  return <p>{topic === null ? 'gone' : topic.nodes.map((node) => node.text).join(',')}</p>
}

const change = (payload: ProductTopicChange): void => act(() => listeners.get('product.changed')!(payload))

describe('useMindMap', () => {
  it('reads the topic only once docs.open has answered, so the Project watcher knows it', async () => {
    invoke.mockReset()
    invoke.mockResolvedValue({ ok: true, value: { projectId: 'p1', name: 'w', topic: topicWith('waited') } })
    docsEntry.current = { state: undefined, error: undefined }
    const { rerender, unmount } = render(<Shown name="w" />)
    expect(screen.getByText('reading')).toBeTruthy()
    expect(invoke).not.toHaveBeenCalled()
    docsEntry.current = { state: {}, error: undefined }
    rerender(<Shown name="w" />)
    expect(await screen.findByText('waited')).toBeTruthy()
    expect(invoke).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('reads the topic, follows product.changed of it only, and holds the documents of its Project open', async () => {
    invoke.mockResolvedValue({ ok: true, value: { projectId: 'p1', name: 't', topic: topicWith('first') } })
    const { unmount } = render(<Shown name="t" />)
    expect(await screen.findByText('first')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('product.topic', { projectId: 'p1', name: 't' })
    expect(useDocs).toHaveBeenCalledWith('p1')

    change({ projectId: 'p1', name: 't', topic: topicWith('second') })
    expect(screen.getByText('second')).toBeTruthy()
    // Another topic, or the same name in another Project, is not this one.
    change({ projectId: 'p1', name: 'other', topic: topicWith('not this') })
    change({ projectId: 'p2', name: 't', topic: topicWith('nor this') })
    expect(screen.getByText('second')).toBeTruthy()

    change({ projectId: 'p1', name: 't', topic: null })
    expect(screen.getByText('gone')).toBeTruthy()
    unmount()
  })

  it('a failed read shows its error', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'no such Project' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<Shown name="u" />)
    expect(await screen.findByText('error: no such Project')).toBeTruthy()
  })
})
