// The commands of the palette (⌘K, ticket 31), built from what the window already knows: the
// workflow model, the Layout, the Sessions, the ADRs, the Projects. Nothing here keeps its own
// list of things: a Node type that exports `createLabel` (ADR-0014) gets a "New …" command the
// same way it gets an item in the Canvas menu, and every Epic, Ticket, Session, Card and ADR is a
// "go to" command because it exists.
//
// A command only asks: moving the Canvas and creating a Node go through requests the Canvas
// carries out (find/canvas-requests.ts), the rest through the same IPC calls as the buttons they
// stand for. "Ship ticket" and "Run wave" are the actions of ticket 23 (`actions.shipTicket`,
// `actions.runWave`); when they exist and whether they are active is decided by the same code the
// buttons use (canvas/actions/gates.ts), and main checks again.
// Nothing here writes a Ticket's status or anything in the Project (ADR-0002, ADR-0005).
import type { AdrEntry } from '../../shared/ipc/docs'
import type { ProjectView } from '../../shared/ipc/projects'
import type { HistorySession } from '../../shared/ipc/claude-home'
import { failureReason } from '../../shared/ipc/channels'
import { epicNodeId, SOURCE_NODE_KINDS, ticketNodeId } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import type { Ticket, WorkflowModel } from '../../shared/workflow/types'
import { hasRunWave, hasShipTicket } from '../canvas/actions/gates'
import { applyLayoutOp } from '../canvas/useLayout'
import { createCanvasNode, focusCanvasNode, openAdr, setTagFilter, type TagFilter } from '../find/canvas-requests'
import { kindLabel, nodeTitle, type Rankable } from '../find/search-index'
import { invoke } from '../ipc'
import { acceptProjectsState } from '../projects/useProjects'
import { setView } from '../session/navigation'
import type { ShellView } from '../shell/Toolbar'

export type CommandGroup = 'Action' | 'Go to' | 'View' | 'Project'

/** An action of ticket 23 whose state the palette row works out, like the button on the Canvas. */
export type CommandGate =
  | { kind: 'ship-ticket'; projectId: string; ticket: Ticket; tickets: readonly Ticket[] }
  | { kind: 'run-wave'; projectId: string; epic: string; tickets: readonly Ticket[] }

export interface PaletteCommand extends Rankable {
  id: string
  group: CommandGroup
  /** Resolves to a reason when it failed (the palette shows it), to undefined when it worked. */
  run: () => Promise<string | undefined> | undefined
  gate?: CommandGate | undefined
}

/** A "New …" item of the Canvas menu (canvas/overlays/create-items.ts). */
export interface PaletteCreateItem {
  label: string
  kind: string
}

export interface CommandContext {
  project: ProjectView | undefined
  projects: readonly ProjectView[]
  view: ShellView
  model: WorkflowModel | undefined
  layoutNodes: readonly LayoutNode[]
  history: readonly HistorySession[]
  adrs: readonly AdrEntry[]
  tagFilter: TagFilter | null
  createItems: readonly PaletteCreateItem[]
}

const nn = (num: number): string => String(num).padStart(2, '0')

/** The kinds whose Nodes the "go to Session" commands cover; the rest are plain Nodes. */
const SESSION_KINDS = new Set(['session', 'orchestrator'])
/** Kinds that are not worth a "go to": drawn by a source, or an anchor without content. */
const SKIPPED_KINDS = new Set([...SOURCE_NODE_KINDS, 'binding-anchor'])

/** Shows the Canvas and centers it on a Node; a hidden Node is shown first, as the sidebar does. */
function goToNode(projectId: string, node: Pick<LayoutNode, 'id' | 'hidden'>, fallbackId?: string): undefined {
  setView('canvas')
  if (node.hidden) void applyLayoutOp(projectId, { op: 'hide', id: node.id, hidden: false }).then(() => focusCanvasNode(projectId, node.id, fallbackId))
  else focusCanvasNode(projectId, node.id, fallbackId)
  return undefined
}

