// A model of a Windows disk for the tests of worfy-windows ticket 20: folders, files and links in
// memory, by the rules of path.win32, so the tests run on any system. It answers the calls of
// remote-links.ts (LinkFs) and of link-safe-watch.ts (WatchFs), and writes every call down.
//
// What makes it a model of the danger: a call that would make Windows go through a link to
// `\\host\share\…` is written to `contacts` and fails as the real call does. lstat and readlink of
// the link itself are not such calls; lstat of anything below it is.
//
// What it does not model (worfy-windows ticket 33):
// - short 8.3 names and network drives mapped to a letter: realpath answers the path as it was put
//   in the model, and `Z:\…` is a disk like `C:\…`;
// - a call made right on `\\evil\share\x`, with no link on the way: only a call through a link is
//   written to `contacts`;
// - what a recursive watch does not see on the PC: a change put through a local link is told to a
//   watch of the folder that holds the link, as if the change were in that folder;
// - the events of a removal: a watch of the removed folder itself gets five events that name it by
//   its `\\?\` path, the number is the model's own; a watch of a folder below the removed one gets
//   nothing at all.
import { win32 } from 'node:path'
import type { EntryKind, WatchFs, WatchHandle } from '../../src/main/link-safe-watch'
import type { LinkFs, LinkFsSync } from '../../src/main/remote-links'

export type DiskEntry = { kind: 'folder' } | { kind: 'file' } | { kind: 'link'; to: string }

export const FOLDER: DiskEntry = { kind: 'folder' }
export const FILE: DiskEntry = { kind: 'file' }
export const linkTo = (to: string): DiskEntry => ({ kind: 'link', to })

interface Watch {
  path: string
  recursive: boolean
  onEvent: (name: string | null) => void
  onError: (error: unknown) => void
  closed: boolean
}

const failure = (code: string, what: string): Error => Object.assign(new Error(`${code}: ${what}`), { code })
const key = (path: string): string => path.toLowerCase()

export interface WindowsDisk {
  links: LinkFs
  /** The same two calls for a caller that cannot wait. */
  linksSync: LinkFsSync
  /** lstat of a path, as a yes or no; counted as `lstat`. */
  there: (path: string) => boolean
  /** A read of a file, through any link on the way; counted as `open`. */
  readText: (path: string) => string
  fs: WatchFs
  /** Every call, as `<call> <path>`, in order. */
  calls: string[]
  /** The calls that went through a link to a share: Windows would have contacted the host. */
  contacts: string[]
  /** The watches that are open now, as `<path>` or `<path> (recursive)`. */
  open: () => string[]
  /** Puts an entry at a path (its folders above are made) and tells the watches, as Windows would. */
  put: (path: string, entry: DiskEntry) => void
  /** Puts an entry and tells nobody: a change that came before the watch that would have seen it. */
  putQuietly: (path: string, entry: DiskEntry) => void
  /** Removes a path with everything below it and tells the watches. */
  remove: (path: string) => void
  /** Makes a link unreadable (readlink rejects) or a path impossible to look at (lstat rejects). */
  breakLink: (path: string) => void
  deny: (path: string) => void
  /** Sends an error to the watches of a path. */
  fail: (path: string, error: Error) => void
  /** Sends the watches of a path an event that names nothing. */
  nameless: (path: string) => void
}

