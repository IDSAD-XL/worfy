// The read guard of a single request that names its folders (`readFolders` of OneShotOptions): the
// Code story request (src/main/stories/one-shot.ts) and the Project profile draft
// (src/main/projects/connect.ts). Their text carries material the person did not write — a PR's diff and
// description, a repository's files — and a line there can ask the model to read a file elsewhere on the
// machine (a token, a private key) and quote it in the answer, which worfy keeps. `additionalDirectories`
// only adds folders Claude Code reads without asking; it forbids none. So the request's canUseTool
// (readOnlyCanUseTool, one-shot.ts) asks this guard about each Read, Glob and Grep, and those three are kept
// out of `allowedTools`, so that every call reaches canUseTool.
//
// A path is allowed when it resolves inside one of the request's folders: its cwd, its readFolders and,
// for the draft, the Harness plugin's own folder (the skill /worfy:connect-project reads its schema and
// README there). The guard first expands a path as Claude Code does before it runs the tool: `~` is the
// home folder, a relative path resolves against the cwd, and `..` collapses as text. Both that path and
// the place the OS reaches through it (links followed; a path that does not exist through its nearest
// existing parent) must lie inside a folder, so neither a link inside the folder nor `<link>/../..` reaches
// out, while `<checkout>/src/../README.md` stays allowed. The comparison is on a separator
// boundary (`/repo` does not hold `/repo-other`); on Windows it ignores case, accepts `/` and the `\\?\`
// prefix, and refuses a drive-relative path (`C:x`), whose folder depends on a per-drive cwd. A path the
// guard cannot be sure to read as Claude Code does is refused (`unclear`: whitespace at an end, a control
// character, `~name`).
//
// Glob: its `path` (absent: the cwd) is checked like any path, and its `pattern` is checked from the
// part before its first wildcard: an absolute pattern from that part alone, a relative one joined to the
// `path`. A `..` after a wildcard cannot be resolved without matching, so such a pattern is refused.
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/** The tools whose input names a path the guard checks. */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep'])

/** The fields of a tool's input that name a file or a folder. */
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const

/** A segment of a glob pattern that matches rather than names. */
const WILDCARD = /[*?[\]{}!()]/

/**
 * A path the guard cannot be sure to read as Claude Code does, so it refuses it rather than guess:
 * - whitespace at either end: Claude Code trims a Grep or Glob `path` before it runs the tool, while the
 *   guard would join ` ~/.ssh` with its space to the cwd and find it inside (verdict of PR #1907, round 1);
 * - a control character (a NUL, a line break): no real file name the model needs has one;
 * - `~name`: whether it means another user's home or a folder named `~name` depends on the tool.
 * `~` alone and `~/…` are the home folder, as Claude Code expands them. Unicode forms (NFC and NFD of
 * one name) need no rule: realpath gives the file system's own spelling.
 */
const unclear = (target: string): boolean => /^\s|\s$/u.test(target) || /\p{Cc}/u.test(target) || /^~[^\\/]/.test(target)

export interface ReadScopeEnv {
  platform?: NodeJS.Platform | undefined
  /** The file system's name of an existing path; throws for a missing one. */
  realpath?: ((path: string) => string) | undefined
  home?: string | undefined
}

export interface ReadScope {
  /** The folders a read may reach, as the request named them: what the refusal tells the model. */
  readonly folders: readonly string[]
  /** Null when the call of `toolName` with `input` stays inside the folders; else the refusal's text. */
  check(toolName: string, input: Record<string, unknown>): string | null
}

