// ShellIntegration.disposeSync and a link inside worfy's ZDOTDIR folder (worfy-windows ticket 23).
// The folder goes when worfy exits. Its removal must take a link away as a link: under the Node of
// Electron 44 on Windows fs.rmSync with `recursive` goes through a junction and empties the folder
// behind it.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShellIntegration, tempBase } from '../../src/main/terminal/shell-integration'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'

let scratch: string
let made: ShellIntegration[] = []

/** A ShellIntegration in `scratch`, removed after the test also when a check fails. */
function integrationInScratch(): ShellIntegration {
  const integration = new ShellIntegration({ tmpdir: () => scratch })
  made.push(integration)
  return integration
}

/** Runs `step` with process.platform as asked; the real value is back when it ends, failed or not. */
async function asPlatform<T>(platform: NodeJS.Platform, step: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...real, value: platform })
  try {
    return await step()
  } finally {
    Object.defineProperty(process, 'platform', real)
  }
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-si-')))
  // The folder of ShellIntegration is made under `scratch` when the socket path fits there, and
  // under /tmp when the temp folder of the user is too long for it. The tests must not write there:
  // they list the folder they made, and a failed check would leave it behind (worfy-windows ticket 32).
  expect(tempBase(scratch)).toBe(scratch)
})

afterEach(() => {
  for (const integration of made) integration.disposeSync()
  made = []
  removeTestTree(scratch)
})

describe('ShellIntegration.disposeSync and a link in the folder', () => {
  it('removes the folder with the link in it, and the folder the link leads to keeps its file', async () => {
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'keep me')

    const integration = integrationInScratch()
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

  // worfy-windows ticket 26. "A folder of this user that nobody else may open" was read off the
  // POSIX bits of its mode; Windows has none (every folder shows 0o666 there), so the folder never
  // passed, every prepare() made a new one, and disposeSync removed the last one only.
  it('prepare() called again uses the folder it made, and disposeSync leaves nothing behind', async () => {
    const before = readdirSync(scratch)
    const integration = integrationInScratch()
    const added = (): string[] => readdirSync(scratch).filter((name) => !before.includes(name))

    const first = await integration.prepare()
    const second = await integration.prepare()
    // Terminals that start at the same moment: one folder, and no call fails. On Windows a rename
    // over a file another call has open at that moment is refused (EPERM); it is tried again.
    const together = await Promise.all(Array.from({ length: 12 }, () => integration.prepare()))
    expect([second, ...together]).toEqual(Array.from({ length: 13 }, () => first))
    expect(added()).toEqual([basename(first)])

    integration.disposeSync()
    expect(added()).toEqual([])
  })

  // worfy-windows ticket 32. Off Windows the folder is used again only while its owner is this user
  // and nobody else may open it: prepare() answers the ZDOTDIR of zsh, and its .zshrc runs every
  // rc.d/*.zsh in the folder. Skipped on Windows: a folder there has no mode bits to change (lstat
  // shows 0o666 for every folder whatever chmod did), so this check is not reached; the Windows side
  // is the next test, which runs on every system. Run on macOS and Linux.
  it.skipIf(WINDOWS)('off Windows a folder that others may open is not used again: the scripts go to a new folder, and nothing is written into the old one', async () => {
    const integration = integrationInScratch()
    const first = await integration.prepare()
    chmodSync(first, 0o755)
    unlinkSync(join(first, '.zshrc'))

    const second = await integration.prepare()
    expect(second).not.toBe(first)
    expect(readdirSync(second)).toContain('.zshrc')
    expect(existsSync(join(first, '.zshrc'))).toBe(false)
  })

  // The Windows side of the same check, with process.platform set for the time of prepare(), so that
  // it runs on macOS and Linux too: a folder that is not a link is taken whatever its mode bits say.
  it('on Windows the folder it made is used again whatever its mode bits say', async () => {
    const integration = integrationInScratch()
    const first = await asPlatform('win32', () => integration.prepare())
    chmodSync(first, 0o755)
    unlinkSync(join(first, '.zshrc'))

    const second = await asPlatform('win32', () => integration.prepare())
    expect(second).toBe(first)
    expect(readdirSync(first)).toContain('.zshrc')
  })

  // The other half of the same check, which Windows keeps: a link under the name of the folder is
  // somebody else's, and nothing is written through it.
  it('a link under the name of its folder is not used: the scripts go to a new folder, and the link stays', async () => {
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    const integration = integrationInScratch()
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
