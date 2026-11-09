// The Mind map MCP server `worfy-mind-map` (Epic worfy-product-session, ticket 04; the spec, «Tools
// `mind_map_*`», the owner's answer Q2): only a Product Session gets it (src/main/vendors/claude/query.ts),
// so a plain Session and the Orchestrator have no tool that changes a Mind map. Built like worfy-canvas:
// zod shapes (src/shared/product/tools.ts), the arguments parsed again here, a refusal is a result with
// `isError`, never an exception, and the server is described in worfy's terms (src/main/vendors/mcp.ts).
//
// main is the only writer of `mind-map.json` (MindMapWriter): the tools write through it, and so does the
// screen when the owner moves a node or folds a branch (ticket 09: `product.layout`, updateMindMap with
// layoutChange). A write
// - goes only to `<Product Session folder>/<topic>/mind-map.json`: the topic is one folder name
//   (isProductTopicName), and the target passes the same check as a Product Session's own Write
//   (productToolDecision: below the folder in its written and its real form, no link leading out);
// - reads the topic (readTopic of ticket 03), applies the change, checks the whole file with checkMindMap
//   and only then writes, atomically (writeJsonFile: a temporary file renamed over the target), retried
//   on Windows while another process holds the file open (retriedOnWindows). Windows never lets a rename
//   replace a file another process keeps open — a reader such as an editor or the docs watcher may keep it
//   open as long as it likes — so once the retries are over the checked text is written into the file in
//   place (writeMindMapInPlace); only when that is refused too does the call fail, naming the reason. A
//   refused change leaves the file as it was, byte for byte. A file that does not pass the check already is never overwritten: its
//   errors are the answer, and the owner or the agent mends it by hand first;
// - waits for the write before it on the same file, so two calls at once never lose one another.
//
// `message` of a node is the uuid of the chat message (the transcript event) the call came in, when the
// Session's messages showed it before the call reached the handler (mindMapForSession); otherwise none.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { checkMindMap, MIND_MAP_PLACED, MIND_MAP_VERSION, mindMapSchema, type MindMap, type MindMapNode } from '../../shared/product/mind-map'
import { CRITIC_DIR, isProductTopicName, MIND_MAP_FILE, productTopicFolder } from '../../shared/product/paths'
import {
  MIND_MAP_SERVER_NAME,
  MIND_MAP_TOOL_NAMES,
  mindMapToolDescriptions,
  mindMapToolShapes,
  mindMapToolUseName,
  parseMindMapToolArgs,
  type MindMapToolArgs,
  type MindMapToolName,
} from '../../shared/product/tools'
import { sdkMessageToEvents } from '../../shared/vendors/claude/events'
import { productToolDecision } from '../agent/product-guard'
import { retriedOnWindows } from '../harness/install'
import { readTopic, type ProductTopic } from '../product/topic'
import { appSaveSignal, saveAnswer } from '../product/save-signal'
import { writeJsonFile } from '../storage/json-file'
import { claudeMcpServer, type ClaudeMcpServer } from '../vendors/claude/mcp'
import type { McpServer, McpToolResult } from '../vendors/mcp'
import { projectStore, type StoredProject } from '../projects/store'
import { observeMessages, projectForCwd, repositoryRoot } from './canvas-server'
import instructions from './agent-instructions-mind-map.md?raw'

/** A refusal the agent reads; anything else thrown is a fault, answered the same way. */
class ToolError extends Error {}

/** How long a write a held-open file refuses on Windows is tried again. */
export const MIND_MAP_WRITE_RETRY_MS = 1_000

/** What Windows answers a rename over a file another process holds open. */
const HELD_OPEN = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** The text of a checked map, as writeJsonFile writes it. */
const mindMapText = (map: MindMap): string => `${JSON.stringify(mindMapSchema.parse(map), null, 2)}\n`

/**
 * Writes the checked map into the file itself, not through a rename: a file another process holds open for
 * reading may be written on Windows when that process shares it for writing, as Node and most readers do.
 * shortcut: not atomic, so a crash in the middle leaves a torn file, which the screen shows with its error
 * and the next write refuses; redo with ReplaceFileW or FILE_RENAME_FLAG_POSIX_SEMANTICS once Node offers either.
 */
export const writeMindMapInPlace = (file: string, map: MindMap): void => writeFileSync(file, mindMapText(map))