/** The guard of a request running in `cwd` that may read `folders` besides it. */
export function readScope(cwd: string, folders: readonly string[], env: ReadScopeEnv = {}): ReadScope {
  const windows = (env.platform ?? process.platform) === 'win32'
  const path = windows ? win32 : posix
  const realpath = env.realpath ?? ((target: string) => realpathSync.native(target))
  const home = env.home ?? homedir()

  /** A path without the `\\?\` prefix of Windows, so a long path and a short one compare equal. */
  const plain = (target: string): string => {
    if (!windows) return target
    if (/^[\\/]{2}\?[\\/]UNC[\\/]/i.test(target)) return `\\\\${target.slice(8)}`
    if (/^[\\/]{2}\?[\\/]/.test(target)) return target.slice(4)
    return target
  }
  /**
   * `target` as Claude Code expands it before the tool runs (its expandPath): `~` is the home folder, on
   * Windows `/c/…` is `C:\…`, and the rest is resolved against `base` with `..` collapsed as text. Null when
   * the guard cannot be sure of it (`unclear`, a drive-relative `C:x`).
   */
  const expand = (base: string, target: string): string | null => {
    if (unclear(target)) return null
    let raw = plain(target)
    if (raw === '~' || raw.startsWith('~/') || (windows && raw.startsWith('~\\'))) raw = home + raw.slice(1)
    if (windows) {
      const drive = /^\/([a-zA-Z])(?=\/|$)/.exec(raw)
      if (drive !== null) raw = `${drive[1] ?? ''}:\\${raw.slice(3)}`
      if (/^[a-zA-Z]:(?![\\/])/.test(raw)) return null
    }
    return path.resolve(base, raw)
  }

  /** Where the OS reads `lexical`, a path without `..`: the realpath of its nearest existing parent, then the rest of it. */
  const realOf = (lexical: string): string => {
    const rest: string[] = []
    let at = lexical
    for (;;) {
      try {
        return path.join(plain(realpath(at)), ...rest)
      } catch {
        const up = path.dirname(at)
        if (up === at) return lexical
        rest.unshift(path.basename(at))
        at = up
      }
    }
  }

  const key = (target: string): string => {
    const normal = path.normalize(target)
    const trimmed = normal.length > path.parse(normal).root.length ? normal.replace(/[\\/]+$/, '') : normal
    return windows ? trimmed.toLowerCase() : trimmed
  }
  const lexicalCwd = path.resolve(plain(cwd))
  // Each folder by its name and by the file system's, so /var/… and /private/var/… on a Mac both count.
  const roots = [cwd, ...folders].flatMap((folder) => {
    const lexical = path.resolve(lexicalCwd, plain(folder))
    return [key(lexical), key(realOf(lexical))]
  })
  const inside = (target: string): boolean => {
    const at = key(target)
    return roots.some((root) => at === root || at.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`))
  }
  /**
   * Whether the tool reads inside the folders: the path Claude Code hands to it (`..` collapsed as text)
   * and the place the OS then reaches (links followed) both lie inside. Checking only the second let
   * `<checkout>/<link>/../../..` through: the guard followed the link before the `..`, Claude Code did not
   * (verdict of PR #1907, round 2).
   */
  const reads = (lexical: string | null): boolean => lexical !== null && inside(lexical) && inside(realOf(lexical))

  const named = [cwd, ...folders]
  const refuse = (what: string): string => `${what} is outside the folders this request may read: ${named.join(', ')}. Read only files under them.`
  const shown = (target: string): string => (unclear(target) ? JSON.stringify(target) : target)

  return {
    folders: named,
    check(toolName, input) {
      if (!GUARDED_TOOLS.has(toolName)) return null
      for (const field of PATH_FIELDS) {
        const value = input[field]
        if (value === undefined || value === null) continue
        if (typeof value !== 'string') return refuse(`The ${field} of ${toolName}`)
        if (value === '') continue
        if (!reads(expand(lexicalCwd, value))) return refuse(shown(value))
      }
      if (toolName !== 'Glob' || typeof input.pattern !== 'string') return null
      const pattern = input.pattern
      const refused = refuse(`The pattern ${shown(pattern)}`)
      if (unclear(pattern)) return refused
      // The literal part: up to the separator before the first wildcard (with it, so `/` stays a root).
      const wildcard = pattern.search(WILDCARD)
      const cut = wildcard < 0 ? pattern.length : Math.max(pattern.lastIndexOf('/', wildcard), windows ? pattern.lastIndexOf('\\', wildcard) : -1) + 1
      const literal = pattern.slice(0, cut)
      // A `..` after a wildcard cannot be collapsed without matching.
      if (pattern.slice(cut).split(windows ? /[\\/]+/ : /\/+/).includes('..')) return refused
      const base = typeof input.path === 'string' && input.path !== '' ? expand(lexicalCwd, input.path) : lexicalCwd
      if (base === null) return refused
      // A relative pattern that starts with a wildcard looks under its base, which the path check allowed.
      if (literal === '') return null
      return reads(expand(base, literal)) ? null : refused
    },
  }
}
