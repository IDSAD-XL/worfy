// closeForGood on a real chokidar watch (worfy-windows tickets 75 and 76). chokidar 5.0.0 calls
// add() on a watcher it has already closed (its `_remove`, after a failed stat of a removed file),
// and add() sets `closed` back to false and opens fs.watch handles nobody closes again. The removal
// that makes chokidar do it is a race (test/contract/workflow-branches-handles.test.ts runs it); here
// the late add() is called directly, as chokidar does, so both parts of the helper are checked on
// every system and every run.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeForGood } from '../../src/main/chokidar-close'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
/** The handles of fs.watch this process holds. */
const fsWatches = (): number => process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length

const dirs: string[] = []
const opened: FSWatcher[] = []
afterEach(async () => {
  // A watch the helper failed to keep closed must not outlive its test.
  await Promise.all(opened.splice(0).map((watcher) => watcher.close()))
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

async function watched(): Promise<{ watcher: FSWatcher; folder: string; before: number }> {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-chokidar-close-')))
  dirs.push(dir)
  const folder = join(dir, 'watched')
  mkdirSync(folder)
  writeFileSync(join(folder, 'main'), 'a\n')
  const before = fsWatches()
  const watcher = watch(folder, { ignoreInitial: true })
  opened.push(watcher)
  await new Promise<void>((done) => watcher.once('ready', () => done()))
  return { watcher, folder, before }
}

describe('closeForGood keeps a chokidar watch closed', () => {
  it('an add() after the close, as chokidar makes from a failed stat, opens no fs.watch and leaves the watch closed', async () => {
    const { watcher, folder, before } = await watched()
    expect(fsWatches()).toBeGreaterThan(before)
    await closeForGood(watcher)
    // Node gives a closed handle back on a later turn of the event loop.
    await vi.waitFor(() => expect(fsWatches()).toBe(before), { timeout: ms(2000), interval: 10 })

    watcher.add(folder)
    // chokidar's add() opens its handles after a stat: give it the time, times the run's multiplier.
    await pause(ms(200))
    expect(watcher.closed).toBe(true)
    expect(fsWatches()).toBe(before)
  })

  it("an 'error' after the close, from a walk chokidar had still running, throws nowhere", async () => {
    const { watcher } = await watched()
    await closeForGood(watcher)
    // chokidar's close() removes every listener; an 'error' event with no listener throws.
    expect(() => watcher.emit('error', new Error('EPERM: operation not permitted, realpath'))).not.toThrow()
  })
})
