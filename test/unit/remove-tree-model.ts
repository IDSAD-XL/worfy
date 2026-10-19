// The file system in memory that the tests of src/main/storage/remove.ts run over, the trees they
// remove, and the copies of the removal that cannot import the module. Not a test file: it is
// imported by test/unit/remove-tree-walk.test.ts, test/unit/remove-tree-copies.test.ts,
// test/unit/remove-tree-mounted.test.ts and test/unit/trash-mounted.test.ts.
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { restoreScriptSource } from '../../src/main/harness/migrate/restore'
import { removeTree, type RemoveFs } from '../../src/main/storage/remove'

const REPO = join(import.meta.dirname, '..', '..')

/**
 * A file system in memory, with POSIX names. A `link` is a name that leads to another path of the
 * model. The module joins names by the rules of the machine, so a backslash in a path it asks
 * about is read as a slash.
 *
 * A `mount` is a name that leads to another path too, and that lstat does not see as a link
 * (worfy-windows ticket 35): on Windows a junction whose target is written with the GUID of a
 * volume. Measured on the PC under both Nodes: lstat calls it a folder and gives the volume it
 * leads to, a listing reads what is behind it, unlink refuses it with EPERM, and rmdir removes it
 * as the link it is, whatever lies behind. Everything under `/vol` is another volume.
 *
 * A `volume` is a folder a volume is mounted on, as macOS has it (worfy-windows ticket 44); the
 * files of that volume are the entries below it. Measured on a Mac (macOS 26.6.1, a disk image
 * attached on a folder) under the system Node 24.19.0 and the Node 24.21.0 of Electron 44.5.1:
 * lstat calls it a folder, and only its `dev` differs from that of the folder it lies in; a listing
 * reads the volume; rmdir answers EBUSY, also when the volume is empty; fs.rmSync with `recursive`
 * of the folder it lies in removes every file of the volume and then throws ENOTEMPTY, with the
 * mount point and the folders on the way to it left; given the mount point itself it removes the
 * files and throws "Resource busy" with no code. `sameDev` is a mount point that tells nothing by
 * its `dev`: measured on the same Mac for /System/Volumes/Data, which has the `dev` of
 * /System/Volumes; expected, and not measured, for a bind mount of a folder of the same file
 * system on Linux. What rmdir and rmSync answer for such a mount point was not measured: the model
 * takes the answers of the disk image.
 */
export type Entry = { kind: 'file' } | { kind: 'folder' } | { kind: 'link'; to: string } | { kind: 'mount'; to: string } | { kind: 'volume'; sameDev?: boolean }
export interface Model {
  fs: RemoveFs
  calls: string[]
  names: () => string[]
  waits: number[]
  /** The wait of a removal over this model: written down, not waited. */
  wait: (ms: number) => void
}

/**
 * More waits than any removal may make. A removal that never stops waiting — a retry with no end —
 * is refused its next wait and fails its test at once, instead of filling the memory of the test
 * process for minutes.
 */
