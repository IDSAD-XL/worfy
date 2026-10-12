// ShellIntegration.disposeSync and a link inside worfy's ZDOTDIR folder (worfy-windows ticket 23).
// The folder goes when worfy exits. Its removal must take a link away as a link: under the Node of
// Electron 44 on Windows fs.rmSync with `recursive` goes through a junction and empties the folder
// behind it.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTree } from '../../src/main/storage/remove'
import { ShellIntegration, tempBase } from '../../src/main/terminal/shell-integration'

const WINDOWS = process.platform === 'win32'

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-si-')))
})

afterEach(() => {
  removeTree(scratch)
})

describe('ShellIntegration.disposeSync and a link in the folder', () => {
  it('removes the folder with the link in it, and the folder the link leads to keeps its file', async () => {
    // The folder is made under `scratch`, not under /tmp: the socket path fits.
    expect(tempBase(scratch)).toBe(scratch)
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'keep me')

    const integration = new ShellIntegration({ tmpdir: () => scratch })
    const dir = await integration.prepare()
    expect(dirname(dir)).toBe(scratch)
    expect(readdirSync(dir).length).toBeGreaterThan(0)
    // A junction on Windows; elsewhere a symlink to the folder.
    symlinkSync(outside, join(dir, 'linked'), WINDOWS ? 'junction' : 'dir')
    expect(readdirSync(join(dir, 'linked'))).toEqual(['notes.txt'])

    integration.disposeSync()
    expect(existsSync(dir)).toBe(false)
    expect(integration.path).toBeNull()
    expect(readdirSync(outside)).toEqual(['notes.txt'])
  })
})
