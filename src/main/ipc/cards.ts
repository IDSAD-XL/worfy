import { app } from 'electron'
import { cardsChanged, cardsGet } from '../../shared/ipc/cards'
import { toEveryWindow } from '../broadcast'
import { cardStore } from '../cards/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = cardStore()

// Every client hears about every Card change; a Node picks out its own Card.
store.onChange((info) => {
  toEveryWindow((client) => emit(client, cardsChanged, info))
})

app.on('will-quit', () => void store.close())

export default [defineHandler(cardsGet, ({ projectId, cardId }) => store.info(projectId, cardId))] satisfies HandlerModule
