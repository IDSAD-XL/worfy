// The comments on the lines of someone else's PR in Review mode (worfy-pr-review ticket 10; spec, implementation
// decisions, 7): the popover and the keys of the comments of the Changes screen (changes/LineComment.tsx, worfy-changes-view
// ticket 05), but the comment goes into the review draft of the PR (`prReview.saveComment`), never to a Session.
//
// - A comment is made on a line or a range of one file and one side: «+» in the gutter, or the key `c` on the lines
//   picked (a click picks a line, a click with Shift or a selection across lines picks a range). ⌘↵ saves it. Suggest
//   change puts a `suggestion` block with the text of the lines picked into the field. No images: GitHub takes none in
//   a review comment.
// - New comments are numbered on the commit of the draft (draftCommitOf), so they are made only while the diff shown is
//   that commit's: All changes on a head the draft is on. A head past it lists the comments above the diff (ReviewMode).
// - A comment stands under its last line: «Pending · Edit · Delete», the agent's «Written by the agent · Edit · Delete».
//   Edit saves it with its `ref`, which makes it the person's (main sets `by: 'person'`).
// - A comment on a line the diff of the PR lacks (an agent took a wrong line, a file not in the PR) stands in
//   «Not on a changed line» above the diff: GitHub refuses it (422). Move to line puts it on the line the person takes
//   next («+» or `c`); Delete removes it. Which lines the diff has is read for the files with comments (`changes.file`,
//   which main keeps in memory per head).
// - A popover with text not saved yet stays open: «+», `c` and Edit do not replace it, and Escape keeps it (the rule of
//   the Changes screen, worfy-polish 136).
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import type { ChangesPrRef, DiffHunk, DiffLine, FileDiff } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
import '../../shared/ipc/changes'
import '../../shared/ipc/pr-review'
import type { PrReviewDraftAnswer, ReviewComment, ReviewCommentRef, ReviewDraft } from '../../shared/ipc/pr-review'
import { SHORTCUTS } from '../../shared/shortcuts'
import type { DiffPaneProps, FileReadOf, LineSide } from '../changes/DiffPane'
import { lineNumber, type DiffLayout, type FileEntry } from '../changes/diff-window'
import { LineCommentPopover, type LinePopover } from '../changes/LineComment'
import { invoke } from '../ipc'
import { label as shortcutLabel } from '../shortcuts/match'
import { showToast } from '../toast/toasts'
import { DraftComment, type PlacedComment } from './DraftComment'
import { draftChanged } from './review-store'


const sideOf = (side: LineSide): ReviewComment['side'] => (side === 'old' ? 'LEFT' : 'RIGHT')
const lineSideOf = (side: ReviewComment['side']): LineSide => (side === 'LEFT' ? 'old' : 'new')
const refOf = ({ index, comment }: PlacedComment): ReviewCommentRef => ({ index, path: comment.path, body: comment.body })
const whereOf = (comment: ReviewComment): string => `${comment.path}:${comment.start_line === undefined ? comment.line : `${comment.start_line}–${comment.line}`}`

/** The comment stands under this line: its last line, on its side. Inline draws a context line once, on the new side. */
function commentOnLine(comment: ReviewComment, line: DiffLine, side: LineSide, layout: DiffLayout): boolean {
  if (comment.side === 'RIGHT') return side === 'new' && line.kind !== 'del' && line.newLine === comment.line
  return line.kind !== 'add' && line.oldLine === comment.line && (side === 'old' || (layout === 'inline' && line.kind === 'context'))
}

/** The text of each line of a side in a file's hunks, by its number. */
function sideLines(hunks: readonly DiffHunk[], side: LineSide): Map<number, string> {
  const lines = new Map<number, string>()
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const number = lineNumber(line, side)
      if (number !== null) lines.set(number, line.text)
    }
  }
  return lines
}

/** The hunk each line of a side is in, by its number: GitHub takes a range only within one hunk. */
function sideHunks(hunks: readonly DiffHunk[], side: LineSide): Map<number, number> {
  const lines = new Map<number, number>()
  hunks.forEach((hunk, index) => {
    for (const line of hunk.lines) {
      const number = lineNumber(line, side)
      if (number !== null) lines.set(number, index)
    }
  })
  return lines
}

/** The text of the lines a comment is made on, or why it cannot be made there. */
type LinesOf = { ok: true; code: string } | { ok: false; why: string }

const ACROSS_HUNKS = 'A comment covers lines of one hunk: GitHub refuses a range across hunks. Pick lines of one hunk.'

