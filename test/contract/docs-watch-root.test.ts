// DocsWatcher over real folders when its root is removed and made again (worfy-windows ticket 27).
// Windows only: there fs.watch of a removed folder sends events without end — before the fix the
// process spent a whole processor core on them and never saw the folder come back. The same case
// on a stand-in watch, for any system, is test/unit/docs-watch-root-gone.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsWatcher, type Docs } from '../../src/main/docs/watch'
import { removeTestTree } from '../remove'

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
  it('stops listening when the root is removed — no processor time goes into its events — and follows the documents again when the root is back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const changes: Docs[] = []
    const watcher = await DocsWatcher.start({ root, onChange: (docs) => changes.push(docs), retryMs: 200 })
    watchers.push(watcher)
    expect(watcher.current.handoff).not.toBeNull()
    // Past the reads that follow a start.
    await pause(1200)

    unlinkSync(join(root, 'HANDOFF.md'))
    rmdirSync(root)
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] }), { timeout: 5000, interval: 50 })
    // One second with the root gone. Before the fix this process spent about 990 ms of it on events.
    const before = process.cpuUsage()
    await pause(1000)
    const spent = process.cpuUsage(before)
    expect((spent.user + spent.system) / 1000).toBeLessThan(300)
    expect(warn.mock.calls.filter(([line]) => String(line).startsWith('[docs] the folder '))).toEqual([[`[docs] the folder ${root} is gone: its documents are not watched until it is back`]])

    mkdirSync(root)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, again\n')
    await vi.waitFor(() => expect(changes.at(-1)?.handoff).not.toBeNull(), { timeout: 5000, interval: 50 })
    // And it is watched, not only read once: a later change comes through.
    const version = changes.at(-1)?.handoff?.version
    await pause(1200)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed once more\n')
    await vi.waitFor(() => expect(changes.at(-1)?.handoff?.version).not.toBe(version), { timeout: 5000, interval: 50 })
  }, 30_000)
})
