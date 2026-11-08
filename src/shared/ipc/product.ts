// The `product` domain: the topics of a Project's Product Session folder (ADR-0101; Epic
// worfy-product-session, ticket 05), read-only. Handled in src/main/ipc/product.ts; the changes come
// from the documents' watcher (src/main/docs/watch.ts), so a window gets `product.changed` for the
// Projects whose documents it has open (`docs.open`, src/renderer/docs/useDocs.ts).
import { z } from 'zod'
import { mindMapNodeSchema } from '../product/mind-map'
import { isProductTopicName } from '../product/paths'
import { eventChannel, invokeChannel } from './channels'

const topicName = z.string().refine(isProductTopicName, 'not a Product Session topic name')

/** One topic as src/main/product/topic.ts readTopic reads it: errors are part of the state. */
export const productTopicSchema = z.object({
  name: z.string().min(1),
  folder: z.string().min(1),
  title: z.string().nullable(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  tickets: z.array(
    z.object({
      number: z.number().int().nonnegative(),
      slug: z.string(),
      file: z.string(),
      title: z.string().nullable(),
      status: z.enum(['open', 'claimed', 'blocked', 'done', 'none']),
    }),
  ),
  nodes: z.array(mindMapNodeSchema),
  errors: z.array(z.object({ file: z.string(), id: z.string().nullable(), message: z.string() })),
})
export type ProductTopicState = z.output<typeof productTopicSchema>

/** A topic and its state now; `topic` is null when its folder is not there (removed, renamed away, never made). */
export const productTopicChangeSchema = z.object({
  projectId: z.string().min(1),
  name: topicName,
  topic: productTopicSchema.nullable(),
})
export type ProductTopicChange = z.output<typeof productTopicChangeSchema>

/** Reads one topic of the Project now; the answer is ordered with `product.changed` of the same topic. */
export const productTopic = invokeChannel('product.topic', z.object({ projectId: z.string().min(1), name: topicName }), productTopicChangeSchema, 'project', 'read')

/** A file of a topic changed (a tool, an agent or a hand edit): the topic as it reads after the change. */
export const productChanged = eventChannel('product.changed', productTopicChangeSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'product.topic': typeof productTopic
    'product.changed': typeof productChanged
  }
}
