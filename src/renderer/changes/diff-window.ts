// The window of the Changes screen's diff (worfy-changes-view ticket 03): which blocks of the diff — a file's header,
// a hunk, a note in place of a patch — are in the DOM. Only the blocks on screen and two screens above and below it
// are drawn; the others stand as one empty space of their height above and one below, so the scroll bar is right and
// a file of 2 000 lines or a Ticket of 300 files draws no more than a few screens. A block not drawn yet has the
// height its rows give (LINE_HEIGHT each); once drawn its measured height counts, since Wrap and the notes make it
// taller. No library: the screen draws its own rows, without syntax colours (spec, Q5).
//
// Also the pure pieces of the screen that tests read: the rows of Side by side and the words of a size and a count.
import type { ChangedFile, ChangesScope, DiffHunk, DiffLine } from '../../shared/changes/types'

/** The height of one line of code without Wrap, in px; changes.css draws it so. */
export const LINE_HEIGHT = 20
/** The `@@ … @@` row of a hunk. */
export const HUNK_HEADER_HEIGHT = 22
/** The header of a file: its status, path and counts. */
export const FILE_HEADER_HEIGHT = 34
/** A note in place of a patch: loading, «Large diff · N lines · Show», «Binary file · 12 KB → 14 KB». */
export const NOTE_HEIGHT = 44
/** The space under each file. */
export const FILE_GAP = 12
/** How many screens above and below the visible part are drawn. */
export const SCREENS_AROUND = 2

export type DiffLayout = 'inline' | 'side-by-side'

/** One row of Side by side: the old side's line on the left, the new side's on the right; null where a side has none. */
export interface SideBySideRow {
  old: DiffLine | null
  new: DiffLine | null
}

/**
 * The rows of Side by side: a context line on both sides; a run of deleted lines beside the run of added lines that
 * follows it, line by line, the longer run going on with an empty other side.
 */
export function sideBySideRows(lines: readonly DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]!
    if (line.kind === 'context') {
      rows.push({ old: line, new: line })
      at += 1
      continue
    }
    const deleted: DiffLine[] = []
    const added: DiffLine[] = []
    while (at < lines.length && lines[at]!.kind === 'del') deleted.push(lines[at++]!)
    while (at < lines.length && lines[at]!.kind === 'add') added.push(lines[at++]!)
    for (let row = 0; row < Math.max(deleted.length, added.length); row += 1) rows.push({ old: deleted[row] ?? null, new: added[row] ?? null })
  }
  return rows
}

/** The height of a hunk by its rows, before it is measured. */
export function hunkHeight(hunk: DiffHunk, layout: DiffLayout): number {
  const rows = layout === 'inline' ? hunk.lines.length : sideBySideRows(hunk.lines).length
  return HUNK_HEADER_HEIGHT + rows * LINE_HEIGHT
}

/** The height of a file's patch before it is read: its lines added and deleted, and some context. */
export function unreadHeight(file: Pick<ChangedFile, 'additions' | 'deletions' | 'binary' | 'fold'>): number {
  if (file.binary || file.fold !== null) return NOTE_HEIGHT
  const lines = (file.additions ?? 0) + (file.deletions ?? 0)
  return HUNK_HEADER_HEIGHT + Math.max(1, lines + 6) * LINE_HEIGHT
}

export interface DiffWindow {
  /** The first block drawn. */
  start: number
  /** One after the last block drawn. */
  end: number
  /** The height of the blocks above `start`. */
  before: number
  /** The height of the blocks from `end` on. */
  after: number
}

/**
 * The blocks to draw out of blocks of `heights`, for a scroll position `top` and a visible height `viewport`: every
 * block that reaches into the visible part or `screens` screens above or below it.
 */
