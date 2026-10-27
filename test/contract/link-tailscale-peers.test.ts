// The machines of the user's tailnet for "Link a machine" (worfy-link ticket 30), through the real
// `link` IPC handlers (src/main/ipc/link.ts) and the dispatcher that checks their answers against
// the shared schema (src/main/ipc/index.ts). The app's link is a real service on the bench. The
// Tailscale CLI is never started: the reader gets an injected file check and runner.
import type { IpcMainInvokeEvent } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { wireAppLink, type AppLink } from '../../src/main/link/service'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { LinkState, TailscalePeerView } from '../../src/shared/ipc/link'
import { LinkBench } from './link-bench'

const app = vi.hoisted(() => ({ link: undefined as AppLink | undefined }))
const cli = vi.hoisted(() => ({ path: '/Applications/Tailscale.app/Contents/MacOS/Tailscale', installed: false, run: vi.fn<(file: string, args: readonly string[], timeout: number) => Promise<string>>(async () => ''), warn: vi.fn() }))

vi.mock('../../src/main/link/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/service')>()),
  appLink: () => app.link,
  appLinkService: () => app.link?.service,
}))

// The handler reads the tailnet with the module's own defaults; here the CLI is there or not by the
// test's word, and its runner is a stub.
vi.mock('../../src/main/link/tailscale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/link/tailscale')>()
  return {
    ...actual,
    readTailscalePeers: (options: Parameters<typeof actual.readTailscalePeers>[0] = {}) =>
      actual.readTailscalePeers({ ...options, platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, exists: (path) => cli.installed && path === cli.path, run: cli.run, warn: cli.warn }),
  }
})

// The handlers send `link.changed` to the windows; there are none.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

let bench: LinkBench

beforeEach(() => {
  bench = new LinkBench()
  cli.installed = false
  cli.run.mockReset()
  cli.warn.mockReset()
})

afterEach(async () => {
  const link = app.link
  app.link = undefined
  link?.connections.stop()
  link?.sleep.stop()
  await bench.close()
})

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcResult<unknown>>

/**
 * The IPC handlers over beta's link service; `linkedWith` is paired with beta first, and `remembered`
 * then changes what beta's linked.json keeps for it (read again on a restart).
 */
async function handlers(tailscale: boolean, linkedWith?: string, remembered?: Record<string, unknown>): Promise<<T>(name: string) => Promise<T>> {
  const b = await bench.machine('beta')
  if (linkedWith !== undefined) {
    const other = await bench.machine(linkedWith)
    await bench.link(b, other)
    if (remembered !== undefined) {
      const file = join(b.dataDir, 'link', 'linked.json')
      const data = JSON.parse(readFileSync(file, 'utf8')) as { machines: Record<string, unknown>[] }
      for (const record of data.machines) if (record.id === other.service.machine.id) Object.assign(record, remembered)
      writeFileSync(file, JSON.stringify(data))
      await bench.restart(b)
    }
  }
  b.service.settings.set({ tailscale })
  app.link = wireAppLink(b.service, { bonjour: false })
  const registered = new Map<string, Handler>()
  await registerIpc(
    { handle: (channel, listener) => registered.set(channel, listener as Handler) },
    { modules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) }, isTrustedSender: () => true },
  )
  const window = { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }
  const event = { senderFrame: { url: 'app://worfy/index.html' }, sender: window } as unknown as IpcMainInvokeEvent
  return async <T,>(name: string): Promise<T> => {
    const result = await registered.get(`${IPC_CHANNEL_PREFIX}${name}`)?.(event, undefined)
    if (result?.ok !== true) throw new Error(`${name}: ${result?.ok === false ? result.error : 'not registered'}`)
    return result.value as T
  }
}

