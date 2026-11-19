// The diff of the Changes screen (worfy-changes-view ticket 03): the files of the tree one under the other, each with its
// header and its hunks, Inline or Side by side, with Wrap or without. A file's patch is read (`changes.file`) only when
// the file comes within the window of the diff (diff-window.ts): the blocks on screen and two screens above and below.
// A large, lock or generated file comes folded, «Large diff · N lines · Show»; a binary file shows its sizes, «Binary
// file · 12 KB → 14 KB». Added lines take the colours of ready, deleted lines those of blocked, as the migration form
// does (harness/MigrationForm.tsx); there are no syntax colours (spec, Q5).
//
// The gutter of a line (the sign cell) is where ticket 05 puts its «+»: `renderGutter` draws into it.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { ChangesScope, DiffHunk, DiffLine, FileDiff } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
import { invoke } from '../ipc'
import { FILE_GAP, FILE_HEADER_HEIGHT, NOTE_HEIGHT, count, hunkHeight, offsetsOf, sideBySideRows, sizeLabel, unreadHeight, windowOf, type DiffLayout, type FileEntry } from './diff-window'
import { FileStats, StatusLetter } from './FileTree'

/** The Ticket as `changes.*` take it. */
export interface ChangesTicket {
  epic: string
  num: number
  branch?: string | null
  repos?: string[]
}

/** The side of a line its number belongs to. */
export type LineSide = 'old' | 'new'

export interface DiffPaneHandle {
  /** Scrolls the diff to the file's header. */
  scrollToFile(key: string): void
  /** Scrolls to the next hunk (`1`) or the one before (`-1`); false when there is none that way. */
  moveHunk(step: 1 | -1): boolean
}

export interface DiffPaneProps {
  projectId: string
  ticket: ChangesTicket
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
  ref?: Ref<DiffPaneHandle>
}

type FileState = { kind: 'loading' } | { kind: 'ready'; diff: FileDiff } | { kind: 'error'; message: string }

type Block =
  | { kind: 'head'; key: string; entry: FileEntry; last: boolean }
  | { kind: 'hunk'; key: string; entry: FileEntry; hunk: DiffHunk; last: boolean }
  | { kind: 'note'; key: string; entry: FileEntry; note: Note; last: boolean }

type Note =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'folded'; reason: 'large' | 'lock' | 'generated'; lines: number }
  | { kind: 'binary'; oldSize: number | null; newSize: number | null }
  | { kind: 'binary-unread' }
  | { kind: 'empty'; oldMode: string | null; newMode: string | null }

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
  return diff.hunks.length === 0 ? { kind: 'empty', oldMode: diff.oldMode, newMode: diff.newMode } : null
}

/** A file's patch needs reading: it is not read, and not folded unasked. */
const needsRead = (entry: FileEntry, state: FileState | undefined, expanded: boolean): boolean => state === undefined && (entry.file.fold === null || expanded)

function blocksOf(entries: readonly FileEntry[], files: ReadonlyMap<string, FileState>, expanded: ReadonlySet<string>, collapsed: ReadonlySet<string>): Block[] {
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
    if (note !== null) {
      blocks.push({ kind: 'note', key: `${entry.key}\u0000note`, entry, note, last: true })
      continue
    }
    const hunks = state?.kind === 'ready' && state.diff.kind === 'hunks' ? state.diff.hunks : []
    hunks.forEach((hunk, index) => blocks.push({ kind: 'hunk', key: `${entry.key}\u0000hunk${index}`, entry, hunk, last: index === hunks.length - 1 }))
  }
  return blocks
}

function estimate(block: Block, layout: DiffLayout): number {
  const gap = block.last ? FILE_GAP : 0
  if (block.kind === 'head') return FILE_HEADER_HEIGHT + gap
  if (block.kind === 'hunk') return hunkHeight(block.hunk, layout) + gap
  return (block.note.kind === 'loading' ? unreadHeight(block.entry.file) : NOTE_HEIGHT) + gap
}

function sign(kind: DiffLine['kind']): string {
  return kind === 'add' ? '+' : kind === 'del' ? '−' : ''
}

const lineClass = (kind: DiffLine['kind']): string => (kind === 'add' ? ' w-changes__cell--add' : kind === 'del' ? ' w-changes__cell--del' : '')

