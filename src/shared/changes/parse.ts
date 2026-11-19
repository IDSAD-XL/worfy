// The pure reading of git's output for the Changes screen (worfy-changes-view ticket 02; ADR-0110): the list of
// changed files (`diff --raw --numstat -z`), the patch of a file (hunks, lines with the numbers of both sides,
// renames, binary files, mode changes, «\ No newline at end of file», CRLF), the commits (`log -z`) and the
// `linguist-generated` attribute (`check-attr -z`); and the rules that fold a file's patch. No git runs here:
// main runs it (src/main/changes/git.ts) and hands the output over.
//
// Names come with `-z` and `core.quotePath=false`, so a path with spaces or letters outside ASCII is printed as it
// is. A patch header still quotes a name with a control character, a `"` or a `\` in it (C style), and git ends a
// `---`/`+++` name that has a space with a TAB; unquotePath and patchPath read both.
import type { ChangeStatus, ChangesCommit, DiffHunk, DiffLine, FoldReason } from './types'

/** A patch longer than this many lines (added and deleted) comes folded: «Large diff · N lines · Show». */
export const FOLD_LINES = 2_000
/** A patch bigger than this many bytes comes folded the same way. */
export const FOLD_BYTES = 1024 * 1024

/**
 * The lock files of the package managers, by file name: folded like a large patch, whatever their size. A list
 * in code: the ones a reviewer never reads line by line.
 */
export const LOCK_FILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'pdm.lock',
  'uv.lock',
  'go.sum',
  'flake.lock',
  'Podfile.lock',
  'Package.resolved',
  'pubspec.lock',
  'mix.lock',
  'packages.lock.json',
  'gradle.lockfile',
])

/** Whether the file at `path` is a lock file (LOCK_FILES). */
export function isLockFile(path: string): boolean {
  return LOCK_FILES.has(path.slice(path.lastIndexOf('/') + 1))
}

/**
 * Why a file's patch comes folded, or null. A binary file is never folded: it has no lines, the screen shows its
 * sizes. `bytes` is the size of the patch when it is known (main measures it as it reads).
 */
export function foldOf(file: { path: string; additions: number | null; deletions: number | null; binary: boolean; generated?: boolean; bytes?: number }): FoldReason | null {
  if (file.binary) return null
  if (isLockFile(file.path)) return 'lock'
  if (file.generated) return 'generated'
  if ((file.additions ?? 0) + (file.deletions ?? 0) > FOLD_LINES || (file.bytes ?? 0) > FOLD_BYTES) return 'large'
  return null
}

/** Whether `path` (from the repository's top folder, with `/`) lies under `prefix` (the Tickets root, `.scratch`). */
export function isWorkflowPath(path: string, prefix: string | null): boolean {
  if (prefix === null || prefix === '') return false
  const folder = prefix.replace(/\/+$/u, '')
  return path === folder || path.startsWith(`${folder}/`)
}

/** The `process.platform` of main, or '' where there is no `process` (the renderer): this file is shared with it. */
const hostPlatform = (): string => (globalThis as { process?: { platform?: string } }).process?.platform ?? ''

/**
 * Whether `path` can be a path from the top folder of a repository on `platform` (a `process.platform`):
 * not empty, no NUL, not absolute, no `..` part. Everywhere `/x` is absolute and `/` separates the parts. Only on
 * Windows `\x` and `C:x` are absolute and `\` separates the parts too: on macOS and Linux `c:notes.md` and
 * `back\..\slash.txt` are file names a repository may hold. A path the screen asks for must be one; git never prints
 * another. The channel's schema checks it in main, on the Machine whose repository it is.
 */
