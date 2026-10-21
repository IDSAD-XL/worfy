// The Browser profiles of each Project (ADR-0078 item 5, worfy-browser ticket 03):
// browser-profiles.json in the Project's data folder on this Machine (ProjectStore.dataDir), never in
// its repository (ADR-0005). A profile is an id, a name, the origins a Session may take it to
// (ticket 04 checks them) and the flag «available to Autopilot» (ticket 08 reads it). Each one has
// its own `persist:` partition, named by its id (src/shared/browser/partition.ts), so renaming one
// keeps its logins, and deleting one erases them.
//
// Only the user creates, changes and deletes a profile, from the window «Browser profiles…» over the
// `browser.profiles.*` channels (src/main/ipc/browser.ts). The partitions a <webview> may attach on
// are read here at every attach (browserProfilePartitions, src/main/index.ts), so a deleted profile's
// partition is refused at once.
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { browserPartition, browserPartitions, DEFAULT_BROWSER_PROFILE } from '../../shared/browser/partition'
import { browserProfilesFileSchema, defaultBrowserProfile, readOrigins, type BrowserProfile } from '../../shared/browser/profiles'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const BROWSER_PROFILES_FILE = 'browser-profiles.json'

export interface BrowserProfileStoreDeps {
  /** The data folder of Project `projectId`; throws for a Project this Machine does not have. */
  dataDirOf: (projectId: string) => string
  /** Erases the storage of `partition`: cookies, logins, caches and site data. */
  clearPartition: (partition: string) => Promise<void>
  /** Six hex digits for a new id; tests pass their own. */
  randomHex?: () => string
}

export interface BrowserProfileInput {
  name: string
  origins?: readonly string[] | undefined
  autopilot?: boolean | undefined
}

export type BrowserProfileChange = Partial<BrowserProfileInput>

/** The part of a new profile's id taken from its name: lowercase letters and digits joined by dashes. */
function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return slug === '' ? 'profile' : slug
}

/** The origins as the user typed them, read as the window reads them (readOrigins); throws naming the first that is not one. */
function originsOf(typed: readonly string[]): string[] {
  const { origins, error } = readOrigins(typed)
  if (error !== undefined) throw new Error(error)
  return origins
}

export class BrowserProfileStore {
  constructor(private readonly deps: BrowserProfileStoreDeps) {}

  /** browser-profiles.json of Project `projectId`. */
  file(projectId: string): string {
    return join(this.deps.dataDirOf(projectId), BROWSER_PROFILES_FILE)
  }

  /** The saved profiles; undefined when the Project has no file yet (or an unreadable one, set aside). */
  private saved(projectId: string): BrowserProfile[] | undefined {
    return readJsonFile(this.file(projectId), browserProfilesFileSchema)?.profiles
  }

  private write(projectId: string, profiles: readonly BrowserProfile[]): void {
    writeJsonFile(this.file(projectId), browserProfilesFileSchema, { profiles: [...profiles] })
  }

  /**
   * The Project's profiles. A Project without a file has "Default" (the owner's decision 5), so the
   * logins made before profiles existed stay with it. Reading writes nothing: `browser.profiles.list`
   * is a read channel, which a read-only Linked machine may call (ADR-0066). The file is written at
   * the first create, change or delete; a list the user emptied stays empty, and Default comes back
   * only with a missing file.
   */
  list(projectId: string): BrowserProfile[] {
    return this.saved(projectId) ?? [defaultBrowserProfile()]
  }

  /** The ids of the Project's profiles, as list() answers: for the attach check. */
  ids(projectId: string): string[] {
    return this.list(projectId).map((profile) => profile.id)
  }

  /** Makes a profile named `name`; its id comes from the name and a random part, so it never takes over a deleted profile's partition. */
  create(projectId: string, input: BrowserProfileInput): BrowserProfile {
    const profiles = this.list(projectId)
    const name = input.name.trim()
    this.refuseTakenName(profiles, name, null)
    const taken = new Set(profiles.map((profile) => profile.id))
    let id: string
    do id = `${slugOf(name)}-${(this.deps.randomHex ?? (() => randomBytes(3).toString('hex')))()}`
    while (taken.has(id) || id === DEFAULT_BROWSER_PROFILE)
    const profile: BrowserProfile = { id, name, origins: originsOf(input.origins ?? []), autopilot: input.autopilot ?? false }
    this.write(projectId, [...profiles, profile])
    return profile
  }

