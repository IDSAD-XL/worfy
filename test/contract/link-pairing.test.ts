// Pairing two Machines by a 6-digit code (worfy-link ticket 01; ADR-0052, point 4): what each side
// stores, where the secrets live, the one-time code, and a machine in the middle. Every service
// runs over its own temporary data folder on 127.0.0.1 (test/contract/link-bench.ts).
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tls from 'node:tls'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openLinkSocket } from '../../src/main/link/client'
import { fingerprintOf, generateCertificate } from '../../src/main/link/identity'
import { PAIRING_CODE_TTL_MS, PAIRING_FAILED, PAIRING_MAX_FAILURES, spake2Finish, spake2Share } from '../../src/main/link/pairing'
import { tokenHash } from '../../src/main/link/store'
import { LinkBench, type BenchMachine } from './link-bench'

let bench: LinkBench
const errors: string[] = []

beforeEach(() => {
  bench = new LinkBench()
  errors.length = 0
})

afterEach(async () => {
  // No pairing code and no token in the console output or in any error text a test met.
  expect(bench.leakedSecrets(errors)).toEqual([])
  await bench.close()
})

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

/** A file of the machine's link folder, parsed. */
function linkFile<T>(machine: BenchMachine, name: string): T {
  const file = bench.files(machine).find((entry) => entry.path.endsWith(name))
  if (file === undefined) throw new Error(`${machine.label} has no ${name}`)
  return JSON.parse(file.bytes.toString('utf8')) as T
}

const certificateOf = (machine: BenchMachine): string => linkFile<{ certificate: string }>(machine, 'machine.json').certificate
const secretsOf = (machine: BenchMachine): Record<string, string> => linkFile<{ secrets: Record<string, string> }>(machine, 'secrets.json').secrets

/** The token `owner` presents to `to`. */
function outgoingToken(owner: BenchMachine, to: BenchMachine): string {
  const token = secretsOf(owner)[`outgoing:${to.service.machine.id}`]
  if (token === undefined) throw new Error(`${owner.label} has no token for ${to.label}`)
  return token
}

describe('SPAKE2 (RFC 9382, Appendix B, P256-SHA256-HKDF-HMAC)', () => {
  // The first test vector: A='server', B='client', empty AAD.
  const hex = (text: string): Buffer => Buffer.from(text.replace(/\s/g, ''), 'hex')
  const w = BigInt('0x2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f')
  const x = BigInt('0x43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729')
  const y = BigInt('0xdcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be')
  const pA = hex('04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470 f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c')
  const pB = hex('0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676 d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7')

  it('computes the shares, keys and confirmations of the RFC', () => {
    expect(Buffer.from(spake2Share('A', w, x))).toEqual(pA)
    expect(Buffer.from(spake2Share('B', w, y))).toEqual(pB)
    const common = { w, idA: Buffer.from('server'), idB: Buffer.from('client'), aad: Buffer.alloc(0) }
    const a = spake2Finish({ ...common, role: 'A', secret: x, ownShare: pA, peerShare: pB })
    const b = spake2Finish({ ...common, role: 'B', secret: y, ownShare: pB, peerShare: pA })
    expect(a.ke.toString('hex')).toBe('0e0672dc86f8e45565d338b0540abe69')
    expect(a.kcA.toString('hex')).toBe('00c12546835755c86d8c0db7851ae86f')
    expect(a.kcB.toString('hex')).toBe('a9fa3406c3b781b93d804485430ca27a')
    expect(a.confirmA.toString('hex')).toBe('58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0')
    expect(a.confirmB.toString('hex')).toBe('d3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b')
    expect(b.confirmA).toEqual(a.confirmA)
    expect(b.confirmB).toEqual(a.confirmB)
  })

  it('gives different confirmations when the two sides saw different identities', () => {
    const a = spake2Finish({ w, role: 'A', secret: x, ownShare: pA, peerShare: pB, idA: Buffer.from('server'), idB: Buffer.from('client'), aad: Buffer.alloc(0) })
    const b = spake2Finish({ w, role: 'B', secret: y, ownShare: pB, peerShare: pA, idA: Buffer.from('server'), idB: Buffer.from('mallory'), aad: Buffer.alloc(0) })
    expect(b.confirmA.equals(a.confirmA)).toBe(false)
    expect(b.confirmB.equals(a.confirmB)).toBe(false)
  })
})

