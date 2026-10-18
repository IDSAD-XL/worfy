// Links that lead off the machine (worfy-windows ticket 18). On Windows realpath of a path that goes
// through a symlink to `\\host\share\…` makes the system contact that host over SMB and hand it the
// user's NTLM credentials — before the caller has had a chance to refuse the path as outside its
// folder. So a caller asks here first: this module walks the path segment by segment with lstat and
// readlink, which read a link without following it, and says whether a link on the way leads to a
// remote path. No Electron here; the file system and the path rules are parameters, so the walk is
// tested on any machine (test/unit/remote-links.test.ts).
//
// What it cannot see:
// - a link put in place after the walk and before the caller's realpath. The two are separate steps.
//
// A path written with a device prefix — `\\?\C:\…`, `\\?\UNC\host\share\…`, `\??\C:\…` — that
// holds a `..` is refused as remote (worfy-windows ticket 20). path.win32 takes `..` out of such a
// path, Windows reads it there as a name: the walk would look at another path than the one the
// link leads to, and `\\?\UNC\evil\share\..\..\<a share of the user>` would pass for the user's own.
import { lstatSync, readlinkSync } from 'node:fs'
import { lstat, readlink } from 'node:fs/promises'
import * as nativePath from 'node:path'

export type PathRules = Pick<typeof nativePath, 'dirname' | 'isAbsolute' | 'join' | 'parse' | 'relative' | 'resolve' | 'sep'>

/**
 * What the walk reads of the file system. Neither call follows a symlink, or a junction to a folder
 * of a disk.
 *
 * Node's lstat does follow any other reparse point: libuv opens it again without
 * FILE_FLAG_OPEN_REPARSE_POINT when it cannot read it as a link. Seen on Windows 11 with Node 22
 * (worfy-windows ticket 19): a junction to a volume by its GUID is answered as a plain folder; a
 * junction whose target is a share — `\??\UNC\host\share`, `\??\GLOBALROOT\Device\Mup\…`,
 * `\Device\Mup\…`; mklink makes none, a raw reparse call does — is answered ENOENT in a fraction
 * of a millisecond, by lstat, stat, readdir and realpath alike: Windows does not follow a junction
 * off the machine, and no host is looked for.
 *
 * A symlink is another matter (worfy-windows ticket 34; Windows 11 26200, Node 24.21.0 of Electron
 * 44.5.1 and of the system, no administrator, Developer Mode on). Written by a raw reparse call as
 * an absolute link to `\Device\Mup\host\share`, `\DosDevices\UNC\…`, `\GLOBAL??\UNC\…`,
 * `\Device\LanmanRedirector\…` or `\Sessions\0\DosDevices\<logon>\UNC\…`, lstat answers a symlink
 * and readlink the text as stored, at once; realpath, stat and readdir look for the host, ~1.26 s,
 * as through a symlink to `\\host\share`. The same text in a relative link stays on the link's
 * disk (ENOENT in 0.1–0.3 ms), and readlink answers it alike.
 */
