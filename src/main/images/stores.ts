// The stores of the worfy-image:// protocol in the app (src/shared/images.ts): the copies of sent
// images (worfy-ui ticket 28), the images on each Project's Canvas (worfy-canvas ticket 23,
// src/main/layout/images.ts) and the Evidence files of each Project's Tickets (worfy-evidence ticket
// 12). This Machine's window gets all three (appImageStore, for installImageProtocol and images.status);
// a Linked machine that asks for an image over the link (`images.file`, src/main/ipc/images.ts) gets
// the first two only (appSharedImageStore): the Evidence of a Linked machine is not shown.
import { EVIDENCE_FILE_LIMIT_BYTES, EVIDENCE_FILE_PATTERN, EVIDENCE_IMAGES_STORE, evidenceImagesStore, ATTACHMENT_IMAGES_STORE } from '../../shared/images'
import { attachmentImagesDir } from '../agent/attachments'
import { workflowPlaces, type PlaceOptions } from '../ipc/shell'
import { canvasImageStore } from '../layout/images'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import { projectLayouts, type ProjectLayout } from '../workflow/folder'
import { attachmentImageStore, type ImageStore, type ImageStoreLocator } from './protocol'

/** The stores a store name names on this Machine that a Linked machine may ask for, or null. */
export const appSharedImageStore = (store: string): ImageStore | null =>
  store === ATTACHMENT_IMAGES_STORE
    ? attachmentImageStore(attachmentImagesDir(dataRoot()))
    : canvasImageStore(store, { ids: () => projectStore().list().map(({ id }) => id), dataDirOf: (id) => projectStore().dataDir(id) })

/** The Projects evidenceImageStore() looks through: the ids in worfy's list, their roots and their layouts. */
export interface EvidenceProjects {
  ids: () => readonly string[]
  rootOf: (projectId: string) => string
  /** Where the Project's workflow lives (src/main/workflow/folder.ts); may reject. */
  layoutOf: (root: string) => Promise<ProjectLayout>
  /** The checks of workflowPlaces (src/main/ipc/shell.ts); replaced in tests. */
  places?: PlaceOptions
}

/**
 * The store a store name of the worfy-image:// protocol names when it is `evidence-<project label>` of
 * exactly one Project in the list: that Project's Tickets root, the Workflow folder's in Silent mode.
 * It serves the names of EVIDENCE_FILE_PATTERN, `<epic>/evidence/…`, clips too, up to 8 MB. Null for any
 * other name, for a layout that could not be read (where the Tickets live is unknown), and for a Tickets
 * root that workflowPlaces leaves out (the root of a disk, a folder that holds the home folder, one that
 * does not exist), as `tickets.read` does.
 */
export async function evidenceImageStore(store: string, projects: EvidenceProjects): Promise<ImageStore | null> {
  const matches = projects.ids().filter((id) => evidenceImagesStore(id) === store)
  if (matches.length !== 1) return null
  const layout = await projects.layoutOf(projects.rootOf(matches[0]!))
  // workflowPlaces gives no place at all for a layout that failed.
  if (!(await workflowPlaces(layout, projects.places)).includes(layout.ticketsRoot)) return null
  return { dir: layout.ticketsRoot, names: EVIDENCE_FILE_PATTERN, limit: EVIDENCE_FILE_LIMIT_BYTES, nested: true, media: true }
}

const appProjects: EvidenceProjects = {
  ids: () => projectStore().list().map(({ id }) => id),
  rootOf: (id) => projectStore().get(id).path,
  layoutOf: (root) => projectLayouts().get(root),
}

/** The store a store name names on this Machine, for its own window: the shared stores and the Evidence of each Project. */
export const appImageStore: ImageStoreLocator = (store) => (store.startsWith(`${EVIDENCE_IMAGES_STORE}-`) ? evidenceImageStore(store, appProjects) : appSharedImageStore(store))
