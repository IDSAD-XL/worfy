// A link/settings.json of a version this build does not know (worfy-polish ticket 63: Roll back,
// ADR-0089, starts the previous copy on a newer build's data folder), through the real link service
// on the bench and the real `link` IPC handlers. A change from Settings → Machines is refused with a
// text the renderer shows (src/renderer/machines/useMachines.ts passes the `{ ok: false }` error on);
// linking and unlinking still work, and the newer build's file is never touched.
import type { IpcMainInvokeEvent } from 'electron'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { wireAppLink, type AppLink } from '../../src/main/link/service'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { LinkBench, type BenchMachine } from './link-bench'

const app = vi.hoisted(() => ({ link: undefined as AppLink | undefined }))

vi.mock('../../src/main/link/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/service')>()),
  appLink: () => app.link,
  appLinkService: () => app.link?.service,
}))

// The handlers send `link.changed` to the windows; there are none.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const REFUSAL = 'Link settings were written by a newer worfy build (file version 3); update worfy to change them'
const OTHER = '33333333-3333-4333-8333-333333333333'

let bench: LinkBench

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

/** `machine` restarted over a version 3 settings.json; returns the file and its text as written. */
async function onNewerFile(machine: BenchMachine): Promise<{ file: string; text: string }> {
  const dir = join(machine.dataDir, 'link')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'settings.json')
  const text = JSON.stringify({ version: 3, projectsAccess: true, machines: { [OTHER]: 'write' }, keepAwake: false, scopes: { [OTHER]: ['p'] } })
  writeFileSync(file, text)
  await bench.restart(machine)
  return { file, text }
}

async function ipcOver(machine: BenchMachine): Promise<(name: string, input: unknown) => Promise<IpcResult<unknown>>> {
  app.link = wireAppLink(machine.service, { bonjour: false })
  const registered = new Map<string, Handler>()
  await registerIpc(
    { handle: (channel, listener) => registered.set(channel, listener as Handler) },
    { modules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) }, isTrustedSender: () => true },
  )
  const window = { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }
  const event = { senderFrame: { url: 'app://worfy/index.html' }, sender: window } as unknown as IpcMainInvokeEvent
  return async (name, input) => {
    const handler = registered.get(`${IPC_CHANNEL_PREFIX}${name}`)
    if (handler === undefined) throw new Error(`${name} is not registered`)
    return handler(event, input)
  }
}

it('every switch of Settings → Machines answers with the refusal text, and the file stays as the newer build wrote it', async () => {
  const b = await bench.machine('beta')
  const { file, text } = await onNewerFile(b)
  const call = await ipcOver(b)
  for (const [channel, input] of [
    ['link.setAccess', { projectsAccess: true }],
    ['link.setKeepAwake', { keepAwake: false }],
    ['link.setTailscale', { tailscale: true }],
  ] as const) {
    const result = await call(channel, input)
    expect(result.ok, channel).toBe(false)
    expect(result.ok === false ? result.error : '', channel).toContain(REFUSAL)
  }
  expect(b.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true, tailscale: false })
  expect(readFileSync(file, 'utf8')).toBe(text)
  expect(readdirSync(join(b.dataDir, 'link')).filter((name) => name.startsWith('settings.json'))).toEqual(['settings.json'])
})

it('linking, a level change and unlinking: the link works, the level is refused, and the file is never written', async () => {
  const b = await bench.machine('beta')
  const a = await bench.machine('alpha')
  const { file, text } = await onNewerFile(b)
  const call = await ipcOver(b)

  await bench.link(a, b)
  const alpha = a.service.machine.id
  expect(b.service.isLinked(alpha)).toBe(true)
  expect(b.service.settings.levelOf(alpha)).toBe('off')

  const level = await call('link.setMachineAccess', { id: alpha, access: 'all' })
  expect(level.ok === false ? level.error : 'saved').toContain(REFUSAL)

  b.service.revoke(alpha)
  expect(b.service.isLinked(alpha)).toBe(false)
  expect(readFileSync(file, 'utf8')).toBe(text)
})
