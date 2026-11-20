import { useSyncExternalStore } from 'react'
import { z } from 'zod'

// The comments on lines that went to a Session (worfy-changes-view ticket 05): they stay dim on their lines in the
// Changes Node (the spec's walk through the screen, step 8). The Session's own store keeps no sent comment on code
// (quote-store.ts: its block in the bubble is read from the message), so the Node keeps its own short list, per Ticket.
//
// - Kept like the comments not sent yet: in this window's localStorage, which lives in worfy's data folder (ADR-0005),
//   so they stay dim after a restart; nothing is written into the repository.
// - SENT_LINES_KEPT per Ticket, the newest; an entry that does not read as one reads as none.

const PREFIX = 'worfy.changes-sent:'

/** The sent comments kept per Ticket. */
export const SENT_LINES_KEPT = 200

const sentSchema = z.object({
  id: z.string(),
  repository: z.string(),
  path: z.string().min(1),
  side: z.enum(['old', 'new']),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
  images: z.number().int().nonnegative(),
  /** Whom it went to, as the list «To» named the Session. */
  to: z.string(),
  at: z.number(),
})
export type SentLine = z.infer<typeof sentSchema>

const entrySchema = z.array(z.unknown())

/** The key of a Ticket's sent comments: `<Project>/<epic>/<number>`. */
export const sentLinesKey = (projectId: string, epic: string, num: number): string => `${projectId}/${epic}/${num}`

const EMPTY: readonly SentLine[] = []
const memory = new Map<string, readonly SentLine[]>()
const listeners = new Set<() => void>()

function read(key: string): readonly SentLine[] {
  const kept = memory.get(key)
  if (kept !== undefined) return kept
  let found: readonly SentLine[] = EMPTY
  try {
    const parsed = entrySchema.safeParse(JSON.parse(globalThis.localStorage.getItem(PREFIX + key) ?? 'null'))
    if (parsed.success) found = parsed.data.flatMap((each) => {
      const one = sentSchema.safeParse(each)
      return one.success ? [one.data] : []
    })
  } catch {
    // Not JSON, or no storage: none sent.
  }
  memory.set(key, found)
  return found
}

/** The Ticket's sent comments, oldest first. */
export function readSentLines(key: string): readonly SentLine[] {
  return read(key)
}

/** Adds comments that went; the oldest past SENT_LINES_KEPT go. */
export function addSentLines(key: string, sent: readonly SentLine[]): void {
  if (sent.length === 0) return
  const ids = new Set(sent.map((each) => each.id))
  const next = [...read(key).filter((each) => !ids.has(each.id)), ...sent].slice(-SENT_LINES_KEPT)
  memory.set(key, next)
  try {
    globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(next))
  } catch (error) {
    // Kept in this window while it is open; the comments themselves went.
    console.error('[changes] could not keep the sent comments of a Ticket', error)
  }
  for (const listener of [...listeners]) listener()
}

/** Forgets what memory holds, so the next read is from the storage: for tests, as a restart. */
export function forgetSentLinesInMemory(): void {
  memory.clear()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The Ticket's sent comments, kept up to date. */
export function useSentLines(key: string): readonly SentLine[] {
  return useSyncExternalStore(subscribe, () => read(key), () => EMPTY)
}
