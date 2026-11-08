// The body of a Product Session (src/renderer/session/ProductSessionPanel.tsx, worfy-product-session
// ticket 07): the divider between the Mind map and the chat — 60 / 40 by default, moved by a drag and by
// the keyboard, back to 60 / 40 on a double click, its share written to the app settings — and the
// agents strip with the number of Subagents, which opens the rail blocks without the Binding — and the
// share of accepted advice in the Session's header (ticket 14), asked again on every `product.changed`.
// Against a fake bridge that keeps the app settings as main would; the Subagent tree is given by the test.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import { adviceShare, type AdviceShare } from '../../src/shared/product/share'
import { defaultAppSettings, PRODUCT_SESSION_SPLIT_MIN, type AppSettings } from '../../src/shared/settings/app-settings'
import type { SubagentInfo } from '../../src/shared/transcript/subagents'
import { MIN_SHARE } from '../../src/renderer/focus/split-tree'
import type { RailBlockProps } from '../../src/renderer/session/rail/index'

const subagents = vi.hoisted(() => ({ tree: [] as unknown[] }))

vi.mock('../../src/renderer/claude-home/subagents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/claude-home/subagents')>()
  return { ...actual, useSubagentTree: () => subagents.tree, useHiddenSubagents: () => ({}) }
})

const subagent = (id: string, children: SubagentInfo[] = []): SubagentInfo => ({
  id,
  agentId: id,
  toolUseId: null,
  parentAgentId: null,
  name: id,
  subagentType: null,
  model: null,
  description: null,
  status: 'running',
  background: false,
  startedAt: null,
  durationMs: null,
  summary: null,
  verdict: null,
  depth: 1,
  transcript: false,
  children,
})

const asked: { channel: string; input: unknown }[] = []
let settings: AppSettings
/** Why `product.topic` fails, when the test makes it fail. */
let topicFails: string | undefined
/** What `product.share` answers: main counts it from the files each time it is asked. */
let share: () => AdviceShare | { error: string }
/** The handlers the panel subscribed through the bridge, by channel. */
const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
const emit = (channel: string, payload: unknown) => {
  for (const each of listeners.values()) if (each.channel === channel) each.handler(payload)
}
const TOPIC: ProductTopicState = {
  name: 'demo-roadmap',
  folder: '/demo/docs/product/demo-roadmap',
  title: 'Demo roadmap',
  sections: [],
  tickets: [],
  nodes: [{ id: 'first-idea', kind: 'idea', text: 'Sell to small teams', from: null }],
  errors: [],
}

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  listeners.clear()
  topicFails = undefined
  share = () => adviceShare({ topics: [], reviews: [] })
  subagents.tree = []
  settings = defaultAppSettings()
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: settings })
      if (channel === 'appSettings.set') {
        const patch = input as Partial<AppSettings>
        settings = { ...settings, ...patch, revision: settings.revision + 1 }
        return Promise.resolve({ ok: true, value: settings })
      }
      if (channel === 'docs.open') return Promise.resolve({ ok: true, value: { projectId: 'alpha', handoff: null, adrs: [] } })
      if (channel === 'product.share') {
        const answer = share()
        return Promise.resolve('error' in answer ? { ok: false, error: answer.error } : { ok: true, value: answer })
      }
      if (channel === 'product.topic') {
        return Promise.resolve(topicFails === undefined ? { ok: true, value: { projectId: 'alpha', name: 'demo-roadmap', topic: TOPIC } } : { ok: false, error: topicFails })
      }
      return Promise.resolve({ ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      const id = listeners.size + 1
      listeners.set(id, { channel, handler })
      return id
    },
    off: (id: number) => {
      listeners.delete(id)
    },
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  // The split is 1000 px wide: a drag of 100 px moves the divider by a tenth.
  const own = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('w-product__split') ? new DOMRect(0, 0, 1000, 600) : own.call(this)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  localStorage.clear()
})

const blocks = {
  './BindingRail.tsx': { default: (props: RailBlockProps) => <p>{`bound to ${props.nodeId}`}</p>, order: 10 },
  './SubagentsRail.tsx': { default: (props: RailBlockProps) => <p>{`subagents of ${props.sessionId}`}</p>, order: 20 },
}

