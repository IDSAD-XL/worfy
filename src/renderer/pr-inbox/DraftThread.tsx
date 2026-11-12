// The drafts of replies of one PR in the Pull requests view (worfy-pr-inbox ticket 05, ADR-0105). Skill pr-reply
// writes them into a file on this machine; main reads it (`prInbox.drafts`). Under a thread: its draft in a field
// the user edits, and Send, Discard and Ask the Session to rewrite (off for a reply the user changed: the skill keeps
// the user's text). Send all opens a dialog with every text first; what it shows is what goes, whatever a read of the
// file brings meanwhile. The view keeps the typed text and what a call said by the reply's thread (in the
// conversation: by its text), never by its place in the file, which shifts when the Session writes the drafts again.
//
// Nothing here reaches GitHub by itself. The one way there is `prInbox.send`, called only from a click on Send or on
// Send all in the dialog, with the text shown in the field; main saves it, checks it again with review-draft-lint
// and posts it once. An edit is kept with `prInbox.saveDraft` when the field loses the focus; Discard is
// `prInbox.discard`. The drafts live on the machine of the Project only: a window of a Linked machine shows none.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import type { PrInboxComment, PrReplyDrafts, PrReplyItem, PrReplyRef, PrReplySendResult } from '../../shared/ipc/pr-inbox'
import { hasPreloadBridge, invoke, readableReason, windowMachine } from '../ipc'
import { Dialog } from '../theme/kit/Dialog'
import { CommentBody } from './CommentBody'

/** How often the drafts of an open PR are read again: the Session writes them while the user looks. */
const DRAFTS_POLL_MS = 5_000

/** Whether the window shows this Machine: in a window of a Linked machine the drafts stay on the machine of the Project. */
const draftsHere = (): boolean => windowMachine() === null

// ── the Session that drafted ─────────────────────────────────────────────────

/** The Session "Draft replies" started for each PR, by `<projectId> <owner/name>#<N>`, while this window lives. */
const useDraftSessions = create<{ byPr: Readonly<Record<string, string>> }>(() => ({ byPr: {} }))

const prKey = (projectId: string, repo: string, number: number): string => `${projectId} ${repo.toLowerCase()}#${number}`

/** "Draft replies": a new Session with skill pr-reply over the PR (`actions.prReply`); its id is kept for a rewrite. Undefined, or why it failed. */
async function draftReplies(projectId: string, repo: string, number: number): Promise<string | undefined> {
  const result = await invoke('actions.prReply', { projectId, repo, pr: number })
  if (!result.ok) return readableReason(result.error)
  useDraftSessions.setState(({ byPr }) => ({ byPr: { ...byPr, [prKey(projectId, repo, number)]: result.value.sessionId } }))
  return undefined
}

/** Where a reply goes, as the user reads it. */
function placeOf(item: Pick<PrReplyItem, 'kind'>, thread: { path: string | null; line: number | null } | undefined): string {
  if (item.kind === 'conversation') return 'Conversation'
  if (thread === undefined || thread.path === null) return 'Review thread'
  return thread.line === null ? thread.path : `${thread.path}:${thread.line}`
}

/** The message "Ask the Session to rewrite" sends to the Session that wrote the draft. */
function rewriteMessage(repo: string, number: number, place: string): string {
  return `Rewrite the draft reply for ${place} in ${repo}#${number}, keep the other replies as they are, and run pr-reply-draft again. Post nothing.`
}

// ── the drafts of one PR ─────────────────────────────────────────────────────

/** A shape check of an answer: a renderer has no zod, and a fake main may answer anything. */
const isDrafts = (value: unknown): value is PrReplyDrafts => typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)

/**
 * Something the view keeps of one reply between reads of the file — the text typed, what a Send said. Not by the
 * reply's place in the file: a Session that writes the drafts again keeps the edited ones first and appends the
 * others, so places shift. A reply in a review thread is its thread's; one in the conversation is the one holding one
 * of `texts`.
 */
