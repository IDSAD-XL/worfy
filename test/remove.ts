// Removing a folder in a test (worfy-windows ticket 26). Tests run under the Node of Electron; on
// Windows its fs.rmSync with `recursive` refuses a read-only file with EPERM — git writes its
// objects that way — and goes through a junction, emptying the folder behind it (ticket 23). A
// cleanup that called it failed its test and left the temporary folder in %TEMP%. So tests remove
// through the function the application removes with, and no test calls fs.rmSync with `recursive`
// (test/unit/no-rmsync.test.ts).
//
// It lies in test/, not in test/unit or test/contract: both import it.
import { removeTree } from '../src/main/storage/remove'

/**
 * Removes a file, a link, or a folder with everything in it; a path that is not there is not an
 * error. A link is removed as a link. Takes the place of
 * `rmSync(path, { recursive: true, force: true })` in a test.
 */
export function removeTestTree(path: string): void {
  removeTree(path)
}

/**
 * Writes now what the Layout store of the application still holds back. The store saves a quarter
 * of a second after the last change (LAYOUT_SAVE_DELAY_MS); a test that removed its data folder
 * before that got the folder back, with layout.json in it, when the save came. Called before the
 * folder is removed. The store is asked for when it is called: a test that reset the modules gets
 * the store its own imports got.
 */
export async function saveLayoutNow(): Promise<void> {
  const { layoutStore } = await import('../src/main/layout/store')
  layoutStore().flushAll()
}
