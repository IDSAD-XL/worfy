// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. On Windows that is a walk of the module's own; on every other system
// it is fs.rmSync, as before the module, after a look through the tree for a mounted volume
// (worfy-windows ticket 44). Three parts:
//   - real folders: on Windows with junctions, a `dir` and a `file` symlink and a read-only file,
//     elsewhere with symlinks; this is where the fs.rmSync of Electron's Node loses the folder
//     behind a junction;
//   - a model of the file system: the order of the calls of the walk, its tries when a file is
//     busy, and the calls every other system makes;
//   - the copies that cannot import the module — the text of restore.mjs, scripts/remove-tree.mjs
//     and scripts/install-stable.mjs — run over the same model and must make the same calls.
// The model, its trees and the copies are in test/unit/remove-tree-model.ts; the tests of a volume
// mounted in the tree off Windows are in test/unit/remove-tree-mounted.test.ts.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreScriptSource } from '../../src/main/harness/migrate/restore'
import { REMOVE_RETRIES, REMOVE_RETRY_MS, removeFile, removeTree } from '../../src/main/storage/remove'
import {
  BEHIND_A_LINK_TO_ANOTHER_VOLUME,
  builtCopy,
  CARD_HOLDS_A_VOLUME,
  COPIES,
  copyOf,
  model,
  TRASH_CARD_HOLDS_A_MOUNT,
  TRASH_CARD_IS_A_MOUNT,
  viaCopy,
  viaModule,
  VOLUME,
  WITH_A_LINK,
  WITH_A_MOUNT,
  WITH_A_MOUNT_ON_ITS_VOLUME,
  type Entry,
  type Model,
} from './remove-tree-model'

