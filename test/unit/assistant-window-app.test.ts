// The Assistant's section in the running app (src/main/assistant/window/app.ts; worfy-assistant ticket 14, item 5): a message
// the user writes in the section goes to the Assistant's own Session (ticket 10: appAssistant, composeAssistant), and it
// is refused while the Assistant is off. The Assistant of ticket 10 is real here (composeAssistant); its decision to wake
// and its Sessions are stand-ins, so no Claude Code starts. worfy's data folder is a temporary one.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assistant, AssistantRun } from '../../src/main/assistant/session/runner'
import type { AssistantWake } from '../../src/main/assistant/wake/planner'

const app = vi.hoisted(() => ({ assistant: null as Assistant | null }))

const temp = mkdtempSync(join(tmpdir(), 'worfy-assistant-window-app-'))
vi.stubEnv('WORFY_DATA_DIR', temp)

vi.mock('../../src/main/assistant/session/app', () => ({ appAssistant: () => app.assistant }))

const { composeAssistant } = await import('../../src/main/assistant/session/runner')
const { appAssistantWindow } = await import('../../src/main/assistant/window/app')
const { ASSISTANT_OFF } = await import('../../src/main/assistant/window/view')
const { removeTree } = await import('../../src/main/storage/remove')

afterAll(() => {
  vi.unstubAllEnvs()
  removeTree(temp)
})

/** Ticket 10's Assistant over stand-ins: each wake answers at once, and `woke` keeps what each Session was given. */
function runningAssistant(): { assistant: Assistant; woke: { reason: string; message: string | undefined }[] } {
  const woke: { reason: string; message: string | undefined }[] = []
  let onWake: (wake: AssistantWake) => void = () => undefined
  const assistant = composeAssistant({
    sessions: {
      stop: () => undefined,
      wake: (wake, message): Promise<AssistantRun> => {
        woke.push({ reason: wake.reason, message })
        return Promise.resolve({ sessionId: 's-1', wakeId: wake.id, reason: wake.reason, outcome: 'answered', text: 'Two Sessions wait for you.' })
      },
    },
    startWake: (handler) => {
      onWake = handler
      return {
        escalate: () => null,
        userMessage: () => {
          const wake: AssistantWake = { type: 'wake', id: 'user-1', reason: 'user', at: 0, items: [] }
          onWake(wake)
          return wake
        },
        stop: () => undefined,
      }
    },
    startClosedList: () => () => undefined,
  })
  return { assistant: assistant!, woke }
}

describe('the conversation of the section in the app', () => {
  beforeEach(() => {
    app.assistant = null
  })

  it('is refused while the Assistant is off', () => {
    expect(() => appAssistantWindow().send('hello')).toThrow(ASSISTANT_OFF)
  })

  it("goes to the Assistant's Session once it runs, and its answer shows in the section", async () => {
    const running = runningAssistant()
    app.assistant = running.assistant
    appAssistantWindow().send('What waits for me?')
    expect(running.woke).toEqual([{ reason: 'user', message: 'What waits for me?' }])
    await new Promise((done) => setTimeout(done, 0))
    const saved = JSON.parse(readFileSync(join(temp, 'assistant', 'window.json'), 'utf8')) as { conversation: { who: string; text: string; state: string }[] }
    expect(saved.conversation.map((message) => [message.who, message.text, message.state])).toEqual([
      ['you', 'What waits for me?', 'done'],
      ['assistant', 'Two Sessions wait for you.', 'done'],
    ])
  })
})
