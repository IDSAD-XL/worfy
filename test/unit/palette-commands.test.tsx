import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { GateQueueView } from '../../src/shared/ipc/gate-queue'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { PaletteBody } from '../../src/renderer/palette/CommandPalette'
import { buildCommands, forQuery, type CommandContext } from '../../src/renderer/palette/commands'
import { useArrangeByEpicRequests } from '../../src/renderer/canvas/arrange-by-epic-command'
import { useRepackRequests } from '../../src/renderer/canvas/sources/epics'
import { rankItems } from '../../src/renderer/find/search-index'
import { epicNodeId, ticketNodeId } from '../../src/shared/layout/derived'
import { useCanvasRequests } from '../../src/renderer/find/canvas-requests'
import { setView, useNavigation } from '../../src/renderer/session/navigation'
import { useFirstRun } from '../../src/renderer/shell/first-run-store'
import { useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { MachineDialogs } from '../../src/renderer/machines/MachineDialogs'
import { acceptLinkState } from '../../src/renderer/machines/useMachines'
import type { LinkedMachineView, LinkState } from '../../src/shared/ipc/link'

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

  it('has "Orchestrator" in Go to with a Project, found by "orchestrator" and "go to orchestrator", and picking it opens its Session view (worfy-polish/25)', async () => {
    const withNode = context({ layoutNodes: [node('o1', 'orchestrator', { data: { sessionId: 'feedbeef00' } })] })
    const row = buildCommands(withNode).find((command) => command.id === 'go-to:orchestrator')
    expect(row).toMatchObject({ group: 'Go to', title: 'Orchestrator', detail: 'Session view' })
    expect(rankItems(buildCommands(withNode), 'orchestrator')[0]?.id).toBe('go-to:orchestrator')
    expect(rankItems(buildCommands(withNode), 'go to orchestrator')[0]?.id).toBe('go-to:orchestrator')
    // The Orchestrator Node's own row, which centers the Canvas on it, stays.
    expect(ids(withNode)).toContain('node:o1')
    // From a Subagent's window over the Canvas: the Session view, with nothing opened — the active Project's Orchestrator.
    useNavigation.setState({ view: 'canvas', opened: { p1: { nodeId: 'o1', projectId: 'p1', external: { sessionId: 'feedbeef00', agentId: 'a1' } } } })
    // It also asks main to open the Orchestrator, which starts one that does not run.
    const asked: { channel: string; input: unknown }[] = []
    const globals = globalThis as { worfy?: WorfyBridge }
    globals.worfy = {
      invoke: (channel: string, input: unknown) => {
        asked.push({ channel, input })
        return Promise.resolve({ ok: true, value: {} })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
    onTestFinished(() => {
      delete globals.worfy
    })
    expect(await row!.run()).toBeUndefined()
    expect(useNavigation.getState()).toEqual({ view: 'session', opened: {}, offCanvas: {} })
    expect(asked).toEqual([{ channel: 'orchestrator.open', input: { projectId: 'p1' } }])
  })

  it('has the Orchestrator row with no Orchestrator Node too, and none without a Project', () => {
    expect(ids(context())).toContain('go-to:orchestrator')
    expect(ids(context({ project: undefined }))).not.toContain('go-to:orchestrator')
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

  it('has Arrange by Epic in the Action group under Tidy up, and running it asks the Canvas of the Project to arrange its Sessions (worfy-canvas/12)', async () => {
    setView('session')
    const commands = buildCommands(context())
    const index = commands.findIndex((command) => command.id === 'arrange-by-epic')
    expect(commands[index]).toMatchObject({ group: 'Action', title: 'Arrange by Epic' })
    expect(commands[index - 1]?.id).toBe('tidy-up')
    expect(rankItems(commands, 'arrange by epic')[0]?.id).toBe('arrange-by-epic')
    expect(rankItems(commands, 'group sessions')[0]?.id).toBe('arrange-by-epic')
    // The Canvas of p1 carries the request out (the Canvas menu does it with its LayoutOps); another Project's Canvas does not.
    const mine = vi.fn(() => Promise.resolve())
    const other = vi.fn(() => Promise.resolve())
    renderHook(() => useArrangeByEpicRequests('p1', mine))
    renderHook(() => useArrangeByEpicRequests('p2', other))
    expect(await commands[index]!.run()).toBeUndefined()
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(1))
    expect(useNavigation.getState().view).toBe('canvas')
    await commands[index]!.run()
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(2))
    expect(other).not.toHaveBeenCalled()
  })

  it('has Re-pack in the Action group after Arrange by Epic, and running it asks the Canvas of the Project to re-pack its Epic frames (worfy-canvas/01)', async () => {
    setView('session')
    const commands = buildCommands(context())
    const index = commands.findIndex((command) => command.id === 'repack')
    expect(commands[index]).toMatchObject({ group: 'Action', title: 'Re-pack' })
    expect(commands[index - 1]?.id).toBe('arrange-by-epic')
    expect(rankItems(commands, 're-pack')[0]?.id).toBe('repack')
    expect(rankItems(commands, 'repack')[0]?.id).toBe('repack')
    // The Canvas of p1 carries the request out (the Canvas menu does it with its LayoutOps); another Project's Canvas does not.
    const mine = vi.fn(() => Promise.resolve())
    const other = vi.fn(() => Promise.resolve())
    renderHook(() => useRepackRequests('p1', mine))
    renderHook(() => useRepackRequests('p2', other))
    expect(await commands[index]!.run()).toBeUndefined()
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(1))
    expect(useNavigation.getState().view).toBe('canvas')
    await commands[index]!.run()
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(2))
    expect(other).not.toHaveBeenCalled()
  })

  describe('Process gate queue (worfy-windows ticket 17)', () => {
    const NOW = Date.parse('2026-10-18T12:00:00Z')
    const pr = (number: number, since: string) => ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, since })
    const queue = (role: 'serve' | 'request' | null, waiting: ReturnType<typeof pr>[] = []): GateQueueView => ({
      role,
      label: role === null ? null : 'needs-mac-gate',
      waiting,
      gh: role === null ? { state: 'skipped', reason: 'no cross_machine_gate' } : { state: 'ok' },
    })
    const gateCommand = (over: Partial<CommandContext>) => buildCommands(context({ now: NOW, ...over })).find((command) => command.id === 'gate-queue')

    it('serve: in the Action group, the detail counts the waiting PRs and the oldest wait; found by "gate queue" and the label', async () => {
      const two = queue('serve', [pr(470, '2026-10-18T09:00:00Z'), pr(472, '2026-10-18T10:30:00Z')])
      expect(gateCommand({ gateQueue: two })).toMatchObject({ group: 'Action', title: 'Process gate queue', detail: '2 PRs waiting, oldest 3 h' })
      expect(gateCommand({ gateQueue: queue('serve') })?.detail).toBe('queue empty')
      expect(gateCommand({ gateQueue: queue('serve', [pr(470, '2026-10-18T11:20:00Z')]) })?.detail).toBe('1 PR waiting, oldest 40 min')
      expect(gateCommand({ gateQueue: { ...queue('serve'), gh: { state: 'failed', reason: 'HTTP 502' } } })?.detail).toBe('gh failed: HTTP 502')
      expect(rankItems(buildCommands(context({ gateQueue: two })), 'gate queue')[0]?.id).toBe('gate-queue')
      expect(rankItems(buildCommands(context({ gateQueue: two })), 'needs-mac-gate')[0]?.id).toBe('gate-queue')
      // Running it is the same call as the Project menu: actions.gateQueue of the Project.
      const asked: { channel: string; input: unknown }[] = []
      const globals = globalThis as { worfy?: WorfyBridge }
      globals.worfy = {
        invoke: (channel: string, input: unknown) => {
          asked.push({ channel, input })
          return Promise.resolve(channel === 'actions.gateQueue' ? { ok: false, error: 'The Orchestrator has no Session' } : { ok: true, value: {} })
        },
        on: () => 1,
        off: () => undefined,
      } as unknown as WorfyBridge
      onTestFinished(() => {
        delete globals.worfy
      })
      expect(await gateCommand({ gateQueue: two })!.run()).toContain('The Orchestrator has no Session')
      expect(asked).toEqual([{ channel: 'actions.gateQueue', input: { projectId: 'p1' } }])
    })

    it('request, no field, or not read yet: no command', () => {
      expect(gateCommand({ gateQueue: queue('request', [pr(470, '2026-10-18T09:00:00Z')]) })).toBeUndefined()
      expect(gateCommand({ gateQueue: queue(null) })).toBeUndefined()
      expect(gateCommand({})).toBeUndefined()
    })

    it('on a read-only screen it carries the hint', () => {
      expect(gateCommand({ gateQueue: queue('serve'), readOnly: 'Mini gives this Machine read-only access' })?.readOnly).toBe('Mini gives this Machine read-only access')
    })
  })

  it('without a Project keeps only the views, the first-run checks, Settings, Keyboard shortcuts and the Projects', () => {
    expect(ids(context({ project: undefined, model: undefined, layoutNodes: [], adrs: [], createItems: [] }))).toEqual([
      'view:canvas',
      'view:session',
      'first-run',
      'getting-started',
      'settings',
      'shortcuts',
      'project:p1',
      'project:p2',
    ])
  })

  it('has Settings… in the View group, with or without a Project, and running it opens the Settings window (worfy-ui/02)', async () => {
    for (const project of [context().project, undefined]) {
      useSettingsWindow.setState({ open: false, section: null })
      const command = buildCommands(context({ project })).find((each) => each.id === 'settings')
      expect(command).toMatchObject({ group: 'View', title: 'Settings…' })
      expect(rankItems(buildCommands(context({ project })), 'settings')[0]?.id).toBe('settings')
      expect(await command!.run()).toBeUndefined()
      expect(useSettingsWindow.getState()).toEqual({ open: true, section: null })
    }
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

  it('has Getting started in the View group, with or without a Project; running it asks main to show the section (worfy-onboarding/07)', async () => {
    for (const project of [context().project, undefined]) {
      const asked: { channel: string; input: unknown }[] = []
      const globals = globalThis as { worfy?: WorfyBridge }
      globals.worfy = {
        invoke: (channel: string, input: unknown) => {
          asked.push({ channel, input })
          if (channel === 'gettingStarted.setSection') {
            const state = { user: 'new', section: 'shown', steps: {}, reworkSeen: false, noticeShown: false, demo: null }
            return Promise.resolve({ ok: true, value: state })
          }
          return new Promise(() => undefined)
        },
        on: () => 1,
        off: () => undefined,
      } as unknown as WorfyBridge
      onTestFinished(() => {
        delete globals.worfy
      })
      const command = buildCommands(context({ project })).find((each) => each.id === 'getting-started')
      expect(command).toMatchObject({ group: 'View', title: 'Getting started', detail: 'A guided demo of worfy' })
      for (const query of ['getting started', 'demo', 'tour']) expect(rankItems(buildCommands(context({ project })), query)[0]?.id).toBe('getting-started')
      expect(await command!.run()).toBeUndefined()
      expect(asked.filter((each) => each.channel === 'gettingStarted.setSection')).toEqual([{ channel: 'gettingStarted.setSection', input: { section: 'shown' } }])
      const { useGettingStartedStore } = await import('../../src/renderer/getting-started/store')
      expect(useGettingStartedStore.getState().snapshot?.section).toBe('shown')
    }
  })

  it('Getting started answers the reason when main refuses', async () => {
    const globals = globalThis as { worfy?: WorfyBridge }
    globals.worfy = {
      invoke: (channel: string) => Promise.resolve(channel === 'gettingStarted.setSection' ? { ok: false, error: 'gettingStarted.setSection failed: disk full' } : { ok: true, value: {} }),
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
    onTestFinished(() => {
      delete globals.worfy
    })
    const command = buildCommands(context()).find((each) => each.id === 'getting-started')
    expect(await command!.run()).toBe('disk full')
  })

  it('reads nothing of a workflow model that failed', () => {
    const failed = { ...context().model!, error: { code: 'failed' as const, message: 'no epic-status' } }
    expect(ids(context({ model: failed })).filter((id) => id.startsWith('ticket') || id.startsWith('ship') || id.startsWith('run') || id.startsWith('epic'))).toEqual([])
  })

  describe('Archive finished sessions now (worfy-canvas/08)', () => {
    /** A stand-in main: candidates as given, and a Layout store that applies `archive` and `restore`; `refuse` answers a channel with that error. */
    async function stubMain(candidates: { id: string; sessionId: string; rule: 'idle' | 'ticket-done' }[], refuse: Partial<Record<'layout.archiveCandidates' | 'layout.apply', string>> = {}) {
      const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
      const { resetHistories } = await import('../../src/renderer/canvas/history')
      resetHistories()
      let nodes: LayoutNode[] = [node('session:a', 'session', { data: { sessionId: 'a' } }), node('session:b', 'session', { data: { sessionId: 'b' } })]
      let revision = 1
      const state = () => ({ projectId: 'p1', layout: { nodes, viewport: { x: 0, y: 0, zoom: 1 } }, revision })
      acceptLayoutState(state())
      const applied: { op: LayoutOpInput; screen?: string }[] = []
      const globals = globalThis as { worfy?: WorfyBridge }
      globals.worfy = {
        invoke: (channel: string, input: unknown) => {
          if (channel in refuse) return Promise.resolve({ ok: false, error: refuse[channel as keyof typeof refuse] })
          if (channel === 'layout.archiveCandidates') {
            expect(input).toEqual({ projectId: 'p1' })
            return Promise.resolve({ ok: true, value: candidates })
          }
          if (channel !== 'layout.apply') return Promise.resolve({ ok: false, error: { code: 'unexpected', message: channel } })
          const { op, screen } = input as { op: LayoutOpInput; screen?: string }
          applied.push({ op, ...(screen === undefined ? {} : { screen }) })
          if (op.op === 'archive') {
            const ids = new Set(op.nodes.map((each) => each.id))
            nodes = nodes.map((each) => (ids.has(each.id) ? { ...each, archived: { at: 1, rule: 'idle', batch: op.batch } } : each))
          } else if (op.op === 'restore') {
            nodes = nodes.map((each) => (op.ids.includes(each.id) ? { ...each, archived: null } : each))
          }
          revision += 1
          return Promise.resolve({ ok: true, value: state() })
        },
        on: () => 1,
        off: () => undefined,
      } as unknown as WorfyBridge
      onTestFinished(() => {
        delete globals.worfy
      })
      return { applied }
    }

    const archiveCommand = () => buildCommands(context()).find((command) => command.id === 'archive-finished')

    it('is in the Action group after Re-pack, found by "archive"', () => {
      const commands = buildCommands(context())
      const index = commands.findIndex((command) => command.id === 'archive-finished')
      expect(commands[index]).toMatchObject({ group: 'Action', title: 'Archive finished sessions now' })
      expect(commands[index - 1]?.id).toBe('repack')
      expect(rankItems(commands, 'archive finished')[0]?.id).toBe('archive-finished')
      expect(buildCommands(context({ project: undefined })).some((command) => command.id === 'archive-finished')).toBe(false)
    })

    it("archives main's candidates as one operation with a new batch, sent with the screen: one step of ⌘Z, whose undo restores them", async () => {
      const { historyOf } = await import('../../src/renderer/canvas/history')
      const { applied } = await stubMain([{ id: 'session:a', sessionId: 'a', rule: 'idle' }])
      expect(await archiveCommand()!.run()).toBeUndefined()
      expect(applied).toEqual([{ op: { op: 'archive', batch: expect.any(String), nodes: [{ id: 'session:a', rule: 'idle' }] }, screen: expect.any(String) }])
      expect(historyOf('p1').size).toBe(1)
      expect(await historyOf('p1').undo()).toBe(true)
      expect(applied.at(-1)?.op).toEqual({ op: 'restore', ids: ['session:a'] })
      expect(await historyOf('p1').redo()).toBe(true)
      expect(applied.at(-1)?.op).toEqual(applied[0]?.op)
    })

    it('with nothing to archive sends no operation and leaves no step', async () => {
      const { historyOf } = await import('../../src/renderer/canvas/history')
      const { applied } = await stubMain([])
      expect(await archiveCommand()!.run()).toBeUndefined()
      expect(applied).toEqual([])
      expect(historyOf('p1').size).toBe(0)
    })

    it("tells main's reason when it cannot name the candidates, and sends nothing", async () => {
      const { historyOf } = await import('../../src/renderer/canvas/history')
      const { applied } = await stubMain([], { 'layout.archiveCandidates': 'layout.archiveCandidates failed: the automatic archive is not running' })
      expect(await archiveCommand()!.run()).toMatch(/the automatic archive is not running/)
      expect(applied).toEqual([])
      expect(historyOf('p1').size).toBe(0)
    })

    it("tells main's reason when it refuses the archive (every candidate kept meanwhile), and leaves no step", async () => {
      const { historyOf } = await import('../../src/renderer/canvas/history')
      await stubMain([{ id: 'session:a', sessionId: 'a', rule: 'idle' }], { 'layout.apply': 'layout.apply failed: nothing to archive: the Sessions are kept' })
      expect(await archiveCommand()!.run()).toMatch(/nothing to archive/)
      expect(historyOf('p1').size).toBe(0)
    })
  })

  describe('on the read-only screen of a Linked machine (worfy-link/26)', () => {
    const HINT = 'Mini gives this Machine read-only access'
    /** The commands that call a `write` channel of the Project's Machine. */
    const WRITES = ['new:session', 'new:terminal', 'tidy-up', 'arrange-by-epic', 'repack', 'archive-finished', 'run-wave:e', 'ship-ticket:e/07', 'ship-ticket:e/08']

    it('the commands that would change the Project carry the hint; moving, showing and switching do not; with Full access none does', () => {
      const commands = buildCommands(context({ readOnly: HINT }))
      expect(commands.filter((command) => command.readOnly !== undefined).map((command) => command.id)).toEqual(WRITES)
      expect(commands.filter((command) => command.readOnly !== undefined).every((command) => command.readOnly === HINT)).toBe(true)
      expect(buildCommands(context({ readOnly: null })).filter((command) => command.readOnly !== undefined)).toEqual([])
      expect(buildCommands(context()).filter((command) => command.readOnly !== undefined)).toEqual([])
    })

    it('"go to" an archived or hidden Node carries the hint: it would bring the Node back first', () => {
      const archived = { at: 1, rule: 'idle' as const, batch: 'b1' }
      const layoutNodes = [node('n1', 'note', { archived }), node('c1', 'card', { hidden: true }), node('s1', 'session', { archived, data: { sessionId: 'abcdef1234' } }), node('n2', 'note')]
      const hints = (readOnly: string | null) =>
        buildCommands(context({ readOnly, layoutNodes }))
          .filter((command) => command.id.startsWith('node:') && command.readOnly !== undefined)
          .map((command) => command.id)
      expect(hints(HINT)).toEqual(['node:n1', 'node:c1', 'node:s1'])
      expect(hints(null)).toEqual([])
    })

    it('their rows are inactive with the hint, a gated row too, and a click or Enter runs nothing', () => {
      // A row the hint makes inactive asks main nothing: no gate hook runs, so no main process is needed.
      const runs: string[] = []
      const commands = buildCommands(context({ readOnly: HINT }))
        .filter((command) => command.readOnly !== undefined)
        .map((command) => ({ ...command, run: () => void runs.push(command.id) }))
      Element.prototype.scrollIntoView = () => undefined
      onTestFinished(() => {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      })
      render(<PaletteBody commands={commands} empty="Nothing matches" onClose={() => undefined} />)
      const rows = screen.getAllByRole('option')
      expect(rows.map((row) => row.dataset['command']).sort()).toEqual([...WRITES].sort())
      for (const row of rows) {
        expect(row.getAttribute('aria-disabled')).toBe('true')
        expect(row.getAttribute('title')).toBe(HINT)
        fireEvent.click(row)
      }
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
      expect(runs).toEqual([])
    })
  })

  describe('manual checks (Manual check group)', () => {
    const checked = (over: Partial<CommandContext> = {}): CommandContext => {
      const base = context()
      const tickets = base.model!.tickets.map((each) => {
        if (each.epic === 'e' && each.num === 7) {
          return {
            ...each,
            manualChecks: [
              { text: 'Stable copy after the merge: the palette lists the checks', checked: false },
              { text: 'Stable copy: the frame was drawn', checked: true },
            ],
          }
        }
        if (each.epic === 'finished') return { ...each, manualChecks: [{ text: 'dev build: ⌘Z undoes the move', checked: false }] }
        return each
      })
      return context({ model: { ...base.model!, tickets }, ...over })
    }

    it('has a row per unchecked check of every Epic, "<epic> NN · <text>", and none for a checked one', () => {
      const rows = buildCommands(checked()).filter((command) => command.group === 'Manual check')
      expect(rows.map((row) => [row.id, row.title])).toEqual([
        ['manual-check:e/07:0', 'e 07 · Stable copy after the merge: the palette lists the checks'],
        ['manual-check:finished/02:0', 'finished 02 · dev build: ⌘Z undoes the move'],
      ])
      expect(rows.every((row) => row.queryOnly === true)).toBe(true)
    })

    it('the query «Stable» finds the unchecked check, not the checked one, and picking it centers the Ticket\'s Node', async () => {
      useCanvasRequests.setState({ focus: null })
      setView('session')
      const found = rankItems(forQuery(buildCommands(checked()), 'Stable'), 'Stable').filter((command) => command.group === 'Manual check')
      expect(found.map((command) => command.title)).toEqual(['e 07 · Stable copy after the merge: the palette lists the checks'])
      expect(await found[0]!.run()).toBeUndefined()
      expect(useCanvasRequests.getState().focus).toMatchObject({ projectId: 'p1', nodeId: ticketNodeId('e', 7), fallbackId: epicNodeId('e') })
      expect(useNavigation.getState().view).toBe('canvas')
    })

    it('reads nothing from a failed model or a model without the field', () => {
      const failed = checked().model!
      expect(ids(checked({ model: { ...failed, error: { code: 'failed', message: 'no epic-status' } } })).filter((id) => id.startsWith('manual-check'))).toEqual([])
      expect(ids(context()).filter((id) => id.startsWith('manual-check'))).toEqual([])
    })

    it('the palette opened with an empty field shows no Manual check row, even with a few commands; typing shows them', () => {
      // Rows with a gate ask main for the Project's settings; no main process answers here.
      const commands = buildCommands(checked({ layoutNodes: [], adrs: [], createItems: [], projects: [] })).filter((command) => command.gate === undefined)
      expect(commands.length).toBeLessThan(50)
      // jsdom has no scrollIntoView; the palette calls it for the active row.
      Element.prototype.scrollIntoView = () => undefined
      onTestFinished(() => {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      })
      render(<PaletteBody commands={commands} empty="Nothing matches" onClose={() => undefined} />)
      const rows = () => screen.queryAllByRole('option').map((option) => option.dataset['command'])
      expect(rows().length).toBeGreaterThan(0)
      expect(rows().filter((id) => id?.startsWith('manual-check'))).toEqual([])
      expect(screen.queryAllByTestId('palette-group').map((group) => group.dataset['group'])).not.toContain('Manual check')
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stable' } })
      expect(rows()).toContain('manual-check:e/07:0')
      expect(screen.queryAllByTestId('palette-group').map((group) => group.dataset['group'])).toContain('Manual check')
    })
  })
})

// ── worfy-link ticket 37: "Reconnect machine…" and "Remove machine…" ─────────────────────────────

describe('Machine commands', () => {
  const MINI = '22222222-2222-4222-8222-222222222222'
  const ATTIC = '33333333-3333-4333-8333-333333333333'
  const linkedMachine = (id: string, name: string, state: LinkedMachineView['state']): LinkedMachineView => ({ id, name, state, certificateChanged: false, access: 'off' })
  const machines = [linkedMachine(MINI, 'Mini', 'unavailable'), linkedMachine(ATTIC, 'Attic', 'online')]
  const linkState = (revision: number, linked: LinkedMachineView[]): LinkState => ({
    revision,
    machine: { id: '11111111-1111-4111-8111-111111111111', name: 'Studio' },
    problem: null,
    listening: true,
    addresses: [],
    bonjour: false,
    linking: { open: false, code: null, expiresAt: null, linked: null, failure: null },
    linked,
    discovered: [],
    projectsAccess: false,
    keepAwake: false,
    tailscale: false,
  })

  /** This Machine's preload: link.state answers `linked`; every other call is recorded and answered by the test. */
  function preload(): { calls: { channel: string; input: unknown; answer: (value: unknown) => void }[] } {
    const calls: { channel: string; input: unknown; answer: (value: unknown) => void }[] = []
    const bridge: WorfyBridge = {
      invoke: (channel, input) => {
        if (channel === 'link.state') return Promise.resolve({ ok: true, value: linkState(1, machines) } as never)
        return new Promise((resolve) => calls.push({ channel, input, answer: (value) => resolve(value as never) }))
      },
      on: () => 1,
      off: () => undefined,
    }
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
    onTestFinished(() => {
      delete (globalThis as { worfy?: WorfyBridge }).worfy
    })
    return { calls }
  }

  it('"Reconnect machine…" for each Linked machine without a connection, "Remove machine…" for each one; the name is the detail', () => {
    const rows = buildCommands(context({ linked: machines })).filter((command) => command.id.startsWith('machine-'))
    expect(rows.map((row) => [row.id, row.group, row.title, row.detail])).toEqual([
      [`machine-reconnect:${MINI}`, 'Action', 'Reconnect machine…', 'Mini'],
      [`machine-remove:${MINI}`, 'Action', 'Remove machine…', 'Mini'],
      [`machine-remove:${ATTIC}`, 'Action', 'Remove machine…', 'Attic'],
    ])
    // Without a Project too: they concern this Machine's link.
    expect(buildCommands(context({ project: undefined, model: undefined, linked: machines })).filter((command) => command.id.startsWith('machine-'))).toHaveLength(3)
    expect(buildCommands(context({ linked: [] })).filter((command) => command.id.startsWith('machine-'))).toEqual([])
  })

  it('typing the Machine picks it: "reconnect mini" finds its row, which calls link.reconnect for it', async () => {
    const { calls } = preload()
    const found = rankItems(buildCommands(context({ linked: machines })), 'reconnect mini')
    expect(found[0]?.id).toBe(`machine-reconnect:${MINI}`)
    const running = found[0]!.run()
    expect(calls.map(({ channel, input }) => [channel, input])).toEqual([['link.reconnect', { id: MINI }]])
    calls[0]!.answer({ ok: true, value: linkState(2, machines) })
    expect(await running).toBeUndefined()
  })

  it('a refusal of link.reconnect is what the palette shows', async () => {
    const { calls } = preload()
    const reconnect = buildCommands(context({ linked: machines })).find((command) => command.id === `machine-reconnect:${MINI}`)!
    const running = reconnect.run()
    calls[0]!.answer({ ok: false, error: 'link.reconnect: Machine is not linked' })
    expect(await running).toBe('link.reconnect: Machine is not linked')
  })

  it('"Remove machine…" opens the confirmation for that Machine; Cancel calls nothing, Remove calls link.revoke', async () => {
    const { calls } = preload()
    acceptLinkState(linkState(10, machines))
    render(<MachineDialogs />)
    const remove = buildCommands(context({ linked: machines })).find((command) => command.id === `machine-remove:${ATTIC}`)!
    act(() => void remove.run())
    const dialog = await screen.findByRole('dialog', { name: 'Remove Attic?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls).toEqual([])

    act(() => void remove.run())
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Remove Attic?' })).getByRole('button', { name: 'Remove' }))
    expect(calls.map(({ channel, input }) => [channel, input])).toEqual([['link.revoke', { id: ATTIC }]])
    await act(async () => calls[0]!.answer({ ok: true, value: linkState(11, [machines[0]!]) }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without the Linked machines in the context, the ones the renderer has now', () => {
    acceptLinkState(linkState(20, [linkedMachine(MINI, 'Mini', 'sleeping')]))
    expect(ids(context()).filter((id) => id.startsWith('machine-'))).toEqual([`machine-reconnect:${MINI}`, `machine-remove:${MINI}`])
  })
})
