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

/**
 * The Projects whose last read was answered with their profiles: a Project leaves the set when a
 * read starts and comes back when that read is answered, not when it fails or an older one comes.
 */
const current = new Set<string>()

/** Reads the Project's profiles from main again. */
export function reloadBrowserProfiles(projectId: string): void {
  const read = (reads.get(projectId) ?? 0) + 1
  reads.set(projectId, read)
  current.delete(projectId)
  void invoke('browser.profiles.list', { projectId }).then(
    (result) => {
      if (reads.get(projectId) !== read) return
      if (result.ok) {
        current.add(projectId)
        useProfiles.setState({ [projectId]: result.value.profiles })
      } else console.error('browser.profiles.list failed:', result.error)
    },
    (error: unknown) => console.error('browser.profiles.list failed:', error),
  )
}

/**
 * The Project's profiles as main last answered them, without reading them again: undefined when
 * none was read yet, while a new read is unanswered, or after it failed — the list kept from before
 * may be out of date then (another Project was shown meanwhile, a profile was created elsewhere).
 * The Browser layer of the Canvas keeps them current (useBrowserProfiles); «New browser» takes them
 * from here when it makes a Node (../canvas/overlays/create-items.ts), and with undefined it makes
 * the Node with `profile: null`, which the frame settles once the list is read.
 */
export function browserProfilesNow(projectId: string): readonly BrowserProfile[] | undefined {
  return current.has(projectId) ? useProfiles.getState()[projectId] : undefined
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
