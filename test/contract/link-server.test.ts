// The link server and connections (worfy-link ticket 01; ADR-0052, points 5–9): the remembered
// certificate, the checks before the WebSocket handshake, IPC over the link, revoking, when the
// server listens, and service messages. Services run over temporary data folders on 127.0.0.1
// (test/contract/link-bench.ts).
import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer as createHttpsServer, request } from 'node:https'
import { createServer as createNetServer, connect as netConnect, type Socket } from 'node:net'
import tls from 'node:tls'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineHandler, type HandlerModule } from '../../src/main/ipc/index'
import { LinkConnectError, openLinkSocket } from '../../src/main/link/client'
import { LinkConnection } from '../../src/main/link/connection'
import { generateCertificate } from '../../src/main/link/identity'
import { localMachineOf } from '../../src/main/link/ipc-adapter'
import { CONNECT_PATH, defineLinkMessage, helloMessage, LINK_MAX_PAYLOAD, LINK_PROTOCOL_VERSION, MAX_ACCEPTS, PAIR_PATH, PAIRING_MAX_PAYLOAD } from '../../src/main/link/messages'
import { startLinkServer } from '../../src/main/link/server'
import { linkPing } from '../../src/shared/ipc/link'
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
        'x-worfy-link-protocol': String(LINK_PROTOCOL_VERSION),
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
    const other = LINK_PROTOCOL_VERSION + 1
    const answer = await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}`, 'x-worfy-link-protocol': String(other) } })
    expect(answer.status).toBe(400)
    expect(answer.body).toMatch(new RegExp(`link protocol ${LINK_PROTOCOL_VERSION},`))
    expect(answer.body).toMatch(new RegExp(`speaks ${other}\\.`))
    expect(answer.body).toMatch(/0\.2\.0\+bench/)

    const error = await rejection(
      openLinkSocket({ host: '127.0.0.1', port, path: '/link/connect', key: keyOf(a), certificate: certificateOf(a), expectFingerprint: a.service.linkedMachines()[0]?.fingerprint ?? '', token, protocolVersion: other }),
    )
    expect((error as LinkConnectError).kind).toBe('protocol')
    expect(error.message).toBe(answer.body)
  })

  it('refuses a worfy of link protocol 2, whose screens send their terminal answers unmarked; the link stays, and protocol 3 connects without pairing again (worfy-windows ticket 39)', async () => {
    // Protocol 3: `terminal.input` carries `reply`, and main answers the cursor-position requests
    // itself. An older view's unmarked answer would reach the shell as a second answer to each.
    expect(LINK_PROTOCOL_VERSION).toBe(3)
    const { a, b, port, token } = await serverAndToken()
    const old = await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}`, 'x-worfy-link-protocol': '2' } })
    expect(old.status).toBe(400)
    expect(old.body).toMatch(/speaks link protocol 3, the connecting worfy speaks 2\. Update both to the same version\./)
    // The pairing is the same: no protocol is kept with it (store.ts), only the key confirmation of a new pairing names one.
    expect(await upgrade(port, { client: a, headers: { authorization: `Bearer ${token}` } })).toEqual({ status: 101, body: '' })
    await a.service.connect(b.service.machine.id)
    expect(await a.service.call(b.service.machine.id, 'link.ping')).toMatchObject({ ok: true, value: { protocol: 3 } })
  })
})

