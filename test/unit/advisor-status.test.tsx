// The status line of a Product Session's chat (worfy-product-session ticket 29): what the advisor is doing right
// now, derived from the Session's latest events, with the time of the current step.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { advisorStatus, toolStatus } from '../../src/renderer/session/advisor-status'
import { AdvisorStatus } from '../../src/renderer/session/AdvisorStatus'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const AT = new Date(2026, 10, 9, 10, 0).getTime()
const prompt = (at = AT): AgentEvent => ({ type: 'prompt', text: 'Draft the roadmap section', at })
const use = (id: string, name: string, input: unknown, at = AT + 1000, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId, at })
const done = (id: string, at = AT + 2000, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: 'ok', isError: false, parentToolUseId, at })
const thinking = (at = AT + 3000): AgentEvent => ({ type: 'thinking', text: 'weighing', messageId: 'm1', parentToolUseId: null, at })
const delta = (kind: 'text' | 'thinking', at = AT + 3000): AgentEvent => ({ type: 'delta', kind, text: '…', parentToolUseId: null, at })
const text = (at = AT + 4000): AgentEvent => ({ type: 'text', text: 'Here it is', messageId: 'm2', parentToolUseId: null, synthetic: false, at })

describe('toolStatus', () => {
  it.each([
    ['Read', { file_path: '/Users/someone/project/docs/product/roadmap/map.md' }, 'Reading map.md'],
    ['Edit', { file_path: 'docs/product/roadmap/issues/03-pricing.md' }, 'Editing 03-pricing.md'],
    ['MultiEdit', { file_path: 'src/a.ts' }, 'Editing a.ts'],
    ['Write', { file_path: 'docs/product/roadmap/drafts/roadmap-section.md' }, 'Writing roadmap-section.md'],
    ['Write', { file_path: 'C:\\work\\drafts\\notes.md' }, 'Writing notes.md'],
    ['Grep', { pattern: 'pricing' }, 'Searching the files for “pricing”'],
    ['Glob', { pattern: 'docs/**/*.md' }, 'Looking for docs/**/*.md'],
    ['Bash', { command: 'ls docs/product', description: 'List the topics' }, 'List the topics'],
    ['Bash', { command: 'git log --oneline -5\ngit status' }, 'Running git log --oneline -5'],
    ['WebSearch', { query: 'pricing of canvas tools' }, 'Searching the web for “pricing of canvas tools”'],
    ['WebFetch', { url: 'https://example.com/pricing?x=1' }, 'Reading example.com'],
    ['TodoWrite', { todos: [] }, 'Updating the plan'],
    ['Skill', { skill: 'worfy:product-ideas' }, 'Using the product-ideas skill'],
    ['mcp__worfy-mind-map__mind_map_read', { topic: 'roadmap' }, 'Reading the roadmap Mind map'],
    ['mcp__worfy-mind-map__mind_map_read', {}, 'Reading the Mind map topics'],
    ['mcp__worfy-mind-map__mind_map_add', { topic: 'roadmap', kind: 'idea', text: 'x', from: null }, 'Adding an idea to the Mind map'],
    ['mcp__worfy-mind-map__mind_map_add', { topic: 'roadmap', kind: 'objection', text: 'x', from: null }, 'Adding an objection to the Mind map'],
    ['mcp__worfy-mind-map__mind_map_update', { topic: 'roadmap', id: 'n1' }, 'Changing a Mind map node'],
    ['mcp__worfy-mind-map__mind_map_decide', { topic: 'roadmap', id: 'n1', status: 'accepted', reason: 'r' }, 'Recording a decision on the Mind map'],
    ['mcp__worfy-mind-map__mind_map_remove', { topic: 'roadmap', id: 'n1' }, 'Removing a Mind map node'],
    ['mcp__worfy-mind-map__product_save', {}, 'Asking to save the work'],
    ['mcp__qmd__query', { searches: [] }, 'Searching the docs'],
    ['mcp__plugin_worfy_qmd__query', { searches: [] }, 'Searching the docs'],
    ['mcp__qmd__get', { file: 'worfy-docs/docs/adr/0101-mind-map.md:10' }, 'Reading 0101-mind-map.md'],
    ['mcp__qmd__multi_get', { pattern: 'docs/adr/*.md' }, 'Reading the docs'],
    ['Task', { description: 'Review the roadmap draft', subagent_type: 'worfy:critic' }, 'Critic is reviewing: Review the roadmap draft'],
    ['Agent', { description: 'Find the pricing notes', subagent_type: 'Explore' }, 'Explore is working on: Find the pricing notes'],
    ['Task', { description: 'Look around' }, 'A Subagent is working on: Look around'],
    ['Task', { subagent_type: 'worfy:critic' }, 'Critic is reviewing'],
    ['commandExecution', { command: 'pnpm lint' }, 'Running pnpm lint'],
    ['mcp__worfy-browser__browser_open', { url: 'x' }, 'Using browser_open'],
    ['FancyNewTool', { anything: 1 }, 'Using FancyNewTool'],
  ])('%s %j → %s', (name, input, line) => {
    expect(toolStatus(name, input)).toBe(line)
  })

  it('cuts a long argument with an ellipsis', () => {
    const line = toolStatus('Grep', { pattern: 'a'.repeat(200) })
    expect(line.length).toBeLessThanOrEqual(80)
    expect(line.endsWith('…”')).toBe(true)
    expect(toolStatus('Read', { file_path: `/x/${'b'.repeat(120)}.md` }).endsWith('…')).toBe(true)
  })
})

