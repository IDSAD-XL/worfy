// The decisions the owner sent from the Acceptance view that no `owner-check` line records yet (worfy-acceptance
// ticket 01; spec, ""Sent" — sent, but not recorded yet"): `<Project data folder>/acceptance-sent.json`, next to
// pr-inbox.json (src/main/projects/pr-inbox-state.ts), in worfy's own data folder (ADR-0005). Per decision: the
// Project, the Epic, the Ticket's number, the item's number and a hash of its text, the verdict and when it was sent.
// Never the owner's words and never the item's text. A restart keeps them; the service drops one once the Ticket file
// in the checkout has a new `owner-check` line with the same verdict (src/main/acceptance/service.ts).
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const ACCEPTANCE_SENT_FILE = 'acceptance-sent.json'

export const sentDecisionSchema = z.object({
  projectId: z.string().min(1),
  epic: z.string().min(1),
  num: z.number().int().nonnegative(),
  /** The item's number in its done section, from 1. */
  item: z.number().int().positive(),
  /** itemTextHash of the item's text when it was sent: a rewritten item is no longer the one decided. */
  textHash: z.string().min(1),
  verdict: z.enum(['pass', 'fail']),
  /** When it was sent (ISO). */
  at: z.iso.datetime(),
  /** The `owner-check` lines with this verdict the item had then: the decision is recorded once it has more. */
  lines: z.number().int().nonnegative(),
})
export type SentDecision = z.infer<typeof sentDecisionSchema>

const sentFileSchema = z.object({ sent: z.array(sentDecisionSchema) })

export function sentPath(projectDataDir: string): string {
  return join(projectDataDir, ACCEPTANCE_SENT_FILE)
}

/** A short hash of an item's text: it tells the item decided from a rewritten one without keeping the text. */
export function itemTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** The decisions kept for the Project; none when there is no file yet (an unreadable one is set aside by readJsonFile). */
export function readSentDecisions(projectDataDir: string): SentDecision[] {
  return readJsonFile(sentPath(projectDataDir), sentFileSchema)?.sent ?? []
}

/** Writes the Project's decisions as a whole. */
export function writeSentDecisions(projectDataDir: string, sent: readonly SentDecision[]): void {
  writeJsonFile(sentPath(projectDataDir), sentFileSchema, { sent: [...sent] })
}
