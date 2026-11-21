import { z } from 'zod'

// The heads of a Ticket's repositories the Changes view has read (worfy-changes-view ticket 09, review round 2): a
// comment not sent yet on the new side, made on one of them, is on lines of this Ticket's work tree, and after the
// agent commits again it is looked for in the new read (line-comments.tsx, onFileRead). The view is mounted anew for
// another Ticket and after a restart, while the comments stay: the heads stay with them.
//
// - Kept like the comments not sent yet and the sent ones (sent-lines.ts): in this window's localStorage, which lives
//   in worfy's data folder (ADR-0005); nothing is written into the repository.
// - SEEN_HEADS_KEPT per Ticket, the newest; an entry that does not read as one reads as none.

const PREFIX = 'worfy.changes-heads:'

/** The heads kept per Ticket, across its repositories. */
export const SEEN_HEADS_KEPT = 100

const entrySchema = z.array(z.string())

/** The key of a Ticket's heads: `<Project>/<epic>/<number>`. */
export const seenHeadsKey = (projectId: string, epic: string, num: number): string => `${projectId}/${epic}/${num}`

/** One head of one repository, as kept. */
const headOf = (repo: string, sha: string): string => `${repo}\u0000${sha}`

const memory = new Map<string, readonly string[]>()

function read(key: string): readonly string[] {
  const kept = memory.get(key)
  if (kept !== undefined) return kept
  let found: readonly string[] = []
  try {
    const parsed = entrySchema.safeParse(JSON.parse(globalThis.localStorage.getItem(PREFIX + key) ?? 'null'))
    if (parsed.success) found = parsed.data
  } catch {
    // Not JSON, or no storage: none read.
  }
  memory.set(key, found)
  return found
}

/** Whether the view of the Ticket has read `sha` as the head of `repo`. */
export function seenHead(key: string, repo: string, sha: string): boolean {
  return read(key).includes(headOf(repo, sha))
}

/** Keeps the heads just read; the oldest past SEEN_HEADS_KEPT go. */
export function addSeenHeads(key: string, heads: readonly { repo: string; sha: string }[]): void {
  const was = read(key)
  const fresh = heads.map(({ repo, sha }) => headOf(repo, sha)).filter((each, index, all) => !was.includes(each) && all.indexOf(each) === index)
  if (fresh.length === 0) return
  const next = [...was, ...fresh].slice(-SEEN_HEADS_KEPT)
  memory.set(key, next)
  try {
    globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(next))
  } catch (error) {
    // Kept in this window while it is open.
    console.error('[changes] could not keep the heads read for a Ticket', error)
  }
}

/** Forgets what memory holds, so the next read is from the storage: for tests, as a restart. */
export function forgetSeenHeadsInMemory(): void {
  memory.clear()
}
