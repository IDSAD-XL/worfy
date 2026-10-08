// The link server and connections (worfy-link ticket 01; ADR-0052, points 5–9): the remembered
// certificate, the checks before the WebSocket handshake, IPC over the link, revoking, when the
// server listens, and service messages. Services run over temporary data folders on 127.0.0.1
// (test/contract/link-bench.ts).
import { randomBytes, randomUUID } from 'node:crypto'
import { request } from 'node:https'
import { connect as netConnect } from 'node:net'
import tls from 'node:tls'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineHandler, type HandlerModule } from '../../src/main/ipc/index'
import { LinkConnectError, openLinkSocket } from '../../src/main/link/client'
import { LinkConnection } from '../../src/main/link/connection'
import { generateCertificate } from '../../src/main/link/identity'
import { defineLinkMessage } from '../../src/main/link/messages'
import { projectsList } from '../../src/shared/ipc/projects'
import { LinkBench, type BenchMachine } from './link-bench'

let bench: LinkBench | undefined
const errors: string[] = []

afterEach(async () => {
  if (bench === undefined) return
  // No token and no pairing code in the console output or in an error text a test met.
  expect(bench.leakedSecrets(errors)).toEqual([])
  await bench.close()
  bench = undefined
  errors.length = 0
})

/** Counts calls of the projects.list handler registered for the link: it must never run. */
const projectsCalls = { count: 0 }
const fakeProjects: HandlerModule = [
  defineHandler(projectsList, () => {
    projectsCalls.count += 1
    return { projects: [], activeId: null, revision: 0 }
  }),
]

function newBench(options: ConstructorParameters<typeof LinkBench>[0] = {}): LinkBench {
  bench = new LinkBench({
    ipcModules: {
      './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
      './projects.ts': () => Promise.resolve(fakeProjects),
    },
    ...options,
  })
  return bench
}

function linkFile<T>(machine: BenchMachine, name: string): T {
  const file = bench?.files(machine).find((entry) => entry.path.endsWith(name))
  if (file === undefined) throw new Error(`${machine.label} has no ${name}`)
  return JSON.parse(file.bytes.toString('utf8')) as T
}

const certificateOf = (machine: BenchMachine): string => linkFile<{ certificate: string }>(machine, 'machine.json').certificate
const secretsOf = (machine: BenchMachine): Record<string, string> => linkFile<{ secrets: Record<string, string> }>(machine, 'secrets.json').secrets
const keyOf = (machine: BenchMachine): string => secretsOf(machine)['machine-key'] ?? ''

/** The rejection of `promise`, remembered for the leak check. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    const caught = error instanceof Error ? error : new Error(String(error))
    errors.push(caught.message)
    return caught
  }
  throw new Error('expected a rejection')
}

interface UpgradeAnswer {
  status: number
  body: string
}

/** A raw WebSocket upgrade request to the link server; the answer before (or instead of) the handshake. */
function upgrade(port: number, options: { headers?: Record<string, string>; client?: BenchMachine; path?: string }): Promise<UpgradeAnswer> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: options.path ?? '/link/connect',
      method: 'GET',
      rejectUnauthorized: false,
      ...(options.client === undefined ? {} : { key: keyOf(options.client), cert: certificateOf(options.client) }),
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        host: `127.0.0.1:${port}`,
        'x-worfy-link-protocol': '1',
        ...options.headers,
      },
    })
    req.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode ?? 0, body: '' })
    })
    req.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Two linked Machines, A connected to B. */
async function linkedPair(): Promise<{ a: BenchMachine; b: BenchMachine }> {
  const current = bench ?? newBench()
  const a = await current.machine('alpha')
  const b = await current.machine('beta')
  await current.link(a, b)
  return { a, b }
}

