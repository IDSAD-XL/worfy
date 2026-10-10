// Handlers of the `terminalAi` domain (src/shared/ipc/terminal-ai.ts): the Terminal AI settings and
// state of this Machine. A client (src/main/clients.ts) that asks for the state gets every later
// change on `terminalAi.changed` until it is destroyed, as `limits.open` does; the channels are
// `local`, so only this Machine's windows reach them.
//
// The assist service (src/main/terminal-ai/assist.ts) is made on the first call: loading this module
// starts nothing, and a test passes its own service.
import { clientOf, type Client } from '../clients'
import { terminalAiChanged, terminalAiSetSettings, terminalAiState } from '../../shared/ipc/terminal-ai'
import { appAssist, type AssistService } from '../terminal-ai/assist'
import { defineHandler, emit, type HandlerModule } from './index'

type Service = Pick<AssistService, 'state' | 'setSettings' | 'subscribe'>

/** The handlers over a service; tests pass their own. */
export function terminalAiHandlers(service: () => Promise<Service>): HandlerModule {
  const subscribed = new WeakSet<Client>()
  const follow = (assist: Service, client: Client | undefined): void => {
    if (client === undefined || subscribed.has(client) || client.isDestroyed()) return
    subscribed.add(client)
    const unsubscribe = assist.subscribe((state) => {
      if (!client.isDestroyed()) emit(client, terminalAiChanged, state)
    })
    client.once('destroyed', () => {
      unsubscribe()
      subscribed.delete(client)
    })
  }
  return [
    defineHandler(terminalAiState, async (_input, { event }) => {
      const assist = await service()
      follow(assist, clientOf(event))
      return assist.state()
    }),
    defineHandler(terminalAiSetSettings, async (patch, { event }) => {
      const assist = await service()
      follow(assist, clientOf(event))
      return assist.setSettings(patch)
    }),
  ]
}

export default terminalAiHandlers(appAssist) satisfies HandlerModule
