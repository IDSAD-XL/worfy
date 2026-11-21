import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import type { z } from 'zod'
import type { Attachment } from '../../shared/agent/attachments'
import type { ChangedFile, ChangesScope, DiffHunk, DiffLine, FileDiff } from '../../shared/changes/types'
import type { changesTargetSchema } from '../../shared/ipc/changes'
// The channels Send starts a Session with must be declared in this window too (ipc.ts).
import '../../shared/ipc/orchestrator'
import '../../shared/ipc/sessions'
import { SHORTCUTS } from '../../shared/shortcuts'
import { invoke } from '../ipc'
import { readCommentImage } from '../session/comment-image'
import { anchorLines, composeRound, imageRefusal, inTextOrder, LINE_CHANGED, type CodeComment, type CommentImage } from '../session/quote-comments'
import { addDraft, editDraft, imageDataOf, keepImageData, markPending, quoteKey, readQuotes, removeDrafts, useQuotes } from '../session/quote-store'
import { label as shortcutLabel } from '../shortcuts/match'
import { ContextMenu } from '../theme/kit/ContextMenu'
import { MenuItem } from '../theme/kit/Menu'
import { dismissToast, showToast } from '../toast/toasts'
import type { DiffPaneHandle, DiffPaneProps, FileReadOf, LineSide } from './DiffPane'
import { lineNumber, type FileEntry } from './diff-window'
import { LineCommentBox, LineCommentPopover, SentLineBox, type LinePopover } from './LineComment'
import { lineAt, pickRange, useLinePick } from './line-pick'
import { addSeenHeads, seenHead, seenHeadsKey } from './seen-heads'
import { lineRequestFor, useLineRequests, type ChangesSubject } from './open'
import type { RepoList, RepoScopes } from './ScopeBar'
import { addSentLines, sentLinesKey, useSentLines, type SentLine } from './sent-lines'
import { Tray } from './Tray'

// The comments on lines of the Changes view (worfy-changes-view tickets 05 and 08; the spec's part on comments on lines): what
// the diff, the popover, the tray and the list «To» do together.
//
// - A comment is made on a line or a range of one file and one side (line-pick.tsx, ticket 09): «+» in the gutter of a
//   line under the pointer, dragged over lines for a range; the key `c` or the hint under the lines picked (a click picks
//   a line, a click with Shift, Shift with «+» or a selection across lines picks a range); or Comment in the right
//   click's menu. The popover takes its text and images; it goes into the store of the Session
//   in «To» (session/quote-store.ts, quoteKey), the store that Session's input field lists too.
// - «To» is main's list (`changes.targets`, src/main/changes/targets.ts): the Sessions bound to the Ticket and the
//   Orchestrator; its default is main's (Q2) until the Session shown holds comments or takes a Send: «To» keeps it
//   then. A Session that never reported its id keeps its comments under NOT_STARTED until it does; they move to its id
//   then. Another Session picked takes the comments on code of this Ticket with it; the comments on its messages stay
//   with each Session.
// - Send does what that Session's Send does (SessionView.tsx): starts it when it runs no more, composes the round
//   (composeRound) and sends it with `agent.send`, where a busy agent's queue keeps it; the round waits for its prompt
//   (markPending). The comments on lines that went stay dim on their lines (sent-lines.ts). While it runs, «To», the
//   tray's field, Edit and removing a comment are locked.
// - After a Refresh each comment not sent yet is looked for again in its file's lines (anchorLines), in the reads of
//   the scope and Hide whitespace the Refresh was pressed in, and only a comment on the commit that read shows on its
//   side (the work tree for null); one whose lines are gone is marked «Line changed» and stays in the tray. On the new
//   side of All changes and Compare against a comment on no commit or on a head of the Ticket this view has read is
//   looked for too, and takes the commit of the new read: the agent committed its file, or edited it again (ticket 09).
// - A popover with text or images not saved yet stays open: «+», `c`, Comment and Edit do not replace it.
// - A read-only screen (a Linked machine with Read only, ADR-0066) shows no «+», no `c`, no Comment and no tray: the diff
//   reads as it is.

