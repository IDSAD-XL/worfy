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
//   src/main/browser/live.ts);
// - a Session drives the Browsers it opened and those the user opened, never one another Session
//   opened (`openedBy`, worfy-browser ticket 06): that one is in the other Session's Family and leaves
//   the Canvas with it; and a Session whose Nodes are all off the Canvas (hidden, archived) neither
//   opens a Browser, which would outlive the Session's place there (ADR-0078, item 11), nor drives
//   one, whose control ended when it left (src/main/browser/live.ts). Both are checked before
//   anything is taken or woken, and again after the wake, since the Session may leave meanwhile;
// - a call on an Asleep Browser wakes it, and browser_open opens one, under the limit of Live
//   Browsers (worfy-browser ticket 05): while every Live Browser is busy the call is refused with
//   ALL_LIVE_BUSY before anything changes — no Node is made, no Browser taken — and the Session
//   calls again later. While a call runs, and for the idle threshold after it, the Browser does not
//   sleep (`sessionDrives`, `sessionReleases`);
// - a Session in Autopilot (worfy-browser ticket 08, ADR-0078 item 10) knows only the profiles marked
//   «Available to Autopilot»: the others, and the Browsers under them, are not in its list, and a call
//   on one is refused naming the profile, before anything is made, woken or driven.
// A Session never signs in (ADR-0078 item 5). When the page of a call lands on the profile's sign-in
// page, or its main document answers 401 (the owner's answer 2026-10-23), the sign-in expired: a
// Session in Autopilot gets the call refused with SIGN_IN_EXPIRED, any other Session the usual answer
// with a note to ask the user. While the page is there, a Session in Autopilot may only navigate
// away: a click could press a "Sign in as…" button or a single sign-on (ADR-0078 item 10).
// A Browser is opened for a Ticket (`ticket`, required in Autopilot): main checks the Ticket is in
// the Project — and in Autopilot of the Epic the run works on — and the Browser joins its Family.
// A refused call is a tool error with a message, never an exception.
import { randomUUID } from 'node:crypto'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { sdkMessageToEvents } from '../../shared/agent/events'
import type { BrowserProfile } from '../../shared/browser/profiles'
import {
  AUTOPILOT_ONLY,
  BROWSER_SERVER_NAME,
  BROWSER_SIZE,
  BROWSER_TOOL_NAMES,
  browserToolDescriptions,
  browserToolShapes,
  parseBrowserToolArgs,
  type BrowserToolArgs,
  type BrowserToolName,
  SIGN_IN_EXPIRED,
} from '../../shared/browser/tools'
import { placeNear } from '../../shared/canvas/tools'
import { autopilotEpicAtWork } from '../../shared/ipc/autopilot'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import { shownOnCanvas } from '../../shared/layout/derived'
import { isArchived, type LayoutNode } from '../../shared/layout/types'
import type { BrowserAttachment } from '../agent/options'
import { PageError, type CdpPage, type PageOutcome, type PageTarget } from '../browser/cdp'
import { ControlError, liveBrowsers, type LiveBrowsers } from '../browser/live'
import { originOf, originRefusal, sessionMayGo } from '../browser/origins'
import { browserProfileStore } from '../browser/profiles'
import { layoutStore } from '../layout/store'
import { projectStore, type StoredProject } from '../projects/store'
import instructions from './browser-instructions.md?raw'
import { appDeps as canvasAppDeps, observeMessages, projectForCwd, repositoryRoot, type CanvasLayout, type CanvasWorkflow } from './canvas-server'

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
  /** The Session runs unattended (Autopilot): only the profiles marked «Available to Autopilot» exist for it. */
  autopilot?: boolean
  /** The Project's Epics and Tickets, read when a Browser is opened for a Ticket. */
  workflow?: () => Promise<CanvasWorkflow>
  /** The Epic of the Project's Autopilot run, or null when none runs. */
  runningEpic?: () => Promise<string | null>
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

/**
 * Why the sign-in of `profile` expired on the page at `url` whose main document answered `status`,
 * or null when it did not: the page is the profile's sign-in page — the same origin and path; the
 * query (a `next=` back) is not compared — or the document answered 401. A profile without a sign-in
 * page relies on 401 alone. Nothing is read from the page's text.
 */
