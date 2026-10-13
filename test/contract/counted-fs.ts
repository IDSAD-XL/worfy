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

/**
 * Counts the calls of node:fs that take a path, whoever makes them — chokidar included: the
 * functions are replaced on the module and the named imports are brought in line with it.
 */
export function countFsCalls(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const undo: (() => void)[] = []
  const wrap = (owner: Record<string, unknown>, name: string, label: string): void => {
    const original = owner[name] as (...args: unknown[]) => unknown
    const counted = function (this: unknown, ...args: unknown[]): unknown {
      calls.push(`${label} ${String(args[0])}`)
      return original.apply(this, args)
    }
    owner[name] = Object.assign(counted, original)
    undo.push(() => {
      owner[name] = original
    })
  }
  for (const name of ['realpath', 'stat', 'lstat', 'readdir', 'open', 'readlink', 'access', 'readFile']) wrap(fs.promises as unknown as Record<string, unknown>, name, name)
  for (const name of ['realpath', 'stat', 'lstat', 'readdir', 'open', 'readlink', 'access', 'readFile', 'watch', 'watchFile']) wrap(fs as unknown as Record<string, unknown>, name, name)
  for (const name of ['realpathSync', 'statSync', 'lstatSync', 'readdirSync', 'openSync', 'readlinkSync', 'existsSync', 'accessSync', 'readFileSync']) wrap(fs as unknown as Record<string, unknown>, name, name.replace(/Sync$/, ''))
  syncBuiltinESMExports()
  return {
    calls,
    restore: () => {
      for (const each of undo) each()
      syncBuiltinESMExports()
    },
  }
}

/** The counted calls that name a path through the link, other than lstat and readlink of the link itself. */
export function through(calls: readonly string[], link: string): string[] {
  const lower = link.toLowerCase()
  return calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').toLowerCase()
    if (path === lower) return !/^(lstat|readlink) /.test(call)
    return path.startsWith(`${lower}\\`)
  })
}