function sessionTitle(node: LayoutNode, history: readonly HistorySession[]): string {
  const sessionId = typeof node.data.sessionId === 'string' ? node.data.sessionId : undefined
  const recorded = sessionId === undefined ? undefined : history.find((each) => each.sessionId === sessionId)?.title
  if (recorded !== undefined) return recorded
  if (node.kind === 'orchestrator') return 'Orchestrator'
  return sessionId === undefined ? 'New session' : `Session ${sessionId.slice(0, 8)}`
}

function actionCommands({ project, createItems }: CommandContext): PaletteCommand[] {
  if (!project) return []
  const projectId = project.id
  const commands: PaletteCommand[] = [
    {
      id: 'new:session',
      group: 'Action',
      title: 'New session',
      detail: "in the Project's root",
      // The same call as "New session" in the sidebar (shell/sidebar/SessionsSection.tsx).
      run: async () => {
        const result = await invoke('sessions.new', { projectId })
        if (!result.ok) return failureReason('sessions.new', result.error)
        setView('canvas')
        focusCanvasNode(projectId, result.value.nodeId)
        return undefined
      },
    },
  ]
  for (const item of createItems) {
    commands.push({
      id: `new:${item.kind}`,
      group: 'Action',
      title: item.label,
      run: () => {
        setView('canvas')
        createCanvasNode(projectId, item.kind)
        return undefined
      },
    })
  }
  return commands
}

function workflowActionCommands({ project, model }: CommandContext): PaletteCommand[] {
  if (!project || !model || model.error !== null) return []
  const projectId = project.id
  const commands: PaletteCommand[] = []
  for (const epic of model.epics) {
    // Only where the Epic frame has the button (canvas/actions/gates.ts).
    if (!hasRunWave(epic.epic, model.tickets)) continue
    commands.push({
      id: `run-wave:${epic.epic}`,
      group: 'Action',
      title: `Run wave ${epic.epic}`,
      detail: epic.title ?? undefined,
      keys: [`run wave ${epic.epic}`],
      gate: { kind: 'run-wave', projectId, epic: epic.epic, tickets: model.tickets },
      run: async () => {
        const result = await invoke('actions.runWave', { projectId, epic: epic.epic })
        return result.ok ? undefined : failureReason('actions.runWave', result.error)
      },
    })
  }
  for (const ticket of model.tickets) {
    // Only where the Ticket has the button (canvas/actions/gates.ts).
    if (!hasShipTicket(ticket)) continue
    const ref = `${ticket.epic}/${nn(ticket.num)}`
    commands.push({
      id: `ship-ticket:${ref}`,
      group: 'Action',
      title: `Ship ticket ${ref}`,
      detail: ticket.title,
      keys: [`ship ${ref}`, `ship ticket ${ref}`],
      gate: { kind: 'ship-ticket', projectId, ticket, tickets: model.tickets },
      run: async () => {
        const result = await invoke('actions.shipTicket', { projectId, epic: ticket.epic, num: ticket.num })
        return result.ok ? undefined : failureReason('actions.shipTicket', result.error)
      },
    })
  }
  return commands
}

function viewCommands({ view, project, projects, layoutNodes, tagFilter }: CommandContext): PaletteCommand[] {
  const commands: PaletteCommand[] = (['canvas', 'session'] as const).map((target) => ({
    id: `view:${target}`,
    group: 'View',
    title: target === 'canvas' ? 'Switch to Canvas' : 'Switch to Session',
    detail: view === target ? 'shown now' : undefined,
    run: () => {
      setView(target)
      return undefined
    },
  }))
  if (project) {
    const projectId = project.id
    const tags = [...new Set(layoutNodes.flatMap((node) => node.tags))].sort((a, b) => a.localeCompare(b))
    for (const tag of tags) {
      commands.push({
        id: `tag:${tag}`,
        group: 'View',
        title: `Show only tag ${tag}`,
        detail: tagFilter?.projectId === projectId && tagFilter.tag === tag ? 'shown now' : undefined,
        run: () => {
          setView('canvas')
          setTagFilter({ projectId, tag })
          return undefined
        },
      })
    }
    if (tagFilter !== null && tagFilter.projectId === projectId) {
      commands.unshift({
        id: 'tag:all',
        group: 'View',
        title: 'Show all Nodes',
        detail: `now only tag ${tagFilter.tag}`,
        run: () => {
          setTagFilter(null)
          return undefined
        },
      })
    }
  }
  for (const other of projects) {
    if (other.id === project?.id) continue
    commands.push({
      id: `project:${other.id}`,
      group: 'Project',
      title: `Switch to project ${other.name}`,
      detail: other.path,
      // The same call as a click on the Project in the sidebar (shell/sidebar/ProjectsSection.tsx).
      run: async () => {
        const result = await invoke('projects.select', { id: other.id })
        if (!result.ok) return failureReason('projects.select', result.error)
        acceptProjectsState(result.value)
        return undefined
      },
    })
  }
  return commands
}

