// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. On Windows that is a walk of the module's own; on every other system
// it is fs.rmSync, as before the module. Three parts:
//   - real folders: on Windows with junctions, a `dir` and a `file` symlink and a read-only file,
//     elsewhere with symlinks; this is where the fs.rmSync of Electron's Node loses the folder
//     behind a junction;
//   - a model of the file system: the order of the calls of the walk, its tries when a file is
//     busy, and the one call every other system makes;
//   - the copies that cannot import the module — the text of restore.mjs, scripts/remove-tree.mjs
//     and scripts/install-stable.mjs — run over the same model and must make the same calls.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreScriptSource } from '../../src/main/harness/migrate/restore'
import { REMOVE_RETRIES, REMOVE_RETRY_MS, removeFile, removeTree, type RemoveFs } from '../../src/main/storage/remove'

const WINDOWS = process.platform === 'win32'
const REPO = join(import.meta.dirname, '..', '..')

describe('removeTree and removeFile over real folders', () => {
  let dir: string
  /** The links the test made, removed as links at the end whatever the test did. */
  let links: string[]
  /** A folder outside what is removed, with a file in it. */
  let outside: string
  /** The kinds of link to a folder this system has: on Windows a junction and a symlink, elsewhere a symlink. */
  const FOLDER_LINKS = WINDOWS ? (['junction', 'dir'] as const) : (['dir'] as const)
  const link = (target: string, at: string, kind: 'junction' | 'dir' | 'file'): void => {
    symlinkSync(target, at, kind)
    links.push(at)
  }
  const gone = (path: string): boolean => {
    try {
      lstatSync(path)
      return false
    } catch {
      return true
    }
  }

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-remove-tree-')))
    links = []
    outside = join(dir, 'outside')
    mkdirSync(join(outside, 'deep'), { recursive: true })
    writeFileSync(join(outside, 'notes.txt'), 'keep me')
    writeFileSync(join(outside, 'deep', 'more.txt'), 'keep me too')
  })

  afterEach(() => {
    for (const at of links) {
      try {
        rmdirSync(at)
      } catch {
        try {
          unlinkSync(at)
        } catch {
          // Removed by the test, as it should be.
        }
      }
    }
    // The module under test clears its own scratch folder: no link is left in it by now.
    removeTree(dir)
  })
  const outsideIsWhole = (): void => {
    expect(readdirSync(outside).sort()).toEqual(['deep', 'notes.txt'])
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe('keep me')
    expect(readFileSync(join(outside, 'deep', 'more.txt'), 'utf8')).toBe('keep me too')
  }

  it('removes a folder with files and folders in it, a single file, and takes a path that is not there', () => {
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'a', 'b'), { recursive: true })
    writeFileSync(join(tree, 'top.txt'), '1')
    writeFileSync(join(tree, 'a', 'b', 'deep.txt'), '2')
    mkdirSync(join(tree, 'empty'))
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
    const file = join(dir, 'one.txt')
    writeFileSync(file, 'x')
    removeTree(file)
    expect(existsSync(file)).toBe(false)
    expect(() => removeTree(join(dir, 'never-was'))).not.toThrow()
    expect(() => removeTree(join(dir, 'never-was', 'deeper'))).not.toThrow()
    outsideIsWhole()
  })

  it.each(FOLDER_LINKS)('a %s link to a folder, inside the folder that is removed: the link goes, the folder behind it keeps its files', (kind) => {
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'sub'), { recursive: true })
    writeFileSync(join(tree, 'sub', 'own.txt'), 'mine')
    link(outside, join(tree, 'sub', 'linked'), kind)
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
    outsideIsWhole()
  })

  it.each(FOLDER_LINKS)('a %s link to a folder as the path itself: only the link goes, by removeTree and by removeFile', (kind) => {
    for (const remove of [removeTree, removeFile]) {
      const at = join(dir, `link-${remove.name}`)
      link(outside, at, kind)
      remove(at)
      expect(gone(at), remove.name).toBe(true)
      outsideIsWhole()
    }
  })

  it('a link to a file goes as a link, and a link that leads nowhere goes too', () => {
    const at = join(dir, 'file-link')
    link(join(outside, 'notes.txt'), at, 'file')
    removeFile(at)
    expect(gone(at)).toBe(true)
    const tree = join(dir, 'tree')
    mkdirSync(tree)
    link(join(outside, 'notes.txt'), join(tree, 'to-a-file'), 'file')
    link(join(dir, 'nothing-here'), join(tree, 'dangling'), 'file')
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
    outsideIsWhole()
  })

  it('removes a read-only file, alone and inside a folder', () => {
    const alone = join(dir, 'read-only.txt')
    writeFileSync(alone, 'x')
    chmodSync(alone, 0o444)
    removeFile(alone)
    expect(existsSync(alone)).toBe(false)
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'objects'), { recursive: true })
    writeFileSync(join(tree, 'objects', 'packed'), 'x')
    chmodSync(join(tree, 'objects', 'packed'), 0o444)
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
  })

  // Review round 1 of PR #257: the walk of Windows does not end at the first entry it cannot remove.
  it.runIf(WINDOWS)('goes on past a folder that Windows will not let go — the working folder of a running program — removes the rest, and reports that folder at the end', async () => {
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'held', 'inner'), { recursive: true })
    writeFileSync(join(tree, 'a.txt'), 'a')
    writeFileSync(join(tree, 'held', 'in.txt'), 'in')
    writeFileSync(join(tree, 'z.txt'), 'z')
    // The program takes its working folder while it starts, after spawn() has returned: the line it
    // prints says it is running. Then it waits for a key on an input that stays open.
    const holder = spawn(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'echo ready& pause'], { cwd: join(tree, 'held', 'inner'), stdio: ['pipe', 'pipe', 'ignore'] })
    try {
      await new Promise((resolve, reject) => {
        holder.stdout.once('data', resolve)
        holder.once('error', reject)
        holder.once('exit', () => reject(new Error('the program that holds the folder ended at once')))
      })
      let code: string | undefined
      // The real wait, refused after more waits than any removal makes: a retry with no end would
      // block this process for good — the loop is synchronous, no time limit of a test ends it.
      let asked = 0
      const wait = (ms: number): void => {
        if (++asked > 50) throw new Error('the removal waits without end')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
      }
      try {
        removeTree(tree, { wait })
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code
      }
      expect(asked).toBeLessThanOrEqual(REMOVE_RETRIES)
      expect(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']).toContain(code)
      // Everything that could go is gone; what holds the folder is left with its way to it.
      expect(readdirSync(tree)).toEqual(['held'])
      expect(readdirSync(join(tree, 'held'))).toEqual(['inner'])
    } finally {
      const gone = new Promise((resolve) => holder.once('exit', resolve))
      holder.kill()
      await gone
    }
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
  }, 30_000)

  // Review round 2 of PR #257. Every call of the application comes with no options, so it is the
  // machine that says which way a removal goes. A folder nothing may be removed from tells the two
  // ways apart: the walk would fail in unlink of the file in it, fs.rmSync fails as "rm" — with
  // whatever code this system gives, which is why the same tree is given to fs.rmSync first.
  it.skipIf(WINDOWS)('off Windows is fs.rmSync for a call with no options, on real folders: it fails as that call does, and leaves what that call leaves', () => {
    const grow = (name: string): string => {
      const tree = join(dir, name)
      mkdirSync(join(tree, 'locked'), { recursive: true })
      writeFileSync(join(tree, 'a.txt'), 'x')
      writeFileSync(join(tree, 'locked', 'inner.txt'), 'x')
      writeFileSync(join(tree, 'z.txt'), 'x')
      chmodSync(join(tree, 'locked'), 0o555)
      return tree
    }
    const outcome = (tree: string, remove: (path: string) => void): unknown => {
      let failure: { code?: string; syscall?: string } | null = null
      try {
        remove(tree)
      } catch (error) {
        const { code, syscall } = error as NodeJS.ErrnoException
        failure = { code, syscall }
      }
      return { failure, left: existsSync(tree) ? readdirSync(tree, { recursive: true }).map(String).sort() : null }
    }
    const [twin, tree] = [grow('twin'), grow('tree')]
    try {
      const asRmSync = outcome(twin, (path) => rmSync(path, { recursive: true, force: true }))
      const asRemoveTree = outcome(tree, (path) => removeTree(path))
      expect(asRemoveTree).toEqual(asRmSync)
      // A user who may remove anything (root) gets no failure from either; any other gets it from "rm".
      if ((asRmSync as { failure: unknown }).failure !== null) expect(asRemoveTree).toMatchObject({ failure: { syscall: 'rm' } })
    } finally {
      for (const each of [twin, tree]) if (existsSync(join(each, 'locked'))) chmodSync(join(each, 'locked'), 0o755)
    }
  })

  it('removeFile refuses a folder, as a removal without "recursive" did, and takes a path that is not there', () => {
    const folder = join(dir, 'folder')
    mkdirSync(folder)
    writeFileSync(join(folder, 'kept.txt'), 'x')
    // Off Windows the refusal is that of rmSync itself, as on main; its words are Node's.
    expect(() => removeFile(folder)).toThrow(WINDOWS ? /is a folder: removeFile removes a file or a link/ : /EISDIR/)
    expect((() => {
      try {
        removeFile(folder)
        return null
      } catch (error) {
        return (error as NodeJS.ErrnoException).code
      }
    })()).toBe(WINDOWS ? 'EISDIR' : 'ERR_FS_EISDIR')
    expect(readdirSync(folder)).toEqual(['kept.txt'])
    expect(() => removeFile(join(dir, 'never-was'))).not.toThrow()
  })
})