describe('linking two Machines by code', () => {
  it('stores the id, name and fingerprint of the other on both sides, and keeps them across a restart', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const fingerprintA = fingerprintOf(certificateOf(a))
    const fingerprintB = fingerprintOf(certificateOf(b))

    const linked = await bench.link(a, b)
    expect(linked).toMatchObject({ id: b.service.machine.id, name: 'beta', fingerprint: fingerprintB })
    expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ id: b.service.machine.id, name: 'beta', fingerprint: fingerprintB, address: '127.0.0.1' })])
    expect(b.service.linkedMachines()).toEqual([expect.objectContaining({ id: a.service.machine.id, name: 'alpha', fingerprint: fingerprintA, address: '127.0.0.1' })])

    const ids = { a: a.service.machine.id, b: b.service.machine.id }
    await bench.restart(a)
    await bench.restart(b)
    expect(a.service.machine.id).toBe(ids.a)
    expect(b.service.machine.id).toBe(ids.b)
    expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ id: ids.b, fingerprint: fingerprintB })])
    expect(b.service.linkedMachines()).toEqual([expect.objectContaining({ id: ids.a, fingerprint: fingerprintA })])

    // Both listen again over their folders (they have a Linked machine), and link.ping goes through.
    expect(b.service.status().listening).toBe(true)
    await a.service.connect(ids.b)
    expect(await a.service.call(ids.b, 'link.ping')).toEqual({ ok: true, value: { id: ids.b, name: 'beta', protocol: 1, build: '0.2.0+bench' } })
  })

  it('keeps no code and no incoming token in plain text, only the token hash; secrets are 0600', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    await bench.link(a, b)

    // A's incoming token is the one B presents to A, and the other way round.
    const incoming = new Map<BenchMachine, string>([
      [a, outgoingToken(b, a)],
      [b, outgoingToken(a, b)],
    ])
    for (const machine of [a, b]) {
      const token = incoming.get(machine) ?? ''
      const files = bench.files(machine)
      for (const file of files) {
        const text = file.bytes.toString('utf8')
        expect(text.includes(token), `${file.path} holds the incoming token`).toBe(false)
        for (const code of bench.pairingCodes()) expect(new RegExp(`(?<!\\d)${code}(?!\\d)`).test(text), `${file.path} holds a pairing code`).toBe(false)
      }
      const linked = files.find((file) => file.path.endsWith('linked.json'))
      expect(linked?.bytes.toString('utf8')).toContain(tokenHash(token))
      // The chosen place for secrets: a file only the owner can read (secrets.ts).
      const secrets = files.find((file) => file.path.endsWith('secrets.json'))
      expect(secrets).toBeDefined()
      if (process.platform !== 'win32') expect(secrets?.mode).toBe(0o600)
    }
  })

  it('a wrong code links nothing and burns the code: the old right code is refused afterwards', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const right = await bench.codeOf(b)
    const wrong = right === '000000' ? '000001' : '000000'
    const port = bench.portOf(b)

    const error = await rejection(a.service.pair({ host: '127.0.0.1', port, code: wrong }))
    expect(error.message).toBe(PAIRING_FAILED)
    await expect.poll(() => b.pairingFailures.length).toBe(1)
    expect(b.service.pairingCode()?.code).not.toBe(right)

    const again = await rejection(a.service.pair({ host: '127.0.0.1', port, code: right }))
    expect(again.message).toBe(PAIRING_FAILED)
    await expect.poll(() => b.pairingFailures.length).toBe(2)
    expect(a.service.linkedMachines()).toEqual([])
    expect(b.service.linkedMachines()).toEqual([])
  })

  it(`closes "Link a machine" after ${PAIRING_MAX_FAILURES} failed attempts in a row`, async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    await bench.codeOf(b)
    const port = bench.portOf(b)
    for (let attempt = 1; attempt <= PAIRING_MAX_FAILURES; attempt++) {
      const shown = b.service.pairingCode()?.code ?? ''
      const wrong = shown === '000000' ? '000001' : '000000'
      await rejection(a.service.pair({ host: '127.0.0.1', port, code: wrong }))
      await expect.poll(() => b.pairingFailures.length).toBeGreaterThanOrEqual(attempt)
    }
    await expect.poll(() => b.service.pairingCode()).toBeNull()
    expect(b.pairingFailures.at(-1)).toMatch(/too many failed pairing attempts/)
    await b.service.settled()
    expect(b.service.status().listening).toBe(false)
  })

  it('refuses a code older than its lifetime', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const code = await bench.codeOf(b)
    bench.advance(PAIRING_CODE_TTL_MS + 1)
    const error = await rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(b), code }))
    expect(error.message).toMatch(/expired/)
    expect(a.service.linkedMachines()).toEqual([])
    expect(b.service.linkedMachines()).toEqual([])
    // The expired code is replaced by a fresh one.
    expect(b.service.pairingCode()?.code).not.toBe(code)
  })

  it('refuses pairing while "Link a machine" is closed on the other side', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    // B listens because it is linked with C, but its "Link a machine" is closed.
    await bench.link(c, b)
    expect(b.service.pairingCode()).toBeNull()
    const error = await rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(b), code: '123456' }))
    expect(error.message).toMatch(/linking is not open/)
    expect(a.service.linkedMachines()).toEqual([])
    expect(b.service.linkedMachines().map((machine) => machine.id)).toEqual([c.service.machine.id])
  })

  it('runs one attempt at a time', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const code = await bench.codeOf(b)
    const port = bench.portOf(b)
    // A raw pairing connection that never sends its first message holds the one slot.
    const held = await openLinkSocket({ host: '127.0.0.1', port, path: '/link/pair', key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    const error = await rejection(a.service.pair({ host: '127.0.0.1', port, code }))
    expect(error.message).toMatch(/another Machine is linking/)
    held.ws.terminate()
    // Its end frees the slot; it sent no share, so the code is not burnt.
    await expect.poll(() => b.pairingFailures.length).toBe(1)
    expect(b.service.pairingCode()?.code).toBe(code)
    await bench.link(a, b)
    expect(a.service.linkedMachines().map((machine) => machine.id)).toEqual([b.service.machine.id])
  })
})

