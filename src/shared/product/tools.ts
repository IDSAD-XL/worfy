// The tools of the Mind map MCP server `worfy-mind-map` (Epic worfy-product-session, ticket 04; the
// spec, «Tools `mind_map_*`»): the only way a Product Session's agent changes a topic's Mind map
// (`docs/product/<topic>/mind-map.json`, ADR-0101), and its signal «save» (`product_save`). Only a
// Product Session gets the server, so a plain Session has no way to change a Mind map. This is a
// public contract between the agent and the app; change it together with the agent instructions
// (src/main/mcp/agent-instructions-mind-map.md).
//
// Schemas are zod raw shapes, as the SDK's tool() takes them, without defaults or transforms: the
// arguments a handler gets are the ones the agent wrote, minus undeclared keys, so the server can find
// the chat message a call came in (src/main/mcp/mind-map-server.ts). The server parses the arguments
// again with the same shapes; the rules that tie fields to a kind are checked by checkMindMap.
import { z } from 'zod'
import { DECISION_STATUSES, MIND_MAP_NODE_KINDS, MIND_MAP_TEXT_MAX, mindMapNodeIdSchema } from './mind-map'
import { isProductTopicName } from './paths'

export const MIND_MAP_SERVER_NAME = 'worfy-mind-map'

const topic = z.string().refine(isProductTopicName, 'a topic is one folder name under docs/product: letters, digits, ., _ or -, not "critic"')
const text = z
  .string()
  .max(MIND_MAP_TEXT_MAX)
  .refine((value) => value.trim() !== '', 'must not be empty or blanks only')
const kind = z.enum(MIND_MAP_NODE_KINDS)
const status = z.enum(DECISION_STATUSES)

export const mindMapToolShapes = {
  mind_map_read: { topic: topic.optional() },
  mind_map_add: {
    topic,
    kind,
    text,
    /** A node id, `ticket:NN` (a Ticket of the topic's map) or null (the topic itself). */
    from: z.string().min(1).nullable(),
    status: status.optional(),
    reason: text.optional(),
    source: text.optional(),
    advice: z.boolean().optional(),
    replaces: mindMapNodeIdSchema.optional(),
  },
  mind_map_update: { topic, id: mindMapNodeIdSchema, text: text.optional(), kind: kind.optional(), source: text.optional(), advice: z.boolean().optional() },
  mind_map_decide: { topic, id: mindMapNodeIdSchema, status, reason: text, replaces: mindMapNodeIdSchema.optional() },
  mind_map_remove: { topic, id: mindMapNodeIdSchema },
  product_save: {},
} satisfies Record<string, z.ZodRawShape>

export type MindMapToolName = keyof typeof mindMapToolShapes
export const MIND_MAP_TOOL_NAMES = Object.keys(mindMapToolShapes) as MindMapToolName[]

/** The parsed arguments of each tool. */
export type MindMapToolArgs = { [Name in MindMapToolName]: z.output<z.ZodObject<(typeof mindMapToolShapes)[Name]>> }

/** Parses a tool's arguments: wrong types are refused, undeclared keys dropped. */
export function parseMindMapToolArgs<Name extends MindMapToolName>(name: Name, args: unknown): z.ZodSafeParseResult<MindMapToolArgs[Name]> {
  return z.object(mindMapToolShapes[name]).safeParse(args) as z.ZodSafeParseResult<MindMapToolArgs[Name]>
}

/** The tool's name as Claude Code calls it: `mcp__worfy-mind-map__<tool>`. */
export const mindMapToolUseName = (name: MindMapToolName): string => `mcp__${MIND_MAP_SERVER_NAME}__${name}`

/** Every write answers the node as it is in the file now. */
const ANSWER = ' Answers the node as written; the file is checked first and stays as it was when the change is refused.'

export const mindMapToolDescriptions: Record<MindMapToolName, string> = {
  mind_map_read: 'Read one topic (its map title, map Tickets, Mind map nodes and format errors), or without topic list the topics of docs/product.',
  mind_map_add:
    'Add a node to a topic\'s Mind map: kind idea | question | decision | objection, text, from (parent node id, ticket:NN, or null for the topic). A decision needs status and reason, an objection a source (the fact: a path, Ticket, PR or URL). advice: true for your own advice.' +
    ANSWER,
  mind_map_update: 'Change a node\'s text, kind, source or advice. A decision is changed only with mind_map_decide.' + ANSWER,
  mind_map_decide: 'Make a node a Decision: status accepted | rejected and the reason; its earlier status and reason go to history. replaces: the Decision it overturns.' + ANSWER,
  mind_map_remove: 'Remove a node added by mistake: only one without children, never a Decision (reject it with mind_map_decide instead).',
  product_save: 'The owner asked to save: asks the Project\'s Orchestrator to save the changed docs/product files with a docs PR. You never use git yourself.',
}
