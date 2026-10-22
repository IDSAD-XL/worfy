// The tools of the Browser MCP server `worfy-browser` (ADR-0078 items 4 and 8, worfy-browser
// ticket 04): how a Session opens a Browser under a Browser profile of its Project and drives it.
// A public contract between the agent and the app, like the canvas tools (src/shared/canvas/tools.ts);
// change it together with the agent instructions (src/main/mcp/browser-instructions.md).
//
// Schemas are zod raw shapes, as the SDK's tool() takes them; the server
// (src/main/mcp/browser-server.ts) parses the arguments again with the same shapes. Descriptions
// are short on purpose: every Session carries them in its context.
import { z } from 'zod'
import { browserProfileIdSchema } from './profiles'
import { nodeIdSchema } from '../layout/types'

export const BROWSER_SERVER_NAME = 'worfy-browser'

/** The size of a Browser a Session opens: that of «New browser» (src/renderer/canvas/nodes/BrowserNode.tsx). */
export const BROWSER_SIZE = { w: 640, h: 440 }

/** How many console messages and network requests a Browser keeps for a Session: the last ones (the owner's decision 4). */
export const BROWSER_LOG_LIMIT = 200

/** The longest text the page snapshot answers; the rest is cut with a note. */
export const BROWSER_SNAPSHOT_MAX = 60_000

/** The first words of the answer to any call after the user took a Browser over (the owner's decision 3). */
export const TAKEN_OVER = 'The user took over this Browser'

/** The first words of the answer to «type» into a password field (the owner's decision 7). */
export const PASSWORD_REFUSED = 'This is a password field'

const url = z.string().trim().min(1).max(4000)
const selector = z.string().trim().min(1).max(2000)
/** A ref of browser_read: the backend DOM node id it prints as [ref=…]. */
const ref = z.number().int().positive()

export const browserToolShapes = {
  browser_list: {},
  browser_open: { profile: browserProfileIdSchema, url: url.optional() },
  browser_navigate: { id: nodeIdSchema, url },
  browser_click: { id: nodeIdSchema, selector: selector.optional(), ref: ref.optional() },
  browser_type: { id: nodeIdSchema, selector: selector.optional(), ref: ref.optional(), text: z.string().max(10_000), submit: z.boolean().default(false) },
  browser_screenshot: { id: nodeIdSchema },
  browser_read: { id: nodeIdSchema },
  browser_console: { id: nodeIdSchema },
  browser_network: { id: nodeIdSchema },
} satisfies Record<string, z.ZodRawShape>

export type BrowserToolName = keyof typeof browserToolShapes
export const BROWSER_TOOL_NAMES = Object.keys(browserToolShapes) as BrowserToolName[]

/** The parsed arguments of each tool. */
export type BrowserToolArgs = { [Name in BrowserToolName]: z.output<z.ZodObject<(typeof browserToolShapes)[Name]>> }

/** Parses a tool's arguments: wrong types are refused, undeclared keys dropped. */
export function parseBrowserToolArgs<Name extends BrowserToolName>(name: Name, args: unknown): z.ZodSafeParseResult<BrowserToolArgs[Name]> {
  return z.object(browserToolShapes[name]).safeParse(args) as z.ZodSafeParseResult<BrowserToolArgs[Name]>
}

const TARGET = ' Give the element as a CSS `selector` or as a `ref` from browser_read.'
const ORIGINS = ' A page outside the origins of the Browser\'s profile is refused, whatever leads there (a link, a redirect, a script).'

export const browserToolDescriptions: Record<BrowserToolName, string> = {
  browser_list: "List this Project's Browser profiles (id, name, origins a Session may open) and its Browsers (id, profile, address, who drives it).",
  browser_open: 'Open a new Browser under an existing Browser profile, next to your Session\'s Node, optionally at a URL. Returns its id. Only the user creates profiles and logs in.' + ORIGINS,
  browser_navigate: 'Send a Browser to a URL and wait for the page to load.' + ORIGINS,
  browser_click: 'Click an element of the page, as a user would.' + TARGET + ORIGINS,
  browser_type: 'Type text into a field of the page; submit=true presses Enter after it. Never into a password field: the user logs in.' + TARGET,
  browser_screenshot: 'Take a screenshot of the page as it is now (PNG).',
  browser_read: 'Read the page as a text snapshot of its accessibility tree: roles, names, values and [ref=…] of the elements.',
  browser_console: `The last ${BROWSER_LOG_LIMIT} console messages and page errors of the Browser, oldest first.`,
  browser_network: `The last ${BROWSER_LOG_LIMIT} network requests of the Browser, oldest first: method, URL, type, status; no bodies.`,
}

/** Who drives a Browser: a Session (`claude`), the user after taking it over (`user`), or nobody (null). */
export const browserControlModeSchema = z.enum(['claude', 'user'])
export type BrowserControlMode = z.output<typeof browserControlModeSchema>
