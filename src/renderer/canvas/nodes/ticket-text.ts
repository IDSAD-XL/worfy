import { useEffect, useState } from 'react'
import type { Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'

// The text of a Ticket file for the focused Ticket (TicketBody.tsx). It comes from main through
// `tickets.read` (src/shared/ipc/tickets.ts), which finds the file under the Project's Tickets root:
// the Workflow folder in Silent mode. It is read again whenever the workflow model brings a new
// version of the Ticket (its `version`, a hash of the file): an edit by hand or by an agent shows
// without opening the Ticket again.

export interface TicketText {
  /** The real path of the file, absolute; undefined until it is read. */
  path: string | undefined
  /**
   * The same file relative to the Project root (`/` between the parts), null when it has none (another
   * drive or share on Windows); undefined until it is read. The file's relative links resolve against
   * its folder.
   */
  relative: string | null | undefined
  text: string | undefined
  error: string | undefined
}

const NONE: TicketText = { path: undefined, relative: undefined, text: undefined, error: undefined }

const keyOf = (projectId: string, ticket: Pick<Ticket, 'epic' | 'num' | 'slug'>): string => `${projectId}\n${ticket.epic}\n${ticket.num}\n${ticket.slug}`

/** The text of the Ticket's file while `source` is given; nothing is read for null. */
export function useTicketText(source: { projectId: string; ticket: Ticket } | null): TicketText {
  const [read, setRead] = useState<TicketText & { key: string | undefined }>({ ...NONE, key: undefined })
  const projectId = source?.projectId
  const epic = source?.ticket.epic
  const num = source?.ticket.num
  const slug = source?.ticket.slug
  const version = source?.ticket.version
  useEffect(() => {
    if (projectId === undefined || epic === undefined || num === undefined || slug === undefined) return
    let live = true
    const key = keyOf(projectId, { epic, num, slug })
    void invoke('tickets.read', { projectId, epic, num, slug }).then((result) => {
      if (!live) return
      if (result.ok) setRead({ key, path: result.value.path, relative: result.value.relative, text: result.value.text, error: undefined })
      // The text read before stays on screen with the reason: a Ticket being rewritten may be gone for a moment.
      else setRead((previous) => (previous.key === key ? { ...previous, error: result.error } : { ...NONE, key, error: result.error }))
    })
    return () => {
      live = false
    }
  }, [projectId, epic, num, slug, version])
  // Another Ticket's text is never shown, not even for the moment before this one is read.
  if (source === null || read.key !== keyOf(source.projectId, source.ticket)) return NONE
  return { path: read.path, relative: read.relative, text: read.text, error: read.error }
}

/** The folder of a path, in either separator: relative links of the file resolve against it. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const folder = path.slice(0, Math.max(cut, 0))
  // A file right under a root (`/x.md`, `C:\x.md`) keeps the root's separator.
  return folder === '' || folder.endsWith(':') ? path.slice(0, cut + 1) : folder
}


/**
 * The folder the Ticket file's relative links resolve against, relative to the Project root as
 * classifyLink expects (src/renderer/markdown/links.ts); the absolute folder only when the file has no
 * path relative to the root.
 */
export function linkFolderOf(read: Pick<TicketText, 'path' | 'relative'>): string | undefined {
  if (read.relative !== undefined && read.relative !== null) return folderOf(read.relative)
  // shortcut: an absolute folder on another share loses its leading `\\` in classifyLink, so such
  // links resolve inside the Project and are refused, redo when a Silent Project needs its Workflow
  // folder on another share than its own.
  return read.path === undefined ? undefined : folderOf(read.path)
}
