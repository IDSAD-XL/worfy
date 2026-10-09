// `session.ask` of the Card API in three steps (worfy-link ticket 10; ADR-0053): askPrepare and
// askFinish on the Machine of the Project (src/main/cards/ask.ts), the dialog of cardApi.confirm on
// the Machine of the screen (src/main/ipc/card-api.ts). A question waits between the two; it goes
// when it is finished, when the screen that asked leaves, and after ten minutes. An unattended
// recipient (Autopilot, worfy-daily ticket 02) is refused in askPrepare, before any dialog, and the
// Session's subscribers get a `refused_dialog` event. The handlers run as the app runs them, over
// the app's shared registry on a temporary WORFY_DATA_DIR, with the fake agent.
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type Session } from '../../src/main/agent/session'
import { ASK_WAIT_MS, CardAsk, type AskQuestion, type Asker } from '../../src/main/cards/ask'
import { confirmCardMessage, NO_HUMAN_MESSAGE, refuseUnattended, sendFromCard, type SessionLookup } from '../../src/main/ipc/card-api'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { cardApiAskFinish, cardApiAskPrepare, cardApiConfirm } from '../../src/shared/ipc/card-api'
import { accessOf } from '../../src/shared/ipc/channels'
import { cardsFile } from '../../src/shared/ipc/cards'

const electron = vi.hoisted(() => ({ showMessageBox: vi.fn(), fromWebContents: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', getPath: () => '/nowhere', on: vi.fn() },
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  dialog: { showMessageBox: electron.showMessageBox },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

let cwd: string
let registry: SessionRegistry
let received: AgentEvent[]

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-card-api-'))
  registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: fixtures, script: 'turn' }))
  received = []
})

