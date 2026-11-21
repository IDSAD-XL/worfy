// The diff of the Changes screen (worfy-changes-view ticket 03): the files of the tree one under the other, each with its
// header and its hunks, Inline or Side by side, with Wrap or without. A file's patch is read (`changes.file`) only when
// the file comes within the window of the diff (diff-window.ts): the blocks on screen and two screens above and below.
// A large, lock or generated file comes folded, «Large diff · N lines · Show»; a binary file shows its sizes, «Binary
// file · 12 KB → 14 KB». Added lines take the colours of ready, deleted lines those of blocked, as the migration form
// does (harness/MigrationForm.tsx). The code of a hunk on screen takes the syntax colours of the GitHub themes once its
// tokens are read (ticket 10, highlight.ts); until then, and for a file of no known language, it is plain text.
//
// The gutter of a line (the sign cell) is where ticket 05 puts its «+»: `renderGutter` draws into it. The comments on
// lines (ticket 05, LineComment.tsx) stand under their last line (`renderBelow`); the lines picked for a comment are lit
// (`isPicked`); the pointer on the diff goes to `lineEvents`, which finds the line by the attributes of its cells
// (`data-side`, `data-line`, and the file's `data-key` on its hunk). A line asked for (scrollToLine: a chip of the
// tray, a block of a sent message) is brought into view once its file is read, and flashes.
//
// The subject is a Ticket or a pull request (worfy-pr-review ticket 06). A PR's review threads of GitHub (`threads`, as
// the PR inbox reads them) stand under their line: of the old side for a thread on a deleted line (LEFT), of the new
// side otherwise — in All changes, and in Since my review for the new side only (a Commit numbers its lines of its
// own). An outdated thread, one without a line, and one whose line the scope or the hunks do not show stand in a list
// under the file's header, each with where it was. A file GitHub sent without its patch reads «Large diff · Open on GitHub»; a file
// of a diff read from GitHub has «View file on GitHub» in its header (no context past the hunks GitHub sent).
import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import type { ChangesScope, ChangesSubjectRef, DiffHunk, DiffLine, FileDiff } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
import type { PrInboxThread } from '../../shared/ipc/pr-inbox'
import { invoke } from '../ipc'
import { FILE_GAP, FILE_HEADER_HEIGHT, NOTE_HEIGHT, count, lineNumber, hunkHeight, offsetsOf, sideBySideRows, sizeLabel, unreadHeight, windowOf, type DiffLayout, type FileEntry } from './diff-window'
import { FileStats, StatusLetter } from './FileTree'
import { peekHunkTokens, requestHunkTokens, type HunkTokens, type LineTokens } from './highlight'
import './highlight.css'

/** A review thread of GitHub on the diff of a pull request, as the PR inbox reads it (worfy-pr-review ticket 06). */
export type ChangesThread = PrInboxThread

/** The side of a line its number belongs to. */
export type LineSide = 'old' | 'new'

export interface DiffPaneHandle {
  /** Scrolls the diff to the file's header. */
  scrollToFile(key: string): void
  /** Scrolls to the next hunk (`1`) or the one before (`-1`); false when there is none that way. */
  moveHunk(step: 1 | -1): boolean
  /** Brings the line of the file into view once its patch is read, and flashes it. */
  scrollToLine(key: string, side: LineSide, line: number): void
}

/** How long a line asked for flashes, in ms. */
const FLASH_MS = 1600
/** How long a line asked for is looked for while its file is read, in ms. */
const SEEK_MS = 10_000

export interface DiffPaneProps {
  projectId: string
  /** The Ticket or the pull request, as `changes.*` take it. */
  subject: ChangesSubjectRef
  scope: ChangesScope
  hideWhitespace: boolean
  layout: DiffLayout
  wrap: boolean
  /** The files, in the order of the tree. */
  entries: readonly FileEntry[]
  /** Several repositories: the header of a file names its repository. */
  several: boolean
  selected: string | null
  /** Grows with every Refresh: the patches are read again. */
  generation: number
  /** The gutter of a line (ticket 05); nothing by default. */
  renderGutter?: (line: DiffLine, side: LineSide, entry: FileEntry) => ReactNode
  /** What stands under a line: its comments (ticket 05); nothing by default. */
  renderBelow?: (line: DiffLine, side: LineSide, entry: FileEntry) => ReactNode
  /** Whether a line is among the ones picked for a comment (ticket 05). */
  isPicked?: (line: DiffLine, side: LineSide, entry: FileEntry) => boolean
  /** The pointer's events on the diff (ticket 05). */
  lineEvents?: Pick<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onContextMenu' | 'onMouseUp' | 'onMouseDown'>
  /** A file's patch was read: its hunks, and the scope, Hide whitespace and Refresh it was read for (ticket 05). */
  onFileRead?: (entry: FileEntry, diff: FileDiff, readOf: FileReadOf) => void
  /** The review threads of a pull request on GitHub; none by default. */
  threads?: readonly ChangesThread[]
  /** Reply in a thread: the reply draft of the PR inbox; without it a thread has no Reply. */
  onReply?: (thread: ChangesThread) => void
  /** What stands at the end of a file's header: Viewed of Review mode (worfy-pr-review ticket 09); nothing by default. */
  renderHeadEnd?: (entry: FileEntry) => ReactNode
  ref?: Ref<DiffPaneHandle>
}

