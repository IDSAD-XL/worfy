// The loading line of a Project's Canvas (worfy-link ticket 33, src/renderer/canvas/LoadingProgress.tsx):
// its parts come from the stores of the workflow, of ELK's requests and answers, and of the
// Sessions; in a window on this Machine it shows only after SHOW_AFTER_MS, on a Linked machine at
// once; it goes once every part is done, and before `layout.get` has answered the same line stands
// in place of the Canvas.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElkEngine } from '../../src/renderer/canvas/elk/layout'
import type { ClaudeHomeEntry } from '../../src/renderer/claude-home/useClaudeHome'
import type { WorkflowEntry } from '../../src/renderer/workflow/useWorkflow'
import type { WorkflowModel } from '../../src/shared/workflow/types'

const PROJECT = 'loading-00000000'
const ROOT = '/repos/loading'

const state = vi.hoisted(() => ({
  machine: null as string | null,
  workflow: { model: undefined, error: undefined } as WorkflowEntry,
  sessions: { live: undefined, history: [], error: undefined } as ClaudeHomeEntry,
}))

vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ projects: [{ id: PROJECT, name: 'loading', path: ROOT, branch: 'main' }], activeId: PROJECT }),
  useReadOnly: () => null,
}))
vi.mock('../../src/renderer/workflow/useWorkflow', async (original) => ({
  ...(await original<typeof import('../../src/renderer/workflow/useWorkflow')>()),
  useWorkflow: (root: string | undefined) => (root === ROOT ? state.workflow : { model: undefined, error: undefined }),
}))
vi.mock('../../src/renderer/claude-home/useClaudeHome', async (original) => ({
  ...(await original<typeof import('../../src/renderer/claude-home/useClaudeHome')>()),
  useClaudeHome: (root: string | undefined) => (root === ROOT ? state.sessions : { live: undefined, history: [], error: undefined }),
}))
vi.mock('../../src/renderer/ipc', async (original) => ({
  ...(await original<typeof import('../../src/renderer/ipc')>()),
  windowMachine: () => state.machine,
  // `layout.get` and `viewport.get` never answer here: the Canvas waits for them.
  invoke: () => new Promise(() => undefined),
  subscribe: () => () => undefined,
}))

const { LoadingProgress } = await import('../../src/renderer/canvas/LoadingProgress')
const { SETTLE_MS, SHOW_AFTER_MS } = await import('../../src/renderer/canvas/loading-steps')
const { requestEpicLayout, setElkEngine, useElkAnswers } = await import('../../src/renderer/canvas/elk/client')

const model: WorkflowModel = { root: ROOT, epics: [], tickets: [], error: null, branchErrors: [] }

/** An ELK that answers a request only when the test lets it: `release()` answers the oldest one. */
function heldElk() {
  const real = new ELK()
  const held: (() => void)[] = []
  const engine: ElkEngine = {
    layout: (graph) => new Promise((resolve, reject) => void held.push(() => void real.layout(graph).then(resolve, reject))),
  }
  return {
    engine,
    waiting: () => held.length,
    release: () => held.shift()?.(),
  }
}

const ticket = (epic: string, num: number) => ({ epic, num, slug: `t${num}`, state: 'open' as const, blockedRaw: null, blockedNums: [], blockedParsed: true, files: [], filesListed: true, title: `${epic} ${num}` })

/** The line of a Canvas that React Flow already shows, opened at `startedAt`. */
const overlay = (startedAt = Date.now()) => render(<LoadingProgress projectId={PROJECT} startedAt={startedAt} canvas />)

const line = () => screen.queryByTestId('canvas-loading')
const part = (id: string) => screen.getByTestId(`canvas-loading-${id}`)
const status = () => screen.getByTestId('canvas-loading-status').textContent

beforeEach(() => {
  state.machine = null
  state.workflow = { model: undefined, error: undefined }
  state.sessions = { live: undefined, history: [], error: undefined }
})

afterEach(() => {
  cleanup()
  setElkEngine(null)
  vi.useRealTimers()
})