describe('IPC over the link', () => {
  it('answers link.ping with B\'s id and name; projects.list is not open and its handler is not called', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    await a.service.connect(bId)
    expect(await a.service.call(bId, 'link.ping')).toEqual({ ok: true, value: { id: bId, name: 'beta', protocol: LINK_PROTOCOL_VERSION, build: '0.2.0+bench' } })
    projectsCalls.count = 0
    expect(await a.service.call(bId, 'projects.list')).toEqual({ ok: false, error: 'Linked machines cannot work with the Projects of beta: access is off' })
    expect(projectsCalls.count).toBe(0)
    // And the other way round, over the same connection.
    expect(await b.service.call(a.service.machine.id, 'link.ping')).toEqual({ ok: true, value: expect.objectContaining({ id: a.service.machine.id, name: 'alpha' }) })
  })

  it(`answers a call whose answer is over ${LINK_MAX_PAYLOAD} bytes with an error; the next call on the same connection passes`, async () => {
    // 'é' is one UTF-16 unit but two UTF-8 bytes: the name is under the limit in string length and
    // over it in the bytes the receiver counts. Built once, about 8 MB.
    const huge = 'é'.repeat(LINK_MAX_PAYLOAD / 2 + 1)
    let answers = 0
    const bigPing: HandlerModule = [
      defineHandler(linkPing, (_input, { event }) => {
        const machine = localMachineOf(event)
        if (machine === undefined) throw new Error('not a link call')
        answers += 1
        return answers === 1 ? { ...machine, name: huge } : machine
      }),
    ]
    newBench({ ipcModules: { './link.ts': () => Promise.resolve(bigPing) } })
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    await a.service.connect(bId)
    const connection = a.service.connectionTo(bId)
    expect(await a.service.call(bId, 'link.ping')).toEqual({ ok: false, error: 'link.ping: the answer is too large to send over the link' })
    expect(await a.service.call(bId, 'link.ping')).toEqual({ ok: true, value: expect.objectContaining({ id: bId, name: 'beta' }) })
    expect(a.service.connectionTo(bId)).toBe(connection)
    expect(connection?.isOpen).toBe(true)
    expect(answers).toBe(2)
  })

  it(`sends an answer of exactly ${LINK_MAX_PAYLOAD} bytes as it is, and one byte more as an error that fits`, () => {
    const sent: string[] = []
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: (text: string) => sent.push(text), ping: () => undefined })
    const warnings: string[] = []
    const connection = new LinkConnection(ws as unknown as WebSocket, randomUUID(), 'in', { pingIntervalMs: 60_000, warn: (message) => warnings.push(message) })
    const frameBytes = (value: string): number => Buffer.byteLength(JSON.stringify({ t: 'result', id: 7, result: { ok: true, value } }))
    const room = LINK_MAX_PAYLOAD - frameBytes('')
    const exact = 'é'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2)
    expect(frameBytes(exact)).toBe(LINK_MAX_PAYLOAD)
    connection.answer(7, 'link.ping', { ok: true, value: exact })
    connection.answer(7, 'link.ping', { ok: true, value: `${exact}a` })
    expect(sent).toHaveLength(2)
    expect(Buffer.byteLength(sent[0] ?? '')).toBe(LINK_MAX_PAYLOAD)
    expect(JSON.parse(sent[1] ?? '')).toEqual({ t: 'result', id: 7, result: { ok: false, error: 'link.ping: the answer is too large to send over the link' } })
    expect(warnings).toEqual([expect.stringContaining(`the answer to link.ping is ${LINK_MAX_PAYLOAD + 1} bytes`)])
    ws.emit('close', 1000)
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

