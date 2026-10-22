// The Browser MCP server `worfy-browser` (ADR-0078 items 4, 5 and 8; worfy-browser ticket 04):
// in process, like `worfy-canvas` (canvas-server.ts), one per Session in a Project, bound to that
// Project. It opens a Browser under an existing Browser profile — a new Browser Node next to the
// Session's Node, a Layout `create` that is not a step of ⌘Z, with the Session in `data.openedBy` —
// and drives Live Browsers over CDP (src/main/browser/cdp.ts).
//
// The walls, each checked here or in cdp.ts, whatever the agent asks:
// - only a profile the Project has; a Session never creates one;
// - only the origins of the Browser's profile (src/main/browser/origins.ts): the address of
//   browser_open and browser_navigate is checked before the page moves, and every other whole-page
//   navigation is stopped by the Fetch domain while the Session drives the Browser (the owner's
//   decision 2); the call that led there answers with the refusal; and a page outside them the user
//   left the Browser on is not the Session's to read or use: only browser_navigate leaves it;
// - never into a password field (the owner's decision 7);
// - once the user took the Browser over, every call is refused until they give it back (decision 3;
//   src/main/browser/live.ts).
// A refused call is a tool error with a message, never an exception.
import { randomUUID } from 'node:crypto'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { sdkMessageToEvents } from '../../shared/agent/events'
import type { BrowserProfile } from '../../shared/browser/profiles'
import {
  BROWSER_SERVER_NAME,
  BROWSER_SIZE,
  BROWSER_TOOL_NAMES,
  browserToolDescriptions,
  browserToolShapes,
  parseBrowserToolArgs,
  type BrowserToolArgs,
  type BrowserToolName,
} from '../../shared/browser/tools'
import { placeNear } from '../../shared/canvas/tools'
import { shownOnCanvas } from '../../shared/layout/derived'
import { isArchived, type LayoutNode } from '../../shared/layout/types'
import type { BrowserAttachment } from '../agent/options'
import { PageError, type PageOutcome, type PageTarget } from '../browser/cdp'
import { ControlError, liveBrowsers, type LiveBrowsers } from '../browser/live'
import { originOf, originRefusal, sessionMayGo } from '../browser/origins'
import { browserProfileStore } from '../browser/profiles'
import { layoutStore } from '../layout/store'
import { projectStore, type StoredProject } from '../projects/store'
import instructions from './browser-instructions.md?raw'
import { observeMessages, projectForCwd, repositoryRoot, type CanvasLayout } from './canvas-server'

/** The kind of a Browser Node (BROWSER_KIND, src/renderer/canvas/nodes/browser-frame.ts). */
const BROWSER_KIND = 'browser'

/** How long a call waits for a window to draw a Browser's page. */
export const LIVE_WAIT_MS = 15_000

/** What one server works on: one Project, seen from one Session. */
export interface BrowserContext {
  projectId: string
  layout: CanvasLayout
  /** The Project's Browser profiles, read at each call. */
  profiles: () => readonly BrowserProfile[]
  live: LiveBrowsers
  /** The calling Session's SDK id once known. */
  sessionId: () => string | null
  /** How long a call waits for a window to draw a page; LIVE_WAIT_MS by default. */
  liveWaitMs?: number
}

export type BrowserToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export interface BrowserToolResult {
  [key: string]: unknown
  content: BrowserToolContent[]
  isError?: boolean
}

/** A refusal the agent should read. */
class ToolError extends Error {}

const text = (value: unknown, isError = false): BrowserToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
})

type Handlers = { [Name in BrowserToolName]: (args: BrowserToolArgs[Name]) => unknown }

/** The element of a click or a typing: exactly one of selector and ref. */
function targetOf(args: { selector?: string | undefined; ref?: number | undefined }): PageTarget {
  if (args.selector !== undefined && args.ref !== undefined) throw new ToolError('Give either selector or ref, not both.')
  if (args.selector !== undefined) return { selector: args.selector }
  if (args.ref !== undefined) return { ref: args.ref }
  throw new ToolError('Give the element: a CSS selector, or a ref from browser_read.')
}

/** Where the page is after a call; a refusal of the origin wall during the call is the call's error. */
function outcome(result: PageOutcome): { url: string; title: string } {
  const [refusal] = result.refused
  if (refusal !== undefined) throw new ToolError(`${refusal} The page was not changed: it is still ${result.url}.`)
  return { url: result.url, title: result.title }
}

