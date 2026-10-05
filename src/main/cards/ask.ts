// `session.ask` of the Card API (ticket 26): a Card passes a text to a Session, but only after the
// user saw it and pressed "Send". The recipient is decided by main, never by the Card: the Session
// that last edited the Card (the Card Node's `lastEditor`, recorded from that Session's own
// tool calls by src/main/mcp/canvas-server.ts) when it is live in worfy, otherwise the Project's
// Orchestrator. The dialog names the Card, the recipient and the exact text that will be sent.
import { CARD_KIND } from '../../shared/canvas/tools'
import type { LayoutNode } from '../../shared/layout/types'
import type { SessionInfo } from '../agent/session'

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
  /** The confirmation dialog; true only for "Send". `owner` is what the caller passed to ask(): the asking window. */
  confirm(question: AskQuestion, owner: unknown): Promise<boolean>
  /** Sends a user message to a live Session. */
  send(sessionId: string, text: string): void
}

export interface AskResult {
  sent: boolean
  recipient: AskRecipient['kind'] | null
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
  /** Cards whose question is on screen now: one dialog per Card at a time. */
  private readonly pending = new Set<string>()

  constructor(private readonly deps: CardAskDeps) {}

  /** The recipient now: the live last editor, else the Orchestrator. */
  async recipient(projectId: string, cardId: string): Promise<AskRecipient> {
    const editor = lastEditorOf(this.deps.nodes(projectId), cardId)
    if (editor !== null) {
      const live = this.deps.sessions().find((session) => session.state !== 'closed' && (session.sdkSessionId === editor || session.sessionId === editor))
      if (live) return { kind: 'session', sessionId: live.sessionId, sdkSessionId: live.sdkSessionId ?? editor }
    }
    return { kind: 'orchestrator', sessionId: await this.deps.orchestrator(projectId) }
  }

  async ask(projectId: string, cardId: string, text: string, owner?: unknown): Promise<AskResult> {
    const key = `${projectId}\n${cardId}`
    if (this.pending.has(key)) throw new Error('This Card already has a question waiting for the user')
    this.pending.add(key)
    try {
      const cardTitle = (await this.deps.cardTitle(projectId, cardId)) ?? cardId
      const recipient = await this.recipient(projectId, cardId)
      const recipientLabel =
        recipient.kind === 'orchestrator' ? 'the Orchestrator' : `Session ${recipient.sdkSessionId.slice(0, 8)}, which last edited this Card`
      const message = askMessage(cardTitle, cardId, text)
      const confirmed = await this.deps.confirm({ cardId, cardTitle, recipient, recipientLabel, message }, owner)
      if (!confirmed) return { sent: false, recipient: null }
      this.deps.send(recipient.sessionId, message)
      return { sent: true, recipient: recipient.kind }
    } finally {
      this.pending.delete(key)
    }
  }
}
