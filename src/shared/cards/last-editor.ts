// Which Session last edited a Card, derived by main from what the Sessions did, never from what
// an agent says about itself. A Card is the folder `<Project data folder>/cards/<id>/`; a Session
// edited it when one of its file-writing tool calls (`tool_use` events, ticket 07) named a path
// inside that folder. Ticket 26 sends `session.ask` from a Card to that Session.
//
// Paths are compared as text after normalization (`.`, `..`, repeated slashes, a path relative to
// the Session's cwd). Symlinks are not followed: this module is pure and never touches the disk.
// A Windows path (`C:\…`, `C:/…`, `\\server\share\…`; worfy-windows ticket 08) takes `\` and `/`
// as one separator and is compared without regard to case, as the Windows file system does by
// default; Claude Code on Windows names files with `\`. A POSIX path keeps `/` as its only separator.

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

/** The root of an absolute path and what follows it; null for a relative path. */
interface Rooted {
  /** `/`, `C:` (upper case) or `\\server\share`. */
  root: string
  rest: string
  windows: boolean
}

function rootOf(path: string): Rooted | null {
  const drive = /^([A-Za-z]):[\\/]/.exec(path)
  if (drive) return { root: `${drive[1]!.toUpperCase()}:`, rest: path.slice(2), windows: true }
  const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(path)
  if (unc) return { root: `\\\\${unc[1]}\\${unc[2]}`, rest: path.slice(unc[0].length), windows: true }
  return path.startsWith('/') ? { root: '/', rest: path, windows: false } : null
}

/**
 * `path` against the root of `base`: a Windows `\x` is on the cwd's drive; `C:x` is in the cwd when
 * the cwd is on C:, unknown (null) on another drive; anything else relative is in the cwd.
 */
function againstCwd(path: string, base: Rooted): Rooted | null {
  if (base.windows && /^\\(?!\\)/.test(path)) return { ...base, rest: path }
  const drive = /^([A-Za-z]):(?![\\/])/.exec(path)
  if (base.windows && drive) return `${drive[1]!.toUpperCase()}:` === base.root ? { ...base, rest: `${base.rest}/${path.slice(2)}` } : null
  return { ...base, rest: `${base.rest}/${path}` }
}

/** `path` made absolute against `cwd` and normalized; null when it is not a usable path. */
export function normalizePath(path: string, cwd: string): string | null {
  if (path === '' || path.includes('\0')) return null
  const base = rootOf(cwd)
  const full = rootOf(path) ?? (base === null ? null : againstCwd(path, base))
  if (full === null) return null
  const parts: string[] = []
  for (const part of full.rest.split(full.windows ? /[\\/]/ : '/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return full.windows ? `${full.root}\\${parts.join('\\')}` : `/${parts.join('/')}`
}

/** The id of the Card whose folder holds `path`, or null. `cardsDir` is `<Project data folder>/cards`. */
export function cardOfPath(path: string, cardsDir: string, cwd: string): string | null {
  let file = normalizePath(path, cwd)
  const root = normalizePath(cardsDir, '/')
  if (file === null || root === null) return null
  const windows = rootOf(root)!.windows
  // Git Bash names C:\Users as /c/Users: on a Windows folder of Cards, read it as the drive.
  const gitBash = windows && !rootOf(file)!.windows ? /^\/([A-Za-z])(?:\/|$)/.exec(file) : null
  if (gitBash) file = normalizePath(`${gitBash[1]}:/${file.slice(3)}`, '/')!
  if (rootOf(file)!.windows !== windows) return null
  const sep = windows ? '\\' : '/'
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  const head = file.slice(0, prefix.length)
  if (windows ? head.toLowerCase() !== prefix.toLowerCase() : head !== prefix) return null
  const [id, ...rest] = file.slice(prefix.length).split(sep)
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