function handlers(context: BrowserContext): Handlers {
  const { projectId, layout, live } = context
  const browsers = (): LayoutNode[] => layout.get(projectId).layout.nodes.filter((node) => node.kind === BROWSER_KIND && !isArchived(node))
  const profileNamed = (id: unknown): BrowserProfile | undefined => (typeof id === 'string' ? context.profiles().find((profile) => profile.id === id) : undefined)
  const me = (): string => {
    const id = context.sessionId()
    if (id === null) throw new ToolError('This Session has no id yet; call again in a moment.')
    return id
  }
  const browserOf = (id: string): { node: LayoutNode; profile: BrowserProfile } => {
    const node = browsers().find((each) => each.id === id)
    if (node === undefined) throw new ToolError(`This Project's canvas has no Browser ${id}. Call browser_list for the ids.`)
    const profile = profileNamed(node.data.profile)
    if (profile === undefined) throw new ToolError(`Browser ${id} has no Browser profile now (it was deleted, or the user has not chosen one): a Session may not drive it.`)
    return { node, profile }
  }
  /**
   * The Live page of Browser `id`, driven by this Session from now on. A page outside the origins of
   * its profile — where the user went by hand before giving the Browser back — is not the Session's
   * to read or use: only a call that `leaves` it (browser_navigate) gets it. An empty page
   * (about:blank, a new Browser's) is no site's.
   */
  const drive = async (id: string, leaves = false) => {
    const { profile } = browserOf(id)
    const session = me()
    // Everything that refuses comes before the Session takes the Browser: a refused call leaves no
    // «Claude is driving» and no origin wall behind it.
    live.mayDrive(projectId, id, session)
    const page = await live.whenLive(projectId, id, context.liveWaitMs ?? LIVE_WAIT_MS)
    if (page === undefined) throw new ToolError(`Browser ${id} has no live page: no window of worfy on this Machine shows this Project's canvas. Ask the user to open it.`)
    const here = page.contents.getURL()
    if (!leaves && here !== '' && here !== 'about:blank' && !sessionMayGo(here, profile.origins)) {
      throw new ToolError(`Browser ${id} shows a page of ${originOf(here)}, outside the origins of its Browser profile "${profile.name}": a Session may not use it. Go to a page in the list with browser_navigate, or ask the user.`)
    }
    live.drive(projectId, id, session)
    await page.attach()
    return { page, profile }
  }
  const go = async (id: string, url: string) => {
    const { page, profile } = await drive(id, true)
    const refusal = originRefusal(url, profile.name, profile.origins)
    if (refusal !== null) throw new ToolError(refusal)
    const result = await page.navigate(url)
    const where = outcome(result)
    if (result.error !== null) throw new ToolError(`The page could not be opened: ${result.error}. It is at ${where.url}.`)
    return where
  }

  return {
    browser_list: () => ({
      profiles: context.profiles().map(({ id, name, origins }) => ({ id, name, origins })),
      browsers: browsers().map((node) => ({
        id: node.id,
        profile: typeof node.data.profile === 'string' ? node.data.profile : null,
        url: typeof node.data.url === 'string' ? node.data.url : null,
        openedBy: typeof node.data.openedBy === 'string' ? node.data.openedBy : null,
        live: live.page(projectId, node.id) !== undefined,
        control: live.control(projectId, node.id)?.mode ?? null,
      })),
    }),

    browser_open: async (args) => {
      const profile = profileNamed(args.profile)
      if (profile === undefined) {
        const known = context.profiles().map((each) => `${each.id} (${each.name})`)
        throw new ToolError(`This Project has no Browser profile ${args.profile}${known.length === 0 ? '; it has none: only the user creates them' : `; it has ${known.join(', ')}`}.`)
      }
      if (args.url !== undefined) {
        const refusal = originRefusal(args.url, profile.name, profile.origins)
        if (refusal !== null) throw new ToolError(refusal)
      }
      const sessionId = me()
      const id = freshId(layout, projectId)
      // Next to the Session's Node; main moves it off any Node it would cover (ADR-0038).
      const visible = layout.get(projectId).layout.nodes.filter(shownOnCanvas)
      const anchor = visible.find((node) => node.data.sessionId === sessionId) ?? null
      const spot = placeNear(visible, anchor, BROWSER_SIZE.w, BROWSER_SIZE.h)
      // The address comes after the page exists, through the Session's own navigation: so a
      // redirect of the first page is checked as any other.
      layout.apply(projectId, { op: 'create', node: { id, kind: BROWSER_KIND, ...spot, ...BROWSER_SIZE, data: { profile: profile.id, openedBy: sessionId } } })
      // The Session drives it from the start: the frame shows so, and the origin wall stands before the first page.
      const where = args.url === undefined ? (await drive(id), null) : await go(id, args.url)
      const node = layout.get(projectId).layout.nodes.find((each) => each.id === id)
      return { id, profile: profile.id, x: node?.x, y: node?.y, w: node?.w, h: node?.h, url: where?.url ?? null, title: where?.title ?? null }
    },

    browser_navigate: (args) => go(args.id, args.url),

    browser_click: async (args) => {
      const target = targetOf(args)
      const { page } = await drive(args.id)
      return outcome(await page.click(target))
    },

    browser_type: async (args) => {
      const target = targetOf(args)
      const { page } = await drive(args.id)
      return outcome(await page.type(target, args.text, args.submit))
    },

    browser_screenshot: async (args): Promise<BrowserToolResult> => {
      const { page } = await drive(args.id)
      return { content: [{ type: 'image', data: await page.screenshot(), mimeType: 'image/png' }] }
    },

    browser_read: async (args) => (await drive(args.id)).page.read(),

    browser_console: async (args) => ({ messages: (await drive(args.id)).page.console() }),

    browser_network: async (args) => ({ requests: (await drive(args.id)).page.network() }),
  }
}

