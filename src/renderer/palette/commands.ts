// The commands of the palette (⌘K, ticket 31), built from what the window already knows: the
// workflow model, the Layout, the Sessions, the ADRs, the Projects. Nothing here keeps its own
// list of things: a Node type that exports `createLabel` (ADR-0014) gets a "New …" command the
// same way it gets an item in the Canvas menu, and every Epic, Ticket, Session, Card and ADR is a
// "go to" command because it exists.
//
// A command only asks: moving the Canvas, creating a Node and "Tidy up" go through requests the
// Canvas carries out (find/canvas-requests.ts), the rest through the same IPC calls as the buttons they
// stand for. "Ship ticket" and "Run wave" are the actions of ticket 23 (`actions.shipTicket`,
// `actions.runWave`); when they exist and whether they are active is decided by the same code the
// buttons use (canvas/actions/gates.ts), and main checks again.
// The unchecked manual checks (the profile's manual mark) of every Ticket (shared/workflow/manual-checks.ts) are rows of
// their own group, found by typing only; picking one goes to its Ticket. They are read, never ticked.
// Nothing here writes a Ticket's status or anything in the Project (ADR-0002, ADR-0005).
// "Process gate queue" (worfy-windows ticket 17, `actions.gateQueue`) is there only on the machine
// whose Profile gives it the role `serve` of the cross-machine gate; its detail counts the waiting PRs.
// "Arrange by Epic" (worfy-canvas ticket 12) asks the Canvas to line the Sessions up at their Epic
// frames (canvas/arrange-by-epic.ts), as one step of ⌘Z.
// "Re-pack" (worfy-canvas ticket 01, ADR-0075) asks the Canvas to put the Epic frames in the order
// "active first" and count their columns again.
// "Archive finished sessions now" (worfy-canvas ticket 08, ADR-0076, point 9) takes the finished
// Sessions off the Canvas by the archive's rule at once, as one step of ⌘Z (canvas/archive-now.ts).
// On the read-only screen of a Linked machine (worfy-link ticket 26, ADR-0066) the commands that
// would change the Project — New …, Tidy up, Arrange by Epic, Re-pack, Archive finished sessions now, Run wave, Ship ticket, Process gate queue — carry the read-only hint and
// their rows are inactive with it; moving the Canvas, the views and switching Projects stay active.
// "Reconnect machine…" and "Remove machine…" (worfy-link ticket 37) are a row per Linked machine,
// its name the detail: the row is the choice of the Machine. They do what the buttons of its row in
// the sidebar do — `link.reconnect`, and the confirmation of Remove (machines/MachineDialogs.tsx);
// Reconnect only for a Machine without a connection. They concern this Machine's link, not the Project.
// "Getting started" (worfy-onboarding ticket 07) shows the Getting started section of the sidebar
// again and focuses it (getting-started/store.ts); with or without a Project.
import type { AdrEntry } from '../../shared/ipc/docs'
import type { ProjectView } from '../../shared/ipc/projects'
import type { HistorySession } from '../../shared/ipc/claude-home'
import type { GateQueueView } from '../../shared/ipc/gate-queue'
import type { LinkedMachineView } from '../../shared/ipc/link'
import { failureReason } from '../../shared/ipc/channels'
import { epicNodeId, shownOnCanvas, SOURCE_NODE_KINDS, ticketNodeId } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import { SHORTCUTS } from '../../shared/shortcuts'
import type { Ticket, WorkflowModel } from '../../shared/workflow/types'
import { hasRunWave, hasShipTicket } from '../canvas/actions/gates'
import { archiveFinishedNow } from '../canvas/archive-now'
import { requestRepack } from '../canvas/sources/epics'
import { showNode } from '../canvas/show-node'
import { createCanvasNode, focusCanvasNode, openAdr, requestArrangeByEpic, requestTidyUp, setTagFilter, type TagFilter } from '../find/canvas-requests'
import { kindLabel, nodeTitle, normalizeQuery, type Rankable } from '../find/search-index'
import { openGettingStarted } from '../getting-started/store'
import { invoke, windowMachine } from '../ipc'
import { askRemoveMachine } from '../machines/machine-dialogs'
import { linkStateNow, reconnectMachine } from '../machines/useMachines'
import { openProject } from '../projects/useProjects'
import { openOrchestrator, setView } from '../session/navigation'
import { openSettings } from '../settings/settings-window'
import { openFirstRun } from '../shell/first-run-store'
import type { ShellView } from '../shell/Toolbar'
import { label } from '../shortcuts/match'
import { openShortcuts } from '../shortcuts/shortcuts-window'

