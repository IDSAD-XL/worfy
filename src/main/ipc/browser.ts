// Handlers of the `browser` domain's Browser profiles (src/shared/ipc/browser.ts): the store is
// src/main/browser/profiles.ts. Every change is announced to every window, so a frame's header and
// the window «Browser profiles…» follow it, and a deleted profile's Browsers ask for another one.
//
// And the Live Browsers a Session drives (src/main/browser/live.ts, worfy-browser ticket 04): the
// page a window draws for a Browser Node is taken only from that window — a guest of a <webview>
// whose embedder is the caller, on the partition of the Browser's profile — so no window hands main
// a page it does not draw, or one that holds the logins of another profile or Project.
//
// And Live and Asleep (worfy-browser ticket 05): what each window shows is kept by the id of its web
// contents until it reports again or closes.
//
// And the other screens (worfy-browser ticket 07): a window of a Linked machine reports what it shows
// under its connection's client and its own screen id, until the connection closes; it watches the
// frames of a Browser, sends its input and its address to the page. Only the window that owns a
// Browser hands main its page (src/main/browser/owner.ts), and each client reads whether it is that
// window (`here`). A read-only Linked machine reaches none of these: they are `write`.
import { session, webContents, type WebContents } from 'electron'
import {
  browserControlHold,
  browserControlList,
  browserLivesList,
  browserPicture,
  browserScreen,
  browserWake,
  browserControlReturn,
  browserControlTake,
  browserFramesWatch,
  browserInput,
  browserNavigate,
  browserPageLive,
  browserProfilesChanged,
  browserProfilesCreate,
  browserProfilesDelete,
  browserProfilesList,
  browserProfilesUpdate,
} from '../../shared/ipc/browser'
import { browserPartitions } from '../../shared/browser/partition'
import { BROWSER_KIND } from '../../shared/browser/tools'
import { ControlError, liveBrowsers, NOT_SHOWN, screenKey } from '../browser/live'
import { webAddress } from '../browser/origins'
import { browserProfileStore } from '../browser/profiles'
import { browserScreencasts } from '../browser/screencast'
import { clientOf, isWindowId, onNewDocument, type Client, type ClientId, type NavigatingClient } from '../clients'
import { toEveryWindow } from '../broadcast'
import { layoutStore } from '../layout/store'
import { defineHandler, emit, type HandlerModule } from './index'

/** The windows and the Linked machines' clients whose closing main already listens for. */
const screens = new Set<ClientId>()

/** The client of a call; a call without one is refused. */
function callerOf(event: { sender?: unknown }): Client {
  const client = clientOf(event)
  if (client === undefined) throw new Error('the call has no sender')
  return client
}

/** The address of `url` when it is an http or https address the page may go to; throws otherwise. */
function webUrl(url: string): string {
  const parsed = webAddress(url)
  if (parsed === null) throw new Error('only an http or https address opens in a Browser')
  return parsed.href
}

/**
 * Whether `guest` is on a partition the page of Browser `nodeId` of Project `projectId` opens on: that
 * of the Browser profile its Node names, or — while the Node names none yet, and the frame opens it
 * under the one the rule picks (browserProfileChoice) before it writes it — that of any profile of
 * the Project. A page on another partition holds the logins of another profile or Project, and a
 * Session driving it would act under them.
 */
function onBrowserPartition(projectId: string, nodeId: string, guest: WebContents): boolean {
  const node = layoutStore().get(projectId).layout.nodes.find((each) => each.id === nodeId)
  if (node === undefined || node.kind !== BROWSER_KIND) return false
  const named = node.data.profile
  const profileIds = typeof named === 'string' ? [named] : browserProfileStore().list(projectId).map((profile) => profile.id)
  // Electron answers the same Session object for a partition every time.
  return browserPartitions([projectId], () => profileIds).some((partition) => guest.session === session.fromPartition(partition))
}

function changed(projectId: string): void {
  toEveryWindow((client) => emit(client, browserProfilesChanged, { projectId }))
}