/** A Browser Node id no Node of the Layout has, an archived one included. */
function freshId(layout: CanvasLayout, projectId: string): string {
  for (;;) {
    const id = `${BROWSER_KIND}-${randomUUID().slice(0, 8)}`
    if (!layout.get(projectId).layout.nodes.some((node) => node.id === id)) return id
  }
}

export type BrowserToolCaller = (name: BrowserToolName, args: unknown) => Promise<BrowserToolResult>

/** The tools of one context as one function: parse the arguments, act, answer. Never throws. */
export function browserToolCaller(context: BrowserContext): BrowserToolCaller {
  const table = handlers(context)
  return async (name, args) => {
    const parsed = parseBrowserToolArgs(name, args)
    if (!parsed.success) return text(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`, true)
    try {
      const handler = table[name] as (input: unknown) => unknown
      const answer = await handler(parsed.data)
      return typeof answer === 'object' && answer !== null && 'content' in answer ? (answer as BrowserToolResult) : text(answer)
    } catch (error) {
      if (error instanceof ToolError || error instanceof ControlError || error instanceof PageError) return text(error.message, true)
      return text(`The Browser could not do it: ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }
}

/** The server for one Session. The SDK is loaded on first use, as the Session itself does. */
export async function createBrowserServer(context: BrowserContext): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const call = browserToolCaller(context)
  return createSdkMcpServer({
    name: BROWSER_SERVER_NAME,
    version: '1.0.0',
    tools: BROWSER_TOOL_NAMES.map((name) => tool(name, browserToolDescriptions[name], browserToolShapes[name] as z.ZodRawShape, (args) => call(name, args))),
  })
}

/** The agent instructions appended to the system prompt. */
export const browserInstructions = (): string => instructions

/** The Browser of one Session: what its options get, and the watcher of its messages for the Session's id. */
export interface BrowserSession {
  attachment: BrowserAttachment
  observe<T extends object>(query: T): T
}

export interface BrowserDeps {
  projects: () => readonly StoredProject[]
  layout: CanvasLayout
  profiles: (projectId: string) => readonly BrowserProfile[]
  live: LiveBrowsers
  repositoryRoot?: (folder: string) => Promise<string | null>
}

export const browserAppDeps = (): BrowserDeps => ({
  projects: () => projectStore().list(),
  layout: layoutStore(),
  profiles: (projectId) => browserProfileStore().list(projectId),
  live: liveBrowsers(),
})

export type BrowserResolver = (request: { cwd: string; resume: string | undefined }) => Promise<BrowserSession | null>

/** The context of Session `sessionId` in Project `projectId`, with the app's stores. */
export function appBrowserContext(projectId: string, sessionId: () => string | null, deps: BrowserDeps = browserAppDeps()): BrowserContext {
  return { projectId, layout: deps.layout, profiles: () => deps.profiles(projectId), live: deps.live, sessionId }
}

/**
 * The Browser for a Session starting in `cwd` — found as the canvas finds its Project
 * (canvasForSession) — or null when `cwd` is in no Project.
 */
export async function browserForSession(request: Parameters<BrowserResolver>[0], deps: BrowserDeps = browserAppDeps()): Promise<BrowserSession | null> {
  let project = projectForCwd(deps.projects(), request.cwd)
  if (project === undefined) {
    const root = await (deps.repositoryRoot ?? repositoryRoot)(request.cwd)
    project = root === null ? undefined : projectForCwd(deps.projects(), root)
  }
  if (project === undefined) return null
  let sessionId: string | null = request.resume ?? null
  const server = await createBrowserServer(appBrowserContext(project.id, () => sessionId, deps))
  return {
    attachment: { server, instructions: browserInstructions() },
    observe: (query) =>
      observeMessages(query, (message) => {
        for (const event of sdkMessageToEvents(message)) if (event.type === 'init') sessionId = event.sdkSessionId
      }),
  }
}

/**
 * Lets an e2e run call the tools as Session `sessionId` of Project `projectId` would
 * (`globalThis.worfyBrowserTool`), for the fake agent, which calls no MCP tool itself.
 */
export function exposeBrowserToolsToFakeAgent(): void {
  ;(globalThis as { worfyBrowserTool?: (projectId: string, sessionId: string, name: BrowserToolName, args: unknown) => Promise<BrowserToolResult> }).worfyBrowserTool = (projectId, sessionId, name, args) =>
    browserToolCaller(appBrowserContext(projectId, () => sessionId))(name, args)
}
