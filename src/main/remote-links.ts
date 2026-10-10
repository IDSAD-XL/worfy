// Links that lead off the machine (worfy-windows ticket 18). On Windows realpath of a path that goes
// through a symlink to `\\host\share\…` makes the system contact that host over SMB and hand it the
// user's NTLM credentials — before the caller has had a chance to refuse the path as outside its
// folder. So a caller asks here first: this module walks the path segment by segment with lstat and
// readlink, which read a link without following it, and says whether a link on the way leads to a
// remote path. No Electron here; the file system and the path rules are parameters, so the walk is
// tested on any machine (test/unit/remote-links.test.ts).
import { lstat, readlink } from 'node:fs/promises'
import * as nativePath from 'node:path'

export type PathRules = Pick<typeof nativePath, 'dirname' | 'isAbsolute' | 'join' | 'parse' | 'relative' | 'resolve' | 'sep'>

/** What the walk reads of the file system; neither call follows a link. */
export interface LinkFs {
  /** Whether the path is a link (a symlink or a junction); null when nothing can be read there. */
  isLink: (path: string) => Promise<boolean | null>
  /** The target of a link, as written in it. */
  readlink: (path: string) => Promise<string>
}

export interface RemoteLinkOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  /** lstat and readlink; replaced in tests. */
  links?: LinkFs
}

/** How many links one walk follows; a longer chain, or a loop, is refused. */
export const MAX_LINK_HOPS = 40

const nodeLinks: LinkFs = {
  isLink: (path) =>
    lstat(path).then(
      (stats) => stats.isSymbolicLink(),
      () => null,
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
 * and `\\?\UNC\host\share` is `\\host\share`. Node's readlink already answers without the prefix;
 * a target that still has it is read the same way. Any other device path stays as it is, and counts
 * as remote.
 */
function withoutDevicePrefix(path: string): string {
  if (/^\\\\\?\\[A-Za-z]:\\/.test(path)) return path.slice(4)
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`
  return path
}

/**
 * Whether a link on the way to `candidate` leads to a remote path outside `allowed`.
 *
 * Only on Windows (`paths.sep` is `\`); elsewhere the answer is no and the file system is not
 * touched. A remote path is one that path.win32.resolve gives a leading `\\`: `\\host\share\…`,
 * `//host/…`, `\\?\…`, `\\.\…`. `allowed` are the folders the caller works in, as written and as
 * real paths: a share among them is the caller's own, and a path inside it is not remote here.
 *
 * The walk starts at the allowed folder that holds `candidate` by its text — the folder itself is
 * looked at too — or, for a local path outside all of them, at the root of its disk. Each segment
 * is read with lstat. A link is read with readlink and its target resolved from the link's folder:
 * a remote target outside `allowed` ends the walk with yes, and nothing is asked of the file system
 * after it; any other target is walked in turn, so a chain of local links that ends on a share is
 * refused as well. No path with a leading `\\` outside `allowed` is ever given to lstat. More than
 * MAX_LINK_HOPS links, a loop included, is a yes. A segment that cannot be read ends the walk with
 * no: there is nothing behind it to follow, and the caller's own realpath says the rest.
 */
export async function leadsToRemote(candidate: string, allowed: readonly string[], options: RemoteLinkOptions = {}): Promise<boolean> {
  const paths = options.paths ?? nativePath
  if (paths.sep !== '\\') return false
  const links = options.links ?? nodeLinks
  const folders = allowed.map((folder) => withoutDevicePrefix(paths.resolve(folder)))
  const isRemote = (path: string): boolean => path.startsWith('\\\\') && !folders.some((folder) => isInside(folder, path, paths))

  /** Where the walk to `path` starts, and the segments from there. */
  const route = (path: string): { from: string; rest: string[] } => {
    const holder = folders.find((folder) => isInside(folder, path, paths))
    const from = holder ?? paths.parse(path).root
    return { from, rest: paths.relative(from, path).split(paths.sep).filter((segment) => segment !== '') }
  }

  const first = withoutDevicePrefix(paths.resolve(candidate))
  if (isRemote(first)) return true
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
    const link = await links.isLink(path)
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
      // Not a link any more: nothing to follow.
      return false
    }
    const target = withoutDevicePrefix(paths.resolve(paths.dirname(path), written))
    if (isRemote(target)) return true
    // The rest of the path now hangs off the target, and the target's own segments are walked
    // first: from the allowed folder it lies in, or from the root of its disk.
    const onward = route(target)
    current = onward.from
    pending = [...onward.rest, ...pending]
  }
}
