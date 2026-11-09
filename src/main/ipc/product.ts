import { readdir, readFile, realpath } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { productLayout, productShare, productTopic } from '../../shared/ipc/product'
import { CRITIC_DIR, isProductTopicName } from '../../shared/product/paths'
import { adviceShare, type AdviceShare, type ShareReview } from '../../shared/product/share'
import { readProductTopic } from '../docs/watch'
import { layoutChange, placesCleared, updateMindMap } from '../mcp/mind-map-server'
import { projectStore } from '../projects/store'
import { leadsToRemote } from '../remote-links'
import { docsHub, docsSource } from './docs'
import { defineHandler, type HandlerModule } from './index'

// The `product` channels (src/shared/ipc/product.ts): the Product Session topics of a Project
// (ADR-0101). `product.changed` is sent by the documents' watcher to the windows that have the
// Project's documents open (src/main/ipc/docs.ts); `product.topic` reads one topic on demand.
// `product.layout` is the screen's one write (ticket 09): a node's place or fold, or every place dropped
// («Prettify», ticket 31), through the same
// writer as the advisor's tools (updateMindMap of src/main/mcp/mind-map-server.ts) — checked, atomic, one
// write at a time per file, retried on Windows — into the folder `product.topic` reads. The renderer
// never writes a file itself; the watcher reports the change back as `product.changed`.
// `product.share` (ticket 14) counts the share of accepted advice from the same folder each time it is
// asked (src/shared/product/share.ts); nothing of it is kept.

/** The names in `folder`; none when it is not there. Any other error is thrown. */
async function names(folder: string): Promise<string[]> {
  try {
    return await readdir(folder)
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw error
  }
}

/**
 * The critic's reviews, `critic/*.md` of the Product Session folder `dir` (segments under `root`). On
 * Windows a way to that folder through a link to another host is treated as no folder, as
 * readProductTopic treats a topic's: reading it would hand that host the user's credentials.
 */
async function readReviews(root: string, dir: readonly string[]): Promise<ShareReview[]> {
  const folder = nativePath.join(root, ...dir, CRITIC_DIR)
  if (nativePath.sep === '\\') {
    const base = await realpath(root).catch(() => null)
    if (base === null || (await leadsToRemote(folder, [root, base], { paths: nativePath }))) return []
  }
  const reviews: ShareReview[] = []
  for (const file of (await names(folder)).filter((name) => name.endsWith('.md')).sort()) {
    try {
      reviews.push({ file, text: await readFile(nativePath.join(folder, file), 'utf8') })
    } catch (error) {
      reviews.push({ file, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return reviews
}

/** The share of accepted advice of the Product Session folder `dir` (segments under `root`), as its files read now. */
export async function readAdviceShare(root: string, dir: readonly string[]): Promise<AdviceShare> {
  const topics = []
  // `critic` and hidden names are no topic names; a file (README.md) reads as no topic.
  for (const name of (await names(nativePath.join(root, ...dir))).sort()) {
    if (!isProductTopicName(name)) continue
    const topic = await readProductTopic(root, dir, name)
    if (topic !== null) topics.push(topic)
  }
  return adviceShare({ topics, reviews: await readReviews(root, dir) })
}

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
  defineHandler(productLayout, async ({ projectId, name, id, x, y, collapsed, clearPlaces }) => {
    const { root, productDir } = await docsSource(projectStore().get(projectId).path)
    if (productDir === undefined) throw new Error(`product.layout: the Product Session folder of ${projectId} is not under its root`)
    // The schema lets an input without `id` through only with `clearPlaces`.
    const change = clearPlaces === true || id === undefined ? placesCleared() : layoutChange(id, { x, y, collapsed })
    return updateMindMap(nativePath.join(root, ...productDir), name, change)
  }),
  defineHandler(productShare, async ({ projectId }) => {
    const { root, productDir } = await docsSource(projectStore().get(projectId).path)
    if (productDir === undefined) throw new Error(`product.share: the Product Session folder of ${projectId} is not under its root`)
    return readAdviceShare(root, productDir)
  }),
] satisfies HandlerModule
