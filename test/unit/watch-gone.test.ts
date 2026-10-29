// The rule by which DocsWatcher, the status line watch of the Limits and LinkSafeWatch tell that
// the folder they watch is gone (src/main/watch-gone.ts, worfy-windows tickets 27 and 36), and the
// fs.watch of Node behind all three, on a real temporary folder on any system.
import type { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { namesTheFolder, notThere, watchWithNode } from '../../src/main/watch-gone'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('watchWithNode, the real fs.watch', () => {
  let dir: string
  const handles: { close: () => void }[] = []

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-watch-gone-')))
    mkdirSync(join(dir, 'sub'))
  })

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close()
    removeTestTree(dir)
  })

  /** Writes `file` (under the folder) every 50 ms until `done` says so or `ms` have passed: the event stream starts a moment after the watch. */
  async function writeUntil(file: string, done: () => boolean, limit: number): Promise<void> {
    const wait = ms(limit)
    const end = Date.now() + wait
    for (let times = 0; Date.now() < end && !done(); times++) {
      writeFileSync(join(dir, file), String(times))
      await pause(50)
    }
  }

  it('recursive: a file in a subfolder is reported by its path under the folder', async () => {
    const names: (string | null)[] = []
    handles.push(watchWithNode(dir, true, (name) => names.push(name), () => undefined))
    const wanted = join('sub', 'file.txt')
    await writeUntil(wanted, () => names.includes(wanted), 5000)
    expect(names).toContain(wanted)
  })

  it('not recursive: a file of the folder is reported, a file in a subfolder is not', async () => {
    const names: (string | null)[] = []
    handles.push(watchWithNode(dir, false, (name) => names.push(name), () => undefined))
    await writeUntil('top.txt', () => names.includes('top.txt'), 5000)
    expect(names).toContain('top.txt')
    await writeUntil(join('sub', 'file.txt'), () => false, 600)
    expect(names.filter((name) => name?.includes('file.txt'))).toEqual([])
  })

  it('an error of the watch goes to onError instead of being thrown', () => {
    const errors: unknown[] = []
    const handle = watchWithNode(dir, false, () => undefined, (error) => errors.push(error))
    handles.push(handle)
    const failure = new Error('EPERM: operation not permitted, watch')
    ;(handle as unknown as EventEmitter).emit('error', failure)
    expect(errors).toEqual([failure])
  })
})

describe('namesTheFolder', () => {
  it('a full path is the watched folder itself, in the form Windows sends and in any other', () => {
    expect(namesTheFolder('\\\\?\\C:\\p\\repo', win32.isAbsolute)).toBe(true)
    expect(namesTheFolder('C:\\p\\repo', win32.isAbsolute)).toBe(true)
    expect(namesTheFolder('/Users/dev/repo', posix.isAbsolute)).toBe(true)
  })

  it('a name under the folder, or no name, is not', () => {
    for (const name of ['HANDOFF.md', 'docs\\adr\\0001-x.md', 'node_modules']) expect(namesTheFolder(name, win32.isAbsolute)).toBe(false)
    expect(namesTheFolder('docs/adr/0001-x.md', posix.isAbsolute)).toBe(false)
    expect(namesTheFolder(null, win32.isAbsolute)).toBe(false)
    expect(namesTheFolder(null, () => true)).toBe(false)
  })
})

describe('notThere', () => {
  it('is true for ENOENT and ENOTDIR only', () => {
    expect(notThere(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true)
    expect(notThere(Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toBe(true)
    for (const code of ['EMFILE', 'EPERM', 'EACCES']) expect(notThere(Object.assign(new Error('x'), { code }))).toBe(false)
    expect(notThere(new Error('no code'))).toBe(false)
    expect(notThere(null)).toBe(false)
  })
})
