// The folders of one folder of this Machine, for "Add project" on a Linked machine (worfy-link
// ticket 11, `projects.browse`): the screen of another Machine cannot open this Machine's system
// folder picker, so it walks the folders here, one folder per call, and chooses one.
//
// Only folders are listed (a symbolic link to a folder too), by name. Paths stay in the form of this
// Machine's OS: the caller never parses or joins them, it only goes on by `path` and `parent` of an
// answer, so the same screen works with a Machine on another OS. git is never run: a folder is a
// repository when it holds a `.git` (a folder, or the file of a linked worktree). Nothing is written.
import { lstat, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as nodePath from 'node:path'

/** Past this many folders the answer holds the first ones by name and says it is cut. */
export const BROWSE_LIMIT = 2000

export interface BrowsedFolder {
  name: string
  path: string
  /** The name starts with a dot. */
  hidden: boolean
  /** Holds a `.git`, a folder or a file. */
  gitRepo: boolean
}

export type BrowseAnswer =
  | { ok: true; path: string; parent: string | null; folders: BrowsedFolder[]; truncated: boolean }
  | { ok: false; path: string; parent: string | null; reason: string }

export interface BrowseOptions {
  /** The folder a browse starts in (`path` null): the user's home folder. */
  home?: () => string
  limit?: number
  /** The path rules of the OS; node:path of this Machine by default. */
  path?: Pick<typeof nodePath, 'isAbsolute' | 'resolve' | 'dirname' | 'join'>
}

/** The folder above `path`; null for a root (`/`, `C:\`), whose dirname is itself. */
export function parentOf(path: string, rules: Pick<typeof nodePath, 'dirname'> = nodePath): string | null {
  const parent = rules.dirname(path)
  return parent === path ? null : parent
}

const byName = new Intl.Collator('en', { numeric: true })

function unreadable(path: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') return `No permission to read ${path}`
  if (code === 'ENOENT') return `${path} does not exist`
  if (code === 'ENOTDIR') return `${path} is not a folder`
  return `${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * The folders of `path` (null: the home folder). A folder that cannot be read is an answer too —
 * `ok: false` with the reason and the parent, so the screen can go up from it. A relative path
 * throws: the caller only ever sends a path an answer gave it.
 */
export async function browseFolder(path: string | null, options: BrowseOptions = {}): Promise<BrowseAnswer> {
  const rules = options.path ?? nodePath
  const limit = options.limit ?? BROWSE_LIMIT
  const start = path ?? (options.home ?? homedir)()
  if (!rules.isAbsolute(start)) throw new Error(`${start} is not an absolute path`)
  const folder = rules.resolve(start)
  const parent = parentOf(folder, rules)

  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error) {
    return { ok: false, path: folder, parent, reason: unreadable(folder, error) }
  }

  const names = (
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) return entry.name
        if (!entry.isSymbolicLink()) return null
        // A link counts when it leads to a folder; one that leads nowhere is left out.
        const target = await stat(rules.join(folder, entry.name)).catch(() => null)
        return target?.isDirectory() === true ? entry.name : null
      }),
    )
  )
    .filter((name): name is string => name !== null)
    .sort(byName.compare)

  const shown = names.slice(0, limit)
  const folders = await Promise.all(
    shown.map(async (name): Promise<BrowsedFolder> => {
      const child = rules.join(folder, name)
      const git = await lstat(rules.join(child, '.git')).then(
        () => true,
        () => false,
      )
      return { name, path: child, hidden: name.startsWith('.'), gitRepo: git }
    }),
  )
  return { ok: true, path: folder, parent, folders, truncated: names.length > shown.length }
}
