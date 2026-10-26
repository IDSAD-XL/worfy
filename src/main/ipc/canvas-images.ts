// Handlers of the `canvasImage` domain (src/shared/ipc/canvas-images.ts): the images on each
// Project's Canvas, kept in its data folder (src/main/layout/images.ts). When the app starts, the
// image files no Node of a Project's Layout shows any more are deleted (sweepImages).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canvasImageAdd, LINKED_CANVAS_IMAGES } from '../../shared/ipc/canvas-images'
import { layoutSchema, type LayoutNode } from '../../shared/layout/types'
import { LAYOUT_FILE, layoutStore } from '../layout/store'
import { imagesDirOf, storeImage, sweepImages } from '../layout/images'
import { isRemoteCall } from '../link/caller'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

/** The data folder of a Project in the list; throws for any other. */
function dataDirOf(projectId: string): string {
  const projects = projectStore()
  return projects.dataDir(projects.get(projectId).id)
}

/**
 * The Nodes of a Project's Layout, when they can be trusted to name every image it shows: the
 * Layout main holds, or else a layout.json that parses — read here without the Layout store, whose
 * first read would start the automatic archive of every Project at start-up. Null — no layout.json,
 * one that does not parse, or one that was ever set aside as unreadable (storage/json-file.ts): an
 * empty Layout from a broken file must not cost the user every image.
 */
function trustedNodes(projectId: string, dataDir: string): readonly LayoutNode[] | null {
  if (readdirSync(dataDir).some((name) => name.startsWith(`${LAYOUT_FILE}.unreadable-`))) return null
  const held = layoutStore().peek(projectId)
  if (held !== undefined) return held.layout.nodes
  try {
    const parsed = layoutSchema.safeParse(JSON.parse(readFileSync(join(dataDir, LAYOUT_FILE), 'utf8')))
    return parsed.success ? parsed.data.nodes : null
  } catch {
    return null
  }
}

// Start-up sweep, deferred like the trash's purge (src/main/ipc/trash.ts): one Project that
// cannot be swept does not keep the others from it.
setTimeout(() => {
  for (const { id } of projectStore().list()) {
    try {
      const dataDir = dataDirOf(id)
      // A Project that never had an image has nothing to sweep.
      if (!existsSync(imagesDirOf(dataDir))) continue
      const nodes = trustedNodes(id, dataDir)
      const removed = sweepImages(dataDir, nodes ?? [], nodes !== null)
      if (removed.length > 0) console.info(`[images] deleted ${removed.length} image file(s) no Node of ${id} shows`)
    } catch (error) {
      console.error(`[images] could not sweep the images of ${id}`, error)
    }
  }
}, 0)

export default [
  defineHandler(canvasImageAdd, ({ projectId, name, data }, { event }) =>
    // A call through a link comes from a window of the Linked machine, which cannot show the file yet.
    isRemoteCall(event) ? { ok: false, error: LINKED_CANVAS_IMAGES } : storeImage(dataDirOf(projectId), name, data),
  ),
] satisfies HandlerModule