const WAITS_BOUND = 100
export function model(entries: Record<string, Entry>, failing: Record<string, string[]> = {}): Model {
  const tree = new Map(Object.entries(entries))
  const calls: string[] = []
  const waits: number[] = []
  const fail = (code: string, what: string): Error => Object.assign(new Error(`${code}: ${what}`), { code })
  /** The codes a call still has to fail with, first one next. */
  const failures = new Map(Object.entries(failing).map(([call, codes]) => [call, [...codes]]))
  const step = (call: string): void => {
    calls.push(call)
    const code = failures.get(call)?.shift()
    if (code !== undefined) throw fail(code, call)
  }
  const posixNames = (asked: RemoveFs): RemoveFs => ({
    lstatSync: (path) => asked.lstatSync(path.replace(/\\/g, '/')),
    readdirSync: (path) => asked.readdirSync(path.replace(/\\/g, '/')),
    unlinkSync: (path) => asked.unlinkSync(path.replace(/\\/g, '/')),
    rmdirSync: (path) => asked.rmdirSync(path.replace(/\\/g, '/')),
    rmSync: (path, options) => asked.rmSync(path.replace(/\\/g, '/'), options),
  })
  /**
   * Where a path leads once every link and mount on the way to it is followed; its last name is
   * taken as it is. A `..` on the way is resolved as the system resolves it, from where the names
   * before it have led: after a link it goes up from the folder the link leads to, not from the
   * folder the link lies in (worfy-windows ticket 44; only the removal off Windows asks so — the
   * walk of Windows gets its paths from `join`, which cuts a `..` by the text).
   */
  const real = (path: string): string => {
    for (let at = path.indexOf('/', 1); at > 0; at = path.indexOf('/', at + 1)) {
      const before = path.slice(0, at)
      const rest = path.slice(at)
      const entry = tree.get(before)
      if (entry?.kind === 'link' || entry?.kind === 'mount') return real(entry.to + rest)
      if (rest === '/..' || rest.startsWith('/../')) {
        const [above, after] = [posix.dirname(before), rest.slice(3)]
        return real(above === '/' ? after || '/' : above + after)
      }
    }
    return path
  }
  /** The mount point of macOS a path is, or lies below. */
  const volumeAt = (path: string): string | undefined => [...tree.keys()].find((each) => tree.get(each)?.kind === 'volume' && (each === path || path.startsWith(`${each}/`)))
  /** The volume a path is on. */
  const dev = (path: string): number => {
    const volume = volumeAt(path)
    const entry = volume === undefined ? undefined : tree.get(volume)
    if (entry?.kind === 'volume' && entry.sameDev !== true) return 3
    return path === '/vol' || path.startsWith('/vol/') ? 2 : 1
  }
  const fs: RemoveFs = posixNames({
    lstatSync: (asked) => {
      step(`lstat ${asked}`)
      if (asked.endsWith('/..')) {
        // `folder/..` is the folder that folder lies in, as the system reaches it: a link or a
        // mount at the name before `..` is followed, and from a mount point of macOS the way up
        // leads to the folder it is mounted in. Only the removal off Windows asks so.
        const below = real(asked.slice(0, -3))
        const from = tree.get(below)
        if (from === undefined) throw fail('ENOENT', asked)
        if (from.kind === 'file') throw fail('ENOTDIR', asked)
        const above = posix.dirname(from.kind === 'link' || from.kind === 'mount' ? real(from.to) : below)
        // The root is a folder of the first volume, whether the tree names it or not.
        if (above !== '/' && !tree.has(above)) throw fail('ENOENT', asked)
        return { isDirectory: () => true, dev: dev(above) }
      }
      const path = real(asked)
      const entry = tree.get(path)
      if (entry === undefined) throw fail('ENOENT', asked)
      // A mount whose volume is gone — detached, or the folder it leads to removed — is not there
      // to lstat, while the listing of its folder still names it (measured, worfy-windows ticket 45).
      if (entry.kind === 'mount' && !tree.has(real(entry.to))) throw fail('ENOENT', asked)
      // lstat does not follow a link: a link to a folder is not a folder. It does not see a mount:
      // that is a folder to it, on the volume the mount leads to. A mount point of macOS is a
      // folder to it as well, on the volume mounted there.
      return { isDirectory: () => entry.kind === 'folder' || entry.kind === 'mount' || entry.kind === 'volume', dev: dev(entry.kind === 'mount' ? real(entry.to) : path) }
    },
    readdirSync: (asked) => {
      step(`readdir ${asked}`)
      const path = real(asked)
      const entry = tree.get(path)
      // A walk that came here through a link or a mount would be reading what it leads to.
      const listed = entry?.kind === 'link' || entry?.kind === 'mount' ? real(entry.to) : path
      if (entry?.kind === 'mount' && !tree.has(listed)) throw fail('ENOENT', asked)
      return [...tree.keys()].filter((each) => posix.dirname(each) === listed).map((each) => posix.basename(each))
    },
    unlinkSync: (asked) => {
      step(`unlink ${asked}`)
      const path = real(asked)
      const kind = tree.get(path)?.kind
      if (kind === 'folder' || kind === 'mount' || kind === 'volume') throw fail('EPERM', asked)
      if (!tree.delete(path)) throw fail('ENOENT', asked)
    },
    rmdirSync: (asked) => {
      step(`rmdir ${asked}`)
      const path = real(asked)
      // A mount point of macOS is busy for as long as the volume is mounted, also an empty one.
      if (tree.get(path)?.kind === 'volume') throw fail('EBUSY', asked)
      // A mount holds nothing of its own: what is behind it does not keep it from going.
      if ([...tree.keys()].some((each) => posix.dirname(each) === path)) throw fail('ENOTEMPTY', asked)
      if (!tree.delete(path)) throw fail('ENOENT', asked)
    },
    // fs.rmSync as every system but Windows has it: a link goes as a link, a missing path is fine
    // with "force". It goes into a volume mounted in the tree, as measured on macOS: the files of
    // the volume go, the mount point stays with the folders on the way to it, and the call throws.
    rmSync: (asked, options) => {
      step(`rmSync ${asked}${options.recursive ? ' recursive' : ''}${options.force ? ' force' : ''}`)
      const path = real(asked)
      const entry = tree.get(path)
      if (entry === undefined) return
      if ((entry.kind === 'folder' || entry.kind === 'volume') && !options.recursive) throw fail('ERR_FS_EISDIR', path)
      const below = [...tree.keys()].filter((each) => each === path || each.startsWith(`${path}/`))
      const volumes = below.filter((each) => tree.get(each)?.kind === 'volume')
      for (const each of below) if (!volumes.some((volume) => volume === each || volume.startsWith(`${each}/`))) tree.delete(each)
      // The mount point itself: "Resource busy", and no code (measured).
      if (volumes.includes(path)) throw new Error(`Unknown error: Resource busy, rm '${path}'`)
      if (volumes.length > 0) throw fail('ENOTEMPTY', path)
    },
  })
  const wait = (ms: number): void => {
    if (waits.length >= WAITS_BOUND) throw new Error(`the removal waits without end: ${WAITS_BOUND} waits, and one more is asked`)
    waits.push(ms)
  }
  return { fs, calls, waits, wait, names: () => [...tree.keys()].sort() }
}