export function windowOf(heights: readonly number[], top: number, viewport: number, screens = SCREENS_AROUND): DiffWindow {
  const from = top - screens * viewport
  const to = top + viewport + screens * viewport
  let start = heights.length
  let end = heights.length
  let offset = 0
  let before = 0
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!
    if (start === heights.length && offset + height > from) {
      start = index
      before = offset
    }
    if (offset >= to && start !== heights.length) {
      end = index
      break
    }
    offset += height
  }
  if (start === heights.length) before = offset
  const total = heights.reduce((sum, height) => sum + height, 0)
  let drawn = 0
  for (let index = start; index < end; index += 1) drawn += heights[index]!
  return { start, end, before, after: Math.max(0, total - before - drawn) }
}

/** Where each block starts: the sum of the heights before it. */
export function offsetsOf(heights: readonly number[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const height of heights) {
    offsets.push(offset)
    offset += height
  }
  return offsets
}

/** A count as the screen shows it: digits alone, no separator of thousands («1243», not «1 243»). */
export const count = (value: number): string => String(value)

/** A size of a binary side: «812 B», «12 KB», «3.4 MB»; «none» for the side the file is not on. */
export function sizeLabel(bytes: number | null): string {
  if (bytes === null) return 'none'
  if (bytes < 1024) return `${count(bytes)} B`
  if (bytes < 1024 * 1024) return `${count(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── the files of the tree ────────────────────────────────────────────────

/** Over this many files the folders of the tree come folded (spec, the size limits). */
export const MANY_FILES = 300

/** The files of one repository, as `changes.list` gives them. */
export interface RepoFiles {
  repo: string
  files: readonly ChangedFile[]
  error: string | null
}

/** One file of the screen: its repository and itself. */
export interface FileEntry {
  key: string
  repo: string
  file: ChangedFile
}

export const fileKey = (repo: string, path: string): string => `${repo}\u0000${path}`

const folderOf = (path: string): string => {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}
export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Whether a file is left by the filter: its path, or its old path, holds the text, in any case. */
export function matches(file: Pick<ChangedFile, 'path' | 'oldPath'>, filter: string): boolean {
  const text = filter.trim().toLowerCase()
  return text === '' || file.path.toLowerCase().includes(text) || (file.oldPath?.toLowerCase().includes(text) ?? false)
}

export interface Folder {
  key: string
  path: string
  files: FileEntry[]
}

export interface RepoTree {
  repo: string
  error: string | null
  folders: Folder[]
}

/** The tree: per repository its folders, in the order their first file comes, and the workflow files of all of them. */
export function treeOf(repos: readonly RepoFiles[], filter: string): { repos: RepoTree[]; workflow: FileEntry[] } {
  const workflow: FileEntry[] = []
  const trees = repos.map(({ repo, files, error }) => {
    const folders = new Map<string, Folder>()
    for (const file of files) {
      if (!matches(file, filter)) continue
      const entry = { key: fileKey(repo, file.path), repo, file }
      if (file.workflow) {
        workflow.push(entry)
        continue
      }
      const path = folderOf(file.path)
      const key = `${repo}\u0000${path}`
      const folder = folders.get(key) ?? { key, path, files: [] }
      folder.files.push(entry)
      folders.set(key, folder)
    }
    return { repo, error, folders: [...folders.values()] }
  })
  return { repos: trees, workflow }
}

/** The files the diff shows, in the order of the tree: the filter's, and the workflow files only while their group is open. */
export function orderedFiles(repos: readonly RepoFiles[], filter: string, workflowOpen: boolean): FileEntry[] {
  const tree = treeOf(repos, filter)
  const files = tree.repos.flatMap((repo) => repo.folders.flatMap((folder) => folder.files))
  return workflowOpen || filter.trim() !== '' ? [...files, ...tree.workflow] : files
}

/** A scope as one string, the value of its menu item. */
export function scopeKey(scope: ChangesScope): string {
  switch (scope.kind) {
    case 'all':
    case 'uncommitted':
      return scope.kind
    case 'commit':
      return `commit\u0000${scope.repo}\u0000${scope.sha}`
    case 'compare':
      return `compare\u0000${scope.repo}\u0000${scope.ref}`
  }
}
