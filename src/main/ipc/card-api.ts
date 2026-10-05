// Handlers of the `cardApi` domain (src/shared/ipc/card-api.ts): a Card's own data and
// `session.ask`, asked by the window's Card bridge on behalf of a Card (ticket 26).
import { BrowserWindow, dialog } from 'electron'
import { cardApiAsk, cardApiDataGet, cardApiDataSet } from '../../shared/ipc/card-api'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { CardAsk, type AskQuestion } from '../cards/ask'
import { cardDataStore } from '../cards/data'
import { cardStore } from '../cards/store'
import { layoutStore } from '../layout/store'
import { defineHandler, type HandlerModule } from './index'

/** The confirmation of `session.ask`: a message box on the asking window. Button 0 is "Send". */
export async function confirmAsk(owner: BrowserWindow | null, question: AskQuestion): Promise<boolean> {
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
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return response === 0
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
    send: (sessionId, text) => sharedRegistry().get(sessionId).send(text),
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
