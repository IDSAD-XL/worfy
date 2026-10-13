// ShellIntegration.disposeSync and a link inside worfy's ZDOTDIR folder (worfy-windows ticket 23).
// The folder goes when worfy exits. Its removal must take a link away as a link: under the Node of
// Electron 44 on Windows fs.rmSync with `recursive` goes through a junction and empties the folder
// behind it.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShellIntegration, tempBase } from '../../src/main/terminal/shell-integration'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-si-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('ShellIntegration.disposeSync and a link in the folder', () => {
  it('removes the folder with the link in it, and the folder the link leads to keeps its file', async () => {
    // The folder is made under `scratch` when the socket path fits there, and under /tmp when the
    // temp folder of the user is too long for it. On Windows /tmp would be a folder of the disk:
    // the test must not write there.
    const base = tempBase(scratch)
    if (WINDOWS) expect(base).toBe(scratch)
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'keep me')

    const integration = new ShellIntegration({ tmpdir: () => scratch })
    const dir = await integration.prepare()
    expect(dirname(dir)).toBe(base)
    expect(readdirSync(dir).length).toBeGreaterThan(0)
    // A junction on Windows; elsewhere a symlink to the folder.
    symlinkSync(outside, join(dir, 'linked'), WINDOWS ? 'junction' : 'dir')
    expect(readdirSync(join(dir, 'linked'))).toEqual(['notes.txt'])

    integration.disposeSync()
    expect(existsSync(dir)).toBe(false)
    expect(integration.path).toBeNull()
    expect(readdirSync(outside)).toEqual(['notes.txt'])
  })

  // worfy-windows ticket 26. "A folder of this user that nobody else may open" was read off the
  // POSIX bits of its mode; Windows has none (every folder shows 0o666 there), so the folder never
  // passed, every prepare() made a new one, and disposeSync removed the last one only.
  it('prepare() called again uses the folder it made, and disposeSync leaves nothing behind', async () => {
    const base = tempBase(scratch)
    if (WINDOWS) expect(base).toBe(scratch)
    const before = readdirSync(base)
    const integration = new ShellIntegration({ tmpdir: () => scratch })
    const made = (): string[] => readdirSync(base).filter((name) => !before.includes(name))

    const first = await integration.prepare()
    const second = await integration.prepare()
    const [third, fourth] = await Promise.all([integration.prepare(), integration.prepare()])
    expect([second, third, fourth]).toEqual([first, first, first])
    expect(made()).toEqual([basename(first)])

    integration.disposeSync()
    expect(made()).toEqual([])
  })

  // The other half of the same check, which Windows keeps: a link under the name of the folder is
  // somebody else's, and nothing is written through it.
  it('a link under the name of its folder is not used: the scripts go to a new folder, and the link stays', async () => {
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    const integration = new ShellIntegration({ tmpdir: () => scratch })
    const first = await integration.prepare()
    removeTestTree(first)
    symlinkSync(outside, first, WINDOWS ? 'junction' : 'dir')

    const second = await integration.prepare()
    expect(second).not.toBe(first)
    expect(readdirSync(second).length).toBeGreaterThan(0)
    expect(readdirSync(outside)).toEqual([])

    integration.disposeSync()
    expect(existsSync(second)).toBe(false)
    expect(lstatSync(first).isSymbolicLink()).toBe(true)
  })
})