interface Note {
  kind: PrReplyItem['kind']
  threadId: string | null
  /** The place the reply had when the note was made: of two that fit, this one. */
  index: number
  texts: readonly string[]
}

/** The reply of `items` a note is of; undefined when the file has it no more. */
function holder(note: Note, items: readonly PrReplyItem[]): PrReplyItem | undefined {
  const same = items.filter((item) => item.kind === note.kind && item.threadId === note.threadId)
  const texted = same.filter((item) => note.texts.includes(item.body))
  // A thread's draft the Session rewrote while the user typed is still that thread's draft.
  const pool = texted.length > 0 || note.kind === 'conversation' ? texted : same.filter((item) => item.state === 'draft')
  return pool.find((item) => item.index === note.index) ?? pool.find((item) => item.state === 'draft') ?? pool[0]
}

/** The text the user typed into a reply's field, over `base`, the draft's text it was typed over. */
interface Typed {
  kind: PrReplyItem['kind']
  threadId: string | null
  index: number
  base: string
  text: string
}

const typedNote = (typed: Typed): Note => ({ ...typed, texts: [typed.base, typed.text] })

/** What the last call about a reply said (a Send, or a refused save or discard), with the texts it was about. */
interface Said extends Note {
  result: PrReplySendResult
}

/** One reply as the view sends it: which one, the text it last read (`base`) and the text shown. */
const refOf = (item: PrReplyItem): PrReplyRef => ({ index: item.index, kind: item.kind, threadId: item.threadId, base: item.body })

interface PrReplyDraftsState {
  /** Undefined until main answered. */
  drafts: PrReplyDrafts | undefined
  /** Why the drafts could not be read. */
  error: string | null
  /** The text in a reply's field: the draft's own until the user types. */
  textOf: (item: PrReplyItem) => string
  setText: (item: PrReplyItem, text: string) => void
  /** A Send or a Discard runs: the buttons wait. */
  busy: boolean
  /** What the last call about the reply said; null when none did in this view. */
  resultOf: (item: PrReplyItem) => PrReplySendResult | null
  save: (item: PrReplyItem) => void
  discard: (item: PrReplyItem) => void
  /** Send of these replies, each with the text given: only on a click (Send, or Send all in its dialog). */
  send: (replies: readonly { item: PrReplyItem; text: string }[]) => void
  /** The Session "Draft replies" started for this PR, while it lives in this window; null otherwise. */
  session: string | null
}

/**
 * The drafts of `repo`#`number` of the Project: read now, every DRAFTS_POLL_MS and when the window gets the focus, as
 * long as the caller is mounted. A field the user typed in keeps the typed text over a new read.
 */