afterEach(async () => {
  registry.closeAll()
  electron.showMessageBox.mockReset()
  electron.fromWebContents.mockReset()
  vi.useRealTimers()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function startSession(unattended: boolean): Promise<Session> {
  const session = registry.start(cwd, undefined, (_id, event) => received.push(event), { ...DEFAULT_SETTINGS, permissionMode: 'default' }, { unattended })
  await vi.waitFor(() => expect(session.state).toBe('idle'))
  return session
}

const lookup: SessionLookup = (sessionId) => {
  try {
    return registry.get(sessionId)
  } catch {
    return undefined
  }
}

/** A screen that asks: a client whose `destroyed` the test fires. */
class FakeScreen extends EventEmitter {
  private gone = false
  constructor(readonly id: number | string) {
    super()
  }
  isDestroyed(): boolean {
    return this.gone
  }
  leave(): void {
    this.gone = true
    this.emit('destroyed')
  }
}
const screen = (id: number | string): FakeScreen & Asker => new FakeScreen(id) as FakeScreen & Asker

/** A CardAsk whose recipient is the Orchestrator `orchestrator`, sending as the app does: with the input mark. */
function cardAsk(orchestrator: string, options: { refuse?: (question: AskQuestion) => void } = {}) {
  let next = 0
  return new CardAsk({
    nodes: () => [],
    sessions: () => registry.list(),
    orchestrator: () => Promise.resolve(orchestrator),
    cardTitle: () => Promise.resolve('Release notes'),
    refuseUnattended: options.refuse ?? ((question) => refuseUnattended(question, lookup)),
    send: (sessionId, text) => sendFromCard(registry, sessionId, text),
    newId: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`,
  })
}

/** The user messages the Session has been given (each shows up as a `prompt` event). */
const prompts = () => received.filter((event) => event.type === 'prompt').map((event) => (event as { text?: string }).text)

describe('askPrepare → askFinish on the Machine of the Project', () => {
  it('"Send": the message reaches the recipient, after its input observers heard of a person\'s action', async () => {
    const session = await startSession(false)
    const inputs: string[] = []
    registry.observeInput((target, what) => inputs.push(`${target.id}: ${what}`))
    const ask = cardAsk(session.id)
    const asker = screen(7)

    const prepared = await ask.prepare('demo', 'card-1', 'ship it', asker)
    expect(prepared).toEqual({
      askId: '00000000-0000-4000-8000-000000000001',
      cardTitle: 'Release notes',
      recipientLabel: 'the Orchestrator',
      message: 'Message from Card "Release notes" (card-1):\n\nship it',
    })
    expect(cardApiAskPrepare.output.safeParse(prepared).success).toBe(true)
    expect(ask.pending).toBe(1)
    expect(prompts()).toEqual([])

    expect(ask.finish('demo', prepared.askId, true, asker)).toEqual({ sent: true, recipient: 'orchestrator' })
    expect(inputs).toEqual([`${session.id}: sent a message from a Card`])
    await vi.waitFor(() => expect(prompts()).toEqual(['Message from Card "Release notes" (card-1):\n\nship it']))
    expect(ask.pending).toBe(0)
    // Finished: the same id does not send twice.
    expect(() => ask.finish('demo', prepared.askId, true, asker)).toThrow(/no longer waiting/)
  })

  it('"Cancel" (send: false) sends nothing, and the Card may ask again', async () => {
    const session = await startSession(false)
    const ask = cardAsk(session.id)
    const prepared = await ask.prepare('demo', 'card-1', 'not this one')
    expect(ask.finish('demo', prepared.askId, false)).toEqual({ sent: false, recipient: null })
    expect(ask.pending).toBe(0)
    await new Promise((done) => setTimeout(done, 50))
    expect(prompts()).toEqual([])
    await expect(ask.prepare('demo', 'card-1', 'again')).resolves.toMatchObject({ message: 'Message from Card "Release notes" (card-1):\n\nagain' })
  })

  it('a second askPrepare of the same Card while the first waits is refused; another Card may ask', async () => {
    const session = await startSession(false)
    const ask = cardAsk(session.id)
    const first = await ask.prepare('demo', 'card-1', 'one')
    await expect(ask.prepare('demo', 'card-1', 'two')).rejects.toThrow('This Card already has a question waiting for the user')
    await expect(ask.prepare('demo', 'card-2', 'other')).resolves.toMatchObject({ cardTitle: 'Release notes' })
    ask.finish('demo', first.askId, false)
    await expect(ask.prepare('demo', 'card-1', 'two')).resolves.toMatchObject({ message: expect.stringContaining('two') })
  })

  it('only the screen that asked finishes the question, in its own Project', async () => {
    const session = await startSession(false)
    const ask = cardAsk(session.id)
    const asker = screen('link:m-1/1')
    const prepared = await ask.prepare('demo', 'card-1', 'ship it', asker)
    expect(() => ask.finish('demo', prepared.askId, true, screen('link:m-2/1'))).toThrow(/no longer waiting/)
    expect(() => ask.finish('other', prepared.askId, true, asker)).toThrow(/no longer waiting/)
    expect(ask.pending).toBe(1)
    expect(ask.finish('demo', prepared.askId, false, asker)).toEqual({ sent: false, recipient: null })
  })

  it('the waiting question goes when the screen that asked leaves: nothing is sent, the Card may ask again', async () => {
    const session = await startSession(false)
    const ask = cardAsk(session.id)
    const asker = screen(11)
    const prepared = await ask.prepare('demo', 'card-1', 'ship it', asker)
    await ask.prepare('demo', 'card-2', 'and this', asker)
    expect(ask.pending).toBe(2)
    asker.leave()
    expect(ask.pending).toBe(0)
    expect(() => ask.finish('demo', prepared.askId, true, asker)).toThrow(/no longer waiting/)
    await expect(ask.prepare('demo', 'card-1', 'again', screen(12))).resolves.toMatchObject({ cardTitle: 'Release notes' })
    expect(prompts()).toEqual([])
    // A screen already gone asks nothing.
    await expect(ask.prepare('demo', 'card-3', 'late', asker)).rejects.toThrow(/screen that asked is gone/)
  })

  it('the waiting question goes after ten minutes without an answer', async () => {
    const session = await startSession(false)
    vi.useFakeTimers()
    const ask = cardAsk(session.id)
    const prepared = await ask.prepare('demo', 'card-1', 'ship it')
    vi.advanceTimersByTime(ASK_WAIT_MS - 1)
    expect(ask.pending).toBe(1)
    await expect(ask.prepare('demo', 'card-1', 'two')).rejects.toThrow(/already has a question/)
    vi.advanceTimersByTime(1)
    expect(ask.pending).toBe(0)
    expect(() => ask.finish('demo', prepared.askId, true)).toThrow(/no longer waiting/)
    await expect(ask.prepare('demo', 'card-1', 'two')).resolves.toMatchObject({ cardTitle: 'Release notes' })
    expect(ASK_WAIT_MS).toBe(10 * 60_000)
  })

  it('"Send" checks the recipient again: one that turned unattended while the dialog was open gets nothing', async () => {
    const session = await startSession(false)
    let unattendedNow = false
    const refused: string[] = []
    const ask = cardAsk(session.id, {
      refuse: (question) => {
        if (!unattendedNow) return
        refused.push(question.cardId)
        throw new Error(NO_HUMAN_MESSAGE)
      },
    })
    const prepared = await ask.prepare('demo', 'card-1', 'ship it')
    unattendedNow = true
    expect(() => ask.finish('demo', prepared.askId, true)).toThrow(NO_HUMAN_MESSAGE)
    expect(refused).toEqual(['card-1'])
    expect(ask.pending).toBe(0)
    await new Promise((done) => setTimeout(done, 50))
    expect(prompts()).toEqual([])
  })

  it('an unattended recipient: refused, `refused_dialog` sent, no dialog, nothing waits', async () => {
    const session = await startSession(true)
    const ask = cardAsk(session.id)
    await expect(ask.prepare('demo', 'card-1', 'ship it')).rejects.toThrow(NO_HUMAN_MESSAGE)
    expect(ask.pending).toBe(0)
    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(received.filter((event) => event.type === 'refused_dialog')).toEqual([
      { type: 'refused_dialog', dialog: 'card_ask', subject: 'card-1', message: NO_HUMAN_MESSAGE },
    ])
    // The Card may ask again: its question is not left pending.
    await expect(ask.prepare('demo', 'card-1', 'ship it')).rejects.toThrow(NO_HUMAN_MESSAGE)
  })
})

describe('cardApi.confirm: the message box on the screen\'s own Machine', () => {
  const prompt = { cardTitle: 'Release notes', recipientLabel: 'the Orchestrator', message: 'Message from Card "Release notes" (card-1):\n\nship it' }

  it('shows the box on the asking window with the same buttons and words, and answers true only for "Send"', async () => {
    const owner = { id: 7 } as unknown as BrowserWindow
    const box = { showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })) }
    expect(await confirmCardMessage(owner, prompt, box as never)).toBe(true)
    const [window, options] = box.showMessageBox.mock.calls[0] as unknown as [BrowserWindow, MessageBoxOptions]
    expect(window).toBe(owner)
    expect(options).toEqual({
      type: 'question',
      buttons: ['Send', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Message from a Card',
      message: 'Card "Release notes" wants to send a message to the Orchestrator.',
      detail: 'Message from Card "Release notes" (card-1):\n\nship it',
      noLink: true,
    })
    const cancel = { showMessageBox: vi.fn(() => Promise.resolve({ response: 1, checkboxChecked: false })) }
    expect(await confirmCardMessage(null, prompt, cancel as never)).toBe(false)
    // Without a window the box is the app's own: options only.
    expect(cancel.showMessageBox.mock.calls[0]).toHaveLength(1)
  })
})

describe('the access marks of worfy-link ticket 08', () => {
  it('cardApi.confirm is `local`; askPrepare, askFinish and cards.file are `project`; cardApi.ask is gone', () => {
    expect(cardApiConfirm.access).toBe('local')
    expect([cardApiAskPrepare.access, cardApiAskFinish.access, cardsFile.access]).toEqual(['project', 'project', 'project'])
    expect(accessOf('cardApi.confirm')).toBe('local')
    expect(accessOf('cardApi.askPrepare')).toBe('project')
    expect(accessOf('cardApi.askFinish')).toBe('project')
    expect(accessOf('cards.file')).toBe('project')
    expect(accessOf('cardApi.ask')).toBeUndefined()
  })
})

describe('the cardApi handlers as the app runs them: the app\'s registry, Electron\'s dialog', () => {
  it('prepare, confirm and finish: "Send" reaches the Orchestrator once; the unattended one is refused before the dialog; a screen that leaves drops its question', async () => {
    // A fresh module graph whose shared registry runs the fake agent over a temporary data folder.
    const PROJECT = 'demo-0000000d'
    mkdirSync(join(cwd, 'data'), { recursive: true })
    writeFileSync(join(cwd, 'data', 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: cwd }], activeId: PROJECT }))
    vi.stubEnv('WORFY_DATA_DIR', join(cwd, 'data'))
    vi.stubEnv('WORFY_AGENT', 'fake')
    vi.stubEnv('WORFY_AGENT_SCRIPTS', fixtures)
    vi.stubEnv('WORFY_AGENT_SCRIPT', 'turn')
    vi.resetModules()
    const { sharedRegistry } = await import('../../src/main/agent/app-registry')
    const { appLimits } = await import('../../src/main/agent/limits')
    const { cardStore } = await import('../../src/main/cards/store')
    const app = await import('../../src/main/ipc/card-api')
    const { sharedOrchestrators } = await import('../../src/main/agent/app-orchestrators')
    const handlers = new Map(app.default.map((handler) => [handler.channel.name, handler]))
    const call = (name: string, input: unknown, sender: unknown) => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`${name} is not handled`)
      return Promise.resolve().then(() => handler.handle(handler.channel.input.parse(input), { event: { sender } as never }))
    }
    try {
      const sink = (_id: string, event: AgentEvent) => received.push(event)
      const saved = { ...DEFAULT_SETTINGS, permissionMode: 'default' as const }
      const ordinary = sharedRegistry().start(cwd, undefined, sink, saved)
      const unattended = sharedRegistry().start(cwd, undefined, sink, saved, { unattended: true })
      await vi.waitFor(() => expect([ordinary.state, unattended.state]).toEqual(['idle', 'idle']))
      let orchestrator = ordinary.id
      vi.spyOn(sharedOrchestrators(), 'open').mockImplementation(() => Promise.resolve({ sessionId: orchestrator } as never))
      vi.spyOn(cardStore(), 'info').mockImplementation(() => Promise.resolve({ title: 'Release notes' } as never))

      const window = screen(3)
      const owner = { id: 3 } as unknown as BrowserWindow
      electron.fromWebContents.mockReturnValue(owner)
      electron.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })

      const prepared = (await call('cardApi.askPrepare', { projectId: PROJECT, cardId: 'card-1', text: 'ship it' }, window)) as { askId: string; cardTitle: string; recipientLabel: string; message: string }
      const { askId, ...prompt } = prepared
      expect(await call('cardApi.confirm', prompt, window)).toEqual({ send: true })
      expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
      expect(electron.showMessageBox.mock.calls[0]?.[0]).toBe(owner)
      expect(await call('cardApi.askFinish', { projectId: PROJECT, askId, send: true }, window)).toEqual({ sent: true, recipient: 'orchestrator' })
      await vi.waitFor(() => expect(prompts()).toEqual(['Message from Card "Release notes" (card-1):\n\nship it']))

      // A Linked machine's screen asks, then its connection closes: the question goes with it.
      const remote = screen('link:m-1/1')
      const waiting = (await call('cardApi.askPrepare', { projectId: PROJECT, cardId: 'card-1', text: 'from afar' }, remote)) as { askId: string }
      remote.leave()
      await expect(call('cardApi.askFinish', { projectId: PROJECT, askId: waiting.askId, send: true }, remote)).rejects.toThrow(/no longer waiting/)
      await expect(call('cardApi.askPrepare', { projectId: PROJECT, cardId: 'card-1', text: 'again' }, window)).resolves.toMatchObject({ cardTitle: 'Release notes' })

      // The unattended Orchestrator: refused in askPrepare, so no screen ever shows a dialog for it.
      orchestrator = unattended.id
      await expect(call('cardApi.askPrepare', { projectId: PROJECT, cardId: 'card-2', text: 'ship it' }, window)).rejects.toThrow(app.NO_HUMAN_MESSAGE)
      expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
      expect(received.filter((event) => event.type === 'refused_dialog')).toEqual([
        { type: 'refused_dialog', dialog: 'card_ask', subject: 'card-2', message: app.NO_HUMAN_MESSAGE },
      ])
      expect(prompts()).toHaveLength(1)
    } finally {
      sharedRegistry().closeAll()
      appLimits().stop()
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })
})