export interface MindMapWriterOptions {
  /** Writes the checked map to the file atomically; writeJsonFile by default. A test passes one that fails as Windows does. */
  write?: (file: string, map: MindMap) => void
  /** The write in place after the atomic one kept meeting a held-open file on Windows; writeMindMapInPlace by default. */
  writeInPlace?: (file: string, map: MindMap) => void
  /** The system the retries are judged for (retriedOnWindows); this process's by default. The guard always judges this one. */
  platform?: NodeJS.Platform
  retryMs?: number
}

/** A change of one topic's map: the new map and what to answer. Throws ToolError to refuse. */
export type MindMapChange<T> = (map: MindMap, tickets: readonly number[]) => { map: MindMap; answer: T }

/** The one writer of every `mind-map.json`: one write at a time per file. */
export class MindMapWriter {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly options: MindMapWriterOptions = {}) {}

  /**
   * Applies `change` to the Mind map of `topic` in the Product Session folder `productFolder`, checks and
   * writes it, after every earlier change of the same file. Rejects with the reason, and writes nothing,
   * for a topic name that is not one, a target outside the folder, a file that does not pass the check,
   * a refused change and a changed map that does not pass the check.
   */
  update<T>(productFolder: string, topic: string, change: MindMapChange<T>): Promise<T> {
    const platform = process.platform
    let file: string
    try {
      file = join(productTopicFolder(productFolder, topic), MIND_MAP_FILE)
    } catch (error) {
      return Promise.reject(new ToolError(error instanceof Error ? error.message : String(error)))
    }
    // The disks of macOS and Windows ignore case by default: `Roadmap` and `roadmap` are one file.
    const key = platform === 'linux' ? file : file.toLowerCase()
    const before = this.chains.get(key) ?? Promise.resolve()
    const next = before.then(() => this.apply(productFolder, file, platform, change))
    const settled = next.catch(() => undefined)
    this.chains.set(key, settled)
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key)
    })
    return next
  }

  private async apply<T>(productFolder: string, file: string, platform: NodeJS.Platform, change: MindMapChange<T>): Promise<T> {
    const place = productToolDecision('Write', { file_path: file }, { productDir: productFolder, cwd: null }, platform)
    if (!place.allow) throw new ToolError(`The Mind map is not written: ${place.reason}`)
    const topic = await readTopic(join(file, '..'))
    const broken = topic.errors.filter((error) => error.file === MIND_MAP_FILE)
    if (broken.length > 0) throw new ToolError(`${MIND_MAP_FILE} of topic ${topic.name} has errors; mend them first, nothing was written:\n${broken.map((error) => `- ${error.message}`).join('\n')}`)
    const tickets = topic.tickets.map((ticket) => ticket.number)
    // shortcut: the file is read and written through mindMapSchema, which drops keys it does not declare, so
    // a key a later format adds by hand is lost on the next write; redo with a passthrough node schema when
    // ADR-0101 gets a version 2 or a field the tools do not write.
    const { map, answer } = change({ version: MIND_MAP_VERSION, nodes: topic.nodes }, tickets)
    const checked = checkMindMap(map, tickets)
    if (!checked.ok) throw new ToolError(`The change is refused, nothing was written:\n${checked.errors.map((error) => `- ${error.message}`).join('\n')}`)
    const write = this.options.write ?? ((target: string, value: MindMap) => writeJsonFile(target, mindMapSchema, value))
    const retried = this.options.platform ?? platform
    try {
      await retriedOnWindows(async () => write(file, checked.map), { platform: retried, retryMs: this.options.retryMs ?? MIND_MAP_WRITE_RETRY_MS })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (retried !== 'win32' || code === undefined || !HELD_OPEN.has(code)) throw error
      try {
        ;(this.options.writeInPlace ?? writeMindMapInPlace)(file, checked.map)
      } catch (inPlace) {
        throw new ToolError(
          `${MIND_MAP_FILE} is held open by another program: it could not be replaced (${code}) nor written in place (${inPlace instanceof Error ? inPlace.message : String(inPlace)}). Nothing was written; close the program and call again.`,
          { cause: inPlace },
        )
      }
    }
    return answer
  }
}

let sharedWriter: MindMapWriter | null = null

/** The app's one writer of Mind map files: the tools of every Product Session, and the screen (ticket 09). */
export const mindMapWriter = (): MindMapWriter => (sharedWriter ??= new MindMapWriter())

/** Applies a change to a topic's Mind map through the app's one writer: the tools' writes and the screen's moves (ticket 09). */
export const updateMindMap = <T>(productFolder: string, topic: string, change: MindMapChange<T>): Promise<T> => mindMapWriter().update(productFolder, topic, change)

/** What the owner changes of a node by hand (`product.layout`): its place, and whether its branch is folded. */
export interface MindMapLayout {
  x?: number | undefined
  y?: number | undefined
  collapsed?: boolean | undefined
}