export type CommandGroup = 'Action' | 'Go to' | 'View' | 'Project' | 'Manual check'

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
  /** Shown only for a query: the palette opened with an empty field leaves it out (forQuery). */
  queryOnly?: boolean | undefined
  /** Set on a read-only screen for a command that would change the Project: the row is inactive with this hint. */
  readOnly?: string | undefined
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
  /** The read-only hint of the window's screen (useReadOnly); null or absent — the Project can be changed. */
  readOnly?: string | null | undefined
  /** The Project's cross-machine gate queue (useGateQueue); absent — not read (yet), no command. */
  gateQueue?: GateQueueView | undefined
  /** Now, in milliseconds, for the age of the oldest wait; Date.now() when absent. */
  now?: number | undefined
  /** The Linked machines of this Machine; absent — as the renderer has them now (linkStateNow). */
  linked?: readonly LinkedMachineView[] | undefined
}

const nn = (num: number): string => String(num).padStart(2, '0')

/** The kinds whose Nodes the "go to Session" commands cover; the rest are plain Nodes. */
const SESSION_KINDS = new Set(['session', 'orchestrator'])
/** Kinds that are not worth a "go to": drawn by a source, or an anchor without content. */
const SKIPPED_KINDS = new Set([...SOURCE_NODE_KINDS, 'binding-anchor'])

/** Shows the Canvas and centers it on a Node; an archived or hidden Node is brought back first, as the sidebar does. */
function goToNode(projectId: string, node: Pick<LayoutNode, 'id' | 'hidden' | 'archived'>, fallbackId?: string): undefined {
  setView('canvas')
  if (shownOnCanvas(node)) focusCanvasNode(projectId, node.id, fallbackId)
  else void showNode(projectId, node).then(() => focusCanvasNode(projectId, node.id, fallbackId))
  return undefined
}

function sessionTitle(node: LayoutNode, history: readonly HistorySession[]): string {
  const sessionId = typeof node.data.sessionId === 'string' ? node.data.sessionId : undefined
  const recorded = sessionId === undefined ? undefined : history.find((each) => each.sessionId === sessionId)?.title
  if (recorded !== undefined) return recorded
  if (node.kind === 'orchestrator') return 'Orchestrator'
  return sessionId === undefined ? 'New session' : `Session ${sessionId.slice(0, 8)}`
}

