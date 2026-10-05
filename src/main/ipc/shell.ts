import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { shell } from 'electron'
import { shellOpenExternal, shellOpenInEditor } from '../../shared/ipc/shell'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

/** True when `path` is `base` itself or lies under it. Both are real paths. */
function isInside(base: string, path: string): boolean {
  const rel = relative(base, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The folders of the Project's git worktrees (the main one included); empty when git cannot say. */
function worktreeFolders(root: string): Promise<string[]> {
  return new Promise((done) => {
    execFile('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10_000 }, (error, stdout) => {
      if (error) return done([])
      done(
        stdout
          .split('\n')
          .filter((line) => line.startsWith('worktree '))
          .map((line) => line.slice('worktree '.length)),
      )
    })
  })
}

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null)

/**
 * The real path of `path` when it lies inside the Project root or one of its worktrees; throws
 * otherwise. Symlinks are resolved on both sides first, so `../` and a link that points out of
 * the Project are refused, and a file that does not exist is refused too.
 */
export async function resolveProjectFile(root: string, path: string, worktrees: readonly string[]): Promise<string> {
  const target = await realOrNull(resolve(root, path))
  if (target === null) throw new Error(`${path} does not exist`)
  const bases = (await Promise.all([root, ...worktrees].map(realOrNull))).filter((base): base is string => base !== null)
  if (!bases.some((base) => isInside(base, target))) throw new Error(`${path} is outside the Project and its worktrees`)
  return target
}

/** The URL when it is an https:// address; throws otherwise. */
export function httpsUrl(url: string): string {
  if (!URL.canParse(url)) throw new Error(`${url} is not an address`)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`only https:// addresses are opened, not ${parsed.protocol}`)
  return parsed.href
}

export default [
  defineHandler(shellOpenInEditor, async ({ projectId, path }) => {
    const root = projectStore().get(projectId).path
    const target = await resolveProjectFile(root, path, await worktreeFolders(root))
    // openPath answers with an error message, or '' when the file was handed over.
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
    return { path: target }
  }),
  defineHandler(shellOpenExternal, async ({ url }) => {
    const href = httpsUrl(url)
    await shell.openExternal(href)
    return { url: href }
  }),
] satisfies HandlerModule
