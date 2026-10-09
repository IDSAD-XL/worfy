import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { shell } from 'electron'
import { shellOpenExternal, shellOpenInEditor } from '../../shared/ipc/shell'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

type PathRules = Pick<typeof nativePath, 'isAbsolute' | 'relative' | 'resolve' | 'sep'>

/**
 * True when `path` is `base` itself or lies under it, by the rules of `paths`. Only a first segment
 * that is exactly `..` leaves `base`: a folder named `..drafts` inside it is still inside.
 */
function isInside(base: string, path: string, paths: PathRules = nativePath): boolean {
  const rel = paths.relative(base, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel))
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

export interface ResolveOptions {
  /** realpath, or null when there is no such file; replaced in tests. */
  real?: (path: string) => Promise<string | null>
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
}

/**
 * The real path of `path` when it lies inside the Project root or one of its worktrees; throws
 * otherwise. First by the text alone, against the folders as written and as real paths: a path
 * outside is refused before any file system call on it, so a link to `\\host\share\…` never makes
 * Windows contact that host and hand it the user's NTLM credentials (review of worfy-windows ticket
 * 08). Then symlinks are resolved on both sides, so `../` and a link that points out of the Project
 * are refused, and a file that does not exist is refused too. A Project on a share is opened on that
 * share as before: its own folders are the bases.
 */
export async function resolveProjectFile(root: string, path: string, worktrees: readonly string[], options: ResolveOptions = {}): Promise<string> {
  const real = options.real ?? realOrNull
  const paths = options.paths ?? nativePath
  const folders = [root, ...worktrees].map((folder) => paths.resolve(folder))
  const bases = (await Promise.all(folders.map(real))).filter((base): base is string => base !== null)
  const candidate = paths.resolve(root, path)
  if (![...folders, ...bases].some((base) => isInside(base, candidate, paths))) throw new Error(`${path} is outside the Project and its worktrees`)
  const target = await real(candidate)
  if (target === null) throw new Error(`${path} does not exist`)
  if (!bases.some((base) => isInside(base, target, paths))) throw new Error(`${path} is outside the Project and its worktrees`)
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
