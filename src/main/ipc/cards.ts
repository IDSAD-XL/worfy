import { app, BrowserWindow } from 'electron'
import { cardsChanged, cardsGet } from '../../shared/ipc/cards'
import { cardStore } from '../cards/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = cardStore()

// Every window hears about every Card change; a Node picks out its own Card.
store.onChange((info) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) emit(window.webContents, cardsChanged, info)
  }
})

app.on('will-quit', () => void store.close())

export default [defineHandler(cardsGet, ({ projectId, cardId }) => store.info(projectId, cardId))] satisfies HandlerModule