describe('a machine in the middle', () => {
  /** A TLS proxy with its own certificate on both sides, forwarding bytes; it rewrites Host so B accepts the request. */
  async function proxyTo(targetPort: number): Promise<{ port: number; close: () => void }> {
    const own = await generateCertificate(randomUUID())
    const server = tls.createServer({ key: own.key, cert: own.certificate, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: false }, (client) => {
      const upstream = tls.connect({ host: '127.0.0.1', port: targetPort, key: own.key, cert: own.certificate, rejectUnauthorized: false, minVersion: 'TLSv1.3' })
      let first = true
      client.on('data', (chunk: Buffer) => {
        let data = chunk
        if (first) {
          first = false
          data = Buffer.from(chunk.toString('latin1').replace(/^host: .*$/im, `Host: 127.0.0.1:${targetPort}`), 'latin1')
        }
        upstream.write(data)
      })
      upstream.on('data', (chunk: Buffer) => client.write(chunk))
      const end = (): void => {
        client.destroy()
        upstream.destroy()
      }
      client.on('close', end)
      upstream.on('close', end)
      client.on('error', end)
      upstream.on('error', end)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    return { port: typeof address === 'object' && address !== null ? address.port : 0, close: () => server.close() }
  }

  it('with the right code links nothing: both sides report the failure, neither stores anything', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const code = await bench.codeOf(b)
    const proxy = await proxyTo(bench.portOf(b))
    try {
      const error = await rejection(a.service.pair({ host: '127.0.0.1', port: proxy.port, code }))
      expect(error.message).toBe(PAIRING_FAILED)
      await expect.poll(() => b.pairingFailures.length).toBe(1)
      expect(b.pairingFailures[0]).toBeTruthy()
      for (const machine of [a, b]) {
        expect(machine.service.linkedMachines()).toEqual([])
        expect(bench.files(machine).some((file) => file.path.endsWith('linked.json'))).toBe(false)
        expect(bench.files(machine).some((file) => file.bytes.toString('utf8').includes('outgoing:'))).toBe(false)
      }
    } finally {
      proxy.close()
    }
  })
})

describe('round 2: closing "Link a machine" during an attempt', () => {
  it('cuts off the attempt in flight at once', async () => {
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    await bench.codeOf(b)
    const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: '/link/pair', key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    const closed = new Promise<number | 'still open'>((resolve) => {
      const timer = setTimeout(() => resolve('still open'), 1000)
      held.ws.once('close', (code: number) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    await b.service.closeLinking()
    expect(await closed).not.toBe('still open')
    await expect.poll(() => b.pairingFailures.length).toBe(1)
  })

  it('stores nothing when it closes after B took the code, even if the socket outlives the close', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const code = await bench.codeOf(b)
    const port = bench.portOf(b)
    // Right before A sends its confirmation, B closes "Link a machine"; terminate() is held back
    // for that one call, so only the check before the commit can stop the link.
    const send = WebSocket.prototype.send
    const sendSpy = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (typeof data === 'string' && data.includes('"t":"pake3"')) {
        const terminate = vi.spyOn(WebSocket.prototype, 'terminate').mockImplementation(() => undefined)
        void b.service.closeLinking()
        terminate.mockRestore()
      }
      return (send as (...args: unknown[]) => void).call(this, data, ...rest)
    })
    try {
      const error = await rejection(a.service.pair({ host: '127.0.0.1', port, code }))
      expect(error.message).toBe(PAIRING_FAILED)
    } finally {
      sendSpy.mockRestore()
    }
    await expect.poll(() => b.pairingFailures.some((message) => message.includes('was closed while linking'))).toBe(true)
    expect(a.service.linkedMachines()).toEqual([])
    expect(b.service.linkedMachines()).toEqual([])
  })
})

describe('round 2: a pairing socket that dies mid-step', () => {
  it('ends B\'s attempt at once instead of waiting out the step timeout', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const code = await bench.codeOf(b)
    // The socket of B's attempt is cut right as A's first message arrives, while B derives w from
    // the code: when B then waits for A's confirmation, the socket is already closed.
    const sockets = (b.service as unknown as { pairingSockets: Set<WebSocket> }).pairingSockets
    const add = sockets.add.bind(sockets)
    sockets.add = (ws: WebSocket) => {
      ws.once('message', () => ws.terminate())
      return add(ws)
    }
    const started = Date.now()
    await rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(b), code }))
    await expect.poll(() => b.pairingFailures.length, { timeout: 2000 }).toBe(1)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('round 2: a Machine id is bound to its certificate', () => {
  /** A Machine with its own certificate that claims the id of `victim`. */
  async function impostorOf(victim: BenchMachine): Promise<BenchMachine> {
    const impostor = await bench.machine('delta')
    await impostor.service.stop()
    const file = join(impostor.dataDir, 'link', 'machine.json')
    const machine = JSON.parse(readFileSync(file, 'utf8')) as { id: string }
    writeFileSync(file, JSON.stringify({ ...machine, id: victim.service.machine.id }))
    await bench.restart(impostor)
    expect(impostor.service.machine.id).toBe(victim.service.machine.id)
    return impostor
  }

  it('B refuses a peer that claims the id of a Machine linked with another certificate', async () => {
    const a = await bench.machine('alpha')
    const c = await bench.machine('gamma')
    await bench.link(a, c)
    const before = a.service.linkedMachines()
    const impostor = await impostorOf(c)

    const error = await rejection(impostor.service.pair({ host: '127.0.0.1', port: bench.portOf(a), code: await bench.codeOf(a) }))
    expect(error.message).toBe(PAIRING_FAILED)
    await expect.poll(() => a.pairingFailures.some((message) => message.includes('already linked with another certificate'))).toBe(true)
    expect(a.service.linkedMachines()).toEqual(before)
    expect(impostor.service.linkedMachines()).toEqual([])
  })

  it('A refuses a server that claims the id of a Machine linked with another certificate', async () => {
    const a = await bench.machine('alpha')
    const c = await bench.machine('gamma')
    await bench.link(a, c)
    const before = a.service.linkedMachines()
    const impostor = await impostorOf(c)

    const code = await bench.codeOf(impostor)
    const error = await rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(impostor), code }))
    expect(error.message).toMatch(/already linked with another certificate/)
    await expect.poll(() => impostor.pairingFailures.length).toBe(1)
    expect(a.service.linkedMachines()).toEqual(before)
    expect(impostor.service.linkedMachines()).toEqual([])
  })
})