/** What a file's patch was read for: the scope, Hide whitespace and the Refresh (generation) of its read. */
export interface FileReadOf {
  scope: ChangesScope
  hideWhitespace: boolean
  generation: number
}

type FileState = { kind: 'loading' } | { kind: 'ready'; diff: FileDiff } | { kind: 'error'; message: string }

type Block =
  | { kind: 'head'; key: string; entry: FileEntry; last: boolean }
  | { kind: 'hunk'; key: string; entry: FileEntry; hunk: DiffHunk; threads: ReadonlyMap<string, readonly ChangesThread[]>; last: boolean }
  | { kind: 'note'; key: string; entry: FileEntry; note: Note; last: boolean }
  | { kind: 'outdated'; key: string; entry: FileEntry; threads: readonly ChangesThread[]; last: boolean }

type Note =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'folded'; reason: 'large' | 'lock' | 'generated'; lines: number }
  | { kind: 'binary'; oldSize: number | null; newSize: number | null }
  | { kind: 'binary-unread' }
  | { kind: 'empty'; oldMode: string | null; newMode: string | null }
  | { kind: 'no-patch'; url: string | null }

/** In a test the scroll box has no height: the window is then as tall as a screen of this many px. */
const FALLBACK_VIEWPORT = 800

const FOLD_WORDS = { large: 'Large diff', lock: 'Lock file', generated: 'Generated file' } as const

/** The key of a file's patch as read: the folded one and the one «Show» asked for are two. */
const readKey = (key: string, expanded: boolean): string => `${key}\u0000${expanded ? 'expand' : 'diff'}`

/** The note in place of a file's patch, or null when its hunks are drawn. */
function noteOf(entry: FileEntry, state: FileState | undefined, expanded: boolean): Note | null {
  const { file } = entry
  if (file.fold !== null && !expanded) return { kind: 'folded', reason: file.fold, lines: (file.additions ?? 0) + (file.deletions ?? 0) }
  if (state === undefined || state.kind === 'loading') return file.binary ? { kind: 'binary-unread' } : { kind: 'loading' }
  if (state.kind === 'error') return { kind: 'error', message: state.message }
  const { diff } = state
  if (diff.kind === 'folded') return { kind: 'folded', reason: diff.reason, lines: diff.lines }
  if (diff.kind === 'binary') return { kind: 'binary', oldSize: diff.oldSize, newSize: diff.newSize }
  if (diff.kind === 'no-patch') return { kind: 'no-patch', url: diff.url }
  return diff.hunks.length === 0 ? { kind: 'empty', oldMode: diff.oldMode, newMode: diff.newMode } : null
}

/** A file's patch needs reading: it is not read, and not folded unasked. */
const needsRead = (entry: FileEntry, state: FileState | undefined, expanded: boolean): boolean => state === undefined && (entry.file.fold === null || expanded)

/** The side of the diff a thread's line is on: LEFT is a line of the base, RIGHT (and no side) one of the head. */
const threadSide = (thread: ChangesThread): LineSide => (thread.side === 'LEFT' ? 'old' : 'new')

/** The key of a line of a side, as the threads on lines are kept. */
const lineKey = (side: LineSide, line: number): string => `${side}:${line}`

/** Where a thread of the list under a file's header was: outdated, without a line, or on a line this diff does not show. */
function threadWhere(thread: ChangesThread): string {
  if (thread.isOutdated) return 'outdated'
  if (thread.line === null) return 'no line'
  return threadSide(thread) === 'old' ? `old line ${thread.line}` : `line ${thread.line}`
}

/** The threads of a PR by path. */
function threadsByPath(threads: readonly ChangesThread[]): ReadonlyMap<string, readonly ChangesThread[]> {
  const byPath = new Map<string, ChangesThread[]>()
  for (const thread of threads) if (thread.path !== null) byPath.set(thread.path, [...(byPath.get(thread.path) ?? []), thread])
  return byPath
}

const NO_THREADS: ReadonlyMap<string, readonly ChangesThread[]> = new Map()