describe('the remembered certificate', () => {
  it('refuses a server with another certificate at B\'s address as "certificate changed"; the token never reaches it', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    const port = b.service.status().port ?? 0
    const token = secretsOf(a)[`outgoing:${bId}`] ?? ''
    expect(token).not.toBe('')
    await b.service.stop()

    // An impostor on B's port: its own certificate, recording every byte it receives after TLS.
    const own = await generateCertificate(randomUUID())
    const received: Buffer[] = []
    let reached = 0
    const impostor = tls.createServer({ key: own.key, cert: own.certificate, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: false }, (socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk))
      socket.on('error', () => undefined)
    })
    impostor.on('connection', () => {
      reached += 1
    })
    impostor.on('tlsClientError', () => undefined)
    await new Promise<void>((resolve, reject) => {
      impostor.once('error', reject)
      impostor.listen(port, '127.0.0.1', resolve)
    })
    try {
      const changed: string[] = []
      a.service.on('certificate-changed', ({ id }) => changed.push(id))
      const error = await rejection(a.service.connect(bId))
      expect(error).toBeInstanceOf(LinkConnectError)
      expect((error as LinkConnectError).kind).toBe('certificate-changed')
      expect(error.message).toMatch(/certificate changed/)
      expect(changed).toEqual([bId])
      expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ id: bId, certificateChanged: true })])
      await new Promise((resolve) => setTimeout(resolve, 100))
      // A did reach the impostor, and sent it nothing: no request line, no header, no token.
      expect(reached).toBe(1)
      expect(received).toEqual([])
      const bytes = Buffer.concat(received).toString('latin1')
      expect(bytes.includes(token)).toBe(false)
      expect(bytes).not.toMatch(/authorization/i)
    } finally {
      impostor.close()
    }
  })
})

