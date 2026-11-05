// Where a path of an approval request lies (worfy-auto-approve ticket 03; the Epic spec, how it works,
// item 3, and security, items 2–3 and 5–6). `resolveTarget` puts one target of a command or a file
// tool into a Placement: inside an allowed root, the root itself, outside every root, behind a symbolic
// link, or in a hard-deny area. The policy (policy.ts) decides from it.
//
// The allowed roots are the Run's: the worktrees of the Wave's Tickets, the Project's .scratch, the
// Run's folder for temporary files (the Session's TMPDIR) and the Session's scratchpad. The hard-deny
// areas are the folders no mode and no rule may touch: secrets and settings of the user (~/.ssh,
// ~/.claude…), worfy's data folder outside the Run's folder, the Harness home, and the work of other
// Sessions (the folder of a live Session, a worktree outside the Run).
//
// A path is made absolute and walked component by component; each component that exists is looked up
// on the file system (through FileSystem, so tests give their own), and `.` / `..` are folded against
// the real path found so far, as the system does (`<root>/link/../x` is beside the link's target, not
// inside the root). A symbolic link is followed to find
// where the path really leads, and is itself a reason not to allow, wherever it leads (a link put in a
// root can be pointed elsewhere after the decision). Only the links on the configured path of a root
// are taken as given (macOS /tmp and /var). A target is judged by both its written and its real form:
// a hard-deny area in either wins. Among the areas that hold a path the longest wins, so the Run's
// folder inside worfy's data folder is a root, and a hard area and a root of the same path are hard.
//
// A glob target (`<folder>/*.log`, the last component only, as shell.ts writes it) is judged by every
// entry of the folder the pattern can match — dot files and any case too, whatever the shell's options:
// an entry that is a link, is hard or lies outside makes the target so. A glob directly in a root is the
// root itself (`rm -rf <worktree>/*` empties the root). A folder that cannot be read is outside, except
// the new folder of `X=$(mktemp -d)`, which is empty.
//
// Windows: `\` and `/` are one separator, `/c/x` (Git Bash) is `C:\x`, and case is ignored. Hard areas
// ignore case on macOS too (its disks usually do); roots compare it exactly there, as a path that
// differs in case only from a root may be another folder.
import fs from 'node:fs'
import { isNewTempFolder } from './shell'

/** The kinds of allowed roots. */
export type RootKind = 'worktree' | 'scratch' | 'run-temp' | 'scratchpad'

export interface Root {
  kind: RootKind
  /** The path as configured, normalized. */
  path: string
}

/** Why an area is hard-denied. */
export type HardCategory =
  | 'claude-home'
  | 'codex-home'
  | 'ssh'
  | 'gnupg'
  | 'gh-config'
  | 'git-config'
  | 'npmrc'
  | 'shell-rc'
  | 'library'
  | 'appdata'
  | 'worfy-data'
  | 'harness-home'
  | 'other-session'
  | 'other-worktree'

export interface HardArea {
  category: HardCategory
  /** The path as configured, normalized. */
  path: string
  /** Whether reading is hard-denied too (secrets); else a read there is only outside. */
  reads: boolean
}

export type Placement =
  | { kind: 'inside'; root: Root }
  | { kind: 'is-root'; root: Root }
  | { kind: 'outside' }
  | { kind: 'symlink-on-path'; link: string }
  | { kind: 'hard'; category: HardCategory }

/** How the target is used: a delete of a folder that holds a hard area is hard too. */
export type TargetUse = 'read' | 'write' | 'delete'

/** What resolveTarget asks of the file system; every call answers, none throws. */
export interface FileSystem {
  /** What is at `path` without following a link there; null when nothing is; 'error' when it cannot be told. */
  lstat(path: string): 'file' | 'dir' | 'link' | 'error' | null
  /** Where `path` really leads, every link followed; null when it cannot be resolved. */
  realpath(path: string): string | null
  /** The names in the folder `path`; null when it cannot be read. */
  readdir(path: string): string[] | null
}

const errorCode = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

