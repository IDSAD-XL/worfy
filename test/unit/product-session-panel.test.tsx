// The body of a Product Session (src/renderer/session/ProductSessionPanel.tsx, worfy-product-session
// ticket 07): the divider between the Mind map and the chat — 60 / 40 by default, moved by a drag and by
// the keyboard, back to 60 / 40 on a double click, its share written to the app settings — and the
// agents strip with the number of Subagents, which opens the list of the agents by name and state
// (ticket 20) — and the share of accepted advice in the Session's header (ticket 14), asked again on every `product.changed`.
// Against a fake bridge that keeps the app settings as main would; the Subagent tree is given by the test.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProductTopicState } from '../../src/shared/ipc/product'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import { adviceShare, type AdviceShare } from '../../src/shared/product/share'
import { defaultAppSettings, PRODUCT_SESSION_SPLIT_MIN, type AppSettings } from '../../src/shared/settings/app-settings'
import type { SubagentInfo } from '../../src/shared/transcript/subagents'
import { MIN_SHARE } from '../../src/renderer/focus/split-tree'
import { draftsOf, lastAnswerOf, latestAgent, isCritic, productAgentState, productAgentTime } from '../../src/renderer/session/product-agents'

const subagents = vi.hoisted(() => ({ tree: [] as unknown[], hidden: {} as Record<string, string[]> }))

