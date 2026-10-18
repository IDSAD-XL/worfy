// The rule by which DocsWatcher, the status line watch of the Limits and LinkSafeWatch tell that
// the folder they watch is gone (src/main/watch-gone.ts, worfy-windows tickets 27 and 36).
import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { namesTheFolder, notThere } from '../../src/main/watch-gone'

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