/** The file system of this machine. */
export const nodeFileSystem: FileSystem = {
  lstat(path) {
    try {
      const stat = fs.lstatSync(path, { throwIfNoEntry: false })
      if (stat === undefined) return null
      if (stat.isSymbolicLink()) return 'link'
      return stat.isDirectory() ? 'dir' : 'file'
    } catch (error) {
      return errorCode(error) === 'ENOTDIR' || errorCode(error) === 'ENOENT' ? null : 'error'
    }
  },
  realpath(path) {
    try {
      return fs.realpathSync.native(path)
    } catch {
      return null
    }
  },
  readdir(path) {
    try {
      return fs.readdirSync(path)
    } catch {
      return null
    }
  },
}

/** Where the roots and the hard areas come from: the Run, the Session's environment and the app. */
export interface RootsInput {
  platform: NodeJS.Platform
  /** The worktrees of the Tickets of the current Wave. */
  worktrees: readonly string[]
  /** The Project's .scratch. */
  scratch: string | null
  /** The Run's folder for temporary files, the Session's TMPDIR. */
  runTemp: string | null
  /** The scratchpad of the Session. */
  scratchpad: string | null
  /** The user's home folder. */
  home: string | null
  /** XDG_CONFIG_HOME of the Session, when set. */
  xdgConfigHome?: string | null
  /** %APPDATA% (Windows). */
  appData?: string | null
  /** worfy's data folder (WORFY_DATA_DIR). */
  dataDir: string | null
  /** The Harness home. */
  harnessHome: string | null
  /** The folders of live Sessions other than the Run's. */
  otherSessions: readonly string[]
  /** Worktrees of the Project outside the Run (git worktree list, without the Wave's and the Run Session's own). */
  otherWorktrees: readonly string[]
  fs?: FileSystem
}

/** Allowed roots and hard areas, normalized and resolved once. */
export interface Roots {
  platform: NodeJS.Platform
  fs: FileSystem
  allowed: readonly Root[]
  hard: readonly HardArea[]
  /** @internal The real path of each root and area, in the same order; null when it does not resolve. */
  realAllowed: readonly (string | null)[]
  realHard: readonly (string | null)[]
  /** @internal Prefixes of the configured root paths (a link there is taken as given), as keys. */
  tolerated: ReadonlySet<string>
}

// Files and folders of the home folder that hold secrets or settings a command may abuse.
const HOME_AREAS: ReadonlyArray<[HardCategory, string]> = [
  ['claude-home', '.claude'],
  ['codex-home', '.codex'],
  ['ssh', '.ssh'],
  ['gnupg', '.gnupg'],
  ['gh-config', '.config/gh'],
  ['git-config', '.gitconfig'],
  ['git-config', '.git-credentials'],
  ['git-config', '.config/git'],
  ['npmrc', '.npmrc'],
  ['library', 'Library'],
  ...['.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout', '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.inputrc'].map((name): [HardCategory, string] => ['shell-rc', name]),
]

/** Hard areas where reading is fine: it is the writing that breaks other work. */
const READABLE: ReadonlySet<HardCategory> = new Set(['harness-home', 'other-session', 'other-worktree'])

export function rootsOf(input: RootsInput): Roots {
  const win = input.platform === 'win32'
  const fsys = input.fs ?? nodeFileSystem
  const allowed: Root[] = []
  const addRoot = (kind: RootKind, path: string | null | undefined): void => {
    const normal = path === null || path === undefined ? null : normalizePath(path, win)
    if (normal !== null) allowed.push({ kind, path: normal })
  }
  for (const path of input.worktrees) addRoot('worktree', path)
  addRoot('scratch', input.scratch)
  addRoot('run-temp', input.runTemp)
  addRoot('scratchpad', input.scratchpad)

  const hard: HardArea[] = []
  const addHard = (category: HardCategory, path: string | null | undefined): void => {
    const normal = path === null || path === undefined || path === '' ? null : normalizePath(path, win)
    if (normal !== null) hard.push({ category, path: normal, reads: !READABLE.has(category) })
  }
  const home = input.home === null ? null : normalizePath(input.home, win)
  if (home !== null) for (const [category, name] of HOME_AREAS) addHard(category, joinPath(home, name, win))
  const xdg = input.xdgConfigHome
  if (xdg !== null && xdg !== undefined && xdg !== '') {
    addHard('gh-config', `${xdg}/gh`)
    addHard('git-config', `${xdg}/git`)
  }
  addHard('appdata', input.appData)
  addHard('worfy-data', input.dataDir)
  addHard('harness-home', input.harnessHome)
  for (const path of input.otherSessions) addHard('other-session', path)
  for (const path of input.otherWorktrees) addHard('other-worktree', path)

  const real = (path: string): string | null => {
    const resolved = fsys.realpath(path)
    return resolved === null ? null : normalizePath(resolved, win)
  }
  const tolerated = new Set<string>()
  for (const root of allowed) for (const prefix of prefixes(root.path, win)) tolerated.add(keyOf(prefix, win))
  return { platform: input.platform, fs: fsys, allowed, hard, realAllowed: allowed.map((root) => real(root.path)), realHard: hard.map((area) => realAbove(area.path, fsys, win)), tolerated }
}

