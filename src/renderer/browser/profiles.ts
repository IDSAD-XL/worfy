// The Browser profiles of each Project, as this window knows them (worfy-browser ticket 03): read
// from main (`browser.profiles.list`, src/main/browser/profiles.ts) when a Canvas shows Browsers or
// the window «Browser profiles…» is open, and read again on every `browser.profiles.changed`.
// The Browser layer opens each page on its profile's partition from here; the frame shows the
// profile's name and, for a Browser without one, «Choose a profile».
import { useEffect } from 'react'
import { create } from 'zustand'
import type { BrowserProfile } from '../../shared/browser/profiles'
import { invoke, subscribe } from '../ipc'

/** The profiles of each Project read so far, by Project id. */
const useProfiles = create<Record<string, readonly BrowserProfile[]>>(() => ({}))

/** The number of the last read asked for each Project: an older answer that comes late is dropped. */
const reads = new Map<string, number>()

/** Reads the Project's profiles from main again. */
export function reloadBrowserProfiles(projectId: string): void {
  const read = (reads.get(projectId) ?? 0) + 1
  reads.set(projectId, read)
  void invoke('browser.profiles.list', { projectId }).then(
    (result) => {
      if (reads.get(projectId) !== read) return
      if (result.ok) useProfiles.setState({ [projectId]: result.value.profiles })
      else console.error('browser.profiles.list failed:', result.error)
    },
    (error: unknown) => console.error('browser.profiles.list failed:', error),
  )
}

/**
 * The Project's profiles as this window knows them now, without reading them from main: undefined
 * when none was read yet. The Browser layer of the Canvas keeps them current (useBrowserProfiles);
 * «New browser» takes them from here when it makes a Node (../canvas/overlays/create-items.ts).
 */
export function browserProfilesNow(projectId: string): readonly BrowserProfile[] | undefined {
  return useProfiles.getState()[projectId]
}

/** The Project's profiles, kept current while the caller is mounted; undefined until the first answer. */
export function useBrowserProfiles(projectId: string | undefined): readonly BrowserProfile[] | undefined {
  useEffect(() => {
    if (projectId === undefined) return
    reloadBrowserProfiles(projectId)
    try {
      return subscribe('browser.profiles.changed', (change) => {
        if (change.projectId === projectId) reloadBrowserProfiles(projectId)
      })
    } catch (error) {
      // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
      console.error('browser.profiles.changed: cannot subscribe', error)
      return undefined
    }
  }, [projectId])
  return useProfiles((profiles) => (projectId === undefined ? undefined : profiles[projectId]))
}
