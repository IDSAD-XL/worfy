// "Link a machine" paused after too many failed pairing attempts (worfy-link ticket 28), seen
// through the real `link` IPC handlers (src/main/ipc/link.ts) and the dispatcher that checks their
// answers against the shared schema (src/main/ipc/index.ts): a window that has the dialog open
// learns until when linking is paused. The app's link is a real service on the bench, wired as the
// app wires it (wireAppLink).
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { PAIRING_HOURLY_FAILURES } from '../../src/main/link/pairing'
import { wireAppLink, type AppLink } from '../../src/main/link/service'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'
import { LinkBench } from './link-bench'
import { linkPairingHelpers } from './link-pairing-helpers'

const app = vi.hoisted(() => ({ link: undefined as AppLink | undefined }))

vi.mock('../../src/main/link/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/service')>()),
  appLink: () => app.link,
  appLinkService: () => app.link?.service,
}))

// The handlers send `link.changed` to the windows; there are none.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

let bench: LinkBench
const { rejection } = linkPairingHelpers(() => bench)

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
  const link = app.link
  app.link = undefined
  link?.connections.stop()
  link?.sleep.stop()
  await bench.close()
})

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcResult<unknown>>

it('a window with "Link a machine" open gets linking.pausedUntil while linking is paused, and no code', async () => {
  const a = await bench.machine('alpha')
  const b = await bench.machine('beta')
  app.link = wireAppLink(b.service, { bonjour: false })
  const handlers = new Map<string, Handler>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Handler) },
    { modules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) }, isTrustedSender: () => true },
  )
  const window = { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }
  const event = { senderFrame: { url: 'app://worfy/index.html' }, sender: window } as unknown as IpcMainInvokeEvent
  const call = async (name: string): Promise<LinkState> => {
    const result = await handlers.get(`${IPC_CHANNEL_PREFIX}${name}`)?.(event, undefined)
    if (result?.ok !== true) throw new Error(`${name}: ${result?.ok === false ? result.error : 'not registered'}`)
    return result.value as LinkState
  }

  const opened = await call('link.open')
  expect(opened.linking.code).not.toBeNull()
  expect(opened.linking.pausedUntil).toBeUndefined()

  const port = bench.portOf(b)
  for (let attempt = 1; attempt <= PAIRING_HOURLY_FAILURES; attempt++) {
    const shown = b.service.pairingCode()?.code ?? ''
    await rejection(a.service.pair({ host: '127.0.0.1', port, code: shown === '000000' ? '000001' : '000000' }))
    await expect.poll(() => b.pairingFailures.length).toBeGreaterThanOrEqual(attempt)
  }
  const until = b.service.pairingPausedUntil()
  expect(until).not.toBeNull()

  const state = await call('link.state')
  expect(state.linking.pausedUntil).toBe(until)
  expect(state.linking.code).toBeNull()
  // Opening again during the pause opens nothing, and still says until when.
  const again = await call('link.open')
  expect(again.linking.pausedUntil).toBe(until)
  expect(again.linking.code).toBeNull()

  // Once the pause is over, the state no longer carries it, and opening shows a code.
  bench.advance((until ?? 0) - bench.now)
  const after = await call('link.open')
  expect(after.linking.pausedUntil).toBeUndefined()
  expect(after.linking.code).not.toBeNull()
  await call('link.close')
})