/** Where the target `path` (absolute, as shell.ts or a file tool gives it) lies among `roots`. */
export function resolveTarget(path: string, roots: Roots, use: TargetUse = 'write'): Placement {
  const win = roots.platform === 'win32'
  const raw = rawPath(path, win)
  if (raw === null) return { kind: 'outside' }
  const last = lastComponent(raw, win)
  if (/[*?]/.test(last)) return placeGlob(raw, last, roots, use)
  return place(raw, roots, use)
}

/**
 * The top of the git repository that holds the folder `cwd`: the nearest folder upward, real, with a
 * `.git` entry; null when there is none or the way up cannot be read.
 */
export function repositoryTop(cwd: string, roots: Roots): string | null {
  const win = roots.platform === 'win32'
  const raw = rawPath(cwd, win)
  if (raw === null) return null
  const walked = walk(raw, roots)
  if (walked.error) return null
  let folder = walked.real
  for (;;) {
    const found = roots.fs.lstat(joinPath(folder, '.git', win))
    if (found === 'error') return null
    if (found !== null) return folder
    const up = parentOf(folder, win)
    if (up === null) return null
    folder = up
  }
}

/**
 * The real form of `path`, which may not exist yet: the nearest existing folder above it, resolved by the
 * system, plus the missing names. The system's spelling (Windows long names instead of `RUNNER~1`) makes a
 * target and an area comparable.
 */
function realAbove(path: string, fsys: FileSystem, win: boolean): string | null {
  const missing: string[] = []
  for (let head = path; ; ) {
    const resolved = fsys.realpath(head)
    if (resolved !== null) return normalizePath(missing.reduce((at, name) => joinPath(at, name, win), resolved), win)
    const split = splitPath(head, win)
    const name = split?.parts.pop()
    if (split === null || name === undefined) return null
    missing.unshift(name)
    head = `${split.root}${split.parts.join(win ? '\\' : '/')}`
  }
}

// --- Placement ------------------------------------------------------------------------------

interface Walked {
  /** The real path: every link on the way followed; components that do not exist kept as written. */
  real: string
  /** Links on the way that are not on a root's configured path. */
  links: string[]
  error: boolean
}

/**
 * `path` (raw: `.` and `..` still in it) followed component by component. A `..` goes up from where
 * the path really is so far, as the system does: lexically `<root>/link/../x` would be inside the root,
 * while the system opens `x` beside the link's target.
 */
function walk(path: string, roots: Roots): Walked {
  const win = roots.platform === 'win32'
  const parts = componentsOf(path, win)
  let real = rootOf(path, win)
  const links: string[] = []
  let missing = false
  let lexical = real
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      lexical = parentOf(lexical, win) ?? lexical
      real = parentOf(real, win) ?? real
      continue
    }
    lexical = joinPath(lexical, part, win)
    const candidate = joinPath(real, part, win)
    if (missing) {
      real = candidate
      continue
    }
    const kind = roots.fs.lstat(candidate)
    if (kind === 'error') return { real: candidate, links, error: true }
    if (kind === null) {
      missing = true
      real = candidate
      continue
    }
    if (kind !== 'link') {
      real = candidate
      continue
    }
    // A link on the configured path of a root is the machine's own (macOS /tmp, /var); only one
    // reached by the path as written, before any other link, may be taken as such.
    if (!(links.length === 0 && candidate === lexical && roots.tolerated.has(keyOf(candidate, win)))) links.push(candidate)
    const resolved = roots.fs.realpath(candidate)
    const normal = resolved === null ? null : normalizePath(resolved, win)
    if (normal === null) return { real: candidate, links, error: true }
    real = normal
  }
  // Every link is followed already; this only brings the spelling to the system's own.
  return { real: realAbove(real, roots.fs, win) ?? real, links, error: false }
}

