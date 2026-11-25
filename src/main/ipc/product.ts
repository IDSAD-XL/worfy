import * as nativePath from 'node:path'
import { productLayout, productShare, productTopic } from '../../shared/ipc/product'
import { CRITIC_DIR, isProductTopicName } from '../../shared/product/paths'
import { adviceShare, type AdviceShare, type ShareReview } from '../../shared/product/share'
import { readProductTopic } from '../docs/watch'
import { layoutChange, placesCleared, updateMindMap } from '../mcp/mind-map-server'
import { linkRefusal, nodeProductFs, projectFolders, type ProductFs, type ProductReadOptions } from '../product/topic'
import { projectStore } from '../projects/store'
import { cachedLinks, type LinkFs, type PathRules } from '../remote-links'
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
async function names(fs: ProductFs, folder: string): Promise<string[]> {
  try {
    return (await fs.readdir(folder)).map((entry) => entry.name)
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw error
  }
}

/** The calls of one share read, with one answer per link for all its walks. */
interface ShareRead {
  paths: PathRules
  fs: ProductFs
  links: LinkFs
}

/**
 * The critic's reviews, `critic/*.md` of the Product Session folder `dir` (segments under `root`). On
 * Windows a way to that folder through a link to another host is treated as no folder, as
 * readProductTopic treats a topic's: reading it would hand that host the user's credentials. A review
 * whose own way leads there is not read and is named instead (worfy-polish ticket 146).
 */
async function readReviews(root: string, dir: readonly string[], read: ShareRead): Promise<ShareReview[]> {
  const { paths, fs, links } = read
  const folder = paths.join(root, ...dir, CRITIC_DIR)
  const allowed = await projectFolders(root, read)
  if (allowed === null || (await linkRefusal(folder, allowed, { paths, links })) !== null) return []
  const reviews: ShareReview[] = []
  for (const file of (await names(fs, folder)).filter((name) => name.endsWith('.md')).sort()) {
    const path = paths.join(folder, file)
    const refused = await linkRefusal(path, allowed, { paths, links })
    if (refused !== null) {
      reviews.push({ file, error: refused })
      continue
    }
    try {
      reviews.push({ file, text: await fs.readFile(path) })
    } catch (error) {
      reviews.push({ file, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return reviews
}

/**
 * The share of accepted advice of the Product Session folder `dir` (segments under `root`), as its files
 * read now. On Windows a folder whose way leads to another host through a link is not listed: the share
 * has no advice then (worfy-polish ticket 146).
 */
export async function readAdviceShare(root: string, dir: readonly string[], options: ProductReadOptions = {}): Promise<AdviceShare> {
  const read: ShareRead = { paths: options.paths ?? nativePath, fs: options.fs ?? nodeProductFs, links: cachedLinks(options.links) }
  const folder = read.paths.join(root, ...dir)
  const allowed = await projectFolders(root, read)
  if (allowed === null || (await linkRefusal(folder, allowed, read)) !== null) return adviceShare({ topics: [], reviews: [] })
  const topics = []
  // `critic` and hidden names are no topic names; a file (README.md) reads as no topic.
  for (const name of (await names(read.fs, folder)).sort()) {
    if (!isProductTopicName(name)) continue
    const topic = await readProductTopic(root, dir, name, read)
    if (topic !== null) topics.push(topic)
  }
  return adviceShare({ topics, reviews: await readReviews(root, dir, read) })
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
    return updateMindMap(nativePath.join(root, ...productDir), name, change, root)
  }),
  defineHandler(productShare, async ({ projectId }) => {
    const { root, productDir } = await docsSource(projectStore().get(projectId).path)
    if (productDir === undefined) throw new Error(`product.share: the Product Session folder of ${projectId} is not under its root`)
    return readAdviceShare(root, productDir)
  }),
] satisfies HandlerModule
