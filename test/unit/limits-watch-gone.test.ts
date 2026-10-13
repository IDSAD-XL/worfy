// The watch of the status line file and a data folder that is removed (worfy-windows ticket 27).
// On Windows fs.watch of a folder that is removed sends an endless run of events that name the
// folder itself by its `\\?\` path — recursive or not, measured: 442 394 events and a whole
// processor core in 3 s. The watch of the system is a stand-in here and the rule for a full path is
// path.win32's, so the case runs on any system.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitsTracker, STATUSLINE_FILE, type WatchFolder } from '../../src/main/agent/limits'
import { removeTestTree } from '../remove'

const dirs: string[] = []
const trackers: LimitsTracker[] = []

afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function started(): { tracker: LimitsTracker; dataDir: string; watches: { closed: boolean; event: (name: string | null) => void }[]; reads: () => number } {
  const dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-limits-gone-')))
  dirs.push(dataDir)
  const watches: { closed: boolean; event: (name: string | null) => void }[] = []
  const watch: WatchFolder = (_dir, onEvent) => {
    const one = { closed: false, event: onEvent }
    watches.push(one)
    return { close: () => void (one.closed = true) }
  }
  const tracker = new LimitsTracker({ dataDir, watch, isAbsolute: win32.isAbsolute })
  trackers.push(tracker)
  const read = vi.spyOn(tracker, 'readStatusline')
  tracker.watchStatusline()
  return { tracker, dataDir, watches, reads: () => read.mock.calls.length }
}

describe('the watch of the status line file and a data folder that is gone', () => {
  it('reads the file after an event that names it, and after one with no name', async () => {
    vi.useFakeTimers()
    const { watches, reads } = started()
    expect(watches).toHaveLength(1)
    expect(reads()).toBe(1)
    watches[0]!.event(STATUSLINE_FILE)
    await vi.advanceTimersByTimeAsync(60)
    expect(reads()).toBe(2)
    watches[0]!.event(null)
    await vi.advanceTimersByTimeAsync(60)
    expect(reads()).toBe(3)
    // Another file of the data folder is nobody's business here.
    watches[0]!.event('limits.json')
    await vi.advanceTimersByTimeAsync(60)
    expect(reads()).toBe(3)
    expect(watches[0]!.closed).toBe(false)
  })

  it('closes the watch at the first event that names the folder itself, says so once, and takes nothing more from it', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { dataDir, watches, reads } = started()
    for (let times = 0; times < 50; times++) watches[0]!.event('\\\\?\\C:\\Users\\dev\\AppData\\Roaming\\worfy')
    expect(watches[0]!.closed).toBe(true)
    expect(warn.mock.calls).toEqual([[`[limits] the data folder ${dataDir} is gone: the status line file is no longer watched, only looked at every 1000 ms`]])
    // What the closed watch still sends is dropped: no read is scheduled.
    watches[0]!.event(STATUSLINE_FILE)
    watches[0]!.event(null)
    await vi.advanceTimersByTimeAsync(200)
    expect(reads()).toBe(1)
    expect(watches).toHaveLength(1)
  })

  it('stop after the watch was closed that way does not fail, and a new start watches again', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { tracker, watches } = started()
    watches[0]!.event('\\\\?\\C:\\data')
    tracker.stop()
    tracker.watchStatusline()
    expect(watches).toHaveLength(2)
    expect(watches[1]!.closed).toBe(false)
  })
})