/**
 * The sides whose numbers are those GitHub gave the threads: All changes is the PR's diff, both sides; Since my review
 * ends at the head, its new side only; a Commit numbers its lines of its own, neither.
 */
function sidesOf(scope: ChangesScope): ReadonlySet<LineSide> {
  if (scope.kind === 'all') return new Set(['old', 'new'])
  if (scope.kind === 'compare') return new Set(['new'])
  return new Set()
}

/** A file's threads: those on a line its hunks show, by side and line, and those listed under its header. */
interface FileThreads {
  onLine: ReadonlyMap<string, readonly ChangesThread[]>
  listed: readonly ChangesThread[]
}

/**
 * Places a file's threads. A thread stands on its line when the scope numbers that side as GitHub does and the hunks
 * show that line; any other — outdated, without a line, on a line not shown — is listed under the header. While the
 * file is read (`hunks` null), a thread that may yet find its line is in neither.
 */
function placeThreads(threads: readonly ChangesThread[], hunks: readonly DiffHunk[] | null, sides: ReadonlySet<LineSide>): FileThreads {
  const shown = new Set<string>()
  for (const hunk of hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.kind !== 'add' && line.oldLine !== null) shown.add(lineKey('old', line.oldLine))
      if (line.kind !== 'del' && line.newLine !== null) shown.add(lineKey('new', line.newLine))
    }
  }
  const onLine = new Map<string, ChangesThread[]>()
  const listed: ChangesThread[] = []
  for (const thread of threads) {
    if (thread.isOutdated || thread.line === null || !sides.has(threadSide(thread))) {
      listed.push(thread)
      continue
    }
    const key = lineKey(threadSide(thread), thread.line)
    if (shown.has(key)) onLine.set(key, [...(onLine.get(key) ?? []), thread])
    else if (hunks !== null) listed.push(thread)
  }
  return { onLine, listed }
}

const NO_LINE_THREADS: ReadonlyMap<string, readonly ChangesThread[]> = new Map()

function blocksOf(entries: readonly FileEntry[], files: ReadonlyMap<string, FileState>, expanded: ReadonlySet<string>, collapsed: ReadonlySet<string>, threads: ReadonlyMap<string, readonly ChangesThread[]>, sides: ReadonlySet<LineSide>): Block[] {
  const blocks: Block[] = []
  for (const entry of entries) {
    if (collapsed.has(entry.key)) {
      blocks.push({ kind: 'head', key: `${entry.key}\u0000head`, entry, last: true })
      continue
    }
    blocks.push({ kind: 'head', key: `${entry.key}\u0000head`, entry, last: false })
    const open = expanded.has(entry.key)
    const state = files.get(readKey(entry.key, open))
    const note = noteOf(entry, state, open)
    const hunks = note === null && state?.kind === 'ready' && state.diff.kind === 'hunks' ? state.diff.hunks : []
    const own = threads.get(entry.file.path)
    // A file being read may yet show a thread's line; one with a note (folded, binary, no patch, an error) shows none.
    const placed = own === undefined ? null : placeThreads(own, note?.kind === 'loading' ? null : hunks, sides)
    if (placed !== null && placed.listed.length > 0) blocks.push({ kind: 'outdated', key: `${entry.key}\u0000outdated`, entry, threads: placed.listed, last: false })
    if (note !== null) {
      blocks.push({ kind: 'note', key: `${entry.key}\u0000note`, entry, note, last: true })
      continue
    }
    const onLine = placed?.onLine ?? NO_LINE_THREADS
    hunks.forEach((hunk, index) => blocks.push({ kind: 'hunk', key: `${entry.key}\u0000hunk${index}`, entry, hunk, threads: onLine, last: index === hunks.length - 1 }))
  }
  return blocks
}

function estimate(block: Block, layout: DiffLayout): number {
  const gap = block.last ? FILE_GAP : 0
  if (block.kind === 'head') return FILE_HEADER_HEIGHT + gap
  if (block.kind === 'hunk') return hunkHeight(block.hunk, layout) + gap
  if (block.kind === 'outdated') return NOTE_HEIGHT * (block.threads.length + 1) + gap
  return (block.note.kind === 'loading' ? unreadHeight(block.entry.file) : NOTE_HEIGHT) + gap
}

function sign(kind: DiffLine['kind']): string {
  return kind === 'add' ? '+' : kind === 'del' ? '−' : ''
}

const lineClass = (kind: DiffLine['kind']): string => (kind === 'add' ? ' w-changes__cell--add' : kind === 'del' ? ' w-changes__cell--del' : '')

/** The side and the line a cell of Side by side names, and its marks. */
interface CellAt {
  'data-side'?: LineSide
  'data-line'?: number
  mark?: string
}