export function signInExpiry(profile: BrowserProfile, url: string, status: number | null): string | null {
  const head = `${SIGN_IN_EXPIRED} "${profile.name}"`
  if (status === 401) return `${head}: the page answered 401 Unauthorized.`
  if (profile.signIn === undefined || !URL.canParse(url) || !URL.canParse(profile.signIn)) return null
  const [here, signIn] = [new URL(url), new URL(profile.signIn)]
  // Only the origin and path are named: the stored address is the user's, and its query is not ours to show.
  return here.origin === signIn.origin && here.pathname === signIn.pathname ? `${head}: the page went to its sign-in page ${signIn.origin}${signIn.pathname}.` : null
}

/** A Ticket a Browser is opened for. */
interface BrowserTicket {
  epic: string
  num: number
}

/**
 * The tools of one call. `hold(id)` marks Browser `id` as worked on by this call, from then until the
 * call ends (sessionDrives and sessionReleases of src/main/browser/live.ts).
 */
function handlers(context: BrowserContext, hold: (id: string) => void): Handlers {
  const { projectId, layout, live } = context
  const autopilot = context.autopilot === true
  /** The profiles this Session may use: in Autopilot only those marked for it. */
  const usable = (): BrowserProfile[] => context.profiles().filter((profile) => !autopilot || profile.autopilot)
  const browsers = (): LayoutNode[] => layout.get(projectId).layout.nodes.filter((node) => node.kind === BROWSER_KIND && !isArchived(node))
  /** Profile `id` of the Project; in Autopilot one not marked for it is refused, naming it. */
  const profileNamed = (id: unknown): BrowserProfile | undefined => {
    const profile = typeof id === 'string' ? context.profiles().find((each) => each.id === id) : undefined
    if (profile !== undefined && autopilot && !profile.autopilot) {
      throw new ToolError(`Browser profile ${profile.id} ("${profile.name}") ${AUTOPILOT_ONLY}: a Session in Autopilot uses only the profiles the user marked so. Report "sign-in needed as ${profile.name}" and go on without this check.`)
    }
    return profile
  }
  /**
   * The answer of a call that may have moved the page, with the sign-in check: in Autopilot an expired
   * sign-in refuses the call — nobody is there to sign in, and the Session never does; otherwise the
   * answer carries the note.
   */
  const arrived = <T extends { url: string }>(id: string, page: CdpPage, profile: BrowserProfile, answer: T): T | (T & { signIn: string }) => {
    const expired = signInExpiry(profile, answer.url, page.documentStatus())
    if (expired === null) return answer
    if (autopilot) throw new ToolError(`${expired} Do not sign in yourself: stop the checks under this profile and report "sign-in expired in Browser profile ${profile.name}". Browser ${id} is at ${answer.url}.`)
    return { ...answer, signIn: `${expired} Do not sign in yourself: ask the user to sign in in this Browser.` }
  }
  /**
   * The Ticket `text` names, checked before a Browser is made for it: one of the Project's Tickets,
   * and in Autopilot one of the Epic the run works on. In Autopilot it must be given.
   */
  const ticketFor = async (text: string | undefined): Promise<BrowserTicket | null> => {
    if (text === undefined) {
      if (autopilot) throw new ToolError('In Autopilot, browser_open needs `ticket`: the "<epic>/<NN>" of the Ticket you check, from your brief.')
      return null
    }
    const [, epic = '', digits = ''] = /^(.+)\/([0-9]+)$/.exec(text) ?? []
    const num = Number(digits)
    const name = `${epic}/${String(num).padStart(2, '0')}`
    if (autopilot) {
      const running = context.runningEpic === undefined ? null : await context.runningEpic()
      if (running === null) throw new ToolError(`No Autopilot run works on an Epic of this Project now, so no Browser is opened for Ticket ${name}.`)
      if (running !== epic) throw new ToolError(`Ticket ${name} is not of Epic ${running}, the one this Autopilot run works on.`)
    }
    if (context.workflow === undefined) throw new ToolError(`The Tickets of this Project cannot be read here, so ${name} cannot be checked.`)
    const model = await context.workflow()
    if (model.error) throw new ToolError(`Could not read the Tickets of this Project to check ${name}: ${model.error.message}`)
    if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new ToolError(`This Project has no Epic ${epic}.`)
    if (!model.tickets.some((each) => each.epic === epic && each.num === num)) throw new ToolError(`Epic ${epic} has no Ticket ${String(num).padStart(2, '0')}.`)
    return { epic, num }
  }
  const me = (): string => {
    const id = context.sessionId()
    if (id === null) throw new ToolError('This Session has no id yet; call again in a moment.')
    return id
  }
  /**
   * Hidden or archived everywhere, Session `session` is off the Canvas. A Session with no Node at all
   * (an agent the Canvas does not show) is not: it opens and drives Browsers as before.
   */
  const offCanvas = (session: string): boolean => {
    const mine = layout.get(projectId).layout.nodes.filter((node) => node.data.sessionId === session && (node.kind === SESSION_NODE_KIND || node.kind === ORCHESTRATOR_KIND))
    return mine.length > 0 && !mine.some(shownOnCanvas)
  }
  const OFF_CANVAS = "This Session's Node is not on the Canvas (it is hidden or archived)"
  const mayStillDrive = (session: string): void => {
    if (offCanvas(session)) throw new ToolError(`${OFF_CANVAS}, so it drives no Browser: its control of the Browsers ended when it left. Ask the user to show the Session's Node.`)
  }
  const mayStillOpen = (session: string): void => {
    if (offCanvas(session)) throw new ToolError(`${OFF_CANVAS}, so it opens no Browser: a Browser leaves the Canvas with its Session. Ask the user to show the Session's Node.`)
  }
  const browserOf = (id: string, session: string): { node: LayoutNode; profile: BrowserProfile } => {
    const node = browsers().find((each) => each.id === id)
    if (node === undefined) throw new ToolError(`This Project's canvas has no Browser ${id}. Call browser_list for the ids.`)
    const opener = node.data.openedBy
    if (typeof opener === 'string' && opener !== session) throw new ToolError(`Browser ${id} was opened by another Session, so only that Session drives it. Open a Browser of your own with browser_open.`)
    mayStillDrive(session)
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
    const session = me()
    const { node, profile } = browserOf(id, session)
    // In Autopilot, on its sign-in page (or a 401 page) only a way out is left: no click, no typing,
    // not even a look, which could lead to one. Checked before the Session takes or wakes anything,
    // on the page as it is now (or as it was left, when Asleep), and again once it is live.
    const onSignIn = (url: string, status: number | null): void => {
      if (!autopilot || leaves) return
      const expired = signInExpiry(profile, url, status)
      if (expired !== null) throw new ToolError(`${expired} Browser ${id} is there: only browser_navigate away is allowed. Do not sign in yourself; report "sign-in expired in Browser profile ${profile.name}".`)
    }
    const before = live.page(projectId, id)
    onSignIn(before?.contents.getURL() ?? (typeof node.data.url === 'string' ? node.data.url : ''), before?.documentStatus() ?? null)
    // A refused call leaves no «Claude is driving» behind: what can refuse is checked before the
    // Session takes the Browser, and a call that took it and then fails (the debugger could not
    // attach, the page went off the list meanwhile) gives it up again.
    live.mayDrive(projectId, id, session)
    hold(id)
    // An Asleep Browser wakes for the call; while every Live Browser is busy it stays Asleep and the
    // call is refused (ControlError), before the Session takes anything.
    await live.wake(projectId, id, 'session')
    const page = await live.whenLive(projectId, id, context.liveWaitMs ?? LIVE_WAIT_MS)
    if (page === undefined) throw new ToolError(`Browser ${id} has no live page: no window of worfy on this Machine shows this Project's canvas. Ask the user to open it.`)
    const offList = (): void => {
      const here = page.contents.getURL()
      if (!leaves && here !== '' && here !== 'about:blank' && !sessionMayGo(here, profile.origins)) {
        throw new ToolError(`Browser ${id} shows a page of ${originOf(here)}, outside the origins of its Browser profile "${profile.name}": a Session may not use it. Go to a page in the list with browser_navigate, or ask the user.`)
      }
    }
    offList()
    onSignIn(page.contents.getURL(), page.documentStatus())
    // The Session may have left the Canvas while the Browser woke: main dropped its control then,
    // and nothing would drop one taken now.
    mayStillDrive(session)
    const took = live.control(projectId, id) === null
    live.drive(projectId, id, session)
    try {
      await page.attach()
      // The page may have moved before the origin wall stood.
      offList()
    } catch (error) {
      if (took) live.release(projectId, id)
      throw error
    }
    return { page, profile }
  }
  const go = async (id: string, url: string) => {
    const { page, profile } = await drive(id, true)
    const refusal = originRefusal(url, profile.name, profile.origins)
    if (refusal !== null) throw new ToolError(refusal)
    const result = await page.navigate(url)
    const where = outcome(result)
    if (result.error !== null) throw new ToolError(`The page could not be opened: ${result.error}. It is at ${where.url}.`)
    return arrived(id, page, profile, where)
  }

  return {
    browser_list: () => ({
      profiles: usable().map(({ id, name, origins }) => ({ id, name, origins })),
      // In Autopilot a Browser under a profile not marked for it is not there either.
      browsers: browsers().filter((node) => !autopilot || usable().some((profile) => profile.id === node.data.profile)).map((node) => ({
        id: node.id,
        profile: typeof node.data.profile === 'string' ? node.data.profile : null,
        url: typeof node.data.url === 'string' ? node.data.url : null,
        openedBy: typeof node.data.openedBy === 'string' ? node.data.openedBy : null,
        ticket: ticketOfNode(node),
        live: live.page(projectId, node.id) !== undefined,
        control: live.control(projectId, node.id)?.mode ?? null,
      })),
    }),

    browser_open: async (args) => {
      const profile = profileNamed(args.profile)
      if (profile === undefined) {
        const known = usable().map((each) => `${each.id} (${each.name})`)
        const none = autopilot ? '; it has none available to Autopilot: only the user creates them and marks them so' : '; it has none: only the user creates them'
        throw new ToolError(`This Project has no Browser profile ${args.profile}${known.length === 0 ? none : `; it has ${known.join(', ')}`}.`)
      }
      if (args.url !== undefined) {
        const refusal = originRefusal(args.url, profile.name, profile.origins)
        if (refusal !== null) throw new ToolError(refusal)
      }
      const ticket = await ticketFor(args.ticket)
      const sessionId = me()
      // Off the Canvas, the Session opens no Browser: one opened now would stay after it, since
      // nothing takes the Session off the Canvas again.
      mayStillOpen(sessionId)
      const id = freshId(layout, projectId)
      // The new Browser is Live from the start: with every Live Browser busy no Node is made.
      hold(id)
      await live.wake(projectId, id, 'session')
      // The Session may have left while the Browser woke: no Node is made, and main forgets the
      // life of the woken Browser at its next check (no Node, no call on it).
      mayStillOpen(sessionId)
      // Next to the Session's Node; main moves it off any Node it would cover (ADR-0038).
      const visible = layout.get(projectId).layout.nodes.filter(shownOnCanvas)
      const anchor = visible.find((node) => node.data.sessionId === sessionId) ?? null
      const spot = placeNear(visible, anchor, BROWSER_SIZE.w, BROWSER_SIZE.h)
      // The address comes after the page exists, through the Session's own navigation: so a
      // redirect of the first page is checked as any other.
      layout.apply(projectId, { op: 'create', node: { id, kind: BROWSER_KIND, ...spot, ...BROWSER_SIZE, data: { profile: profile.id, openedBy: sessionId, ...(ticket === null ? {} : { ticket }) } } })
      // The Session drives it from the start: the frame shows so, and the origin wall stands before the first page.
      const where = args.url === undefined ? (await drive(id), null) : await go(id, args.url)
      const node = layout.get(projectId).layout.nodes.find((each) => each.id === id)
      return {
        id,
        profile: profile.id,
        ticket: ticket === null ? null : `${ticket.epic}/${String(ticket.num).padStart(2, '0')}`,
        x: node?.x,
        y: node?.y,
        w: node?.w,
        h: node?.h,
        url: where?.url ?? null,
        title: where?.title ?? null,
        ...(where !== null && 'signIn' in where ? { signIn: where.signIn } : {}),
      }
    },

    browser_navigate: (args) => go(args.id, args.url),

    browser_click: async (args) => {
      const target = targetOf(args)
      const { page, profile } = await drive(args.id)
      return arrived(args.id, page, profile, outcome(await page.click(target)))
    },

    browser_type: async (args) => {
      const target = targetOf(args)
      const { page, profile } = await drive(args.id)
      return arrived(args.id, page, profile, outcome(await page.type(target, args.text, args.submit)))
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

/** The Ticket a Browser Node was opened for, as `<epic>/<NN>`, or null. */
function ticketOfNode(node: LayoutNode): string | null {
  const ticket = node.data.ticket as { epic?: unknown; num?: unknown } | undefined
  return typeof ticket?.epic === 'string' && typeof ticket.num === 'number' ? `${ticket.epic}/${String(ticket.num).padStart(2, '0')}` : null
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
  return async (name, args) => {
    const parsed = parseBrowserToolArgs(name, args)
    if (!parsed.success) return text(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`, true)
    const held = new Set<string>()
    const table = handlers(context, (id) => {
      if (held.has(id)) return
      held.add(id)
      context.live.sessionDrives(context.projectId, id)
    })
    try {
      const handler = table[name] as (input: unknown) => unknown
      // The commands of this call know their Session: one that left the Canvas meanwhile stops its own call only.
      const answer = await context.live.asSession(context.sessionId(), () => Promise.resolve(handler(parsed.data)))
      return typeof answer === 'object' && answer !== null && 'content' in answer ? (answer as BrowserToolResult) : text(answer)
    } catch (error) {
      if (error instanceof ToolError || error instanceof ControlError || error instanceof PageError) return text(error.message, true)
      return text(`The Browser could not do it: ${error instanceof Error ? error.message : String(error)}`, true)
    } finally {
      for (const id of held) context.live.sessionReleases(context.projectId, id)
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
  /** The Epics and Tickets of Project `projectId`. */
  workflow?: (projectId: string) => Promise<CanvasWorkflow>
  /** The Epic the Autopilot run of Project `projectId` works on, or null. */
  runningEpic?: (projectId: string) => Promise<string | null>
}

export const browserAppDeps = (): BrowserDeps => ({
  projects: () => projectStore().list(),
  layout: layoutStore(),
  profiles: (projectId) => browserProfileStore().list(projectId),
  live: liveBrowsers(),
  workflow: (projectId) => canvasAppDeps().workflow(projectStore().get(projectId).path),
  // Loaded when asked: the Autopilot module brings the Session registry, which loads this module.
  runningEpic: async (projectId) => autopilotEpicAtWork((await import('../ipc/autopilot')).sharedAutopilot().state(projectId)),
})

/** What a Browser server is made for: where the Session starts, the session it resumes, and whether it runs unattended (Autopilot). */
export type BrowserResolver = (request: { cwd: string; resume: string | undefined; autopilot?: boolean | undefined }) => Promise<BrowserSession | null>

/** The context of Session `sessionId` in Project `projectId`, with the app's stores; `autopilot` for a Session that runs unattended. */
export function appBrowserContext(projectId: string, sessionId: () => string | null, deps: BrowserDeps = browserAppDeps(), autopilot = false): BrowserContext {
  const { workflow, runningEpic } = deps
  return {
    projectId,
    layout: deps.layout,
    profiles: () => deps.profiles(projectId),
    live: deps.live,
    sessionId,
    autopilot,
    ...(workflow === undefined ? {} : { workflow: () => workflow(projectId) }),
    ...(runningEpic === undefined ? {} : { runningEpic: () => runningEpic(projectId) }),
  }
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
  const server = await createBrowserServer(appBrowserContext(project.id, () => sessionId, deps, request.autopilot === true))
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
 * (`globalThis.worfyBrowserTool`), for the fake agent, which calls no MCP tool itself. `unattended`
 * answers whether that Session runs unattended now, as its launch says (the Session registry): a
 * real Session's server is made in Autopilot mode from the same launch (src/main/agent/app-registry.ts).
 */
export function exposeBrowserToolsToFakeAgent(unattended: (sessionId: string) => boolean = () => false): void {
  ;(globalThis as { worfyBrowserTool?: (projectId: string, sessionId: string, name: BrowserToolName, args: unknown) => Promise<BrowserToolResult> }).worfyBrowserTool = (projectId, sessionId, name, args) =>
    browserToolCaller(appBrowserContext(projectId, () => sessionId, browserAppDeps(), unattended(sessionId)))(name, args)
}