export interface LinkFs {
  /**
   * Whether the path is a link (a symlink, or a junction to a folder of a disk); null when there is
   * nothing at the path. Rejects when the path cannot be looked at for any other reason.
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

/** LinkFs for a caller that cannot wait: the same two calls, answered at once. */
export interface LinkFsSync {
  isLink: (path: string) => boolean | null
  readlink: (path: string) => string
}

export interface RemoteLinkSyncOptions {
  paths: PathRules
  links?: LinkFsSync
}

/** How many links one walk follows; a longer chain, or a loop, is refused. */
export const MAX_LINK_HOPS = 40

/** A path that starts with two separators: a share, or a device path. */
const UNC = /^[\\/]{2}/

/** A path from the root of the NT namespace, through a folder of it that reaches a share. */
const NT_ROOT = /^[\\/](?:device|dosdevices|global\?\?|sessions)(?:[\\/]|$)/i

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

/** lstatSync and readlinkSync of Node. */
export const nodeLinksSync: LinkFsSync = {
  isLink: (path) => {
    try {
      return lstatSync(path).isSymbolicLink()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  readlink: (path) => readlinkSync(path),
}

/**
 * True when `path` is `base` itself or lies under it, by the rules of `paths`. Only a first segment
 * that is exactly `..` leaves `base`: a folder named `..drafts` inside it is still inside.
 *
 * Under Windows rules a UNC path is never inside a folder of a disk, nor the other way round:
 * path.win32.relative drops the leading separators, and reads `\\C:\p\repo\x` — server `C:`, share
 * `p` — as `C:\p\repo\x`.
 */
export function isInside(base: string, path: string, paths: Pick<PathRules, 'isAbsolute' | 'relative' | 'sep'> = nativePath): boolean {
  if (paths.sep === '\\' && UNC.test(base) !== UNC.test(path)) return false
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
 * - the NT namespace. Of the target of a symlink libuv's readlink takes `\??\` off before the
 *   letter of a disk and rewrites `\??\UNC\` to `\\`; every other name there comes back as it is
 *   stored (`\??\GLOBALROOT\Device\Mup\host\share\x`, `\??\Global\UNC\host\…`, `\??\pipe\x`). Such a
 *   name can reach the network redirector, and path.win32.resolve would make `C:\??\…` of it. Only
 *   `\??\C:\x`, should it arrive, is read as the disk it names;
 * - a name from the root of the NT namespace that leads to the network redirector: `\Device\…`,
 *   `\DosDevices\…`, `\GLOBAL??\…`, `\Sessions\…`, in any case (worfy-windows ticket 34). Written
 *   in a symlink as an absolute path, Windows follows it to the host (see LinkFs); readlink gives
 *   it back as stored, the same text as a relative link to `C:\Device\…`, so that one is refused too;
 * - a server with no share, `\\host`: Windows reads a server, path.win32.resolve a folder `\host`
 *   of the current disk.
 */
function absolute(written: string, from: string | null, paths: PathRules): string | null {
  let text = written
  // Under a device prefix a `..` is a name to Windows and a step up to path.win32: not walked.
  if (/^[\\/]{1,2}(?:\?\?|\?|\.)[\\/]/.test(text) && text.split(/[\\/]/).includes('..')) return null
  if (/^[\\/](?:\?\?|\?|\.)[\\/]/.test(text)) {
    if (!/^\\\?\?\\[A-Za-z]:\\/.test(text)) return null
    text = text.slice(4)
  }
  if (NT_ROOT.test(text)) return null
  const full = from === null ? paths.resolve(text) : paths.resolve(from, text)
  if (UNC.test(text) && !full.startsWith('\\\\')) return null
  return withoutDevicePrefix(full)
}

/** What a walk found: nothing that leads off the machine; a remote path; or a path it could not read to the end. */
export type LinkVerdict = 'local' | 'remote' | 'unchecked'

/** What a caller says of an 'unchecked' path, after the path itself: the file may well be its own. */
export const UNCHECKED = 'cannot be checked: a link on the way to it cannot be read, or the links do not end'

/**
 * Whether a link on the way to `candidate` leads to a remote path outside `allowed`; and when the
 * answer is not a plain no, which of the two refusals it is.
 *
 * Only on Windows (`paths.sep` is `\`); elsewhere the answer is 'local' and the file system is not
 * touched. A remote path is one that path.win32.resolve gives a leading `\\` — `\\host\share\…`,
 * `//host/…`, `\\?\…`, `\\.\…` — or one of the forms absolute() names. `allowed` are the folders
 * the caller works in, as written and as real paths: a share among them is the caller's own, and a
 * path inside it is not remote here.
 *
 * The walk starts at the outermost allowed folder that holds `candidate` by its text — the folder
 * itself is looked at too — or, for a local path outside all of them, at the root of its disk. Each
 * segment is read with lstat. A link is read with readlink and its target resolved from the link's
 * folder: a remote target outside `allowed` ends the walk with 'remote', and nothing is asked of the
 * file system after it; any other target is walked in turn, so a chain of local links that ends on
 * a share is refused as well. No path with a leading `\\` outside `allowed` is ever given to lstat.
 * More than MAX_LINK_HOPS links, a loop included, is 'unchecked'.
 *
 * A segment that is not there ends the walk with 'local': there is nothing behind it to follow, and
 * the caller's next step says the rest. Any other failure to look at a segment or to read a link is
 * 'unchecked': the caller's next step follows links, and it must not be taken on a path that was
 * not read.
 */
export async function walkLinks(candidate: string, allowed: readonly string[], options: RemoteLinkOptions): Promise<LinkVerdict> {
  if (options.paths.sep !== '\\') return 'local'
  const links = options.links ?? nodeLinks
  const walk = steps(candidate, allowed, options.paths)
  let step = walk.next()
  while (!step.done) {
    const { ask, path } = step.value
    let answer: Answer
    try {
      answer = ask === 'isLink' ? await links.isLink(path) : await links.readlink(path)
    } catch {
      answer = FAILED
    }
    step = walk.next(answer)
  }
  return step.value
}

/**
 * walkLinks for a caller that cannot wait: the same walk, with lstatSync and readlinkSync. For a
 * few paths at a user's action; a caller that can wait takes walkLinks.
 */
export function walkLinksSync(candidate: string, allowed: readonly string[], options: RemoteLinkSyncOptions): LinkVerdict {
  if (options.paths.sep !== '\\') return 'local'
  const links = options.links ?? nodeLinksSync
  const walk = steps(candidate, allowed, options.paths)
  let step = walk.next()
  while (!step.done) {
    const { ask, path } = step.value
    let answer: Answer
    try {
      answer = ask === 'isLink' ? links.isLink(path) : links.readlink(path)
    } catch {
      answer = FAILED
    }
    step = walk.next(answer)
  }
  return step.value
}

/** leadsToRemote for a caller that cannot wait. */
export function leadsToRemoteSync(candidate: string, allowed: readonly string[], options: RemoteLinkSyncOptions): boolean {
  return walkLinksSync(candidate, allowed, options) !== 'local'
}

/** What a step of the walk asks of the file system, and what it gets: FAILED when the call threw. */
interface Ask {
  ask: 'isLink' | 'readlink'
  path: string
}
const FAILED = Symbol('the call failed')
type Answer = boolean | null | string | typeof FAILED

/**
 * The walk itself, as steps: each yields one question about a path and goes on with the answer.
 * walkLinks and walkLinksSync differ only in how they answer. Under Windows rules only.
 */
function* steps(candidate: string, allowed: readonly string[], paths: PathRules): Generator<Ask, LinkVerdict, Answer> {
  const folders = allowed.map((folder) => absolute(folder, null, paths)).filter((folder): folder is string => folder !== null)
  const isRemote = (path: string): boolean => path.startsWith('\\\\') && !folders.some((folder) => isInside(folder, path, paths))

  /** Where the walk to `path` starts, and the segments from there. */
  const route = (path: string): { from: string; rest: string[] } => {
    const holder = folders.filter((folder) => isInside(folder, path, paths)).sort((a, b) => a.length - b.length)[0]
    const from = holder ?? paths.parse(path).root
    return { from, rest: paths.relative(from, path).split(paths.sep).filter((segment) => segment !== '') }
  }

  const first = absolute(candidate, null, paths)
  if (first === null || isRemote(first)) return 'remote'
  let { from: current, rest: pending } = route(first)
  // The folder the walk starts at is looked at too, unless it is the root of a disk.
  let next: string | undefined = paths.parse(current).root === current ? undefined : current
  let hops = 0
  for (;;) {
    if (next === undefined) {
      const segment = pending.shift()
      if (segment === undefined) return 'local'
      next = paths.join(current, segment)
    }
    const path = next
    next = undefined
    if (isRemote(path)) return 'remote'
    const link = yield { ask: 'isLink', path }
    if (link === FAILED) return 'unchecked'
    if (link === null) return 'local'
    if (!link) {
      current = path
      continue
    }
    hops += 1
    if (hops > MAX_LINK_HOPS) return 'unchecked'
    const written = yield { ask: 'readlink', path }
    if (typeof written !== 'string') return 'unchecked'
    const target = absolute(written, paths.dirname(path), paths)
    if (target === null || isRemote(target)) return 'remote'
    // The rest of the path now hangs off the target, and the target's own segments are walked
    // first: from the allowed folder it lies in, or from the root of its disk.
    const onward = route(target)
    current = onward.from
    pending = [...onward.rest, ...pending]
  }
}

/**
 * True when the path must not be followed: walkLinks found a link that leads off the machine, or
 * could not check the path. For a caller that refuses without saying why.
 */
export async function leadsToRemote(candidate: string, allowed: readonly string[], options: RemoteLinkOptions): Promise<boolean> {
  return (await walkLinks(candidate, allowed, options)) !== 'local'
}