export function windowsDisk(entries: Record<string, DiskEntry>): WindowsDisk {
  const tree = new Map<string, { path: string; entry: DiskEntry }>()
  const calls: string[] = []
  const contacts: string[] = []
  const watches: Watch[] = []
  const unreadable = new Set<string>()
  const denied = new Set<string>()

  /** Puts an entry in the tree; answers the paths that are new or changed, the folders made above it first. */
  const set = (path: string, entry: DiskEntry): string[] => {
    const made: string[] = []
    // The root of a disk or of a share is always there.
    const root = win32.parse(path).root
    if (!tree.has(key(root))) tree.set(key(root), { path: root, entry: FOLDER })
    for (let above = win32.dirname(path); above !== win32.dirname(above); above = win32.dirname(above)) {
      if (tree.has(key(above))) continue
      tree.set(key(above), { path: above, entry: FOLDER })
      made.unshift(above)
    }
    tree.set(key(path), { path: tree.get(key(path))?.path ?? path, entry })
    return [...made, path]
  }
  for (const [path, entry] of Object.entries(entries)) set(path, entry)

  /**
   * The path with every link in it followed, as Windows follows one. `last` false leaves the last
   * name as it is (lstat, readlink). A link to a share ends it: the call is a contact.
   */
  const follow = (call: string, asked: string, last: boolean): string => {
    let path = win32.resolve(asked)
    for (let hops = 0; hops < 64; hops++) {
      const root = win32.parse(path).root
      const names = path.slice(root.length).split('\\').filter((name) => name !== '')
      let at = root
      let turned = false
      for (let index = 0; index < names.length; index++) {
        at = win32.join(at, names[index]!)
        const here = tree.get(key(at))?.entry
        if (here?.kind !== 'link' || (!last && index === names.length - 1)) continue
        const target = win32.resolve(win32.dirname(at), here.to)
        // A share the model holds entries of is one the user is already on; any other is a host to contact.
        if (target.startsWith('\\\\') && !tree.has(key(win32.parse(target).root))) {
          contacts.push(`${call} ${asked}`)
          throw failure('UNKNOWN', asked)
        }
        path = win32.join(target, ...names.slice(index + 1))
        turned = true
        break
      }
      if (!turned) return path
    }
    throw failure('ELOOP', asked)
  }

  const kindOf = (entry: DiskEntry): EntryKind => entry.kind
  /** Tells the watches above a real path that it changed. */
  const tell = (path: string): void => {
    for (const watch of [...watches]) {
      if (watch.closed) continue
      const rel = win32.relative(watch.path, path)
      if (rel.startsWith('..') || win32.isAbsolute(rel)) continue
      // A watch of a file names the file; a watch of a folder says nothing of the folder itself.
      if (rel === '') {
        if (tree.get(key(path))?.entry.kind === 'file') watch.onEvent(win32.basename(path))
        continue
      }
      if (!watch.recursive && rel.includes('\\')) continue
      watch.onEvent(rel)
    }
  }

  const linksSync: LinkFsSync = {
    isLink: (path) => {
      calls.push(`lstat ${path}`)
      if (denied.has(key(path))) throw failure('EACCES', path)
      const entry = tree.get(key(follow('lstat', path, false)))?.entry
      return entry === undefined ? null : entry.kind === 'link'
    },
    readlink: (path) => {
      calls.push(`readlink ${path}`)
      const entry = tree.get(key(follow('readlink', path, false)))?.entry
      if (entry?.kind !== 'link' || unreadable.has(key(path))) throw failure('EINVAL', path)
      return entry.to
    },
  }
  const links: LinkFs = {
    isLink: async (path) => linksSync.isLink(path),
    readlink: async (path) => linksSync.readlink(path),
  }
  /** lstat of a path, as a yes or no: a link is there whatever it leads to. */
  const there = (path: string): boolean => {
    calls.push(`lstat ${path}`)
    try {
      return tree.has(key(follow('lstat', path, false)))
    } catch {
      return false
    }
  }
  /** A read of a file, through any link on the way. */
  const readText = (path: string): string => {
    calls.push(`open ${path}`)
    const real = follow('open', path, true)
    if (tree.get(key(real))?.entry.kind !== 'file') throw failure('ENOENT', path)
    return `<title>the text of ${real}</title>`
  }

  const fs: WatchFs = {
    kind: async (path) => {
      calls.push(`lstat ${path}`)
      if (denied.has(key(path))) throw failure('EACCES', path)
      const entry = tree.get(key(follow('lstat', path, false)))?.entry
      return entry === undefined ? null : kindOf(entry)
    },
    list: async (path) => {
      calls.push(`readdir ${path}`)
      const real = follow('readdir', path, true)
      if (tree.get(key(real))?.entry.kind !== 'folder') throw failure('ENOENT', path)
      return [...tree.values()].filter((each) => key(win32.dirname(each.path)) === key(real) && each.path !== real).map((each) => ({ name: win32.basename(each.path), kind: kindOf(each.entry) }))
    },
    realpath: async (path) => {
      calls.push(`realpath ${path}`)
      const real = follow('realpath', path, true)
      const found = tree.get(key(real))
      if (found === undefined) throw failure('ENOENT', path)
      return found.path
    },
    isFolder: async (path) => {
      calls.push(`stat ${path}`)
      try {
        return tree.get(key(follow('stat', path, true)))?.entry.kind === 'folder'
      } catch {
        return false
      }
    },
    watch: (path, recursive, onEvent, onError): WatchHandle => {
      calls.push(`watch ${path}${recursive ? ' (recursive)' : ''}`)
      const real = follow('watch', path, true)
      if (!tree.has(key(real))) throw failure('ENOENT', path)
      const watch: Watch = { path: real, recursive, onEvent, onError, closed: false }
      watches.push(watch)
      return {
        close: () => {
          watch.closed = true
        },
      }
    },
  }

  return {
    links,
    linksSync,
    there,
    readText,
    fs,
    calls,
    contacts,
    open: () => watches.filter((watch) => !watch.closed).map((watch) => `${watch.path}${watch.recursive ? ' (recursive)' : ''}`),
    put: (path, entry) => {
      for (const each of set(path, entry)) tell(each)
    },
    putQuietly: (path, entry) => void set(path, entry),
    remove: (path) => {
      for (const each of [...tree.values()]) {
        const rel = win32.relative(path, each.path)
        if (rel === '' || (!rel.startsWith('..') && !win32.isAbsolute(rel))) tree.delete(key(each.path))
      }
      // A watch of the folder itself gets a run of events that name the folder by its device path.
      for (const watch of [...watches]) {
        if (watch.closed || key(watch.path) !== key(path)) continue
        for (let times = 0; times < 5; times++) watch.onEvent(`\\\\?\\${watch.path}`)
      }
      tell(path)
    },
    breakLink: (path) => void unreadable.add(key(path)),
    deny: (path) => void denied.add(key(path)),
    fail: (path, error) => {
      for (const watch of [...watches]) if (!watch.closed && key(watch.path) === key(path)) watch.onError(error)
    },
    nameless: (path) => {
      for (const watch of [...watches]) if (!watch.closed && key(watch.path) === key(path)) watch.onEvent(null)
    },
  }
}