describe('the loading line of the Canvas', () => {
  it('on this Machine, a small Project that opens within the threshold never shows the line and announces nothing', () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const view = overlay(startedAt)
    expect(line()).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    state.workflow = { model, error: undefined }
    state.sessions = { live: [], history: [], error: undefined }
    view.rerender(<LoadingProgress projectId={PROJECT} startedAt={startedAt} canvas />)
    // Every frame of the next second: no line, and the status region stays silent.
    for (let ms = 0; ms < 1000; ms += 16) {
      act(() => vi.advanceTimersByTime(16))
      expect(line()).toBeNull()
    }
    expect(status()).toBe('')
  })

  it('on this Machine, an opening done just before the threshold, still settling when it passes, does not flash the line', () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const view = overlay(startedAt)
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 50))
    state.workflow = { model, error: undefined }
    state.sessions = { live: [], history: [], error: undefined }
    view.rerender(<LoadingProgress projectId={PROJECT} startedAt={startedAt} canvas />)
    for (let ms = 0; ms < 1000; ms += 10) {
      act(() => vi.advanceTimersByTime(10))
      expect(line()).toBeNull()
    }
  })

  it('on this Machine, an opening longer than the threshold shows the line after it, then takes it away once everything is done', () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const view = overlay(startedAt)
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 1))
    expect(line()).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(line()?.textContent).toBe('Loading workflow… · Laying out Epics… · Reading Sessions history…')
    expect(status()).toBe('Loading the project')
    state.workflow = { model, error: undefined }
    state.sessions = { live: [], history: [], error: undefined }
    view.rerender(<LoadingProgress projectId={PROJECT} startedAt={startedAt} canvas />)
    expect(part('workflow').textContent).toBe('Workflow loaded')
    expect(part('sessions').textContent).toBe('Sessions history read')
    act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
    expect(line()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(line()).toBeNull()
    expect(status()).toBe('Project loaded')
  })

  it('on a Linked machine shows at once; the Epics counter grows to M/M with ELK\'s answers, and the line goes after the last one', async () => {
    state.machine = '83a67a58-0000-4000-8000-000000000000'
    const elk = heldElk()
    setElkEngine(elk.engine)
    overlay()
    expect(line()?.textContent).toBe('Loading workflow… · Laying out Epics… · Reading Sessions history…')
    expect(status()).toBe('Loading the project')

    state.workflow = { model, error: undefined }
    state.sessions = { live: [], history: [], error: undefined }
    act(() => {
      for (const epic of ['a', 'b', 'c']) requestEpicLayout(PROJECT, epic, { key: `${epic}-1`, tickets: [ticket(epic, 1), ticket(epic, 2)], name: epic })
    })
    expect(part('epics').textContent).toBe('Laying out Epics 0/3')
    expect(part('epics').getAttribute('data-done')).toBe('false')
    expect(elk.waiting()).toBe(3)
    elk.release()
    await waitFor(() => expect(part('epics').textContent).toBe('Laying out Epics 1/3'))
    elk.release()
    await waitFor(() => expect(part('epics').textContent).toBe('Laying out Epics 2/3'))
    // A newer request for an Epic that was laid out counts again until its own answer.
    act(() => requestEpicLayout(PROJECT, 'a', { key: 'a-2', tickets: [ticket('a', 1)], name: 'a' }))
    expect(part('epics').textContent).toBe('Laying out Epics 1/3')
    elk.release()
    elk.release()
    await waitFor(() => expect(part('epics').textContent).toBe('Laying out Epics 3/3'))
    expect(Object.keys(useElkAnswers.getState()[PROJECT] ?? {})).toHaveLength(3)
    expect(part('epics').getAttribute('data-done')).toBe('true')
    await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 50)))
    expect(line()).toBeNull()
    expect(status()).toBe('Project loaded')
  })

  it('the line is hidden from screen readers; only the status region speaks, at the start and the end', () => {
    state.machine = '83a67a58-0000-4000-8000-000000000000'
    overlay()
    expect(line()?.getAttribute('aria-hidden')).toBe('true')
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('Loading the project')
  })

  it('a failed read ends its part as well as an answer does', () => {
    state.machine = '83a67a58-0000-4000-8000-000000000000'
    vi.useFakeTimers()
    state.workflow = { model: undefined, error: 'epic-status failed' }
    const startedAt = Date.now()
    const view = overlay(startedAt)
    expect(part('workflow').getAttribute('data-done')).toBe('true')
    expect(part('sessions').getAttribute('data-done')).toBe('false')
    state.sessions = { live: undefined, history: [], error: 'the link went down' }
    view.rerender(<LoadingProgress projectId={PROJECT} startedAt={startedAt} canvas />)
    expect(part('sessions').getAttribute('data-done')).toBe('true')
    act(() => vi.advanceTimersByTime(SETTLE_MS))
    expect(line()).toBeNull()
    expect(status()).toBe('Project loaded')
  })
})

describe('the Canvas before `layout.get` has answered', () => {
  it('shows the loading line in place of the Canvas, not an empty space (a Project of a Linked machine)', async () => {
    state.machine = '83a67a58-0000-4000-8000-000000000000'
    const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
    render(<Canvas projectId={PROJECT} />)
    expect(screen.getByTestId('canvas-loading-placeholder')).toBeTruthy()
    expect(line()?.textContent).toBe('Loading workflow… · Laying out Epics… · Reading Sessions history…')
    expect(screen.queryByTestId('canvas')).toBeNull()
  })

  it('on this Machine shows it after the threshold, counted from the opening', async () => {
    vi.useFakeTimers()
    const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
    render(<Canvas projectId={PROJECT} />)
    expect(screen.getByTestId('canvas-loading-placeholder')).toBeTruthy()
    expect(line()).toBeNull()
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS))
    expect(line()).not.toBeNull()
  })
})
