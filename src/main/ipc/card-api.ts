// Handlers of the `cardApi` domain (src/shared/ipc/card-api.ts): a Card's own data and
// `session.ask`, asked by the window's Card bridge on behalf of a Card (ticket 26).
//
// `session.ask` waits for the user's "Send" in a message box. When the recipient Session runs
// unattended (Autopilot, worfy-daily ticket 02) no one would answer it: confirmAsk shows nothing,
// the Card gets a refusal, and the Session's subscribers get a `refused_dialog` event.
import { BrowserWindow, dialog, type Dialog } from 'electron'
import { cardApiAsk, cardApiDataGet, cardApiDataSet } from '../../shared/ipc/card-api'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import type { Session, SessionRegistry } from '../agent/session'
import { CardAsk, type AskQuestion } from '../cards/ask'
import { cardDataStore } from '../cards/data'
import { cardStore } from '../cards/store'
import { layoutStore } from '../layout/store'
import { defineHandler, type HandlerModule } from './index'

/** What the Card gets when the recipient Session runs unattended. */
export const NO_HUMAN_MESSAGE = 'No one is at this Session to confirm the message: it runs unattended (worfy Autopilot). Nothing was sent.'

/** What confirmAsk uses of Electron and of the app's Sessions; tests give their own. */
export interface ConfirmAskDeps {
  dialog: Pick<Dialog, 'showMessageBox'>
  /** The live Session with this registry id, or undefined. */
  session(sessionId: string): Pick<Session, 'unattended' | 'refuseDialog'> | undefined
}

function appSession(sessionId: string): Session | undefined {
  try {
    return sharedRegistry().get(sessionId)
  } catch {
    // Gone since the recipient was picked: the dialog is shown as before, and sending then fails.
    return undefined
  }
}

const appDeps: ConfirmAskDeps = { dialog, session: appSession }

/**
 * The confirmation of `session.ask`: a message box on the asking window. Button 0 is "Send". For an
 * unattended recipient no box is shown: the call rejects with NO_HUMAN_MESSAGE.
 */
export async function confirmAsk(owner: BrowserWindow | null, question: AskQuestion, deps: ConfirmAskDeps = appDeps): Promise<boolean> {
  const recipient = deps.session(question.recipient.sessionId)
  if (recipient?.unattended === true) {
    recipient.refuseDialog('card_ask', question.cardId, NO_HUMAN_MESSAGE)
    throw new Error(NO_HUMAN_MESSAGE)
  }
  const options = {
    type: 'question' as const,
    buttons: ['Send', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Message from a Card',
    message: `Card "${question.cardTitle}" wants to send a message to ${question.recipientLabel}.`,
    detail: question.message,
    noLink: true,
  }
  const { response } = owner ? await deps.dialog.showMessageBox(owner, options) : await deps.dialog.showMessageBox(options)
  return response === 0
}

/**
 * Sends the message of a Card the user confirmed with "Send". The user acted on the recipient
 * Session, so its input observers hear of it first (Autopilot journals it as `human-input`,
 * worfy-daily ticket 04): the dialog may have been answered after the run took the Orchestrator.
 */
export function sendFromCard(registry: Pick<SessionRegistry, 'get' | 'noteInput'>, sessionId: string, text: string): void {
  const session = registry.get(sessionId)
  registry.noteInput(sessionId, 'sent a message from a Card')
  session.send(text)
}

let ask: CardAsk | null = null

function cardAsk(): CardAsk {
  ask ??= new CardAsk({
    nodes: (projectId) => layoutStore().get(projectId).layout.nodes,
    sessions: () => sharedRegistry().list(),
    orchestrator: async (projectId) => {
      const view = await sharedOrchestrators().open(projectId)
      if (view.sessionId === null) throw new Error(`the Orchestrator of ${projectId} runs no Session`)
      return view.sessionId
    },
    cardTitle: async (projectId, cardId) => (await cardStore().info(projectId, cardId)).title,
    confirm: (question, owner) => confirmAsk((owner as BrowserWindow | null | undefined) ?? null, question),
    send: (sessionId, text) => sendFromCard(sharedRegistry(), sessionId, text),
  })
  return ask
}

export default [
  defineHandler(cardApiDataGet, ({ projectId, cardId }) => ({ value: cardDataStore().get(projectId, cardId) })),
  defineHandler(cardApiDataSet, ({ projectId, cardId, value }) => ({ bytes: cardDataStore().set(projectId, cardId, value) })),
  defineHandler(cardApiAsk, ({ projectId, cardId, text }, { event }) =>
    cardAsk().ask(projectId, cardId, text, BrowserWindow.fromWebContents(event.sender)),
  ),
] satisfies HandlerModule