  /** Renames profile `id` or changes its origins or flag; its id, and so its partition, stay. */
  update(projectId: string, id: string, change: BrowserProfileChange): BrowserProfile {
    const profiles = this.list(projectId)
    const current = profiles.find((profile) => profile.id === id)
    if (current === undefined) throw new Error(`no Browser profile ${id} in this Project`)
    const name = change.name === undefined ? current.name : change.name.trim()
    this.refuseTakenName(profiles, name, id)
    const next: BrowserProfile = {
      id,
      name,
      origins: change.origins === undefined ? current.origins : originsOf(change.origins),
      autopilot: change.autopilot ?? current.autopilot,
    }
    this.write(
      projectId,
      profiles.map((profile) => (profile.id === id ? next : profile)),
    )
    return next
  }

  /**
   * Deletes profile `id`: first from the file, so no <webview> attaches on its partition any more,
   * then its partition's storage. Throws when the storage could not be erased; the profile is gone
   * by then.
   */
  async remove(projectId: string, id: string): Promise<void> {
    const profiles = this.list(projectId)
    if (!profiles.some((profile) => profile.id === id)) throw new Error(`no Browser profile ${id} in this Project`)
    const partition = browserPartition(projectId, id)
    this.write(
      projectId,
      profiles.filter((profile) => profile.id !== id),
    )
    if (partition === null) return
    try {
      await this.deps.clearPartition(partition)
    } catch (error) {
      throw new Error(`the Browser profile was deleted, but its cookies and site data could not be erased: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  private refuseTakenName(profiles: readonly BrowserProfile[], name: string, except: string | null): void {
    const lower = name.toLowerCase()
    if (profiles.some((profile) => profile.id !== except && profile.name.toLowerCase() === lower)) {
      throw new Error(`a Browser profile named "${name}" already exists in this Project`)
    }
  }
}

/** How long a page closed before its storage is erased may take to go; after that the storage is erased anyway. */
const CLOSE_PAGE_MS = 2000

/**
 * Erases a partition's storage through Electron's session of it. The <webview> pages still open
 * on it are closed first, so none of them writes a cookie after the erase; the renderer drops their
 * frames once it hears the profile is gone (`browser.profiles.changed`).
 */
async function clearElectronPartition(partition: string): Promise<void> {
  const { session, webContents } = await import('electron')
  const browserSession = session.fromPartition(partition)
  const onIt = (contents: WebContents) =>
    !contents.isDestroyed() && contents.getType() === 'webview' && (contents.session === browserSession || (browserSession.storagePath !== null && contents.session.storagePath === browserSession.storagePath))
  await Promise.all(
    webContents
      .getAllWebContents()
      .filter(onIt)
      .map(
        (contents) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, CLOSE_PAGE_MS)
            contents.once('destroyed', () => {
              clearTimeout(timer)
              resolve()
            })
            contents.close()
          }),
      ),
  )
  await browserSession.clearStorageData()
  await browserSession.clearCache()
  await browserSession.clearAuthCache()
}

let shared: BrowserProfileStore | undefined

/** The store of the running app, over the Projects of this Machine. */
export function browserProfileStore(): BrowserProfileStore {
  shared ??= new BrowserProfileStore({
    dataDirOf: (projectId) => {
      const projects = projectStore()
      return projects.dataDir(projects.get(projectId).id)
    },
    clearPartition: clearElectronPartition,
  })
  return shared
}

/**
 * The partitions a <webview> may attach on: those of the Browser profiles of the Projects
 * `projectIds`. A Project whose profiles cannot be read has none, and the others keep theirs.
 */
export function browserProfilePartitions(projectIds: readonly string[], store: BrowserProfileStore = browserProfileStore()): string[] {
  return browserPartitions(projectIds, (projectId) => {
    try {
      return store.ids(projectId)
    } catch (error) {
      console.error(`[browser] the Browser profiles of ${projectId} could not be read`, error)
      return []
    }
  })
}
