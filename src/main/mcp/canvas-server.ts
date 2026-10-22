// The canvas MCP server `worfy-canvas` (ADR-0003): every Session of worfy gets one, in process
// (the SDK's createSdkMcpServer). The agent writes a Card's files itself; everything that changes
// the Layout goes through these tools, which call the same LayoutStore.apply() the renderer's
// IPC calls, so the agent's and the user's changes take one path and are checked the same way.
//
// A refused call (unknown Node, a Node of another Project, a size out of bounds, a locked Node to
// hide, a Ticket that does not exist) is a tool error with a message, never an exception. There
// is no tool that removes a Node.
//
// canvasForSession() binds a server to the Project a Session works in and watches the Session's
// messages for file writes into a Card's folder: the last Session that wrote there is kept in the
// Card Node's data (`lastEditor`), so it survives a restart (ticket 26 reads it).
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync } from 'node:fs'
import * as nativePath from 'node:path'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { sdkMessageToEvents, type AgentEvent } from '../../shared/agent/events'
import {
  CANVAS_SERVER_NAME,
  CANVAS_TOOL_NAMES,
  CARD_KIND,
  CARD_SIZE,
  NOTE_KIND,
  NOTE_SIZE,
  canvasToolDescriptions,
  canvasToolShapes,
  linkTargetSchema,
  parseLinkTarget,
  parseToolArgs,
  placeNear,
  type CanvasToolArgs,
  type CanvasToolName,
  type LinkTarget,
  type ListedNode,
} from '../../shared/canvas/tools'
import { cardEditedBy } from '../../shared/cards/last-editor'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, SOURCE_NODE_KINDS, SUBAGENT_KIND, SUBAGENT_TREE_KIND, isSourceNodeId, isSubagentNodeId, shownOnCanvas } from '../../shared/layout/derived'
import { isArchived, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { CanvasAttachment } from '../agent/options'
import { harnessScriptEnv } from '../harness/script-env'
import { layoutStore } from '../layout/store'
import { realpathOrSelf } from '../projects/real-path'
import { projectStore, runGit, type StoredProject } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { epicStatusRunner, readCheckout } from '../workflow/reader'
import instructionsTemplate from './agent-instructions.md?raw'
import { leadsToRemoteSync, type LinkFsSync, type PathRules } from '../remote-links'
import { removeTree } from '../storage/remove'

export interface CardsFolderOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  links?: LinkFsSync
  /** Whether something is at a path, by lstat; replaced in tests. */
  there?: (path: string) => boolean
}

const lstatThere = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * True when the Cards folder must not be asked about: a link on the way to it leads off the
 * machine, or cannot be checked (remote-links.ts; worfy-windows ticket 20). The folder is the
 * only place the walk may end in: also when it lies on a share itself.
 */
export function cardsFolderAway(cardsDir: string, options: CardsFolderOptions = {}): boolean {
  return leadsToRemoteSync(cardsDir, [cardsDir], { paths: options.paths ?? nativePath, links: options.links })
}

/**
 * Whether a new Card may not have this id because of what is on the disk: something lies at
 * `<Cards folder>/<id>`. The look is lstat — a link there is something, wherever it leads, and is
 * not followed. With a Cards folder that must not be asked about, the disk is not looked at.
 */
export function cardIdTaken(cardsDir: string, id: string, options: CardsFolderOptions = {}): boolean {
  if (cardsFolderAway(cardsDir, options)) return false
  return (options.there ?? lstatThere)((options.paths ?? nativePath).join(cardsDir, id))
}

/** The part of the LayoutStore the tools use. */
export interface CanvasLayout {
  get(projectId: string): LayoutState
  apply(projectId: string, op: LayoutOpInput): LayoutState
  /** Asks the pages of a leaving Session's Browsers for unsaved changes first (LayoutStore.askBrowsersFirst). */
  askBrowsersFirst?(projectId: string, op: LayoutOpInput): Promise<void>
}

export type CanvasWorkflow = Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>

/** What one server works on: one Project, seen from one Session. */
export interface CanvasContext {
  projectId: string
  /** `<Project data folder>/cards`; Card `<id>` is the folder `<cardsDir>/<id>/`. */
  cardsDir: string
  layout: CanvasLayout
  /** Reads the Project's Epics and Tickets, to check link_card targets. */
  workflow: () => Promise<CanvasWorkflow>
  /** The calling Session's SDK id once known: its Node is where new Nodes go. */
  sessionId: () => string | null
}

