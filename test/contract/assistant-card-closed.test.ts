// The channel of the speech card's Close (worfy-polish 161; src/shared/ipc/assistant.ts, `assistant.cardClosed`): local,
// so a Linked machine never closes this Machine's card; the ids reach the section in main as sent; anything but a list of
// ids is refused before it.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { assistantCardClosed } from '../../src/shared/ipc/assistant'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

describe('assistant.cardClosed', () => {
  it("is local: the card is this Machine's", () => {
    expect(assistantCardClosed.access).toBe('local')
  })

  it('takes the ids of every item the card would tell of, 56 and more, to the section in main', async () => {
    const closed: string[][] = []
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        modules: {
          './assistant.ts': () =>
            import('../../src/main/ipc/assistant').then((module) => module.assistantHandlers(() => ({ cardClosed: (ids: readonly string[]) => void closed.push([...ids]) }) as never)),
        },
        isTrustedSender: () => true,
      },
    )
    const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
    const call = async (input: unknown): Promise<IpcResult<unknown>> => (await handlers.get(`${IPC_CHANNEL_PREFIX}assistant.cardClosed`)!(event, input)) as IpcResult<unknown>
    const ids = Array.from({ length: 600 }, (_, i) => `item-${i}`)
    expect(await call({ itemIds: ids })).toEqual({ ok: true, value: {} })
    expect((await call({ itemIds: 'item-1' })).ok).toBe(false)
    expect(closed).toEqual([ids])
  })
})