/** A token's colours in both themes, as CSS variables: highlight.css picks the one of the window's theme. */
const tokenStyle = (light: string | null, dark: string | null): CSSProperties => ({ '--hl-light': light ?? undefined, '--hl-dark': dark ?? undefined }) as CSSProperties

/** The code of a line: its tokens in their colours once they are read, its plain text until then. Either way its text is the line's. */
function Code({ line, at, tokens }: { line: DiffLine; at?: CellAt; tokens?: LineTokens | null }) {
  const { mark = '', ...data } = at ?? {}
  const lit = tokens != null
  return (
    <span className={`w-changes__code${lineClass(line.kind)}${mark}`} data-highlighted={lit ? 'true' : undefined} {...data}>
      {lit
        ? tokens.map((token, index) => (
            <span key={index} className={`w-hl${token.bold ? ' w-hl--bold' : ''}${token.italic ? ' w-hl--italic' : ''}`} style={tokenStyle(token.light, token.dark)}>
              {token.text}
            </span>
          ))
        : line.text}
      {line.noNewline ? (
        <span className="w-changes__eol" title="No newline at end of file">
          {' '}
          no newline
        </span>
      ) : null}
    </span>
  )
}

interface RowsProps {
  hunk: DiffHunk
  entry: FileEntry
  layout: DiffLayout
  renderGutter: DiffPaneProps['renderGutter']
  renderBelow: DiffPaneProps['renderBelow']
  isPicked: DiffPaneProps['isPicked']
  /** The PR's threads on the lines of this file, by side and line (lineKey). */
  threads: ReadonlyMap<string, readonly ChangesThread[]>
  onReply: DiffPaneProps['onReply']
}

/**
 * The tokens of a hunk drawn: at once when they are known, else asked for (one hunk per task, highlight.ts) and drawn
 * when they come; a hunk no longer drawn cancels its request. Null — plain text, for now or for good.
 */
function useHunkTokens(path: string, hunk: DiffHunk): HunkTokens | null {
  const known = peekHunkTokens(path, hunk)
  const [read, setRead] = useState<{ path: string; hunk: DiffHunk; tokens: HunkTokens | null } | null>(null)
  const unknown = known === undefined
  useEffect(() => {
    if (!unknown) return
    return requestHunkTokens(path, hunk, (tokens) => setRead({ path, hunk, tokens }))
  }, [path, hunk, unknown])
  if (known !== undefined) return known
  return read !== null && read.path === path && read.hunk === hunk ? read.tokens : null
}

function HunkRows({ hunk, entry, layout, renderGutter, renderBelow, isPicked, threads, onReply }: RowsProps) {
  const tokens = useHunkTokens(entry.file.path, hunk)
  const indexOf = useMemo(() => new Map(hunk.lines.map((line, index) => [line, index])), [hunk])
  /** The tokens of a line on its side: an added or a context line on the new side, a deleted one on the old. */
  const tokensOf = (line: DiffLine, side: LineSide): LineTokens | null => {
    const index = indexOf.get(line)
    return tokens === null || index === undefined ? null : (tokens[side][index] ?? null)
  }
  const gutter = (line: DiffLine, side: LineSide) => renderGutter?.(line, side, entry) ?? null
  const below = (line: DiffLine, side: LineSide) => {
    const own = renderBelow?.(line, side, entry) ?? null
    // Inline draws a context line once: the threads of both its sides stand under it. Side by side draws it on each.
    const sides: LineSide[] = layout === 'inline' ? ['old', 'new'] : [side]
    const on = sides.flatMap((each) => {
      const number = each === 'old' ? (line.kind === 'add' ? null : line.oldLine) : line.kind === 'del' ? null : line.newLine
      return number === null ? [] : (threads.get(lineKey(each, number)) ?? [])
    })
    if (on.length === 0) return own
    return (
      <>
        {on.map((thread) => (
          <ThreadView key={thread.id} thread={thread} onReply={onReply} />
        ))}
        {own}
      </>
    )
  }
  const marks = (line: DiffLine, side: LineSide): string => (isPicked?.(line, side, entry) === true ? ' is-picked' : '')
  if (layout === 'inline') {
    return hunk.lines.map((line, index) => {
      const side: LineSide = line.kind === 'del' ? 'old' : 'new'
      const under = below(line, side)
      return (
        <Fragment key={index}>
          <div className={`w-changes__line w-changes__line--${line.kind}${marks(line, side)}`} data-testid="changes-line" data-kind={line.kind} data-side={side} data-line={lineNumber(line, side) ?? undefined}>
            <span className={`w-changes__no${lineClass(line.kind)}`}>{line.oldLine ?? ''}</span>
            <span className={`w-changes__no${lineClass(line.kind)}`}>{line.newLine ?? ''}</span>
            <span className={`w-changes__sign${lineClass(line.kind)}`}>
              {sign(line.kind)}
              {gutter(line, side)}
            </span>
            <Code line={line} tokens={tokensOf(line, side)} />
          </div>
          {under}
        </Fragment>
      )
    })
  }
  return sideBySideRows(hunk.lines).map((row, index) => {
    const half = (line: DiffLine | null, side: LineSide) => {
      if (line === null) {
        return [<span key={`${side}-no`} className={`w-changes__no w-changes__cell--empty${side === 'new' ? ' w-changes__no--edge' : ''}`} />, <span key={`${side}-sign`} className="w-changes__sign w-changes__cell--empty" />, <span key={`${side}-code`} className="w-changes__code w-changes__cell--empty" />]
      }
      // Each cell names its side and line: a click, a right click or a selection finds the line by them.
      const mark = marks(line, side)
      const data = { 'data-side': side, 'data-line': lineNumber(line, side) ?? undefined }
      return [
        <span key={`${side}-no`} className={`w-changes__no${lineClass(line.kind)}${side === 'new' ? ' w-changes__no--edge' : ''}${mark}`} {...data}>
          {lineNumber(line, side)}
        </span>,
        <span key={`${side}-sign`} className={`w-changes__sign${lineClass(line.kind)}${mark}`} {...data}>
          {sign(line.kind)}
          {gutter(line, side)}
        </span>,
        <Code key={`${side}-code`} line={line} at={{ ...data, mark }} tokens={tokensOf(line, side)} />,
      ]
    }
    const kind = row.old?.kind === 'context' ? 'context' : row.old !== null && row.new !== null ? 'change' : row.old !== null ? 'del' : 'add'
    // A context line stands on both sides: its comments on either side come under the row.
    const under = [row.old === null ? null : below(row.old, 'old'), row.new === null ? null : below(row.new, 'new')]
    return (
      <Fragment key={index}>
        <div className="w-changes__line w-changes__line--pair" data-testid="changes-row" data-kind={kind}>
          {half(row.old, 'old')}
          {half(row.new, 'new')}
        </div>
        {under[0]}
        {under[1]}
      </Fragment>
    )
  })
}