type Match = { kind: 'root'; root: Root; exact: boolean } | { kind: 'hard'; area: HardArea } | null

/** The area that holds `path` (a key form is made here): the longest; a hard one on a tie. */
function matchOf(path: string, roots: Roots, use: TargetUse): Match {
  const win = roots.platform === 'win32'
  const caseless = win || roots.platform === 'darwin'
  const found: { best: Match; length: number } = { best: null, length: -1 }
  const consider = (area: string, ci: boolean, match: Exclude<Match, null>): void => {
    if (!within(path, area, ci, win)) return
    if (area.length > found.length || (area.length === found.length && match.kind === 'hard')) {
      found.best = match
      found.length = area.length
    }
  }
  roots.allowed.forEach((root, n) => {
    for (const area of [root.path, roots.realAllowed[n] ?? null]) {
      if (area !== null) consider(area, win, { kind: 'root', root, exact: same(path, area, win) })
    }
  })
  roots.hard.forEach((area, n) => {
    if (use === 'read' && !area.reads) return
    for (const each of [area.path, roots.realHard[n] ?? null]) {
      if (each !== null) consider(each, caseless, { kind: 'hard', area })
    }
  })
  return found.best
}

/** A hard area inside the folder `path`, which a delete of `path` would remove with it. */
function hardBelow(path: string, roots: Roots): HardArea | undefined {
  const win = roots.platform === 'win32'
  const caseless = win || roots.platform === 'darwin'
  return roots.hard.find((area, n) => [area.path, roots.realHard[n] ?? null].some((each) => each !== null && within(each, path, caseless, win)))
}

/** An allowed root strictly inside the folder `path`. */
function rootBelow(path: string, roots: Roots): Root | undefined {
  const win = roots.platform === 'win32'
  return roots.allowed.find((root, n) => [root.path, roots.realAllowed[n] ?? null].some((each) => each !== null && !same(each, path, win) && within(each, path, win, win)))
}

function place(path: string, roots: Roots, use: TargetUse): Placement {
  const walked = walk(path, roots)
  const lexical = normalizePath(path, roots.platform === 'win32') ?? path
  for (const form of [lexical, walked.real]) {
    const match = matchOf(form, roots, use)
    if (match?.kind === 'hard') return { kind: 'hard', category: match.area.category }
    if (use === 'delete') {
      const below = hardBelow(form, roots)
      if (below !== undefined) return { kind: 'hard', category: below.category }
    }
  }
  const link = walked.links[0]
  if (link !== undefined) return { kind: 'symlink-on-path', link }
  if (walked.error) return { kind: 'outside' }
  if (use === 'delete') {
    // A delete of a folder that holds a root takes the root with it.
    const below = rootBelow(walked.real, roots)
    if (below !== undefined) return { kind: 'is-root', root: below }
  }
  const match = matchOf(walked.real, roots, use)
  if (match?.kind !== 'root') return { kind: 'outside' }
  return match.exact ? { kind: 'is-root', root: match.root } : { kind: 'inside', root: match.root }
}

/** The most entries of a folder a glob target is judged by; a bigger folder is outside. */
const MAX_GLOB_ENTRIES = 10_000

const SEVERITY: Record<Placement['kind'], number> = { hard: 4, 'symlink-on-path': 3, outside: 2, 'is-root': 1, inside: 0 }

function worst(a: Placement, b: Placement): Placement {
  return SEVERITY[b.kind] > SEVERITY[a.kind] ? b : a
}

function placeGlob(path: string, pattern: string, roots: Roots, use: TargetUse): Placement {
  const win = roots.platform === 'win32'
  const folderPath = parentOf(path, win)
  if (folderPath === null) return { kind: 'outside' }
  // The folder itself is read, not deleted: what goes is what the pattern matches.
  const folder = place(folderPath, roots, use === 'delete' ? 'write' : use)
  if (folder.kind === 'hard') return folder
  const walked = walk(folderPath, roots)
  const kind = walked.error ? 'error' : roots.fs.lstat(walked.real)
  if (kind === null && isNewTempFolder(lastComponent(folderPath, win))) {
    // The folder of `X=$(mktemp -d)`, made by this very command: empty.
    return folder
  }
  const listed = kind === 'dir' ? roots.fs.readdir(walked.real) : null
  // A folder that cannot be read, or too big to look through: what the pattern matches is not known.
  const names = listed !== null && listed.length <= MAX_GLOB_ENTRIES ? listed : null
  let result: Placement = worst(folder, names === null ? { kind: 'outside' } : folder)
  const matcher = globMatcher(pattern)
  for (const name of names ?? []) {
    if (!matcher.test(name)) continue
    const entry = joinPath(walked.real, name, win)
    const entryKind = roots.fs.lstat(entry)
    const placed: Placement = entryKind === 'link' ? worst({ kind: 'symlink-on-path', link: entry }, place(entry, roots, use)) : place(entry, roots, use)
    result = worst(result, placed)
  }
  // A glob directly in a root stays the root: an entry inside it is no worse than the folder.
  return result
}

