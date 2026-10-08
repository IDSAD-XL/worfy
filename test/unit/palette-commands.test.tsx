import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { buildCommands, type CommandContext } from '../../src/renderer/palette/commands'
import { rankItems } from '../../src/renderer/find/search-index'
import { useCanvasRequests } from '../../src/renderer/find/canvas-requests'
import { setView, useNavigation } from '../../src/renderer/session/navigation'
import { useFirstRun } from '../../src/renderer/shell/first-run-store'

function ticket(num: number, state: Ticket['state'], blockedNums: number[] = []): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
    statusRaw: state,
    state,
    blockedRaw: blockedNums.join(', ') || null,
    blockedNums,
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  }
}

function node(id: string, kind: string, over: Partial<LayoutNode> = {}): LayoutNode {
  return { id, kind, x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: {}, ...over }
}

const project = { id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }

function context(over: Partial<CommandContext> = {}): CommandContext {
  const model: WorkflowModel = {
    root: '/repo/one',
    epics: [
      { epic: 'e', hasSpec: true, hasMap: false, title: 'Epic E' },
      { epic: 'finished', hasSpec: true, hasMap: false, title: null },
    ],
    tickets: [ticket(1, 'done'), ticket(7, 'open', [1]), ticket(8, 'open', [9]), ticket(9, 'work'), { ...ticket(2, 'done'), epic: 'finished' }],
    error: null,
    branchErrors: [],
  }
  return {
    project,
    projects: [project, { id: 'p2', name: 'two', path: '/repo/two', branch: null }],
    view: 'canvas',
    model,
    layoutNodes: [node('n1', 'note', { tags: ['plan'], data: { text: 'Plan' } }), node('c1', 'card'), node('s1', 'session', { data: { origin: 'worfy', sessionId: 'abcdef1234' } }), node('a1', 'binding-anchor')],
    history: [{ sessionId: 'abcdef1234', title: 'Fix the gate', size: 10, modifiedAt: 0, live: false }],
    adrs: [{ path: 'docs/adr/0002-view.md', number: '0002', title: 'worfy is a view', status: 'принят', version: 'v1' }],
    tagFilter: null,
    createItems: [{ label: 'New terminal', kind: 'terminal' }],
    ...over,
  }
}

const ids = (ctx: CommandContext) => buildCommands(ctx).map((command) => command.id)

describe('palette commands', () => {
  it('offers Ship ticket for the Tickets that have the button, with the Ticket and every Ticket for the check', () => {
    const commands = buildCommands(context())
    const ship = commands.filter((command) => command.gate?.kind === 'ship-ticket')
    expect(ship.map((command) => command.id)).toEqual(['ship-ticket:e/07', 'ship-ticket:e/08'])
    const gate = ship[1]!.gate
    expect(gate?.kind === 'ship-ticket' && gate.ticket.num).toBe(8)
    expect(gate?.tickets).toHaveLength(5)
    expect(gate?.projectId).toBe('p1')
  })

  it('offers Run wave for Epics that are not all done', () => {
    expect(ids(context()).filter((id) => id.startsWith('run-wave:'))).toEqual(['run-wave:e'])
  })

  it('goes to Epics, Tickets, Sessions, Cards, Nodes and ADRs, but not to anchors', () => {
    const all = ids(context())
    expect(all).toEqual(expect.arrayContaining(['epic:e', 'ticket:e/07', 'node:s1', 'node:c1', 'node:n1', 'adr:docs/adr/0002-view.md']))
    expect(all).not.toContain('node:a1')
    const session = buildCommands(context()).find((command) => command.id === 'node:s1')
    expect(session?.title).toBe('Fix the gate')
  })

  it('finds a Ticket by its number, an ADR by its number and a Card by its id', () => {
    const commands = buildCommands(context())
    expect(rankItems(commands, '07')[0]?.id).toBe('ticket:e/07')
    expect(rankItems(commands, '7')[0]?.id).toBe('ticket:e/07')
    expect(rankItems(commands, '0002')[0]?.id).toBe('adr:docs/adr/0002-view.md')
    expect(rankItems(commands, 'c1')[0]?.id).toBe('node:c1')
    expect(rankItems(commands, 'ship e/08')[0]?.id).toBe('ship-ticket:e/08')
  })

  it('has New session, the Canvas menu’s New items, the views, the tags and the other Projects', () => {
    const all = ids(context())
    expect(all.slice(0, 2)).toEqual(['new:session', 'new:terminal'])
    expect(all).toEqual(expect.arrayContaining(['view:canvas', 'view:session', 'tag:plan', 'project:p2']))
    expect(all).not.toContain('project:p1')
    expect(all).not.toContain('tag:all')
    expect(ids(context({ tagFilter: { projectId: 'p1', tag: 'plan' } }))).toContain('tag:all')
  })

  it('has Tidy up in the Action group, and running it leaves the Canvas a request for the Project (worfy-week/07)', async () => {
    useCanvasRequests.setState({ tidy: null })
    setView('session')
    const tidy = buildCommands(context()).find((command) => command.id === 'tidy-up')
    expect(tidy).toMatchObject({ group: 'Action', title: 'Tidy up' })
    expect(rankItems(buildCommands(context()), 'tidy')[0]?.id).toBe('tidy-up')
    expect(await tidy!.run()).toBeUndefined()
    expect(useCanvasRequests.getState().tidy).toMatchObject({ projectId: 'p1', seq: 1 })
    expect(useNavigation.getState().view).toBe('canvas')
    await tidy!.run()
    expect(useCanvasRequests.getState().tidy).toMatchObject({ projectId: 'p1', seq: 2 })
  })

  it('without a Project keeps only the views, the first-run checks and the Projects', () => {
    expect(ids(context({ project: undefined, model: undefined, layoutNodes: [], adrs: [], createItems: [] }))).toEqual(['view:canvas', 'view:session', 'first-run', 'project:p1', 'project:p2'])
  })

  it('has First-run checks in the View group, with or without a Project, and running it opens the screen (worfy-harness/19)', async () => {
    for (const project of [context().project, undefined]) {
      useFirstRun.setState({ open: false, report: { checks: [], checkedAt: '2026-10-08T00:00:00.000Z' } })
      const command = buildCommands(context({ project })).find((each) => each.id === 'first-run')
      expect(command).toMatchObject({ group: 'View', title: 'First-run checks' })
      expect(rankItems(buildCommands(context({ project })), 'first run')[0]?.id).toBe('first-run')
      expect(await command!.run()).toBeUndefined()
      expect(useFirstRun.getState().open).toBe(true)
    }
  })

  it('reads nothing of a workflow model that failed', () => {
    const failed = { ...context().model!, error: { code: 'failed' as const, message: 'no epic-status' } }
    expect(ids(context({ model: failed })).filter((id) => id.startsWith('ticket') || id.startsWith('ship') || id.startsWith('run') || id.startsWith('epic'))).toEqual([])
  })
})
