// Links that lead off the machine (worfy-windows ticket 18). On Windows realpath of a path that goes
// through a symlink to `\\host\share\…` makes the system contact that host over SMB and hand it the
// user's NTLM credentials — before the caller has had a chance to refuse the path as outside its
// folder. So a caller asks here first: this module walks the path segment by segment with lstat and
// readlink, which read a link without following it, and says whether a link on the way leads to a
// remote path. No Electron here; the file system and the path rules are parameters, so the walk is
// tested on any machine (test/unit/remote-links.test.ts).
//
// What it cannot see: a link put in place after the walk and before the caller's realpath. The two
// are separate steps.
import { lstat, readlink } from 'node:fs/promises'
import * as nativePath from 'node:path'

export type PathRules = Pick<typeof nativePath, 'dirname' | 'isAbsolute' | 'join' | 'parse' | 'relative' | 'resolve' | 'sep'>

/** What the walk reads of the file system; neither call follows a link. */
export interface LinkFs {
  /**
   * Whether the path is a link (a symlink or a junction); null when there is nothing at the path.
   * Rejects when the path cannot be looked at for any other reason.
   */
  isLink: (path: string) => Promise<boolean | null>
  /** The target of a link, as written in it. */
  readlink: (path: string) => Promise<string>
}

export interface RemoteLinkOptions {
  /** The path rules of the caller: those of the platform; path.win32 in tests on any system. */
  paths: PathRules
  /** lstat and readlink; replaced in tests. */
  links?: LinkFs
}

/** How many links one walk follows; a longer chain, or a loop, is refused. */
export const MAX_LINK_HOPS = 40

/** lstat and readlink of Node. lstat, never stat: stat follows the link, which is the call to avoid. */
export const nodeLinks: LinkFs = {
  isLink: (path) =>
    lstat(path).then(
      (stats) => stats.isSymbolicLink(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      },
    ),
  readlink: (path) => readlink(path),
}

/**
 * True when `path` is `base` itself or lies under it, by the rules of `paths`. Only a first segment
 * that is exactly `..` leaves `base`: a folder named `..drafts` inside it is still inside.
 */
export function isInside(base: string, path: string, paths: Pick<PathRules, 'isAbsolute' | 'relative' | 'sep'> = nativePath): boolean {
  const rel = paths.relative(base, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel))
}

/**
 * A device path that only names a local disk or a share, without its prefix: `\\?\C:\x` is `C:\x`
 * and `\\?\UNC\host\share` is `\\host\share`. Any other device path stays as it is, and counts as
 * remote.
 */
function withoutDevicePrefix(path: string): string {
  if (/^\\\\\?\\[A-Za-z]:\\/.test(path)) return path.slice(4)
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`
  return path
}

/**
 * A path as written — the target of a link, or the path asked about — in the form the walk reads:
 * absolute, with a leading `\\` when it is remote. Null when it names something off the machine in
 * a form path.win32.resolve would show as a local folder:
 *
 * - the NT namespace, which Node's readlink hands back as it is stored. `\??\C:\x` is a disk, and
 *   is read as one; every other name there (`\??\GLOBALROOT\Device\Mup\host\share\x`,
 *   `\??\Global\UNC\host\…`, `\??\UNC\host\…`) can reach the network redirector, and
 *   path.win32.resolve would make `C:\??\…` of it;
 * - a server with no share, `\\host`: Windows reads a server, path.win32.resolve a folder `\host`
 *   of the current disk.
 */
function absolute(written: string, from: string | null, paths: PathRules): string | null {
  let text = written
  if (/^[\\/](?:\?\?|\?|\.)[\\/]/.test(text)) {
    if (!/^\\\?\?\\[A-Za-z]:\\/.test(text)) return null
    text = text.slice(4)
  }
  const full = from === null ? paths.resolve(text) : paths.resolve(from, text)
  if (/^[\\/]{2}/.test(text) && !full.startsWith('\\\\')) return null
  return withoutDevicePrefix(full)
}

/**
 * Whether a link on the way to `candidate` leads to a remote path outside `allowed`.
 *
 * Only on Windows (`paths.sep` is `\`); elsewhere the answer is no and the file system is not
 * touched. A remote path is one that path.win32.resolve gives a leading `\\` — `\\host\share\…`,
 * `//host/…`, `\\?\…`, `\\.\…` — or one of the forms absolute() names. `allowed` are the folders
 * the caller works in, as written and as real paths: a share among them is the caller's own, and a
 * path inside it is not remote here.
 *
 * The walk starts at the outermost allowed folder that holds `candidate` by its text — the folder
 * itself is looked at too — or, for a local path outside all of them, at the root of its disk. Each
 * segment is read with lstat. A link is read with readlink and its target resolved from the link's
 * folder: a remote target outside `allowed` ends the walk with yes, and nothing is asked of the
 * file system after it; any other target is walked in turn, so a chain of local links that ends on
 * a share is refused as well. No path with a leading `\\` outside `allowed` is ever given to lstat.
 * More than MAX_LINK_HOPS links, a loop included, is a yes.
 *
 * A segment that is not there ends the walk with no: there is nothing behind it to follow, and the
 * caller's realpath says the rest. Any other failure to look at a segment or to read a link is a
 * yes: the caller's next step is realpath, and it must not be taken on a path that was not read.
 */
export async function leadsToRemote(candidate: string, allowed: readonly string[], options: RemoteLinkOptions): Promise<boolean> {
  const paths = options.paths
  if (paths.sep !== '\\') return false
  const links = options.links ?? nodeLinks
  const folders = allowed.map((folder) => absolute(folder, null, paths)).filter((folder): folder is string => folder !== null)
  const isRemote = (path: string): boolean => path.startsWith('\\\\') && !folders.some((folder) => isInside(folder, path, paths))

  /** Where the walk to `path` starts, and the segments from there. */
  const route = (path: string): { from: string; rest: string[] } => {
    const holder = folders.filter((folder) => isInside(folder, path, paths)).sort((a, b) => a.length - b.length)[0]
    const from = holder ?? paths.parse(path).root
    return { from, rest: paths.relative(from, path).split(paths.sep).filter((segment) => segment !== '') }
  }

  const first = absolute(candidate, null, paths)
  if (first === null || isRemote(first)) return true
  let { from: current, rest: pending } = route(first)
  // The folder the walk starts at is looked at too, unless it is the root of a disk.
  let next: string | undefined = paths.parse(current).root === current ? undefined : current
  let hops = 0
  for (;;) {
    if (next === undefined) {
      const segment = pending.shift()
      if (segment === undefined) return false
      next = paths.join(current, segment)
    }
    const path = next
    next = undefined
    if (isRemote(path)) return true
    let link: boolean | null
    try {
      link = await links.isLink(path)
    } catch {
      return true
    }
    if (link === null) return false
    if (!link) {
      current = path
      continue
    }
    hops += 1
    if (hops > MAX_LINK_HOPS) return true
    let written: string
    try {
      written = await links.readlink(path)
    } catch {
      return true
    }
    const target = absolute(written, paths.dirname(path), paths)
    if (target === null || isRemote(target)) return true
    // The rest of the path now hangs off the target, and the target's own segments are walked
    // first: from the allowed folder it lies in, or from the root of its disk.
    const onward = route(target)
    current = onward.from
    pending = [...onward.rest, ...pending]
  }
}
