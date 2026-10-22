// The `browser` domain (worfy-browser ticket 11): main tells the window that draws a Browser's page
// (the <webview>'s embedder) that the page asked for a window main did not open by itself — a
// request from a frame of another origin or without a referrer (browserWindowOpenHandler,
// src/main/window.ts). The window's Browser frame offers the address in its Open bar
// (src/renderer/canvas/nodes/BrowserNode.tsx). `local`: the page and its window are on this
// machine's screen, so the event never goes to a Linked machine.
//
// The Browser profiles of a Project (worfy-browser ticket 03; src/main/browser/profiles.ts): the
// list is `read` — a read-only screen of a Linked machine shows a frame's profile name (ADR-0078
// item 14) — and creating, changing and deleting one are `write`. Only the user does them, from the
// window «Browser profiles…» (src/renderer/browser/BrowserProfiles.tsx); a Session has no such
// action.
//
// A Session driving a Browser (worfy-browser ticket 04; src/main/browser/live.ts): the Browser layer
// of the window that draws a page tells main its web contents (`browser.page.live`, `local`: the
// page is on this machine's screen, and main opens its CDP session only here, ADR-0078). main tells
// every window who drives each Browser (`browser.control.changed`, read with `browser.control.list`)
// — the frame shows «Claude is driving» while a Session does — and the frame tells main when the
// user takes a Browser over by a click or a key on it (`browser.control.take`) and when they press
// «Return control to Claude» (`browser.control.return`).
//
// Live and Asleep (worfy-browser ticket 05; src/main/browser/live.ts): each window tells main which
// Browser frames it shows and at which zoom (`browser.screen`);
// main answers every window with the life of each Browser — Live or Asleep, «Unsaved changes», over
// the limit — (`browser.lives.changed`, read with `browser.lives.list`), and a window draws a page
// only for a Live one. An Asleep frame shows the picture of its page (`browser.picture`), and a click
// on it wakes the Browser (`browser.wake`).
//
// Other screens (worfy-browser ticket 07; ADR-0078 items 9, 14 and 16): a Browser has one Live page,
// in the window of this Machine where the user worked with it last (`here` of its life, for that
// window only). Every other screen — another window here, a window of a Linked machine — shows the
// frames of that page (`browser.frames.watch`, then `browser.frame`), and sends it the user's click,
// scroll and keys (`browser.input`) and the address typed in its bar (`browser.navigate`). The
// screens of a Linked machine tell main what they show too (`browser.screen` with their `screen`):
// a Browser seen there does not sleep. Frames, input, the lives, the picture of an Asleep page,
// a wake and a screen's report are `project` and `write`, as the output of a Terminal is: a
// read-only Linked machine sees only the frame with the name of the Browser profile (ADR-0078 item
// 14, ADR-0066), and the Layout it gets carries no address of a Browser (src/main/browser/read-only.ts).
import { z } from 'zod'
import { browserProfileIdSchema, browserProfileNameSchema, browserProfileSchema, BROWSER_PROFILE_ORIGINS_MAX } from '../browser/profiles'
import { browserControlModeSchema } from '../browser/tools'
import { nodeIdSchema } from '../layout/types'
import { screenIdSchema } from './layout'
import { eventChannel, invokeChannel } from './channels'

export const browserOpenRequestSchema = z.object({
  /** The web contents id of the Browser's page; the renderer matches it to its <webview> (getWebContentsId). */
  webContentsId: z.number().int(),
  /** The http(s) address the page asked for. */
  url: z.string().min(1),
})
export type BrowserOpenRequest = z.output<typeof browserOpenRequestSchema>

/** Sent to the window that draws the page, once per refused request. */
export const browserOpenRequest = eventChannel('browser.openRequest', browserOpenRequestSchema, 'local')

const projectId = z.string().min(1)
/** Origins as the user typed them: main reads each one again (parseOrigin) and refuses the change when one is not an origin. */
const typedOrigins = z.array(z.string().max(400)).max(BROWSER_PROFILE_ORIGINS_MAX)

/** The Browser profiles of the Project; one without a file has "Default". Reading writes nothing (a read channel, ADR-0066). */
export const browserProfilesList = invokeChannel('browser.profiles.list', z.object({ projectId }), z.object({ profiles: z.array(browserProfileSchema) }), 'project', 'read')

/** Makes a Browser profile; main picks its id from the name. Refused for a name the Project already has. */
export const browserProfilesCreate = invokeChannel(
  'browser.profiles.create',
  z.object({ projectId, name: browserProfileNameSchema, origins: typedOrigins.optional(), autopilot: z.boolean().optional() }),
  browserProfileSchema,
  'project',
  'write',
)

