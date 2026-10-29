// DocsWatcher over real folders when its root is removed and made again. Windows (worfy-windows
// ticket 27): there fs.watch of a removed folder sends events without end — before the fix the
// process spent a whole processor core on them and never saw the folder come back. macOS
// (worfy-windows ticket 38): there the root removed or renamed gives one event, named by its last
// name, and before the fix the documents stayed as they were read. Each case runs on its own
// system only; the same cases on a stand-in watch, for any system, are in
// test/unit/docs-watch-root-gone.test.ts.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsWatcher, type Docs } from '../../src/main/docs/watch'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const WINDOWS = process.platform === 'win32'
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let dir: string
let root: string
const watchers: DocsWatcher[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-root-')))
  root = join(dir, 'project')
  mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# handoff\n')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  removeTestTree(dir)
})

describe.runIf(WINDOWS)('DocsWatcher on Windows, real folders: the root is removed and made again', () => {
  it('stops listening when the root is removed — no processor time goes into its events — and follows the documents again when the root is back; the same a second time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const said = `[docs] the folder ${root} is gone: its documents are not watched until it is back`
    const lines = (): unknown[][] => warn.mock.calls.filter(([line]) => String(line).startsWith('[docs] the folder '))
    const changes: Docs[] = []
    const watcher = await DocsWatcher.start({ root, onChange: (docs) => changes.push(docs), retryMs: 200 })
    watchers.push(watcher)
    expect(watcher.current.handoff).not.toBeNull()

    /** Removes the root past the reads that follow a start of its watch, and measures a second with it gone. */
    const gone = async (): Promise<void> => {
      await pause(1200)
      unlinkSync(join(root, 'HANDOFF.md'))
      rmdirSync(root)
      await vi.waitFor(() => expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] }), { timeout: ms(5000), interval: 50 })
      // One second with the root gone. Before the fix this process spent about 990 ms of it on events.
      const before = process.cpuUsage()
      await pause(1000)
      const spent = process.cpuUsage(before)
      expect((spent.user + spent.system) / 1000).toBeLessThan(300)
    }
    /** Makes the root again with `text` in HANDOFF.md, then checks a later change comes through. */
    const back = async (text: string, later: string): Promise<void> => {
      mkdirSync(root)
      writeFileSync(join(root, 'HANDOFF.md'), text)
      await vi.waitFor(() => expect(changes.at(-1)?.handoff).not.toBeNull(), { timeout: ms(5000), interval: 50 })
      // And it is watched, not only read once: a later change comes through.
      const version = changes.at(-1)?.handoff?.version
      await pause(1200)
      writeFileSync(join(root, 'HANDOFF.md'), later)
      await vi.waitFor(() => expect(changes.at(-1)?.handoff?.version).not.toBe(version), { timeout: ms(5000), interval: 50 })
    }

    await gone()
    expect(lines()).toEqual([[said]])
    await back('# handoff, again\n', '# handoff, changed once more\n')

    // The root is removed a second time: the watch made anew is closed the same way, and the root
    // is waited for and watched again.
    await gone()
    expect(lines()).toEqual([[said], [said]])
    await back('# handoff, a third time\n', '# handoff, changed a third time\n')
  }, ms(40_000))
})

// macOS (worfy-windows ticket 38): a root that is removed or renamed gives one event, named by the
// root's last name (`project` here), and its watch stays: the same watch reports the root when it
// is back at its path. Measured on the Mac, Darwin 25.6.0, Node 24.21.0 of Electron 44.5.1.
const MACOS = process.platform === 'darwin'

/** The ways to take the root away that the ticket measured, and how each one brings it back. */
const WAYS: { way: string; away: () => void; back: () => void }[] = [
  {
    way: 'unlink and rmdir',
    away: () => {
      unlinkSync(join(root, 'docs', 'adr', '0001-first.md'))
      rmdirSync(join(root, 'docs', 'adr'))
      rmdirSync(join(root, 'docs'))
      unlinkSync(join(root, 'HANDOFF.md'))
      rmdirSync(root)
    },
    back: () => {
      mkdirSync(root)
      writeFileSync(join(root, 'HANDOFF.md'), '# handoff, again\n')
    },
  },
  {
    way: 'rename',
    away: () => renameSync(root, join(dir, 'moved')),
    back: () => renameSync(join(dir, 'moved'), root),
  },
  {
    way: 'a recursive remove',
    away: () => removeTestTree(root),
    back: () => {
      mkdirSync(root)
      writeFileSync(join(root, 'HANDOFF.md'), '# handoff, again\n')
    },
  },
]

