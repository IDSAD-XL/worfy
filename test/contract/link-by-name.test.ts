// A Machine reached by its host name (worfy-link ticket 29; ADR-0070, point 5): the Host check of
// the link server takes this machine's MagicDNS names only while "Link through Tailscale" is on, a
// Machine linked by a name is remembered by it and reconnected by it, and a dial by a name sends it
// as the TLS server name (SNI). Bench machine `beta` has os.hostname() `beta.local`, so its MagicDNS
// names are `beta` and `beta.<tailnet>.ts.net`. Services run over temporary data folders on 127.0.0.1
// (test/contract/link-bench.ts); `localhost` stands in for a MagicDNS name the resolver knows.
import { randomBytes, randomUUID } from 'node:crypto'
import { request } from 'node:https'
import tls from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { LinkConnectError, openLinkSocket } from '../../src/main/link/client'
import { generateCertificate } from '../../src/main/link/identity'
import { CONNECT_PATH, LINK_PROTOCOL_VERSION } from '../../src/main/link/messages'
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

function newBench(): LinkBench {
  bench = new LinkBench()
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

/** A raw WebSocket upgrade request to the link server: the status of its answer and the body. */
function upgrade(port: number, options: { headers: Record<string, string>; client: BenchMachine }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: CONNECT_PATH,
      method: 'GET',
      rejectUnauthorized: false,
      key: keyOf(options.client),
      cert: certificateOf(options.client),
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
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

describe('a Machine reached by name', () => {
  it('passes Host beta:<port> and beta.<tailnet>.ts.net to the upgrade while "Link through Tailscale" is on, and refuses them once it is off', async () => {
    newBench()
    const { a, b } = await linkedPair()
    const port = b.service.status().port ?? 0
    const auth = { authorization: `Bearer ${secretsOf(a)[`outgoing:${b.service.machine.id}`] ?? ''}` }
    const names = [`beta:${port}`, `BETA:${port}`, `beta.example.ts.net:${port}`]

    for (const host of names) expect(await upgrade(port, { client: a, headers: { ...auth, host } }), host).toEqual({ status: 403, body: 'forbidden' })
    b.service.settings.set({ tailscale: true })
    for (const host of names) expect((await upgrade(port, { client: a, headers: { ...auth, host } })).status, host).toBe(101)
    // Another machine of the tailnet, or a name that only looks like this one: still refused.
    for (const host of [`alpha.example.ts.net:${port}`, `alpha:${port}`, `beta.example.ts.net.attacker.test:${port}`, `beta:${port + 1}`]) {
      expect(await upgrade(port, { client: a, headers: { ...auth, host } }), host).toEqual({ status: 403, body: 'forbidden' })
    }
    // Read on every request: off refuses the next one without a restart.
    b.service.settings.set({ tailscale: false })
    for (const host of names) expect(await upgrade(port, { client: a, headers: { ...auth, host } }), host).toEqual({ status: 403, body: 'forbidden' })
  })

  it('links by a host name, remembers the name and connects by it again after a restart', async () => {
    const current = newBench()
    const a = await current.machine('alpha')
    const b = await current.machine('beta')
    const code = await current.codeOf(b)
    // `localhost` is a name the resolver of the test machine knows: the dial resolves it, as it
    // would resolve a MagicDNS name, and sends it as the TLS server name.
    const linked = await a.service.pair({ host: 'localhost', port: current.portOf(b), code })
    await b.service.closeLinking()
    expect(linked).toEqual(expect.objectContaining({ id: b.service.machine.id, address: 'localhost', port: current.portOf(b) }))

    await current.restart(a)
    await a.service.connect(b.service.machine.id)
    expect(a.service.isConnected(b.service.machine.id)).toBe(true)
    expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ address: 'localhost' })])
  })

  it('sends a host name as the TLS server name, and no server name for an address', async () => {
    const own = await generateCertificate(randomUUID())
    const client = await generateCertificate(randomUUID())
    const served: (string | false | null)[] = []
    const server = tls.createServer({ key: own.key, cert: own.certificate, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: false }, (socket) => {
      served.push(socket.servername)
      socket.destroy()
    })
    server.on('tlsClientError', () => undefined)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      for (const host of ['localhost', '127.0.0.1']) {
        const error = await rejection(openLinkSocket({ host, port, path: CONNECT_PATH, key: client.key, certificate: client.certificate }))
        expect(error, host).toBeInstanceOf(LinkConnectError)
      }
      expect(served).toEqual(['localhost', false])
    } finally {
      server.close()
    }
  })
})
