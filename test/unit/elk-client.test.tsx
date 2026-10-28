// The key of an Epic's ELK request (elk/client.ts) and what the frame shows when only that key's
// inputs change: a blocker done in its worktree branch reaches the main branch.
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Layout } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { elkKey, requestEpicLayout, setElkEngine, useElkAnswers } from '../../src/renderer/canvas/elk/client'
import { layoutEpic } from '../../src/renderer/canvas/epic-layout'
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

  it("holds each card's height: a title that takes another line, or a repository chip, is a new key; a word changed on the same line is not", () => {
    const short = [ticket(1, { title: 'Short title' })]
    const long = [ticket(1, { title: 'A title long enough to take a second and then a third line of the card on the Canvas' })]
    expect(elkKey(long, 'a')).not.toBe(elkKey(short, 'a'))
    expect(elkKey([ticket(1, { title: 'Short titel' })], 'a')).toBe(elkKey(short, 'a'))
    const work = [ticket(1, { state: 'work', statusRaw: 'claimed', waits: 'agent' })]
    expect(elkKey(work, 'a', { severalRepos: true })).not.toBe(elkKey(work, 'a', { severalRepos: false }))
  })
})

describe('the frame when a branch-done blocker is merged', () => {
  it('asks ELK again and shows the dependant ready, at once and in the new answer', async () => {
    const real = new ELK()
    const graphs: unknown[] = []
    // The answers of the real ELK, awaited before the store is looked at: a cold ELK in a busy worker took longer
    // than the second of vi.waitFor on the Windows runner, and the wait saw no answer.
    const answers: Promise<unknown>[] = []
    const counting: ElkEngine = {
      layout: (graph) => {
        graphs.push(graph)
        const answer = real.layout(graph)
        answers.push(answer)
        return answer
      },
    }
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
    await Promise.all(answers)
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
    await Promise.all(answers)
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

describe('the old answer shown while ELK works', () => {
  it("keeps each card's place and gives it the height of what it shows now", async () => {
    setElkEngine(new ELK())
    const id = freshProject()
    const build = (tickets: Ticket[]) => buildEpicNodes(id, '/repo', model(tickets), layout, {}, [], useElkAnswers.getState()[id])
    const card = (nodes: ReturnType<typeof build>, num: number) => nodes.find((n) => n.type === 'ticket' && (n.data.node.data as TicketNodeData).placed.num === num)!
    const short = [ticket(1, { title: 'Short' }), ticket(2)]
    build(short)
    requestEpicLayouts(id)
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(elkKey(short, 'a')))
    const before = card(build(short), 1)

    // ELK not asked yet: the old place, the new height.
    const long = [ticket(1, { title: 'A title long enough to take a second and then a third line of the card on the Canvas' }), ticket(2)]
    const waiting = card(build(long), 1)
    expect(waiting.position).toEqual(before.position)
    expect(waiting.height).toBeGreaterThan(before.height!)
    expect((waiting.data.node.data as TicketNodeData).placed.height).toBe(waiting.height)
  })
})

describe('when ELK fails (review of PR #539)', () => {
  const done = (num: number) => ticket(num, { state: 'done', statusRaw: 'done' })
  const withDone = [done(1), done(2), done(3), ticket(4), ticket(5, { blockedNums: [4], blockedRaw: '4' })]
  afterEach(() => vi.restoreAllMocks())
  const request = (tickets: Ticket[]) => ({ key: elkKey(tickets, 'a'), tickets, name: 'a' })

  it('answers with the synchronous layout, the done stack folded and open: the open one is the frame\'s reserve of height', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setElkEngine({ layout: () => Promise.reject(new Error('ELK failed')) })
    const id = freshProject()
    requestEpicLayout(id, 'a', request(withDone))
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(elkKey(withDone, 'a')))
    const answer = useElkAnswers.getState()[id]!.a!
    const input = { tickets: withDone, name: 'a', collapsed: false }
    expect(answer.folded).toEqual(layoutEpic({ ...input, doneExpanded: false }))
    expect(answer.open).toEqual(layoutEpic({ ...input, doneExpanded: true }))
    // The two differ, so a test of `folded` alone would not tell a swapped or missing `open` apart.
    expect(answer.open).not.toEqual(answer.folded)
  })

  it('drops a failure of a request a newer one replaced: the newer answer stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const real = new ELK()
    // The first request's graphs fail when the test lets them; the later ones are answered at once.
    const failing: (() => void)[] = []
    let calls = 0
    setElkEngine({
      layout: (graph) => {
        calls += 1
        return calls <= 2 ? new Promise((_resolve, reject) => failing.push(() => reject(new Error('ELK failed late')))) : real.layout(graph)
      },
    })
    const id = freshProject()
    const older = request(withDone)
    const newer = request([...withDone, ticket(6)])
    requestEpicLayout(id, 'a', older)
    await vi.waitFor(() => expect(failing).toHaveLength(2))
    requestEpicLayout(id, 'a', newer)
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a?.key).toBe(newer.key))
    for (const fail of failing) fail()
    await new Promise((wake) => setTimeout(wake, 50))
    expect(useElkAnswers.getState()[id]?.a?.key).toBe(newer.key)
  })
})
