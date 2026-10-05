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
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { sdkMessageToEvents } from '../../shared/agent/events'
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
import type { LayoutNode, LayoutOpInput, LayoutState } from '../../shared/layout/types'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { CanvasAttachment } from '../agent/options'
import { layoutStore } from '../layout/store'
import { projectStore, type StoredProject } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { epicStatusRunner, readCheckout } from '../workflow/reader'
import instructionsTemplate from './agent-instructions.md?raw'

/** The part of the LayoutStore the tools use. */
export interface CanvasLayout {
  get(projectId: string): LayoutState
  apply(projectId: string, op: LayoutOpInput): LayoutState
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
  const nodes = (): LayoutNode[] => layout.get(projectId).layout.nodes
  const nodeOf = (id: string): LayoutNode => {
    const node = nodes().find((each) => each.id === id)
    if (!node) throw new ToolError(`This Project's canvas has no Node with id ${id}. Call list_nodes for the ids.`)
    return node
  }
  const apply = (op: LayoutOpInput, id: string): ListedNode => {
    layout.apply(projectId, op)
    return listed(nodeOf(id))
  }
  const freshId = (prefix: string): string => {
    for (;;) {
      const id = `${prefix}-${randomUUID().slice(0, 8)}`
      if (!nodes().some((node) => node.id === id) && !existsSync(join(context.cardsDir, id))) return id
    }
  }
  /** x/y as given, or a free place next to the calling Session's Node. */
  const place = (args: { x?: number | undefined; y?: number | undefined }, w: number, h: number): { x: number; y: number } => {
    if (args.x !== undefined && args.y !== undefined) return { x: args.x, y: args.y }
    const visible = nodes().filter((node) => !node.hidden)
    const sessionId = context.sessionId()
    const anchor = sessionId === null ? undefined : visible.find((node) => node.data.sessionId === sessionId)
    const spot = placeNear(visible, anchor ?? null, w, h)
    return { x: args.x ?? spot.x, y: args.y ?? spot.y }
  }

  return {
    list_nodes: () => nodes().map(listed),

    create_card: (args) => {
      const id = freshId(CARD_KIND)
      const w = args.w ?? CARD_SIZE.w
      const h = args.h ?? CARD_SIZE.h
      const folder = join(context.cardsDir, id)
      mkdirSync(folder, { recursive: true })
      try {
        const node = apply({ op: 'create', node: { id, kind: CARD_KIND, ...place(args, w, h), w, h, data: { title: args.title } } }, id)
        return { ...node, folder, index: join(folder, 'index.html') }
      } catch (error) {
        rmSync(folder, { recursive: true, force: true })
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

    hide_node: (args) => {
      const node = nodeOf(args.id)
      if (args.hidden && node.locked) throw new ToolError(`Node ${node.id} (${node.kind}) is locked: it can be moved and resized, not hidden.`)
      return apply({ op: 'hide', id: node.id, hidden: args.hidden }, node.id)
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

/**
 * Records the Session that wrote into a Card's folder in the Card Node's data. Called with every
 * SDK message of the Session; the Session's id is read from the messages themselves.
 */
export function cardEditRecorder(options: { projectId: string; cardsDir: string; cwd: string; layout: CanvasLayout; sessionId: () => string | null }): (message: unknown) => void {
  return (message) => {
    const sessionId = options.sessionId()
    if (sessionId === null) return
    for (const event of sdkMessageToEvents(message)) {
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

const realpathOrSelf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The Project whose repository holds `cwd` (its root, or a worktree inside it). */
export function projectForCwd(projects: readonly StoredProject[], cwd: string): StoredProject | undefined {
  const folder = realpathOrSelf(cwd)
  return projects.find((project) => {
    const root = realpathOrSelf(project.path)
    return folder === root || folder.startsWith(root + sep)
  })
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
}

const appDeps = (): CanvasDeps => ({
  projects: () => projectStore().list(),
  dataDir: (projectId) => projectStore().dataDir(projectId),
  layout: layoutStore(),
  workflow: (root) => readCheckout(root, epicStatusRunner(claudeHome())),
})

export type CanvasResolver = (request: { cwd: string; resume: string | undefined }) => Promise<CanvasSession | null>

/**
 * The canvas for a Session starting in `cwd`; null when `cwd` is in no Project, and the Session
 * then runs without canvas tools. Makes the Project's Cards folder, which the Session may write.
 */
export const canvasForSession = async (request: { cwd: string; resume: string | undefined }, deps: CanvasDeps = appDeps()): Promise<CanvasSession | null> => {
  const project = projectForCwd(deps.projects(), request.cwd)
  if (!project) return null
  const cardsDir = join(deps.dataDir(project.id), 'cards')
  mkdirSync(cardsDir, { recursive: true })
  let sessionId: string | null = request.resume ?? null
  const server = await createCanvasServer({
    projectId: project.id,
    cardsDir,
    layout: deps.layout,
    workflow: () => deps.workflow(project.path),
    sessionId: () => sessionId,
  })
  const record = cardEditRecorder({ projectId: project.id, cardsDir, cwd: request.cwd, layout: deps.layout, sessionId: () => sessionId })
  return {
    attachment: { server, cardsDir, instructions: agentInstructions(cardsDir) },
    observe: (query) =>
      observeMessages(query, (message) => {
        // Every SDK message carries the session id; a resumed Session may get a new one.
        if (typeof message === 'object' && message !== null && typeof (message as { session_id?: unknown }).session_id === 'string') {
          sessionId = (message as { session_id: string }).session_id
        }
        record(message)
      }),
  }
}
