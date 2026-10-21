// Handlers of the `browser` domain's Browser profiles (src/shared/ipc/browser.ts): the store is
// src/main/browser/profiles.ts. Every change is announced to every window, so a frame's header and
// the window «Browser profiles…» follow it, and a deleted profile's Browsers ask for another one.
import { browserProfilesChanged, browserProfilesCreate, browserProfilesDelete, browserProfilesList, browserProfilesUpdate } from '../../shared/ipc/browser'
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
] satisfies HandlerModule