/** A Card folder with a file, a folder, and a link to a folder outside it that holds a file. */
export const WITH_A_LINK: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/card': { kind: 'folder' },
  '/data/card/index.html': { kind: 'file' },
  '/data/card/assets': { kind: 'folder' },
  '/data/card/assets/app.js': { kind: 'file' },
  '/data/card/linked': { kind: 'link', to: '/home/notes' },
  '/home': { kind: 'folder' },
  '/home/notes': { kind: 'folder' },
  '/home/notes/keep.txt': { kind: 'file' },
}

/** A Card folder that holds a mount to another volume (worfy-windows ticket 35), and the files of that volume. */
export const WITH_A_MOUNT: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/card': { kind: 'folder' },
  '/data/card/index.html': { kind: 'file' },
  '/data/card/linked': { kind: 'mount', to: '/vol' },
  '/vol': { kind: 'folder' },
  '/vol/keep.txt': { kind: 'file' },
  '/vol/deep': { kind: 'folder' },
  '/vol/deep/more.txt': { kind: 'file' },
}
export const VOLUME = ['/vol', '/vol/deep', '/vol/deep/more.txt', '/vol/keep.txt']
/**
 * The same Card, with a mount whose volume is gone (worfy-windows ticket 45): lstat and a listing of
 * it answer ENOENT, the listing of the Card names it, and rmdir removes it. Measured on the PC under
 * both Nodes, with a junction by GUID whose target folder was removed (ticket 45) and with one whose
 * volume was detached (measurement 6 of ticket 45).
 */
export const WITH_A_DETACHED_MOUNT: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/card': { kind: 'folder' },
  '/data/card/index.html': { kind: 'file' },
  '/data/card/linked': { kind: 'mount', to: '/vol' },
}
/** The same Card, with a mount that leads to a folder of its own volume: its `dev` says nothing. */
export const WITH_A_MOUNT_ON_ITS_VOLUME: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/card': { kind: 'folder' },
  '/data/card/index.html': { kind: 'file' },
  '/data/card/linked': { kind: 'mount', to: '/home/notes' },
  '/home': { kind: 'folder' },
  '/home/notes': { kind: 'folder' },
  '/home/notes/keep.txt': { kind: 'file' },
}
/**
 * A folder reached through an ordinary link to another volume: the link is the parent of what is
 * removed. Beside the folder lies a mount (worfy-windows ticket 45) that leads back to a folder of
 * the first volume.
 */
export const BEHIND_A_LINK_TO_ANOTHER_VOLUME: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/away': { kind: 'link', to: '/vol/r' },
  '/vol': { kind: 'folder' },
  '/vol/r': { kind: 'folder' },
  '/vol/r/sub': { kind: 'folder' },
  '/vol/r/sub/f.txt': { kind: 'file' },
  '/vol/r/empty': { kind: 'folder' },
  '/vol/r/m': { kind: 'mount', to: '/home/notes' },
  '/home': { kind: 'folder' },
  '/home/notes': { kind: 'folder' },
  '/home/notes/keep.txt': { kind: 'file' },
}
/** An entry of the trash whose Card folder is a mount, and one whose Card folder holds a mount. */
export const TRASH_CARD_IS_A_MOUNT: Record<string, Entry> = {
  '/trash': { kind: 'folder' },
  '/trash/entry': { kind: 'folder' },
  '/trash/entry/entry.json': { kind: 'file' },
  '/trash/entry/card': { kind: 'mount', to: '/vol' },
  '/vol': { kind: 'folder' },
  '/vol/keep.txt': { kind: 'file' },
  '/vol/deep': { kind: 'folder' },
  '/vol/deep/more.txt': { kind: 'file' },
}
export const TRASH_CARD_HOLDS_A_MOUNT: Record<string, Entry> = {
  '/trash': { kind: 'folder' },
  '/trash/entry': { kind: 'folder' },
  '/trash/entry/entry.json': { kind: 'file' },
  '/trash/entry/card': { kind: 'folder' },
  '/trash/entry/card/index.html': { kind: 'file' },
  '/trash/entry/card/linked': { kind: 'mount', to: '/vol' },
  '/vol': { kind: 'folder' },
  '/vol/keep.txt': { kind: 'file' },
  '/vol/deep': { kind: 'folder' },
  '/vol/deep/more.txt': { kind: 'file' },
}
/**
 * A Card folder that holds a mount point of macOS (worfy-windows ticket 44) with the files of its
 * volume, and entries that are listed before it and after it.
 */