function NoteView({ note, onShow }: { note: Note; onShow: () => void }) {
  switch (note.kind) {
    case 'loading':
      return <p className="w-changes__note-text w-changes__muted">Loading…</p>
    case 'error':
      return <p className="w-changes__note-text">{note.message}</p>
    case 'folded':
      return (
        <p className="w-changes__note-text" data-testid="changes-folded">
          {FOLD_WORDS[note.reason]} · {count(note.lines)} lines ·{' '}
          <button type="button" className="w-changes__link nodrag" data-testid="changes-show" onClick={onShow}>
            Show
          </button>
        </p>
      )
    case 'binary':
      return (
        <p className="w-changes__note-text" data-testid="changes-binary">
          Binary file · <span className="w-changes__del-n">{sizeLabel(note.oldSize)}</span> → <span className="w-changes__add-n">{sizeLabel(note.newSize)}</span>
        </p>
      )
    case 'binary-unread':
      return (
        <p className="w-changes__note-text" data-testid="changes-binary">
          Binary file
        </p>
      )
    case 'no-patch':
      return (
        <p className="w-changes__note-text" data-testid="changes-no-patch">
          Large diff ·{' '}
          {note.url === null ? (
            'GitHub sent no patch'
          ) : (
            <button type="button" className="w-changes__link nodrag" data-testid="changes-open-github" onClick={() => openOnGithub(note.url!)}>
              Open on GitHub
            </button>
          )}
        </p>
      )
    case 'empty':
      return (
        <p className="w-changes__note-text w-changes__muted">
          {note.oldMode !== note.newMode && note.oldMode !== null && note.newMode !== null ? `Mode ${note.oldMode} → ${note.newMode}` : 'No lines changed'}
        </p>
      )
  }
}

/** A page of GitHub opens in the system's browser. */
function openOnGithub(url: string): void {
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}

