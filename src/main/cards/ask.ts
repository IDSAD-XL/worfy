// `session.ask` of the Card API (ticket 26): a Card passes a text to a Session, but only after the
// user saw it and pressed "Send". The recipient is decided by main, never by the Card: the Session
// that last edited the Card (the Card Node's `lastEditor`, recorded from that Session's own
// tool calls by src/main/mcp/canvas-server.ts) when it is live in worfy, otherwise the Project's
// Orchestrator. The dialog names the Card, the recipient and the exact text that will be sent.
//
// Three steps (worfy-link ticket 10; ADR-0053: a dialog is shown by the Machine of the screen that
// asked). prepare() runs on the Machine of the Project: it picks the recipient, refuses an
// unattended one, and keeps the question waiting under an id. The screen's own Machine shows the
// dialog (`cardApi.confirm`, src/main/ipc/card-api.ts). finish() runs on the Machine of the Project
// again and sends the message, or not. A Card has one question waiting at a time; a waiting
// question goes when it is finished, when the screen that asked leaves (its client is destroyed),
// or after ASK_WAIT_MS, so the Card is never left with a question nobody will answer.
import { randomUUID } from 'node:crypto'
import { CARD_KIND } from '../../shared/canvas/tools'
import type { LayoutNode } from '../../shared/layout/types'
import type { SessionInfo } from '../agent/session'
import type { Client } from '../clients'

/** How long a question waits for the screen's answer. */
export const ASK_WAIT_MS = 10 * 60_000

export type AskRecipient =
  | { kind: 'session'; sessionId: string; sdkSessionId: string }
  | { kind: 'orchestrator'; sessionId: string }

/** What the user is shown before anything is sent. */
export interface AskQuestion {
  cardId: string
  cardTitle: string
  recipient: AskRecipient
  /** Who gets it, in words. */
  recipientLabel: string
  /** The message exactly as the Session will get it. */
  message: string
}

export interface CardAskDeps {
  /** The Layout Nodes of the Project. */
  nodes(projectId: string): readonly LayoutNode[]
  /** worfy's live Sessions (the app's registry). */
  sessions(): readonly SessionInfo[]
  /** The registry id of the Project's Orchestrator Session, opening it when it does not run. */
  orchestrator(projectId: string): Promise<string>
  /** The Card's <title>, or null. Throws for an unknown Project. */
  cardTitle(projectId: string, cardId: string): Promise<string | null>
  /**
   * Called before a question waits: throws when no one could answer the dialog for the recipient
   * (an unattended Session), after telling the Session's subscribers.
   */
  refuseUnattended(question: AskQuestion): void
  /** Sends a user message to a live Session. */
  send(sessionId: string, text: string): void
  /** A new question id; randomUUID by default. */
  newId?: () => string
  /** Timers; the global ones by default. */
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** What the screen shows in the dialog, and the id to finish the question with. */
export interface PreparedAsk {
  askId: string
  cardTitle: string
  recipientLabel: string
  message: string
}

export interface AskResult {
  sent: boolean
  recipient: AskRecipient['kind'] | null
}

/** The screen that asked: the client that made the call (src/main/clients.ts). */
export type Asker = Pick<Client, 'id' | 'once' | 'isDestroyed'>

interface Waiting {
  key: string
  projectId: string
  question: AskQuestion
  asker: Asker | undefined
  timer: unknown
}

/** The message a Session gets: the Card is named, so the agent knows where the text comes from. */
export function askMessage(cardTitle: string, cardId: string, text: string): string {
  return `Message from Card "${cardTitle}" (${cardId}):\n\n${text}`
}

/** The Session id recorded as the Card's last editor, or null. */
export function lastEditorOf(nodes: readonly LayoutNode[], cardId: string): string | null {
  const node = nodes.find((each) => each.id === cardId && each.kind === CARD_KIND)
  const editor = node?.data.lastEditor
  return typeof editor === 'string' && editor !== '' ? editor : null
}

export class CardAsk {
  /** The questions waiting for the screen's answer, by id. */
  private readonly waiting = new Map<string, Waiting>()
  /** The Cards with a question waiting (or being prepared): one at a time per Card. */
  private readonly busy = new Set<string>()
  /** The screens whose leaving is watched: one listener per client object. */
  private readonly watched = new WeakSet<object>()
  private readonly newId: () => string
  private readonly setTimer: (run: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void

  constructor(private readonly deps: CardAskDeps) {
    this.newId = deps.newId ?? (() => randomUUID())
    // unref: a question nobody answers does not keep the app from quitting.
    this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms).unref())
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  /** The recipient now: the live last editor, else the Orchestrator. */
  async recipient(projectId: string, cardId: string): Promise<AskRecipient> {
    const editor = lastEditorOf(this.deps.nodes(projectId), cardId)
    if (editor !== null) {
      const live = this.deps.sessions().find((session) => session.state !== 'closed' && (session.sdkSessionId === editor || session.sessionId === editor))
      if (live) return { kind: 'session', sessionId: live.sessionId, sdkSessionId: live.sdkSessionId ?? editor }
    }
    return { kind: 'orchestrator', sessionId: await this.deps.orchestrator(projectId) }
  }

