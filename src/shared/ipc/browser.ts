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
import { z } from 'zod'
import { browserProfileIdSchema, browserProfileNameSchema, browserProfileSchema, BROWSER_PROFILE_ORIGINS_MAX } from '../browser/profiles'
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

/** The Browser profiles of the Project; the first read of a Project without any makes «Default». */
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

declare module './channels' {
  interface IpcContract {
    'browser.openRequest': typeof browserOpenRequest
    'browser.profiles.list': typeof browserProfilesList
    'browser.profiles.create': typeof browserProfilesCreate
    'browser.profiles.update': typeof browserProfilesUpdate
    'browser.profiles.delete': typeof browserProfilesDelete
    'browser.profiles.changed': typeof browserProfilesChanged
  }
}
