// The `product` domain: the topics of a Project's Product Session folder (ADR-0101; Epic
// worfy-product-session, ticket 05). Handled in src/main/ipc/product.ts; the changes come from the
// documents' watcher (src/main/docs/watch.ts), so a window gets `product.changed` for the Projects whose
// documents it has open (`docs.open`, src/renderer/docs/useDocs.ts). The one write is `product.layout`
// (ticket 09): where the owner moved a node and which branch they folded, never what a node says.
import { z } from 'zod'
import { mindMapNodeIdSchema, mindMapNodeSchema } from '../product/mind-map'
import { isProductTopicName } from '../product/paths'
import { adviceShareSchema } from '../product/share'
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

/**
 * What the screen changes of mind-map.json by hand: the place of one node (`x` and `y` together) and
 * whether its branch is folded, or — `clearPlaces` alone, «Prettify» (ticket 31) — the places of every
 * node dropped. Strict: any other field — the text, the kind, the status — is refused here; the meaning
 * of a node changes only through the advisor's tools.
 */
export const productLayoutInputSchema = z
  .strictObject({
    projectId: z.string().min(1),
    name: topicName,
    id: mindMapNodeIdSchema.optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    collapsed: z.boolean().optional(),
    clearPlaces: z.literal(true).optional(),
  })
  .refine((input) => (input.x === undefined) === (input.y === undefined), 'x and y go together')
  .refine(
    (input) => (input.clearPlaces === true ? input.id === undefined && input.x === undefined && input.collapsed === undefined : input.id !== undefined),
    'clearPlaces goes alone; any other change names the node by id',
  )
  .refine((input) => input.clearPlaces === true || input.x !== undefined || input.collapsed !== undefined, 'nothing to change: give x and y, or collapsed')
export type ProductLayoutInput = z.output<typeof productLayoutInputSchema>

/** Writes a node's place or fold, or drops every place, through main's one writer of mind-map.json; the screen sees it come back with `product.changed`. */
export const productLayout = invokeChannel('product.layout', productLayoutInputSchema, z.null(), 'project', 'write')

/**
 * The share of accepted advice of the Project (src/shared/product/share.ts; ticket 14), counted from its
 * Product Session folder when asked and stored nowhere; the screen asks again on every `product.changed`.
 */
export const productShare = invokeChannel('product.share', z.object({ projectId: z.string().min(1) }), adviceShareSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'product.topic': typeof productTopic
    'product.changed': typeof productChanged
    'product.layout': typeof productLayout
    'product.share': typeof productShare
  }
}
