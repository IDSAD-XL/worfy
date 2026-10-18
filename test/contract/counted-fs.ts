// For the tests of worfy-windows ticket 20 that run over real folders and real links on Windows:
// a symlink to a share nobody answers for, a count of every call of node:fs that takes a path,
// and a wait.
import fs, { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A share of a host that does not exist: a call through a link to it fails after more than a second. */
export const SHARE = '\\\\worfy-no-such-host\\share'

/** Whether this user may make a symlink on Windows (Developer Mode, or an elevated process). */
export function canLink(): boolean {
  if (process.platform !== 'win32') return false
  const probe = mkdtempSync(join(tmpdir(), 'worfy-watch-links-probe-'))
  try {
    symlinkSync(`${SHARE}\\probe`, join(probe, 'link'), 'dir')
    unlinkSync(join(probe, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmdirSync(probe)
  }
}

export async function until(what: string, done: () => boolean, ms = 5000): Promise<void> {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** The calls that change the disk, as countFsCalls labels them (worfy-windows ticket 33). */
export type FsWrite = 'mkdir' | 'rename' | 'rm' | 'rmdir' | 'unlink'

/**
 * Counts the calls of node:fs that take a path, whoever makes them — chokidar included: the
 * functions are replaced on the module and the named imports are brought in line with it. The
 * calls that change the disk are counted too; the ones named in `refuse` are counted and then
 * fail with EPERM before they reach the disk, so a test can show a folder is not made without
 * making it anywhere.
 */
export function countFsCalls(options: { refuse?: readonly FsWrite[] } = {}): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const undo: (() => void)[] = []
  const refused = new Set<string>(options.refuse ?? [])
  const wrap = (owner: Record<string, unknown>, name: string, label: string): void => {
    const original = owner[name] as (...args: unknown[]) => unknown
    const counted = function (this: unknown, ...args: unknown[]): unknown {
      calls.push(`${label} ${String(args[0])}`)
      if (refused.has(label)) {
        const error = Object.assign(new Error(`EPERM: ${label} ${String(args[0])} is refused by the test`), { code: 'EPERM' })
        // The promise form rejects, the callback form calls back with the error, the sync form throws.
        if (owner === (fs.promises as unknown)) return Promise.reject(error)
        const callback = args.at(-1)
        if (name === label && typeof callback === 'function') return void (callback as (error: Error) => void)(error)
        throw error
      }
      return original.apply(this, args)
    }
    owner[name] = Object.assign(counted, original)
    undo.push(() => {
      owner[name] = original
    })
  }
  const writes: FsWrite[] = ['mkdir', 'rename', 'rm', 'rmdir', 'unlink']
  for (const name of ['realpath', 'stat', 'lstat', 'readdir', 'open', 'readlink', 'access', 'readFile', ...writes]) wrap(fs.promises as unknown as Record<string, unknown>, name, name)
  for (const name of ['realpath', 'stat', 'lstat', 'readdir', 'open', 'readlink', 'access', 'readFile', 'watch', 'watchFile', ...writes]) wrap(fs as unknown as Record<string, unknown>, name, name)
  for (const name of ['realpathSync', 'statSync', 'lstatSync', 'readdirSync', 'openSync', 'readlinkSync', 'existsSync', 'accessSync', 'readFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'rmdirSync', 'unlinkSync']) wrap(fs as unknown as Record<string, unknown>, name, name.replace(/Sync$/, ''))
  syncBuiltinESMExports()
  return {
    calls,
    restore: () => {
      for (const each of undo) each()
      syncBuiltinESMExports()
    },
  }
}

/**
 * The counted calls that name a path through the link. Not counted: the calls on the link itself
 * that do not follow it — lstat and readlink read it, rename moves it, unlink and rmdir take it
 * away. mkdir and rm of the link itself are counted: worfy has no reason to make or remove a
 * folder through a link, and with `recursive` either may go through it.
 */
export function through(calls: readonly string[], link: string): string[] {
  const lower = link.toLowerCase()
  return calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').toLowerCase()
    if (path === lower) return !/^(lstat|readlink|rename|unlink|rmdir) /.test(call)
    return path.startsWith(`${lower}\\`)
  })
}