/** Renames a Browser profile, or changes its origins or its Autopilot flag; its id and partition stay. */
export const browserProfilesUpdate = invokeChannel(
  'browser.profiles.update',
  z.object({ projectId, id: browserProfileIdSchema, name: browserProfileNameSchema.optional(), origins: typedOrigins.optional(), autopilot: z.boolean().optional() }),
  browserProfileSchema,
  'project',
  'write',
)

/** Deletes a Browser profile and erases its partition's storage: cookies, logins and site data. */
export const browserProfilesDelete = invokeChannel('browser.profiles.delete', z.object({ projectId, id: browserProfileIdSchema }), z.object({ id: browserProfileIdSchema }), 'project', 'write')

/** Sent to every window after the Browser profiles of a Project changed. */
export const browserProfilesChanged = eventChannel('browser.profiles.changed', z.object({ projectId }), 'project', 'read')

/** The page of Browser Node `nodeId` is the guest `webContentsId` of a <webview> of the calling window. */
export const browserPageLive = invokeChannel('browser.page.live', z.object({ projectId, nodeId: nodeIdSchema, webContentsId: z.number().int() }), z.object({ live: z.boolean() }), 'local')

const browserControlSchema = z.object({ nodeId: nodeIdSchema, mode: browserControlModeSchema })

/** Who drives each Browser of the Project that somebody drives. */
export const browserControlList = invokeChannel('browser.control.list', z.object({ projectId }), z.object({ controls: z.array(browserControlSchema) }), 'project', 'read')

/** The user took Browser `nodeId` over by a click or a key on its frame; `taken` is false when no Session was driving it. */
export const browserControlTake = invokeChannel('browser.control.take', z.object({ projectId, nodeId: nodeIdSchema }), z.object({ taken: z.boolean() }), 'project', 'write')

/**
 * The ⌘Z of a step that took Session `sessionId` off the Canvas while the user had Browser `nodeId`
 * taken over from it: the takeover is the user's again (src/renderer/canvas/history.ts). `held` is
 * false when somebody drives the Browser by now.
 */
export const browserControlHold = invokeChannel('browser.control.hold', z.object({ projectId, nodeId: nodeIdSchema, sessionId: z.string().min(1) }), z.object({ held: z.boolean() }), 'project', 'write')

/** «Return control to Claude»: the Session that drove Browser `nodeId` drives it again. */
export const browserControlReturn = invokeChannel('browser.control.return', z.object({ projectId, nodeId: nodeIdSchema }), z.object({ returned: z.boolean() }), 'project', 'write')

/**
 * A Session's click on the page of Browser `nodeId` starts and ends: Chromium moves the window's
 * keyboard focus onto the <webview> at the press, and the window that draws the page gives it back
 * to where the user had it (src/renderer/browser/control.ts). Only this Machine's windows draw Live pages.
 */
export const browserPressing = eventChannel('browser.pressing', z.object({ projectId, nodeId: nodeIdSchema, phase: z.enum(['start', 'end']) }), 'local')

/** Sent to every window after the control of a Browser changed; `mode` null when nobody drives it. */
export const browserControlChanged = eventChannel('browser.control.changed', z.object({ projectId, nodeId: nodeIdSchema, mode: browserControlModeSchema.nullable() }), 'project', 'read')

/**
 * What a screen shows: the Browser frames in it and the zoom of its Canvas. A window of a Linked
 * machine names itself (`screen`, src/renderer/canvas/screen.ts) and says it again every
 * BROWSER_SCREEN_RENEW_MS: one connection carries all its windows, and a report not renewed in
 * time counts no more (src/main/browser/sleep.ts).
 */
export const browserScreen = invokeChannel(
  'browser.screen',
  z.object({ projectId, visible: z.array(nodeIdSchema).max(1000), zoom: z.number().positive(), screen: screenIdSchema.optional() }),
  z.object({}),
  'project',
  'write',
)

/** How often a window of a Linked machine tells the Machine of the Project again what it shows. */
export const BROWSER_SCREEN_RENEW_MS = 20_000

/** The life of one Browser as main keeps it. */
export const browserLifeSchema = z.object({
  nodeId: nodeIdSchema,
  /** Live: a window draws its page. Asleep: its frame shows the picture of the page. */
  live: z.boolean(),
  /** Live because its page has a beforeunload handler: the frame says «Unsaved changes». */
  unsaved: z.boolean(),
  /** Live beyond the limit, since every other Live Browser was busy. */
  overLimit: z.boolean(),
  /** Grows with every new picture of the page; null while it has none. */
  picture: z.number().int().nullable(),
  /** The window that reads it draws the page; every other screen shows its frames (ADR-0078 item 16). */
  here: z.boolean(),
})
export type BrowserLife = z.output<typeof browserLifeSchema>