/**
 * The change of node `id` the screen asks for: `x` and `y` set together, with the layout they are for
 * (`placed`, MIND_MAP_PLACED), `collapsed: true` set and
 * `collapsed: false` taken out, so an unfolded node's file reads as before it was folded. Nothing else of
 * the node or the map changes; a node that is not in the file is refused.
 */
export const layoutChange =
  (id: string, layout: MindMapLayout): MindMapChange<null> =>
  (map) => {
    const node: MindMapNode = { ...nodeOf(map, id) }
    if (layout.x !== undefined && layout.y !== undefined) {
      node.x = layout.x
      node.y = layout.y
      node.placed = MIND_MAP_PLACED
    }
    if (layout.collapsed === true) node.collapsed = true
    else if (layout.collapsed === false) delete node.collapsed
    return { map: replaced(map, node), answer: null }
  }

/**
 * «Prettify» (ticket 31): every node's place by hand dropped — `x`, `y` and `placed` — in one write, so the
 * screen lays the map out again. Nothing else of the nodes or the map changes.
 */
export const placesCleared =
  (): MindMapChange<null> =>
  (map) => ({
    map: {
      ...map,
      nodes: map.nodes.map((node) => {
        if (node.x === undefined && node.y === undefined && node.placed === undefined) return node
        const rest: MindMapNode = { ...node }
        delete rest.x
        delete rest.y
        delete rest.placed
        return rest
      }),
    },
    answer: null,
  })

export interface MindMapContext {
  /** The Product Session folder of the Project (productFolder); null when it could not be found, and every tool but product_save refuses. */
  productFolder: string | null
  /** The uuid of the chat message call `name` with `args` came in, when known; taken once. */
  messageOf?: (name: MindMapToolName, args: unknown) => string | null
  /** The save signal (src/main/product/save-signal.ts): what product_save answers. */
  save: () => Promise<string>
  writer?: MindMapWriter
  /** A new node id; a short random one by default. */
  newId?: () => string
}

const NO_FOLDER = 'The Product Session folder of this Project could not be found (its profile did not answer): the Mind map cannot be read or changed now.'

const text = (value: unknown, isError = false): McpToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })

/** The node `id` of `map`, or the refusal. */
function nodeOf(map: MindMap, id: string): MindMapNode {
  const node = map.nodes.find((each) => each.id === id)
  if (node === undefined) throw new ToolError(`The Mind map has no node "${id}".`)
  return node
}

/** `map` with node `id` replaced by `node`. */
const replaced = (map: MindMap, node: MindMapNode): MindMap => ({ ...map, nodes: map.nodes.map((each) => (each.id === node.id ? node : each)) })

/** What one topic is to the agent: no file paths beyond the topic folder's own names. */
function topicAnswer(topic: ProductTopic): unknown {
  return {
    topic: topic.name,
    title: topic.title,
    sections: topic.sections.map((section) => section.heading),
    tickets: topic.tickets.map(({ number, slug, title, status }) => ({ ref: `ticket:${String(number).padStart(2, '0')}`, slug, title, status })),
    nodes: topic.nodes,
    errors: topic.errors,
  }
}

type Handlers = { [Name in MindMapToolName]: (args: MindMapToolArgs[Name], message: string | null) => Promise<unknown> }

