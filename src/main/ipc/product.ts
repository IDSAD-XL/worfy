import { join } from 'node:path'
import { productLayout, productTopic } from '../../shared/ipc/product'
import { readProductTopic } from '../docs/watch'
import { layoutChange, updateMindMap } from '../mcp/mind-map-server'
import { projectStore } from '../projects/store'
import { docsHub, docsSource } from './docs'
import { defineHandler, type HandlerModule } from './index'

// The `product` channels (src/shared/ipc/product.ts): the Product Session topics of a Project
// (ADR-0101). `product.changed` is sent by the documents' watcher to the windows that have the
// Project's documents open (src/main/ipc/docs.ts); `product.topic` reads one topic on demand.
// `product.layout` is the screen's one write (ticket 09): a node's place or fold, through the same
// writer as the advisor's tools (updateMindMap of src/main/mcp/mind-map-server.ts) — checked, atomic, one
// write at a time per file, retried on Windows — into the folder `product.topic` reads. The renderer
// never writes a file itself; the watcher reports the change back as `product.changed`.

export default [
  defineHandler(productTopic, async ({ projectId, name }) => {
    // Through the Project's watcher when it runs (main keeps the active Project's open): the read
    // takes its turn among the reads behind `product.changed`, so the answer is not older than an
    // event the window got before it.
    const watched = await docsHub.topic(projectId, name)
    if (watched !== undefined) return { projectId, name, topic: watched }
    const { root, productDir } = await docsSource(projectStore().get(projectId).path)
    if (productDir === undefined) throw new Error(`product.topic: the Product Session folder of ${projectId} is not under its root`)
    return { projectId, name, topic: await readProductTopic(root, productDir, name) }
  }),
  defineHandler(productLayout, async ({ projectId, name, id, x, y, collapsed }) => {
    const { root, productDir } = await docsSource(projectStore().get(projectId).path)
    if (productDir === undefined) throw new Error(`product.layout: the Product Session folder of ${projectId} is not under its root`)
    return updateMindMap(join(root, ...productDir), name, layoutChange(id, { x, y, collapsed }))
  }),
] satisfies HandlerModule