describe('checks before the WebSocket handshake', () => {
  async function serverAndToken(): Promise<{ a: BenchMachine; b: BenchMachine; port: number; token: string }> {
    newBench()
    const { a, b } = await linkedPair()
    return { a, b, port: b.service.status().port ?? 0, token: secretsOf(a)[`outgoing:${b.service.machine.id}`] ?? '' }
  }

  it('passes a request without Origin, with the right Host, token and certificate', async () => {
    const { a, port, token } = await serverAndToken()
    expect(await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}` } })).toEqual({ status: 101, body: '' })
  })

  it('refuses a Host that is not this machine, or not with the server port, with 403', async () => {
    const { a, port, token } = await serverAndToken()
    const auth = { authorization: `Bearer ${token}` }
    for (const host of ['evil.example:' + port, `127.0.0.1:${port + 1}`, '127.0.0.1', `rebind.attacker.test:${port}`]) {
      expect(await upgrade(port, { client: a, headers: { ...auth, host } }), host).toEqual({ status: 403, body: 'forbidden' })
    }
    for (const host of [`localhost:${port}`, `beta.local:${port}`, `[::1]:${port}`]) {
      expect((await upgrade(port, { client: a, headers: { ...auth, host } })).status, host).toBe(101)
    }
  })

  it('refuses any Origin with 403, even with a valid token', async () => {
    const { a, port, token } = await serverAndToken()
    for (const origin of ['https://evil.example', `https://127.0.0.1:${port}`, 'null', 'file://']) {
      expect(await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}`, origin } }), origin).toEqual({ status: 403, body: 'forbidden' })
    }
  })

  it('refuses a missing or foreign token, or a valid token from another certificate, with 401', async () => {
    const { a, port, token } = await serverAndToken()
    const c = await bench!.machine('gamma')
    expect(await upgrade(port, { client: a })).toEqual({ status: 401, body: 'unauthorized' })
    expect(await upgrade(port, { client: a, headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` } })).toEqual({ status: 401, body: 'unauthorized' })
    expect(await upgrade(port, { client: c, headers: { authorization: `Bearer ${token}` } })).toEqual({ status: 401, body: 'unauthorized' })
    expect(await upgrade(port, { headers: { authorization: `Bearer ${token}` } })).toEqual({ status: 401, body: 'unauthorized' })
  })

  it('refuses another protocol version with a text naming both versions and the server build; the client passes it up as is', async () => {
    const { a, port, token } = await serverAndToken()
    const answer = await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}`, 'x-worfy-link-protocol': '2' } })
    expect(answer.status).toBe(400)
    expect(answer.body).toMatch(/link protocol 1/)
    expect(answer.body).toMatch(/speaks 2/)
    expect(answer.body).toMatch(/0\.2\.0\+bench/)

    const error = await rejection(
      openLinkSocket({ host: '127.0.0.1', port, path: '/link/connect', key: keyOf(a), certificate: certificateOf(a), expectFingerprint: a.service.linkedMachines()[0]?.fingerprint ?? '', token, protocolVersion: 2 }),
    )
    expect((error as LinkConnectError).kind).toBe('protocol')
    expect(error.message).toBe(answer.body)
  })
})

describe('IPC over the link', () => {
  it('answers link.ping with B\'s id and name; projects.list is not open and its handler is not called', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    await a.service.connect(bId)
    expect(await a.service.call(bId, 'link.ping')).toEqual({ ok: true, value: { id: bId, name: 'beta', protocol: 1, build: '0.2.0+bench' } })
    projectsCalls.count = 0
    expect(await a.service.call(bId, 'projects.list')).toEqual({ ok: false, error: 'projects.list: not open to Linked machines' })
    expect(projectsCalls.count).toBe(0)
    // And the other way round, over the same connection.
    expect(await b.service.call(a.service.machine.id, 'link.ping')).toEqual({ ok: true, value: expect.objectContaining({ id: a.service.machine.id, name: 'alpha' }) })
  })
})

describe('IPC handler modules', () => {
  it('are loaded at the first call over the link, not at the start of the service', async () => {
    const loads = { count: 0 }
    newBench({
      ipcModules: {
        './link.ts': () => {
          loads.count += 1
          return import('../../src/main/ipc/link').then((module) => module.default)
        },
      },
    })
    const { a, b } = await linkedPair()
    expect(loads.count).toBe(0)
    await a.service.connect(b.service.machine.id)
    expect((await a.service.call(b.service.machine.id, 'link.ping')).ok).toBe(true)
    expect(loads.count).toBe(1)
  })
})

describe('revoking', () => {
  it('closes the other side\'s connection within a second; it gets `revoked`, forgets this one, and its next entry is a 401', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const aId = a.service.machine.id
    const bId = b.service.machine.id
    // B connects to A this time; A revokes B.
    await b.service.connect(aId)
    const tokenOfB = secretsOf(b)[`outgoing:${aId}`] ?? ''
    bench!.rememberTokens()
    const forgotten = new Promise<{ id: string; by: string }>((resolve) => b.service.once('unlinked', resolve))
    const closed = new Promise<void>((resolve) => b.service.once('disconnected', () => resolve()))
    const started = Date.now()
    a.service.revoke(bId)
    await closed
    expect(Date.now() - started).toBeLessThan(1000)
    expect(await forgotten).toEqual({ id: aId, name: 'alpha', by: 'other-machine' })
    expect(b.service.linkedMachines()).toEqual([])
    expect(a.service.linkedMachines()).toEqual([])

    // A listens again for another reason; B's old token and certificate get a 401.
    await a.service.openLinking()
    const answer = await upgrade(a.service.status().port ?? 0, { client: b, headers: { authorization: `Bearer ${tokenOfB}` } })
    expect(answer).toEqual({ status: 401, body: 'unauthorized' })
  })

  it('a Machine that was offline during the revoke gets 401 on its next entry and forgets the other', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const aId = a.service.machine.id
    bench!.rememberTokens()
    await b.service.stop()
    a.service.revoke(b.service.machine.id)
    expect(a.service.linkedMachines()).toEqual([])
    await a.service.openLinking()

    await bench!.restart(b)
    const forgotten = new Promise<{ id: string; by: string }>((resolve) => b.service.once('unlinked', resolve))
    const error = await rejection(b.service.connect(aId))
    expect((error as LinkConnectError).kind).toBe('unauthorized')
    expect(await forgotten).toEqual({ id: aId, name: 'alpha', by: 'other-machine' })
    expect(b.service.linkedMachines()).toEqual([])
    expect(secretsOf(b)[`outgoing:${aId}`]).toBeUndefined()
  })
})

describe('when the server listens', () => {
  /** Whether something accepts TCP connections on 127.0.0.1:port. */
  const accepts = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = netConnect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })

  it('does not listen over a fresh data folder, listens once linked, and stops after the last Linked machine is revoked', async () => {
    newBench()
    const a = await bench!.machine('alpha')
    const b = await bench!.machine('beta')
    expect(a.service.status()).toMatchObject({ listening: false, port: null })
    expect(b.service.status()).toMatchObject({ listening: false, port: null })
    expect(linkFile<{ port: number | null }>(a, 'machine.json').port).toBeNull()

    await bench!.link(a, b)
    const portA = a.service.status().port ?? 0
    const portB = b.service.status().port ?? 0
    // Both listen at once, on different ports.
    expect(a.service.status().listening).toBe(true)
    expect(b.service.status().listening).toBe(true)
    expect(portA).not.toBe(portB)
    expect(await accepts(portA)).toBe(true)
    expect(await accepts(portB)).toBe(true)

    await a.service.connect(b.service.machine.id)
    const bForgot = new Promise((resolve) => b.service.once('unlinked', resolve))
    a.service.revoke(b.service.machine.id)
    await bForgot
    await a.service.settled()
    await b.service.settled()
    expect(a.service.status().listening).toBe(false)
    expect(b.service.status().listening).toBe(false)
    expect(await accepts(portA)).toBe(false)
    expect(await accepts(portB)).toBe(false)
  })

  it('keeps the port across a restart', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const port = b.service.status().port
    await bench!.restart(b)
    expect(b.service.status()).toMatchObject({ listening: true, port })
    await a.service.connect(b.service.machine.id)
  })
})

describe('service messages', () => {
  it('delivers a registered message from A to B; one outside the schema is dropped before the handler', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const note = defineLinkMessage('test.note', z.object({ text: z.string() }))
    const received: { payload: unknown; from: string }[] = []
    b.service.registerMessage(note, (payload, from) => {
      received.push({ payload, from: from.machineId })
    })
    await a.service.connect(b.service.machine.id)
    a.service.sendMessage(b.service.machine.id, note, { text: 'hello from A' })
    await expect.poll(() => received.length).toBe(1)
    expect(received[0]).toEqual({ payload: { text: 'hello from A' }, from: a.service.machine.id })

    // A sender with a looser idea of the message: B parses with its own schema and drops it.
    const loose = defineLinkMessage('test.note', z.object({ text: z.number() }))
    a.service.sendMessage(b.service.machine.id, loose, { text: 42 })
    a.service.sendMessage(b.service.machine.id, note, { text: 'second' })
    await expect.poll(() => received.length).toBe(2)
    expect(received[1]?.payload).toEqual({ text: 'second' })
    expect(bench!.captured.some((line) => line.includes('test.note outside its schema'))).toBe(true)
    // The sender refuses a payload outside its own schema.
    expect(() => a.service.sendMessage(b.service.machine.id, note, { text: 1 } as never)).toThrow(/does not match its schema/)
  })
})

describe('the heartbeat', () => {
  it('drops a connection whose peer stops answering pings, and says so with close', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, autoPong: false })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise((resolve) => ws.once('open', resolve))
    const connection = new LinkConnection(ws, randomUUID(), 'out', { pingIntervalMs: 50, warn: () => undefined })
    const started = Date.now()
    await new Promise<void>((resolve) => connection.once('close', () => resolve()))
    expect(Date.now() - started).toBeLessThan(1000)
    server.close()
  })

  it('reports the end of a connection as disconnected', async () => {
    newBench()
    const { a, b } = await linkedPair()
    await a.service.connect(b.service.machine.id)
    const gone = new Promise((resolve) => a.service.once('disconnected', resolve))
    await b.service.stop()
    expect(await gone).toEqual({ id: b.service.machine.id, name: 'beta' })
    expect(a.service.isConnected(b.service.machine.id)).toBe(false)
  })
})