export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/** A refusal the agent should read; anything else thrown is reported the same way. */
class ToolError extends Error {}

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
})

const titleOf = (node: LayoutNode): string | null => {
  if (typeof node.data.title === 'string') return node.data.title
  if (typeof node.data.text === 'string') return node.data.text.split('\n', 1)[0]?.slice(0, 80) ?? null
  return null
}

const listed = (node: LayoutNode): ListedNode => ({
  id: node.id,
  kind: node.kind,
  title: titleOf(node),
  x: node.x,
  y: node.y,
  w: node.w,
  h: node.h,
  hidden: node.hidden,
  locked: node.locked,
})

const linksOf = (node: LayoutNode): LinkTarget[] => z.array(linkTargetSchema).catch([]).parse(node.data.links)
const formatLink = (link: LinkTarget): string => (link.num === null ? link.epic : `${link.epic}/${String(link.num).padStart(2, '0')}`)

type Handlers = { [Name in CanvasToolName]: (args: CanvasToolArgs[Name]) => unknown }

function handlers(context: CanvasContext): Handlers {
  const { projectId, layout } = context
  // Epic frames and Tickets are laid out from the workflow, Subagents from their Session's
  // transcript (shared/layout/derived.ts): the Layout Node of an Epic frame or of a Session's
  // Subagent tree is the renderer's saved offsets, not a Node on the canvas, so the tools neither
  // list nor change it. An archived Node (ADR-0076) is off the Canvas until the user brings it
  // back: the tools neither list nor change it either, so an agent never works on a Node the user
  // does not see.
  const nodes = (): LayoutNode[] => layout.get(projectId).layout.nodes.filter((node) => !SOURCE_NODE_KINDS.includes(node.kind) && !isArchived(node))
  const nodeOf = (id: string): LayoutNode => {
    const node = nodes().find((each) => each.id === id)
    if (node) return node
    const stored = layout.get(projectId).layout.nodes.find((each) => each.id === id)
    if (stored !== undefined && isArchived(stored) && !SOURCE_NODE_KINDS.includes(stored.kind)) {
      throw new ToolError(`Node ${id} is archived: it is off the canvas until the user brings it back from the archive, and it cannot be changed until then.`)
    }
    if (isSubagentNodeId(id) || stored?.kind === SUBAGENT_KIND || stored?.kind === SUBAGENT_TREE_KIND) {
      throw new ToolError(`${id} is a Subagent of a Session: it is laid out from the Session's transcript and only the user moves it. A Card cannot be linked to it.`)
    }
    if (id === EPIC_ARRANGEMENT_ID || stored?.kind === EPIC_ARRANGEMENT_KIND) {
      throw new ToolError(`${id} is not a Node: it is the Canvas's internal record of how the Epic frames are arranged (their order and number of columns). It is not drawn, and neither it nor a Card can be linked to it or changed through these tools.`)
    }
    if (isSourceNodeId(id) || stored) {
      throw new ToolError(`${id} is an Epic frame or a Ticket: they are laid out from the workflow and only the user moves them. Link a Card to them with link_card.`)
    }
    throw new ToolError(`This Project's canvas has no Node with id ${id}. Call list_nodes for the ids.`)
  }
  const apply = (op: LayoutOpInput, id: string): ListedNode => {
    layout.apply(projectId, op)
    return listed(nodeOf(id))
  }
  const freshId = (prefix: string): string => {
    for (;;) {
      const id = `${prefix}-${randomUUID().slice(0, 8)}`
      // Every Node of the Layout counts, an archived one too: its id is still taken.
      if (!layout.get(projectId).layout.nodes.some((node) => node.id === id) && !cardIdTaken(context.cardsDir, id)) return id
    }
  }
  /** x/y as given, or a free place next to the calling Session's Node. */
  const place = (args: { x?: number | undefined; y?: number | undefined }, w: number, h: number): { x: number; y: number } => {
    if (args.x !== undefined && args.y !== undefined) return { x: args.x, y: args.y }
    const visible = nodes().filter(shownOnCanvas)
    const sessionId = context.sessionId()
    const anchor = sessionId === null ? undefined : visible.find((node) => node.data.sessionId === sessionId)
    const spot = placeNear(visible, anchor ?? null, w, h)
    return { x: args.x ?? spot.x, y: args.y ?? spot.y }
  }

  return {
    list_nodes: () => nodes().map(listed),

    create_card: (args) => {
      if (cardsFolderAway(context.cardsDir)) throw new ToolError("The folder of this Project's Cards leads off this machine, or cannot be checked: a Card cannot be made there.")
      const id = freshId(CARD_KIND)
      const w = args.w ?? CARD_SIZE.w
      const h = args.h ?? CARD_SIZE.h
      const folder = join(context.cardsDir, id)
      mkdirSync(folder, { recursive: true })
      try {
        const node = apply({ op: 'create', node: { id, kind: CARD_KIND, ...place(args, w, h), w, h, data: { title: args.title } } }, id)
        return { ...node, folder, index: join(folder, 'index.html') }
      } catch (error) {
        removeTree(folder)
        throw error
      }
    },

    create_note: (args) => {
      const id = freshId(NOTE_KIND)
      const w = args.w ?? NOTE_SIZE.w
      const h = args.h ?? NOTE_SIZE.h
      return apply({ op: 'create', node: { id, kind: NOTE_KIND, ...place(args, w, h), w, h, data: { text: args.text } } }, id)
    },

    update_node: (args) => {
      const node = nodeOf(args.id)
      if (node.kind === CARD_KIND) {
        if (args.text !== undefined) throw new ToolError(`${node.id} is a Card: it has a title, not text. Its content is the files in its folder.`)
        if (args.title === undefined) throw new ToolError('Nothing to update: give title.')
        return apply({ op: 'patchData', id: node.id, data: { title: args.title } }, node.id)
      }
      if (node.kind === NOTE_KIND) {
        if (args.title !== undefined) throw new ToolError(`${node.id} is a note: it has text, not a title.`)
        if (args.text === undefined) throw new ToolError('Nothing to update: give text.')
        return apply({ op: 'patchData', id: node.id, data: { text: args.text } }, node.id)
      }
      throw new ToolError(`Only Cards and notes can be updated; ${node.id} is a ${node.kind}.`)
    },

    move_node: (args) => apply({ op: 'move', id: nodeOf(args.id).id, x: args.x, y: args.y }, args.id),

    resize_node: (args) => apply({ op: 'resize', id: nodeOf(args.id).id, w: args.w, h: args.h }, args.id),

    hide_node: async (args) => {
      const checked = (): LayoutNode => {
        const node = nodeOf(args.id)
        if (args.hidden && node.locked) throw new ToolError(`Node ${node.id} (${node.kind}) is locked: it can be moved and resized, not hidden.`)
        return node
      }
      const op: LayoutOpInput = { op: 'hide', id: checked().id, hidden: args.hidden }
      // Hiding a Session Node may take its Browsers with it: their pages are asked for unsaved
      // changes first (src/main/layout/store.ts); the Node is read again after the wait.
      await layout.askBrowsersFirst?.(projectId, op)
      return apply({ ...op, id: checked().id }, args.id)
    },

    link_card: async (args) => {
      if (nodeOf(args.id).kind !== CARD_KIND) throw new ToolError(`${args.id} is not a Card; only Cards can be linked.`)
      const target = parseLinkTarget(args.target)
      if (target === null) throw new ToolError('target must be <epic> or <epic>/<NN>.')
      if (!args.remove) {
        const model = await context.workflow()
        if (model.error) throw new ToolError(`Could not read the workflow to check ${args.target}: ${model.error.message}`)
        const epicKnown = model.epics.some((epic) => epic.epic === target.epic) || model.tickets.some((ticket) => ticket.epic === target.epic)
        if (!epicKnown) throw new ToolError(`This Project has no Epic ${target.epic}.`)
        if (target.num !== null && !model.tickets.some((ticket) => ticket.epic === target.epic && ticket.num === target.num)) {
          throw new ToolError(`Epic ${target.epic} has no Ticket ${String(target.num).padStart(2, '0')}.`)
        }
      }
      // Read again after the await: the Node may have changed or gone meanwhile.
      const node = nodeOf(args.id)
      const same = (link: LinkTarget) => link.epic === target.epic && link.num === target.num
      const current = linksOf(node)
      const links = args.remove ? current.filter((link) => !same(link)) : current.some(same) ? current : [...current, target]
      layout.apply(projectId, { op: 'patchData', id: node.id, data: { links } })
      return { id: node.id, links: links.map(formatLink) }
    },
  }
}

