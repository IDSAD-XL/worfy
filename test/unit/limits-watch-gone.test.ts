// The watch of the status line file and a data folder that is removed (worfy-windows ticket 27).
// On Windows fs.watch of a folder that is removed sends an endless run of events that name the
// folder itself by its `\\?\` path — recursive or not, measured: 442 394 events and a whole
// processor core in 3 s. The watch of the system is a stand-in here and the rule for a full path is
// path.win32's, so the case runs on any system.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitsTracker, STATUSLINE_FILE, type WatchFolder } from '../../src/main/agent/limits'
import { removeTestTree } from '../remove'

/** The name Windows gives in the events of a watched folder that is gone. */
const ITSELF = '\\\\?\\C:\\Users\\dev\\AppData\\Roaming\\worfy'
/** What the status line bridge writes: 42 % of the five-hour window used. */
const STATUSLINE = JSON.stringify({ five_hour: { used_percentage: 42, resets_at: 2_000_000_000 } })
const gone = (dataDir: string): string => `[limits] the data folder ${dataDir} is gone: the status line file is no longer watched, only looked at every 1000 ms`

const dirs: string[] = []
const trackers: LimitsTracker[] = []

afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** `systemRule`: no rule for a full path is given, the tracker takes the system's. */
function started({ systemRule = false } = {}): { tracker: LimitsTracker; dataDir: string; watches: { closed: boolean; event: (name: string | null) => void }[]; reads: () => number } {
  const dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-limits-gone-')))
  dirs.push(dataDir)
  const watches: { closed: boolean; event: (name: string | null) => void }[] = []
  const watch: WatchFolder = (_dir, onEvent) => {
    const one = { closed: false, event: onEvent }
    watches.push(one)
    return { close: () => void (one.closed = true) }
  }
  const tracker = new LimitsTracker({ dataDir, watch, ...(systemRule ? {} : { isAbsolute: win32.isAbsolute }) })
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
    watches[0]!.event(ITSELF)
    expect(watches[0]!.closed).toBe(true)
    for (let times = 1; times < 50; times++) watches[0]!.event(ITSELF)
    expect(warn.mock.calls).toEqual([[gone(dataDir)]])
    // What the closed watch still sends is dropped: no read is scheduled.
    watches[0]!.event(STATUSLINE_FILE)
    watches[0]!.event(null)
    await vi.advanceTimersByTimeAsync(200)
    expect(reads()).toBe(1)
    expect(watches).toHaveLength(1)
  })

  it('the slow poll goes on after the watch was closed: a file written then is read', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { tracker, dataDir, watches, reads } = started()
    watches[0]!.event(ITSELF)
    expect(watches[0]!.closed).toBe(true)
    writeFileSync(join(dataDir, STATUSLINE_FILE), STATUSLINE)
    await vi.advanceTimersByTimeAsync(1100)
    expect(reads()).toBe(2)
    expect(tracker.snapshot().windows.five_hour?.utilization).toBe(0.42)
  })

  it('the slow poll reads the file of a data folder that was removed and made again', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { tracker, dataDir, watches, reads } = started()
    removeTestTree(dataDir)
    watches[0]!.event(ITSELF)
    await vi.advanceTimersByTimeAsync(1100)
    expect(reads()).toBe(1)
    mkdirSync(dataDir)
    writeFileSync(join(dataDir, STATUSLINE_FILE), STATUSLINE)
    await vi.advanceTimersByTimeAsync(1100)
    expect(reads()).toBe(2)
    expect(tracker.snapshot().windows.five_hour?.utilization).toBe(0.42)
    expect(watches).toHaveLength(1)
  })

  it('takes the rule for a full path from the system when none is given: an event that names the folder by its path closes the watch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { watches, dataDir } = started({ systemRule: true })
    watches[0]!.event('worfy')
    expect(watches[0]!.closed).toBe(false)
    watches[0]!.event(dataDir)
    expect(watches[0]!.closed).toBe(true)
    expect(warn.mock.calls).toEqual([[gone(dataDir)]])
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
