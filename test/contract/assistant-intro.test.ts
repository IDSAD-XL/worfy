// The channel of the one offer to turn the Assistant on (worfy-assistant ticket 16; src/shared/ipc/assistant.ts,
// `assistant.offer`): local, so a Linked machine never answers it; each answer reaches the introduction in main; an answer
// outside the three never does.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { assistantOffer } from '../../src/shared/ipc/assistant'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

describe('assistant.offer', () => {
  it('is local: the offer is this Machine\'s', () => {
    expect(assistantOffer.access).toBe('local')
  })

  it('each answer reaches the introduction in main; one outside the three is refused before it', async () => {
    const answers: string[] = []
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        modules: {
          './assistant.ts': () =>
            import('../../src/main/ipc/assistant').then((module) => module.assistantHandlers(() => ({}) as never, undefined, undefined, () => ({ answer: (answer) => void answers.push(answer) }))),
        },
        isTrustedSender: () => true,
      },
    )
    const event = { senderFrame: { url: 'app://index.html' } } as unknown as IpcMainInvokeEvent
    const call = async (input: unknown): Promise<IpcResult<unknown>> => (await handlers.get(`${IPC_CHANNEL_PREFIX}assistant.offer`)!(event, input)) as IpcResult<unknown>
    for (const answer of ['seen', 'declined', 'accepted']) expect(await call({ answer })).toEqual({ ok: true, value: {} })
    expect((await call({ answer: 'later' })).ok).toBe(false)
    expect(answers).toEqual(['seen', 'declined', 'accepted'])
  })
})