export function isRepoPath(path: string, platform: string = hostPlatform()): boolean {
  if (path === '' || path.includes('\0') || path.startsWith('/')) return false
  const windows = platform === 'win32'
  if (windows && (path.startsWith('\\') || /^[A-Za-z]:/u.test(path))) return false
  return !path.split(windows ? /[\\/]/u : /\//u).includes('..')
}

/** The fields of `-z` output: split on NUL, without the empty field after the last NUL. */
export function splitZ(output: string): string[] {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  return fields
}

const ENCODER = new TextEncoder()
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/**
 * A name as git prints it in a patch header: in `"…"` with C escapes (`\t`, `\"`, `\\`, `\303\274` — the bytes of
 * UTF-8 in octal) when it has to be quoted, else as it is.
 */
export function unquotePath(text: string): string {
  if (!(text.length >= 2 && text.startsWith('"') && text.endsWith('"'))) return text
  const bytes: number[] = []
  const body = text.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const char = String.fromCodePoint(body.codePointAt(i)!)
    if (char !== '\\') {
      bytes.push(...ENCODER.encode(char))
      i += char.length - 1
      continue
    }
    const next = body[i + 1] ?? ''
    const octal = /^[0-7]{3}/u.exec(body.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next]!)
      i += 1
    } else {
      bytes.push(92)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** A name of a `---`/`+++` line or of `rename from`/`to`: without git's closing TAB, unquoted, without `a/` or `b/`. */
function patchPath(text: string, prefix: 'a/' | 'b/' | null): string | null {
  const name = unquotePath(text.endsWith('\t') ? text.slice(0, -1) : text)
  if (name === '/dev/null') return null
  return prefix !== null && name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/** One file of `diff --raw --numstat -z`, before main adds what git's list does not say. */
export interface ListedFile {
  path: string
  oldPath: string | null
  status: ChangeStatus
  additions: number | null
  deletions: number | null
  binary: boolean
  oldMode: string | null
  newMode: string | null
  oldBlob: string | null
  newBlob: string | null
}

/** One entry of `--numstat -z`: the counts, null for a binary file, and the paths (two for a rename). */
export interface NumstatEntry {
  path: string
  oldPath: string | null
  additions: number | null
  deletions: number | null
}

const ZERO = /^0+$/u
const NO_MODE = '000000'

function statusOf(letter: string): ChangeStatus {
  switch (letter) {
    case 'A':
    case 'C':
      return 'A'
    case 'D':
      return 'D'
    case 'R':
      return 'R'
    case 'T':
      return 'T'
    default:
      return 'M'
  }
}

/** The fields of a numstat count: a number, or `-` for a binary file. */
const count = (text: string | undefined): number | null => (text === undefined || text === '-' ? null : Number(text))

/**
 * The numstat entries of `--numstat -z` output alone (as `diff --no-index` gives it, too): `a\td\tpath`, or
 * `a\td\t` followed by the old and the new path of a rename.
 */
export function parseNumstat(output: string): NumstatEntry[] {
  return readList(splitZ(output)).numstat
}

function readList(fields: string[]): { raw: Omit<ListedFile, 'additions' | 'deletions' | 'binary'>[]; numstat: NumstatEntry[] } {
  const raw: Omit<ListedFile, 'additions' | 'deletions' | 'binary'>[] = []
  const numstat: NumstatEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.startsWith(':')) {
      // `:<old mode> <new mode> <old blob> <new blob> <status>[score]`, then the path, or two for a rename or copy.
      const [oldMode = NO_MODE, newMode = NO_MODE, oldBlob = '', newBlob = '', state = 'M'] = field.slice(1).split(' ')
      const letter = state.charAt(0)
      const two = letter === 'R' || letter === 'C'
      const first = fields[++i] ?? ''
      const second = two ? (fields[++i] ?? '') : null
      raw.push({
        path: second ?? first,
        oldPath: letter === 'R' ? first : null,
        status: statusOf(letter),
        oldMode: oldMode === NO_MODE ? null : oldMode,
        newMode: newMode === NO_MODE ? null : newMode,
        oldBlob: ZERO.test(oldBlob) || oldMode === NO_MODE ? null : oldBlob,
        newBlob: ZERO.test(newBlob) || newMode === NO_MODE ? null : newBlob,
      })
      continue
    }
    const tab = field.split('\t')
    if (tab.length < 3) continue
    const [added, deleted] = tab
    const name = tab.slice(2).join('\t')
    if (name === '') {
      const oldPath = fields[++i] ?? ''
      const path = fields[++i] ?? ''
      numstat.push({ path, oldPath, additions: count(added), deletions: count(deleted) })
    } else {
      numstat.push({ path: name, oldPath: null, additions: count(added), deletions: count(deleted) })
    }
  }
  return { raw, numstat }
}