describe.runIf(MACOS)('DocsWatcher on macOS, real folders: the root is removed or renamed, then back', () => {
  it.each(WAYS)('$way: the documents read as gone while the root is away, and are followed again when it is back', async ({ away, back }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    writeFileSync(join(root, 'docs', 'adr', '0001-first.md'), '# First\n\nДата: 2026-10-18. Статус: принят.\n')
    const changes: Docs[] = []
    const watcher = await DocsWatcher.start({ root, onChange: (docs) => changes.push(docs) })
    watchers.push(watcher)
    expect(watcher.current.handoff).not.toBeNull()
    expect(watcher.current.adrs).toHaveLength(1)
    // Past the reads that follow the start of the watch: what comes now comes from its events.
    await pause(1200)

    away()
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] }), { timeout: ms(3000), interval: 50 })
    // A folder renamed away is not followed under its new name.
    if (existsSync(join(dir, 'moved'))) {
      writeFileSync(join(dir, 'moved', 'HANDOFF.md'), '# handoff, moved\n')
      await pause(500)
      expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] })
    }

    back()
    await vi.waitFor(() => expect(changes.at(-1)?.handoff?.path).toBe('HANDOFF.md'), { timeout: ms(3000), interval: 50 })
    // Followed, not only read once: a later change comes through.
    const version = changes.at(-1)?.handoff?.version
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed once more\n')
    await vi.waitFor(() => expect(changes.at(-1)?.handoff?.version).not.toBe(version), { timeout: ms(3000), interval: 50 })
    // The watch was kept: the line of a root that is gone is a Windows one.
    expect(warn).not.toHaveBeenCalled()
  }, ms(20_000))
})

/**
 * Roots written otherwise than the folder on the disk: macOS names the event of the root by the
 * last name of its real path, so the watcher has to know that name. `folder` is made on the disk
 * and holds the documents; `written` is the root the watcher is given.
 */
const WRITTEN: { as: string; written: () => string; folder: () => string }[] = [
  {
    as: 'a symlink to the folder',
    written: () => {
      symlinkSync(join(dir, 'realproj'), join(dir, 'link'))
      return join(dir, 'link')
    },
    folder: () => join(dir, 'realproj'),
  },
  { as: 'the folder in another case', written: () => join(dir, 'project'), folder: () => join(dir, 'Project') },
]

describe.runIf(MACOS)('DocsWatcher on macOS, real folders: a root written otherwise than on the disk', () => {
  it.for(WRITTEN)('$as: renamed away, the documents read as gone; renamed back, they are read again', { timeout: ms(20_000) }, async ({ written, folder }, context) => {
    removeTestTree(root)
    const disk = folder()
    mkdirSync(join(disk, 'docs', 'adr'), { recursive: true })
    writeFileSync(join(disk, 'HANDOFF.md'), '# handoff\n')
    writeFileSync(join(disk, 'docs', 'adr', '0001-first.md'), '# First\n\nДата: 2026-10-18. Статус: принят.\n')
    const given = written()
    // A volume that tells case apart has no folder `project` here: nothing to check.
    if (!existsSync(given)) {
      context.skip()
      return
    }
    const changes: Docs[] = []
    const watcher = await DocsWatcher.start({ root: given, onChange: (docs) => changes.push(docs) })
    watchers.push(watcher)
    expect(watcher.current.handoff).not.toBeNull()
    await pause(1200)

    renameSync(disk, join(dir, 'moved'))
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] }), { timeout: ms(3000), interval: 50 })
    renameSync(join(dir, 'moved'), disk)
    await vi.waitFor(() => expect(changes.at(-1)?.handoff?.path).toBe('HANDOFF.md'), { timeout: ms(3000), interval: 50 })
    expect(changes.at(-1)?.adrs).toHaveLength(1)
  })
})