function handlers(context: MindMapContext): Handlers {
  const writer = context.writer ?? mindMapWriter()
  const newId = context.newId ?? (() => `n${randomUUID().replaceAll('-', '').slice(0, 8)}`)
  const folder = (): string => {
    if (context.productFolder === null) throw new ToolError(NO_FOLDER)
    return context.productFolder
  }
  const stamp = (message: string | null): { message?: string } => (message === null ? {} : { message })
  /** `node` as changed in chat message `message`: a change whose message is not known leaves none, not the old one. */
  const restamped = (node: MindMapNode, message: string | null): MindMapNode => {
    const next: MindMapNode = { ...node, ...stamp(message) }
    if (message === null) delete next.message
    return next
  }

  return {
    mind_map_read: async ({ topic }) => {
      const root = folder()
      if (topic !== undefined) {
        const names = await topicNames(root)
        if (!names.includes(topic)) throw new ToolError(`There is no topic ${topic} yet. Topics: ${names.length === 0 ? '(none)' : names.join(', ')}.`)
        return topicAnswer(await readTopic(productTopicFolder(root, topic)))
      }
      const topics = []
      for (const name of await topicNames(root)) {
        const read = await readTopic(productTopicFolder(root, name))
        topics.push({ topic: name, title: read.title, tickets: read.tickets.length, nodes: read.nodes.length, errors: read.errors.length })
      }
      return { topics }
    },

    mind_map_add: async (args, message) => {
      // A misspelled topic would make a stray folder: a topic begins with its map, made with Write.
      const names = await topicNames(folder())
      if (!names.includes(args.topic)) throw new ToolError(`There is no topic ${args.topic} yet: write its map.md first. Topics: ${names.length === 0 ? '(none)' : names.join(', ')}.`)
      return writer.update(folder(), args.topic, (map) => {
        if (args.kind !== 'decision' && (args.status !== undefined || args.reason !== undefined || args.replaces !== undefined)) {
          throw new ToolError('status, reason and replaces belong to a decision: add it with kind "decision", or decide the node later with mind_map_decide.')
        }
        if (args.kind !== 'objection' && args.source !== undefined) throw new ToolError('source belongs to an objection: the fact it rests on.')
        let id = newId()
        while (map.nodes.some((each) => each.id === id)) id = newId()
        const fields: Partial<typeof args> = { ...args }
        delete fields.topic
        const node: MindMapNode = { id, kind: args.kind, text: args.text, from: args.from, ...fields, ...stamp(message) }
        return { map: { ...map, nodes: [...map.nodes, node] }, answer: node }
      })
    },

    mind_map_update: (args, message) =>
      writer.update(folder(), args.topic, (map) => {
        const node = nodeOf(map, args.id)
        if (args.text === undefined && args.kind === undefined && args.source === undefined && args.advice === undefined) throw new ToolError('Nothing to change: give text, kind, source or advice.')
        if (node.kind === 'decision' && args.kind !== undefined && args.kind !== 'decision') throw new ToolError('A Decision stays a Decision: change its status and reason with mind_map_decide.')
        if (node.kind !== 'decision' && args.kind === 'decision') throw new ToolError('A node becomes a Decision only with mind_map_decide, which gives it a status and a reason.')
        const kind = args.kind ?? node.kind
        if (kind !== 'objection' && args.source !== undefined) throw new ToolError('source belongs to an objection: the fact it rests on.')
        const changed: MindMapNode = restamped(
          {
            ...node,
            kind,
            ...(args.text === undefined ? {} : { text: args.text }),
            ...(args.advice === undefined ? {} : { advice: args.advice }),
            ...(args.source === undefined ? {} : { source: args.source }),
          },
          message,
        )
        // Only an objection rests on a source: one that turns into an idea or a question drops it.
        if (node.kind === 'objection' && kind !== 'objection') delete changed.source
        return { map: replaced(map, changed), answer: changed }
      }),

    mind_map_decide: (args, message) =>
      writer.update(folder(), args.topic, (map) => {
        const node = nodeOf(map, args.id)
        const history =
          node.kind === 'decision' && node.status !== undefined && node.reason !== undefined
            ? [...(node.history ?? []), { status: node.status, reason: node.reason, ...(node.message === undefined ? {} : { message: node.message }) }]
            : node.history
        const decided: MindMapNode = restamped(
          {
            ...node,
            kind: 'decision',
            status: args.status,
            reason: args.reason,
            ...(args.replaces === undefined ? {} : { replaces: args.replaces }),
            ...(history === undefined ? {} : { history }),
          },
          message,
        )
        return { map: replaced(map, decided), answer: decided }
      }),

    mind_map_remove: (args) =>
      writer.update(folder(), args.topic, (map) => {
        const node = nodeOf(map, args.id)
        if (node.kind === 'decision') throw new ToolError('A Decision is never removed: it stays as the record of what was decided. Reject it with mind_map_decide instead.')
        const children = map.nodes.filter((each) => each.from === node.id || each.replaces === node.id)
        if (children.length > 0) throw new ToolError(`Node "${node.id}" has children (${children.map((each) => each.id).join(', ')}): only a node without children is removed.`)
        return { map: { ...map, nodes: map.nodes.filter((each) => each.id !== node.id) }, answer: { removed: node.id } }
      }),

    product_save: () => context.save(),
  }
}