async function mount() {
  const { ProductSessionPanel } = await import('../../src/renderer/session/ProductSessionPanel')
  const { collectRailBlocks } = await import('../../src/renderer/session/rail/index')
  render(
    <ProductSessionPanel blocks={collectRailBlocks(blocks)} projectId="alpha" nodeId="node-1" sessionId="live-1">
      <section aria-label="Session">chat</section>
    </ProductSessionPanel>,
  )
  // The app settings have answered.
  await vi.waitFor(() => expect(asked.some((each) => each.channel === 'appSettings.get')).toBe(true))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const divider = () => screen.getByRole('separator')
const mapShare = () => screen.getByTestId('product-session-map').style.flexBasis
const writes = () => asked.filter((each) => each.channel === 'appSettings.set').map((each) => each.input)

const pointer = (type: string, x: number, pressed = type !== 'pointerup'): Event => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: pressed ? 1 : 0, clientX: x, clientY: 300 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('the divider of a Product Session', () => {
  it('starts at 60 / 40, the Mind map on the left with its empty state, the chat on the right', async () => {
    await mount()
    expect(mapShare()).toBe('60%')
    expect(divider().getAttribute('aria-valuenow')).toBe('60')
    expect(divider().getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getByTestId('product-session-map-empty').textContent).toBe('The Mind map appears once the advisor adds its first node')
    expect(screen.getByRole('region', { name: 'Session' }).textContent).toBe('chat')
    expect(writes()).toEqual([])
  })

  it('a drag to 70 / 30 follows the pointer off the divider and writes 0.7 to the app settings once, when it ends', async () => {
    await mount()
    act(() => {
      divider().dispatchEvent(pointer('pointerdown', 600))
    })
    const chat = screen.getByRole('region', { name: 'Session' })
    act(() => {
      chat.dispatchEvent(pointer('pointermove', 650))
    })
    expect(mapShare()).toBe('65%')
    act(() => {
      chat.dispatchEvent(pointer('pointermove', 700))
    })
    expect(mapShare()).toBe('70%')
    // Nothing is written while the drag goes on.
    expect(writes()).toEqual([])
    act(() => {
      chat.dispatchEvent(pointer('pointerup', 700))
    })
    await settle()
    expect(writes()).toEqual([{ productSession: { split: 0.7 } }])
    expect(settings.productSession).toEqual({ split: 0.7 })
    expect(mapShare()).toBe('70%')
    // After the drag the pointer moves nothing.
    act(() => {
      chat.dispatchEvent(pointer('pointermove', 900))
    })
    expect(mapShare()).toBe('70%')
  })

  it('keeps MIN_SHARE on either side however far the pointer goes', async () => {
    expect(PRODUCT_SESSION_SPLIT_MIN).toBe(MIN_SHARE)
    await mount()
    act(() => {
      divider().dispatchEvent(pointer('pointerdown', 600))
      document.body.dispatchEvent(pointer('pointermove', 2000))
    })
    expect(mapShare()).toBe('90%')
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', -500))
      document.body.dispatchEvent(pointer('pointerup', -500))
    })
    await settle()
    expect(mapShare()).toBe('10%')
    expect(writes()).toEqual([{ productSession: { split: 0.1 } }])
  })

  it('a cancelled drag goes back to where it started and writes nothing', async () => {
    await mount()
    act(() => {
      divider().dispatchEvent(pointer('pointerdown', 600))
      document.body.dispatchEvent(pointer('pointermove', 800))
    })
    expect(mapShare()).toBe('80%')
    act(() => {
      document.body.dispatchEvent(pointer('pointercancel', 800))
    })
    await settle()
    expect(mapShare()).toBe('60%')
    expect(writes()).toEqual([])
  })

  it('a double click puts it back to 60 / 40 and writes 0.6', async () => {
    settings = { ...settings, productSession: { split: 0.75 } }
    await mount()
    expect(mapShare()).toBe('75%')
    fireEvent.doubleClick(divider())
    await settle()
    expect(mapShare()).toBe('60%')
    expect(writes()).toEqual([{ productSession: { split: 0.6 } }])
  })

  it('the arrow keys move it by a step and write each step; Home and End go to the edges', async () => {
    await mount()
    divider().focus()
    fireEvent.keyDown(divider(), { key: 'ArrowRight' })
    await settle()
    expect(mapShare()).toBe('65%')
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    await settle()
    expect(mapShare()).toBe('55%')
    fireEvent.keyDown(divider(), { key: 'End' })
    await settle()
    expect(mapShare()).toBe('90%')
    fireEvent.keyDown(divider(), { key: 'Home' })
    await settle()
    expect(mapShare()).toBe('10%')
    // Another key moves nothing.
    fireEvent.keyDown(divider(), { key: 'ArrowUp' })
    await settle()
    expect(writes()).toEqual([0.65, 0.6, 0.55, 0.9, 0.1].map((split) => ({ productSession: { split } })))
  })

  it('shows the share another window wrote', async () => {
    await mount()
    const { acceptAppSettings } = await import('../../src/renderer/settings/useAppSettings')
    act(() => acceptAppSettings({ ...settings, productSession: { split: 0.45 }, revision: settings.revision + 1 }))
    expect(mapShare()).toBe('45%')
  })
})