/** Matches every name the pattern may match under any shell option: dot files too, any case. */
function globMatcher(pattern: string): RegExp {
  const source = [...pattern].map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${source}$`, 'isu')
}

// --- Paths ----------------------------------------------------------------------------------

/**
 * `path` absolute and normalized — `.` and `..` folded, one separator — or null when it is not
 * absolute. Windows: `C:\x` from `C:\x`, `c:/x` or `/c/x`; a UNC path is null.
 */
export function normalizePath(path: string, win: boolean): string | null {
  const split = splitPath(path, win)
  return split === null ? null : `${split.root}${fold(split.parts).join(win ? '\\' : '/')}`
}

/** `path` absolute in the same form as normalizePath, with `.` and `..` kept; null when it is not absolute. */
function rawPath(path: string, win: boolean): string | null {
  const split = splitPath(path, win)
  return split === null ? null : `${split.root}${split.parts.join(win ? '\\' : '/')}`
}

function splitPath(path: string, win: boolean): { root: string; parts: string[] } | null {
  if (win) {
    let text = path.replaceAll('/', '\\')
    if (text.startsWith('\\\\')) return null
    const msys = /^\\([A-Za-z])(\\.*)?$/s.exec(text)
    if (msys !== null) text = `${msys[1] ?? ''}:${msys[2] ?? '\\'}`
    const drive = /^([A-Za-z]):(\\.*)$/s.exec(text)
    if (drive === null) return null
    return { root: `${(drive[1] ?? '').toUpperCase()}:\\`, parts: (drive[2] ?? '').split('\\').filter((part) => part !== '') }
  }
  if (!path.startsWith('/')) return null
  return { root: '/', parts: path.split('/').filter((part) => part !== '') }
}

function fold(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

/** `name` (relative, `/` or `\`) under the normalized folder `folder`, normalized. */
export function joinPath(folder: string, name: string, win: boolean): string {
  const sep = win ? '\\' : '/'
  const joined = `${folder}${folder.endsWith(sep) ? '' : sep}${win ? name.replaceAll('/', '\\') : name}`
  return normalizePath(joined, win) ?? joined
}

function rootOf(path: string, win: boolean): string {
  return win ? path.slice(0, 3) : '/'
}

function componentsOf(path: string, win: boolean): string[] {
  return path.slice(rootOf(path, win).length).split(win ? '\\' : '/').filter((part) => part !== '')
}

function lastComponent(path: string, win: boolean): string {
  return componentsOf(path, win).at(-1) ?? ''
}

function parentOf(path: string, win: boolean): string | null {
  const parts = componentsOf(path, win)
  if (parts.length === 0) return null
  const root = rootOf(path, win)
  return parts.length === 1 ? root : `${root}${parts.slice(0, -1).join(win ? '\\' : '/')}`
}

/** Every folder from the top down to `path` itself. */
function prefixes(path: string, win: boolean): string[] {
  const out: string[] = []
  let current = rootOf(path, win)
  for (const part of componentsOf(path, win)) {
    current = joinPath(current, part, win)
    out.push(current)
  }
  return out
}

function keyOf(path: string, ci: boolean): string {
  return ci ? path.toLowerCase() : path
}

function same(a: string, b: string, ci: boolean): boolean {
  return keyOf(a, ci) === keyOf(b, ci)
}

/** Whether `path` is `area` or lies below it. */
function within(path: string, area: string, ci: boolean, win: boolean): boolean {
  const p = keyOf(path, ci)
  const a = keyOf(area, ci)
  if (p === a) return true
  const sep = win ? '\\' : '/'
  return p.startsWith(a.endsWith(sep) ? a : `${a}${sep}`)
}
