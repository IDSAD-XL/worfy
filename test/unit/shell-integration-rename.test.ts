// ShellIntegration.prepare() and a rename that Windows refuses for a moment (worfy-windows ticket
// 26). Every script is written to a temporary file and renamed over the one of the last
// prepare(). On Windows a rename over a file that anything has open — an antivirus that reads what
// was just written, a second Terminal that starts at the same moment — is refused with EPERM. Seen
// in a full run of the tests on the PC, once the folder was no longer made anew for every call.
//
// Both sides run on every system (worfy-windows ticket 32): process.platform is set for the time of
// prepare(), so the lines that work on win32 alone are tested on macOS and Linux too, and the other
// side on Windows. The real value is back before anything is removed: removeTree reads it.
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RENAME_RETRY_MS, RENAME_TRIES, scriptFiles, ShellIntegration, tempBase } from '../../src/main/terminal/shell-integration'
import { removeTestTree } from '../remove'

/** The codes the next renames over a file of that name fail with, and every rename asked for. */
const renames = vi.hoisted(() => ({ refuse: new Map<string, string[]>(), calls: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const rename: typeof actual.rename = async (from, to) => {
    const name = String(to).split(/[\\/]/).at(-1) ?? ''
    renames.calls.push(name)
    const code = renames.refuse.get(name)?.shift()
    if (code !== undefined) throw Object.assign(new Error(`${code}: rename refused by the test`), { code })
    return actual.rename(from, to)
  }
  return { ...actual, default: { ...actual, rename }, rename }
})

let scratch: string
let made: ShellIntegration[] = []
const asked = (name: string): number => renames.calls.filter((each) => each === name).length
const zprofile = (): string => scriptFiles().find((file) => file.path === '.zprofile')!.text
/** prepare() answers with the first refusal while its other files are still being written: they get the time to end. */
const othersWritten = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200))

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
  // A short name: the folder of ShellIntegration must go under `scratch`, not to /tmp, where a
  // failed check would leave it (tempBase takes /tmp when the socket path would not fit).
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-sr-')))
  expect(tempBase(scratch)).toBe(scratch)
  renames.refuse.clear()
  renames.calls.length = 0
})

afterEach(() => {
  for (const integration of made) integration.disposeSync()
  made = []
  removeTestTree(scratch)
})

describe('ShellIntegration.prepare() and a rename that is refused', () => {
  it('on Windows tries again when the file it replaces is busy for a moment', async () => {
    const integration = integrationInScratch()
    renames.refuse.set('.zprofile', ['EPERM', 'EBUSY', 'EACCES'])
    const dir = await asPlatform('win32', () => integration.prepare())
    expect(asked('.zprofile')).toBe(4)
    expect(readFileSync(join(dir, '.zprofile'), 'utf8')).toBe(zprofile())
    // Every other file was renamed once.
    expect(asked('.zshrc')).toBe(1)
  })

  it.each(['darwin', 'linux'] as const)('on %s the refusal is the answer: the rename is not tried again', async (platform) => {
    const integration = integrationInScratch()
    renames.refuse.set('.zprofile', ['EPERM', 'EBUSY', 'EACCES'])
    await asPlatform(platform, async () => {
      await expect(integration.prepare()).rejects.toMatchObject({ code: 'EPERM' })
      await othersWritten()
    })
    expect(asked('.zprofile')).toBe(1)
  })

  it('on Windows gives the refusal after ten tries, 20 ms apart', async () => {
    expect([RENAME_TRIES, RENAME_RETRY_MS]).toEqual([10, 20])
    const integration = integrationInScratch()
    renames.refuse.set('.zprofile', Array.from({ length: 50 }, () => 'EPERM'))
    const at = performance.now()
    await asPlatform('win32', async () => {
      await expect(integration.prepare()).rejects.toMatchObject({ code: 'EPERM' })
      expect(asked('.zprofile')).toBe(RENAME_TRIES)
      // Nine waits between ten tries.
      expect(performance.now() - at).toBeGreaterThanOrEqual((RENAME_TRIES - 1) * RENAME_RETRY_MS - 5)
      await othersWritten()
    })
  })

  it.each(['EIO', 'ENOENT'])('an error that is not "busy" (%s) is not tried again, on Windows either', async (code) => {
    const integration = integrationInScratch()
    renames.refuse.set('.zprofile', [code, code])
    await asPlatform('win32', async () => {
      await expect(integration.prepare()).rejects.toMatchObject({ code })
      await othersWritten()
    })
    expect(asked('.zprofile')).toBe(1)
  })
})