vi.mock('../../src/renderer/claude-home/subagents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/claude-home/subagents')>()
  return { ...actual, useSubagentTree: () => subagents.tree, useHiddenSubagents: () => subagents.hidden }
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
/** The events of each Subagent's transcript (`claudeHome.subagentTranscript`), by agent id; none — the read fails. */
let transcripts: Record<string, unknown[]>
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
  subagents.hidden = {}
  transcripts = {}
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
      if (channel === 'projects.list') {
        return Promise.resolve({ ok: true, value: { projects: [{ id: 'alpha', name: 'demo', path: '/demo', branch: 'main' }], activeId: 'alpha', revision: 1 } })
      }
      if (channel === 'claudeHome.subagentTranscript') {
        const events = transcripts[(input as { agentId: string }).agentId]
        if (events === undefined) return Promise.resolve({ ok: false, error: 'no such transcript' })
        return Promise.resolve({ ok: true, value: { found: true, events, cursor: { offset: 1, fileId: null }, reset: false, more: false, earlier: 0 } })
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

async function mount(events?: readonly AgentEvent[]) {
  const { ProductSessionPanel } = await import('../../src/renderer/session/ProductSessionPanel')
  render(
    <ProductSessionPanel projectId="alpha" nodeId="node-1" sessionId="live-1" events={events}>
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

/** A critic's review as harness/agents/critic.md has it written, with `count` objections. */
const review = (count: number): string =>
  [
    '# Critic: demo-roadmap — 2026-11-09',
    '',
    'Plan: `docs/product/demo-roadmap/map.md`',
    'Verdict: Reorder — the pricing question comes first',
    '',
    '## Objections',
    '',
    ...(count === 0
      ? ['None.', '']
      : Array.from({ length: count }, (_, index) => [`### ${index + 1}. Objection ${index + 1}`, '', 'Fact: `CONTEXT.md:1` says so', '', 'Judgement: it costs a week', '', 'Owner decision:', '']).flat()),
    '```markdown',
    '### 9. a heading quoted in a code block is no objection',
    '```',
    '',
    '## Alternative',
    '',
    '### 1. a numbered heading outside the objections is no objection',
    '',
  ].join('\n')

/** The critic's transcript: it read the plan, wrote its review into the critic folder and answered. */
const criticWrote = (text: string): unknown[] => [
  { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/demo/docs/product/demo-roadmap/map.md' }, parentToolUseId: null },
  { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/demo/docs/product/critic/demo-roadmap-2026-11-09.md', content: text }, parentToolUseId: null },
]

const agent = (id: string, type: string | null, more: Partial<SubagentInfo> = {}): SubagentInfo => ({ ...subagent(id), name: null, subagentType: type, transcript: true, ...more })

/** Each agent of the list as one line, its name and then its state line: «Critic — working · 3 objections». */
const agentLines = (root: HTMLElement = document.body): string[] =>
  within(root)
    .getAllByTestId('product-agent')
    .map((row) => `${within(row).getByTestId('product-agent-line').textContent} — ${within(row).getByTestId('product-agent-state').textContent}`)

describe('the agents strip of a Product Session', () => {
  it('shows the number of Subagents, the nested ones too, and opens the list of the agents by name and state', async () => {
    subagents.tree = [
      agent('critic-1', 'worfy:critic', { description: 'Find objections to the roadmap', children: [agent('scout-1', 'worfy:scout', { depth: 2, status: 'error' })] }),
      agent('ideas-1', 'worfy:product-ideas', { status: 'done' }),
    ]
    transcripts = { 'critic-1': criticWrote(review(3)) }
    await mount()
    const toggle = screen.getByTestId('product-agents-toggle')
    expect(screen.getByTestId('product-agents-count').textContent).toBe('3')
    expect(toggle.title).toBe('Agents (3)')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('product-agents-panel')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByTestId('product-agents-panel')
    const lines = () => agentLines(panel)
    await vi.waitFor(() => expect(lines()).toEqual(['Critic — working · 3 objections', 'worfy:scout — error', 'Idea generator — done']))
    expect(within(panel).getByText('Find objections to the roadmap')).toBeTruthy()
    expect(within(panel).getAllByTestId('product-agent').map((row) => row.dataset.status)).toEqual(['running', 'error', 'done'])
    // The critic's own transcript is read, of this Session; no other one.
    const reads = asked.filter((each) => each.channel === 'claudeHome.subagentTranscript').map((each) => each.input as { projectRoot: string; sessionId: string; agentId: string })
    expect(reads.map(({ projectRoot, sessionId, agentId }) => ({ projectRoot, sessionId, agentId }))).toEqual([{ projectRoot: '/demo', sessionId: 'live-1', agentId: 'critic-1' }])
    // No rail block of a plain Session is drawn in the list.
    expect(panel.querySelector('.w-session__rail-block')).toBeNull()

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

  it('a critic whose review is not written yet, or cannot be read, shows no number; one objection and none are worded', async () => {
    subagents.tree = [
      agent('critic-early', 'critic'),
      agent('critic-unread', 'worfy:critic', { status: 'done' }),
      agent('critic-one', 'worfy:critic', { status: 'done' }),
      agent('critic-none', 'worfy:critic', { status: 'interrupted' }),
    ]
    transcripts = {
      'critic-early': criticWrote(review(2)).slice(0, 1),
      'critic-one': criticWrote(review(1)),
      'critic-none': criticWrote(review(0)),
    }
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    const lines = () => agentLines()
    await vi.waitFor(() => expect(lines()).toEqual(['Critic — working', 'Critic — done', 'Critic — done · 1 objection', 'Critic — interrupted · no objections']))
    expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript')).toHaveLength(4)
  })

  // Review of PR #1702: the last Write of the review counts; a Write outside critic/ is no review; a review
  // whose objections the list cannot read shows no number rather than a wrong one.
  it('counts the last review the critic wrote, ignores a Write outside the critic folder, and shows no number for a review it cannot read', async () => {
    const write = (id: string, path: string, content: string) => ({ type: 'tool_use', id, name: 'Write', input: { file_path: path, content }, parentToolUseId: null })
    const reviewFile = '/demo/docs/product/critic/demo-roadmap-2026-11-09.md'
    subagents.tree = [
      agent('critic-rewrote', 'worfy:critic', { status: 'done' }),
      agent('critic-elsewhere', 'worfy:critic', { status: 'done' }),
      agent('critic-heading', 'worfy:critic', { status: 'done' }),
      agent('critic-numbering', 'worfy:critic', { status: 'done' }),
      agent('critic-fenced', 'worfy:critic', { status: 'done' }),
    ]
    transcripts = {
      // It wrote the review with three objections, then wrote it again with one.
      'critic-rewrote': [write('w1', reviewFile, review(3)), write('w2', reviewFile, review(1))],
      // Its review, then a note of its own outside critic/: the note is no review.
      'critic-elsewhere': [write('w1', reviewFile, review(2)), write('w2', '/demo/docs/product/demo-roadmap/notes.md', review(3))],
      // A drift of the format: the section's heading, the objections' numbering.
      'critic-heading': [write('w1', reviewFile, review(2).replace('## Objections', '## Objections (2)'))],
      'critic-numbering': [write('w1', reviewFile, review(2).replaceAll(/^### (\d+)\./gmu, '### Objection $1:'))],
      // The whole review in a code block, as the template of harness/agents/critic.md stands.
      'critic-fenced': [write('w1', reviewFile, ['```markdown', review(2), '```'].join('\n'))],
    }
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    const lines = () => agentLines()
    await vi.waitFor(() => expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript')).toHaveLength(5))
    await vi.waitFor(() => expect(lines()).toEqual(['Critic — done · 1 objection', 'Critic — done · 2 objections', 'Critic — done', 'Critic — done', 'Critic — done']))
  })

  it('a critic that only wrote outside the critic folder has no number', async () => {
    subagents.tree = [agent('critic-1', 'worfy:critic', { status: 'done' })]
    transcripts = { 'critic-1': [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/demo/docs/product/demo-roadmap/notes.md', content: review(3) }, parentToolUseId: null }] }
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    await vi.waitFor(() => expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript')).toHaveLength(1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(agentLines()[0]).toBe('Critic — done')
  })

  it('a running critic gets its number once it writes its review: its transcript is read again while the list is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // Known from the Session's live events only: the tree has not read the critic's files yet.
      subagents.tree = [agent('critic-1', 'worfy:critic', { transcript: false })]
      transcripts = { 'critic-1': criticWrote(review(2)).slice(0, 1) }
      await mount()
      fireEvent.click(screen.getByTestId('product-agents-toggle'))
      const line = () => agentLines()[0]
      await vi.waitFor(() => expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript')).toHaveLength(1))
      expect(line()).toBe('Critic — working')
      transcripts = { 'critic-1': criticWrote(review(2)) }
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      await vi.waitFor(() => expect(line()).toBe('Critic — working · 2 objections'))
      // Closed, the list reads nothing more.
      fireEvent.click(screen.getByTestId('product-agents-close'))
      const reads = asked.filter((each) => each.channel === 'claudeHome.subagentTranscript').length
      await act(async () => {
        vi.advanceTimersByTime(15000)
      })
      expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript')).toHaveLength(reads)
    } finally {
      vi.useRealTimers()
    }
  })

  // worfy-product-session ticket 22: as the prototype, the task comes second and the state on its own line
  // with the time — how long a running agent has worked, how long ago a finished one ended.
  it('puts the task second and the state on a line of its own with its time and the critic’s objections', async () => {
    const now = Date.now()
    subagents.tree = [
      agent('critic-1', 'worfy:critic', { description: 'Check the plan against the facts', startedAt: now - 90_000 }),
      agent('ideas-1', 'worfy:product-ideas', { status: 'done', description: 'Six ideas for the owner', startedAt: now - 10 * 60_000, durationMs: 6 * 60_000 }),
    ]
    transcripts = { 'critic-1': criticWrote(review(3)) }
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    const rows = screen.getAllByTestId('product-agent')
    expect(rows.map((row) => [...row.children].map((part) => part.className))).toEqual([
      ['w-product__agent-line', 'w-product__agent-about', 'w-product__agent-state'],
      ['w-product__agent-line', 'w-product__agent-about', 'w-product__agent-state'],
    ])
    expect(rows.map((row) => within(row).getByTestId('product-agent-line').textContent)).toEqual(['Critic', 'Idea generator'])
    await vi.waitFor(() => expect(screen.getAllByTestId('product-agent-state').map((line) => line.textContent)).toEqual(['working · 1 min · 3 objections', 'done · 4 min ago']))
  })

  // worfy-product-session ticket 24, row 19 of the comparison: the prototype puts the working Critic above the
  // Idea generator that is done. The working agents come first, the later started higher in each group; a
  // nested agent stays under its parent. The Subagent tree itself keeps its start order (other screens use it).
  it('lists the working agents first, the later started higher, each nested agent under its parent', async () => {
    const now = Date.now()
    subagents.tree = [
      agent('ideas-1', 'worfy:product-ideas', { status: 'done', startedAt: now - 10 * 60_000, durationMs: 60_000 }),
      agent('critic-1', 'worfy:critic', { startedAt: now - 5 * 60_000, children: [agent('scout-1', 'worfy:scout', { depth: 2, status: 'done', startedAt: now - 4 * 60_000, durationMs: 1000 }), agent('scout-2', 'worfy:scout', { depth: 2, startedAt: now - 3 * 60_000 })] }),
      agent('old-1', 'worfy:implementer', { status: 'error', startedAt: now - 2 * 60_000, durationMs: 1000 }),
      agent('critic-2', 'worfy:critic', { startedAt: now - 60_000 }),
    ]
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    expect(screen.getAllByTestId('product-agent').map((row) => `${within(row).getByTestId('product-agent-line').textContent}:${row.dataset.status}`)).toEqual([
      'Critic:running',
      'Critic:running',
      'worfy:scout:running',
      'worfy:scout:done',
      'worfy:implementer:error',
      'Idea generator:done',
    ])
    // The tree the mock gave is left as it was.
    expect((subagents.tree as SubagentInfo[]).map((info) => info.id)).toEqual(['ideas-1', 'critic-1', 'old-1', 'critic-2'])
  })

  it('words the time of an agent in whole minutes, and leaves it out when the tree has none', () => {
    const now = 1_000_000_000
    const at = (status: SubagentInfo['status'], startedAt: number | null, durationMs: number | null = null) => productAgentTime({ status, startedAt, durationMs }, now)
    expect(at('running', now - 30_000)).toBe('under 1 min')
    expect(at('running', now - 59 * 60_000)).toBe('59 min')
    expect(at('running', now - 65 * 60_000)).toBe('1 h 05 min')
    expect(at('done', now - 60_000, 50_000)).toBe('just now')
    expect(at('error', now - 3 * 60 * 60_000, 60_000)).toBe('2 h 59 min ago')
    expect(at('running', null)).toBeUndefined()
    expect(at('done', now - 60_000, null)).toBeUndefined()
    expect(productAgentState('done', 2, '4 min ago')).toBe('done · 4 min ago · 2 objections')
    expect(productAgentState('interrupted')).toBe('interrupted')
  })

  it('leaves the hidden Subagents out of the list, as out of the count', async () => {
    subagents.tree = [agent('critic-1', 'worfy:critic'), agent('old-1', 'worfy:implementer', { status: 'done' })]
    subagents.hidden = { 'live-1': ['old-1'] }
    await mount()
    expect(screen.getByTestId('product-agents-count').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    expect(agentLines()).toEqual(['Critic — working'])
  })

  it('shows 0 while the Session has no Subagents, and says so in the list', async () => {
    await mount()
    expect(screen.getByTestId('product-agents-count').textContent).toBe('0')
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    expect(screen.getByTestId('product-agents-empty').textContent).toBe('No agents yet')
    expect(asked.some((each) => each.channel === 'claudeHome.subagentTranscript')).toBe(false)
  })
})

// worfy-product-session ticket 27 (Q2 of the owner's decisions of 2026-11-09): beside Agents, the prototype's
// Critic, Idea generator and Drafts buttons, each opening its own panel in the same column, one at a time.
describe('the Critic, Idea generator and Drafts buttons of the strip', () => {
  const write = (id: string, path: string, content: string, name = 'Write'): AgentEvent =>
    ({ type: 'tool_use', id, name, input: name === 'Write' ? { file_path: path, content } : { file_path: path, old_string: 'a', new_string: 'b' }, parentToolUseId: null }) as AgentEvent
  const text = (messageId: string, body: string): AgentEvent => ({ type: 'text', text: body, messageId, parentToolUseId: null, synthetic: false })
  const DRAFT = '/demo/docs/product/demo-roadmap/drafts/pricing.md'
  const OTHER_DRAFT = '/demo/docs/product/demo-roadmap/drafts/onboarding.md'
  const strip = () => screen.getByTestId('product-agents')
  const buttons = () => within(strip()).getAllByRole('button').filter((button) => button.classList.contains('w-product__agents-button'))
  const openPanels = () => Array.from(strip().querySelectorAll('[role="region"]')).map((panel) => (panel as HTMLElement).dataset.panel)

  it('has four buttons in the prototype’s order, the Agents number on a violet badge', async () => {
    await mount()
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Agents', 'Critic', 'Idea generator', 'Drafts'])
    expect(buttons().every((button) => button.querySelector('svg') !== null)).toBe(true)
    expect(screen.getByTestId('product-agents-count').classList.contains('w-product__agents-count')).toBe(true)
    // No drafts: the Drafts button has no number.
    expect(screen.queryByTestId('product-rail-drafts-count')).toBeNull()
  })

  it('Critic opens the review the Session’s last critic wrote, its file and objections; no critic — a plain line', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-critic'))
    expect(within(screen.getByTestId('product-rail-critic-panel')).getByTestId('product-critic-empty').textContent).toBe('No critic in this Session yet')
    cleanup()
    subagents.tree = [
      agent('critic-old', 'worfy:critic', { status: 'done', startedAt: 1_000, durationMs: 10 }),
      agent('critic-new', 'worfy:critic', { status: 'done', startedAt: 5_000, durationMs: 10, description: 'Objections to the pricing plan' }),
    ]
    transcripts = { 'critic-old': criticWrote(review(3)), 'critic-new': criticWrote(review(2)) }
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-critic'))
    const panel = screen.getByTestId('product-rail-critic-panel')
    await vi.waitFor(() => expect(within(panel).getByTestId('product-critic-file').textContent).toBe('demo-roadmap-2026-11-09.md'))
    expect(within(panel).getByTestId('product-rail-state').textContent).toContain('done')
    expect(within(panel).getByTestId('product-rail-state').textContent).toContain('2 objections')
    expect(within(panel).getByText('Objections to the pricing plan')).toBeTruthy()
    expect(within(panel).getByTestId('product-critic-review').textContent).toContain('Objection 2')
    // Only the last critic's transcript is read.
    expect(asked.filter((each) => each.channel === 'claudeHome.subagentTranscript').map((each) => (each.input as { agentId: string }).agentId)).toEqual(['critic-new'])
  })

  it('Critic says so while its critic has written no review, and when its transcript cannot be read', async () => {
    subagents.tree = [agent('critic-1', 'worfy:critic')]
    transcripts = { 'critic-1': criticWrote(review(1)).slice(0, 1) }
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-critic'))
    await vi.waitFor(() => expect(screen.getByTestId('product-critic-no-review').textContent).toBe('No review written yet'))
    cleanup()
    transcripts = {}
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-critic'))
    await vi.waitFor(() => expect(screen.getByTestId('product-critic-error').textContent).toBe('Could not read the critic’s transcript: no such transcript'))
  })

  it('Idea generator opens the last answer of the Session’s idea generator and its state; none — a plain line', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-ideas'))
    expect(screen.getByTestId('product-ideas-empty').textContent).toBe('No idea generator in this Session yet')
    cleanup()
    subagents.tree = [agent('ideas-1', 'worfy:product-ideas', { status: 'done', description: 'Ideas for small teams' }), agent('critic-1', 'worfy:critic')]
    transcripts = { 'ideas-1': [text('m1', 'Thinking…'), write('w', '/demo/x.md', 'x'), text('m2', '1. **Team plan** for small teams'), text('m2', '2. A free tier')] }
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-ideas'))
    const panel = screen.getByTestId('product-rail-ideas-panel')
    await vi.waitFor(() => expect(within(panel).getByTestId('product-ideas-answer').textContent).toContain('Team plan'))
    expect(within(panel).getByTestId('product-ideas-answer').textContent).toContain('A free tier')
    expect(within(panel).getByTestId('product-ideas-answer').textContent).not.toContain('Thinking')
    expect(within(panel).getByTestId('product-rail-state').textContent).toContain('done')
    expect(within(panel).getByText('Ideas for small teams')).toBeTruthy()
  })

  it('Idea generator says so while its agent has written no answer', async () => {
    subagents.tree = [agent('ideas-1', 'worfy:product-ideas')]
    transcripts = { 'ideas-1': [] }
    await mount()
    fireEvent.click(screen.getByTestId('product-rail-ideas'))
    await vi.waitFor(() => expect(screen.getByTestId('product-ideas-no-answer').textContent).toBe('No ideas written yet'))
  })

  it('Drafts lists the advisor’s drafts the chat wrote, the last written first, and shows one on a click; none — a plain line', async () => {
    await mount([write('w0', '/demo/docs/product/demo-roadmap/map.md', '# map')])
    fireEvent.click(screen.getByTestId('product-rail-drafts'))
    expect(screen.getByTestId('product-drafts-empty').textContent).toBe('No drafts in this chat yet')
    cleanup()
    await mount([write('w1', DRAFT, '# Pricing\n\nfirst'), write('w2', OTHER_DRAFT, '# Onboarding'), write('w3', DRAFT, '# Pricing\n\nsecond')])
    expect(screen.getByTestId('product-rail-drafts-count').textContent).toBe('2')
    fireEvent.click(screen.getByTestId('product-rail-drafts'))
    const panel = screen.getByTestId('product-rail-drafts-panel')
    const rows = within(panel).getAllByTestId('product-draft')
    expect(rows.map((row) => row.querySelector('.w-product__agent-name')?.textContent)).toEqual(['pricing.md', 'onboarding.md'])
    expect(rows[0]!.textContent).toContain('demo-roadmap · written 2 times')
    expect(within(panel).queryByTestId('product-draft-text')).toBeNull()
    fireEvent.click(within(rows[0]!).getByRole('button'))
    expect(within(panel).getByTestId('product-draft-text').textContent).toContain('second')
    fireEvent.click(within(rows[0]!).getByRole('button'))
    expect(within(panel).queryByTestId('product-draft-text')).toBeNull()
  })

  it('opens one panel at a time: another button switches, the same one, «›» and Escape close', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('product-agents-toggle'))
    expect(openPanels()).toEqual(['agents'])
    for (const kind of ['critic', 'ideas', 'drafts']) {
      fireEvent.click(screen.getByTestId(`product-rail-${kind}`))
      expect(openPanels()).toEqual([kind])
      expect(buttons().filter((button) => button.getAttribute('aria-expanded') === 'true').map((button) => button.getAttribute('aria-label'))).toHaveLength(1)
      expect(strip().dataset.open).toBe('true')
    }
    fireEvent.click(screen.getByTestId('product-rail-drafts'))
    expect(openPanels()).toEqual([])
    expect(strip().dataset.open).toBeUndefined()
    fireEvent.click(screen.getByTestId('product-rail-critic'))
    fireEvent.click(screen.getByTestId('product-agents-close'))
    expect(openPanels()).toEqual([])
    expect(document.activeElement).toBe(screen.getByTestId('product-rail-critic'))
    fireEvent.click(screen.getByTestId('product-rail-ideas'))
    fireEvent.keyDown(screen.getByTestId('product-rail-ideas-panel'), { key: 'Escape' })
    expect(openPanels()).toEqual([])
  })

  it('draftsOf keeps one entry per draft, its last whole text and whether an Edit came after it; other files are no drafts', () => {
    const drafts = draftsOf([
      write('w1', DRAFT, 'one'),
      write('e1', DRAFT, '', 'Edit'),
      write('w2', '/demo/docs/product/critic/x.md', 'review'),
      write('w3', '/demo/docs/product/demo-roadmap/drafts/notes.txt', 'not markdown'),
      write('e2', 'C:\\demo\\docs\\product\\win-topic\\drafts\\edited.md', '', 'Edit'),
    ])
    expect(drafts.map(({ topic, file, text, editedSince, writes }) => ({ topic, file, text, editedSince, writes }))).toEqual([
      { topic: 'win-topic', file: 'edited.md', text: null, editedSince: false, writes: 1 },
      { topic: 'demo-roadmap', file: 'pricing.md', text: 'one', editedSince: true, writes: 2 },
    ])
  })

  it('lastAnswerOf joins the parts of the last message; latestAgent takes the one started last', () => {
    expect(lastAnswerOf([])).toBeUndefined()
    expect(lastAnswerOf([text('a', 'old'), text('b', 'new 1'), text('b', 'new 2')])).toBe('new 1\n\nnew 2')
    const tree = [agent('c1', 'worfy:critic', { startedAt: 2 }), agent('c2', 'critic', { startedAt: 9 }), agent('s', 'worfy:scout', { startedAt: 20 })]
    expect(latestAgent(tree, isCritic)?.id).toBe('c2')
    expect(latestAgent(tree, (info) => info.subagentType === 'none')).toBeUndefined()
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
    expect(title).toContain('A decision written in a critic’s review shows after the next change of a topic.')
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
    share = () =>
      adviceShare({
        topics: [
          { name: 'demo-roadmap', nodes: [advice('a')], errors: [] },
          { name: 'broken', nodes: [], errors: [{ file: 'mind-map.json', message: 'not valid JSON' }] },
        ],
        reviews: [],
      })
    await mountHeader()
    expect(header().getAttribute('title')).toContain('Not counted: broken/mind-map.json (not valid JSON)')
    cleanup()
    share = () => ({ error: 'EACCES: permission denied' })
    await mountHeader()
    expect(header().textContent).toBe('Advice accepted —')
    expect(header().getAttribute('title')).toBe('Could not count the advice: EACCES: permission denied')
  })

  // Owner, 2026-11-09, Q3 (ticket 27): the share shows only once there is advice, decided or not.
  it('is not shown while main has not answered, nor while the Project has no advice; one piece of advice, waiting, shows it', async () => {
    let nodes: MindMapNode[] = []
    share = () => adviceShare({ topics: [{ name: 'demo-roadmap', nodes, errors: [] }], reviews: [] })
    const { AcceptedAdvice } = await import('../../src/renderer/session/ProductSessionPanel')
    const view = render(
      <header>
        <AcceptedAdvice projectId="alpha" />
      </header>,
    )
    expect(screen.queryByTestId('product-session-accepted')).toBeNull()
    await settle()
    // No advice in any topic, no review: nothing in the header, not even its divider.
    expect(screen.queryByTestId('product-session-accepted')).toBeNull()
    expect(view.container.querySelector('.w-session__divider')).toBeNull()
    // The advisor adds its first piece of advice: the next product.changed asks again and the share appears.
    nodes = [advice('first')]
    act(() => {
      emit('product.changed', { projectId: 'alpha', name: 'demo-roadmap', topic: { ...TOPIC, nodes } })
    })
    await vi.waitFor(() => expect(screen.getByTestId('product-session-accepted').textContent).toBe('No advice decided yet'))
    expect(view.container.querySelector('.w-session__divider')).not.toBeNull()
  })

  it('a critic’s review waiting for a decision is advice too', async () => {
    share = () => adviceShare({ topics: [], reviews: [{ file: 'demo-2026-11-09.md', text: 'Owner decision:\n' }] })
    await mountHeader()
    expect(header().textContent).toBe('No advice decided yet')
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