/** The topic folders of the Product Session folder, by name; none when it does not exist yet. */
async function topicNames(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== CRITIC_DIR && isProductTopicName(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export type MindMapToolCaller = (name: MindMapToolName, args: unknown) => Promise<McpToolResult>

/** The tools of one context as one function: parse the arguments, apply, answer. Never throws. */
export function mindMapToolCaller(context: MindMapContext): MindMapToolCaller {
  const table = handlers(context)
  return async (name, args) => {
    const parsed = parseMindMapToolArgs(name, args)
    if (!parsed.success) return text(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`, true)
    try {
      const handler = table[name] as (input: unknown, message: string | null) => Promise<unknown>
      return text(await handler(parsed.data, context.messageOf?.(name, parsed.data) ?? null))
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true)
    }
  }
}

/** The server of one context in worfy's terms. */
export function mindMapServer(context: MindMapContext): McpServer {
  const call = mindMapToolCaller(context)
  return {
    name: MIND_MAP_SERVER_NAME,
    version: '1.0.0',
    tools: MIND_MAP_TOOL_NAMES.map((name) => ({ name, description: mindMapToolDescriptions[name], shape: mindMapToolShapes[name] as z.ZodRawShape, call: (args: unknown) => call(name, args) })),
  }
}

/** The agent instructions of the Mind map tools, appended to a Product Session's system prompt. */
export const mindMapInstructions = (): string => instructions

/** Keys sorted at every level: two spellings of one value give one text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner,
  )
}

/** How many recent mind_map calls are remembered while their handler has not run yet. */
const REMEMBERED_CALLS = 64

/**
 * The chat messages the Mind map calls came in, as the Session's messages show them: each assistant
 * message's `mind_map_*` tool uses, by tool and arguments. A handler takes the newest one that matches.
 */
export class CallMessages {
  private calls: { name: MindMapToolName; key: string; uuid: string }[] = []

  /** Reads one SDK message of the Session. */
  see(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const { type, uuid, parent_tool_use_id: parent } = message as { type?: unknown; uuid?: unknown; parent_tool_use_id?: unknown }
    if (type !== 'assistant' || typeof uuid !== 'string' || (parent !== null && parent !== undefined)) return
    for (const event of sdkMessageToEvents(message)) {
      if (event.type !== 'tool_use') continue
      const name = MIND_MAP_TOOL_NAMES.find((each) => mindMapToolUseName(each) === event.name)
      if (name === undefined) continue
      const parsed = parseMindMapToolArgs(name, event.input)
      if (parsed.success) this.calls.push({ name, key: canonical(parsed.data), uuid })
    }
    if (this.calls.length > REMEMBERED_CALLS) this.calls = this.calls.slice(-REMEMBERED_CALLS)
  }

  /** The message of call `name` with the parsed `args`, taken out; null when none was seen. */
  take(name: MindMapToolName, args: unknown): string | null {
    const key = canonical(args)
    for (let at = this.calls.length - 1; at >= 0; at--) {
      const call = this.calls[at]!
      if (call.name !== name || call.key !== key) continue
      this.calls.splice(at, 1)
      return call.uuid
    }
    return null
  }
}

/** The Mind map server of one Claude Product Session: what its options get, and the watcher of its messages. */
export interface MindMapSession {
  attachment: { server: ClaudeMcpServer; instructions: string }
  observe<T extends object>(query: T): T
}

export interface MindMapRequest {
  /** Where the Session starts: its Project is found by it, as the canvas finds it. */
  cwd: string
  /** The Project's Product Session folder; null when it could not be found. */
  productFolder: string | null
}

export type MindMapResolver = (request: MindMapRequest) => Promise<MindMapSession | null>

export interface MindMapDeps {
  projects: () => readonly StoredProject[]
  /** The repository root of a folder outside every Project root (a linked worktree elsewhere). */
  repositoryRoot?: (folder: string) => Promise<string | null>
  /** The save signal's answer for Project `projectId`; the app's save signal by default. */
  save?: (projectId: string) => Promise<string>
}

const appMindMapDeps = (): MindMapDeps => ({ projects: () => projectStore().list() })

/** The Mind map server of a Product Session starting in `cwd`; null outside every Project. */
export async function mindMapForSession(request: MindMapRequest, deps: MindMapDeps = appMindMapDeps()): Promise<MindMapSession | null> {
  let project = projectForCwd(deps.projects(), request.cwd)
  if (project === undefined) {
    const root = await (deps.repositoryRoot ?? repositoryRoot)(request.cwd)
    project = root === null ? undefined : projectForCwd(deps.projects(), root)
  }
  if (project === undefined) return null
  const projectId = project.id
  const save = deps.save ?? (async (id: string) => saveAnswer(await appSaveSignal().signal(id)))
  const messages = new CallMessages()
  const server = await claudeMcpServer(
    mindMapServer({
      productFolder: request.productFolder,
      messageOf: (name, args) => messages.take(name, args),
      save: () => save(projectId),
    }),
  )
  return {
    attachment: { server, instructions: mindMapInstructions() },
    observe: (query) => observeMessages(query, (message) => messages.see(message)),
  }
}
