// What waits on the Linked machine (worfy-assistant ticket 18; spec, two machines; boundary 5; stories 1 and 33;
// ADR-0066). Each Machine has its own Assistant, which keeps the items of its own Projects and acts only there. A Linked
// machine reads them over the `project` channel `assistant.waiting`, marked `read` (src/shared/ipc/assistant.ts): the
// Projects of the Machine and the items its section shows now, as words and times only — no prepared text, no proposal,
// no target to open, no rating — so the reading side has nothing to act with. The reading side shows them beside its own,
// read-only, and gives them to its Assistant as data (src/main/mcp/app-server.ts, items_list).
import { z } from 'zod'
import type { WindowItem } from './window'

/** The most items one answer carries: the first of the section, urgent first. */
export const LINKED_ITEMS_MAX = 200
/** The most characters of an item's line in an answer. */
export const LINKED_TITLE_MAX = 2_000

const text = (max: number) => z.string().max(max)

/** An item of the Linked machine, as its section shows it there. */
export const linkedItemSchema = z.object({
  /** The id the Linked machine's core knows it by: this Machine keeps it only to tell items apart. */
  id: z.string().min(1).max(1_000),
  title: text(LINKED_TITLE_MAX),
  /** Its source (`session`, `slack`…): a string, so a source a newer build adds does not void the whole answer. */
  source: z.string().min(1).max(100),
  sourceLabel: text(200),
  /** What the item is about, in words: its id stays on its Machine (a message's is a source's text). */
  subject: z.object({ kind: z.string().min(1).max(100), label: text(2_000) }),
  kind: z.string().min(1).max(200),
  projectId: z.string().max(200).nullable(),
  projectName: text(500).nullable(),
  /** The title of the duty that raised it there. */
  duty: text(500).nullable(),
  urgent: z.boolean(),
  startedAt: z.number(),
  lastAt: z.number(),
  /** Written by another person: who, when and where, as on its Machine. */
  outside: z.object({ author: text(500), at: text(100), url: text(2_000) }).nullable(),
})
export type LinkedItem = z.output<typeof linkedItemSchema>

const projectSchema = z.object({ id: z.string().min(1).max(200), name: text(500) })

/** The answer of `assistant.waiting`: the Projects of the Machine and what waits in them. */
export const linkedWaitsSchema = z.object({ projects: z.array(projectSchema).max(500), items: z.array(linkedItemSchema).max(LINKED_ITEMS_MAX) })
export type LinkedWaits = z.output<typeof linkedWaitsSchema>

/** A Linked machine in this Machine's section: what it answered last, or why it answered nothing. */
export const linkedMachineWaitsSchema = z.object({
  id: z.string(),
  name: z.string(),
  online: z.boolean(),
  projects: z.array(projectSchema),
  items: z.array(linkedItemSchema),
  /** Why there is nothing from it: offline, access off, an older build, an answer outside the contract; null when it answered. */
  problem: z.string().nullable(),
})
export type LinkedMachineWaits = z.output<typeof linkedMachineWaitsSchema>

const cut = (value: string, max: number): string => value.slice(0, max)

/**
 * An item of this Machine's section as a Linked machine reads it: words and times, nothing to act with. Long text is cut
 * to the schema's bounds, so one long line never voids the answer.
 */
export function linkedItemOf(item: WindowItem): LinkedItem {
  return {
    id: item.id,
    title: cut(item.title, LINKED_TITLE_MAX),
    source: item.source,
    sourceLabel: cut(item.sourceLabel, 200),
    subject: { kind: item.subject.kind, label: cut(item.subject.label, 2_000) },
    kind: item.kind,
    projectId: item.projectId,
    projectName: item.projectName === null ? null : cut(item.projectName, 500),
    duty: item.duty === null ? null : cut(item.duty.title, 500),
    urgent: item.urgent,
    startedAt: item.startedAt,
    lastAt: item.lastAt,
    outside: item.outside === null ? null : { author: cut(item.outside.author, 500), at: cut(item.outside.at, 100), url: cut(item.outside.url, 2_000) },
  }
}