/** The lines picked for a comment: one file, one side, `start` where the pick began. */
interface Picked {
  key: string
  side: LineSide
  start: number
  end: number
}

const range = (pick: Picked): { from: number; to: number } => ({ from: Math.min(pick.start, pick.end), to: Math.max(pick.start, pick.end) })

/** The line a pointer event is on: the file of its hunk, its side and number; null off a line. */
function lineAt(target: EventTarget | null): { key: string; side: LineSide; line: number } | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const cell = element?.closest<HTMLElement>('[data-line][data-side]')
  const key = cell?.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.key
  const line = Number(cell?.dataset.line)
  const side = cell?.dataset.side
  if (key === undefined || !Number.isInteger(line) || line < 1 || (side !== 'old' && side !== 'new')) return null
  return { key, side, line }
}

/** A click on these is theirs, not a pick of the line. */
const OWN_CONTROLS = 'button, a, input, textarea, .w-cl, .w-pr-review-comment'

export type { PlacedComment }

export interface ReviewCommentsOptions {
  projectId: string
  repo: string
  number: number
  subject: ChangesPrRef | null
  draft: ReviewDraft | null
  /** The draft's comments may be changed: this machine holds the draft, it was read, and it is not submitted. */
  canChange: boolean
  /** The diff shown is All changes of the commit the draft is numbered on: the comments stand on their lines. */
  onLines: boolean
  /** New comments may be made and moved: canChange and onLines. */
  canAdd: boolean
  layout: DiffLayout
  /** Every file of the PR, filtered or not. */
  entries: readonly FileEntry[]
  /** The files were read without an error: a comment on a file not among them is not on a changed line. */
  filesRead: boolean
  generation: number
  /** Where the rows of the diff and the comments are looked for. */
  body: RefObject<HTMLElement | null>
  /** The draft main answered with after a change. */
  onAnswer: (answer: PrReviewDraftAnswer) => void
  onNotice: (text: string) => void
}

export interface ReviewCommentsLayer {
  diff: Pick<DiffPaneProps, 'renderGutter' | 'renderBelow' | 'isPicked' | 'lineEvents' | 'onFileRead'>
  /** The key `c`: the comment of the lines picked; false when it is not Review mode's to take. */
  commentKey: () => boolean
  /** The comments of the draft, in its order. */
  comments: readonly PlacedComment[]
  /** The comments on lines the diff of the PR lacks, known so far. */
  offLines: readonly PlacedComment[]
  /** «Not on a changed line» above the diff; null without such a comment. */
  offList: ReactNode
  /** What a comment listed apart from its lines shows (Edit, Delete). */
  listed: (placed: PlacedComment) => ReactNode
  /** The popover. */
  overlay: ReactNode
}

/** The hunk of each line of each side a file's diff has; `none` — no hunks at all (binary, too large for GitHub). */
type FileLines = { old: ReadonlyMap<number, number>; new: ReadonlyMap<number, number> } | 'none'

