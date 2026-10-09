import { app } from 'electron'
import { cardsChanged, cardsFile, cardsGet } from '../../shared/ipc/cards'
import { toEveryWindow } from '../broadcast'
import { readCardFileChunk } from '../cards/protocol'
import { cardStore } from '../cards/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = cardStore()

// Every client hears about every Card change; a Node picks out its own Card.
store.onChange((info) => {
  toEveryWindow((client) => emit(client, cardsChanged, info))
})

app.on('will-quit', () => void store.close())

export default [
  defineHandler(cardsGet, ({ projectId, cardId }) => store.info(projectId, cardId)),
  // A file of a Card for a Linked machine that shows it (worfy-link ticket 10): found as this
  // Machine's own protocol finds it, sent without the Card API runtime.
  defineHandler(cardsFile, ({ projectLabel, cardId, path, offset, length }) =>
    readCardFileChunk(store.locate({ cardId, projectLabel }), cardId, path, offset, length),
  ),
] satisfies HandlerModule
