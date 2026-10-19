// Who made an IPC call, and what a call from a Linked machine may reach (worfy-link ticket 08;
// ADR-0052, point 6: with access on, a Linked machine may do everything in the Projects of this
// Machine — in them, not anywhere on the disk).
//
// A window's `event.sender` is its webContents, whose id is a number. A sender whose id is a
// string — a client without a window, "<kind>:<name>" (src/main/clients.ts), such as the clients of
// a link connection (ipc-adapter.ts, "link:<machineId>/<n>") — counts as a call from outside this
// Machine's screen. The handlers that take a path from the caller (a cwd, a Project root, a file to
// attach) check it with insideProjects() for such a call; a window's call goes on as before.
//
// "Inside" is decided on real paths: the path and every Project root go through realpath (the
// native one, which on macOS also gives the case the disk has), so `..`, a symbolic link out of a
// Project, or another spelling of a folder does not pass. A path that does not exist yet is judged
// by its nearest existing folder.
import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'

/** Whether a call came from somewhere else than a window of this Machine (see the top of the file). */
export function isRemoteCall(event: { readonly sender?: unknown }): boolean {
  const sender = event.sender
  if (typeof sender !== 'object' || sender === null) return false
  // A client of a link connection, like any client without a window, has a string id.
  return typeof (sender as { id?: unknown }).id === 'string'
}

/**
 * The real path. For a path that does not exist (yet): the real path of its nearest existing
 * folder, then the missing names as they are (a `..` after a missing name cannot lead through a
 * link: there is none). A symbolic link that leads nowhere gives null: there is no telling where it
 * will lead. Null too when a folder cannot be read.
 */
function real(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
  }
  // Something is there after all: a symbolic link that leads nowhere yet, so nobody knows where.
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) return null
  const name = basename(path)
  const parent = dirname(path)
  if (parent === path) return null
  const head = real(parent)
  return head === null ? null : join(head, name)
}

/** The real path of `path` when it lies inside (or is) the root of one of `projects`; null otherwise. */
export function realInsideProjects(path: string, projects: readonly { readonly path: string }[]): string | null {
  const target = real(path)
  if (target === null) return null
  const inside = projects.some((project) => {
    const root = real(project.path)
    if (root === null) return false
    return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
  })
  return inside ? target : null
}

/** The real path of a folder that exists; null when it does not or cannot be read. */
function realExisting(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * The real path of `path` when it exists and is the root of one of `projects` or one of the git
 * worktrees `worktrees` lists for a root that holds it; null otherwise. Unlike realInsideProjects,
 * a folder that is merely inside a Project, or a path that does not exist, does not pass: Claude
 * Code names its folders after a path with every `/` turned into `-`, so a missing `<root>/evil`
 * shares its folder with `<root>-evil`, which lies outside the Project (worfy-link ticket 32).
 * A worktree outside every root is not asked for: it is outside the Projects, as for insideProjects.
 */
export async function realProjectRoot(
  path: string,
  projects: readonly { readonly path: string }[],
  worktrees: (root: string) => Promise<readonly string[]>,
): Promise<string | null> {
  const target = realExisting(path)
  if (target === null) return null
  const roots = projects.flatMap((project) => {
    const root = realExisting(project.path)
    return root === null ? [] : [root]
  })
  if (roots.includes(target)) return target
  for (const root of roots) {
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) continue
    for (const worktree of await worktrees(root)) if (realExisting(worktree) === target) return target
  }
  return null
}

/**
 * For a call from outside this Machine's screen, throws unless `path` is the root of a Project of
 * the list or one of its worktrees (realProjectRoot), and answers its real path, as insideProjects
 * does. For the handlers whose root names Claude home folders. A path outside every Project gets
 * the refusal of insideProjects. A window's call passes untouched.
 */
export async function projectRootOf(
  event: { readonly sender?: unknown },
  path: string,
  projects: () => readonly { readonly path: string }[],
  worktrees: (root: string) => Promise<readonly string[]>,
  what: string,
): Promise<string> {
  if (!isRemoteCall(event)) return path
  insideProjects(event, path, projects, what)
  const checked = await realProjectRoot(path, projects(), worktrees)
  if (checked === null) throw new Error(`${what} ${path} is neither the root of a Project of this Machine nor one of its worktrees; a Linked machine asks for the Sessions of those only`)
  return checked
}

/**
 * For a call from outside this Machine's screen, throws unless `path` lies inside a Project of
 * the list, and answers its real path: the caller uses that one, so a link swapped in after the
 * check does not lead elsewhere. A window's call passes untouched, with `path` as it came.
 * `what` names the path in the refusal.
 */
export function insideProjects(event: { readonly sender?: unknown }, path: string, projects: () => readonly { readonly path: string }[], what: string): string {
  if (!isRemoteCall(event)) return path
  const checked = realInsideProjects(path, projects())
  if (checked === null) throw new Error(`${what} ${path} is outside the Projects of this Machine; a Linked machine works only inside them`)
  return checked
}
