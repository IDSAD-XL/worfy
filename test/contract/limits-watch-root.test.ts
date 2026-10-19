// The watch of the status line file over a real data folder that is removed (worfy-windows
// ticket 27). Windows only: there fs.watch of a removed folder sends events without end, also when
// it is not recursive. The same case on a stand-in watch is test/unit/limits-watch-gone.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitsTracker, STATUSLINE_FILE } from '../../src/main/agent/limits'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const trackers: LimitsTracker[] = []
const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const tracker of trackers.splice(0)) tracker.stop()
  for (const dir of dirs.splice(0)) if (existsSync(dir)) removeTestTree(dir)
})

describe.runIf(WINDOWS)('the watch of the status line file on Windows, a real data folder that is removed', () => {
  it('stops listening: no processor time goes into the events of the folder that is gone, and it is said once; the slow poll still reads the file when the folder is back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-limits-root-')))
    dirs.push(dir)
    const dataDir = join(dir, 'data')
    const tracker = new LimitsTracker({ dataDir })
    trackers.push(tracker)
    // Makes the folder, and watches it.
    tracker.watchStatusline()
    await pause(300)

    for (const name of readdirSync(dataDir)) unlinkSync(join(dataDir, name))
    rmdirSync(dataDir)
    await pause(200)
    // One second with the folder gone. Before the fix this process spent about 1000 ms of it on events.
    const before = process.cpuUsage()
    await pause(1000)
    const spent = process.cpuUsage(before)
    expect((spent.user + spent.system) / 1000).toBeLessThan(300)
    expect(warn.mock.calls.filter(([line]) => String(line).startsWith('[limits] the data folder '))).toEqual([[`[limits] the data folder ${dataDir} is gone: the status line file is no longer watched, only looked at every 1000 ms`]])

    // The folder is made again and the bridge writes the file: the slow poll reads it.
    mkdirSync(dataDir)
    writeFileSync(join(dataDir, STATUSLINE_FILE), JSON.stringify({ five_hour: { used_percentage: 42, resets_at: 2_000_000_000 } }))
    await vi.waitFor(() => expect(tracker.snapshot().windows.five_hour?.utilization).toBe(0.42), { timeout: 5000, interval: 50 })
  })
})
