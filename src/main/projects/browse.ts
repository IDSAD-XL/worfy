// The folders of one folder of this Machine, for "Add project" on a Linked machine (worfy-link
// ticket 11, `projects.browse`): the screen of another Machine cannot open this Machine's system
// folder picker, so it walks the folders here, one folder per call, and chooses one.
//
// Only folders are listed (a symbolic link to a folder too), by name. Paths stay in the form of this
// Machine's OS: the caller never parses or joins them, it only goes on by `path` and `parent` of an
// answer, so the same screen works with a Machine on another OS. git is never run: a folder is a
// repository when it holds a `.git` (a folder, or the file of a linked worktree). Nothing is written.
//
// On Windows stat of a link to `\\host\share\…` makes the system contact that host with the
// user's credentials, and the folder walked into may be a cloned repository that carries such a
// link. So a link is read before it is asked about (remote-links.ts; worfy-windows ticket 20): one
// that leads off the machine, or cannot be checked, is not in the list — and so nothing is asked
// about a `.git` inside it either.
import { lstat, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as nodePath from 'node:path'
import { leadsToRemote, type LinkFs, type PathRules } from '../remote-links'

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
  path?: PathRules
  /** lstat and readlink for the links among the folders (remote-links.ts); replaced in tests. */
  links?: LinkFs
  /** The calls on the file system; replaced in tests. */
  fs?: BrowseFs
}

/** What a browse asks of the file system. `isFolder` follows a link; the other two do not. */
export interface BrowseFs {
  /** The entries of a folder; rejects as readdir does. */
  list: (folder: string) => Promise<{ name: string; kind: 'folder' | 'link' | 'other' }[]>
  /** Whether the path leads to a folder; false when it leads nowhere. */
  isFolder: (path: string) => Promise<boolean>
  /** Whether something is at the path, by lstat. */
  there: (path: string) => Promise<boolean>
}

const nodeBrowseFs: BrowseFs = {
  list: async (folder) =>
    (await readdir(folder, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : entry.isSymbolicLink() ? 'link' : 'other' })),
  isFolder: (path) =>
    stat(path).then(
      (target) => target.isDirectory(),
      () => false,
    ),
  there: (path) =>
    lstat(path).then(
      () => true,
      () => false,
    ),
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

  const fs = options.fs ?? nodeBrowseFs
  let entries
  try {
    entries = await fs.list(folder)
  } catch (error) {
    return { ok: false, path: folder, parent, reason: unreadable(folder, error) }
  }

  const names = (
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.kind === 'folder') return entry.name
        if (entry.kind !== 'link') return null
        const child = rules.join(folder, entry.name)
        // The folder walked into is the user's own place, also when it lies on a share. A link in
        // it that leads off the machine, or cannot be checked, is not asked about.
        if (await leadsToRemote(child, [folder], { paths: rules, links: options.links })) return null
        // A link counts when it leads to a folder; one that leads nowhere is left out.
        return (await fs.isFolder(child)) ? entry.name : null
      }),
    )
  )
    .filter((name): name is string => name !== null)
    .sort(byName.compare)

  const shown = names.slice(0, limit)
  const folders = await Promise.all(
    shown.map(async (name): Promise<BrowsedFolder> => {
      const child = rules.join(folder, name)
      return { name, path: child, hidden: name.startsWith('.'), gitRepo: await fs.there(rules.join(child, '.git')) }
    }),
  )
  return { ok: true, path: folder, parent, folders, truncated: names.length > shown.length }
}
