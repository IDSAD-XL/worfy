// Handlers of the `cardApi` domain (src/shared/ipc/card-api.ts): a Card's own data and
// `session.ask`, asked by the window's Card bridge on behalf of a Card (ticket 26).
//
// `session.ask` goes in three calls (worfy-link ticket 10; ADR-0053): `cardApi.askPrepare` and
// `cardApi.askFinish` on the Machine of the Project (src/main/cards/ask.ts), `cardApi.confirm` on
// the Machine of the screen, which shows the message box on the window that asked. When the
// recipient Session runs unattended (Autopilot, worfy-daily ticket 02) no one would answer it:
// askPrepare refuses before any dialog, and the Session's subscribers get a `refused_dialog` event.
import { BrowserWindow, dialog, type Dialog } from 'electron'
import { cardApiAskFinish, cardApiAskPrepare, cardApiConfirm, cardApiDataGet, cardApiDataSet, type CardPrompt } from '../../shared/ipc/card-api'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import type { Session, SessionRegistry } from '../agent/session'
import { CardAsk, type AskQuestion } from '../cards/ask'
import { cardDataStore } from '../cards/data'
import { cardStore } from '../cards/store'
import { clientOf } from '../clients'
import { layoutStore } from '../layout/store'
import { defineHandler, type HandlerModule } from './index'

/** What the Card gets when the recipient Session runs unattended. */
export const NO_HUMAN_MESSAGE = 'No one is at this Session to confirm the message: it runs unattended (worfy Autopilot). Nothing was sent.'

/** The live Session with a registry id, or undefined; tests give their own. */
export type SessionLookup = (sessionId: string) => Pick<Session, 'unattended' | 'refuseDialog'> | undefined

function appSession(sessionId: string): Session | undefined {
  try {
    return sharedRegistry().get(sessionId)
  } catch {
    // Gone since the recipient was picked: the dialog is shown as before, and sending then fails.
    return undefined
  }
}

/**
 * Before a question of `session.ask` waits for a dialog: for an unattended recipient no dialog
 * will be shown. Throws NO_HUMAN_MESSAGE, after the Session's subscribers got `refused_dialog`.
 */
export function refuseUnattended(question: AskQuestion, session: SessionLookup = appSession): void {
  const recipient = session(question.recipient.sessionId)
  if (recipient?.unattended !== true) return
  recipient.refuseDialog('card_ask', question.cardId, NO_HUMAN_MESSAGE)
  throw new Error(NO_HUMAN_MESSAGE)
}

/**
 * The confirmation of `session.ask`: a message box on the window that asked, on the Machine of that
 * window. Button 0 is "Send"; true only for it.
 */
export async function confirmCardMessage(owner: BrowserWindow | null, prompt: CardPrompt, box: Pick<Dialog, 'showMessageBox'> = dialog): Promise<boolean> {
  const options = {
    type: 'question' as const,
    buttons: ['Send', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Message from a Card',
    message: `Card "${prompt.cardTitle}" wants to send a message to ${prompt.recipientLabel}.`,
    detail: prompt.message,
    noLink: true,
  }
  const { response } = owner ? await box.showMessageBox(owner, options) : await box.showMessageBox(options)
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
    refuseUnattended: (question) => refuseUnattended(question),
    send: (sessionId, text) => sendFromCard(sharedRegistry(), sessionId, text),
  })
  return ask
}

export default [
  defineHandler(cardApiDataGet, ({ projectId, cardId }) => ({ value: cardDataStore().get(projectId, cardId) })),
  defineHandler(cardApiDataSet, ({ projectId, cardId, value }) => ({ bytes: cardDataStore().set(projectId, cardId, value) })),
  defineHandler(cardApiAskPrepare, ({ projectId, cardId, text }, { event }) => cardAsk().prepare(projectId, cardId, text, clientOf(event))),
  // `local`: only a window of this Machine calls it, so the sender is a window's webContents.
  defineHandler(cardApiConfirm, async (prompt, { event }) => ({ send: await confirmCardMessage(BrowserWindow.fromWebContents(event.sender), prompt) })),
  defineHandler(cardApiAskFinish, ({ projectId, askId, send }, { event }) => cardAsk().finish(projectId, askId, send, clientOf(event))),
] satisfies HandlerModule