describe('the agents strip of a Product Session', () => {
  it('shows the number of Subagents, the nested ones too, and opens the rail blocks without the Binding over the chat', async () => {
    subagents.tree = [subagent('critic', [subagent('scout')]), subagent('ideas')]
    await mount()
    const toggle = screen.getByTestId('product-agents-toggle')
    expect(screen.getByTestId('product-agents-count').textContent).toBe('3')
    expect(toggle.title).toBe('Agents (3)')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('product-agents-panel')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByTestId('product-agents-panel')
    expect(within(panel).getByText('subagents of live-1')).toBeTruthy()
    expect(screen.queryByText('bound to node-1')).toBeNull()
    expect(panel.querySelector('[data-block="BindingRail"]')).toBeNull()

    // Escape and the collapse button close it; so does the strip button.
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByTestId('product-agents-panel')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('product-agents-close'))
    expect(screen.queryByTestId('product-agents-panel')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByTestId('product-agents-panel')).toBeNull()
  })

  it('shows 0 while the Session has no Subagents', async () => {
    await mount()
    expect(screen.getByTestId('product-agents-count').textContent).toBe('0')
  })
})

describe('the Mind map pane of a Product Session', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  })

  it('draws the Mind map of the topic whose files changed, and shows that topic again when the Session is opened once more', async () => {
    await mount()
    expect(screen.getByTestId('product-session-map-empty')).toBeTruthy()
    // Another Project's topic, and a topic whose folder is gone, change nothing.
    act(() => {
      emit('product.changed', { projectId: 'beta', name: 'demo-roadmap', topic: TOPIC })
      emit('product.changed', { projectId: 'alpha', name: 'gone', topic: null })
    })
    expect(screen.getByTestId('product-session-map-empty')).toBeTruthy()
    act(() => {
      emit('product.changed', { projectId: 'alpha', name: 'demo-roadmap', topic: TOPIC })
    })
    const map = await screen.findByTestId('mind-map')
    expect(within(map).getByText('Sell to small teams')).toBeTruthy()
    expect(asked.filter((each) => each.channel === 'product.topic').map((each) => each.input)).toEqual([{ projectId: 'alpha', name: 'demo-roadmap' }])
    expect(screen.queryByTestId('product-session-map-empty')).toBeNull()

    cleanup()
    await mount()
    expect(within(await screen.findByTestId('mind-map')).getByText('Sell to small teams')).toBeTruthy()
  })

  it('says why when the topic cannot be read, instead of the empty state', async () => {
    topicFails = 'EACCES: permission denied'
    await mount()
    act(() => {
      emit('product.changed', { projectId: 'alpha', name: 'demo-roadmap', topic: TOPIC })
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Could not read the Mind map: EACCES: permission denied')
    expect(screen.queryByTestId('product-session-map-empty')).toBeNull()
    expect(screen.queryByTestId('mind-map')).toBeNull()
  })
})

