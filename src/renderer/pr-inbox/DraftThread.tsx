// The drafts of replies of one PR in the Pull requests view (worfy-pr-inbox ticket 05, ADR-0105). Skill pr-reply
// writes them into a file on this machine; main reads it (`prInbox.drafts`). Under a thread: its draft in a field
// the user edits, and Send, Discard and Ask the Session to rewrite. Send all opens a dialog with every text first.
//
// Nothing here reaches GitHub by itself. The one way there is `prInbox.send`, called only from a click on Send or on
// Send all in the dialog, with the text shown in the field; main saves it, checks it again with review-draft-lint
// and posts it once. An edit is kept with `prInbox.saveDraft` when the field loses the focus; Discard is
// `prInbox.discard`. The drafts live on the machine of the Project only: a window of a Linked machine shows none.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import type { PrInboxComment, PrReplyDrafts, PrReplyItem, PrReplyRef, PrReplySendResult } from '../../shared/ipc/pr-inbox'
import { hasPreloadBridge, invoke, readableReason, windowMachine } from '../ipc'

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

const refOf = (item: PrReplyItem): PrReplyRef => ({ index: item.index, kind: item.kind, threadId: item.threadId })

/** A shape check of an answer: a renderer has no zod, and a fake main may answer anything. */
const isDrafts = (value: unknown): value is PrReplyDrafts => typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)

interface PrReplyDraftsState {
  /** Undefined until main answered. */
  drafts: PrReplyDrafts | undefined
  /** Why the drafts could not be read or changed. */
  error: string | null
  /** The text in each reply's field, by its index: the draft's own until the user types. */
  textOf: (item: PrReplyItem) => string
  setText: (item: PrReplyItem, text: string) => void
  /** A call to main runs: the buttons wait. */
  busy: boolean
  /** What the last Send said of each reply, by its index. */
  results: Readonly<Record<number, PrReplySendResult>>
  save: (item: PrReplyItem) => void
  discard: (item: PrReplyItem) => void
  /** Send of these replies, each with the text of its field: only on a click (Send, or Send all in its dialog). */
  send: (items: readonly PrReplyItem[]) => void
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
  const [typed, setTyped] = useState<Readonly<Record<number, string>>>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Readonly<Record<number, PrReplySendResult>>>({})
  const session = useDraftSessions((store) => store.byPr[prKey(projectId, repo, number)] ?? null)
  const live = useRef(true)
  const pull = { projectId, repo, number }

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

  const textOf = (item: PrReplyItem): string => typed[item.index] ?? item.body
  /**
   * The fields whose text main now holds show the draft's own text again, so a later read shows what the file holds;
   * a field the user typed in meanwhile keeps the newer text.
   */
  const forget = (kept: readonly { index: number; body: string }[]): void =>
    setTyped((current) => {
      const next = { ...current }
      for (const { index, body } of kept) if (next[index] === body) delete next[index]
      return next
    })

  /** A call to main; `blocking` ones (Send, Discard) hold the buttons until it answers. A save never does: it runs on a blur, and the click that caused the blur must still reach its button. */
  const run = (call: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>, after: (value: unknown) => void, blocking: boolean): void => {
    if (blocking) setBusy(true)
    void call().then((result) => {
      if (!live.current) return
      if (blocking) setBusy(false)
      if (!result.ok) {
        setError(readableReason(result.error))
        return
      }
      after(result.value)
    })
  }