export type CanvasToolCaller = (name: CanvasToolName, args: unknown) => Promise<ToolResult>

/**
 * The tools of one context as one function: parse the arguments, apply, answer. Never throws.
 * The MCP server checks the arguments against the same shapes first; parsing here again keeps
 * undeclared keys and wrong types out for any other caller.
 */
export function canvasToolCaller(context: CanvasContext): CanvasToolCaller {
  const table = handlers(context)
  return async (name, args) => {
    const parsed = parseToolArgs(name, args)
    if (!parsed.success) return text(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`, true)
    try {
      const handler = table[name] as (input: unknown) => unknown
      return text(await handler(parsed.data))
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true)
    }
  }
}

/** The server for one Session. The SDK is loaded on first use, as the Session itself does. */
export async function createCanvasServer(context: CanvasContext): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const call = canvasToolCaller(context)
  return createSdkMcpServer({
    name: CANVAS_SERVER_NAME,
    version: '1.0.0',
    tools: CANVAS_TOOL_NAMES.map((name) => tool(name, canvasToolDescriptions[name], canvasToolShapes[name] as z.ZodRawShape, (args) => call(name, args))),
  })
}

/** The agent instructions appended to the system prompt, for a Project's Cards folder. */
export function agentInstructions(cardsDir: string): string {
  return instructionsTemplate.replaceAll('{{cardsDir}}', cardsDir)
}

interface RecorderOptions {
  projectId: string
  cardsDir: string
  cwd: string
  layout: CanvasLayout
  sessionId: () => string | null
}

/** Records, from a Session's events, the Session that wrote into a Card's folder. */
function editRecorder(options: RecorderOptions): (events: readonly AgentEvent[]) => void {
  return (events) => {
    const sessionId = options.sessionId()
    if (sessionId === null) return
    for (const event of events) {
      if (event.type !== 'tool_use') continue
      const cardId = cardEditedBy({ cwd: options.cwd, name: event.name, input: event.input }, options.cardsDir)
      if (cardId === null) continue
      try {
        const node = options.layout.get(options.projectId).layout.nodes.find((each) => each.id === cardId && each.kind === CARD_KIND)
        if (node && node.data.lastEditor !== sessionId) options.layout.apply(options.projectId, { op: 'patchData', id: cardId, data: { lastEditor: sessionId } })
      } catch (error) {
        console.warn(`[canvas] could not record the last editor of Card ${cardId}`, error)
      }
    }
  }
}

/**
 * Records the Session that wrote into a Card's folder in the Card Node's data. Called with every
 * SDK message of the Session.
 */
export function cardEditRecorder(options: RecorderOptions): (message: unknown) => void {
  const record = editRecorder(options)
  return (message) => record(sdkMessageToEvents(message))
}

/** `query` with `onMessage` called for every message it yields; everything else is untouched. */
export function observeMessages<T extends object>(query: T, onMessage: (message: unknown) => void): T {
  return new Proxy(query, {
    get(target, property) {
      if (property === Symbol.asyncIterator) {
        return () => {
          const inner = (target as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]()
          const iterator: AsyncIterator<unknown> = {
            next: async () => {
              const result = await inner.next()
              if (!result.done) {
                try {
                  onMessage(result.value)
                } catch (error) {
                  console.warn('[canvas] a message observer threw', error)
                }
              }
              return result
            },
          }
          if (inner.return) iterator.return = (value?: unknown) => inner.return!(value)
          if (inner.throw) iterator.throw = (error?: unknown) => inner.throw!(error)
          return iterator
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

/**
 * A path in the spelling on disk (the native realpath, as git prints a Project root): a `cwd` in an
 * 8.3 short name, through a `subst` drive or in another letter case finds the Project it is in.
 * A path no realpath can read stays as resolved.
 */
const onDisk = (path: string): string => realpathOrSelf(resolve(path))

/**
 * The Project whose root is `cwd` or holds it (a worktree inside the repository); of nested
 * Projects, the deepest one.
 */
export function projectForCwd(projects: readonly StoredProject[], cwd: string): StoredProject | undefined {
  const folder = onDisk(cwd)
  let best: { project: StoredProject; depth: number } | undefined
  for (const project of projects) {
    const root = onDisk(project.path)
    if (folder !== root && !folder.startsWith(root.endsWith(sep) ? root : root + sep)) continue
    if (best === undefined || root.length > best.depth) best = { project, depth: root.length }
  }
  return best?.project
}

/**
 * The main repository root of the git working tree holding `folder`, the way the Project list
 * resolves a folder the user adds (src/main/projects/store.ts): a linked worktree's common git
 * folder is `<root>/.git`. null when `folder` is not in a git working tree.
 */
export async function repositoryRoot(folder: string): Promise<string | null> {
  try {
    const commonDir = await runGit(['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (basename(commonDir) === '.git') return dirname(commonDir)
    const toplevel = await runGit(['-C', folder, 'rev-parse', '--show-toplevel'])
    return toplevel || null
  } catch {
    return null
  }
}

/** The canvas of one Session: what its options get, and the watcher of its messages. */
export interface CanvasSession {
  attachment: CanvasAttachment
  /** Wraps the Session's query so file writes into Cards are recorded. */
  observe<T extends object>(query: T): T
}

export interface CanvasDeps {
  projects: () => readonly StoredProject[]
  dataDir: (projectId: string) => string
  layout: CanvasLayout
  workflow: (root: string) => Promise<CanvasWorkflow>
  /** The repository root of a folder outside every Project root (a linked worktree elsewhere). */
  repositoryRoot?: (folder: string) => Promise<string | null>
}

/** The app's dependencies; exported for the wiring test (test/contract/harness-script-wiring.test.ts). */
export const appDeps = (): CanvasDeps => ({
  projects: () => projectStore().list(),
  dataDir: (projectId) => projectStore().dataDir(projectId),
  layout: layoutStore(),
  workflow: (root) => readCheckout(root, epicStatusRunner(claudeHome(), harnessScriptEnv)),
})

export type CanvasResolver = (request: { cwd: string; resume: string | undefined }) => Promise<CanvasSession | null>

/** The Project of a Session's cwd: by path, else through git for a linked worktree outside the root. */
async function projectOfSession(deps: CanvasDeps, cwd: string): Promise<StoredProject | undefined> {
  const byPath = projectForCwd(deps.projects(), cwd)
  if (byPath) return byPath
  const root = await (deps.repositoryRoot ?? repositoryRoot)(cwd)
  // Read the list again after the await: a Project removed meanwhile is not attached.
  return root === null ? undefined : projectForCwd(deps.projects(), root)
}

/**
 * The canvas for a Session starting in `cwd`; null when `cwd` is in no Project, and the Session
 * then runs without canvas tools. Makes the Project's Cards folder, which the Session may write.
 */
export const canvasForSession = async (request: { cwd: string; resume: string | undefined }, deps: CanvasDeps = appDeps()): Promise<CanvasSession | null> => {
  const project = await projectOfSession(deps, request.cwd)
  if (!project) return null
  const cardsDir = join(deps.dataDir(project.id), 'cards')
  // Not through a link that leads off the machine: create_card then says why no Card is made.
  if (!cardsFolderAway(cardsDir)) mkdirSync(cardsDir, { recursive: true })
  let sessionId: string | null = request.resume ?? null
  const server = await createCanvasServer({
    projectId: project.id,
    cardsDir,
    layout: deps.layout,
    workflow: () => deps.workflow(project.path),
    sessionId: () => sessionId,
  })
  const record = editRecorder({ projectId: project.id, cardsDir, cwd: request.cwd, layout: deps.layout, sessionId: () => sessionId })
  return {
    attachment: { server, cardsDir, instructions: agentInstructions(cardsDir) },
    observe: (query) =>
      observeMessages(query, (message) => {
        const events = sdkMessageToEvents(message)
        // The same rule as the Session's own id (src/main/agent/session.ts): each turn's init
        // carries it, and a resumed Session may get a new one there.
        for (const event of events) if (event.type === 'init') sessionId = event.sdkSessionId
        record(events)
      }),
  }
}
