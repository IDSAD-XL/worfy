// Paths as worfy reads them on any platform (worfy-windows ticket 08, ADR-0054). Shared by main and
// renderer, so it does not use node:path. On Windows a path comes with `\` (Claude Code's
// `file_path`, the file system) or with `/`; both are separators here.
import { z } from 'zod'

/** `C:\…` or `C:/…`: a drive letter, a colon and a separator. `C:a` is relative to the drive's current folder. */
const DRIVE_ROOT = /^[A-Za-z]:[\\/]/
/** `\\server\share…` or `//server/share…`: a UNC path names a server and a share. */
const UNC = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/

/**
 * An absolute path: POSIX `/…`, Windows `C:\…` or `C:/…` (any case of the letter), UNC
 * `\\server\share\…`. Not absolute: `a/b`, `a\b`, `C:a`, `\a` (the root of the current drive), ''.
 * A path with a NUL is refused: no file system takes one.
 */
export function isAbsolutePath(path: string): boolean {
  if (path === '' || path.includes('\0')) return false
  return path.startsWith('/') || DRIVE_ROOT.test(path) || UNC.test(path)
}

/** An absolute path for IPC (isAbsolutePath); the main process resolves it again before use. */
export const absolutePathSchema = z.string().min(1).refine(isAbsolutePath, 'must be an absolute path')

/** The last segment of a path, split at `/` and `\`. */
export function lastPathSegment(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}
