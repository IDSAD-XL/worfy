import { productTopic } from '../../shared/ipc/product'
import { readProductTopic } from '../docs/watch'
import { projectStore } from '../projects/store'
import { docsHub, docsSource } from './docs'
import { defineHandler, type HandlerModule } from './index'

// The `product` channels (src/shared/ipc/product.ts): the Product Session topics of a Project
// (ADR-0101), read-only. `product.changed` is sent by the documents' watcher to the windows that have
// the Project's documents open (src/main/ipc/docs.ts); `product.topic` reads one topic on demand.

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
] satisfies HandlerModule
