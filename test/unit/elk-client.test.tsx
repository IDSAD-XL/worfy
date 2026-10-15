// The key of an Epic's ELK request (elk/client.ts) and what the frame shows when only that key's
// inputs change: a blocker done in its worktree branch reaches the main branch.
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Layout } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { elkKey, setElkEngine, useElkAnswers } from '../../src/renderer/canvas/elk/client'
import type { ElkEngine } from '../../src/renderer/canvas/elk/layout'
import { buildEpicNodes, epicNodeId, requestEpicLayouts, type EpicFrameData, type TicketNodeData } from '../../src/renderer/canvas/sources/epics'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))
// The frame's own Layout Node is created through main; here every operation just succeeds.
vi.mock('../../src/renderer/canvas/useLayout', async (original) => ({
  ...(await original<typeof import('../../src/renderer/canvas/useLayout')>()),
  applyLayoutOp: () => Promise.resolve(undefined),
}))

function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'a',
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [`src/t${num}.ts`],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

const epic: Epic = { epic: 'a', hasSpec: true, hasMap: false, title: 'a title' }
const model = (tickets: Ticket[]): WorkflowModel => ({ root: '/repo', epics: [epic], tickets, error: null, branchErrors: [] })
const layout: Layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }

/** 01 is done only in its unmerged worktree branch; 02 waits for it. */
const inBranch = [ticket(1, { state: 'done', statusRaw: 'done', fromBranch: 'a/01' }), ticket(2, { blockedNums: [1], blockedRaw: '1' })]
/** The same Epic after 01's branch is merged: only `fromBranch` changed. */
const merged = inBranch.map((t) => (t.num === 1 ? { ...t, fromBranch: null } : t))

let project = 0
const freshProject = () => `elk-client-${(project += 1)}`

afterEach(() => setElkEngine(null))

describe('elkKey', () => {
  it('differs before and after a branch-done Ticket is merged, since the ready Wave differs', () => {
    expect(elkKey(inBranch, 'a')).not.toBe(elkKey(merged, 'a'))
  })

  it('keeps the key when fromBranch does not change the layout: a Ticket in work, or the field left out', () => {
    expect(elkKey([ticket(1, { state: 'work', statusRaw: 'claimed', fromBranch: 'a/01' })], 'a')).toBe(elkKey([ticket(1, { state: 'work', statusRaw: 'claimed' })], 'a'))
    const withoutField: Omit<Ticket, 'fromBranch'> & { fromBranch?: string | null } = { ...merged[0]! }
    delete withoutField.fromBranch
    expect(elkKey([withoutField, merged[1]!], 'a')).toBe(elkKey(merged, 'a'))
  })
})

describe('the frame when a branch-done blocker is merged', () => {
  it('asks ELK again and shows the dependant ready, at once and in the new answer', async () => {
    const real = new ELK()
    const graphs: unknown[] = []
    const counting: ElkEngine = { layout: (graph) => (graphs.push(graph), real.layout(graph)) }
    setElkEngine(counting)
    const id = freshProject()
    const build = (tickets: Ticket[]) => buildEpicNodes(id, '/repo', model(tickets), layout, {}, [], useElkAnswers.getState()[id])
    const readyOf = (nodes: ReturnType<typeof build>) =>
      nodes
        .filter((n) => n.type === 'ticket')
        .map((n) => (n.data.node.data as TicketNodeData).placed)
        .flatMap((placed) => (placed.ready ? [placed.num] : []))
    const frameReady = (nodes: ReturnType<typeof build>) => (nodes.find((n) => n.id === epicNodeId('a'))!.data.node.data as EpicFrameData).layout.readyCount

    build(inBranch)
    requestEpicLayouts(id)
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(elkKey(inBranch, 'a')))
    const before = build(inBranch)
    expect(readyOf(before)).toEqual([])
    expect(frameReady(before)).toBe(0)
    const asked = graphs.length

    // Merged, ELK not asked yet: the old answer's places with the current ready Wave.
    const waiting = build(merged)
    expect(readyOf(waiting)).toEqual([2])
    expect(frameReady(waiting)).toBe(1)

    requestEpicLayouts(id)
    expect(graphs.length).toBeGreaterThan(asked)
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(elkKey(merged, 'a')))
    const after = build(merged)
    expect(readyOf(after)).toEqual([2])
    expect(frameReady(after)).toBe(1)
  })

  it('drops the answer for the branch-done inputs when the merge came while ELK was still working on them', async () => {
    const real = new ELK()
    // ELK that answers only when the test lets it.
    const held: (() => void)[] = []
    setElkEngine({ layout: (graph) => new Promise((resolve, reject) => held.push(() => void real.layout(graph).then(resolve, reject))) })
    const id = freshProject()
    const build = (tickets: Ticket[]) => buildEpicNodes(id, '/repo', model(tickets), layout, {}, [], useElkAnswers.getState()[id])
    const readyOf = (nodes: ReturnType<typeof build>) =>
      nodes.filter((n) => n.type === 'ticket').flatMap((n) => ((n.data.node.data as TicketNodeData).placed.ready ? [(n.data.node.data as TicketNodeData).placed.num] : []))

    build(inBranch)
    requestEpicLayouts(id)
    const forBranch = held.splice(0)
    expect(forBranch.length).toBeGreaterThan(0)
    build(merged)
    requestEpicLayouts(id)
    const forMerged = held.splice(0)
    expect(forMerged.length).toBeGreaterThan(0)

    // The older answer arrives last-but-one and is dropped: no answer, and the synchronous layout is current.
    for (const release of forBranch) release()
    await new Promise((wake) => setTimeout(wake, 50))
    expect(useElkAnswers.getState()[id]?.a).toBeUndefined()
    expect(readyOf(build(merged))).toEqual([2])

    for (const release of forMerged) release()
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(elkKey(merged, 'a')))
    expect(readyOf(build(merged))).toEqual([2])
  })
})
