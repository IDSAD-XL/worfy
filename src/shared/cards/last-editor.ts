// Which Session last edited a Card, derived by main from what the Sessions did, never from what
// an agent says about itself. A Card is the folder `<Project data folder>/cards/<id>/`; a Session
// edited it when one of its file-writing tool calls (`tool_use` events, ticket 07) named a path
// inside that folder. Ticket 26 sends `session.ask` from a Card to that Session.
//
// Paths are compared as text after normalization (`.`, `..`, repeated slashes, a path relative to
// the Session's cwd). Symlinks are not followed: this module is pure and never touches the disk.

/** The tools that write a file, and the input key that names it. */
const WRITE_TOOLS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** One tool call of a Session, as its `tool_use` event carries it. */
export interface ToolUseRecord {
  sessionId: string
  /** The Session's working directory: a relative path is resolved against it. */
  cwd: string
  name: string
  input: unknown
}

/** `path` made absolute against `cwd` and normalized; null when it is not a usable path. */
export function normalizePath(path: string, cwd: string): string | null {
  if (path === '' || path.includes('\0')) return null
  const full = path.startsWith('/') ? path : `${cwd}/${path}`
  if (!full.startsWith('/')) return null
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** The id of the Card whose folder holds `path`, or null. `cardsDir` is `<Project data folder>/cards`. */
export function cardOfPath(path: string, cardsDir: string, cwd: string): string | null {
  const file = normalizePath(path, cwd)
  const root = normalizePath(cardsDir, '/')
  if (file === null || root === null) return null
  const prefix = root === '/' ? '/' : `${root}/`
  if (!file.startsWith(prefix)) return null
  const [id, ...rest] = file.slice(prefix.length).split('/')
  // The folder itself is not a file in it.
  return id !== undefined && id !== '' && rest.length > 0 ? id : null
}

/** The Card a tool call wrote into, or null when it wrote nothing or wrote elsewhere. */
export function cardEditedBy(use: Omit<ToolUseRecord, 'sessionId'>, cardsDir: string): string | null {
  const key = Object.hasOwn(WRITE_TOOLS, use.name) ? WRITE_TOOLS[use.name] : undefined
  if (key === undefined || typeof use.input !== 'object' || use.input === null) return null
  const path = (use.input as Record<string, unknown>)[key]
  return typeof path === 'string' ? cardOfPath(path, cardsDir, use.cwd) : null
}

/** The Session whose tool call, last in `uses`, wrote into Card `cardId`; null when none did. */
export function lastEditor(uses: Iterable<ToolUseRecord>, cardsDir: string, cardId: string): string | null {
  let last: string | null = null
  for (const use of uses) if (cardEditedBy(use, cardsDir) === cardId) last = use.sessionId
  return last
}
