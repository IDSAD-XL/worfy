// The `docs` domain: the Project's HANDOFF.md and its ADRs (docs/adr/NNNN-*.md), read-only
// (ADR-0002, ADR-0005). Handled in src/main/ipc/docs.ts and watched by src/main/docs/watch.ts
// (ADR-0006). The renderer gets the list and a version of each file from `docs.open` and
// `docs.changed`, and the text from `docs.read`, which refuses every other file.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** The state file at the Project root (CONTEXT.md, «HANDOFF»). */
export const HANDOFF_FILE = 'HANDOFF.md'
/** The folder of the Project's ADRs, relative to its root. */
export const ADR_DIR = 'docs/adr'
/** An ADR file name: four digits, a dash, a slug. */
export const ADR_FILE_PATTERN = /^(\d{4})-[^/]+\.md$/

/** The kind and size of the HANDOFF Node, which main creates (src/main/ipc/docs.ts). */
export const HANDOFF_KIND = 'handoff'
export const HANDOFF_WIDTH = 360
export const HANDOFF_HEIGHT = 320

/** Changes whenever the file's content changes (a hash of it); the renderer reads the text again then. */
const version = z.string().min(1)

export const adrEntrySchema = z.object({
  /** Relative to the Project root, e.g. docs/adr/0002-worfy-is-a-view.md. */
  path: z.string().min(1),
  /** The four digits of the file name. */
  number: z.string().regex(/^\d{4}$/),
  /** The first `# ` heading, or the file name when there is none. */
  title: z.string(),
  /** What follows `Статус:` (or `Status:`), without the final dot; null when the file has none. */
  status: z.string().nullable(),
  version,
})
export type AdrEntry = z.output<typeof adrEntrySchema>

export const docsStateSchema = z.object({
  projectId: z.string().min(1),
  /** Null when the Project has no readable HANDOFF.md. */
  handoff: z.object({ path: z.literal(HANDOFF_FILE), version }).nullable(),
  /** By number. */
  adrs: z.array(adrEntrySchema),
})
export type DocsState = z.output<typeof docsStateSchema>

const project = z.object({ projectId: z.string().min(1) })

/**
 * Reads the Project's documents and starts sending `docs.changed` to the calling window until
 * `docs.close` (or until the window is gone).
 */
export const docsOpen = invokeChannel('docs.open', project, docsStateSchema, 'project', 'read')

/** Stops `docs.changed` for this Project in the calling window. `closed` is false if it was not open. */
export const docsClose = invokeChannel('docs.close', project, z.object({ closed: z.boolean() }), 'project', 'read')

/**
 * The text of HANDOFF.md or of docs/adr/NNNN-*.md. `path` is relative to the Project root or
 * absolute; after symlinks are resolved it must be one of those files of this Project. On Windows
 * a UNC or device path outside the root as written is refused by its text alone, and a path whose
 * links lead to another host is refused before it is resolved (worfy-windows ticket 19). `path` in
 * the answer is the real file, relative to the root.
 */
export const docsRead = invokeChannel(
  'docs.read',
  z.object({ projectId: z.string().min(1), path: z.string().min(1).max(4096) }),
  z.object({ path: z.string(), text: z.string() }),
  'project',
  'read',
)

/** The whole state again, after a change of HANDOFF.md or of an ADR. */
export const docsChanged = eventChannel('docs.changed', docsStateSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'docs.open': typeof docsOpen
    'docs.close': typeof docsClose
    'docs.read': typeof docsRead
    'docs.changed': typeof docsChanged
  }
}
