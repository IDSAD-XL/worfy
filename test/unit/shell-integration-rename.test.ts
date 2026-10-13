// ShellIntegration.prepare() and a rename that Windows refuses for a moment (worfy-windows ticket
// 26). Every script is written to a temporary file and renamed over the one of the last
// prepare(). On Windows a rename over a file that anything has open — an antivirus that reads what
// was just written, a second Terminal that starts at the same moment — is refused with EPERM. Seen
// in a full run of the tests on the PC, once the folder was no longer made anew for every call.
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RENAME_RETRY_MS, RENAME_TRIES, scriptFiles, ShellIntegration } from '../../src/main/terminal/shell-integration'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'

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
const asked = (name: string): number => renames.calls.filter((each) => each === name).length
const zprofile = (): string => scriptFiles().find((file) => file.path === '.zprofile')!.text
/** prepare() answers with the first refusal while its other files are still being written: they get the time to end. */
const othersWritten = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200))

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-si-rename-')))
  renames.refuse.clear()
  renames.calls.length = 0
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('ShellIntegration.prepare() and a rename that is refused', () => {
  it('on Windows tries again when the file it replaces is busy for a moment; on every other system the refusal is the answer', async () => {
    const integration = new ShellIntegration({ tmpdir: () => scratch })
    renames.refuse.set('.zprofile', ['EPERM', 'EBUSY', 'EACCES'])
    if (WINDOWS) {
      const dir = await integration.prepare()
      expect(asked('.zprofile')).toBe(4)
      expect(readFileSync(join(dir, '.zprofile'), 'utf8')).toBe(zprofile())
      // Every other file was renamed once.
      expect(asked('.zshrc')).toBe(1)
    } else {
      await expect(integration.prepare()).rejects.toMatchObject({ code: 'EPERM' })
      expect(asked('.zprofile')).toBe(1)
      await othersWritten()
    }
    integration.disposeSync()
  })

  it.runIf(WINDOWS)('on Windows gives the refusal after ten tries, 20 ms apart', async () => {
    expect([RENAME_TRIES, RENAME_RETRY_MS]).toEqual([10, 20])
    const integration = new ShellIntegration({ tmpdir: () => scratch })
    renames.refuse.set('.zprofile', Array.from({ length: 50 }, () => 'EPERM'))
    const at = performance.now()
    await expect(integration.prepare()).rejects.toMatchObject({ code: 'EPERM' })
    expect(asked('.zprofile')).toBe(RENAME_TRIES)
    // Nine waits between ten tries.
    expect(performance.now() - at).toBeGreaterThanOrEqual((RENAME_TRIES - 1) * RENAME_RETRY_MS - 5)
    await othersWritten()
    integration.disposeSync()
  })

  it('an error that is not "busy" is not tried again, on any system', async () => {
    const integration = new ShellIntegration({ tmpdir: () => scratch })
    renames.refuse.set('.zprofile', ['EIO', 'EIO'])
    await expect(integration.prepare()).rejects.toMatchObject({ code: 'EIO' })
    expect(asked('.zprofile')).toBe(1)
    await othersWritten()
    integration.disposeSync()
  })
})