/** How long ago `since` was, in whole hours, or minutes under an hour. */
function age(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`
}

/** The detail of "Process gate queue": how many PRs wait and since when, or why the queue is unknown. */
export function gateQueueDetail(queue: GateQueueView, now: number): string {
  if (queue.gh.state === 'failed') return `gh failed: ${queue.gh.reason}`
  const [oldest] = queue.waiting
  if (oldest === undefined) return 'queue empty'
  const count = queue.waiting.length === 1 ? '1 PR waiting' : `${queue.waiting.length} PRs waiting`
  return `${count}, oldest ${age(oldest.since, now)}`
}

function actionCommands({ project, createItems, readOnly, gateQueue, now }: CommandContext): PaletteCommand[] {
  if (!project) return []
  const projectId = project.id
  const hint = readOnly ?? undefined
  const commands: PaletteCommand[] = [
    {
      id: 'new:session',
      group: 'Action',
      title: 'New session',
      detail: "in the Project's root",
      readOnly: hint,
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
      readOnly: hint,
      run: () => {
        setView('canvas')
        createCanvasNode(projectId, item.kind)
        return undefined
      },
    })
  }
  commands.push({
    id: 'tidy-up',
    group: 'Action',
    title: 'Tidy up',
    detail: 'lay out the Nodes without overlaps',
    keys: ['tidy', 'arrange', 'layout'],
    readOnly: hint,
    // The Canvas lays the Nodes out (canvas/tidy.ts) through its LayoutOps: one step of ⌘Z.
    run: () => {
      setView('canvas')
      requestTidyUp(projectId)
      return undefined
    },
  })
  commands.push({
    id: 'arrange-by-epic',
    group: 'Action',
    title: 'Arrange by Epic',
    detail: 'Sessions next to their Epic frames',
    keys: ['arrange by epic', 'group sessions', 'sessions by epic'],
    readOnly: hint,
    // The Canvas menu carries the request out (canvas/arrange-by-epic-command.ts) through the Canvas's LayoutOps: one step of ⌘Z.
    run: () => {
      setView('canvas')
      requestArrangeByEpic(projectId)
      return undefined
    },
  })
  commands.push({
    id: 'repack',
    group: 'Action',
    title: 'Re-pack',
    detail: 'Epic frames: active first, columns counted again',
    keys: ['repack', 'epic frames', 'columns'],
    readOnly: hint,
    // The Canvas writes the frames' order and columns (sources/epics.ts) through its LayoutOps: one step of ⌘Z.
    run: () => {
      setView('canvas')
      requestRepack(projectId)
      return undefined
    },
  })
  commands.push({
    id: 'archive-finished',
    group: 'Action',
    title: 'Archive finished sessions now',
    detail: 'by the archive rule; 24 h while Settings → Canvas says Never',
    keys: ['archive', 'finished sessions', 'clean up'],
    readOnly: hint,
    run: () => archiveFinishedNow(projectId),
  })
  if (gateQueue?.role === 'serve') {
    commands.push({
      id: 'gate-queue',
      group: 'Action',
      title: 'Process gate queue',
      detail: gateQueueDetail(gateQueue, now ?? Date.now()),
      keys: ['gate queue', ...(gateQueue.label === null ? [] : [gateQueue.label])],
      readOnly: hint,
      // The same call as "Process gate queue" in the Project menu (shell/sidebar/ProjectsSection.tsx).
      run: async () => {
        const result = await invoke('actions.gateQueue', { projectId })
        return result.ok ? undefined : failureReason('actions.gateQueue', result.error)
      },
    })
  }
  return commands
}

function workflowActionCommands({ project, model, readOnly }: CommandContext): PaletteCommand[] {
  if (!project || !model || model.error !== null) return []
  const projectId = project.id
  const hint = readOnly ?? undefined
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
      readOnly: hint,
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
      readOnly: hint,
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
  // The first-run screen (worfy-harness ticket 19): always here, with or without a Project.
  commands.push({
    id: 'first-run',
    group: 'View',
    title: 'First-run checks',
    detail: 'Claude Code, tools, Harness, qmd',
    keys: ['first run', 'setup', 'checks'],
    run: () => {
      openFirstRun()
      return undefined
    },
  })
  // Getting started (worfy-onboarding ticket 07): shows the section again after Skip, and focuses it.
  // Always here, with or without a Project.
  commands.push({
    id: 'getting-started',
    group: 'View',
    title: 'Getting started',
    detail: 'A guided demo of worfy',
    keys: ['getting started', 'demo', 'tour'],
    run: () => openGettingStarted(),
  })
  // The Settings window (worfy-ui ticket 2): always here, with or without a Project.
  commands.push({
    id: 'settings',
    group: 'View',
    title: 'Settings…',
    detail: 'General and the other sections',
    keys: ['settings', 'preferences', 'options'],
    run: () => {
      openSettings()
      return undefined
    },
  })
  // The Keyboard shortcuts window (worfy-ui ticket 11): always here, with or without a Project.
  commands.push({
    id: 'shortcuts',
    group: 'View',
    title: 'Keyboard shortcuts',
    detail: label(SHORTCUTS.shortcuts),
    keys: ['shortcuts', 'keys', 'hotkeys', 'keyboard'],
    run: () => {
      openShortcuts()
      return undefined
    },
  })
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
      // The same as a click on the Project in the sidebar (shell/sidebar/ProjectsSection.tsx): a
      // Project of the window's Machine, which in a window on a Linked machine is that Machine's
      // (worfy-link ticket 09), not this one's active Project.
      run: async () => {
        const failure = await openProject(windowMachine(), other.id)
        return failure === undefined ? undefined : failureReason('projects.select', failure)
      },
    })
  }
  return commands
}

function goToCommands({ project, model, layoutNodes, history, adrs, readOnly }: CommandContext): PaletteCommand[] {
  if (!project) return []
  const projectId = project.id
  // The Orchestrator's Session view (worfy-polish ticket 25), whether it runs or not: picking the row
  // starts an Orchestrator that does not run. Its Node's own row below centers the Canvas on it.
  const commands: PaletteCommand[] = [
    {
      id: 'go-to:orchestrator',
      group: 'Go to',
      title: 'Orchestrator',
      detail: 'Session view',
      keys: ['orchestrator', 'go to orchestrator'],
      run: () => openOrchestrator(projectId),
    },
  ]
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
    // An archived or hidden Node comes back before the Canvas goes to it: a change of the Project.
    const showHint = shownOnCanvas(node) ? undefined : (readOnly ?? undefined)
    if (SESSION_KINDS.has(node.kind)) {
      const sessionId = typeof node.data.sessionId === 'string' ? node.data.sessionId : undefined
      commands.push({
        id: `node:${node.id}`,
        group: 'Go to',
        title: sessionTitle(node, history),
        detail: node.kind === 'orchestrator' ? 'Orchestrator' : 'Session',
        keys: sessionId === undefined ? undefined : [sessionId, sessionId.slice(0, 8)],
        run: () => goToNode(projectId, node),
        readOnly: showHint,
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
      readOnly: showHint,
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
 * A row per unchecked manual check of every Ticket of the Project: "<epic> NN · <text>".
 * Picking it goes to the Ticket's Node, as the Ticket's own "Go to" row does. Rows only for a query:
 * dozens of open checks would bury the other commands of the empty palette.
 */
function manualCheckCommands({ project, model }: CommandContext): PaletteCommand[] {
  if (!project || !model || model.error !== null) return []
  const projectId = project.id
  const commands: PaletteCommand[] = []
  for (const ticket of model.tickets) {
    const ref = `${ticket.epic}/${nn(ticket.num)}`
    ;(ticket.manualChecks ?? []).forEach((check, index) => {
      if (check.checked) return
      commands.push({
        id: `manual-check:${ref}:${index}`,
        group: 'Manual check',
        title: `${ticket.epic} ${nn(ticket.num)} · ${check.text}`,
        queryOnly: true,
        run: () => goToNode(projectId, { id: ticketNodeId(ticket.epic, ticket.num), hidden: false }, epicNodeId(ticket.epic)),
      })
    })
  }
  return commands
}

/** "Reconnect machine…" for each Linked machine without a connection, "Remove machine…" for each one. */
function machineCommands({ linked }: CommandContext): PaletteCommand[] {
  const machines = linked ?? linkStateNow()?.linked ?? []
  const commands: PaletteCommand[] = []
  for (const machine of machines) {
    if (machine.certificateChanged || machine.state !== 'online') {
      commands.push({
        id: `machine-reconnect:${machine.id}`,
        group: 'Action',
        title: 'Reconnect machine…',
        detail: machine.name,
        run: () => reconnectMachine(machine.id),
      })
    }
  }
  for (const machine of machines) {
    commands.push({
      id: `machine-remove:${machine.id}`,
      group: 'Action',
      title: 'Remove machine…',
      detail: machine.name,
      run: () => {
        askRemoveMachine(machine.id)
        return undefined
      },
    })
  }
  return commands
}

/** The commands the palette ranks for `query`: with an empty field, those without `queryOnly`. */
export function forQuery(commands: readonly PaletteCommand[], query: string): readonly PaletteCommand[] {
  return normalizeQuery(query) === '' ? commands.filter((command) => command.queryOnly !== true) : commands
}

/**
 * Every command for the window as it is now. With an empty query the palette shows them in this
 * order: actions, the view, then the things to go to.
 */
export function buildCommands(context: CommandContext): PaletteCommand[] {
  return [
    ...actionCommands(context),
    ...viewCommands(context),
    ...workflowActionCommands(context),
    ...machineCommands(context),
    ...goToCommands(context),
    ...manualCheckCommands(context),
  ]
}