const WINDOWS = process.platform === 'win32'

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

  // worfy-windows ticket 28, from the review of PR #257. Over a model with POSIX names the walk went
  // wrong on `link\..\victim`: the listing was of the folder the system reaches through the link,
  // and `join` wrote the names under the folder the text of the path names. Windows — the only
  // system the walk runs on — resolves `..` in the text of a path before it looks at the disk, so
  // the look, the listing and the joined names are of one folder: the one beside the link.
  it.runIf(WINDOWS).each(FOLDER_LINKS)('on Windows a path that goes up from a %s link names the folder beside the link, not the one beside what the link leads to', (kind) => {
    const tree = join(dir, 'tree')
    const far = join(dir, 'far')
    mkdirSync(join(tree, 'victim', 'sub'), { recursive: true })
    writeFileSync(join(tree, 'victim', 'same-name.txt'), 'beside the link')
    writeFileSync(join(tree, 'victim', 'sub', 'deep.txt'), 'x')
    mkdirSync(join(far, 'inner'), { recursive: true })
    mkdirSync(join(far, 'victim'))
    writeFileSync(join(far, 'victim', 'same-name.txt'), 'beside what the link leads to')
    link(join(far, 'inner'), join(tree, 'link'), kind)
    // Written out, not joined: join would resolve `..` itself.
    const written = `${tree}\\link\\..\\victim`
    removeTree(written)
    expect(readdirSync(tree)).toEqual(['link'])
    expect(readdirSync(far).sort()).toEqual(['inner', 'victim'])
    expect(readFileSync(join(far, 'victim', 'same-name.txt'), 'utf8')).toBe('beside what the link leads to')
    // removeFile reads the path the same way.
    writeFileSync(join(tree, 'victim'), 'a file now')
    removeFile(written)
    expect(readdirSync(tree)).toEqual(['link'])
    expect(readdirSync(join(far, 'victim'))).toEqual(['same-name.txt'])
    outsideIsWhole()
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

  // worfy-windows ticket 44. Off Windows the tree is looked through before fs.rmSync is called, for
  // a folder a volume is mounted on; a part of the tree that cannot be looked at may hold one. So
  // the removal ends with the error of the look and removes nothing; fs.rmSync alone would have
  // removed what it reached before that folder. Not for root, whom no mode keeps out.
  it.skipIf(WINDOWS || process.getuid?.() === 0)('off Windows a tree with a folder that cannot be listed loses nothing: the removal ends with the error of the look, before fs.rmSync is called', () => {
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'closed'), { recursive: true })
    writeFileSync(join(tree, 'a.txt'), 'x')
    writeFileSync(join(tree, 'closed', 'inner.txt'), 'x')
    writeFileSync(join(tree, 'z.txt'), 'x')
    chmodSync(join(tree, 'closed'), 0o000)
    try {
      let failure: NodeJS.ErrnoException | null = null
      try {
        removeTree(tree)
      } catch (error) {
        failure = error as NodeJS.ErrnoException
      }
      // The error of the listing, not the "rm" of fs.rmSync: that call was not reached.
      expect(failure).toMatchObject({ code: 'EACCES', syscall: 'scandir', path: join(tree, 'closed') })
      expect(readdirSync(tree).sort()).toEqual(['a.txt', 'closed', 'z.txt'])
    } finally {
      chmodSync(join(tree, 'closed'), 0o755)
    }
    expect(readdirSync(join(tree, 'closed'))).toEqual(['inner.txt'])
    removeTree(tree)
    expect(existsSync(tree)).toBe(false)
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

  // worfy-windows ticket 35. Measured on the PC: the walk of main listed a junction that leads to a
  // volume by its GUID — lstat calls it a folder — and removed every file of that volume.
  describe('a folder that lstat does not see as the link it is (worfy-windows ticket 35)', () => {
    const through = (m: Model, path: string): string[] => m.calls.filter((call) => call.endsWith(` ${path}`) || call.includes(`${path}/`))

    it('inside the folder that is removed: it is on another volume, so it is never listed — one rmdir takes it, and the volume keeps its files', () => {
      const m = model(WITH_A_MOUNT)
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', ...VOLUME])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
    })

    it('as the path itself: the volume of its parent folder is asked, and it goes by one rmdir', () => {
      const m = model(WITH_A_MOUNT)
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked'])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    it('on the volume of its folder, where the volume says nothing: the first thing asked of any folder is to go as it is, and it does — nothing is listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME)
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
    })

    it('on the volume of its folder and busy at first: it is waited for and asked to go again, and still never listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': ['EBUSY', 'EACCES'] })
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS, REMOVE_RETRY_MS])
    })

    it('on another volume, a "not empty" answer does not lead to a listing either: the volume alone decides', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['ENOTEMPTY'] })
      expect(viaModule(m, '/data/card', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', ...VOLUME])
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS])
    })

    // Review round 1 of PR #287: in the test of the path itself above, rmdir never answers "not
    // empty", so the first rmdir hid the rule of the volume. Here it is the volume that decides.
    it('as the path itself, on another volume: a "not empty" answer does not lead to a listing — the volume of its parent folder decides', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['ENOTEMPTY'] })
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([REMOVE_RETRY_MS])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    // Review round 1 of PR #287: what the first rmdir answers besides "not empty" had no expected
    // value. Whatever it is, nothing is listed: "busy" is waited for and then thrown, anything
    // else is thrown at once.
    it('on the volume of its folder and busy for good: the removal ends with that answer after its waits, and nothing is listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': Array.from({ length: 10 }, () => 'EPERM') })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EPERM')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', ...Array.from({ length: 1 + REMOVE_RETRIES }, () => 'rmdir /data/card/linked')])
      expect(m.waits).toHaveLength(REMOVE_RETRIES)
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    it('on the volume of its folder, and rmdir answers an error that is not "busy": thrown at once, no wait, nothing listed', () => {
      const m = model(WITH_A_MOUNT_ON_ITS_VOLUME, { 'rmdir /data/card/linked': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    it('on another volume, and rmdir answers an error that is not "busy": the removal ends with it, and the volume keeps its files', () => {
      const m = model(WITH_A_MOUNT, { 'rmdir /data/card/linked': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(through(m, '/data/card/linked')).toEqual(['lstat /data/card/linked', 'rmdir /data/card/linked'])
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/linked', ...VOLUME])
    })

    it('a plain folder whose first rmdir answers an error that is not "busy": thrown at once, the folder is not listed and keeps its files', () => {
      const m = model(WITH_A_LINK, { 'rmdir /data/card/assets': ['EIO'] })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EIO')
      expect(m.calls).not.toContain('readdir /data/card/assets')
      expect(m.calls.filter((call) => call === 'rmdir /data/card/assets')).toHaveLength(1)
      expect(m.waits).toEqual([])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
    })

    // Review round 1 of PR #287, measured on the PC: lstat of an ordinary junction or a symlink
    // answers with the volume the link lies on. As the parent of the path given it said "another
    // volume" about a plain folder behind it, and that folder was not removed.
    it('a plain folder whose parent is an ordinary link to another volume is removed as on main: such a parent tells no volume', () => {
      const m = model(BEHIND_A_LINK_TO_ANOTHER_VOLUME)
      expect(viaModule(m, '/data/away/sub', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/away/sub', 'lstat /data/away', 'rmdir /data/away/sub', 'readdir /data/away/sub', 'lstat /data/away/sub/f.txt', 'unlink /data/away/sub/f.txt', 'rmdir /data/away/sub'])
      expect(m.waits).toEqual([])
      expect(viaModule(m, '/data/away/empty', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/data', '/data/away', '/vol', '/vol/r'])
    })

    it('when the parent folder cannot be asked for its volume, the first rmdir still decides', () => {
      const m = model(WITH_A_MOUNT, { 'lstat /data/card': ['EACCES'] })
      expect(viaModule(m, '/data/card/linked', 'win32')).toBeNull()
      expect(m.calls).toEqual(['lstat /data/card/linked', 'lstat /data/card', 'rmdir /data/card/linked'])
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/index.html', ...VOLUME])
    })

    it('an entry of the trash whose Card folder is such a link: the entry goes, the volume keeps its files', () => {
      const m = model(TRASH_CARD_IS_A_MOUNT)
      expect(viaModule(m, '/trash/entry', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/trash', ...VOLUME])
      expect(through(m, '/trash/entry/card')).toEqual(['lstat /trash/entry/card', 'rmdir /trash/entry/card'])
    })

    it('an entry of the trash whose Card folder holds such a link: the entry goes, the volume keeps its files', () => {
      const m = model(TRASH_CARD_HOLDS_A_MOUNT)
      expect(viaModule(m, '/trash/entry', 'win32')).toBeNull()
      expect(m.names()).toEqual(['/trash', ...VOLUME])
      expect(through(m, '/trash/entry/card/linked')).toEqual(['lstat /trash/entry/card/linked', 'rmdir /trash/entry/card/linked'])
    })

    // The price of the rule, written down: a folder is listed only after it has answered "not empty".
    it('a plain folder that refuses to go for another reason than "not empty" is not listed: what it holds stays, and the removal ends with that reason', () => {
      const m = model(WITH_A_LINK, { 'rmdir /data/card/assets': Array.from({ length: 10 }, () => 'EBUSY') })
      expect(viaModule(m, '/data/card', 'win32')).toBe('EBUSY')
      expect(m.names()).toEqual(['/data', '/data/card', '/data/card/assets', '/data/card/assets/app.js', '/home', '/home/notes', '/home/notes/keep.txt'])
      expect(m.calls).not.toContain('readdir /data/card/assets')
      expect(m.waits).toHaveLength(REMOVE_RETRIES)
    })

    // worfy-windows ticket 44. Until then this was one call of rmSync, which goes into a folder on
    // another volume. test/unit/remove-tree-mounted.test.ts has the mount point of macOS.
    it('off Windows the walk does not run: the tree is looked through, and a folder on another volume than its folder ends the removal before rmSync is called', () => {
      for (const platform of ['darwin', 'linux'] as const) {
        const m = model(WITH_A_MOUNT)
        expect(viaModule(m, '/data/card', platform), platform).toBe('EXDEV')
        expect(m.calls, platform).toEqual(['lstat /data/card', 'lstat /data/card/..', 'readdir /data/card', 'lstat /data/card/index.html', 'lstat /data/card/linked'])
        expect(m.names(), platform).toEqual(['/data', '/data/card', '/data/card/index.html', '/data/card/linked', ...VOLUME])
        expect(m.waits, platform).toEqual([])
      }
    })
  })

  // Rewritten by worfy-windows ticket 44: on main this was the call of rmSync and nothing else.
  it('on every other system the tree is looked through — every entry once, a link never followed — and then removed by one call of rmSync with "recursive" and "force"', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const m = model(WITH_A_LINK)
      expect(viaModule(m, '/data/card', platform), platform).toBeNull()
      expect(m.calls, platform).toEqual([
        'lstat /data/card',
        'lstat /data/card/..',
        'readdir /data/card',
        'lstat /data/card/index.html',
        'lstat /data/card/assets',
        'readdir /data/card/assets',
        'lstat /data/card/assets/app.js',
        'lstat /data/card/linked',
        'rmSync /data/card recursive force',
      ])
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
    // Each folder was asked to go once, before it was listed (worfy-windows ticket 35), and
    // answered "not empty". Neither is asked again while it still holds something.
    expect(m.calls.filter((call) => call.startsWith('rmdir '))).toEqual(['rmdir /d', 'rmdir /d/sub'])
    expect(m.waits).toEqual([])
  })

  it('takes "nothing is there" in every form it comes in: a name on the way that is no folder, a folder gone between the look and the listing', () => {
    const below = model({ '/f': { kind: 'file' } }, { 'lstat /f/x': ['ENOTDIR'] })
    expect(viaModule(below, '/f/x', 'win32')).toBeNull()
    expect(below.calls).toEqual(['lstat /f/x'])
    const gone = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'readdir /d': ['ENOENT'] })
    expect(viaModule(gone, '/d', 'win32')).toBeNull()
    // The look, the volume of the parent folder, the first rmdir — "not empty" — and the listing.
    expect(gone.calls).toEqual(['lstat /d', 'lstat /', 'rmdir /d', 'readdir /d'])
    const unreadable = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'readdir /d': ['EACCES'] })
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

    // The folder at the end takes of the same waits: none is left for it here. (Its first "not
    // empty" is the answer to the rmdir before the listing, which is no wait.)
    const folder = model({ '/d': { kind: 'folder' }, '/d/a.txt': { kind: 'file' } }, { 'unlink /d/a.txt': forever('EBUSY').slice(0, REMOVE_RETRIES), 'rmdir /d': ['ENOTEMPTY', 'ENOTEMPTY'] })
    expect(viaModule(folder, '/d', 'win32')).toBe('ENOTEMPTY')
    expect(folder.waits).toHaveLength(REMOVE_RETRIES)
    expect(folder.names()).toEqual(['/d'])

    // A second removal starts with all its waits.
    const again = model({ '/f': { kind: 'file' } }, { 'unlink /f': forever('EBUSY').slice(0, REMOVE_RETRIES) })
    expect(viaModule(again, '/f', 'win32')).toBeNull()
    expect(again.waits).toHaveLength(REMOVE_RETRIES)
  })

  it('tries again for a folder that is not empty yet, and never for an error that is not "busy"', () => {
    // The first "not empty" answers the rmdir before the listing; the two after it are waited for.
    const folder = model({ '/d': { kind: 'folder' } }, { 'rmdir /d': ['ENOTEMPTY', 'ENOTEMPTY', 'EACCES'] })
    expect(viaModule(folder, '/d', 'win32')).toBeNull()
    expect(folder.waits).toHaveLength(2)
    expect(folder.calls).toEqual(['lstat /d', 'lstat /', 'rmdir /d', 'readdir /d', 'rmdir /d', 'rmdir /d', 'rmdir /d'])
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

describe('the copies of the walk that cannot import the module', () => {
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
    // worfy-windows ticket 35: a folder that lstat does not see as the link it is.
    ['a mount to another volume inside the folder', WITH_A_MOUNT, '/data/card', {}],
    ['a mount to another volume as the path itself', WITH_A_MOUNT, '/data/card/linked', {}],
    ['a mount written with a separator at its end', WITH_A_MOUNT, '/data/card/linked/', {}],
    ['a mount on the volume of its folder', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', {}],
    ['a mount on the volume of its folder as the path itself', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card/linked', {}],
    ['a mount on the volume of its folder that is busy at first', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': ['EBUSY', 'EACCES'] }],
    ['a mount on the volume of its folder that stays busy', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': Array.from({ length: 10 }, () => 'EPERM') }],
    ['a mount to another volume that answers "not empty" once', WITH_A_MOUNT, '/data/card', { 'rmdir /data/card/linked': ['ENOTEMPTY'] }],
    ['a mount to another volume that refuses to go', WITH_A_MOUNT, '/data/card', { 'rmdir /data/card/linked': ['EIO'] }],
    ['a mount whose parent folder cannot be asked', WITH_A_MOUNT, '/data/card/linked', { 'lstat /data/card': ['EACCES'] }],
    ['a mount to another volume as the path itself that answers "not empty" once', WITH_A_MOUNT, '/data/card/linked', { 'rmdir /data/card/linked': ['ENOTEMPTY'] }],
    ['a mount on the volume of its folder that refuses to go', WITH_A_MOUNT_ON_ITS_VOLUME, '/data/card', { 'rmdir /data/card/linked': ['EIO'] }],
    ['a folder behind an ordinary link to another volume', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away/sub', {}],
    ['an empty folder behind an ordinary link to another volume', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away/empty', {}],
    ['the link to another volume itself', BEHIND_A_LINK_TO_ANOTHER_VOLUME, '/data/away', {}],
    ['a folder whose parent folder is not there to be asked', WITH_A_MOUNT, '/data/card', { 'lstat /data': ['ENOENT'] }],
    ['an entry of the trash whose Card folder is a mount', TRASH_CARD_IS_A_MOUNT, '/trash/entry', {}],
    ['an entry of the trash whose Card folder holds a mount', TRASH_CARD_HOLDS_A_MOUNT, '/trash/entry', {}],
    ['a plain folder that is busy itself', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': Array.from({ length: 10 }, () => 'EBUSY') }],
    ['a plain folder that is busy at first and then "not empty"', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['EBUSY', 'ENOTEMPTY'] }],
    ['a plain folder that refuses to go with an error that is not "busy"', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['EIO'] }],
    ['a folder gone between the look and the first rmdir', WITH_A_LINK, '/data/card', { 'rmdir /data/card/assets': ['ENOENT'] }],
    // worfy-windows ticket 44: a folder a volume is mounted on, and the look that comes before rmSync off Windows.
    ['a mount point of macOS inside the folder', CARD_HOLDS_A_VOLUME, '/data/card', {}],
    ['a mount point of macOS as the path itself', CARD_HOLDS_A_VOLUME, '/data/card/vol', {}],
    ['a mount point of macOS two folders down', CARD_HOLDS_A_VOLUME, '/data', {}],
    ['a mount point of macOS after an entry gone meanwhile', CARD_HOLDS_A_VOLUME, '/data/card', { 'lstat /data/card/index.html': ['ENOENT'] }],
    ['the folder the path lies in cannot be asked', WITH_A_LINK, '/data/card', { 'lstat /data/card/..': ['EACCES'], 'lstat /data': ['EACCES'] }],
    ['the folder the path lies in is gone meanwhile', WITH_A_LINK, '/data/card', { 'lstat /data/card/..': ['ENOENT'], 'lstat /data': ['ENOENT'] }],
    ['a path too long to look at', WITH_A_LINK, '/data/card', { 'lstat /data/card/assets/app.js': ['ENAMETOOLONG'] }],
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
      // worfy-windows ticket 28: more than one separator, the two kinds mixed, and the paths that keep theirs.
      ['a link written with two separators at its end', '/data/card/linked//', {}],
      ['a link written with a backslash and a slash at its end', '/data/card/linked\\/', {}],
      ['a link written with a slash and a backslash at its end', '/data/card/linked/\\', {}],
      ['a folder written with three separators at its end', '/data/card/assets/\\/', {}],
      ['separators and nothing else', '/', { 'lstat /': ['EIO'] }],
      ['a backslash and nothing else', '\\', { 'lstat /': ['EIO'] }],
      ['two separators and nothing else', '//', { 'lstat //': ['EIO'] }],
      ['the root of a disk', 'C:\\', { 'lstat C:/': ['EIO'] }],
      ['the root of a disk written with a slash', 'C:/', { 'lstat C:/': ['EIO'] }],
      ['the root of a disk written with two separators', 'C:\\\\', { 'lstat C://': ['EIO'] }],
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
