// Handlers of the `browser` domain's Browser profiles (src/shared/ipc/browser.ts): the store is
// src/main/browser/profiles.ts. Every change is announced to every window, so a frame's header and
// the window «Browser profiles…» follow it, and a deleted profile's Browsers ask for another one.
//
// And the Live Browsers a Session drives (src/main/browser/live.ts, worfy-browser ticket 04): the
// page a window draws for a Browser Node is taken only from that window — a guest of a <webview>
// whose embedder is the caller — so no window hands main a page it does not draw.
import { webContents, type WebContents } from 'electron'
import {
  browserControlList,
  browserControlReturn,
  browserControlTake,
  browserPageLive,
  browserProfilesChanged,
  browserProfilesCreate,
  browserProfilesDelete,
  browserProfilesList,
  browserProfilesUpdate,
} from '../../shared/ipc/browser'
import { liveBrowsers } from '../browser/live'
import { browserProfileStore } from '../browser/profiles'
import { toEveryWindow } from '../broadcast'
import { defineHandler, emit, type HandlerModule } from './index'

function changed(projectId: string): void {
  toEveryWindow((client) => emit(client, browserProfilesChanged, { projectId }))
}

export default [
  defineHandler(browserProfilesList, ({ projectId }) => ({ profiles: browserProfileStore().list(projectId) })),
  defineHandler(browserProfilesCreate, ({ projectId, name, origins, autopilot }) => {
    const profile = browserProfileStore().create(projectId, { name, origins, autopilot })
    changed(projectId)
    return profile
  }),
  defineHandler(browserProfilesUpdate, ({ projectId, id, name, origins, autopilot }) => {
    const profile = browserProfileStore().update(projectId, id, { name, origins, autopilot })
    changed(projectId)
    return profile
  }),
  defineHandler(browserProfilesDelete, async ({ projectId, id }) => {
    try {
      await browserProfileStore().remove(projectId, id)
    } finally {
      // Also when the storage could not be erased: the profile is gone from the list by then.
      changed(projectId)
    }
    return { id }
  }),
  defineHandler(browserPageLive, ({ projectId, nodeId, webContentsId }, { event }) => {
    const guest = webContents.fromId(webContentsId)
    // Electron's types say a WebContents, but a guest whose embedder has gone has none.
    const host = guest?.hostWebContents as WebContents | null | undefined
    if (guest === undefined || guest.isDestroyed() || guest.getType() !== 'webview' || host !== event.sender) return { live: false }
    liveBrowsers().register(projectId, nodeId, guest)
    return { live: true }
  }),
  defineHandler(browserControlList, ({ projectId }) => ({ controls: liveBrowsers().controlsOf(projectId) })),
  defineHandler(browserControlTake, ({ projectId, nodeId }) => ({ taken: liveBrowsers().takeOver(projectId, nodeId) })),
  defineHandler(browserControlReturn, ({ projectId, nodeId }) => ({ returned: liveBrowsers().giveBack(projectId, nodeId) })),
] satisfies HandlerModule