export type ChangesTarget = z.infer<typeof changesTargetSchema>

/** The Session id the comments of a Session that has not reported its own yet are kept under. */
export const NOT_STARTED = 'not-started'

/** How long Undo of a deletion is offered, in ms. */
const UNDO_MS = 6000

const nn = (num: number): string => String(num).padStart(2, '0')
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

let made = 0
/** A new comment's id: unique in this window, and across restarts by the time. */
const newId = (): string => `c${Date.now().toString(36)}${(made += 1).toString(36)}`

/** The sha256 of base64 bytes in hex: the ref main names its copy of an image by (agent/attachments.ts, imageRef). */
async function refOf(data: string): Promise<string> {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Copies text, quietly: a refused clipboard only goes to the console. */
function copy(text: string): void {
  void globalThis.navigator?.clipboard?.writeText(text).catch((error: unknown) => console.error('[changes] copy failed', error))
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

/** A side of a file as anchorLines reads it: the lines the diff shows at their numbers, a line that matches none between them. */
function sideText(hunks: readonly DiffHunk[], side: LineSide): string {
  const lines = sideLines(hunks, side)
  const last = Math.max(0, ...lines.keys())
  return Array.from({ length: last }, (_, index) => lines.get(index + 1) ?? '\u0000').join('\n')
}

/** A view of the diff, as the reads of one compare: the scope and Hide whitespace. */
const viewOf = (scope: ChangesScope, hideWhitespace: boolean): string => JSON.stringify([scope, hideWhitespace])

/** What a comment of a repository names: its checkout and worktree, its branch, and the commit each side was read at. */
interface RepoFacts {
  repository: string
  worktree: string
  branch: string
  commit: (side: LineSide, file: Pick<ChangedFile, 'uncommitted'>) => string | null
}

const hex = (sha: string | null | undefined): string | null => (typeof sha === 'string' && /^[0-9a-f]{4,64}$/u.test(sha) ? sha : null)

/**
 * The commit the lines of a side of a file were read at, for the scope: null for the work tree, not committed yet.
 * All changes and Compare against: the new side of a file with uncommitted edits in a worktree is the work tree, of
 * any other file the head (`headSha`; worfy-changes-view ticket 09, D3: in a clean worktree every line is in HEAD);
 * the old side is the base. Uncommitted: the work tree against HEAD. Commit: that commit, on both sides. A file of an
 * answer that does not say (a build before ticket 09) is taken as uncommitted in a worktree, as before.
 */
function commitOf(scope: ChangesScope, side: LineSide, file: Pick<ChangedFile, 'uncommitted'>, scopes: RepoScopes | undefined, list: RepoList | undefined): string | null {
  const head = list?.headSha ?? scopes?.headSha ?? null
  if (scope.kind === 'commit') return hex(scope.sha)
  if (scope.kind === 'uncommitted') return side === 'new' ? null : hex(head)
  if (side === 'new') return list?.workTree === true && file.uncommitted !== false ? null : hex(head)
  return hex(list?.base?.mergeBase ?? scopes?.base?.mergeBase) ?? hex(head)
}

export interface LineCommentsOptions {
  projectId: string
  subject: ChangesSubject
  scope: ChangesScope
  /** The answer of `changes.scopes` and of `changes.list`, per repository. */
  scopes: readonly RepoScopes[]
  lists: readonly RepoList[] | undefined
  /** The files, in the order of the tree. */
  entries: readonly FileEntry[]
  /** Why nothing can be commented on (a read-only screen); null when it can. */
  readOnly: string | null
  pane: RefObject<DiffPaneHandle | null>
  /** The view's body: where the rows of the diff are looked for. */
  body: RefObject<HTMLElement | null>
  /** The view's Hide whitespace: with the scope, the view a Refresh is pressed in. */
  hideWhitespace: boolean
  /** Grows with every Refresh: the comments are looked for again in the lines read after it. */
  generation: number
}

export interface LineCommentsLayer {
  /** What the diff draws and hears (DiffPane.tsx). */
  diff: Pick<DiffPaneProps, 'renderGutter' | 'renderBelow' | 'isPicked' | 'lineEvents' | 'onFileRead'>
  /** The key `c`: the comment of the lines picked; false when it is not the view's to take. */
  commentKey: () => boolean
  /** Escape: true when it took the lines picked away (the view stays then). */
  clearPick: () => boolean
  /** The tray at the bottom of the view; null on a read-only screen and without a Session to send to. */
  tray: ReactNode
  /** The popover and the menu of a line. */
  overlay: ReactNode
}

/** A click on these is theirs, not a pick of the line. */
const OWN_CONTROLS = 'button, a, input, textarea, .w-cl'

export function useLineComments({ projectId, subject, scope, scopes, lists, entries, readOnly, pane, body, hideWhitespace, generation }: LineCommentsOptions): LineCommentsLayer {
  const saveKeys = shortcutLabel(SHORTCUTS.quoteSave)

  // ── «To» ──────────────────────────────────────────────────────────────────────────────────
  const [answer, setAnswer] = useState<{ targets: ChangesTarget[]; defaultNodeId: string | null; autopilot: boolean } | null>(null)
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    if (readOnly !== null) return
    let current = true
    void invoke('changes.targets', { projectId, ticket: { epic: subject.epic, num: subject.num } }).then((result) => {
      if (!current) return
      if (!result.ok) {
        console.error('[changes] changes.targets failed:', result.error)
        return
      }
      const value = result.value as Partial<typeof result.value> | undefined
      setAnswer({ targets: Array.isArray(value?.targets) ? value.targets : [], defaultNodeId: value?.defaultNodeId ?? null, autopilot: value?.autopilot === true })
    })
    return () => {
      current = false
    }
  }, [projectId, subject.epic, subject.num, readOnly, generation, asked])
  const targets = useMemo(() => answer?.targets ?? [], [answer])
  // The Session «To» keeps: the one the user picked, or the one shown once it held comments or took a Send. Main's
  // default may name another Session on the next read of the list (a Refresh, after a Send); «To» does not follow it
  // then, or the comments would stay in the store of a Session the tray no longer shows.
  const [chosen, setChosen] = useState<string | null>(null)
  const target = targets.find((each) => each.nodeId === chosen) ?? targets.find((each) => each.nodeId === answer?.defaultNodeId) ?? targets[0] ?? null
  const storeKey = target === null ? null : quoteKey(projectId, target.nodeId, target.sessionId ?? NOT_STARTED)
  const quotes = useQuotes(storeKey)
  const all = quotes.drafts
  if (chosen === null && target !== null && all.length > 0) setChosen(target.nodeId)
  const ordered = useMemo(() => inTextOrder(all), [all])
  const isMine = useCallback((comment: { kind?: string; subject?: CodeComment['subject'] }): comment is CodeComment => comment.kind === 'code' && comment.subject?.epic === subject.epic && Number(comment.subject.number) === subject.num, [subject.epic, subject.num])
  const mine = useMemo(() => all.filter(isMine), [all, isMine])
  const sentKey = sentLinesKey(projectId, subject.epic, subject.num)
  const sent = useSentLines(sentKey)
  const canComment = readOnly === null && target !== null

  // The comments a Session kept before it reported its id go to its id once it has.
  useEffect(() => {
    if (target === null || target.sessionId === null || storeKey === null) return
    const early = quoteKey(projectId, target.nodeId, NOT_STARTED)
    const waiting = readQuotes(early).drafts
    if (waiting.length === 0) return
    removeDrafts(early, waiting.map((each) => each.id))
    for (const each of waiting) addDraft(storeKey, each)
  }, [projectId, target, storeKey])

  /** Another Session in «To»: the comments on code of this Ticket go with the choice. */
  const pickTarget = (nodeId: string) => {
    const next = targets.find((each) => each.nodeId === nodeId)
    if (next === undefined || next.nodeId === target?.nodeId) return
    const nextKey = quoteKey(projectId, next.nodeId, next.sessionId ?? NOT_STARTED)
    if (storeKey !== null && mine.length > 0) {
      removeDrafts(storeKey, mine.map((each) => each.id))
      for (const each of mine) addDraft(nextKey, each)
    }
    setChosen(nodeId)
  }

  // ── the files' lines ──────────────────────────────────────────────────────────────────────
  const read = useRef(new Map<string, FileDiff>())
  const facts = useCallback(
    (repo: string): RepoFacts => {
      const scoped = scopes.find((each) => each.repo === repo)
      const list = lists?.find((each) => each.repo === repo)
      return {
        repository: scoped?.checkout ?? repo,
        worktree: scoped?.worktree ?? '',
        branch: list?.branch ?? scoped?.branch ?? '',
        commit: (side, file) => commitOf(scope, side, file, scoped, list),
      }
    },
    [scopes, lists, scope],
  )
  const entryOf = useCallback((key: string) => entries.find((each) => each.key === key), [entries])
  /** Whether a comment is on a file of this entry: its repository (or the repository's name) and its path. */
  const onEntry = useCallback((comment: Pick<CodeComment, 'repository' | 'path'>, entry: FileEntry) => comment.path === entry.file.path && (comment.repository === entry.repo || comment.repository === facts(entry.repo).repository), [facts])

  // The heads of the repositories this view has read, kept per Ticket across a restart (seen-heads.ts): a comment on one
  // of them is on lines of this Ticket's work tree, and after the agent commits again it is looked for in the new read
  // (onFileRead).
  const headsKey = seenHeadsKey(projectId, subject.epic, subject.num)
  useEffect(() => {
    addSeenHeads(
      headsKey,
      (lists ?? []).flatMap((each) => (hex(each.headSha) === null ? [] : [{ repo: each.repo, sha: each.headSha }])),
    )
  }, [lists, headsKey])

  // ── the lines picked ──────────────────────────────────────────────────────────────────────
  const [popover, setPopover] = useState<LinePopover | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; key: string; side: LineSide; block: string | null; line: number; text: string | null } | null>(null)
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set())
  // Send is on its way: «To», the tray's field, Edit and removing a comment wait for it (Send below).
  const [sending, setSending] = useState(false)
  // The popover as it is now, ahead of the next render: reading images is async.
  const popoverNow = useRef<LinePopover | null>(null)
  const putPopover = useCallback((next: LinePopover | null | ((open: LinePopover | null) => LinePopover | null)) => {
    popoverNow.current = typeof next === 'function' ? next(popoverNow.current) : next
    setPopover(popoverNow.current)
  }, [])

  /**
   * Whether the popover open now holds what Save has not kept: text or images other than the comment had, or an image
   * being read. Another popover does not replace it then; the user saves or cancels it first.
   */
  const keepsOpen = (): boolean => {
    const open = popoverNow.current
    if (open === null || (open.text.trim() === open.was.text.trim() && open.images.length === open.was.images && open.reading === 0)) return false
    showToast({ kind: 'info', key: 'changes-comment-open', text: 'Save or cancel the comment you are writing first' })
    return true
  }

  /** Opens the popover of a new comment on lines `from`…`to` of a side of a file; they have to be read and next to each other. */
  const openNew = (key: string, side: LineSide, from: number, to: number) => {
    if (keepsOpen()) return
    const entry = entryOf(key)
    const diff = read.current.get(key)
    if (entry === undefined || diff?.kind !== 'hunks') return
    const lines = sideLines(diff.hunks, side)
    const code: string[] = []
    let end = from
    for (let at = from; at <= to && lines.has(at); at += 1) {
      code.push(lines.get(at)!)
      end = at
    }
    if (code.length === 0) return
    setMenu(null)
    putPopover({ id: null, key, path: entry.file.path, side, startLine: from, endLine: end, code: code.join('\n'), text: '', images: [], reading: 0, error: null, was: { text: '', images: 0 } })
  }

  const pick = useLinePick({
    enabled: canComment,
    commenting: popover !== null,
    open: openNew,
    held: keepsOpen,
    ownControls: OWN_CONTROLS,
    toastKey: 'changes-pick-hint',
    plusLabel: (line, path) => `Comment on line ${line} of ${path}`,
  })
  const { picked, setPicked, openOn } = pick

  const openEdit = (comment: CodeComment) => {
    // A comment is not edited while Send takes it: the message would go with the text it had.
    if (sending || keepsOpen()) return
    const entry = entries.find((each) => onEntry(comment, each))
    putPopover({
      id: comment.id,
      key: entry?.key ?? '',
      path: comment.path,
      side: comment.side,
      startLine: comment.startLine,
      endLine: comment.endLine,
      code: comment.code,
      text: comment.text,
      images: comment.images,
      reading: 0,
      error: null,
      was: { text: comment.text, images: comment.images.length },
    })
  }

  const remove = (ids: readonly string[]) => {
    // While Send runs the round is taken: a comment removed and then put back by Undo would wait twice.
    if (storeKey === null || sending) return
    const gone = removeDrafts(storeKey, ids)
    if (gone.length === 0) return
    putPopover((open) => (open !== null && open.id !== null && ids.includes(open.id) ? null : open))
    const key = storeKey
    const toast = showToast({
      kind: 'action',
      key: `changes-undo:${key}`,
      text: gone.length === 1 ? 'Comment deleted' : `${plural(gone.length, 'comment')} cleared`,
      testId: 'changes-undo-toast',
      actions: [{ label: 'Undo', run: () => gone.forEach((each) => addDraft(key, each)) }],
    })
    setTimeout(() => dismissToast(toast), UNDO_MS)
  }

  const save = () => {
    const open = popoverNow.current
    if (open === null || storeKey === null) return
    if (open.text.trim() === '' && open.images.length === 0) return
    if (open.id !== null) {
      if (sending) {
        putPopover({ ...open, error: 'Send is taking this comment with the text it had; it cannot change now.' })
        return
      }
      editDraft(storeKey, open.id, { text: open.text.trim(), images: open.images })
      putPopover(null)
      return
    }
    const entry = entryOf(open.key)
    if (entry === undefined) return
    const repo = facts(entry.repo)
    const comment: CodeComment = {
      kind: 'code',
      id: newId(),
      path: open.path,
      repository: repo.repository,
      side: open.side,
      startLine: open.startLine,
      endLine: open.endLine,
      code: open.code,
      commit: repo.commit(open.side, entry.file),
      subject: { kind: 'ticket', epic: subject.epic, number: nn(subject.num) },
      worktree: repo.worktree,
      branch: repo.branch,
      text: open.text.trim(),
      images: open.images,
      at: Date.now(),
    }
    if (!addDraft(storeKey, comment)) {
      putPopover({ ...open, error: 'This comment could not be kept: its file or commit does not read.' })
      return
    }
    putPopover(null)
    setPicked(null)
  }

  /** The live Session of the target: started when it runs no more, as its Node's Start does; its id for `agent.*`. */
  const liveSession = async (to: ChangesTarget): Promise<{ id: string } | { error: string }> => {
    const result = to.kind === 'orchestrator' ? await invoke('orchestrator.open', { projectId }) : await invoke('sessions.start', { projectId, nodeId: to.nodeId })
    if (!result.ok) return { error: result.error }
    const id = result.value.sessionId
    return id === null ? { error: `${to.title} did not start` } : { id }
  }

  /** Images from a file, a paste or a drop, scaled and checked by main within the limits, as a comment on a quote takes them. */
  const addImages = async (files: readonly File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (popoverNow.current === null || target === null) return
    if (files.length > 0 && images.length === 0) {
      putPopover((open) => open && { ...open, error: 'Only images can be attached here.' })
      return
    }
    const live = await liveSession(target)
    if ('error' in live) {
      putPopover((open) => open && { ...open, error: `Images cannot be attached: ${live.error}` })
      return
    }
    for (const file of images) {
      const open = popoverNow.current
      if (open === null) return
      const others = all.filter((each) => each.id !== open.id).reduce((sum, each) => sum + each.images.length, 0)
      const refused = imageRefusal(open.images.length + open.reading, others)
      if (refused !== null) {
        putPopover({ ...open, error: refused })
        return
      }
      putPopover({ ...open, reading: open.reading + 1, error: null })
      let image: CommentImage | null = null
      let error: string | null = null
      try {
        // main keeps a copy of the image: the comment names it by its ref, and no bytes go into the window's storage.
        const result = await invoke('agent.attach', { sessionId: live.id, sources: [await readCommentImage(file)], keep: true })
        const first = result.ok ? result.value.results[0] : undefined
        if (!result.ok) error = result.error
        else if (first === undefined) error = `${file.name || 'The image'} could not be attached.`
        else if (!first.ok) error = first.error
        else if (first.attachment.kind !== 'image') error = `${first.attachment.name} is not an image.`
        else {
          const { name, mediaType, size, data } = first.attachment
          const ref = await refOf(data)
          keepImageData(ref, data)
          image = { kind: 'image', name, mediaType, size, ref }
        }
      } catch (reason) {
        error = `${file.name || 'The image'} could not be read.`
        console.error('[changes] an image could not be read', reason)
      }
      putPopover((now) => (now !== null && now.id === open.id && now.key === open.key && now.startLine === open.startLine ? { ...now, reading: Math.max(0, now.reading - 1), images: image === null ? now.images : [...now.images, image], error: error ?? now.error } : now))
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────────────────────
  const [general, setGeneral] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    if (target === null || storeKey === null || sending) return
    // «To» is locked while Send runs (Tray.tsx): the round goes to this Session and waits in its store.
    const to = target
    const key = storeKey
    setSending(true)
    setError(null)
    try {
      const live = await liveSession(to)
      if ('error' in live) {
        setError(live.error)
        return
      }
      // The comments as the store holds them now: one removed while the Session started does not go.
      const drafts = readQuotes(key).drafts
      // The bytes of images this window did not read (before a restart) come back from main's copies.
      const missing = drafts.flatMap((each) => each.images).filter((image) => imageDataOf(image.ref) === undefined)
      if (missing.length > 0) {
        const result = await invoke('agent.attach', { sessionId: live.id, sources: missing.map((image) => ({ kind: 'kept' as const, name: image.name, ref: image.ref, mediaType: image.mediaType })) })
        if (!result.ok) {
          setError(result.error)
          return
        }
        for (const [index, back] of result.value.results.entries()) {
          const image = missing[index]
          if (image === undefined) continue
          if (!back.ok) {
            setError(back.error)
            return
          }
          if (back.attachment.kind === 'image') keepImageData(image.ref, back.attachment.data)
        }
      }
      const imageOf = (image: CommentImage): Attachment | undefined => {
        const data = imageDataOf(image.ref)
        return data === undefined ? undefined : { kind: 'image', name: image.name, mediaType: image.mediaType, size: image.size, data }
      }
      const composed = composeRound(drafts, { text: general, attachments: [] }, imageOf)
      if ('error' in composed) {
        setError(composed.error)
        return
      }
      const { text, attachments } = composed.message
      if (text.trim() === '' && attachments.length === 0) return
      const result = await invoke('agent.send', { sessionId: live.id, text, ...(attachments.length > 0 ? { attachments } : {}) })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const round = composed.round
      if (round.length > 0) markPending(key, { id: newId(), message: text, at: Date.now(), comments: [...round] })
      addSentLines(
        sentKey,
        round.filter(isMine).map((each): SentLine => ({ id: each.id, repository: each.repository, path: each.path, side: each.side, startLine: each.startLine, endLine: each.endLine, text: each.text, images: each.images.length, to: to.title, at: Date.now() })),
      )
      // The field was locked while Send ran (Tray.tsx): what it held is what went.
      setGeneral('')
      // A Session that took a Send stays in «To» when main's default turns to another one.
      setChosen((was) => was ?? to.nodeId)
      showToast({ kind: 'success', key: `changes-sent:${sentKey}`, text: round.length === 0 ? `Sent to ${to.title}` : `Sent ${plural(round.length, 'comment')} to ${to.title}`, testId: 'changes-sent-toast' })
      // The Session may report its id now: the list is read again.
      setAsked((value) => value + 1)
    } finally {
      setSending(false)
    }
  }

  // ── after a Refresh, the lines again ──────────────────────────────────────────────────────
  // The view a Refresh was pressed in: the scope and Hide whitespace the view showed when the count grew. Only the reads
  // of that view and that Refresh look for the comments again; a read of another scope, or with the other Hide
  // whitespace, shows other hunks and, in another scope, other line numbers.
  const [refreshedIn, setRefreshedIn] = useState({ generation, view: viewOf(scope, hideWhitespace) })
  if (refreshedIn.generation !== generation) setRefreshedIn({ generation, view: viewOf(scope, hideWhitespace) })
  const latest = useRef({ mine, storeKey, refreshedIn, onEntry, scopes, lists, headsKey })
  useEffect(() => {
    latest.current = { mine, storeKey, refreshedIn, onEntry, scopes, lists, headsKey }
  })
  const onFileRead = useCallback((entry: FileEntry, diff: FileDiff, readOf: FileReadOf) => {
    read.current.set(entry.key, diff)
    const { mine: drafts, storeKey: key, refreshedIn: refresh, onEntry: isOn, scopes: scoped, lists: listed, headsKey: seen } = latest.current
    if (refresh.generation === 0 || readOf.generation !== refresh.generation || viewOf(readOf.scope, readOf.hideWhitespace) !== refresh.view) return
    if (key === null || diff.kind !== 'hunks') return
    const scopesOf = scoped.find((each) => each.repo === entry.repo)
    const listOf = listed?.find((each) => each.repo === entry.repo)
    const ids = { lost: [] as string[], found: [] as string[] }
    for (const comment of drafts) {
      if (!isOn(comment, entry)) continue
      // A comment on lines of another commit than the one this read shows on its side belongs to another scope: its
      // lines are true at its commit, and stay as they are. On the new side of All changes and Compare against a comment
      // on the work tree or on a head of this Ticket read before follows the file: the agent committed it, or edited it
      // again, after the comment was made; it takes the commit of this read.
      const now = commitOf(readOf.scope, comment.side, entry.file, scopesOf, listOf)
      const follows = comment.side === 'new' && (readOf.scope.kind === 'all' || readOf.scope.kind === 'compare') && (comment.commit === null || seenHead(seen, entry.repo, comment.commit))
      if (comment.commit !== now && !follows) continue
      const lines = sideLines(diff.hunks, comment.side)
      const at = anchorLines(sideText(diff.hunks, comment.side), comment)
      if ('mark' in at && at.mark === LINE_CHANGED) {
        // Lines this view does not show are no news: they may stand there unchanged.
        let shown = true
        for (let number = comment.startLine; number <= comment.endLine; number += 1) shown &&= lines.has(number)
        if (shown) ids.lost.push(comment.id)
        continue
      }
      ids.found.push(comment.id)
      const moved = 'startLine' in at && at.startLine !== comment.startLine ? { startLine: at.startLine, endLine: at.endLine } : null
      if (moved !== null || comment.commit !== now) addDraft(key, { ...comment, ...moved, commit: now })
    }
    if (ids.lost.length === 0 && ids.found.length === 0) return
    setChanged((was) => {
      const next = new Set(was)
      for (const id of ids.found) next.delete(id)
      for (const id of ids.lost) next.add(id)
      return next
    })
  }, [])

  // ── a line asked for by a block of a sent message ─────────────────────────────────────────
  // The view handles a request once its files are read; another opening of the view drops it (open.ts).
  const request = useLineRequests((store) => store.request)
  const handled = useRef<number | null>(null)
  useEffect(() => {
    const asked = lineRequestFor(request, projectId, subject)
    if (asked === null || handled.current === asked.seq) return
    const entry = entries.find((each) => each.file.path === asked.path)
    if (entry === undefined) return
    handled.current = asked.seq
    pane.current?.scrollToLine(entry.key, asked.side, asked.line)
  }, [request, entries, projectId, subject, pane])

  const goTo = (comment: CodeComment) => {
    const entry = entries.find((each) => onEntry(comment, each))
    if (entry !== undefined) pane.current?.scrollToLine(entry.key, comment.side, comment.startLine)
  }

  // ── the diff's parts ──────────────────────────────────────────────────────────────────────
  const renderGutter = pick.plus
  const renderBelow = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    const number = lineNumber(line, side)
    if (readOnly !== null || number === null) return null
    const drafts = mine.filter((each) => each.side === side && each.endLine === number && onEntry(each, entry))
    const gone = sent.filter((each) => each.side === side && each.endLine === number && onEntry(each, entry) && !drafts.some((draft) => draft.id === each.id))
    const hint = pick.hint(line, side, entry)
    if (drafts.length === 0 && gone.length === 0 && hint === null) return null
    return (
      <>
        {hint}
        {gone.map((each) => (
          <SentLineBox key={each.id} text={each.text} imageCount={each.images} to={each.to} />
        ))}
        {drafts.map((each) => (
          <LineCommentBox key={each.id} comment={each} lineChanged={changed.has(each.id)} onEdit={() => openEdit(each)} onDelete={() => remove([each.id])} />
        ))}
      </>
    )
  }
  const isPicked = pick.isPicked
  const lineEvents: LineCommentsLayer['diff']['lineEvents'] = {
    ...pick.lineEvents,
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => {
      const at = lineAt(event.target)
      if (at === null || (event.target as Element).closest?.('.w-cl, .w-cl-hint')) return
      event.preventDefault()
      if (canComment && !(picked !== null && picked.key === at.key && picked.side === at.side && at.line >= pickRange(picked).from && at.line <= pickRange(picked).to)) setPicked({ key: at.key, side: at.side, block: at.block, start: at.line, end: at.line })
      const diff = read.current.get(at.key)
      setMenu({ x: event.clientX, y: event.clientY, ...at, text: diff?.kind === 'hunks' ? (sideLines(diff.hunks, at.side).get(at.line) ?? null) : null })
    },
  }


  // ── drawing ───────────────────────────────────────────────────────────────────────────────
  const rowOf = (key: string, side: LineSide, line: number): Element | null => {
    const hunks = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-testid="changes-hunk"]') ?? []).filter((each) => each.dataset.key === key)
    for (const hunk of hunks) {
      const cell = hunk.querySelector(`[data-side="${side}"][data-line="${line}"]`)
      if (cell !== null) return cell
    }
    return null
  }
  const menuLine = menu?.text ?? null
  const overlay = (
    <>
      <ContextMenu at={menu === null ? null : { x: menu.x, y: menu.y }} onClose={() => setMenu(null)} label="Line" testId="changes-line-menu" inNode>
        {canComment && menu !== null ? (
          <MenuItem testId="changes-menu-comment" onClick={() => openOn(menu.key, menu.side, menu.line, menu.block)}>
            Comment
          </MenuItem>
        ) : null}
        <MenuItem testId="changes-menu-copy" disabled={menuLine === null} onClick={() => menuLine !== null && copy(menuLine)}>
          Copy line
        </MenuItem>
      </ContextMenu>
      {popover !== null && canComment ? (
        <LineCommentPopover
          key={popover.id ?? `new:${popover.key}:${popover.side}:${popover.startLine}`}
          popover={popover}
          saveKeys={saveKeys}
          anchor={() => rowOf(popover.key, popover.side, popover.endLine)}
          onText={(text) => putPopover((open) => open && { ...open, text })}
          onRemoveImage={(index) => putPopover((open) => open && { ...open, images: open.images.filter((_, at) => at !== index) })}
          onFiles={(files) => void addImages(files)}
          onSave={save}
          onCancel={() => putPopover(null)}
          onDelete={popover.id === null ? null : () => remove([popover.id as string])}
        />
      ) : null}
    </>
  )

  const tray =
    readOnly !== null || targets.length === 0 ? null : (
      <Tray
        comments={ordered}
        changed={changed}
        targets={targets}
        target={target}
        onTarget={pickTarget}
        autopilot={answer?.autopilot === true}
        general={general}
        onGeneral={setGeneral}
        onGo={goTo}
        onRemove={remove}
        onSend={() => void send()}
        sending={sending}
        error={error}
        sendKeys={saveKeys}
      />
    )

  return { diff: { renderGutter, renderBelow, isPicked, lineEvents, onFileRead }, commentKey: pick.commentKey, clearPick: pick.clear, tray, overlay }
}