function usePrReplyDrafts(projectId: string, repo: string, number: number): PrReplyDraftsState {
  const [drafts, setDrafts] = useState<PrReplyDrafts | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState<readonly Typed[]>([])
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<readonly Said[]>([])
  const session = useDraftSessions((store) => store.byPr[prKey(projectId, repo, number)] ?? null)
  const live = useRef(true)
  const pull = { projectId, repo, number }
  const items = drafts?.items ?? []

  const take = useCallback((value: unknown): void => {
    if (!live.current) return
    if (isDrafts(value)) {
      setDrafts(value)
      setError(null)
    } else setError('The drafts came back in an unexpected shape')
  }, [])

  const load = useCallback((): void => {
    // Without the preload (a unit test of the view that sets none) there is no main to ask.
    if (!hasPreloadBridge()) return
    void invoke('prInbox.drafts', { projectId, repo, number }).then((result) => {
      if (!live.current) return
      if (result.ok) take(result.value)
      else setError(readableReason(result.error))
    })
  }, [projectId, repo, number, take])

  useEffect(() => {
    live.current = true
    load()
    const timer = setInterval(load, DRAFTS_POLL_MS)
    window.addEventListener('focus', load)
    return () => {
      live.current = false
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [load])

  const typedOf = (item: PrReplyItem): Typed | undefined => typed.find((each) => holder(typedNote(each), items) === item)
  const textOf = (item: PrReplyItem): string => typedOf(item)?.text ?? item.body

  /**
   * Main now holds `text` as the reply's text: a field whose text that is shows the draft's own again, so a later read
   * shows what the file holds; a field the user typed in meanwhile keeps the newer text, over `text`.
   */
  const kept = (item: PrReplyItem, text: string): void =>
    setTyped((current) =>
      current.flatMap((each) => {
        if (holder(typedNote(each), items) !== item) return [each]
        return each.text === text ? [] : [{ ...each, base: text }]
      }),
    )

  /** What a call said of these replies, under each of them, over what an earlier one said. */
  const note = (about: readonly { item: PrReplyItem; text: string; result: PrReplySendResult }[]): void =>
    setSaid((current) => {
      const fresh = about.map(({ item, text, result }): Said => ({ kind: item.kind, threadId: item.threadId, index: item.index, texts: [item.body, text], result }))
      const replaced = (old: Said): boolean => fresh.some((each) => each.kind === old.kind && each.threadId === old.threadId && (old.kind === 'thread' || each.texts.some((text) => old.texts.includes(text))))
      return [...current.filter((old) => !replaced(old)), ...fresh]
    })

  /** A whole call refused: its reason under each reply it was about, where a new read of the file does not wipe it. */
  const refused = (about: readonly { item: PrReplyItem; text: string }[], reason: string): void =>
    note(about.map(({ item, text }) => ({ item, text, result: { index: item.index, outcome: 'refused', reason, sentUrl: null } })))

  /** A call to main; `blocking` ones (Send, Discard) hold the buttons until it answers. A save never does: it runs on a blur, and the click that caused the blur must still reach its button. */
  const run = (call: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>, about: readonly { item: PrReplyItem; text: string }[], after: (value: unknown) => void, blocking: boolean): void => {
    if (blocking) setBusy(true)
    void call().then((result) => {
      if (!live.current) return
      if (blocking) setBusy(false)
      if (!result.ok) {
        refused(about, readableReason(result.error))
        return
      }
      after(result.value)
    })
  }

  return {
    drafts,
    error,
    textOf,
    setText: (item, text) =>
      setTyped((current) => {
        const mine = typedOf(item)
        return mine === undefined ? [...current, { kind: item.kind, threadId: item.threadId, index: item.index, base: item.body, text }] : current.map((each) => (each === mine ? { ...each, text } : each))
      }),
    busy,
    resultOf: (item) => said.find((each) => holder(each, items) === item)?.result ?? null,
    session,
    save: (item) => {
      const body = textOf(item)
      if (body === item.body) return
      run(
        () => invoke('prInbox.saveDraft', { ...pull, item: refOf(item), body }),
        [{ item, text: body }],
        (value) => {
          kept(item, body)
          take(value)
        },
        false,
      )
    },
    discard: (item) => {
      const body = textOf(item)
      run(
        () => invoke('prInbox.discard', { ...pull, item: refOf(item), body }),
        [{ item, text: body }],
        (value) => {
          kept(item, body)
          take(value)
        },
        true,
      )
    },
    send: (replies) => {
      if (replies.length === 0) return
      run(
        () => invoke('prInbox.send', { ...pull, items: replies.map(({ item, text }) => ({ ...refOf(item), body: text })) }),
        replies,
        (value) => {
          const answer = value as { results?: PrReplySendResult[]; drafts?: unknown }
          // The results come in the order of the replies sent.
          note(
            replies.flatMap(({ item, text }, at) => {
              const result = answer.results?.[at]
              return result === undefined ? [] : [{ item, text, result }]
            }),
          )
          for (const { item, text } of replies) kept(item, text)
          take(answer.drafts)
        },
        true,
      )
    },
  }
}

// ── one reply ────────────────────────────────────────────────────────────────

export interface DraftThreadProps {
  item: PrReplyItem
  /** Where the reply goes: `path:line` of its thread, or Conversation. */
  place: string
  /** The comments it answers, when they are not shown above it already; none by default. */
  comments?: readonly PrInboxComment[]
  /** The PR's repository, `owner/name`: a `#N` in a comment or a sent reply links into it (CommentBody.tsx). */
  repo?: string | null
  text: string
  busy: boolean
  /** What the last call about it said (a Send, a refused save or discard); null when none did in this view. */
  result: PrReplySendResult | null
  /** Why Send, Discard and Ask are off (the read-only hint); null when they are on. */
  disabled: string | null
  /** Why "Ask the Session to rewrite" is off; null when it is on. */
  rewriteOff: string | null
  onText: (text: string) => void
  /** The field lost the focus: the text is kept in the draft file. */
  onSave: () => void
  onSend: () => void
  onDiscard: () => void
  onAskRewrite: () => void
}

const draftStyles = {
  box: {
    marginTop: 'var(--space-2)',
    padding: 'var(--space-2)',
    border: '1px solid color-mix(in srgb, var(--primary) 35%, transparent)',
    borderRadius: 'var(--radius-node)',
    background: 'color-mix(in srgb, var(--primary) 4%, var(--surface))',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 },
  title: { fontWeight: 600, fontSize: 'var(--text-12)' },
  place: { marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  field: { width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-13)' },
  actions: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' },
  note: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  error: { margin: 0, color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  sentText: { marginTop: 'var(--space-1)', color: 'var(--text)' },
  bar: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' },
} satisfies Record<string, CSSProperties>

const LABEL_TEXT: Readonly<Record<string, string>> = { 'needs code change': 'Needs code change', 'needs answer': 'Needs answer', FYI: 'FYI', 'resolved by push': 'Resolved by push' }

/** The line under a reply: what the last call said — a post the draft file does not record too — or why the Send before did not post it. */
function resultLine(item: PrReplyItem, result: PrReplySendResult | null): { text: string; error: boolean } | null {
  if (result !== null && result.reason !== null) return { text: result.reason, error: result.outcome !== 'already-sent' }
  if (item.state === 'draft' && item.error !== null) return { text: item.error, error: true }
  return null
}

/** Why Send is off for a reply that is on GitHub already, though the draft file does not say so; null otherwise. */
function postedOff(result: PrReplySendResult | null): string | null {
  if (result === null || (result.outcome !== 'sent' && result.outcome !== 'already-sent')) return null
  return `Posted already${result.sentUrl !== null ? `: ${result.sentUrl}` : ''}`
}

/** A draft reply under its thread: the field, and Send, Discard, Ask the Session to rewrite; a sent one, its link. */
export function DraftThread({ item, place, comments = [], repo = null, text, busy, result, disabled, rewriteOff, onText, onSave, onSend, onDiscard, onAskRewrite }: DraftThreadProps) {
  const fieldId = useId()
  const line = resultLine(item, result)
  const empty = text.trim() === ''
  const posted = postedOff(result)
  return (
    <div style={draftStyles.box} data-testid="pr-draft" data-index={item.index} data-state={item.state} data-kind={item.kind} data-thread={item.threadId ?? undefined}>
      <div style={draftStyles.head}>
        <label htmlFor={fieldId} style={draftStyles.title}>
          Draft reply
        </label>
        <span className="w-pr-inbox-flag" data-testid="pr-draft-label">
          {LABEL_TEXT[item.label] ?? item.label}
        </span>
        {item.edited ? <span className="w-pr-inbox-flag">Edited</span> : null}
        <span className="w-mono" style={draftStyles.place} title={place}>
          {place}
        </span>
      </div>
      {comments.length > 0 ? (
        <ul className="w-pr-inbox-comments" aria-label="Comments it answers">
          {comments.map((comment) => (
            <li key={comment.id} className="w-pr-inbox-comment">
              <span className="w-pr-inbox-comment__meta">
                <span className="w-pr-inbox-comment__author">{comment.author ?? 'ghost'}</span>
              </span>
              <CommentBody body={comment.body} repo={repo} />
            </li>
          ))}
        </ul>
      ) : null}
      {item.state === 'sent' ? (
        <div style={draftStyles.note} data-testid="pr-draft-sent">
          Sent
          {item.sentUrl !== null ? (
            <>
              {' · '}
              <a
                href={item.sentUrl}
                className="w-pr-inbox-link"
                onClick={(event) => {
                  event.preventDefault()
                  void invoke('shell.openExternal', { url: item.sentUrl ?? '' })
                }}
              >
                View on GitHub
              </a>
            </>
          ) : null}
          {/* The sent text reads as GitHub shows it; the field above a draft stays the text as written. */}
          <div style={draftStyles.sentText} data-testid="pr-draft-sent-text">
            <CommentBody body={item.body} repo={repo} />
          </div>
        </div>
      ) : (
        <>
          <textarea
            id={fieldId}
            style={draftStyles.field}
            data-testid="pr-draft-field"
            value={text}
            rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
            readOnly={disabled !== null}
            onChange={(event) => onText(event.target.value)}
            onBlur={onSave}
          />
          {item.fixPlan !== null ? (
            <p style={draftStyles.note} data-testid="pr-draft-plan" title="A plan for you; it is never posted">
              Plan: {item.fixPlan}
            </p>
          ) : null}
          <div style={draftStyles.actions}>
            <button
              type="button"
              className="w-pr-inbox-button w-pr-inbox-button--primary"
              data-testid="pr-draft-send"
              disabled={busy || empty || disabled !== null || posted !== null}
              title={disabled ?? posted ?? (empty ? 'The reply is empty' : 'Post this text as it is, once, from the account of the Project')}
              onClick={onSend}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="w-pr-inbox-button" data-testid="pr-draft-discard" disabled={busy || disabled !== null} title={disabled ?? undefined} onClick={onDiscard}>
              Discard
            </button>
            <button type="button" className="w-pr-inbox-button" data-testid="pr-draft-rewrite" disabled={busy || disabled !== null || rewriteOff !== null} title={disabled ?? rewriteOff ?? undefined} onClick={onAskRewrite}>
              Ask the Session to rewrite
            </button>
          </div>
        </>
      )}
      {line !== null ? (
        <p role={line.error ? 'alert' : 'status'} style={line.error ? draftStyles.error : draftStyles.note} data-testid="pr-draft-result">
          {line.text}
        </p>
      ) : null}
    </div>
  )
}

// ── Send all ─────────────────────────────────────────────────────────────────

const dialogStyles = {
  dialog: {
    width: 560,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
    outline: 'none',
  },
  header: { padding: 'var(--space-4) var(--space-4) var(--space-3)', borderBottom: '1px solid var(--border)' },
  title: { margin: 0, fontSize: 'var(--text-20)', fontWeight: 600, overflowWrap: 'anywhere' },
  body: { padding: 'var(--space-3) var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  muted: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  text: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-sunken, transparent)' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

export interface SendAllDialogProps {
  repo: string
  number: number
  /** Every reply Send all posts, with the text that goes. */
  replies: readonly { place: string; text: string }[]
  onSend: () => void
  onCancel: () => void
}

/**
 * The dialog of Send all: every text exactly as it goes, Send all and Cancel. Nothing goes without Send
 * all. A modal window of the kit (theme/kit/Dialog.tsx, worfy-ui-kit ticket 07): the focus trap, Esc,
 * the backdrop and the focus given back are the kit's.
 */
export function SendAllDialog({ repo, number, replies, onSend, onCancel }: SendAllDialogProps) {
  const titleId = useId()
  return (
    <Dialog open onClose={onCancel} labelledBy={titleId} className="" style={dialogStyles.dialog} data-testid="pr-send-all-dialog">
      <div style={dialogStyles.header}>
        <h2 id={titleId} style={dialogStyles.title}>
          Send {replies.length} {replies.length === 1 ? 'reply' : 'replies'} to {repo}#{number}?
        </h2>
      </div>
      <div style={dialogStyles.body}>
        <p style={dialogStyles.muted}>Each text is posted exactly as shown, once, from the account of the Project, one after another.</p>
        {replies.map((reply, at) => (
          <section key={at} data-testid="pr-send-all-reply">
            <p style={dialogStyles.muted}>{reply.place}</p>
            <p style={dialogStyles.text} data-testid="pr-send-all-text">
              {reply.text}
            </p>
          </section>
        ))}
      </div>
      <div style={dialogStyles.footer}>
        <button type="button" className="w-action" data-testid="pr-send-all-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="w-action w-action--primary" data-testid="pr-send-all-confirm" onClick={onSend}>
          Send all
        </button>
      </div>
    </Dialog>
  )
}

// ── the drafts of a PR in the view ───────────────────────────────────────────

export interface PrDraftsProps {
  projectId: string
  repo: string
  number: number
  /** The read-only hint of the window; null when the user may act. */
  readOnly: string | null
  /** The PR's threads as the inbox read them: where each reply goes, `path:line`. */
  threads: readonly { id: string; path: string | null; line: number | null }[]
  /**
   * The reply under a thread or the conversation, placed by the caller; the replies it does not place go below.
   * `sendAll` opens the dialog of Send all with every text, for a caller's own button: null with fewer than two
   * drafts. In a window of a Linked machine `render` and `sendAll` are null and `drafts` empty: the drafts stay on
   * the Project's machine.
   */
  children: (render: ((item: PrReplyItem) => ReactNode) | null, drafts: readonly PrReplyItem[], sendAll: SendAllButton | null) => ReactNode
}

/** Send all for a button of the caller: how many replies it sends, why it is off (null when it is on), and the dialog. */
export interface SendAllButton {
  count: number
  off: string | null
  open: () => void
}

/** Why the Session cannot be asked to rewrite; null when it can. */
async function liveSession(session: string | null): Promise<string | null> {
  if (session === null) return 'No Session of Draft replies runs for this pull request in this window'
  const list = await invoke('agent.list', undefined)
  if (!list.ok) return readableReason(list.error)
  const found = list.value.find((each) => each.sessionId === session)
  return found === undefined || found.state === 'closed' ? 'The Session that wrote the drafts is closed: run Draft replies again' : null
}

/**
 * The drafts of one PR, kept current while it is open: the caller places each reply under its thread through
 * `children`; Send all and the problems of the drafts are here.
 */
export function PrDrafts(props: PrDraftsProps) {
  if (!draftsHere()) return <>{props.children(null, [], null)}</>
  return <ThisMachineDrafts {...props} />
}

function ThisMachineDrafts({ projectId, repo, number, readOnly, threads, children }: PrDraftsProps) {
  const place = (item: PrReplyItem): string =>
    placeOf(
      item,
      threads.find((thread) => thread.id === item.threadId),
    )
  const state = usePrReplyDrafts(projectId, repo, number)
  /** The replies of Send all and their texts, as they were when its dialog opened; null while it is closed. */
  const [confirming, setConfirming] = useState<readonly { item: PrReplyItem; place: string; text: string }[] | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const items = (state.drafts?.items ?? []).filter((item) => item.state !== 'discarded')
  const pending = items.filter((item) => item.state === 'draft')
  const disabled = readOnly
  /** Why "Ask the Session to rewrite" is off for this reply; null when it is on. */
  const rewriteOff = (item: PrReplyItem): string | null => {
    // pr-reply-draft keeps an edited draft as it is while its thread waits: a rewrite would change nothing.
    if (item.edited || state.textOf(item) !== item.body) return 'You changed this reply: the Session keeps your text when it drafts again, so it cannot rewrite it'
    return state.session === null ? 'No Session of Draft replies runs for this pull request in this window' : null
  }

  const askRewrite = (item: PrReplyItem): void => {
    void liveSession(state.session).then((off) => {
      if (off !== null || state.session === null) {
        setAsked(off)
        return
      }
      void invoke('agent.send', { sessionId: state.session, text: rewriteMessage(repo, number, place(item)), attachments: [] }).then((result) =>
        setAsked(result.ok ? `Asked the Session to rewrite the reply for ${place(item)}` : readableReason(result.error)),
      )
    })
  }

  const render = (item: PrReplyItem): ReactNode => (
    <DraftThread
      key={`draft-${item.index}`}
      item={item}
      place={place(item)}
      repo={repo}
      text={state.textOf(item)}
      busy={state.busy}
      result={state.resultOf(item)}
      disabled={disabled}
      rewriteOff={rewriteOff(item)}
      onText={(text) => state.setText(item, text)}
      onSave={() => state.save(item)}
      onSend={() => state.send([{ item, text: state.textOf(item) }])}
      onDiscard={() => state.discard(item)}
      onAskRewrite={() => askRewrite(item)}
    />
  )

  const anyEmpty = pending.some((item) => state.textOf(item).trim() === '')
  const sendAllOff = disabled ?? (anyEmpty ? 'A reply is empty: write it or discard it' : state.busy ? 'Sending…' : null)
  const openSendAll = (): void => setConfirming(pending.map((item) => ({ item, place: place(item), text: state.textOf(item) })))
  return (
    <>
      {children(render, items, pending.length > 1 ? { count: pending.length, off: sendAllOff, open: openSendAll } : null)}
      {state.error !== null || state.drafts?.problem != null || pending.length > 1 || asked !== null ? (
        <div style={draftStyles.bar} data-testid="pr-drafts-bar">
          {state.drafts?.problem != null ? (
            <span style={draftStyles.note} data-testid="pr-drafts-problem">
              {state.drafts.problem}
            </span>
          ) : null}
          {state.error !== null ? (
            <span role="alert" style={draftStyles.error} data-testid="pr-drafts-error">
              {state.error}
            </span>
          ) : null}
          {asked !== null ? (
            <span role="status" style={draftStyles.note} data-testid="pr-drafts-asked">
              {asked}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          {pending.length > 1 ? (
            <button
              type="button"
              className="w-pr-inbox-button"
              data-testid="pr-drafts-send-all"
              disabled={state.busy || disabled !== null || anyEmpty}
              title={disabled ?? (anyEmpty ? 'A reply is empty: write it or discard it' : `Show the ${pending.length} replies before they are sent`)}
              onClick={openSendAll}
            >
              Send all…
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming !== null ? (
        <SendAllDialog
          repo={repo}
          number={number}
          replies={confirming}
          onCancel={() => setConfirming(null)}
          onSend={() => {
            setConfirming(null)
            // What the dialog showed, not what a read since then brought.
            state.send(confirming)
          }}
        />
      ) : null}
    </>
  )
}

export interface DraftRepliesButtonProps {
  projectId: string
  repo: string
  number: number
  readOnly: string | null
  /** The main button of its place (the "what to do next" strip of the Pull requests view). */
  primary?: boolean
}

/**
 * "Draft replies" on an open row: a new Session with skill pr-reply over the PR (`actions.prReply`), and a line on how
 * it went. None in a window of a Linked machine: the drafts stay on the machine of the Project.
 */
export function DraftRepliesButton({ projectId, repo, number, readOnly, primary = false }: DraftRepliesButtonProps) {
  const [line, setLine] = useState<string | null>(null)
  if (!draftsHere()) return null
  const start = (): void => {
    if (readOnly !== null) return
    setLine('Starting a Session…')
    void draftReplies(projectId, repo, number).then((refused) => setLine(refused === undefined ? 'A Session drafts the replies: they appear under their threads' : `Draft replies failed: ${refused}`))
  }
  return (
    <>
      {line !== null ? (
        <span role="status" style={draftStyles.note} data-testid="pr-inbox-drafting">
          {line}
        </span>
      ) : null}
      <button
        type="button"
        className={primary ? 'w-pr-inbox-button w-pr-inbox-button--primary' : 'w-pr-inbox-button'}
        data-testid="pr-inbox-draft-replies"
        disabled={readOnly !== null}
        title={readOnly ?? 'A new Session drafts replies to the open threads into a file on this machine; nothing is posted'}
        onClick={start}
      >
        Draft replies
      </button>
    </>
  )
}
