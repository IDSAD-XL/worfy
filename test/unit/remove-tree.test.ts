// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. Three parts:
//   - real folders: on Windows with junctions, a `dir` and a `file` symlink and a read-only file,
//     elsewhere with symlinks; this is where Node 24's fs.rmSync loses the folder behind a junction;
//   - a model of the file system: the order of the calls, and the tries on Windows when a file is busy;
//   - the copies of the walk that cannot import the module — the text of restore.mjs and
//     scripts/remove-tree.mjs — run over the same model and must make the same calls.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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

  it('removeFile refuses a folder, as a removal without "recursive" did, and takes a path that is not there', () => {
    const folder = join(dir, 'folder')
    mkdirSync(folder)
    writeFileSync(join(folder, 'kept.txt'), 'x')
    expect(() => removeFile(folder)).toThrow(/is a folder: removeFile removes a file or a link/)
    expect((() => {
      try {
        removeFile(folder)
        return null
      } catch (error) {
        return (error as NodeJS.ErrnoException).code
      }
    })()).toBe('EISDIR')
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
}
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
  })
  return { fs, calls, waits, names: () => [...tree.keys()].sort() }
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
    removeTree(path, { fs: m.fs, platform, wait: (ms) => m.waits.push(ms) })
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

describe('removeTree over a model of the file system', () => {
  it('never reads the folder a link leads to: the link is unlinked, and what is behind it stays', () => {
    const m = model(WITH_A_LINK)
    const calls = (path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`))
    expect(viaModule(m, '/data/card', 'linux')).toBeNull()
    expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
    expect(calls('/data/card/linked')).toEqual(['lstat /data/card/linked', 'unlink /data/card/linked'])
    expect(m.calls.some((call) => call.includes('/home'))).toBe(false)
    // A folder is emptied before it is removed, and removed last.
    expect(m.calls.at(-1)).toBe('rmdir /data/card')
  })

  it('on Windows tries a busy step again after 100 ms, up to five times, then gives the error; elsewhere not at all', () => {
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

    for (const platform of ['darwin', 'linux'] as const) {
      const elsewhere = busyTwice()
      expect(viaModule(elsewhere, '/f', platform), platform).toBe('EBUSY')
      expect(elsewhere.calls).toEqual(['lstat /f', 'unlink /f'])
      expect(elsewhere.waits).toEqual([])
    }
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
})

/** The text between the two marks of a copy of the walk. */
function copyOf(source: string, where: string): string {
  const start = source.indexOf('// <remove-tree>')
  const end = source.indexOf('// </remove-tree>')
  if (start < 0 || end < start) throw new Error(`${where} has no walk between // <remove-tree> and // </remove-tree>`)
  return source.slice(start, end).replace(/^export /m, '')
}

/** A copy of the walk as a function over a model: it names the calls of node:fs, `join`, `process` and `Atomics` freely. */
function viaCopy(text: string, m: Model, path: string, platform: NodeJS.Platform): unknown {
  const make = new Function('lstatSync', 'readdirSync', 'unlinkSync', 'rmdirSync', 'join', 'process', 'Atomics', `${text}\nreturn removeTree`) as (...args: unknown[]) => (path: string) => void
  const waiting = { wait: (_array: unknown, _index: number, _value: number, ms: number) => void m.waits.push(ms) }
  const walk = make(m.fs.lstatSync, m.fs.readdirSync, m.fs.unlinkSync, m.fs.rmdirSync, posix.join, { platform }, waiting)
  try {
    walk(path)
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

describe('the copies of the walk that cannot import the module', () => {
  const COPIES: Record<string, string> = {
    'the text of restore.mjs (src/main/harness/migrate/restore.ts)': copyOf(restoreScriptSource(), 'restore.mjs'),
    'scripts/remove-tree.mjs': copyOf(readFileSync(join(REPO, 'scripts', 'remove-tree.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'scripts/remove-tree.mjs'),
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

  it('the two copies are the same text, and the text of restore.mjs has no backquote in it', () => {
    const [restore, script] = Object.values(COPIES)
    expect(restore).toBe(script)
    expect(restore).not.toContain('`')
  })
})
