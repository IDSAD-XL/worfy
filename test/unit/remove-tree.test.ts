// src/main/storage/remove.ts (worfy-windows ticket 23): removing a file, a link or a folder without
// ever going through a link. On Windows that is a walk of the module's own; on every other system
// it is fs.rmSync, as before the module, after a look through the tree for a mounted volume
// (worfy-windows ticket 44). The tests are in three files (split by worfy-windows ticket 45):
//   - test/unit/remove-tree.test.ts, this file — real folders: on Windows with junctions, a `dir`
//     and a `file` symlink and a read-only file, elsewhere with symlinks; this is where the
//     fs.rmSync of Electron's Node loses the folder behind a junction;
//   - test/unit/remove-tree-walk.test.ts — a model of the file system: the order of the
//     calls of the walk, its tries when a file is busy, and the calls every other system makes;
//   - test/unit/remove-tree-copies.test.ts — the copies that cannot import the module (the
//     text of restore.mjs, scripts/remove-tree.mjs and scripts/install-stable.mjs) run over the
//     same model and must make the same calls.
// The model, its trees and the copies are in test/unit/remove-tree-model.ts; the tests of a volume
// mounted in the tree off Windows are in test/unit/remove-tree-mounted.test.ts.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REMOVE_RETRIES, removeFile, removeTree } from '../../src/main/storage/remove'

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

  // worfy-windows ticket 45, item 1, made with the owner's word of 2026-10-18: one junction by
  // volume GUID on the disk of %TEMP%, to a folder this test made, removed after the test. lstat
  // calls such a junction a folder and gives the `dev` of its target — here the volume of the folder
  // it lies in, so the volume rule says nothing and only the first rmdir keeps the walk out of it.
  // Measured on the PC under both Nodes 24.21.0: mklink without elevation, lstat a folder with the
  // `dev` of its folder, readlink EINVAL, removeTree leaves the target whole. Code without the first
  // rmdir removes the files behind it: this test is never run against such code.
  it.runIf(WINDOWS)('a junction by volume GUID to a folder of the same volume, inside the folder that is removed: the first rmdir takes it, and the folder behind it keeps its files', () => {
    const tree = join(dir, 'tree')
    mkdirSync(join(tree, 'sub'), { recursive: true })
    writeFileSync(join(tree, 'sub', 'own.txt'), 'mine')
    // The target is written from the long form of the path: %TEMP% may have a short 8.3 name in it.
    const real = realpathSync.native(dir)
    const drive = /^([A-Za-z]:)\\./.exec(real)?.[1]
    expect(drive, real).toBeDefined()
    const mountvol = spawnSync('mountvol', [`${drive}\\`, '/L'], { encoding: 'latin1' })
    const guids = String(mountvol.stdout).match(/\\\\\?\\Volume\{[0-9a-fA-F-]{36}\}\\/g) ?? []
    expect([mountvol.status, guids.length]).toEqual([0, 1])
    const target = `${guids[0]}${real.slice(3)}\\outside`
    // The folder outside of this test, never the root of the volume.
    expect(target.endsWith(`\\${basename(real)}\\outside`)).toBe(true)
    const at = join(tree, 'sub', 'linked')
    const made = spawnSync(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'mklink', '/J', at, target], { encoding: 'latin1' })
    expect(made.status, `${made.stdout}${made.stderr}`).toBe(0)
    links.push(at)
    // A marker of random content, read back through the junction, before anything is removed.
    const marker = randomBytes(16).toString('hex')
    writeFileSync(join(outside, 'marker.txt'), marker)
    expect(readFileSync(join(at, 'marker.txt'), 'utf8')).toBe(marker)
    unlinkSync(join(outside, 'marker.txt'))
    expect(lstatSync(at).isDirectory()).toBe(true)
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
    writeFileSync(join(tree, 'held', 'inner', 'kept.txt'), 'kept')
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
      // The price of the first rmdir (worfy-windows ticket 35; tested on real folders by ticket 45): the
      // working folder of the program is busy itself, so it is never listed, and keeps what it holds.
      expect(readdirSync(join(tree, 'held', 'inner'))).toEqual(['kept.txt'])
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