export default [
  defineHandler(browserProfilesList, ({ projectId }) => ({ profiles: browserProfileStore().list(projectId) })),
  defineHandler(browserProfilesCreate, ({ projectId, name, origins, autopilot, signIn }) => {
    const profile = browserProfileStore().create(projectId, { name, origins, autopilot, signIn })
    changed(projectId)
    return profile
  }),
  defineHandler(browserProfilesUpdate, ({ projectId, id, name, origins, autopilot, signIn }) => {
    const profile = browserProfileStore().update(projectId, id, { name, origins, autopilot, signIn })
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
    if (!onBrowserPartition(projectId, nodeId, guest)) return { live: false }
    return { live: liveBrowsers().register(projectId, nodeId, guest, host.id) !== null }
  }),
  defineHandler(browserScreen, async ({ projectId, visible, zoom, screen }, { event }) => {
    const client = callerOf(event)
    const id = client.id
    if (!screens.has(id)) {
      screens.add(id)
      client.once('destroyed', () => {
        screens.delete(id)
        if (isWindowId(id)) liveBrowsers().dropScreen(id)
        else liveBrowsers().dropScreensOf(id)
      })
      // A reload of the window (or its move to a Linked machine's Project, whose reports go to that
      // machine) leaves the webContents: what it showed is stale, and the pages it owned go to
      // another window until its new document reports. The listener stays for the client's life.
      if (isWindowId(id)) onNewDocument(client as NavigatingClient, () => liveBrowsers().dropScreen(id))
    }
    await liveBrowsers().screen(screenKey(id, screen), { projectId, visible, zoom })
    return {}
  }),
  defineHandler(browserLivesList, ({ projectId }, { event }) => ({ projectId, lives: liveBrowsers().lives(projectId, callerOf(event).id) })),
  defineHandler(browserWake, ({ projectId, nodeId }, { event }) => {
    // From a Linked machine: only a window of this Machine can draw the page it wakes.
    if (!isWindowId(callerOf(event).id) && !liveBrowsers().shownHere(projectId)) throw new ControlError(NOT_SHOWN)
    return liveBrowsers().wake(projectId, nodeId, 'user')
  }),
  defineHandler(browserFramesWatch, async ({ projectId, nodeId, screen, watch }, { event }) => {
    await browserScreencasts().watch(callerOf(event), screen, projectId, nodeId, watch)
    return {}
  }),
  defineHandler(browserInput, async ({ projectId, nodeId, input }, { event }) => {
    await liveBrowsers().input(projectId, nodeId, input, callerOf(event).id)
    return {}
  }),
  defineHandler(browserNavigate, async ({ projectId, nodeId, url }, { event }) => {
    await liveBrowsers().navigate(projectId, nodeId, webUrl(url), callerOf(event).id)
    return {}
  }),
  defineHandler(browserPicture, ({ projectId, nodeId }) => ({ picture: liveBrowsers().pictureOf(projectId, nodeId) })),
  defineHandler(browserControlList, ({ projectId }) => ({ controls: liveBrowsers().controlsOf(projectId) })),
  defineHandler(browserControlTake, ({ projectId, nodeId }) => ({ taken: liveBrowsers().takeOver(projectId, nodeId) })),
  // A window or a Linked machine names the Session: refused unless it is the one that opened the
  // Browser (`openedBy`), so no screen can lock a Session out of a Browser it never had.
  defineHandler(browserControlHold, ({ projectId, nodeId, sessionId }) => {
    const node = layoutStore().get(projectId).layout.nodes.find((each) => each.id === nodeId)
    return { held: node?.data.openedBy === sessionId && liveBrowsers().holdForUser(projectId, nodeId, sessionId) }
  }),
  defineHandler(browserControlReturn, ({ projectId, nodeId }) => ({ returned: liveBrowsers().giveBack(projectId, nodeId) })),
] satisfies HandlerModule