function Code({ line }: { line: DiffLine }) {
  return (
    <span className={`w-changes__code${lineClass(line.kind)}`}>
      {line.text}
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
}

function HunkRows({ hunk, entry, layout, renderGutter }: RowsProps) {
  const gutter = (line: DiffLine, side: LineSide) => renderGutter?.(line, side, entry) ?? null
  if (layout === 'inline') {
    return hunk.lines.map((line, index) => {
      const side: LineSide = line.kind === 'del' ? 'old' : 'new'
      return (
        <div key={index} className={`w-changes__line w-changes__line--${line.kind}`} data-testid="changes-line" data-kind={line.kind} data-side={side} data-line={side === 'old' ? line.oldLine : line.newLine}>
          <span className={`w-changes__no${lineClass(line.kind)}`}>{line.oldLine ?? ''}</span>
          <span className={`w-changes__no${lineClass(line.kind)}`}>{line.newLine ?? ''}</span>
          <span className={`w-changes__sign${lineClass(line.kind)}`}>
            {sign(line.kind)}
            {gutter(line, side)}
          </span>
          <Code line={line} />
        </div>
      )
    })
  }
  return sideBySideRows(hunk.lines).map((row, index) => {
    const half = (line: DiffLine | null, side: LineSide) => {
      if (line === null) {
        return [<span key={`${side}-no`} className={`w-changes__no w-changes__cell--empty${side === 'new' ? ' w-changes__no--edge' : ''}`} />, <span key={`${side}-sign`} className="w-changes__sign w-changes__cell--empty" />, <span key={`${side}-code`} className="w-changes__code w-changes__cell--empty" />]
      }
      return [
        <span key={`${side}-no`} className={`w-changes__no${lineClass(line.kind)}${side === 'new' ? ' w-changes__no--edge' : ''}`}>
          {side === 'old' ? line.oldLine : line.newLine}
        </span>,
        <span key={`${side}-sign`} className={`w-changes__sign${lineClass(line.kind)}`}>
          {sign(line.kind)}
          {gutter(line, side)}
        </span>,
        <Code key={`${side}-code`} line={line} />,
      ]
    }
    const kind = row.old?.kind === 'context' ? 'context' : row.old !== null && row.new !== null ? 'change' : row.old !== null ? 'del' : 'add'
    return (
      <div key={index} className="w-changes__line w-changes__line--pair" data-testid="changes-row" data-kind={kind}>
        {half(row.old, 'old')}
        {half(row.new, 'new')}
      </div>
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
    case 'empty':
      return (
        <p className="w-changes__note-text w-changes__muted">
          {note.oldMode !== note.newMode && note.oldMode !== null && note.newMode !== null ? `Mode ${note.oldMode} → ${note.newMode}` : 'No lines changed'}
        </p>
      )
  }
}

const EMPTY_FILES: ReadonlyMap<string, FileState> = new Map()
const EMPTY_HEIGHTS: ReadonlyMap<string, number> = new Map()

export function DiffPane({ projectId, ticket, scope, hideWhitespace, layout, wrap, entries, several, selected, generation, renderGutter, ref }: DiffPaneProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  // What was read, for the scope, the whitespace, the Ticket and the Refresh it was read for.
  const readFor = JSON.stringify([projectId, ticket, scope, hideWhitespace, generation])
  const [files, setFiles] = useState<{ of: string; map: ReadonlyMap<string, FileState> }>({ of: readFor, map: new Map() })
  const current = files.of === readFor ? files.map : EMPTY_FILES
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Measured heights of drawn blocks, by block; dropped when what draws them changes.
  const measuredFor = `${layout}|${String(wrap)}|${readFor}`
  const [measured, setMeasured] = useState<{ of: string; map: ReadonlyMap<string, number> }>({ of: measuredFor, map: new Map() })
  const heightOf = measured.of === measuredFor ? measured.map : EMPTY_HEIGHTS

  const blocks = blocksOf(entries, current, expanded, collapsed)
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
  useEffect(() => {
    if (asked.current.of !== readFor) asked.current = { of: readFor, keys: new Set() }
    const of = readFor
    for (const [key, entry] of wanted) {
      if (asked.current.keys.has(key)) continue
      asked.current.keys.add(key)
      const { file } = entry
      void invoke('changes.file', {
        projectId,
        ticket,
        repo: entry.repo,
        scope,
        path: file.path,
        oldPath: file.oldPath,
        untracked: file.untracked,
        ...(key.endsWith('\u0000expand') ? { expand: true } : {}),
        hideWhitespace,
      }).then((result) => {
        const state: FileState = result.ok ? { kind: 'ready', diff: result.value.file } : { kind: 'error', message: failureReason('changes.file', result.error) }
        setFiles((previous) => ({ of, map: new Map(previous.of === of ? previous.map : []).set(key, state) }))
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
  const observer = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observer.current?.disconnect(), [])
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null || typeof ResizeObserver === 'undefined') return
      observer.current ??= new ResizeObserver((records) => {
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
      const watcher = observer.current
      watcher.observe(element)
      return () => watcher.unobserve(element)
    },
    [measuredFor],
  )
  // A new layout measures anew: the observer reports with the `measuredFor` of its time.
  useEffect(() => {
    observer.current?.disconnect()
    observer.current = null
  }, [measuredFor])

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

  useImperativeHandle(
    ref,
    () => ({
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
              </div>
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
          <div key={block.key} ref={measure} data-block={block.key} className={className} data-testid="changes-hunk" data-path={entry.file.path} data-repo={entry.repo}>
            <div className="w-changes__hunk-head">
              {block.hunk.header}
              {block.hunk.section === '' ? null : ` ${block.hunk.section}`}
            </div>
            <HunkRows hunk={block.hunk} entry={entry} layout={layout} renderGutter={renderGutter} />
          </div>
        )
      })}
      <div style={{ height: slice.after }} aria-hidden="true" />
      {entries.length === 0 ? <p className="w-changes__empty">No files to show</p> : null}
    </div>
  )
}