  /**
   * The first step: the question as the dialog shows it, now waiting under `askId`. Throws while
   * the Card has another question waiting, and for an unattended recipient (nothing waits then).
   * `asker` is the screen that asked; when it leaves, the question goes.
   */
  async prepare(projectId: string, cardId: string, text: string, asker?: Asker): Promise<PreparedAsk> {
    const key = `${projectId}\n${cardId}`
    if (this.busy.has(key)) throw new Error('This Card already has a question waiting for the user')
    if (asker?.isDestroyed() === true) throw new Error('The screen that asked is gone')
    this.busy.add(key)
    try {
      const cardTitle = (await this.deps.cardTitle(projectId, cardId)) ?? cardId
      const recipient = await this.recipient(projectId, cardId)
      const recipientLabel =
        recipient.kind === 'orchestrator' ? 'the Orchestrator' : `Session ${recipient.sdkSessionId.slice(0, 8)}, which last edited this Card`
      const message = askMessage(cardTitle, cardId, text)
      const question: AskQuestion = { cardId, cardTitle, recipient, recipientLabel, message }
      this.deps.refuseUnattended(question)
      // The screen may have left while the recipient was looked up.
      if (asker?.isDestroyed() === true) throw new Error('The screen that asked is gone')
      const askId = this.newId()
      const timer = this.setTimer(() => this.drop(askId), ASK_WAIT_MS)
      this.waiting.set(askId, { key, projectId, question, asker, timer })
      if (asker !== undefined) this.watch(asker)
      return { askId, cardTitle, recipientLabel, message }
    } catch (error) {
      this.busy.delete(key)
      throw error
    }
  }

  /**
   * The last step: with `send`, the message goes to the recipient chosen in prepare(); without it,
   * nothing is sent. Either way the question stops waiting. Only the screen that asked finishes
   * it; an unknown, finished or dropped question throws.
   */
  finish(projectId: string, askId: string, send: boolean, asker?: Asker): AskResult {
    const waiting = this.waiting.get(askId)
    if (waiting === undefined || waiting.projectId !== projectId || (waiting.asker !== undefined && waiting.asker.id !== asker?.id)) {
      throw new Error('This question is no longer waiting: it was answered, its screen left, or it waited too long')
    }
    this.drop(askId)
    if (!send) return { sent: false, recipient: null }
    this.deps.send(waiting.question.recipient.sessionId, waiting.question.message)
    return { sent: true, recipient: waiting.question.recipient.kind }
  }

  /** The number of questions waiting now; for tests. */
  get pending(): number {
    return this.waiting.size
  }

  private drop(askId: string): void {
    const waiting = this.waiting.get(askId)
    if (waiting === undefined) return
    this.waiting.delete(askId)
    this.busy.delete(waiting.key)
    this.clearTimer(waiting.timer)
  }

  /** When `asker` leaves, every question it left waiting goes. */
  private watch(asker: Asker): void {
    if (this.watched.has(asker)) return
    this.watched.add(asker)
    asker.once('destroyed', () => {
      for (const [askId, waiting] of [...this.waiting]) if (waiting.asker === asker) this.drop(askId)
    })
  }
}
