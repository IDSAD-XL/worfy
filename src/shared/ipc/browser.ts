// The `browser` domain (worfy-browser ticket 11): main tells the window that draws a Browser's page
// (the <webview>'s embedder) that the page asked for a window main did not open by itself — a
// request from a frame of another origin or without a referrer (browserWindowOpenHandler,
// src/main/window.ts). The window's Browser frame offers the address in its Open bar
// (src/renderer/canvas/nodes/BrowserNode.tsx). `local`: the page and its window are on this
// machine's screen, so the event never goes to a Linked machine.
import { z } from 'zod'
import { eventChannel } from './channels'

export const browserOpenRequestSchema = z.object({
  /** The web contents id of the Browser's page; the renderer matches it to its <webview> (getWebContentsId). */
  webContentsId: z.number().int(),
  /** The http(s) address the page asked for. */
  url: z.string().min(1),
})
export type BrowserOpenRequest = z.output<typeof browserOpenRequestSchema>

/** Sent to the window that draws the page, once per refused request. */
export const browserOpenRequest = eventChannel('browser.openRequest', browserOpenRequestSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'browser.openRequest': typeof browserOpenRequest
  }
}