/** A review thread of GitHub: its last comments, oldest first, and Reply when the PR inbox can draft one. */
function ThreadView({ thread, onReply, where }: { thread: ChangesThread; onReply: DiffPaneProps['onReply']; where?: string }) {
  const state = thread.isResolved ? 'resolved thread' : 'open thread'
  return (
    <div className="w-cl w-cl--github nodrag" data-testid="changes-thread" data-thread-id={thread.id} data-path={thread.path ?? undefined} data-line={thread.line ?? undefined}>
      {where === undefined ? null : (
        <div className="w-cl__muted" data-testid="changes-thread-where">
          {where}
        </div>
      )}
      {thread.comments.map((comment) => (
        <div key={comment.id} className="w-cl__comment">
          <div className="w-cl__head">
            <span className="w-cl__who">{comment.author ?? 'ghost'}</span>
            <span>· {state} on GitHub</span>
          </div>
          <div className="w-cl__text">{comment.body}</div>
        </div>
      ))}
      {thread.comments.length === 0 ? <div className="w-cl__muted">{state} on GitHub</div> : null}
      {onReply !== undefined && thread.viewerCanReply ? (
        <div className="w-cl__bar">
          <span className="w-qtray__spacer" />
          <button type="button" className="w-changes__link" data-testid="changes-thread-reply" onClick={() => onReply(thread)}>
            Reply
          </button>
        </div>
      ) : null}
    </div>
  )
}

const EMPTY_FILES: ReadonlyMap<string, FileState> = new Map()
const EMPTY_HEIGHTS: ReadonlyMap<string, number> = new Map()