describe('advisorStatus', () => {
  it('is «Thinking…» from the message that started the turn', () => {
    expect(advisorStatus([prompt()])).toEqual({ key: `thinking@${AT}`, text: 'Thinking…', since: AT })
  })

  it('names the tool call that has not answered yet, from when it started', () => {
    const status = advisorStatus([prompt(), use('t1', 'Read', { file_path: '/a/b/map.md' })])
    expect(status).toEqual({ key: 'tool:t1', text: 'Reading map.md', since: AT + 1000 })
  })

  it('is «Thinking…» again once the call answered, from its answer', () => {
    expect(advisorStatus([prompt(), use('t1', 'Read', { file_path: 'map.md' }), done('t1')])).toEqual({ key: `thinking@${AT + 2000}`, text: 'Thinking…', since: AT + 2000 })
  })

  it('a run of thinking keeps one step from its first part', () => {
    const events = [prompt(), use('t1', 'Read', { file_path: 'map.md' }), done('t1'), delta('thinking', AT + 2500), thinking(AT + 3000)]
    expect(advisorStatus(events)).toEqual({ key: `thinking@${AT + 2000}`, text: 'Thinking…', since: AT + 2000 })
    expect(advisorStatus([prompt(), delta('thinking', AT + 500), thinking(AT + 900)])).toEqual({ key: `thinking@${AT}`, text: 'Thinking…', since: AT })
  })

  it('is «Writing the answer» while the answer comes', () => {
    expect(advisorStatus([prompt(), thinking(), delta('text', AT + 3500), text(AT + 4000)])).toEqual({ key: `answer@${AT + 3500}`, text: 'Writing the answer', since: AT + 3500 })
  })

  it('a call made in parallel that still runs wins over the one that answered', () => {
    const events = [prompt(), use('t1', 'Read', { file_path: 'map.md' }), use('t2', 'Grep', { pattern: 'price' }, AT + 1100), done('t2', AT + 1500)]
    expect(advisorStatus(events)?.text).toBe('Reading map.md')
  })

  it('the events inside a Subagent do not change the line', () => {
    const events = [
      prompt(),
      use('task', 'Task', { description: 'Review the draft', subagent_type: 'worfy:critic' }),
      use('inner', 'Read', { file_path: 'draft.md' }, AT + 1500, 'task'),
      done('inner', AT + 1700, 'task'),
      { type: 'thinking', text: 'hmm', messageId: 'm9', parentToolUseId: 'task', at: AT + 1800 } as AgentEvent,
    ]
    expect(advisorStatus(events)).toEqual({ key: 'tool:task', text: 'Critic is reviewing: Review the draft', since: AT + 1000 })
  })

  it('the Session’s housekeeping events do not change the line', () => {
    const events = [prompt(), use('t1', 'Write', { file_path: 'drafts/a.md' }), { type: 'queue', items: [], paused: false, at: AT + 1200 } as AgentEvent, { type: 'state', state: 'busy', error: null, at: AT + 1300 } as AgentEvent]
    expect(advisorStatus(events)?.text).toBe('Writing a.md')
  })

  it('a message the user typed into a transcript starts the turn too', () => {
    expect(advisorStatus([{ type: 'notice', kind: 'user', text: 'Go', at: AT }])?.text).toBe('Thinking…')
  })

  it('is «Thinking…» with no time when nothing says when the step began', () => {
    expect(advisorStatus([])).toEqual({ key: 'thinking', text: 'Thinking…', since: null })
  })
})

describe('AdvisorStatus', () => {
  it('shows the line and ticks the time of the step once a second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(AT + 3000)
    render(<AdvisorStatus status={{ key: 'tool:t1', text: 'Reading map.md', since: AT }} />)
    expect(screen.getByTestId('product-status').textContent).toBe('Reading map.md')
    expect(screen.getByTestId('product-status-elapsed').textContent).toBe('3 s')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTestId('product-status-elapsed').textContent).toBe('5 s')
    act(() => {
      vi.advanceTimersByTime(70_000)
    })
    expect(screen.getByTestId('product-status-elapsed').textContent).toBe('1 m 15 s')
  })

  it('counts from when it was drawn when the step has no time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(AT)
    render(<AdvisorStatus status={{ key: 'thinking', text: 'Thinking…', since: null }} />)
    expect(screen.getByTestId('product-status-elapsed').textContent).toBe('0 s')
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByTestId('product-status-elapsed').textContent).toBe('4 s')
  })

  it('stops its timer once it goes', () => {
    vi.useFakeTimers()
    const { unmount } = render(<AdvisorStatus status={{ key: 'thinking', text: 'Thinking…', since: null }} />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