  return {
    drafts,
    error,
    textOf,
    setText: (item, text) => setTyped((current) => ({ ...current, [item.index]: text })),
    busy,
    results,
    session,
    save: (item) => {
      const body = textOf(item)
      if (body === item.body) return
      run(
        () => invoke('prInbox.saveDraft', { ...pull, item: refOf(item), body }),
        (value) => {
          forget([{ index: item.index, body }])
          take(value)
        },
        false,
      )
    },
    discard: (item) =>
      run(
        () => invoke('prInbox.discard', { ...pull, item: refOf(item) }),
        (value) => {
          forget([{ index: item.index, body: textOf(item) }])
          take(value)
        },
        true,
      ),
    send: (items) => {
      if (items.length === 0) return
      const sent = items.map((item) => ({ ...refOf(item), body: textOf(item) }))
      run(
        () => invoke('prInbox.send', { ...pull, items: sent }),
        (value) => {
          const answer = value as { results?: PrReplySendResult[]; drafts?: unknown }
          setResults((current) => {
            const next = { ...current }
            for (const each of answer.results ?? []) next[each.index] = each
            return next
          })
          forget(sent)
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
  text: string
  busy: boolean
  /** What the last Send said of it; null when it was not sent in this view. */
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
  box: { marginTop: 'var(--space-2)', padding: 'var(--space-2)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 },
  title: { fontWeight: 600, fontSize: 'var(--text-12)' },
  place: { marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  field: { width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-13)' },
  actions: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' },
  note: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  error: { margin: 0, color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  sentText: { display: 'block', marginTop: 'var(--space-1)', whiteSpace: 'pre-wrap', color: 'var(--text)' },
  bar: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' },
} satisfies Record<string, CSSProperties>

const LABEL_TEXT: Readonly<Record<string, string>> = { 'needs code change': 'Needs code change', 'needs answer': 'Needs answer', FYI: 'FYI', 'resolved by push': 'Resolved by push' }

/** The line under a reply: what the last Send said, or why the one before did not post it. */
function resultLine(item: PrReplyItem, result: PrReplySendResult | null): { text: string; error: boolean } | null {
  if (result !== null && result.outcome !== 'sent' && result.reason !== null) return { text: result.reason, error: result.outcome !== 'already-sent' }
  if (item.state === 'draft' && item.error !== null) return { text: item.error, error: true }
  return null
}

/** A draft reply under its thread: the field, and Send, Discard, Ask the Session to rewrite; a sent one, its link. */
export function DraftThread({ item, place, comments = [], text, busy, result, disabled, rewriteOff, onText, onSave, onSend, onDiscard, onAskRewrite }: DraftThreadProps) {
  const fieldId = useId()
  const line = resultLine(item, result)
  const empty = text.trim() === ''
  return (
    <div style={draftStyles.box} data-testid="pr-draft" data-index={item.index} data-state={item.state} data-kind={item.kind}>
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
              <p className="w-pr-inbox-comment__body">{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {item.state === 'sent' ? (
        <p style={draftStyles.note} data-testid="pr-draft-sent">
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
          <span style={draftStyles.sentText}>{item.body}</span>
        </p>
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
              className="w-pr-inbox-button"
              data-testid="pr-draft-send"
              disabled={busy || empty || disabled !== null}
              title={disabled ?? (empty ? 'The reply is empty' : 'Post this text as it is, once, from the account of the Project')}
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
  backdrop: { position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
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

/** The dialog of Send all: every text exactly as it goes, Send all and Cancel. Nothing goes without Send all. */
export function SendAllDialog({ repo, number, replies, onSend, onCancel }: SendAllDialogProps) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus()
  }, [])
  return createPortal(
    <div
      style={dialogStyles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dialogStyles.dialog}
        data-testid="pr-send-all-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
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
      </div>
    </div>,
    document.body,
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
   * In a window of a Linked machine `render` is null and `drafts` empty: the drafts stay on the Project's machine.
   */
  children: (render: ((item: PrReplyItem) => ReactNode) | null, drafts: readonly PrReplyItem[]) => ReactNode
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
  if (!draftsHere()) return <>{props.children(null, [])}</>
  return <ThisMachineDrafts {...props} />
}

function ThisMachineDrafts({ projectId, repo, number, readOnly, threads, children }: PrDraftsProps) {
  const place = (item: PrReplyItem): string =>
    placeOf(
      item,
      threads.find((thread) => thread.id === item.threadId),
    )
  const state = usePrReplyDrafts(projectId, repo, number)
  const [confirming, setConfirming] = useState(false)
  const [asked, setAsked] = useState<string | null>(null)
  const items = (state.drafts?.items ?? []).filter((item) => item.state !== 'discarded')
  const pending = items.filter((item) => item.state === 'draft')
  const disabled = readOnly
  const rewriteOff = state.session === null ? 'No Session of Draft replies runs for this pull request in this window' : null

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
      text={state.textOf(item)}
      busy={state.busy}
      result={state.results[item.index] ?? null}
      disabled={disabled}
      rewriteOff={rewriteOff}
      onText={(text) => state.setText(item, text)}
      onSave={() => state.save(item)}
      onSend={() => state.send([item])}
      onDiscard={() => state.discard(item)}
      onAskRewrite={() => askRewrite(item)}
    />
  )

  const anyEmpty = pending.some((item) => state.textOf(item).trim() === '')
  return (
    <>
      {children(render, items)}
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
              onClick={() => setConfirming(true)}
            >
              Send all…
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <SendAllDialog
          repo={repo}
          number={number}
          replies={pending.map((item) => ({ place: place(item), text: state.textOf(item) }))}
          onCancel={() => setConfirming(false)}
          onSend={() => {
            setConfirming(false)
            state.send(pending)
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
}

/**
 * "Draft replies" on an open row: a new Session with skill pr-reply over the PR (`actions.prReply`), and a line on how
 * it went. None in a window of a Linked machine: the drafts stay on the machine of the Project.
 */
export function DraftRepliesButton({ projectId, repo, number, readOnly }: DraftRepliesButtonProps) {
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
        className="w-pr-inbox-button"
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
