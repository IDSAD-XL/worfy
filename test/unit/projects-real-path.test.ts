import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realpathOrSelf } from '../../src/main/projects/real-path'
import { removeTestTree } from '../remove'

// node:fs as it is, except that realpathSync.native can be made to throw, as it does on a drive the
// native call cannot read (a RAM disk, some network or virtual drives).
const native = vi.hoisted(() => ({ fails: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const realpathSync = Object.assign((path: string) => actual.realpathSync(path), {
    native: (path: string) => {
      if (native.fails) throw Object.assign(new Error(`EIO: i/o error, realpath '${path}'`), { code: 'EIO' })
      return actual.realpathSync.native(path)
    },
  })
  return { ...actual, realpathSync }
})

let scratch: string

beforeEach(() => {
  native.fails = false
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-real-path-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('realpathOrSelf', () => {
  // `<folder>/./` is the folder in a spelling that every realpath folds and a string comparison does not.
  it('gives the native spelling of a folder', () => {
    const folder = join(scratch, 'repo')
    mkdirSync(folder)
    expect(realpathOrSelf(`${folder}${sep}.${sep}`)).toBe(folder)
  })

  it('falls back to the plain realpath when the native call throws', () => {
    const folder = join(scratch, 'repo')
    mkdirSync(folder)
    native.fails = true
    expect(() => realpathSync.native(folder)).toThrow('EIO')
    expect(realpathOrSelf(`${folder}${sep}.${sep}`)).toBe(folder)
  })

  it('gives a path that no realpath can read as it is', () => {
    const missing = join(scratch, 'missing')
    expect(realpathOrSelf(missing)).toBe(missing)
    native.fails = true
    expect(realpathOrSelf(missing)).toBe(missing)
  })
})