export function useReviewComments(options: ReviewCommentsOptions): ReviewCommentsLayer {
  const { projectId, repo, number, subject, draft, canChange, onLines, canAdd, layout, entries, filesRead, generation, body, onAnswer, onNotice } = options
  const saveKeys = shortcutLabel(SHORTCUTS.quoteSave)
  const comments = useMemo<PlacedComment[]>(() => (draft === null ? [] : draft.payload.comments.map((comment, index) => ({ index, comment, by: draft.anchors[index]?.by ?? 'person' }))), [draft])

  // ── which lines the diff has, for the files with comments ──
  const readFor = JSON.stringify([projectId, subject, generation])
  const [lines, setLines] = useState<{ of: string; map: ReadonlyMap<string, FileLines> }>({ of: readFor, map: new Map() })
  const known = lines.of === readFor ? lines.map : null
  // The hunks of All changes by file, read without -w and unfolded: the text of the lines a comment is made or moved on.
  const read = useRef<{ of: string; map: Map<string, FileDiff> }>({ of: readFor, map: new Map() })
  /** The reads asked for, by file: each file is read once per readFor. */
  const reading = useRef<{ of: string; map: Map<string, Promise<void>> }>({ of: readFor, map: new Map() })
  const keep = useCallback(
    (path: string, diff: FileDiff) => {
      const lineSets: FileLines = diff.kind === 'hunks' ? { old: sideHunks(diff.hunks, 'old'), new: sideHunks(diff.hunks, 'new') } : 'none'
      setLines((previous) => ({ of: readFor, map: new Map(previous.of === readFor ? previous.map : []).set(path, lineSets) }))
    },
    [readFor],
  )
  /**
   * Reads a file of All changes for the comments: without -w (Hide whitespace changes the lines a hunk has) and unfolded
   * (a lock, generated or too large file comes folded without `expand`, with no lines at all).
   */
  const readFile = (entry: FileEntry): Promise<void> => {
    if (reading.current.of !== readFor) reading.current = { of: readFor, map: new Map() }
    const asked = reading.current.map.get(entry.key)
    if (asked !== undefined) return asked
    const of = readFor
    const next =
      subject === null
        ? Promise.resolve()
        : invoke('changes.file', { projectId, subject, repo: entry.repo, scope: { kind: 'all' }, path: entry.file.path, oldPath: entry.file.oldPath, untracked: entry.file.untracked, hideWhitespace: false, expand: true }).then((result) => {
            if (reading.current.of !== of || !result.ok) return
            // A file main still answers folded has its lines unknown: neither on a changed line nor off one.
            if (result.value.file.kind === 'folded') return
            if (read.current.of !== of) read.current = { of, map: new Map() }
            read.current.map.set(entry.key, result.value.file)
            keep(entry.file.path, result.value.file)
          })
    reading.current.map.set(entry.key, next)
    return next
  }
  const readLatest = useRef(readFile)
  useEffect(() => {
    readLatest.current = readFile
  })
  const commented = [...new Set(comments.map(({ comment }) => comment.path))].sort().join('\n')
  useEffect(() => {
    if (subject === null || !canChange) return
    for (const path of commented === '' ? [] : commented.split('\n')) {
      const entry = entries.find((each) => each.file.path === path)
      if (entry !== undefined) void readLatest.current(entry)
    }
    // The paths with comments, the files and what they are read for start a read; readFile asks once per readFor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commented, entries, readFor, canChange])
  const onFileRead = useCallback(
    (entry: FileEntry, diff: FileDiff, readOf: FileReadOf) => {
      // A read with -w has other hunks, a folded one no lines: the comments read the file themselves (readFile).
      if (readOf.scope.kind !== 'all' || readOf.hideWhitespace || readOf.generation !== generation || diff.kind === 'folded') return
      if (read.current.of !== readFor) read.current = { of: readFor, map: new Map() }
      read.current.map.set(entry.key, diff)
    },
    [generation, readFor],
  )

  /**
   * Whether the comment is on lines the diff of the PR lacks, or on a range across hunks (GitHub: «start_line must be
   * part of the same hunk as the line»); a file not read yet is not known to be.
   */
  const isOff = (comment: ReviewComment): boolean => {
    if (!entries.some((entry) => entry.file.path === comment.path)) return filesRead
    const file = known?.get(comment.path)
    if (file === undefined) return false
    if (file === 'none') return true
    const hunkOf = (side: ReviewComment['side'], at: number): number | undefined => file[lineSideOf(side)].get(at)
    const last = hunkOf(comment.side, comment.line)
    if (last === undefined) return true
    return comment.start_line !== undefined && hunkOf(comment.start_side ?? comment.side, comment.start_line) !== last
  }
  const offLines = onLines ? comments.filter(({ comment }) => isOff(comment)) : []

  // ── the popover ──
  const [picked, setPicked] = useState<Picked | null>(null)
  const [popover, setPopover] = useState<LinePopover | null>(null)
  const popoverNow = useRef<LinePopover | null>(null)
  const putPopover = useCallback((next: LinePopover | null | ((open: LinePopover | null) => LinePopover | null)) => {
    popoverNow.current = typeof next === 'function' ? next(popoverNow.current) : next
    setPopover(popoverNow.current)
  }, [])
  /** The comment the popover edits, as main finds it again. */
  const [editing, setEditing] = useState<PlacedComment | null>(null)
  /** The comment Move to line waits to put on the next line taken. */
  const [moving, setMoving] = useState<PlacedComment | null>(null)
  const [saving, setSaving] = useState(false)

  /** Whether the popover open now holds text not saved: another one does not replace it then. */
  const keepsOpen = (): boolean => {
    const open = popoverNow.current
    if (open === null || open.text.trim() === open.was.text.trim()) return false
    showToast({ kind: 'info', key: 'pr-review-comment-open', text: 'Save or cancel the comment you are writing first' })
    return true
  }

  /** The text of lines `from`…`to` of a side of a file, all of one hunk; null while the file is not read. */
  const codeOf = (key: string, side: LineSide, from: number, to: number): LinesOf | null => {
    const diff = read.current.of === readFor ? read.current.map.get(key) : undefined
    if (diff === undefined) return null
    if (diff.kind !== 'hunks') return { ok: false, why: 'This file has no lines to comment on in the diff of the PR' }
    const hunk = diff.hunks.find((each) => each.lines.some((line) => lineNumber(line, side) === to))
    if (hunk === undefined) return { ok: false, why: `Line ${to} is not in the diff of the PR` }
    // Within a hunk the numbers of a side follow each other: `from` in it means every line up to `to` is.
    const lines = sideLines([hunk], side)
    if (!lines.has(from)) return { ok: false, why: ACROSS_HUNKS }
    const code: string[] = []
    for (let at = from; at <= to; at += 1) code.push(lines.get(at) ?? '')
    return { ok: true, code: code.join('\n') }
  }
  /** codeOf, reading the file first when it is not read yet (Hide whitespace, a folded file, a Refresh). */
  const linesOf = async (key: string, side: LineSide, from: number, to: number): Promise<LinesOf> => {
    const now = codeOf(key, side, from, to)
    if (now !== null) return now
    const entry = entries.find((each) => each.key === key)
    if (entry !== undefined) await readFile(entry)
    return codeOf(key, side, from, to) ?? { ok: false, why: 'The lines of this file could not be read: press Refresh and try again' }
  }
  const refuse = (why: string) => showToast({ kind: 'info', key: 'pr-review-lines', text: why })

  const save = async (open: LinePopover, input: { ref?: ReviewCommentRef; comment: ReviewComment; anchor: string }): Promise<boolean> => {
    if (subject === null || saving) return false
    setSaving(true)
    try {
      const answer = await invoke('prReview.saveComment', { projectId, repo, number, head: subject.headOid, ...input })
      if (!answer.ok) {
        const reason = failureReason('prReview.saveComment', answer.error)
        if (popoverNow.current === open) putPopover({ ...open, error: reason })
        else onNotice(reason)
        return false
      }
      onAnswer(answer.value)
      draftChanged()
      return true
    } finally {
      setSaving(false)
    }
  }

  /** Move to line: the comment waiting goes on lines `from`…`to`, its text as it is. */
  const moveTo = async (key: string, side: LineSide, from: number, to: number) => {
    const placed = moving
    const entry = entries.find((each) => each.key === key)
    if (placed === null || entry === undefined) return
    const lines = await linesOf(key, side, from, to)
    if (!lines.ok) {
      refuse(lines.why)
      return
    }
    const comment: ReviewComment = { path: entry.file.path, line: to, side: sideOf(side), ...(to > from ? { start_line: from, start_side: sideOf(side) } : {}), body: placed.comment.body }
    setMoving(null)
    setPicked(null)
    void save({ id: null, key, path: entry.file.path, side, startLine: from, endLine: to, code: lines.code, text: '', images: [], reading: 0, error: null, was: { text: '', images: 0 } }, { ref: refOf(placed), comment, anchor: lines.code })
  }

  /** Opens the popover of a new comment on lines `from`…`to` of a side of a file, or moves the comment waiting there. */
  const openNew = async (key: string, side: LineSide, from: number, to: number) => {
    if (moving !== null) {
      await moveTo(key, side, from, to)
      return
    }
    if (keepsOpen()) return
    const entry = entries.find((each) => each.key === key)
    if (entry === undefined) return
    const lines = await linesOf(key, side, from, to)
    if (!lines.ok) {
      refuse(lines.why)
      return
    }
    // A popover opened while the file was read is not replaced.
    if (keepsOpen()) return
    setEditing(null)
    putPopover({ id: null, key, path: entry.file.path, side, startLine: from, endLine: to, code: lines.code, text: '', images: [], reading: 0, error: null, was: { text: '', images: 0 } })
  }

  /** «+» of a line: the range picked when the line is in it, else the line alone. */
  const openOn = (key: string, side: LineSide, line: number) => {
    if (!canAdd) return
    if (picked !== null && picked.key === key && picked.side === side && line >= range(picked).from && line <= range(picked).to) void openNew(key, side, range(picked).from, range(picked).to)
    else {
      setPicked({ key, side, start: line, end: line })
      void openNew(key, side, line, line)
    }
  }

  /** The lines of a comment as it stands: from its file's diff, when that has them all in one hunk. */
  const codeOfComment = (comment: ReviewComment, key: string): string | null => {
    const lines = codeOf(key, lineSideOf(comment.side), comment.start_line ?? comment.line, comment.line)
    return lines?.ok === true ? lines.code : null
  }

  const openEdit = (placed: PlacedComment) => {
    if (!canChange || keepsOpen()) return
    const { comment } = placed
    setEditing(placed)
    setMoving(null)
    const entry = entries.find((each) => each.file.path === comment.path)
    const key = entry?.key ?? ''
    // The text kept with the comment; an agent keeps none for the old side and for a file git did not give it, so the
    // diff's text stands in. It is taken now: the index of the comment shifts when another one is deleted meanwhile.
    const stored = draft?.anchors[placed.index]?.text ?? ''
    const code = stored !== '' ? stored : (codeOfComment(comment, key) ?? '')
    putPopover({
      id: String(placed.index),
      key,
      path: comment.path,
      side: lineSideOf(comment.side),
      startLine: comment.start_line ?? comment.line,
      endLine: comment.line,
      code,
      text: comment.body,
      images: [],
      reading: 0,
      error: null,
      was: { text: comment.body, images: 0 },
    })
  }

  const remove = (placed: PlacedComment) => {
    if (!canChange) return
    void invoke('prReview.deleteComment', { projectId, repo, number, ref: refOf(placed) }).then((answer) => {
      if (!answer.ok) {
        onNotice(failureReason('prReview.deleteComment', answer.error))
        return
      }
      if (editing?.index === placed.index) {
        setEditing(null)
        putPopover(null)
      }
      setMoving((was) => (was?.index === placed.index ? null : was))
      onAnswer(answer.value)
      draftChanged()
    })
  }

  const saveOpen = async () => {
    const open = popoverNow.current
    if (open === null || open.text.trim() === '' || !canChange) return
    const text = open.text.trim()
    const edited = editing
    let input: { ref?: ReviewCommentRef; comment: ReviewComment; anchor: string }
    if (edited !== null) {
      // The lines captured at Edit; with none known (a comment off the diff, its file not read yet), empty lines as many
      // as it covers: main takes an anchor of exactly its lines.
      const size = edited.comment.line - (edited.comment.start_line ?? edited.comment.line) + 1
      const anchor = open.code !== '' ? open.code : '\n'.repeat(size - 1)
      input = { ref: refOf(edited), comment: { ...edited.comment, body: text }, anchor }
    } else {
      if (!canAdd) return
      const side = sideOf(open.side)
      input = { comment: { path: open.path, line: open.endLine, side, ...(open.endLine > open.startLine ? { start_line: open.startLine, start_side: side } : {}), body: text }, anchor: open.code }
    }
    if (!(await save(open, input))) return
    setEditing(null)
    if (popoverNow.current === open) putPopover(null)
    setPicked(null)
  }

  /** Suggest change: a `suggestion` block replaces lines of the new side, so it is offered there only. */
  const suggest = () =>
    putPopover((open) => {
      if (open === null) return open
      const block = `\`\`\`suggestion\n${open.code}\n\`\`\``
      return { ...open, text: open.text.trim() === '' ? block : `${open.text.replace(/\s+$/u, '')}\n\n${block}` }
    })

  // ── the diff's parts ──
  const offSet = new Set(offLines.map(({ index }) => index))
  const listed = (placed: PlacedComment): ReactNode => (
    <DraftComment
      key={placed.index}
      placed={placed}
      repo={repo}
      where={whereOf(placed.comment)}
      onEdit={canChange ? () => openEdit(placed) : null}
      onDelete={canChange ? () => remove(placed) : null}
      onMove={canAdd && offSet.has(placed.index) ? () => setMoving(placed) : null}
      submitted={draft?.state === 'submitted'}
    />
  )
  const renderGutter = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    const at = lineNumber(line, side)
    if (!canAdd || at === null) return null
    return (
      <button
        type="button"
        className="w-cl__plus nodrag"
        aria-label={`${moving === null ? 'Comment on' : 'Move the comment to'} line ${at} of ${entry.file.path}`}
        data-testid="changes-line-plus"
        onClick={(event) => {
          event.stopPropagation()
          openOn(entry.key, side, at)
        }}
      >
        +
      </button>
    )
  }
  const renderBelow = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    if (!onLines) return null
    const here = comments.filter(({ comment, index }) => !offSet.has(index) && comment.path === entry.file.path && commentOnLine(comment, line, side, layout))
    if (here.length === 0) return null
    return here.map((placed) => (
      <DraftComment key={placed.index} placed={placed} repo={repo} onEdit={canChange ? () => openEdit(placed) : null} onDelete={canChange ? () => remove(placed) : null} submitted={draft?.state === 'submitted'} />
    ))
  }
  const isPicked = (line: DiffLine, side: LineSide, entry: FileEntry): boolean => {
    if (picked === null || picked.key !== entry.key || picked.side !== side) return false
    const at = lineNumber(line, side)
    return at !== null && at >= range(picked).from && at <= range(picked).to
  }
  const lineEvents: ReviewCommentsLayer['diff']['lineEvents'] = {
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!canAdd || (event.target as Element).closest?.(OWN_CONTROLS)) return
      // A drag that selected text is a pick of its own (onMouseUp).
      if (globalThis.getSelection?.()?.isCollapsed === false) return
      const at = lineAt(event.target)
      if (at === null) return
      if (event.shiftKey && picked !== null && picked.key === at.key && picked.side === at.side) setPicked({ ...picked, end: at.line })
      else setPicked({ key: at.key, side: at.side, start: at.line, end: at.line })
    },
    onMouseUp: () => {
      if (!canAdd) return
      const selection = globalThis.getSelection?.()
      if (selection == null || selection.isCollapsed) return
      const from = lineAt(selection.anchorNode)
      const to = lineAt(selection.focusNode)
      if (from === null || to === null || from.key !== to.key || from.side !== to.side || from.line === to.line) return
      setPicked({ key: from.key, side: from.side, start: from.line, end: to.line })
    },
  }

  const commentKey = (): boolean => {
    if (!canAdd) return false
    if (picked === null) {
      showToast({ kind: 'info', key: 'pr-review-pick-hint', text: 'Click a line first, then press c' })
      return true
    }
    void openNew(picked.key, picked.side, range(picked).from, range(picked).to)
    return true
  }

  // ── drawing ──
  const anchorOf = (open: LinePopover): Element | null => {
    if (open.id !== null) return body.current?.querySelector(`[data-testid="pr-review-comment"][data-index="${open.id}"]`) ?? null
    const hunks = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-testid="changes-hunk"]') ?? []).filter((each) => each.dataset.key === open.key)
    for (const hunk of hunks) {
      const cell = hunk.querySelector(`[data-side="${open.side}"][data-line="${open.endLine}"]`)
      if (cell !== null) return cell
    }
    return null
  }
  const overlay =
    popover !== null && canChange ? (
      <LineCommentPopover
        key={popover.id ?? `new:${popover.key}:${popover.side}:${popover.startLine}`}
        popover={popover}
        saveKeys={saveKeys}
        anchor={() => anchorOf(popover)}
        placeholder="Markdown. It goes into your review draft, not to GitHub."
        onText={(text) => putPopover((open) => open && { ...open, text })}
        onSave={() => void saveOpen()}
        onCancel={() => {
          setEditing(null)
          putPopover(null)
        }}
        onDelete={popover.id === null || editing === null ? null : () => remove(editing)}
        onSuggest={popover.code === '' || popover.side !== 'new' ? undefined : suggest}
      />
    ) : null

  const offList =
    offLines.length === 0 && moving === null ? null : (
      <section className="w-pr-review-off w-pr-review-off--lines" data-testid="pr-review-not-on-line" aria-label="Not on a changed line">
        {offLines.length > 0 ? (
          <p>
            <b>Not on a changed line</b> <span className="w-mono w-changes__muted">{offLines.length}</span>
            <span className="w-changes__muted"> · GitHub refuses these; move one to a changed line or delete it. It is not posted until then.</span>
          </p>
        ) : null}
        {moving !== null ? (
          <p className="w-pr-review-moving" role="status" data-testid="pr-review-moving">
            Click a changed line&apos;s «+», or pick lines and press c: the comment <span className="w-mono">{whereOf(moving.comment)}</span> moves there.{' '}
            <button type="button" className="w-changes__link" data-testid="pr-review-moving-cancel" onClick={() => setMoving(null)}>
              Cancel
            </button>
          </p>
        ) : null}
        {offLines.map(listed)}
      </section>
    )

  return { diff: { renderGutter, renderBelow, isPicked, lineEvents, onFileRead }, commentKey, comments, offLines, offList, listed, overlay }
}
