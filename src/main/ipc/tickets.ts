import { readdir, readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { ticketsRead } from '../../shared/ipc/tickets'
import { DOC_SIZE_MAX } from '../docs/watch'
import { projectStore } from '../projects/store'
import type { PathRules } from '../remote-links'
import { layoutFailure, projectLayouts, type ProjectLayout } from '../workflow/folder'
import { issueKey } from '../workflow/reader'
import { defineHandler, type HandlerModule } from './index'
import { resolveProjectFile, type ResolveOptions } from './shell'

// The `tickets` channel (src/shared/ipc/tickets.ts): the text of one Ticket file for the focused
// Ticket. The file is looked up where the workflow reader looks (enrichSnapshot of
// src/main/workflow/reader.ts): `<epic>/issues/` of the layout's Tickets root, the entry whose
// number and slug are the Ticket's. Both the folder and the file go through resolveProjectFile, the
// guard of `shell.openInEditor`, with the Tickets root and the Workflow folder as the places besides
// the Project root: a link out of them, `..`, and on Windows a way to a share are refused before
// anything is read.

/** The largest Ticket file read: the limit of the documents (src/main/docs/watch.ts). */
export const TICKET_SIZE_MAX = DOC_SIZE_MAX

export interface TicketRef {
  epic: string
  num: number
  slug: string
}

export interface TicketReadOptions extends ResolveOptions {
  /** The names in a folder; replaced in tests. */
  readdir?: (dir: string) => Promise<string[]>
}

/** Reads the Ticket's file under the Project's layout; throws with the reason when it cannot. */
export async function readTicketFile(layout: ProjectLayout, ref: TicketRef, options: TicketReadOptions = {}): Promise<{ path: string; text: string }> {
  // Where the Tickets live is unknown: the reason, not a guess (src/main/workflow/folder.ts).
  if (layout.failed) throw new Error(layoutFailure(layout))
  const paths: PathRules = options.paths ?? nativePath
  const places = [layout.ticketsRoot, layout.workflowFolder]
  const name = `${String(ref.num).padStart(2, '0')}-${ref.slug}.md`
  const dir = await resolveProjectFile(layout.root, paths.join(layout.ticketsRoot, ref.epic, 'issues'), places, options).catch((error: unknown) => {
    throw new Error(`the Ticket folder of ${ref.epic} cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  })
  const entries = await (options.readdir ?? ((folder: string) => readdir(folder)))(dir)
  const key = `${ref.num}:${ref.slug}`
  const entry = entries.find((candidate) => issueKey(candidate) === key)
  if (entry === undefined) throw new Error(`${ref.epic}/issues/${name} does not exist`)
  const file = await resolveProjectFile(layout.root, paths.join(dir, entry), places, options)
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`${ref.epic}/issues/${entry} is not a file`)
  if (info.size > TICKET_SIZE_MAX) throw new Error(`${ref.epic}/issues/${entry} is larger than ${TICKET_SIZE_MAX} bytes`)
  return { path: file, text: await readFile(file, 'utf8') }
}

export default [
  defineHandler(ticketsRead, async ({ projectId, epic, num, slug }) => {
    const root = projectStore().get(projectId).path
    return readTicketFile(await projectLayouts().get(root), { epic, num, slug })
  }),
] satisfies HandlerModule
