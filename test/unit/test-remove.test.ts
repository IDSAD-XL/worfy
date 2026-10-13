// test/remove.ts (worfy-windows ticket 26): what a test removes its folder with, and what it calls
// before that when the Layout store of the application may still hold a save back.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutOpInput } from '../../src/shared/layout/types'
import { removeTestTree, saveLayoutNow } from '../remove'

const WINDOWS = process.platform === 'win32'
const PROJECT = 'demo-0a1b2c3d'

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-test-remove-')))
})

afterEach(() => {
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

describe('removeTestTree', () => {
  // What stopped the cleanups: git writes its objects read-only, and under the Node of Electron on
  // Windows fs.rmSync with `recursive` refuses such a file with EPERM, and goes through a junction.
  it('removes a folder with a read-only file in it, takes a link in it as a link, and passes by a path that is not there', () => {
    const tree = join(scratch, 'tree')
    const outside = join(scratch, 'outside')
    mkdirSync(join(tree, 'objects', 'ab'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'keep me')
    writeFileSync(join(tree, 'objects', 'ab', 'cdef'), 'a git object')
    chmodSync(join(tree, 'objects', 'ab', 'cdef'), 0o444)
    symlinkSync(outside, join(tree, 'linked'), WINDOWS ? 'junction' : 'dir')

    removeTestTree(tree)
    expect(existsSync(tree)).toBe(false)
    expect(readdirSync(outside)).toEqual(['notes.txt'])
    expect(() => removeTestTree(join(scratch, 'never-was'))).not.toThrow()
  })
})

describe('saveLayoutNow', () => {
  it('writes what the Layout store holds back, so that no save comes after the folder is gone and makes it again', async () => {
    const dataDir = join(scratch, 'data')
    const repo = join(scratch, 'repo')
    mkdirSync(repo)
    mkdirSync(join(dataDir, PROJECT), { recursive: true })
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
    process.env.WORFY_DATA_DIR = dataDir
    vi.resetModules()
    const { layoutStore, LAYOUT_FILE, LAYOUT_SAVE_DELAY_MS } = await import('../../src/main/layout/store')
    const file = join(dataDir, PROJECT, LAYOUT_FILE)
    const note: LayoutOpInput = { op: 'create', node: { id: 'n1', kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: 'a note' } } }
    layoutStore().apply(PROJECT, note)
    // The save waits for a quiet moment: nothing is on the disk yet.
    expect(existsSync(file)).toBe(false)

    await saveLayoutNow()
    expect(existsSync(file)).toBe(true)

    removeTestTree(scratch)
    await new Promise((resolve) => setTimeout(resolve, LAYOUT_SAVE_DELAY_MS * 2))
    expect(existsSync(scratch)).toBe(false)
  })
})
