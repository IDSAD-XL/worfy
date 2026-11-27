// The channel of the speech card's Close (worfy-polish 161; src/shared/ipc/assistant.ts, `assistant.cardClosed`): local,
// so a Linked machine never closes this Machine's card; each item with the count of events the card showed reaches the
// section in main as sent (review round 2); anything but a list of such items is refused before it.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { assistantCardClosed } from '../../src/shared/ipc/assistant'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

describe('assistant.cardClosed', () => {
  it("is local: the card is this Machine's", () => {
    expect(assistantCardClosed.access).toBe('local')
  })

  it('takes every item, with the events the card showed, the card would tell of, 56 and more, to the section in main', async () => {
    const closed: { id: string; events?: number }[][] = []
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        modules: {
          './assistant.ts': () =>
            import('../../src/main/ipc/assistant').then((module) => module.assistantHandlers(() => ({ cardClosed: (items: readonly { id: string; events?: number }[]) => void closed.push([...items]) }) as never)),
        },
        isTrustedSender: () => true,
      },
    )
    const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
    const call = async (input: unknown): Promise<IpcResult<unknown>> => (await handlers.get(`${IPC_CHANNEL_PREFIX}assistant.cardClosed`)!(event, input)) as IpcResult<unknown>
    const items = Array.from({ length: 600 }, (_, i) => ({ id: `item-${i}`, events: i + 1 }))
    expect(await call({ items })).toEqual({ ok: true, value: {} })
    expect((await call({ itemIds: ['item-1'] })).ok).toBe(false)
    expect((await call({ items: [{ id: 'item-1', events: -1 }] })).ok).toBe(false)
    expect(closed).toEqual([items])
  })
})
