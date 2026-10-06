// confirmAsk of `session.ask` (src/main/ipc/card-api.ts) with a dialog given by the test: an
// ordinary recipient gets the message box as before; an unattended one (Autopilot, worfy-daily
// ticket 02) opens no box, the Card gets a refusal and the Session's subscribers a
// `refused_dialog` event.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type Session } from '../../src/main/agent/session'
import { CardAsk, type AskQuestion } from '../../src/main/cards/ask'
import { confirmAsk, NO_HUMAN_MESSAGE, type ConfirmAskDeps } from '../../src/main/ipc/card-api'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'

const electron = vi.hoisted(() => ({ showMessageBox: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', getPath: () => '/nowhere', on: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
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
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function startSession(unattended: boolean): Promise<Session> {
  const session = registry.start(cwd, undefined, (_id, event) => received.push(event), { ...DEFAULT_SETTINGS, permissionMode: 'default' }, { unattended })
  await vi.waitFor(() => expect(session.state).toBe('idle'))
  return session
}

const question = (sessionId: string): AskQuestion => ({
  cardId: 'card-1',
  cardTitle: 'Release notes',
  recipient: { kind: 'orchestrator', sessionId },
  recipientLabel: 'the Orchestrator',
  message: 'Message from Card "Release notes" (card-1):\n\nship it',
})

/** A dialog that answers `response` and records how it was called. */
function fakeDialog(response: number) {
  const showMessageBox = vi.fn<(...args: unknown[]) => Promise<{ response: number; checkboxChecked: boolean }>>(() => Promise.resolve({ response, checkboxChecked: false }))
  const deps: ConfirmAskDeps = {
    dialog: { showMessageBox } as unknown as ConfirmAskDeps['dialog'],
    session: (sessionId) => {
      try {
        return registry.get(sessionId)
      } catch {
        return undefined
      }
    },
  }
  return { showMessageBox, deps }
}

describe('confirmAsk for an ordinary recipient', () => {
  it('shows the message box on the asking window and answers true only for "Send"', async () => {
    const session = await startSession(false)
    const owner = { id: 7 } as unknown as BrowserWindow
    const send = fakeDialog(0)
    expect(await confirmAsk(owner, question(session.id), send.deps)).toBe(true)
    expect(send.showMessageBox).toHaveBeenCalledTimes(1)
    const [window, options] = send.showMessageBox.mock.calls[0] as [BrowserWindow, MessageBoxOptions]
    expect(window).toBe(owner)
    expect(options).toMatchObject({
      buttons: ['Send', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Card "Release notes" wants to send a message to the Orchestrator.',
      detail: 'Message from Card "Release notes" (card-1):\n\nship it',
    })

    const cancel = fakeDialog(1)
    expect(await confirmAsk(null, question(session.id), cancel.deps)).toBe(false)
    // Without a window the box is the app's own: options only.
    expect(cancel.showMessageBox.mock.calls[0]).toHaveLength(1)
    expect(received.filter((event) => event.type === 'refused_dialog')).toEqual([])
  })

  it('uses Electron\'s dialog when no dialog is given', async () => {
    const session = await startSession(false)
    electron.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    expect(await confirmAsk(null, question(session.id))).toBe(true)
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
  })
})

describe('confirmAsk for an unattended recipient', () => {
  it('opens no message box, refuses, and tells the Session\'s subscribers', async () => {
    const session = await startSession(true)
    const { showMessageBox, deps } = fakeDialog(0)
    await expect(confirmAsk(null, question(session.id), deps)).rejects.toThrow(NO_HUMAN_MESSAGE)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(received.filter((event) => event.type === 'refused_dialog')).toEqual([
      { type: 'refused_dialog', dialog: 'card_ask', subject: 'card-1', message: NO_HUMAN_MESSAGE },
    ])
  })

  it('reaches the Card through session.ask as a refusal, and nothing is sent', async () => {
    const session = await startSession(true)
    const { showMessageBox, deps } = fakeDialog(0)
    const send = vi.fn()
    const ask = new CardAsk({
      nodes: () => [],
      sessions: () => registry.list(),
      orchestrator: () => Promise.resolve(session.id),
      cardTitle: () => Promise.resolve('Release notes'),
      confirm: (asked, owner) => confirmAsk((owner as BrowserWindow | null | undefined) ?? null, asked, deps),
      send,
    })
    await expect(ask.ask('demo', 'card-1', 'ship it')).rejects.toThrow(NO_HUMAN_MESSAGE)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    // The Card may ask again: its question is not left pending.
    await expect(ask.ask('demo', 'card-1', 'ship it')).rejects.toThrow(NO_HUMAN_MESSAGE)
  })
})