/**
 * The files of `diff --raw --numstat -z -M --no-abbrev` (or `show` with the same options). The numstat entries are
 * the list: with `diff.autoRefreshIndex=false` (ADR-0110) the raw part also names files whose stat changed but whose
 * text did not, and numstat leaves them out. The raw part adds the status, the modes and the blob ids.
 */
export function parseDiffList(output: string): ListedFile[] {
  const { raw, numstat } = readList(splitZ(output))
  const byPath = new Map(raw.map((entry) => [entry.path, entry]))
  return numstat.map((entry): ListedFile => {
    const facts = byPath.get(entry.path)
    const binary = entry.additions === null && entry.deletions === null
    return {
      path: entry.path,
      oldPath: facts?.oldPath ?? entry.oldPath,
      status: facts?.status ?? (entry.oldPath !== null ? 'R' : 'M'),
      additions: entry.additions,
      deletions: entry.deletions,
      binary,
      oldMode: facts?.oldMode ?? null,
      newMode: facts?.newMode ?? null,
      oldBlob: facts?.oldBlob ?? null,
      newBlob: facts?.newBlob ?? null,
    }
  })
}

/** One file of a patch, as parsePatch reads it. */
export interface FilePatch {
  /** The old and the new path; null on the side the file is not on (`/dev/null`). */
  oldPath: string | null
  newPath: string | null
  oldMode: string | null
  newMode: string | null
  /** Renamed: `rename from` and `rename to` in the header. */
  renamed: boolean
  binary: boolean
  hunks: DiffHunk[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/u

/** The two names of a `diff --git a/x b/y` line, when they can be told apart: only a fallback for a header with no `---`/`+++`. */
function headerPaths(rest: string): { oldPath: string | null; newPath: string | null } {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/u.exec(rest)
  if (quoted && (quoted[1]!.startsWith('"') || quoted[2]!.startsWith('"'))) {
    return { oldPath: patchPath(quoted[1]!, 'a/'), newPath: patchPath(quoted[2]!, 'b/') }
  }
  // `a/<name> b/<name>`: the same name twice, so the middle is found even when the name has spaces.
  if (rest.startsWith('a/') && rest.length % 2 === 1) {
    const half = (rest.length - 1) / 2
    const left = rest.slice(0, half)
    const right = rest.slice(half + 1)
    if (rest.charAt(half) === ' ' && right.startsWith('b/') && left.slice(2) === right.slice(2)) return { oldPath: left.slice(2), newPath: right.slice(2) }
  }
  return { oldPath: null, newPath: null }
}

/**
 * The files of a patch (`git diff`, `git show`, `git diff --no-index`), each with its hunks. A hunk ends when its
 * counts of lines run out, so a deleted line that reads `--- x` is a line, not a header. The text of a CRLF line
 * comes without its `\r` and with `crlf`; «\ No newline at end of file» marks the line before it.
 */
export function parsePatch(text: string): FilePatch[] {
  const files: FilePatch[] = []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  let file: FilePatch | null = null
  let hunk: DiffHunk | null = null
  let oldLeft = 0
  let newLeft = 0
  let oldNo = 0
  let newNo = 0
  let last: DiffLine | null = null
  for (const line of lines) {
    if (hunk && file && (oldLeft > 0 || newLeft > 0 || line.startsWith('\\'))) {
      const mark = line.charAt(0)
      if (mark === '\\') {
        if (last) last.noNewline = true
        continue
      }
      const body = line.slice(1)
      const crlf = body.endsWith('\r')
      const textOf = crlf ? body.slice(0, -1) : body
      let entry: DiffLine
      if (mark === '+') {
        entry = { kind: 'add', text: textOf, oldLine: null, newLine: newNo++, crlf, noNewline: false }
        newLeft--
      } else if (mark === '-') {
        entry = { kind: 'del', text: textOf, oldLine: oldNo++, newLine: null, crlf, noNewline: false }
        oldLeft--
      } else {
        entry = { kind: 'context', text: textOf, oldLine: oldNo++, newLine: newNo++, crlf, noNewline: false }
        oldLeft--
        newLeft--
      }
      hunk.lines.push(entry)
      last = entry
      continue
    }
    if (line.startsWith('diff --git ')) {
      file = { ...headerPaths(line.slice('diff --git '.length)), oldMode: null, newMode: null, renamed: false, binary: false, hunks: [] }
      files.push(file)
      hunk = null
      last = null
      continue
    }
    if (!file) continue
    const header = HUNK.exec(line)
    if (header) {
      const [, a, b, c, d, section] = header
      hunk = {
        header: line,
        oldStart: Number(a),
        oldLines: b === undefined ? 1 : Number(b),
        newStart: Number(c),
        newLines: d === undefined ? 1 : Number(d),
        section: section ?? '',
        lines: [],
      }
      file.hunks.push(hunk)
      oldLeft = hunk.oldLines
      newLeft = hunk.newLines
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      last = null
      continue
    }
    if (line.startsWith('old mode ')) file.oldMode = line.slice('old mode '.length)
    else if (line.startsWith('new mode ')) file.newMode = line.slice('new mode '.length)
    else if (line.startsWith('deleted file mode ')) {
      file.oldMode = line.slice('deleted file mode '.length)
      file.newPath = null
    } else if (line.startsWith('new file mode ')) {
      file.newMode = line.slice('new file mode '.length)
      file.oldPath = null
    } else if (line.startsWith('rename from ')) {
      file.renamed = true
      file.oldPath = patchPath(line.slice('rename from '.length), null)
    } else if (line.startsWith('rename to ')) {
      file.renamed = true
      file.newPath = patchPath(line.slice('rename to '.length), null)
    } else if (line.startsWith('index ')) {
      // `index <old>..<new> <mode>`: git names a mode here only when both sides have the file, with that mode.
      const mode = line.split(' ')[2]
      if (mode !== undefined) {
        file.oldMode ??= mode
        file.newMode ??= mode
      }
    } else if (line.startsWith('--- ')) {
      const path = patchPath(line.slice(4), 'a/')
      if (!file.renamed) file.oldPath = path
    } else if (line.startsWith('+++ ')) {
      const path = patchPath(line.slice(4), 'b/')
      if (!file.renamed) file.newPath = path
    } else if (line === 'GIT binary patch' || (line.startsWith('Binary files ') && line.endsWith(' differ'))) {
      file.binary = true
    }
  }
  return files
}

/**
 * The patch of the file at `path` among `patches`: the one that ends at it, or the one that deletes it. A type change
 * (a file became a link or back, status T) comes from git as two patches of one path — the old side deleted, then the
 * new side added; they are joined into one: the deletion's hunks, then the addition's, with the old mode of the one
 * and the new mode of the other. Undefined when no patch is the file's.
 */
export function patchOfPath(patches: readonly FilePatch[], path: string): FilePatch | undefined {
  const own = patches.filter((each) => each.newPath === path || (each.newPath === null && each.oldPath === path))
  if (own.length < 2) return own[0]
  const deletion = own.find((each) => each.newPath === null)
  const addition = own.find((each) => each.oldPath === null && each.newPath === path)
  return {
    oldPath: deletion?.oldPath ?? own[0]!.oldPath,
    newPath: path,
    oldMode: deletion?.oldMode ?? own[0]!.oldMode,
    newMode: addition?.newMode ?? own.at(-1)!.newMode,
    renamed: false,
    binary: own.some((each) => each.binary),
    hunks: own.flatMap((each) => each.hunks),
  }
}

/** The `log` format parseCommits reads: the fields by the unit separator, the commits by NUL (`-z`). */
export const COMMIT_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s'

/** The commits of `git log -z` with COMMIT_FORMAT, newest first as git gives them. */
export function parseCommits(output: string): ChangesCommit[] {
  return splitZ(output).flatMap((record): ChangesCommit[] => {
    const [sha, short, author, date, ...subject] = record.replace(/^\n+/u, '').split('\x1f')
    if (!sha || !short || author === undefined || date === undefined) return []
    return [{ sha, short, author, date, subject: subject.join('\x1f') }]
  })
}

/** The paths `git check-attr -z linguist-generated` names as generated: the value `set` or `true`. */
export function parseGenerated(output: string): Set<string> {
  const fields = splitZ(output)
  const generated = new Set<string>()
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const value = fields[i + 2]
    if (value === 'set' || value === 'true') generated.add(fields[i]!)
  }
  return generated
}