function goToCommands({ project, model, layoutNodes, history, adrs }: CommandContext): PaletteCommand[] {
  if (!project) return []
  const projectId = project.id
  const commands: PaletteCommand[] = []
  if (model && model.error === null) {
    for (const epic of model.epics) {
      commands.push({
        id: `epic:${epic.epic}`,
        group: 'Go to',
        title: epic.title ?? epic.epic,
        detail: `Epic ${epic.epic}`,
        keys: [epic.epic],
        run: () => goToNode(projectId, { id: epicNodeId(epic.epic), hidden: false }),
      })
    }
    for (const ticket of model.tickets) {
      const ref = `${ticket.epic}/${nn(ticket.num)}`
      commands.push({
        id: `ticket:${ref}`,
        group: 'Go to',
        title: ticket.title,
        detail: ref,
        keys: [nn(ticket.num), String(ticket.num), ref, `${ticket.epic}/${ticket.num}`],
        // A Ticket of a collapsed frame, or a done one in the folded stack, is not a Node: its frame is centered instead.
        run: () => goToNode(projectId, { id: ticketNodeId(ticket.epic, ticket.num), hidden: false }, epicNodeId(ticket.epic)),
      })
    }
  }
  for (const node of layoutNodes) {
    if (SKIPPED_KINDS.has(node.kind)) continue
    if (SESSION_KINDS.has(node.kind)) {
      const sessionId = typeof node.data.sessionId === 'string' ? node.data.sessionId : undefined
      commands.push({
        id: `node:${node.id}`,
        group: 'Go to',
        title: sessionTitle(node, history),
        detail: node.kind === 'orchestrator' ? 'Orchestrator' : 'Session',
        keys: sessionId === undefined ? undefined : [sessionId, sessionId.slice(0, 8)],
        run: () => goToNode(projectId, node),
      })
      continue
    }
    const title = nodeTitle(node)
    const label = kindLabel(node.kind)
    commands.push({
      id: `node:${node.id}`,
      group: 'Go to',
      title: title ?? (node.kind === 'card' ? `Card ${typeof node.data.cardId === 'string' ? node.data.cardId : node.id}` : label),
      detail: title === null ? undefined : label,
      keys: node.kind === 'card' ? [typeof node.data.cardId === 'string' ? node.data.cardId : node.id] : undefined,
      run: () => goToNode(projectId, node),
    })
  }
  for (const adr of adrs) {
    commands.push({
      id: `adr:${adr.path}`,
      group: 'Go to',
      title: adr.title,
      detail: `ADR ${adr.number}`,
      keys: [adr.number, String(Number(adr.number)), `adr ${adr.number}`, `adr-${adr.number}`],
      run: () => {
        openAdr(projectId, adr.path)
        return undefined
      },
    })
  }
  return commands
}

/**
 * Every command for the window as it is now. With an empty query the palette shows them in this
 * order: actions, the view, then the things to go to.
 */
export function buildCommands(context: CommandContext): PaletteCommand[] {
  return [...actionCommands(context), ...viewCommands(context), ...workflowActionCommands(context), ...goToCommands(context)]
}
