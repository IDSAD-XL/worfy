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

/**
 * An absolute path by the rules of Windows: `C:\…`, `C:/…` or UNC. Not `/x` nor `\x` (the root of
 * the current drive) nor `C:x`. The one rule for values that must name a Windows folder, such as
 * APPDATA for dataRoot() and for scripts/statusline-bridge.mjs, which keeps a copy of it.
 */
export function isWindowsAbsolutePath(path: string): boolean {
  return !path.includes('\0') && (DRIVE_ROOT.test(path) || UNC.test(path))
}

/** An absolute path for IPC (isAbsolutePath); the main process resolves it again before use. */
export const absolutePathSchema = z.string().min(1).refine(isAbsolutePath, 'must be an absolute path')

/**
 * A Windows absolute path in one spelling: `/` as the separator, the drive letter upper-case, no
 * separator at the end (the drive root keeps its one: `C:/`).
 */
function windowsRootKey(path: string): string {
  const slashed = path.replaceAll('\\', '/')
  const lettered = DRIVE_ROOT.test(slashed) ? slashed.charAt(0).toUpperCase() + slashed.slice(1) : slashed
  const trimmed = lettered.replace(/\/+$/, '')
  return /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/**
 * Whether two spellings name one Project root (worfy-windows ticket 49). On Windows the Project
 * list keeps the root as git prints it, `C:/…`, while a note from the registry under ~/.claude
 * carries path.resolve's `C:\…`. Two Windows absolute paths are one root when they differ only in
 * `/` against `\`, the case of the drive letter, or a separator at the end; the rest of the path
 * keeps its case, since a folder may be case-sensitive. Any other paths, POSIX ones among them, are
 * compared as they are: there `\` is a character of a file name.
 */
export function sameProjectRoot(a: string, b: string): boolean {
  if (a === b) return true
  if (!isWindowsAbsolutePath(a) || !isWindowsAbsolutePath(b)) return false
  return windowsRootKey(a) === windowsRootKey(b)
}

/** The last segment of a path, split at `/` and `\`. */
export function lastPathSegment(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}
