// The "Sign in with gh" terminal and the cursor-position requests (worfy-windows ticket 39).
//
// The sign-in runs `gh auth login` in a TerminalRegistry of its own (signInRegistry,
// src/main/github/accounts.ts), and main answers every `ESC[6n` there as in a Terminal Node
// (cursor-answers.ts). The sign-in view's xterm.js answers too: its answer comes through
// `projects.connect.signInInput` marked `reply`, and main drops it, so gh gets one answer per
// request. An unmarked answer would reach gh as a second one.
//
// The real handlers of src/main/ipc/projects.ts and the real registry, over a stand-in pty that
// prints what the test gives it and records what it is typed: neither gh nor any process starts.
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { PtyProcess } from '../../src/main/terminal/pty'

const APP_URL = 'file:///app/index.html'
const ESC = '\x1b'

vi.mock('electron', () => ({
  app: { on: () => undefined, getLocale: () => 'en' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
}))

/** A pty that prints what the test gives it and records what it is typed. */
class StandInPty implements PtyProcess {
  // No process has this pid: nothing of the system is asked to end it.
  readonly pid = 999_999_993
  readonly writes: string[] = []
  private readonly data: ((data: string) => void)[] = []
  private readonly exits: ((event: { exitCode: number }) => void)[] = []
  private ended = false
  onData(listener: (data: string) => void): void {
    this.data.push(listener)
  }
  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exits.push(listener)
  }
  write(data: string): void {
    this.writes.push(data)
  }
  resize(): void {}
  print(text: string): void {
    for (const listener of this.data) listener(text)
  }
  kill(): void {
    if (this.ended) return
    this.ended = true
    for (const listener of this.exits) listener({ exitCode: 0 })
  }
}

const ptys = vi.hoisted(() => [] as unknown[])

// The sign-in registry of the app, with the stand-in pty instead of gh.
vi.mock('../../src/main/github/accounts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/github/accounts')>()
  return {
    ...real,
    signInRegistry: (gh: Parameters<typeof real.signInRegistry>[0]) =>
      real.signInRegistry(
        gh,
        () => {
          const pty = new StandInPty()
          ptys.push(pty)
          return pty
        },
        { platform: 'linux' },
      ),
  }
})

afterEach(() => {
  for (const pty of ptys.splice(0)) (pty as StandInPty).kill()
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

async function signInHandlers() {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  await registerIpc(ipc, {
    modules: { './projects.ts': () => import('../../src/main/ipc/projects').then((module) => module.default) },
    isTrustedSender: (url) => url === APP_URL,
  })
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => undefined })
  const call = async (channel: string, input: unknown): Promise<unknown> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (listener === undefined) throw new Error(`no handler for ${channel}`)
    const result = (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  return { call }
}

describe('the sign-in terminal answers each cursor request once (worfy-windows ticket 39)', () => {
  it('main answers; the view’s answer, marked, goes nowhere; the same bytes typed (Shift+F3) reach gh', async () => {
    const { call } = await signInHandlers()
    await call('projects.connect.signIn', { signInId: 'signin-cursor-1', cols: 80, rows: 24 })
    const pty = ptys.at(-1) as StandInPty | undefined
    if (pty === undefined) throw new Error('no pty')

    pty.print(`? What account do you want to log into? ${ESC}[6n`)
    await vi.waitFor(() => expect(pty.writes).toHaveLength(1))
    // The view's xterm.js answers the same request, as an answer.
    await call('projects.connect.signInInput', { signInId: 'signin-cursor-1', data: `${ESC}[1;41R`, reply: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The prompt is 40 characters: the cursor is in the 41st column.
    expect(pty.writes).toEqual([`${ESC}[1;41R`])

    // Shift+F3 in xterm.js is the same bytes, typed: it reaches gh.
    await call('projects.connect.signInInput', { signInId: 'signin-cursor-1', data: `${ESC}[1;2R` })
    expect(pty.writes).toEqual([`${ESC}[1;41R`, `${ESC}[1;2R`])
  })
})

describe('the sign-in terminal opened again (worfy-windows ticket 89)', () => {
  it('answers the kept output with the sizes of the pty it came at, as terminal.open does', async () => {
    const { call } = await signInHandlers()
    await call('projects.connect.signIn', { signInId: 'signin-sizes-1', cols: 80, rows: 24 })
    const pty = ptys.at(-1) as StandInPty | undefined
    if (pty === undefined) throw new Error('no pty')
    pty.print('at 80x24|')
    await call('projects.connect.signInResize', { signInId: 'signin-sizes-1', cols: 100, rows: 30 })
    pty.print('at 100x30')

    const again = await call('projects.connect.signIn', { signInId: 'signin-sizes-1', cols: 100, rows: 30 })
    expect(again).toEqual({
      replay: 'at 80x24|at 100x30',
      end: 'at 80x24|at 100x30'.length,
      sizes: [
        { at: 0, cols: 80, rows: 24 },
        { at: 'at 80x24|'.length, cols: 100, rows: 30 },
      ],
      exited: null,
    })
  })
})