export const CARD_HOLDS_A_VOLUME: Record<string, Entry> = {
  '/data': { kind: 'folder' },
  '/data/card': { kind: 'folder' },
  '/data/card/assets': { kind: 'folder' },
  '/data/card/assets/app.js': { kind: 'file' },
  '/data/card/index.html': { kind: 'file' },
  '/data/card/vol': { kind: 'volume' },
  '/data/card/vol/keep.txt': { kind: 'file' },
  '/data/card/vol/deep': { kind: 'folder' },
  '/data/card/vol/deep/more.txt': { kind: 'file' },
  '/data/card/z.txt': { kind: 'file' },
}

/** The module's walk over a model; answers the code of the error it ended with, or null. */
export function viaModule(m: Model, path: string, platform: NodeJS.Platform): unknown {
  try {
    removeTree(path, { fs: m.fs, platform, wait: m.wait })
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

/** The text between the two marks of a copy: `remove-tree` for the walk, `remove-file` for the removal of one file. */
export function copyOf(source: string, where: string, name: 'remove-tree' | 'remove-file' = 'remove-tree'): string {
  const start = source.indexOf(`// <${name}>`)
  const end = source.indexOf(`// </${name}>`)
  if (start < 0 || end < start) throw new Error(`${where} has nothing between // <${name}> and // </${name}>`)
  return source.slice(start, end).replace(/^export /m, '')
}

/** A copy as a function over a model: it names the calls of node:fs, `join`, `process` and `Atomics` freely. */
export function viaCopy(text: string, m: Model, path: string, platform: NodeJS.Platform, name: 'removeTree' | 'removeFile' = 'removeTree'): unknown {
  const walk = builtCopy(text, m, platform, name)
  try {
    walk(path)
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

/**
 * The function of a copy, made over a model. Strict, as the scripts are: they are modules. `atomics`
 * is what the copy waits with; the model's wait when left out.
 */
export function builtCopy(text: string, m: Model, platform: NodeJS.Platform, name: 'removeTree' | 'removeFile' = 'removeTree', atomics?: unknown): (...args: unknown[]) => void {
  const make = new Function('lstatSync', 'readdirSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'join', 'process', 'Atomics', `'use strict'\n${text}\nreturn ${name}`) as (...args: unknown[]) => (...args: unknown[]) => void
  const waiting = { wait: (_array: unknown, _index: number, _value: number, ms: number) => m.wait(ms) }
  return make(m.fs.lstatSync, m.fs.readdirSync, m.fs.unlinkSync, m.fs.rmdirSync, m.fs.rmSync, posix.join, { platform }, atomics ?? waiting)
}

/** The copies of the removal, by where each lives: the text between the marks of each. */
export const COPIES: Record<string, string> = {
  'the text of restore.mjs (src/main/harness/migrate/restore.ts)': copyOf(restoreScriptSource(), 'restore.mjs'),
  'scripts/remove-tree.mjs': copyOf(readFileSync(join(REPO, 'scripts', 'remove-tree.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'scripts/remove-tree.mjs'),
  'scripts/install-stable.mjs': copyOf(readFileSync(join(REPO, 'scripts', 'install-stable.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'scripts/install-stable.mjs'),
}

/** The `rmSync` of a model with `recursive` and `force`, as the removal off Windows calls it: for the tests that show what that call alone does. */
export const rmSyncOver = (m: Model, path: string): void => m.fs.rmSync(path, { recursive: true, force: true })

/** What a removal ended with: null when it returned, else the code, the words and the path of its error. */
export interface End {
  code: string | undefined
  message: string
  path: string | undefined
}
const endOf = (remove: () => void): End | null => {
  try {
    remove()
    return null
  } catch (error) {
    const { code, message, path } = error as NodeJS.ErrnoException
    return { code, message, path }
  }
}
/** The removal of the module over a model, with the whole of the error it ended with. */
export const endViaModule = (m: Model, path: string, platform: NodeJS.Platform): End | null => endOf(() => removeTree(path, { fs: m.fs, platform, wait: m.wait }))
/** The removal of a copy over a model, with the whole of the error it ended with. */
export const endViaCopy = (text: string, m: Model, path: string, platform: NodeJS.Platform): End | null => endOf(() => builtCopy(text, m, platform)(path))
