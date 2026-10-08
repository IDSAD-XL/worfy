// The camera of each Project's Canvas as this machine's screens left it (worfy-link ticket 06,
// owner's decisions Q2 and Q15). It is not part of the Layout: the Layout is shared by every screen
// of the Project, the camera is the screen's own. It is kept on the machine of the screen, in
// `<worfy data folder>/viewports.json` as `{ [projectId]: Viewport }` (ADR-0005); ticket 09 widens
// the key to a Machine and a Project for the Projects of Linked machines.
//
// One saved camera per Project for all windows of this machine: the window where the Canvas was
// panned last writes it, and a new or reloaded window opens there. A window has no id that lives
// from one start to the next, so a camera kept per window would pile up with nobody to own it. The
// live camera of each window is its own React Flow's and is never sent to another window.
//
// While a Project has no camera of its own, the `viewport` left in its layout.json stands in for
// it, so the first opening after an update shows the Canvas where it was. Writes, like the
// Layout's, wait for a quiet period (LAYOUT_SAVE_DELAY_MS) and happen at once on flush(), which
// the IPC module calls when the app quits. A Project gone from the list loses its entry.
import { join } from 'node:path'
import { z } from 'zod'
import { viewportSchema, type Viewport } from '../../shared/layout/types'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'
import { LAYOUT_SAVE_DELAY_MS, layoutStore } from './store'

export const VIEWPORTS_FILE = 'viewports.json'

/** The content of viewports.json: the saved camera of each Project, by Project id. */
export const viewportsFileSchema = z.record(z.string().min(1), viewportSchema)
export type ViewportsFile = z.output<typeof viewportsFileSchema>

export interface ViewportStoreOptions {
  /** viewports.json. */
  file: string
  /** The ids of the Projects in the list; a camera of any other Project is refused and dropped. */
  projectIds: () => readonly string[]
  /** The camera of a Project that has none of its own: the `viewport` of its layout.json. */
  fallback: (projectId: string) => Viewport
  /** Writes the file; tests pass a recorder. */
  write?: (file: string, viewports: ViewportsFile) => void
  delayMs?: number
}

const writeViewportsFile = (file: string, viewports: ViewportsFile): void => writeJsonFile(file, viewportsFileSchema, viewports)

const sameViewport = (a: Viewport, b: Viewport): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom

export class ViewportStore {
  private loaded: Map<string, Viewport> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private readonly write: (file: string, viewports: ViewportsFile) => void
  private readonly delayMs: number

  /** Does no I/O: the file is read on first use. */
  constructor(private readonly options: ViewportStoreOptions) {
    this.write = options.write ?? writeViewportsFile
    this.delayMs = options.delayMs ?? LAYOUT_SAVE_DELAY_MS
  }

  private data(): Map<string, Viewport> {
    if (this.loaded === undefined) {
      this.loaded = new Map(Object.entries(readJsonFile(this.options.file, viewportsFileSchema) ?? {}))
      // A Project removed while its entry was not yet written (the app did not quit cleanly).
      this.prune()
    }
    return this.loaded
  }

  /** Throws for a Project that is not in the list, as the Layout does. */
  private known(projectId: string): void {
    if (!this.options.projectIds().includes(projectId)) throw new Error(`No Project with id ${projectId}`)
  }

  /** The Project's saved camera, or the `viewport` of its layout.json while it has none. */
  get(projectId: string): Viewport {
    this.known(projectId)
    return this.data().get(projectId) ?? this.options.fallback(projectId)
  }

  /** Saves the Project's camera and schedules the write. A camera outside the schema throws and changes nothing. */
  set(projectId: string, viewport: Viewport): void {
    const parsed = viewportSchema.safeParse(viewport)
    if (!parsed.success) throw new Error(`invalid viewport\n${z.prettifyError(parsed.error)}`)
    this.known(projectId)
    const data = this.data()
    const current = data.get(projectId)
    if (current !== undefined && sameViewport(current, parsed.data)) return
    data.set(projectId, parsed.data)
    this.changed()
  }

  /** Drops the cameras of Projects that are no longer in the list. */
  prune(): void {
    const data = this.loaded
    if (data === undefined) return
    const listed = new Set(this.options.projectIds())
    let removed = false
    for (const projectId of [...data.keys()]) {
      if (listed.has(projectId)) continue
      data.delete(projectId)
      removed = true
    }
    if (removed) this.changed()
  }

  private changed(): void {
    this.dirty = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  /** Writes the file now if it has unsaved changes. A failed write is logged and retried on the next change. */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty || this.loaded === undefined) return
    try {
      this.write(this.options.file, Object.fromEntries(this.loaded))
      this.dirty = false
    } catch (error) {
      console.error('[viewports] could not save the cameras of the Canvas', error)
    }
  }
}

let shared: ViewportStore | undefined

/** The store of the running app, over dataRoot() and the Project list. Creating it does no I/O. */
export function viewportStore(): ViewportStore {
  shared ??= new ViewportStore({
    file: join(dataRoot(), VIEWPORTS_FILE),
    projectIds: () => projectStore().list().map((project) => project.id),
    fallback: (projectId) => layoutStore().get(projectId).layout.viewport,
  })
  return shared
}
