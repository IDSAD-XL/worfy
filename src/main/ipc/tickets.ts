import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { ticketsRead } from '../../shared/ipc/tickets'
import { DOC_SIZE_MAX } from '../docs/watch'
import { projectStore } from '../projects/store'
import { isInside, type PathRules } from '../remote-links'
import { layoutFailure, projectLayouts, type ProjectLayout } from '../workflow/folder'
import { refTree, resolveSource, type MainRef, type RefGitRunner } from '../workflow/main-ref'
import { issueKey } from '../workflow/reader'
import { defineHandler, type HandlerModule } from './index'
import { resolveProjectFile, workflowPlaces, type ResolveOptions } from './shell'

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
  /** The user's home folder, never a place of the Tickets (workflowPlaces); os.homedir() by default. */
  home?: string
  /** The names in a folder; replaced in tests. */
  readdir?: (dir: string) => Promise<string[]>
  /** Runs git for the main branch (main-ref.ts); replaced in tests. */
  git?: RefGitRunner
}

/**
 * The real file's path relative to the Project root, with `/` between the parts, as `docs.read`
 * answers; null when there is none (another drive or share on Windows). A file inside the root's real
 * folder is relative to that folder; one outside it (a Silent Project's Workflow folder) to the root
 * as written, the way main resolves a link against it: path.resolve(root, relative) is the file again.
 */
export async function relativeToRoot(root: string, file: string, paths: PathRules, options: ResolveOptions): Promise<string | null> {
  const base = await (options.real ?? ((path: string) => realpath(path).catch(() => null)))(root)
  if (base !== null && isInside(base, file, paths)) return paths.relative(base, file).split(paths.sep).join('/')
  const lexical = paths.relative(root, file)
  return paths.isAbsolute(lexical) ? null : lexical.split(paths.sep).join('/')
}

/** Reads the Ticket's file under the Project's layout; throws with the reason when it cannot. */
export async function readTicketFile(layout: ProjectLayout, ref: TicketRef, options: TicketReadOptions = {}): Promise<{ path: string; relative: string | null; text: string }> {
  // Where the Tickets live is unknown: the reason, not a guess (src/main/workflow/folder.ts).
  if (layout.failed) throw new Error(layoutFailure(layout))
  const paths: PathRules = options.paths ?? nativePath
  // The text of the commit the list was read from (ADR-0107): the main branch, not the folder's working tree.
  const source = await resolveSource(layout.root, layout, { details: false, ...(options.git === undefined ? {} : { git: options.git }) })
  if (source.kind === 'ref') return readCommittedTicket(layout, source, ref, paths, options)
  const places = await workflowPlaces(layout, { paths, home: options.home, real: options.real })
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
  return { path: file, relative: await relativeToRoot(layout.root, file, paths, options), text: await readFile(file, 'utf8') }
}

/**
 * The Ticket's file in the commit of the main branch. The Epic is a name, never a path: `..` or a separator in it is
 * refused, so the read stays inside the Tickets root. `path` is where the file lies in the folder, whether or not the
 * folder has it yet.
 */
async function readCommittedTicket(
  layout: ProjectLayout,
  source: MainRef,
  ref: TicketRef,
  paths: PathRules,
  options: TicketReadOptions,
): Promise<{ path: string; relative: string | null; text: string }> {
  if (ref.epic === '' || ref.epic === '.' || ref.epic === '..' || /[\\/\0]/u.test(ref.epic)) throw new Error(`not an Epic name: ${JSON.stringify(ref.epic)}`)
  const name = `${String(ref.num).padStart(2, '0')}-${ref.slug}.md`
  const tree = refTree(source, source.ticketsRel, [`${ref.epic}/issues`], options.git)
  const key = `${ref.num}:${ref.slug}`
  const entry = (await tree.names(`${ref.epic}/issues`)).find((candidate) => issueKey(candidate) === key)
  if (entry === undefined) throw new Error(`${ref.epic}/issues/${name} does not exist in the main branch`)
  const text = (await tree.texts([`${ref.epic}/issues/${entry}`], TICKET_SIZE_MAX)).get(`${ref.epic}/issues/${entry}`)
  if (text === undefined) throw new Error(`${ref.epic}/issues/${entry} is not a file, or is larger than ${TICKET_SIZE_MAX} bytes`)
  const file = paths.join(layout.ticketsRoot, ref.epic, 'issues', entry)
  return { path: file, relative: await relativeToRoot(layout.root, file, paths, options), text }
}

export default [
  defineHandler(ticketsRead, async ({ projectId, epic, num, slug }) => {
    const root = projectStore().get(projectId).path
    return readTicketFile(await projectLayouts().get(root), { epic, num, slug })
  }),
] satisfies HandlerModule