it('without the Tailscale CLI "Link a machine" opens with no problem, and the tailnet list is empty, with nothing started or logged', async () => {
  const call = await handlers(true)
  const opened = await call<LinkState>('link.open')
  expect(opened.tailscale).toBe(true)
  expect(opened.problem).toBeNull()
  expect(opened.linking.code).not.toBeNull()
  expect(await call<TailscalePeerView[]>('link.tailscalePeers')).toEqual([])
  expect(cli.run).not.toHaveBeenCalled()
  expect(cli.warn).not.toHaveBeenCalled()
  await call('link.close')
})

it('with the CLI and "Link through Tailscale" on, lists the tailnet as the CLI reports it', async () => {
  cli.installed = true
  cli.run.mockResolvedValue(readFileSync(join(__dirname, '../fixtures/tailscale/status.json'), 'utf8'))
  const call = await handlers(true)
  expect(await call<TailscalePeerView[]>('link.tailscalePeers')).toEqual([
    { name: 'Alexeys-iPhone', address: '100.101.102.106', online: true },
    { name: 'lab', address: 'fd7a:115c:a1e0::6501:6670', online: true },
    { name: 'pc', address: '100.101.102.104', online: true },
    { name: 'nas', address: '100.101.102.105', online: false },
  ])
  expect(cli.run).toHaveBeenCalledWith(cli.path, ['status', '--json'], expect.any(Number))
})

it('with "Link through Tailscale" off, gives no list and does not start the CLI', async () => {
  cli.installed = true
  const call = await handlers(false)
  expect(await call<TailscalePeerView[]>('link.tailscalePeers')).toEqual([])
  expect(cli.run).not.toHaveBeenCalled()
})

it('a CLI that fails gives an empty list, not an error of the call, and one warning', async () => {
  cli.installed = true
  cli.run.mockRejectedValue(Object.assign(new Error('Command failed'), { killed: true }))
  const call = await handlers(true)
  expect(await call<TailscalePeerView[]>('link.tailscalePeers')).toEqual([])
  expect(cli.warn).toHaveBeenCalledTimes(1)
})

it('leaves out a Linked machine: the peer at the address this Machine remembers for it', async () => {
  cli.installed = true
  const call = await handlers(true, 'gamma')
  const remembered = app.link?.service.linkedMachines().map((machine) => machine.address)
  expect(remembered).toEqual(['127.0.0.1'])
  // gamma as the tailnet would list it, with the address the link remembers among its TailscaleIPs.
  const status = JSON.parse(readFileSync(join(__dirname, '../fixtures/tailscale/status.json'), 'utf8')) as { Peer: Record<string, unknown> }
  status.Peer['nodekey:gamma'] = { HostName: 'gamma', DNSName: 'gamma.tail1234.ts.net.', TailscaleIPs: ['100.101.102.120', '127.0.0.1'], Online: true }
  cli.run.mockResolvedValue(JSON.stringify(status))
  const peers = await call<TailscalePeerView[]>('link.tailscalePeers')
  expect(peers.map((peer) => peer.name)).toEqual(['Alexeys-iPhone', 'lab', 'pc', 'nas'])
})

it('leaves out a Linked machine remembered by a LAN address and its MagicDNS name', async () => {
  cli.installed = true
  const call = await handlers(true, 'gamma', { address: '192.168.1.77', tailnetName: 'gamma.tail1234.ts.net' })
  expect(app.link?.service.linkedMachines().map((machine) => machine.address)).toEqual(['192.168.1.77'])
  const status = JSON.parse(readFileSync(join(__dirname, '../fixtures/tailscale/status.json'), 'utf8')) as { Peer: Record<string, unknown> }
  status.Peer['nodekey:gamma'] = { HostName: 'gamma', DNSName: 'Gamma.tail1234.ts.net.', TailscaleIPs: ['100.101.102.120'], Online: true }
  cli.run.mockResolvedValue(JSON.stringify(status))
  const peers = await call<TailscalePeerView[]>('link.tailscalePeers')
  expect(peers.map((peer) => peer.name)).toEqual(['Alexeys-iPhone', 'lab', 'pc', 'nas'])
})