describe('the messages a Machine accepts (ADR-0079)', () => {
  const hello = { id: randomUUID(), name: 'beta', protocol: LINK_PROTOCOL_VERSION, build: '0.2.0+bench', port: 4100 }

  it('`hello` with `accepts` and without it passes; at most 200 names of 1 to 200 characters', () => {
    expect(helloMessage.schema.parse(hello)).toEqual(hello)
    expect(helloMessage.schema.parse({ ...hello, accepts: ['note', 'ticket-note'] })).toEqual({ ...hello, accepts: ['note', 'ticket-note'] })
    const names = Array.from({ length: MAX_ACCEPTS }, (_, index) => `m${index}`)
    expect(helloMessage.schema.safeParse({ ...hello, accepts: names }).success).toBe(true)
    expect(helloMessage.schema.safeParse({ ...hello, accepts: [...names, 'one-more'] }).success).toBe(false)
    expect(helloMessage.schema.safeParse({ ...hello, accepts: [''] }).success).toBe(false)
    expect(helloMessage.schema.safeParse({ ...hello, accepts: ['x'.repeat(201)] }).success).toBe(false)
  })

  it('two real link services: a message is named for the Machine that registered it, also after the connection opened; a `hello` without `accepts` names nothing and the connection stays', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const aId = a.service.machine.id
    const bId = b.service.machine.id
    const early = defineLinkMessage('test.early', z.object({ text: z.string() }))
    const later = defineLinkMessage('test.later', z.object({}))
    const received: string[] = []
    b.service.registerMessage(early, ({ text }) => {
      received.push(text)
    })
    expect(a.service.accepts(bId, early)).toBe(false)
    await a.service.connect(bId)
    await expect.poll(() => a.service.accepts(bId, early)).toBe(true)
    a.service.sendMessage(bId, early, { text: 'to B, which named it' })
    await expect.poll(() => received).toEqual(['to B, which named it'])
    // A did not register it: B does not count on A for it.
    await expect.poll(() => b.service.isConnected(aId)).toBe(true)
    expect(b.service.accepts(aId, early)).toBe(false)

    // Registered after the connection opened: B says `hello` again, and A learns it.
    expect(a.service.accepts(bId, later)).toBe(false)
    b.service.registerMessage(later, () => undefined)
    await expect.poll(() => a.service.accepts(bId, later)).toBe(true)

    // A build before ADR-0079: its `hello` has no `accepts`. Nothing is named, the link stays.
    b.service.connectionTo(aId)?.send({ t: 'msg', name: helloMessage.name, payload: { ...hello, id: bId, name: b.service.machine.name } })
    await expect.poll(() => a.service.accepts(bId, early)).toBe(false)
    expect(a.service.accepts(bId, later)).toBe(false)
    expect(a.service.isConnected(bId)).toBe(true)
    // A Machine that is not connected accepts nothing.
    expect(a.service.accepts(randomUUID(), early)).toBe(false)
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

/** Resolves with the close code of `ws`, or 'still open' after `ms`. */
function closeCode(ws: WebSocket, ms = 1000): Promise<number | 'still open'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('still open'), ms)
    ws.once('close', (code: number) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/** B's own connection to A, opened as a bare socket that acts on nothing it receives. */
async function bareConnection(from: BenchMachine, to: BenchMachine): Promise<WebSocket> {
  const toId = to.service.machine.id
  const record = from.service.linkedMachines().find((machine) => machine.id === toId)
  const { ws } = await openLinkSocket({
    host: '127.0.0.1',
    port: to.service.status().port ?? 0,
    path: CONNECT_PATH,
    key: keyOf(from),
    certificate: certificateOf(from),
    expectFingerprint: record?.fingerprint ?? '',
    token: secretsOf(from)[`outgoing:${toId}`] ?? '',
  })
  return ws
}

describe('round 2: revoking closes from this side', () => {
  it('A itself closes the connection with 4003 within a second, even when B ignores `revoked`', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    bench!.rememberTokens()
    const ws = await bareConnection(b, a)
    const received: string[] = []
    ws.on('message', (data) => received.push(String(data)))
    await expect.poll(() => a.service.isConnected(bId)).toBe(true)
    const code = closeCode(ws)
    const started = Date.now()
    a.service.revoke(bId)
    expect(await code).toBe(4003)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(received.some((frame) => frame.includes('"revoked"'))).toBe(true)
  })
})

describe('round 2: a peer outside the local network', () => {
  it('is dropped on the TCP connection, before the TLS handshake shows the certificate', async () => {
    const own = await generateCertificate(randomUUID())
    const server = await startLinkServer({
      key: own.key,
      certificate: own.certificate,
      host: '127.0.0.1',
      port: 0,
      build: '0.2.0+bench',
      hostNames: () => ({ interfaces: {}, hostname: 'bench.local', tailscale: false }),
      admit: () => ({ status: 403, body: 'forbidden' }),
      // 127.0.0.1 stands in for an address outside the local network.
      isAllowedPeer: () => false,
    })
    try {
      const outcome = await new Promise<string>((resolve) => {
        const socket = tls.connect({ host: '127.0.0.1', port: server.port, rejectUnauthorized: false, minVersion: 'TLSv1.3' })
        socket.once('secureConnect', () => {
          resolve(`handshake done, certificate ${socket.getPeerCertificate().subject?.CN ?? ''}`)
          socket.destroy()
        })
        socket.once('error', () => resolve('dropped'))
        socket.once('close', () => resolve('dropped'))
      })
      expect(outcome).toBe('dropped')
    } finally {
      server.close()
    }
  })
})

// worfy-link ticket 27 (ADR-0070, points 3 and 4). The bench servers read 127.0.0.1 as the
// addresses given here (link-bench.ts, peerAddresses), and every bench machine has `local` on an
// interface: a peer at a Tailscale address without a tailnet in the test.
describe('a peer at a Tailscale address', () => {
  const TAILNET = { remote: '100.101.2.3', local: '100.100.7.9' }

  /** A raw TLS connection to `port`: whether the handshake completed or the server dropped it first. */
  function handshake(port: number): Promise<'handshake' | 'dropped'> {
    return new Promise((resolve) => {
      const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false, minVersion: 'TLSv1.3' })
      socket.once('secureConnect', () => {
        resolve('handshake')
        socket.destroy()
      })
      socket.once('error', () => resolve('dropped'))
      socket.once('close', () => resolve('dropped'))
    })
  }

  /** Machine beta, listening with "Link a machine" open. */
  async function listening(peerAddresses: { remote: string; local: string }): Promise<{ b: BenchMachine; port: number }> {
    newBench({ peerAddresses })
    const b = await bench!.machine('beta')
    await bench!.codeOf(b)
    return { b, port: bench!.portOf(b) }
  }

  it('is dropped before the TLS handshake while "Link through Tailscale" is off, and gets through once it is on, without a restart', async () => {
    const { b, port } = await listening(TAILNET)
    expect(b.service.settings.get().tailscale).toBe(false)
    expect(await handshake(port)).toBe('dropped')
    b.service.settings.set({ tailscale: true })
    expect(await handshake(port)).toBe('handshake')
    b.service.settings.set({ tailscale: false })
    expect(await handshake(port)).toBe('dropped')
  })

  it('an IPv6 Tailscale address no longer passes as a local fc00::/7 one: dropped while off, through while on', async () => {
    const { b, port } = await listening({ remote: 'fd7a:115c:a1e0::2', local: 'fd7a:115c:a1e0::7' })
    expect(await handshake(port)).toBe('dropped')
    b.service.settings.set({ tailscale: true })
    expect(await handshake(port)).toBe('handshake')
  })

  it('a peer in 100.64.0.0/10 that arrived on the home network address (a carrier-grade NAT neighbour) is dropped with the setting on', async () => {
    const { b, port } = await listening({ remote: '100.101.2.3', local: '192.168.0.119' })
    b.service.settings.set({ tailscale: true })
    expect(await handshake(port)).toBe('dropped')
  })

  it('the upgrade reads the setting again: off between the TLS handshake and the request gets 403', async () => {
    const { b, port } = await listening(TAILNET)
    b.service.settings.set({ tailscale: true })
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false, minVersion: 'TLSv1.3' })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('secureConnect', resolve)
        socket.once('error', reject)
      })
      b.service.settings.set({ tailscale: false })
      const answer = new Promise<string>((resolve) => {
        let text = ''
        socket.on('data', (chunk: Buffer) => (text += chunk.toString('latin1')))
        socket.once('close', () => resolve(text))
        socket.once('error', () => resolve(text))
      })
      socket.write(
        [
          `GET ${PAIR_PATH} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          `x-worfy-link-protocol: ${LINK_PROTOCOL_VERSION}`,
          '',
          '',
        ].join('\r\n'),
      )
      // The common check's refusal, not the pairing endpoint's own (this request has no client certificate).
      const text = await answer
      expect(text.split('\r\n')[0]).toBe('HTTP/1.1 403 Forbidden')
      expect(text.split('\r\n\r\n')[1]).toBe('forbidden')
    } finally {
      socket.destroy()
    }
  })

  it('turning the setting off closes an open connection from a Tailscale address; another switch does not', async () => {
    newBench({ peerAddresses: TAILNET })
    const a = await bench!.machine('alpha')
    const b = await bench!.machine('beta')
    // Both Machines: alpha does not dial a Tailscale address with its own setting off.
    a.service.settings.set({ tailscale: true })
    b.service.settings.set({ tailscale: true })
    await bench!.link(a, b)
    const aId = a.service.machine.id
    await a.service.connect(b.service.machine.id)
    await expect.poll(() => b.service.isConnected(aId)).toBe(true)
    b.service.settings.set({ keepAwake: false })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(b.service.isConnected(aId)).toBe(true)
    const gone = new Promise((resolve) => a.service.once('disconnected', resolve))
    b.service.settings.set({ tailscale: false })
    expect(await gone).toEqual({ id: b.service.machine.id, name: 'beta' })
    await expect.poll(() => b.service.isConnected(aId)).toBe(false)
  })

  it('turning the setting off leaves a connection from the local network open', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const aId = a.service.machine.id
    b.service.settings.set({ tailscale: true })
    await a.service.connect(b.service.machine.id)
    await expect.poll(() => b.service.isConnected(aId)).toBe(true)
    b.service.settings.set({ tailscale: false })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(b.service.isConnected(aId)).toBe(true)
    expect(a.service.isConnected(b.service.machine.id)).toBe(true)
  })

  it('turning the setting off cuts a pairing attempt from a Tailscale address', async () => {
    newBench({ peerAddresses: TAILNET })
    const b = await bench!.machine('beta')
    const c = await bench!.machine('gamma')
    b.service.settings.set({ tailscale: true })
    await bench!.codeOf(b)
    const { ws } = await openLinkSocket({ host: '127.0.0.1', port: bench!.portOf(b), path: PAIR_PATH, key: keyOf(c), certificate: certificateOf(c) })
    const code = closeCode(ws)
    b.service.settings.set({ tailscale: false })
    expect(await code).not.toBe('still open')
  })
})

// The fix round of worfy-link ticket 27: ADR-0070 wants the setting on on both Machines, so this
// Machine with it off does not dial a Tailscale address either, and switching it off cuts its own
// dials to one. The bench reads every socket as TAILNET: 127.0.0.1 stands in for a Tailscale address.
describe('dialing a Tailscale address from this Machine', () => {
  const TAILNET = { remote: '100.101.2.3', local: '100.100.7.9' }
  const REFUSAL = /^127\.0\.0\.1 is at the Tailscale address 100\.101\.2\.3, and "Link through Tailscale" is off on this Machine: turn it on in Settings → Machines$/

  /** Two Machines with the setting on, linked over the tailnet; alpha dials beta. */
  async function linkedOverTailnet(options: ConstructorParameters<typeof LinkBench>[0] = {}): Promise<{ a: BenchMachine; b: BenchMachine }> {
    newBench({ peerAddresses: TAILNET, ...options })
    const a = await bench!.machine('alpha')
    const b = await bench!.machine('beta')
    a.service.settings.set({ tailscale: true })
    b.service.settings.set({ tailscale: true })
    await bench!.link(a, b)
    return { a, b }
  }

  /** A TCP server on 127.0.0.1 that counts the bytes it gets and hangs up on the first. */
  async function byteCounter(): Promise<{ port: number; received: () => number; connections: () => number; close: () => void }> {
    let received = 0
    let connections = 0
    const server = createNetServer((socket) => {
      connections += 1
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length
        socket.destroy()
      })
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    return { port: typeof address === 'object' && address !== null ? address.port : 0, received: () => received, connections: () => connections, close: () => server.close() }
  }

  it('with the setting off, connect and pair are refused on TCP, before any byte of TLS, with a reason for the user', async () => {
    const { a, b } = await linkedOverTailnet()
    const bId = b.service.machine.id
    a.service.settings.set({ tailscale: false })
    const counter = await byteCounter()
    try {
      const viaError = await rejection(a.service.connect(bId, { host: '127.0.0.1', port: counter.port }))
      expect(viaError.message).toMatch(REFUSAL)
      const pairError = await rejection(a.service.pair({ host: '127.0.0.1', port: counter.port, code: '123456' }))
      expect(pairError.message).toMatch(REFUSAL)
      // TCP reached the address, TLS did not: not one byte, the ClientHello included.
      await expect.poll(() => counter.connections()).toBe(2)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(counter.received()).toBe(0)
    } finally {
      counter.close()
    }
    // The remembered address (what connections.ts redials) is refused the same way.
    const remembered = await rejection(a.service.connect(bId))
    expect(remembered).toBeInstanceOf(LinkConnectError)
    expect((remembered as LinkConnectError).kind).toBe('refused')
    expect(remembered.message).toMatch(REFUSAL)
    expect(a.service.isConnected(bId)).toBe(false)
    expect(b.service.isConnected(a.service.machine.id)).toBe(false)
    // On again, the same dial goes through.
    a.service.settings.set({ tailscale: true })
    await a.service.connect(bId)
    expect(a.service.isConnected(bId)).toBe(true)
  })

  it('the setting switched off during the TLS handshake of a dial: the opened socket is cut and connect fails', async () => {
    let port = 0
    let armed = false
    const dialer: { machine?: BenchMachine } = {}
    const { a: alpha, b } = await linkedOverTailnet({
      addressesOf: (socket) => {
        // alpha's own dial to beta: the check on TCP passes, then the setting goes off before TLS ends.
        if (armed && (socket as Socket).remotePort === port) {
          armed = false
          setImmediate(() => dialer.machine?.service.settings.set({ tailscale: false }))
        }
        return { ...TAILNET }
      },
    })
    dialer.machine = alpha
    port = bench!.portOf(b)
    const bId = b.service.machine.id
    armed = true
    const error = await rejection(alpha.service.connect(bId))
    expect(armed).toBe(false)
    expect(alpha.service.settings.get().tailscale).toBe(false)
    expect(error.message).toMatch(REFUSAL)
    expect(alpha.service.isConnected(bId)).toBe(false)
    await expect.poll(() => b.service.isConnected(alpha.service.machine.id)).toBe(false)
  })

  it('switching the setting off cuts this Machine\'s own open connection to a Tailscale address', async () => {
    const { a, b } = await linkedOverTailnet()
    const bId = b.service.machine.id
    await a.service.connect(bId)
    expect(a.service.isConnected(bId)).toBe(true)
    const gone = new Promise((resolve) => b.service.once('disconnected', resolve))
    a.service.settings.set({ tailscale: false })
    expect(a.service.isConnected(bId)).toBe(false)
    expect(await gone).toEqual({ id: a.service.machine.id, name: 'alpha' })
  })

  it('switching the setting off cuts this Machine\'s own pairing attempt to a Tailscale address at once', async () => {
    newBench({ peerAddresses: TAILNET })
    const a = await bench!.machine('alpha')
    a.service.settings.set({ tailscale: true })
    // A pairing server that never answers: alpha would wait out the step timeout (15 s).
    const own = await generateCertificate(randomUUID())
    const server = createHttpsServer({ key: own.key, cert: own.certificate })
    const wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => ws.once('message', () => a.service.settings.set({ tailscale: false })))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    try {
      const started = Date.now()
      const outcome = await Promise.race([
        a.service.pair({ host: '127.0.0.1', port: typeof address === 'object' && address !== null ? address.port : 0, code: '123456' }).then(
          () => 'linked',
          (error: unknown) => {
            errors.push(error instanceof Error ? error.message : String(error))
            return 'failed'
          },
        ),
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 3000)),
      ])
      expect(outcome).toBe('failed')
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      wss.close()
      server.close()
    }
  })
})

describe('round 2: message size limits', () => {
  it(`the server closes a pairing socket that sends more than ${PAIRING_MAX_PAYLOAD} bytes with 1009`, async () => {
    newBench()
    const b = await bench!.machine('beta')
    const c = await bench!.machine('gamma')
    await bench!.codeOf(b)
    const { ws } = await openLinkSocket({ host: '127.0.0.1', port: bench!.portOf(b), path: PAIR_PATH, key: keyOf(c), certificate: certificateOf(c) })
    const code = closeCode(ws)
    ws.send('x'.repeat(PAIRING_MAX_PAYLOAD + 1))
    expect(await code).toBe(1009)
  })

  it(`the server closes a connection that sends more than ${LINK_MAX_PAYLOAD} bytes with 1009`, async () => {
    newBench()
    const { a, b } = await linkedPair()
    bench!.rememberTokens()
    const ws = await bareConnection(a, b)
    const code = closeCode(ws, 5000)
    ws.send('x'.repeat(LINK_MAX_PAYLOAD + 1))
    expect(await code).toBe(1009)
  })

  /** A plain wss server on 127.0.0.1 that sends `size` bytes to whoever connects. */
  async function sender(size: number): Promise<{ port: number; close: () => void }> {
    const own = await generateCertificate(randomUUID())
    const server = createHttpsServer({ key: own.key, cert: own.certificate })
    const wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => ws.send('y'.repeat(size)))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    return {
      port: typeof address === 'object' && address !== null ? address.port : 0,
      close: () => {
        wss.close()
        server.close()
      },
    }
  }

  it.each([
    [PAIR_PATH, PAIRING_MAX_PAYLOAD],
    [CONNECT_PATH, LINK_MAX_PAYLOAD],
  ])('the client on %s refuses a message over %i bytes and drops the connection', async (path, limit) => {
    const own = await generateCertificate(randomUUID())
    const server = await sender(limit + 1)
    try {
      const { ws } = await openLinkSocket({ host: '127.0.0.1', port: server.port, path, key: own.key, certificate: own.certificate })
      const errors: string[] = []
      let delivered = false
      ws.on('error', (error: Error & { code?: string }) => errors.push(error.code ?? error.message))
      ws.on('message', () => {
        delivered = true
      })
      expect(await closeCode(ws, 5000)).not.toBe('still open')
      expect(errors).toEqual(['WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'])
      expect(delivered).toBe(false)
    } finally {
      server.close()
    }
  })
})

describe('round 2: re-linking and races', () => {
  it('linking a Machine again closes the connections opened with the old tokens, on both sides', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    const aId = a.service.machine.id
    await a.service.connect(bId)
    await expect.poll(() => b.service.isConnected(aId)).toBe(true)
    bench!.rememberTokens()
    const oldToken = secretsOf(a)[`outgoing:${bId}`] ?? ''

    await bench!.link(a, b)
    await expect.poll(() => a.service.isConnected(bId)).toBe(false)
    await expect.poll(() => b.service.isConnected(aId)).toBe(false)
    expect(await upgrade(b.service.status().port ?? 0, { client: a, headers: { authorization: `Bearer ${oldToken}` } })).toEqual({ status: 401, body: 'unauthorized' })
    await a.service.connect(bId)
    expect((await a.service.call(bId, 'link.ping')).ok).toBe(true)
  })

  it('a connect that was overtaken by a new link is closed and refused', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const bId = b.service.machine.id
    const connecting = rejection(a.service.connect(bId))
    // As if a new link had replaced the token while the connection was being opened.
    ;(a.service as unknown as { secrets: { set(key: string, value: string): void } }).secrets.set(`outgoing:${bId}`, randomBytes(32).toString('base64url'))
    expect((await connecting).message).toMatch(/linked again while connecting/)
    expect(a.service.isConnected(bId)).toBe(false)
  })

  it('frames that arrive after this side started closing are not acted on', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const aId = a.service.machine.id
    const note = defineLinkMessage('test.late', z.object({ n: z.number() }))
    const received: number[] = []
    b.service.registerMessage(note, ({ n }) => {
      received.push(n)
    })
    await a.service.connect(b.service.machine.id)
    await expect.poll(() => b.service.isConnected(aId)).toBe(true)
    a.service.sendMessage(b.service.machine.id, note, { n: 1 })
    await expect.poll(() => received).toEqual([1])
    a.service.sendMessage(b.service.machine.id, note, { n: 2 })
    // B starts closing before the frame above reaches it.
    const connections = (b.service as unknown as { connections: Map<string, Set<LinkConnection>> }).connections
    for (const connection of connections.get(aId) ?? []) connection.close(4004, 'test')
    await expect.poll(() => b.service.isConnected(aId)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(received).toEqual([1])
  })
})