export function DiffPane({ projectId, subject, scope, hideWhitespace, layout, wrap, entries, several, selected, generation, renderGutter, renderBelow, isPicked, lineEvents, onFileRead, threads, onReply, renderHeadEnd, ref }: DiffPaneProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  // What was read, for the scope, the whitespace, the subject and the Refresh it was read for.
  const readFor = JSON.stringify([projectId, subject, scope, hideWhitespace, generation])
  const [files, setFiles] = useState<{ of: string; map: ReadonlyMap<string, FileState> }>({ of: readFor, map: new Map() })
  const current = files.of === readFor ? files.map : EMPTY_FILES
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Measured heights of drawn blocks, by block; dropped when what draws them changes.
  const measuredFor = `${layout}|${String(wrap)}|${readFor}`
  const [measured, setMeasured] = useState<{ of: string; map: ReadonlyMap<string, number> }>({ of: measuredFor, map: new Map() })
  const heightOf = measured.of === measuredFor ? measured.map : EMPTY_HEIGHTS

  const byPath = useMemo(() => (threads === undefined || threads.length === 0 ? NO_THREADS : threadsByPath(threads)), [threads])
  const blocks = blocksOf(entries, current, expanded, collapsed, byPath, sidesOf(scope))
  const heights = blocks.map((block) => heightOf.get(block.key) ?? estimate(block, layout))
  const offsets = offsetsOf(heights)
  const slice = windowOf(heights, top, viewport || FALLBACK_VIEWPORT)
  const drawn = blocks.slice(slice.start, slice.end)

  // The patches of the files within the window that are not read yet: each is asked for once per `readFor`.
  const wanted = new Map<string, FileEntry>()
  for (const block of drawn) {
    const open = expanded.has(block.entry.key)
    const key = readKey(block.entry.key, open)
    if (needsRead(block.entry, current.get(key), open)) wanted.set(key, block.entry)
  }
  const wantedKeys = [...wanted.keys()].join('\n')
  const asked = useRef<{ of: string; keys: Set<string> }>({ of: readFor, keys: new Set() })
  // The listener of reads, as it is now: the read's answer comes after the render that asked for it.
  const readListener = useRef(onFileRead)
  useEffect(() => {
    readListener.current = onFileRead
  })
  useEffect(() => {
    if (asked.current.of !== readFor) asked.current = { of: readFor, keys: new Set() }
    const of = readFor
    for (const [key, entry] of wanted) {
      if (asked.current.keys.has(key)) continue
      asked.current.keys.add(key)
      const { file } = entry
      void invoke('changes.file', {
        projectId,
        subject,
        repo: entry.repo,
        scope,
        path: file.path,
        oldPath: file.oldPath,
        untracked: file.untracked,
        ...(key.endsWith('\u0000expand') ? { expand: true } : {}),
        hideWhitespace,
      }).then((result) => {
        // An answer for a `readFor` gone by is dropped: it would replace the patches of the current one, which are
        // already asked for and so not asked again.
        if (asked.current.of !== of) return
        const state: FileState = result.ok ? { kind: 'ready', diff: result.value.file } : { kind: 'error', message: failureReason('changes.file', result.error) }
        setFiles((previous) => ({ of, map: new Map(previous.of === of ? previous.map : []).set(key, state) }))
        if (result.ok) readListener.current?.(entry, result.value.file, { scope, hideWhitespace, generation })
      })
    }
    // `wanted` is a new Map each render; its keys, with what they are read for, are what starts a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKeys, readFor])

  // Follow the scroll and the height of the box.
  useEffect(() => {
    const box = scroller.current
    if (box === null) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setTop(box.scrollTop))
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setViewport(box.clientHeight))
    observer?.observe(box)
    return () => {
      cancelAnimationFrame(frame)
      box.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [])

  // Measure the drawn blocks: Wrap and the notes make them taller than their rows say.
  // One observer per `measuredFor`: it reports with the key of its time, so a new layout measures anew. The ref callback
  // makes it, not an effect: React attaches the refs of a new layout before its effects run.
  const observer = useRef<{ of: string; watcher: ResizeObserver } | null>(null)
  useEffect(
    () => () => {
      observer.current?.watcher.disconnect()
      observer.current = null
    },
    [],
  )
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null || typeof ResizeObserver === 'undefined') return
      if (observer.current?.of !== measuredFor) {
        observer.current?.watcher.disconnect()
        const watcher = new ResizeObserver((records) => {
          setMeasured((previous) => {
            const map = new Map(previous.of === measuredFor ? previous.map : [])
            let changed = previous.of !== measuredFor
            for (const record of records) {
              const key = (record.target as HTMLElement).dataset.block
              // The space under a file is its last block's margin: part of the block's room in the window.
              const height = record.target.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(record.target).marginBottom) || 0)
              if (key === undefined || height === 0 || Math.abs((map.get(key) ?? -1) - height) <= 0.5) continue
              map.set(key, height)
              changed = true
            }
            return changed ? { of: measuredFor, map } : previous
          })
        })
        observer.current = { of: measuredFor, watcher }
      }
      const { watcher } = observer.current
      watcher.observe(element)
      return () => watcher.unobserve(element)
    },
    [measuredFor],
  )

  // A scroll asked for (a file of the tree, j and k, n and p) is set again after the blocks above it are measured.
  const pending = useRef<{ key: string; tries: number } | null>(null)
  const scrollTo = useCallback((offset: number) => {
    const box = scroller.current
    if (box === null) return
    box.scrollTop = offset
    setTop(offset)
  }, [])
  useLayoutEffect(() => {
    const target = pending.current
    const box = scroller.current
    if (target === null || box === null) return
    const index = blocks.findIndex((block) => block.key === target.key)
    if (index >= 0 && Math.abs(box.scrollTop - offsets[index]!) > 1) box.scrollTop = offsets[index]!
    target.tries -= 1
    if (target.tries <= 0) pending.current = null
  })

  // A line asked for: the file's header first, so its patch is read; then the line's hunk, once it is there; then the
  // drawn line itself goes to the middle and flashes (a mark on its elements, not React's state: it only lasts a moment).
  // Given up after SEEK_MS: the file may be folded, or no longer have the line.
  const seek = useRef<{ key: string; side: LineSide; line: number; until: number; scrolled: boolean } | null>(null)
  const [, poke] = useState(0)
  useLayoutEffect(() => {
    const target = seek.current
    const box = scroller.current
    // A hidden view (the Session view is in front while the Canvas comes back) neither scrolls nor shows a flash: the
    // look waits for the box to have a size again, which its ResizeObserver reports with a render.
    if (target === null || box === null || box.clientHeight === 0) return
    if (Date.now() > target.until) {
      seek.current = null
      return
    }
    const hunk = Array.from(box.querySelectorAll<HTMLElement>('[data-testid="changes-hunk"]')).find((each) => each.dataset.key === target.key && each.querySelector(`[data-side="${target.side}"][data-line="${target.line}"]`) !== null)
    if (hunk !== undefined) {
      seek.current = null
      pending.current = null
      const marked = Array.from(hunk.querySelectorAll<HTMLElement>(`[data-side="${target.side}"][data-line="${target.line}"]`))
      marked[0]?.scrollIntoView?.({ block: 'center' })
      for (const element of marked) {
        element.classList.add('is-flash')
        element.dataset.flash = 'true'
      }
      setTimeout(() => {
        for (const element of marked) {
          element.classList.remove('is-flash')
          delete element.dataset.flash
        }
      }, FLASH_MS)
      return
    }
    if (target.scrolled) return
    const index = blocks.findIndex((block) => block.kind === 'hunk' && block.entry.key === target.key && block.hunk.lines.some((line) => lineNumber(line, target.side) === target.line))
    if (index < 0) return
    // The hunk is read but not drawn: to it, so the window draws it; the line itself on the next pass.
    target.scrolled = true
    pending.current = null
    box.scrollTop = offsets[index]!
  })

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine(key, side, line) {
        const index = blocks.findIndex((block) => block.kind === 'head' && block.entry.key === key)
        setCollapsed((set) => {
          if (!set.has(key)) return set
          const next = new Set(set)
          next.delete(key)
          return next
        })
        seek.current = { key, side, line, until: Date.now() + SEEK_MS, scrolled: false }
        if (index >= 0) scrollTo(offsets[index]!)
        // A render, so the look for the line runs even when the scroll did not move.
        poke((value) => value + 1)
      },
      scrollToFile(key) {
        const index = blocks.findIndex((block) => block.kind === 'head' && block.entry.key === key)
        if (index < 0) return
        pending.current = { key: blocks[index]!.key, tries: 4 }
        scrollTo(offsets[index]!)
      },
      moveHunk(step) {
        const at = scroller.current?.scrollTop ?? top
        const starts = blocks.flatMap((block, index) => (block.kind === 'hunk' ? [{ key: block.key, offset: offsets[index]! }] : []))
        const next = step === 1 ? starts.find(({ offset }) => offset > at + 1) : starts.findLast(({ offset }) => offset < at - 1)
        if (next === undefined) return false
        pending.current = { key: next.key, tries: 4 }
        scrollTo(next.offset)
        return true
      },
    }),
    [blocks, offsets, scrollTo, top],
  )

  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  return (
    <div
      ref={scroller}
      className={`w-changes__diff nodrag nowheel${layout === 'side-by-side' ? ' is-side-by-side' : ''}${wrap ? ' is-wrapped' : ''}`}
      data-testid="changes-diff"
      data-layout={layout}
      data-wrap={String(wrap)}
      data-drawn={drawn.length}
      {...lineEvents}
    >
      <div style={{ height: slice.before }} aria-hidden="true" />
      {drawn.map((block) => {
        const { entry } = block
        const className = `w-changes__block w-changes__block--${block.kind}${block.last ? ' is-last' : ''}${selected === entry.key ? ' is-selected' : ''}`
        if (block.kind === 'head') {
          const folded = collapsed.has(entry.key)
          return (
            <div key={block.key} ref={measure} data-block={block.key} className={className}>
              <div className="w-changes__file-head" data-testid="changes-file" data-path={entry.file.path} data-repo={entry.repo} aria-current={selected === entry.key ? 'true' : undefined}>
                <button
                  type="button"
                  className="w-changes__twist nodrag"
                  aria-expanded={!folded}
                  aria-label={folded ? `Expand ${entry.file.path}` : `Collapse ${entry.file.path}`}
                  onClick={() => setCollapsed((set) => toggle(set, entry.key))}
                >
                  {folded ? '▸' : '▾'}
                </button>
                <StatusLetter status={entry.file.status} />
                <span className="w-changes__path">
                  {entry.file.oldPath !== null ? <span className="w-changes__muted">{entry.file.oldPath} → </span> : null}
                  {entry.file.path}
                </span>
                <FileStats file={entry.file} />
                <span className="w-changes__spacer" />
                {several ? <span className="w-changes__chip">{entry.repo}</span> : null}
                {entry.file.workflow ? <span className="w-changes__chip">Workflow</span> : null}
                {entry.file.untracked ? <span className="w-changes__chip">Untracked</span> : null}
                {entry.file.url !== undefined ? (
                  <button type="button" className="w-changes__link nodrag" data-testid="changes-view-on-github" onClick={() => openOnGithub(entry.file.url!)}>
                    View file on GitHub
                  </button>
                ) : null}
                {renderHeadEnd?.(entry) ?? null}
              </div>
            </div>
          )
        }
        if (block.kind === 'outdated') {
          return (
            <div key={block.key} ref={measure} data-block={block.key} className={className} data-testid="changes-outdated" data-path={entry.file.path}>
              <p className="w-changes__outdated-head w-changes__muted">{block.threads.length === 1 ? '1 thread not on a line of this diff' : `${block.threads.length} threads not on a line of this diff`}</p>
              {block.threads.map((thread) => (
                <ThreadView key={thread.id} thread={thread} onReply={onReply} where={threadWhere(thread)} />
              ))}
            </div>
          )
        }
        if (block.kind === 'note') {
          return (
            <div key={block.key} ref={measure} data-block={block.key} className={className} data-testid="changes-note" data-path={entry.file.path}>
              <NoteView note={block.note} onShow={() => setExpanded((set) => new Set(set).add(entry.key))} />
            </div>
          )
        }
        return (
          <div key={block.key} ref={measure} data-block={block.key} className={className} data-testid="changes-hunk" data-path={entry.file.path} data-repo={entry.repo} data-key={entry.key}>
            <div className="w-changes__hunk-head">
              {block.hunk.header}
              {block.hunk.section === '' ? null : ` ${block.hunk.section}`}
            </div>
            <HunkRows hunk={block.hunk} entry={entry} layout={layout} renderGutter={renderGutter} renderBelow={renderBelow} isPicked={isPicked} threads={block.threads} onReply={onReply} />
          </div>
        )
      })}
      <div style={{ height: slice.after }} aria-hidden="true" />
      {entries.length === 0 ? <p className="w-changes__empty">No files to show</p> : null}
    </div>
  )
}