const browserLives = z.object({ projectId, lives: z.array(browserLifeSchema) })

/** The lives of the Browsers of the Project that main knows of; a Browser without one is drawn as neither. */
export const browserLivesList = invokeChannel('browser.lives.list', z.object({ projectId }), browserLives, 'project', 'write')

/** Sent to every screen after a Browser of the Project woke, went to sleep, changed its marks or the window that draws it. */
export const browserLivesChanged = eventChannel('browser.lives.changed', browserLives, 'project', 'write')

/** The user clicked an Asleep frame, or the frame of a Browser main has no life for: it wakes. */
export const browserWake = invokeChannel('browser.wake', z.object({ projectId, nodeId: nodeIdSchema }), z.object({ overLimit: z.boolean() }), 'project', 'write')

/** The picture an Asleep Browser shows (a JPEG, base64), and where its page was scrolled; null while it has none. */
export const browserPicture = invokeChannel(
  'browser.picture',
  z.object({ projectId, nodeId: nodeIdSchema }),
  z.object({ picture: z.object({ image: z.string(), scroll: z.object({ x: z.number(), y: z.number() }) }).nullable() }),
  'project',
  'write',
)

/** A screen starts or stops showing the frames of Live Browser `nodeId`; `screen` tells the windows of one Linked machine apart. */
export const browserFramesWatch = invokeChannel(
  'browser.frames.watch',
  z.object({ projectId, nodeId: nodeIdSchema, screen: screenIdSchema, watch: z.boolean() }),
  z.object({}),
  'project',
  'write',
)

/** A frame of the page of a Live Browser (a JPEG, base64), sent only to the screens that watch it; `width` and `height` — the page's viewport in CSS pixels. */
export const browserFrame = eventChannel(
  'browser.frame',
  z.object({ projectId, nodeId: nodeIdSchema, image: z.string().max(8_000_000), width: z.number().positive(), height: z.number().positive() }),
  'project',
  'write',
)

const modifiers = z.number().int().min(0).max(15)
const point = { x: z.number().finite(), y: z.number().finite() }

/**
 * The user's input in the frames of a Browser, in the page's CSS pixels: a press, a release or a move
 * of the mouse, a scroll, a key down or up (`text` — what a printable key types). main sends it to the
 * page over CDP (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`).
 */
export const browserInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mouse'),
    type: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved']),
    ...point,
    button: z.enum(['none', 'left', 'middle', 'right']),
    clickCount: z.number().int().min(0).max(3),
    modifiers,
  }),
  z.object({ kind: z.literal('wheel'), ...point, deltaX: z.number().finite(), deltaY: z.number().finite(), modifiers }),
  z.object({
    kind: z.literal('key'),
    type: z.enum(['keyDown', 'keyUp']),
    key: z.string().min(1).max(40),
    code: z.string().max(40),
    text: z.string().max(4).optional(),
    keyCode: z.number().int().min(0).max(255),
    modifiers,
  }),
])
export type BrowserInput = z.output<typeof browserInputSchema>

/** The user's input in the frames of Browser `nodeId`, for its page; it takes the Browser over from a Session, as on the page itself. */
export const browserInput = invokeChannel('browser.input', z.object({ projectId, nodeId: nodeIdSchema, input: browserInputSchema }), z.object({}), 'project', 'write')

/** The address bar of a screen that shows frames: the page of Browser `nodeId` goes to `url` (http or https). */
export const browserNavigate = invokeChannel('browser.navigate', z.object({ projectId, nodeId: nodeIdSchema, url: z.string().min(1).max(4000) }), z.object({}), 'project', 'write')

declare module './channels' {
  interface IpcContract {
    'browser.page.live': typeof browserPageLive
    'browser.control.list': typeof browserControlList
    'browser.control.take': typeof browserControlTake
    'browser.control.hold': typeof browserControlHold
    'browser.control.return': typeof browserControlReturn
    'browser.control.changed': typeof browserControlChanged
    'browser.pressing': typeof browserPressing
    'browser.openRequest': typeof browserOpenRequest
    'browser.screen': typeof browserScreen
    'browser.lives.list': typeof browserLivesList
    'browser.lives.changed': typeof browserLivesChanged
    'browser.wake': typeof browserWake
    'browser.picture': typeof browserPicture
    'browser.frames.watch': typeof browserFramesWatch
    'browser.frame': typeof browserFrame
    'browser.input': typeof browserInput
    'browser.navigate': typeof browserNavigate
    'browser.profiles.list': typeof browserProfilesList
    'browser.profiles.create': typeof browserProfilesCreate
    'browser.profiles.update': typeof browserProfilesUpdate
    'browser.profiles.delete': typeof browserProfilesDelete
    'browser.profiles.changed': typeof browserProfilesChanged
  }
}
