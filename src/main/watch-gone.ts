// The one fs.watch of Node behind DocsWatcher (docs/watch.ts), the status line watch of the Limits
// (agent/limits.ts) and LinkSafeWatch (link-safe-watch.ts), and the rule all three use to tell that
// the folder they watch is gone (worfy-windows tickets 27 and 36).
//
// On Windows fs.watch of a folder that is removed neither closes nor fails: it sends an endless run
// of events that name the folder itself by its `\\?\` path — some 87 000 to 147 000 a second on the
// owner's PC, a whole processor core; recursive or not, the same. A name under the watched folder
// is not a full path, so the first event whose name is one says the folder is gone, and the watch
// is closed there.
//
// One exception, macOS only: a watch of the root of the file system, `/`, names its events by full
// paths (measured at the review of PR #281). Such a watch is closed at its first event, as if the
// folder were gone. No Project and no data folder is `/`, so nothing is done about it.
import { watch } from 'node:fs'

/**
 * Watches a folder (with everything below it when `recursive`) or a file. `onEvent` gets the name
 * the system reports, relative to the path, or null when it reports none, and the kind of event;
 * `close` ends the watch.
 */
export type NodeWatch = (path: string, recursive: boolean, onEvent: (name: string | null, event?: WatchEvent) => void, onError: (error: unknown) => void) => { close: () => void }

/** A name came or went, or something about it changed. */
export type WatchEvent = 'rename' | 'change'

/** The handle it returns is Node's FSWatcher itself. */
export const watchWithNode: NodeWatch = (path, recursive, onEvent, onError) => {
  const watcher = watch(path, { recursive }, (event, name) => onEvent(name === null ? null : String(name), event))
  watcher.on('error', onError)
  return watcher
}

/** Whether the name an event carries is the watched folder itself, which is gone: a full path. */
export function namesTheFolder(name: string | null, isAbsolute: (name: string) => boolean): boolean {
  return name !== null && isAbsolute(name)
}

/** Whether a failed call says that nothing is at the path. */
export function notThere(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException | null)?.code ?? '')
}