describe('the share of accepted advice in the header of a Product Session', () => {
  const advice = (id: string, decided?: 'accepted' | 'rejected'): MindMapNode =>
    decided === undefined ? { id, kind: 'idea', text: id, from: null, advice: true } : { id, kind: 'decision', text: id, from: null, advice: true, status: decided, reason: 'the owner said so' }
  const REVIEW = 'Owner decision: accepted — fair\n\nOwner decision:\n'

  async function mountHeader() {
    const { AcceptedAdvice } = await import('../../src/renderer/session/ProductSessionPanel')
    render(<AcceptedAdvice projectId="alpha" />)
    await settle()
  }
  const header = () => screen.getByTestId('product-session-accepted')

  it('reads «Advice accepted 3 of 5 · 60%», both sources together; the tooltip names what waits and where, and that it is no measure of quality', async () => {
    share = () =>
      adviceShare({
        topics: [{ name: 'demo-roadmap', nodes: [advice('a', 'accepted'), advice('b', 'accepted'), advice('c', 'rejected'), advice('d', 'rejected'), advice('e'), advice('f')], errors: [] }],
        reviews: [{ file: 'demo-2026-11-08.md', text: REVIEW }],
      })
    await mountHeader()
    expect(header().textContent).toBe('Advice accepted 3 of 5 · 60%')
    expect(asked.filter((each) => each.channel === 'product.share').map((each) => each.input)).toEqual([{ projectId: 'alpha' }])
    const title = header().getAttribute('title') ?? ''
    expect(title).toContain('3 accepted, 2 rejected')
    expect(title).toContain('Waiting for a decision: 3 (2 in the Mind map, 1 in the critic’s reviews)')
    expect(title).toContain('not a measure of how good the advice is')
    expect(header().textContent).not.toMatch(/score|quality|rate/iu)
  })

  it('with no advice decided yet it says so, without a percentage', async () => {
    share = () => adviceShare({ topics: [{ name: 'demo-roadmap', nodes: [advice('a')], errors: [] }], reviews: [] })
    await mountHeader()
    expect(header().textContent).toBe('No advice decided yet')
    expect(header().textContent).not.toContain('%')
    expect(header().getAttribute('title')).toContain('Waiting for a decision: 1 (1 in the Mind map, 0 in the critic’s reviews)')
  })

  it('names the files it could not count, and says why when the share cannot be read', async () => {
    share = () => adviceShare({ topics: [{ name: 'broken', nodes: [], errors: [{ file: 'mind-map.json', message: 'not valid JSON' }] }], reviews: [] })
    await mountHeader()
    expect(header().getAttribute('title')).toContain('Not counted: broken/mind-map.json (not valid JSON)')
    cleanup()
    share = () => ({ error: 'EACCES: permission denied' })
    await mountHeader()
    expect(header().textContent).toBe('Advice accepted —')
    expect(header().getAttribute('title')).toBe('Could not count the advice: EACCES: permission denied')
  })

  it('mind_map_decide on a piece of advice changes the header without a reload: the next product.changed asks main again', async () => {
    let nodes = [advice('a', 'accepted'), advice('b')]
    share = () => adviceShare({ topics: [{ name: 'demo-roadmap', nodes, errors: [] }], reviews: [] })
    await mountHeader()
    expect(header().textContent).toBe('Advice accepted 1 of 1 · 100%')
    // The advisor called mind_map_decide: the watcher reads the topic again and sends it.
    nodes = [advice('a', 'accepted'), advice('b', 'rejected')]
    act(() => {
      emit('product.changed', { projectId: 'beta', name: 'demo-roadmap', topic: { ...TOPIC, nodes } })
    })
    await settle()
    expect(header().textContent).toBe('Advice accepted 1 of 1 · 100%')
    act(() => {
      emit('product.changed', { projectId: 'alpha', name: 'demo-roadmap', topic: { ...TOPIC, nodes } })
    })
    await vi.waitFor(() => expect(header().textContent).toBe('Advice accepted 1 of 2 · 50%'))
    expect(asked.filter((each) => each.channel === 'product.share')).toHaveLength(2)
  })
})
