// The one way worfy closes a chokidar watch (worfy-windows tickets 75 and 76). Every chokidar
// FSWatcher in src/main is closed through closeForGood, never by its own close():
// test/unit/chokidar-close-callers.test.ts checks that.
import type { FSWatcher } from 'chokidar'

/**
 * Closes a chokidar watch so that it stays closed. chokidar 5.0.0 can open a watch again after
 * close(): a file listener whose stat of a removed file fails after the close calls `_remove`,
 * which calls `add()` on the closed watcher (index.js:723), and `add()` sets `closed` back to
 * false and watches the nearest folder still there. Nobody closes that fs.watch handle again, and
 * once the folder is removed it sends events without end. With `add` made a no-op first, the
 * late call adds nothing and `closed` stays true, so the walks still in flight stop as well.
 * close() also removes every listener, and a walk still in flight whose realpath fails (EPERM while
 * Windows removes the folder) then emits 'error' with no listener: EventEmitter throws it, and it
 * became an unhandled rejection. The listener added after the close drops those late errors.
 * shortcut: covers only a late re-add through `add()`, redo when chokidar is upgraded and opens a
 * watch after close() another way (test/unit/chokidar-close.test.ts and
 * test/contract/workflow-branches-handles.test.ts count them).
 */
export function closeForGood(watcher: FSWatcher): Promise<void> {
  watcher.add = () => watcher
  const closed = watcher.close()
  watcher.on('error', () => undefined)
  return closed
}