/**
 * A file system in memory, with POSIX names. A `link` is a name that leads to another path of the
 * model. The module joins names by the rules of the machine, so a backslash in a path it asks
 * about is read as a slash.
 */
type Entry = { kind: 'file' } | { kind: 'folder' } | { kind: 'link'; to: string }
interface Model {
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
function model(entries: Record<string, Entry>, failing: Record<string, string[]> = {}): Model {
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
  const fs: RemoveFs = posixNames({
    lstatSync: (path) => {
      step(`lstat ${path}`)
      const entry = tree.get(path)
      if (entry === undefined) throw fail('ENOENT', path)
      // lstat does not follow: a link to a folder is not a folder.
      return { isDirectory: () => entry.kind === 'folder' }
    },
    readdirSync: (path) => {
      step(`readdir ${path}`)
      const entry = tree.get(path)
      // A walk that came here through a link would be reading what the link leads to.
      const real = entry?.kind === 'link' ? entry.to : path
      return [...tree.keys()].filter((each) => posix.dirname(each) === real).map((each) => posix.basename(each))
    },
    unlinkSync: (path) => {
      step(`unlink ${path}`)
      if (tree.get(path)?.kind === 'folder') throw fail('EPERM', path)
      if (!tree.delete(path)) throw fail('ENOENT', path)
    },
    rmdirSync: (path) => {
      step(`rmdir ${path}`)
      if ([...tree.keys()].some((each) => posix.dirname(each) === path)) throw fail('ENOTEMPTY', path)
      if (!tree.delete(path)) throw fail('ENOENT', path)
    },
    // fs.rmSync as every system but Windows has it: a link goes as a link, a missing path is fine with "force".
    rmSync: (path, options) => {
      step(`rmSync ${path}${options.recursive ? ' recursive' : ''}${options.force ? ' force' : ''}`)
      const entry = tree.get(path)
      if (entry === undefined) return
      if (entry.kind === 'folder' && !options.recursive) throw fail('ERR_FS_EISDIR', path)
      for (const each of [...tree.keys()]) if (each === path || each.startsWith(`${path}/`)) tree.delete(each)
    },
  })
  const wait = (ms: number): void => {
    if (waits.length >= WAITS_BOUND) throw new Error(`the removal waits without end: ${WAITS_BOUND} waits, and one more is asked`)
    waits.push(ms)
  }
  return { fs, calls, waits, wait, names: () => [...tree.keys()].sort() }
}

/** A Card folder with a file, a folder, and a link to a folder outside it that holds a file. */
const WITH_A_LINK: Record<string, Entry> = {
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

/** The module's walk over a model; answers the code of the error it ended with, or null. */
function viaModule(m: Model, path: string, platform: NodeJS.Platform): unknown {
  try {
    removeTree(path, { fs: m.fs, platform, wait: m.wait })
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

describe('removeTree over a model of the file system', () => {
  it('never reads the folder a link leads to: the link is unlinked, and what is behind it stays', () => {
    const m = model(WITH_A_LINK)
    const calls = (path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`))
    expect(viaModule(m, '/data/card', 'win32')).toBeNull()
    expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
    expect(calls('/data/card/linked')).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked'])
    expect(m.calls.some((call) => call.includes('/home'))).toBe(false)
    // A folder is emptied before it is removed, and removed last.
    expect(m.calls.at(-1)).toBe('rmdir /data/card')
  })

  it('on every other system is one call of rmSync with "recursive" and "force", and nothing else: what main did', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const m = model(WITH_A_LINK)
      expect(viaModule(m, '/data/card', platform), platform).toBeNull()
      expect(m.calls, platform).toEqual(['rmSync /data/card recursive force'])
      expect(m.names(), platform).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(m.waits, platform).toEqual([])
    }
    // What rmSync throws is what the caller gets.
    const failing = model(WITH_A_LINK, { 'rmSync /data/card recursive force': ['ENOTEMPTY'] })
    expect(viaModule(failing, '/data/card', 'darwin')).toBe('ENOTEMPTY')
  })

  it('goes on past an entry that cannot be removed: the others go, the first error is thrown at the end, and the folder stays for what is left in it', () => {
    const tree: Record<string, Entry> = {
      '/d': { kind: 'folder' },
      '/d/a.txt': { kind: 'file' },
      '/d/held.txt': { kind: 'file' },
      '/d/sub': { kind: 'folder' },
      '/d/sub/also-held.txt': { kind: 'file' },
      '/d/sub/x.txt': { kind: 'file' },
      '/d/z.txt': { kind: 'file' },
    }
    const m = model(tree, { 'unlink /d/held.txt': ['EIO'], 'unlink /d/sub/also-held.txt': ['EROFS'] })
    // The first error, not the last.
    expect(viaModule(m, '/d', 'win32')).toBe('EIO')
    expect(m.names()).toEqual(['/d', '/d/held.txt', '/d/sub', '/d/sub/also-held.txt'])
    // Neither folder that still holds something is asked to go.
    expect(m.calls.filter((call) => call.startsWith('rmdir '))).toEqual([])
    expect(m.waits).toEqual([])
  })

  it('takes "nothing is there" in every form it comes in: a name on the way that is no folder, a folder gone between the look and the listing', () => {
    const below = model({ '/f': { kind: 'file' } }, { 'lstat /f/x': ['ENOTDIR'] })
    expect(viaModule(below, '/f/x', 'win32')).toBeNull()
    expect(below.calls).toEqual(['lstat /f/x'])
    const gone = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'readdir /d': ['ENOENT'] })
    expect(viaModule(gone, '/d', 'win32')).toBeNull()
    expect(gone.calls).toEqual(['lstat /d', 'readdir /d'])
    const unreadable = model({ '/d': { kind: 'folder' } }, { 'readdir /d': ['EACCES'] })
    expect(viaModule(unreadable, '/d', 'win32')).toBe('EACCES')
  })

  it('reads a path with a separator at its end as the path without it: a link named that way goes as a link', () => {
    for (const written of ['/data/card/linked/', '/data/card/linked//', '/data/card/linked\\', '/data/card/linked\\/', '/data/card/linked/\\']) {
      const m = model(WITH_A_LINK)
      expect(viaModule(m, written, 'win32'), written).toBeNull()
      expect(m.calls, written).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked'])
      expect(m.names(), written).toContain('/home/notes/keep.txt')
    }
    // The root of a disk keeps its separator: without it the path would name another folder. So
    // does a path that is separators and nothing else: without them it would be no path at all.
    for (const [written, asked] of [['C:\\', 'C:/'], ['C:/', 'C:/'], ['/', '/'], ['\\', '/']] as const) {
      const root = model({})
      viaModule(root, written, 'win32')
      expect(root.calls, written).toEqual([`lstat ${asked}`])
    }
  })

  it('on Windows tries a busy step again after 100 ms, up to five times, then gives the error', () => {
    const busyTwice = () => model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const twice = busyTwice()
    expect(viaModule(twice, '/f', 'win32')).toBeNull()
    expect(twice.calls).toEqual(['lstat /f', 'unlink /f', 'unlink /f', 'unlink /f'])
    expect(twice.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    expect(twice.names()).toEqual([])
    expect([REMOVE_RETRIES, REMOVE_RETRY_MS]).toEqual([5, 100])

    const always = model({ '/f': { kind: 'file' } }, { 'unlink /f': Array.from({ length: 10 }, () => 'EBUSY') })
    expect(viaModule(always, '/f', 'win32')).toBe('EBUSY')
    expect(always.calls.filter((call) => call === 'unlink /f')).toHaveLength(1 + REMOVE_RETRIES)
    expect(always.waits).toHaveLength(REMOVE_RETRIES)
  })

  // Review round 2 of PR #257. The walk goes on past an entry it cannot remove; were the tries
  // counted for each entry, a folder of files that a program holds would block the main process
  // for half a second a file.
  it('counts the waits for the whole removal, not for each entry: a folder of files that stay busy waits five times in all', () => {
    const files = Array.from({ length: 20 }, (_, index) => `/d/held-${String(index).padStart(2, '0')}.txt`)
    const tree = (): Record<string, Entry> => {
      const entries: Record<string, Entry> = { '/d': { kind: 'folder' } }
      for (const file of files) entries[file] = { kind: 'file' }
      return entries
    }
    const failing = (those: string[], codes: string[]): Record<string, string[]> => Object.fromEntries(those.map((file): [string, string[]] => [`unlink ${file}`, codes]))
    const forever = (code: string): string[] => Array.from({ length: 50 }, () => code)

    const held = model(tree(), failing(files, forever('EPERM')))
    expect(viaModule(held, '/d', 'win32')).toBe('EPERM')
    expect(held.waits).toEqual(Array.from({ length: REMOVE_RETRIES }, () => REMOVE_RETRY_MS))
    // The first file has its tries; every later one is asked once.
    const tries = (m: Model, file: string): number => m.calls.filter((call) => call === `unlink ${file}`).length
    expect(files.map((file) => tries(held, file))).toEqual([1 + REMOVE_RETRIES, ...files.slice(1).map(() => 1)])
    expect(held.names()).toEqual(['/d', ...files])

    // Files that are busy for a moment each: the waits last for five of them, the sixth fails at
    // its first try, and what is not busy goes all the same.
    const busyOnce = files.slice(0, 7)
    const passing = model(tree(), failing(busyOnce, ['EBUSY']))
    expect(viaModule(passing, '/d', 'win32')).toBe('EBUSY')
    expect(passing.waits).toHaveLength(REMOVE_RETRIES)
    expect(passing.names()).toEqual(['/d', ...busyOnce.slice(REMOVE_RETRIES)])

    // The folder at the end takes of the same waits: none is left for it here.
    const folder = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'unlink /d/a.txt': forever('EBUSY').slice(0, REMOVE_RETRIES), 'rmdir /d': ['ENOTEMPTY'] })
    expect(viaModule(folder, '/d', 'win32')).toBe('ENOTEMPTY')
    expect(folder.waits).toHaveLength(REMOVE_RETRIES)
    expect(folder.names()).toEqual(['/d'])

    // A second removal starts with all its waits.
    const again = model({ '/f': { kind: 'file' } }, { 'unlink /f': forever('EBUSY').slice(0, REMOVE_RETRIES) })
    expect(viaModule(again, '/f', 'win32')).toBeNull()
    expect(again.waits).toHaveLength(REMOVE_RETRIES)
  })

  it('tries again for a folder that is not empty yet, and never for an error that is not "busy"', () => {
    const folder = model({ '/d': { kind: 'folder' } }, { 'rmdir /d': ['ENOTEMPTY', 'EACCES'] })
    expect(viaModule(folder, '/d', 'win32')).toBeNull()
    expect(folder.waits).toHaveLength(2)
    const other = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EIO'] })
    expect(viaModule(other, '/f', 'win32')).toBe('EIO')
    expect(other.waits).toEqual([])
    const stat = model({ '/f': { kind: 'file' } }, { 'lstat /f': ['EACCES'] })
    expect(viaModule(stat, '/f', 'win32')).toBe('EACCES')
    expect(stat.calls).toEqual(['lstat /f'])
  })

  it('a path that goes away while it is being removed is removed: no error', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['ENOENT'] })
    expect(viaModule(m, '/f', 'win32')).toBeNull()
    expect(m.waits).toEqual([])
  })

  // worfy-windows ticket 28, from the review of PR #257.
  it('an error that is not "busy" spends no wait: all five are there for the entry after it', () => {
    const busy = Array.from({ length: REMOVE_RETRIES }, () => 'EBUSY')
    const m = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' }, '/d/b.txt': { kind: 'file' } }, { 'unlink /d/a.txt': ['EIO'], 'unlink /d/b.txt': busy })
    // The folder keeps the file that could not be removed, and says why.
    expect(viaModule(m, '/d', 'win32')).toBe('EIO')
    expect(m.calls.filter((call) => call === 'unlink /d/a.txt')).toHaveLength(1)
    expect(m.waits).toHaveLength(REMOVE_RETRIES)
    expect(m.names()).toEqual(['/d', '/d/a.txt'])
  })

  it('waits for real when no wait is given: two busy tries take two times 100 ms', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const started = performance.now()
    removeTree('/f', { fs: m.fs, platform: 'win32' })
    const took = performance.now() - started
    expect(m.names()).toEqual([])
    // Two waits of REMOVE_RETRY_MS; a timer of the system may come a few ms early.
    expect(took).toBeGreaterThanOrEqual(2 * REMOVE_RETRY_MS - 20)
    expect(took).toBeLessThan(2000)
  })

  it('a removal that would wait without end is stopped by the model: its test fails at once', () => {
    const m = model({ '/f': { kind: 'file' } })
    for (let asked = 0; asked < 100; asked++) m.wait(REMOVE_RETRY_MS)
    expect(() => m.wait(REMOVE_RETRY_MS)).toThrow('the removal waits without end')
  })
})

describe('removeFile over a model of the file system', () => {
  const single = (m: Model, path: string, platform: NodeJS.Platform): unknown => {
    try {
      removeFile(path, { fs: m.fs, platform, wait: m.wait })
      return null
    } catch (error) {
      return (error as NodeJS.ErrnoException).code
    }
  }

  it('on Windows unlinks a file and a link, never reads a folder, and refuses a folder without touching it', () => {
    const m = model(WITH_A_LINK)
    expect(single(m, '/data/card/linked', 'win32')).toBeNull()
    expect(single(m, '/data/card/index.html', 'win32')).toBeNull()
    expect(single(m, '/data/never-was', 'win32')).toBeNull()
    expect(single(m, '/data/card/assets', 'win32')).toBe('EISDIR')
    expect(m.calls).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked', 'lstat /data/card/index.html', 'unlink /data/card/index.html', 'lstat /data/never-was', 'lstat /data/card/assets'])
    expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
  })

  it('on Windows tries a busy file again, as the walk does, and reads a separator at the end of the path away', () => {
    const windows = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    expect(single(windows, '/f/', 'win32')).toBeNull()
    expect(windows.calls).toEqual(['lstat /f', 'unlink /f', 'unlink /f', 'unlink /f'])
    expect(windows.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    expect(windows.names()).toEqual([])
  })

  // worfy-windows ticket 28, from the review of PR #257.
  it('on Windows tries a file that stays busy five times more, and no further', () => {
    const busy = (times: number): string[] => Array.from({ length: times }, () => 'EBUSY')
    const fifth = model({ '/f': { kind: 'file' } }, { 'unlink /f': busy(REMOVE_RETRIES) })
    expect(single(fifth, '/f', 'win32')).toBeNull()
    expect(fifth.waits).toHaveLength(REMOVE_RETRIES)
    expect(fifth.names()).toEqual([])

    const sixth = model({ '/f': { kind: 'file' } }, { 'unlink /f': busy(REMOVE_RETRIES + 1) })
    expect(single(sixth, '/f', 'win32')).toBe('EBUSY')
    expect(sixth.calls.filter((call) => call === 'unlink /f')).toHaveLength(1 + REMOVE_RETRIES)
    expect(sixth.waits).toHaveLength(REMOVE_RETRIES)
    expect(sixth.names()).toEqual(['/f'])
    // An error that is not "busy" ends it at the first try.
    const other = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EIO'] })
    expect(single(other, '/f', 'win32')).toBe('EIO')
    expect(other.waits).toEqual([])
  })

  it('on every other system is one call of rmSync with "force" and without "recursive": a folder is refused by it, as on main', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const m = model(WITH_A_LINK)
      expect(single(m, '/data/card/linked', platform), platform).toBeNull()
      expect(single(m, '/data/never-was', platform), platform).toBeNull()
      expect(single(m, '/data/card/assets', platform), platform).toBe('ERR_FS_EISDIR')
      expect(m.calls, platform).toEqual(['rmSync /data/card/linked force', 'rmSync /data/never-was force', 'rmSync /data/card/assets force'])
      expect(m.names(), platform).toContain('/data/card/assets/app.js')
      expect(m.names(), platform).toContain('/home/notes/keep.txt')
    }
  })
})

/** The text between the two marks of a copy: `remove-tree` for the walk, `remove-file` for the removal of one file. */
function copyOf(source: string, where: string, name: 'remove-tree' | 'remove-file' = 'remove-tree'): string {
  const start = source.indexOf(`// <${name}>`)
  const end = source.indexOf(`// </${name}>`)
  if (start < 0 || end < start) throw new Error(`${where} has nothing between // <${name}> and // </${name}>`)
  return source.slice(start, end).replace(/^export /m, '')
}

/** A copy as a function over a model: it names the calls of node:fs, `join`, `process` and `Atomics` freely. */
function viaCopy(text: string, m: Model, path: string, platform: NodeJS.Platform, name: 'removeTree' | 'removeFile' = 'removeTree'): unknown {
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
function builtCopy(text: string, m: Model, platform: NodeJS.Platform, name: 'removeTree' | 'removeFile' = 'removeTree', atomics?: unknown): (...args: unknown[]) => void {
  const make = new Function('lstatSync', 'readdirSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'join', 'process', 'Atomics', `'use strict'\n${text}\nreturn ${name}`) as (...args: unknown[]) => (...args: unknown[]) => void
  const waiting = { wait: (_array: unknown, _index: number, _value: number, ms: number) => m.wait(ms) }
  return make(m.fs.lstatSync, m.fs.readdirSync, m.fs.unlinkSync, m.fs.rmdirSync, m.fs.rmSync, posix.join, { platform }, atomics ?? waiting)
}

describe('the copies of the walk that cannot import the module', () => {
  const COPIES: Record<string, string> = {
    'the text of restore.mjs (src/main/harness/migrate/restore.ts)': copyOf(restoreScriptSource(), 'restore.mjs'),
    'scripts/remove-tree.mjs': copyOf(readFileSync(join(REPO, 'scripts', 'remove-tree.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'scripts/remove-tree.mjs'),
    'scripts/install-stable.mjs': copyOf(readFileSync(join(REPO, 'scripts', 'install-stable.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'scripts/install-stable.mjs'),
  }
  /** What is removed, from which tree, with which calls made to fail. */
  const CASES: [string, Record<string, Entry>, string, Record<string, string[]>][] = [
    ['a folder with a link in it', WITH_A_LINK, '/data/card', {}],
    ['a link as the path itself', WITH_A_LINK, '/data/card/linked', {}],
    ['a file', WITH_A_LINK, '/data/card/index.html', {}],
    ['a path that is not there', WITH_A_LINK, '/data/never-was', {}],
    ['a busy file', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EBUSY', 'EPERM'] }],
    ['a file that stays busy', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EBUSY') }],
    ['a folder that is not empty at first', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['ENOTEMPTY'] }],
    ['an error that is not "busy"', WITH_A_LINK, '/data/card', { 'unlink /data/card/assets/app.js': ['EIO'] }],
    ['a file gone meanwhile', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['ENOENT'] }],
    ['a folder that cannot be read', WITH_A_LINK, '/data/card', { 'lstat /data/card/assets': ['EACCES'] }],
    ['a file that is "access denied" at first', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EACCES'] }],
    ['an entry that cannot be removed, among others', WITH_A_LINK, '/data/card', { 'unlink /data/card/assets/app.js': ['EIO'], 'unlink /data/card/index.html': ['EROFS'] }],
    ['a name on the way that is no folder', WITH_A_LINK, '/data/card/index.html/x', { 'lstat /data/card/index.html/x': ['ENOTDIR'] }],
    ['a folder gone between the look and the listing', WITH_A_LINK, '/data/card', { 'readdir /data/card/assets': ['ENOENT'] }],
    ['a listing that fails', WITH_A_LINK, '/data/card', { 'readdir /data/card/assets': ['EACCES'] }],
    ['rmSync that fails', WITH_A_LINK, '/data/card', { 'rmSync /data/card recursive force': ['ENOTEMPTY'] }],
    ['a link written with a separator at its end', WITH_A_LINK, '/data/card/linked/', {}],
    ['a link written with a backslash at its end', WITH_A_LINK, '/data/card/linked\\', {}],
    ['a folder written with separators at its end', WITH_A_LINK, '/data/card//', {}],
    ['separators and nothing else', WITH_A_LINK, '/', { 'lstat /': ['EIO'] }],
    ['the root of a disk', WITH_A_LINK, 'C:\\', {}],
    ['two files that stay busy: the waits are those of the whole removal', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EBUSY'), 'unlink /data/card/assets/app.js': Array.from({ length: 10 }, () => 'EPERM') }],
    ['a busy file, then a folder that is not empty at first: the same waits', WITH_A_LINK, '/data/card', { 'unlink /data/card/index.html': ['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY'], 'rmdir /data/card': ['ENOTEMPTY', 'ENOTEMPTY'] }],
  ]

  it.each(Object.keys(COPIES))('%s makes the same calls as the module, in the same order, with the same tries and the same end', (name) => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const [what, tree, path, failing] of CASES) {
        const [ours, theirs] = [model(tree, failing), model(tree, failing)]
        const [ourEnd, theirEnd] = [viaModule(ours, path, platform), viaCopy(COPIES[name]!, theirs, path, platform)]
        const where = `${what} on ${platform}`
        expect(theirs.calls, where).toEqual(ours.calls)
        expect(theirEnd, where).toBe(ourEnd)
        expect(theirs.waits, where).toEqual(ours.waits)
        expect(theirs.names(), where).toEqual(ours.names())
      }
    }
  })

  // worfy-windows ticket 28, from the review of PR #257: the waits were the second parameter of
  // the function the callers use, and forEach gives a callback the number of the entry there.
  it.each(Object.keys(COPIES))('%s takes the path alone: given to forEach it removes each path, and a busy one ends with its own error', (name) => {
    const m = model({ '/a': { kind: 'file' }, '/b': { kind: 'file' }, '/c': { kind: 'file' } }, { 'unlink /b': Array.from({ length: 10 }, () => 'EBUSY') })
    const removeTreeOfTheCopy = builtCopy(COPIES[name]!, m, 'win32')
    expect(removeTreeOfTheCopy).toHaveLength(1)
    ;['/a'].forEach(removeTreeOfTheCopy)
    expect(m.names()).toEqual(['/b', '/c'])
    let code: unknown = null
    try {
      ;['/c', '/b'].forEach(removeTreeOfTheCopy)
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code
    }
    // Not a TypeError of a number taken for the waits.
    expect(code).toBe('EBUSY')
    expect(m.waits).toHaveLength(REMOVE_RETRIES)
    expect(m.names()).toEqual(['/b'])
  })

  it.each(Object.keys(COPIES))('%s starts every removal with five waits, and an error that is not "busy" spends none', (name) => {
    const busy = Array.from({ length: REMOVE_RETRIES }, () => 'EBUSY')
    const m = model(
      { '/first': { kind: 'file' }, '/second': { kind: 'file' }, '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' }, '/d/b.txt': { kind: 'file' } },
      { 'unlink /first': busy, 'unlink /second': busy, 'unlink /d/a.txt': ['EIO'], 'unlink /d/b.txt': busy },
    )
    const removeTreeOfTheCopy = builtCopy(COPIES[name]!, m, 'win32')
    removeTreeOfTheCopy('/first')
    removeTreeOfTheCopy('/second')
    expect(m.waits).toHaveLength(2 * REMOVE_RETRIES)
    expect(() => removeTreeOfTheCopy('/d')).toThrow('EIO')
    expect(m.waits).toHaveLength(3 * REMOVE_RETRIES)
    expect(m.names()).toEqual(['/d', '/d/a.txt'])
  })

  it('a copy waits for real with Atomics: two busy tries take two times 100 ms', () => {
    const m = model({ '/f': { kind: 'file' } }, { 'unlink /f': ['EBUSY', 'EPERM'] })
    const removeTreeOfTheCopy = builtCopy(Object.values(COPIES)[0]!, m, 'win32', 'removeTree', Atomics)
    const started = performance.now()
    removeTreeOfTheCopy('/f')
    const took = performance.now() - started
    expect(m.names()).toEqual([])
    expect(took).toBeGreaterThanOrEqual(2 * REMOVE_RETRY_MS - 20)
    expect(took).toBeLessThan(2000)
  })

  it('the copies are the same text, and that text has no backquote in it: one of them lives in a template string', () => {
    const [restore, ...others] = Object.values(COPIES)
    for (const other of others) expect(other).toBe(restore)
    expect(restore).not.toContain('`')
  })

  it('removeFile of restore.mjs makes the same calls as removeFile of the module, with the same tries and the same end', () => {
    const copy = copyOf(restoreScriptSource(), 'restore.mjs', 'remove-file')
    expect(copy).not.toContain('`')
    const cases: [string, string, Record<string, string[]>][] = [
      ['a file', '/data/card/index.html', {}],
      ['a link', '/data/card/linked', {}],
      ['a path that is not there', '/data/never-was', {}],
      ['a folder', '/data/card/assets', {}],
      ['a busy file', '/data/card/index.html', { 'unlink /data/card/index.html': ['EBUSY', 'EACCES'] }],
      ['a file that stays busy', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 10 }, () => 'EPERM') }],
      ['a file that is busy five times', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 5 }, () => 'EBUSY') }],
      ['a file that is busy six times', '/data/card/index.html', { 'unlink /data/card/index.html': Array.from({ length: 6 }, () => 'EBUSY') }],
      ['an error that is not "busy"', '/data/card/index.html', { 'unlink /data/card/index.html': ['EIO'] }],
      ['a file gone meanwhile', '/data/card/index.html', { 'unlink /data/card/index.html': ['ENOENT'] }],
      ['a name on the way that is no folder', '/data/card/index.html/x', { 'lstat /data/card/index.html/x': ['ENOTDIR'] }],
      ['a look that fails', '/data/card/index.html', { 'lstat /data/card/index.html': ['EACCES'] }],
      ['rmSync that fails', '/data/card/index.html', { 'rmSync /data/card/index.html force': ['EPERM'] }],
      ['a link written with a separator at its end', '/data/card/linked/', {}],
      ['a file written with a backslash at its end', '/data/card/index.html\\', {}],
      ['a folder written with a separator at its end', '/data/card/assets/', {}],
    ]
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const [what, path, failing] of cases) {
        const [ours, theirs] = [model(WITH_A_LINK, failing), model(WITH_A_LINK, failing)]
        let ourEnd: unknown = null
        try {
          removeFile(path, { fs: ours.fs, platform, wait: ours.wait })
        } catch (error) {
          ourEnd = (error as NodeJS.ErrnoException).code
        }
        const theirEnd = viaCopy(copy, theirs, path, platform, 'removeFile')
        const where = `${what} on ${platform}`
        expect(theirs.calls, where).toEqual(ours.calls)
        expect(theirEnd, where).toBe(ourEnd)
        expect(theirs.waits, where).toEqual(ours.waits)
        expect(theirs.names(), where).toEqual(ours.names())
      }
    }
  })
})
