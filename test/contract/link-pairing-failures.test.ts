// How a pairing of two Machines by code fails and closes (worfy-link ticket 01; ADR-0052, point 4):
// an invalid first message, a connection that never sends one, "Link a machine" closed during an
// attempt, a socket that dies mid-step, and malformed frames on either side. Every service runs over
// its own temporary data folder on 127.0.0.1 (test/contract/link-bench.ts).
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import tls from 'node:tls'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openLinkSocket } from '../../src/main/link/client'
import { generateCertificate } from '../../src/main/link/identity'
import { PAIR_PATH } from '../../src/main/link/messages'
import { PAIRING_CLOSE_FAILED, PAIRING_FAILED, PAIRING_MAX_FAILURES } from '../../src/main/link/pairing'
import { LinkBench, type BenchMachine } from './link-bench'
import { linkPairingHelpers } from './link-pairing-helpers'

let bench: LinkBench
const { errors, rejection, certificateOf, secretsOf } = linkPairingHelpers(() => bench)

beforeEach(() => {
  bench = new LinkBench()
  errors.length = 0
})

afterEach(async () => {
  // No pairing code and no token in the console output or in any error text a test met.
  expect(bench.leakedSecrets(errors)).toEqual([])
  await bench.close()
})

describe('a first pairing message with an invalid share', () => {
  // As its pA, a point of the curve in the compressed encoding (33 bytes): RFC 9382 defines only
  // the uncompressed one for P-256.
  const pA = Buffer.from('04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c', 'hex')
  const compressedShare = Buffer.concat([Buffer.from([((pA[64] ?? 0) & 1) === 1 ? 0x03 : 0x02]), pA.subarray(1, 33)]).toString('base64')
  const compressedPake1 = JSON.stringify({ t: 'pake1', pA: compressedShare })

  it(`is closed with ${PAIRING_CLOSE_FAILED}; B stores nothing, burns the code and counts a failure`, async () => {
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const code = await bench.codeOf(b)
    const failures = (): number => (b.service as unknown as { pairingWindow: { failures: number } }).pairingWindow.failures
    expect(failures()).toBe(0)
    const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: '/link/pair', key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    const closed = new Promise<number>((resolve) => held.ws.once('close', (closeCode: number) => resolve(closeCode)))
    held.ws.send(compressedPake1)

    expect(await closed).toBe(PAIRING_CLOSE_FAILED)
    await expect.poll(() => b.pairingFailures).toEqual([PAIRING_FAILED])
    expect(failures()).toBe(1)
    expect(b.service.pairingCode()?.code).not.toBe(code)
    expect(b.service.linkedMachines()).toEqual([])
    expect(bench.files(b).some((file) => file.path.endsWith('linked.json'))).toBe(false)
    expect(bench.files(b).some((file) => file.bytes.toString('utf8').includes('outgoing:'))).toBe(false)
  })

  it(`a peer that never answers the ${PAIRING_CLOSE_FAILED} close gets the close frame and is cut off after a second`, async () => {
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    await bench.codeOf(b)
    const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    // ws on this side stops reading, so nothing answers B's close frame; the bytes are kept here.
    const socket = (held.ws as unknown as { _socket: tls.TLSSocket })._socket
    socket.removeAllListeners('data')
    const received: Buffer[] = []
    socket.on('data', (chunk: Buffer) => received.push(chunk))
    let timer: NodeJS.Timeout | undefined
    const closed = new Promise<number | 'still open'>((resolve) => {
      timer = setTimeout(() => resolve('still open'), 5000)
      socket.once('close', () => resolve(performance.now()))
    })
    const sentAt = performance.now()
    held.ws.send(compressedPake1)
    const closedAt = await closed
    clearTimeout(timer)

    // ws's own close timeout is 30 s: within 5 s it is service.ts's cut after a second, not one at once.
    expect(closedAt).not.toBe('still open')
    expect((closedAt as number) - sentAt).toBeGreaterThanOrEqual(900)
    expect((closedAt as number) - sentAt).toBeLessThan(3000)
    // An unmasked close frame (opcode 8) with code 4001 came before the cut.
    const bytes = Buffer.concat(received)
    expect(bytes[0]).toBe(0x88)
    expect(bytes.readUInt16BE(2)).toBe(PAIRING_CLOSE_FAILED)
    await expect.poll(() => b.pairingFailures).toEqual([PAIRING_FAILED])
  })

  it(`A, whose pairing fails, sends ${PAIRING_CLOSE_FAILED} and cuts a peer that never answers the close after a second`, async () => {
    const a = await bench.machine('alpha')
    // A stand-in B: it answers pake1 with the invalid share, so A fails, and then reads nothing.
    const own = await generateCertificate(randomUUID())
    const server = createHttpsServer({ key: own.key, cert: own.certificate })
    const wss = new WebSocketServer({ server })
    const seen = new Promise<{ bytes: Buffer; ms: number } | 'still open'>((resolve) => {
      wss.on('connection', (ws) => {
        ws.on('error', () => undefined)
        ws.once('message', () => {
          const socket = (ws as unknown as { _socket: tls.TLSSocket })._socket
          ws.send(JSON.stringify({ t: 'pake2', pB: compressedShare, cB: randomBytes(32).toString('base64') }))
          socket.removeAllListeners('data')
          const received: Buffer[] = []
          socket.on('data', (chunk: Buffer) => received.push(chunk))
          const sentAt = performance.now()
          const timer = setTimeout(() => resolve('still open'), 5000)
          socket.once('close', () => {
            clearTimeout(timer)
            resolve({ bytes: Buffer.concat(received), ms: performance.now() - sentAt })
          })
        })
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const error = await rejection(a.service.pair({ host: '127.0.0.1', port, code: '123456' }))
      expect(error.message).toBe(PAIRING_FAILED)
      const got = await seen
      expect(got).not.toBe('still open')
      const { bytes, ms } = got as { bytes: Buffer; ms: number }
      // A masked close frame of a client: opcode 8, then the 4-byte mask, then the masked code.
      expect(bytes[0]).toBe(0x88)
      expect((((bytes[6] ?? 0) ^ (bytes[2] ?? 0)) << 8) | ((bytes[7] ?? 0) ^ (bytes[3] ?? 0))).toBe(PAIRING_CLOSE_FAILED)
      expect(ms).toBeGreaterThanOrEqual(900)
      expect(ms).toBeLessThan(3000)
    } finally {
      wss.close()
      server.close()
    }
  })

  it('a pairing that fails on a message that is not JSON is cut at once: there is no close handshake to wait for', async () => {
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    await bench.codeOf(b)
    const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    const socket = (held.ws as unknown as { _socket: tls.TLSSocket })._socket
    let timer: NodeJS.Timeout | undefined
    const closed = new Promise<number | 'still open'>((resolve) => {
      timer = setTimeout(() => resolve('still open'), 5000)
      socket.once('close', () => resolve(performance.now()))
    })
    const sentAt = performance.now()
    held.ws.send('{ not json')
    const closedAt = await closed
    clearTimeout(timer)
    expect(closedAt).not.toBe('still open')
    // B never called close, so the socket is OPEN in the catch: a wait of a second would be one too many.
    expect((closedAt as number) - sentAt).toBeLessThan(700)
    await expect.poll(() => b.pairingFailures.length).toBe(1)
  })

  // A frame a server must refuse: a text frame without a mask (RFC 6455 5.1; ws: "MASK must be set").
  const UNMASKED_FRAME = Buffer.from([0x81, 0x01, 0x41])
  /** A masked text frame of a client, written by hand so that it can share one write with another. */
  const maskedTextFrame = (text: string): Buffer => {
    const payload = Buffer.from(text)
    const mask = Buffer.from([1, 2, 3, 4])
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload.map((byte, i) => byte ^ (mask[i % 4] ?? 0))])
  }
  /** Runs `act` on a raw pairing socket to B and returns the uncaught exceptions seen until the socket closes. */
  const uncaughtWhile = async (act: (socket: tls.TLSSocket, sent: (text: string) => void) => Promise<void>): Promise<string[]> => {
    const uncaught: string[] = []
    const onUncaught = (error: unknown): void => {
      uncaught.push(String(error))
    }
    process.prependListener('uncaughtException', onUncaught)
    try {
      const b = await bench.machine('beta')
      const c = await bench.machine('gamma')
      await bench.codeOf(b)
      const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
      const socket = (held.ws as unknown as { _socket: tls.TLSSocket })._socket
      socket.removeAllListeners('data')
      socket.on('data', () => undefined)
      const closed = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000)
        socket.once('close', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      await act(socket, (text) => held.ws.send(text))
      expect(await closed).toBe(true)
      return uncaught
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  }

  it('a malformed frame while B waits for the close handshake of a failed pairing is no uncaught exception', async () => {
    const uncaught = await uncaughtWhile(async (socket, send) => {
      const closeFrame = new Promise<void>((resolve) => socket.once('data', () => resolve()))
      send(compressedPake1)
      await closeFrame
      socket.write(UNMASKED_FRAME)
    })
    expect(uncaught).toEqual([])
  })

  it('a malformed frame in one write with a first message is no uncaught exception', async () => {
    // Between two steps of the pairing no frame is awaited: the second frame is read there.
    const uncaught = await uncaughtWhile(async (socket) => {
      socket.write(Buffer.concat([maskedTextFrame(compressedPake1), UNMASKED_FRAME]))
    })
    expect(uncaught).toEqual([])
  })

  it('a malformed frame of the peer while A pairs, between two steps or while A closes a failed pairing, is no uncaught exception', async () => {
    // A frame a client must refuse: a masked one from a server (RFC 6455 5.1; ws: "MASK must be clear").
    // client.ts still listens for 'error' after the socket opened; pair()'s own listener must hold without it.
    /** An unmasked text frame of a server, written by hand so that it can share one write with another. */
    const serverTextFrame = (text: string): Buffer => {
      const payload = Buffer.from(text)
      expect(payload.length).toBeLessThan(126)
      return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
    }
    const pake2 = JSON.stringify({ t: 'pake2', pB: compressedShare, cB: randomBytes(32).toString('base64') })
    const a = await bench.machine('alpha')
    const own = await generateCertificate(randomUUID())
    const uncaught: string[] = []
    const onUncaught = (error: unknown): void => {
      uncaught.push(String(error))
    }
    process.prependListener('uncaughtException', onUncaught)
    try {
      for (const when of ['between steps', 'while closing'] as const) {
        // A stand-in B: after pake1 it writes raw frames and reads nothing, so A's close gets no answer.
        const server = createHttpsServer({ key: own.key, cert: own.certificate })
        const wss = new WebSocketServer({ server })
        const closed = new Promise<boolean>((resolve) => {
          wss.on('connection', (ws) => {
            ws.on('error', () => undefined)
            ws.once('message', () => {
              const socket = (ws as unknown as { _socket: tls.TLSSocket })._socket
              socket.removeAllListeners('data')
              socket.on('data', () => undefined)
              const timer = setTimeout(() => resolve(false), 5000)
              socket.once('close', () => {
                clearTimeout(timer)
                resolve(true)
              })
              // In one write with pake2, the malformed frame is read before A waits for its next frame.
              if (when === 'between steps') socket.write(Buffer.concat([serverTextFrame(pake2), maskedTextFrame('x')]))
              else {
                // The invalid share fails A, and its close frame comes: A's socket is CLOSING.
                socket.once('data', () => socket.write(maskedTextFrame('x')))
                socket.write(serverTextFrame(pake2))
              }
            })
          })
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        try {
          const port = (server.address() as AddressInfo).port
          const error = await rejection(a.service.pair({ host: '127.0.0.1', port, code: '123456' }))
          expect(error.message, when).toBe(PAIRING_FAILED)
          expect(await closed, when).toBe(true)
        } finally {
          wss.close()
          server.close()
        }
      }
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  })
})

describe('a pairing connection that never sends its first message', () => {
  /**
   * Opens `count` pairing connections from `from` to `to`, one after another, none of which sends
   * pake1. `ends` says who ends each one: B after its step timeout, or the connection itself at once.
   * After each of the first PAIRING_MAX_FAILURES - 1, "Link a machine" is still open and shows `code`.
   */
  async function silentAttempts(from: BenchMachine, to: BenchMachine, code: string, count: number, ends: 'timeout' | 'itself'): Promise<void> {
    const port = bench.portOf(to)
    const before = to.pairingFailures.length
    for (let attempt = 1; attempt <= count; attempt++) {
      const held = await openLinkSocket({ host: '127.0.0.1', port, path: PAIR_PATH, key: secretsOf(from)['machine-key'] ?? '', certificate: certificateOf(from) })
      const closed = new Promise<void>((resolve) => held.ws.once('close', () => resolve()))
      if (ends === 'itself') held.ws.terminate()
      await closed
      // One failure per attempt, counted once: the window stays open until the last of ten.
      await expect.poll(() => to.pairingFailures.length).toBeGreaterThanOrEqual(before + attempt)
      if (before + attempt < PAIRING_MAX_FAILURES) {
        expect(to.pairingFailures.length).toBe(before + attempt)
        // Nobody saw the code: B still shows the same one.
        expect(to.service.pairingCode()?.code).toBe(code)
      }
    }
  }

  it(`counts as a failure when B's step times out, keeps the code, and ${PAIRING_MAX_FAILURES} in a row close "Link a machine"`, async () => {
    // A short step timeout instead of the real 15 s: the connection sends nothing, so nothing races it.
    await bench.close()
    bench = new LinkBench({ pairingStepTimeoutMs: 100 })
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const code = await bench.codeOf(b)
    await silentAttempts(c, b, code, PAIRING_MAX_FAILURES, 'timeout')
    await expect.poll(() => b.service.pairingCode()).toBeNull()
    expect(b.pairingFailures.at(-1)).toMatch(/too many failed pairing attempts/)
    await b.service.settled()
    expect(b.service.status().listening).toBe(false)
  })

  it(`counts as a failure when it closes itself before the step timeout, keeps the code, and ${PAIRING_MAX_FAILURES} in a row close "Link a machine"`, async () => {
    // The real 15 s step timeout: each connection is gone long before it, so only its own close ends it.
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const code = await bench.codeOf(b)
    await silentAttempts(c, b, code, PAIRING_MAX_FAILURES, 'itself')
    await expect.poll(() => b.service.pairingCode()).toBeNull()
    expect(b.pairingFailures.at(-1)).toMatch(/too many failed pairing attempts/)
    await b.service.settled()
    expect(b.service.status().listening).toBe(false)
  })

  for (const cut of ['closeLinking', 'stop'] as const) {
    it(`is not counted when B cuts it off (${cut}), even after ${PAIRING_MAX_FAILURES - 1} failures`, async () => {
      const b = await bench.machine('beta')
      const c = await bench.machine('gamma')
      const code = await bench.codeOf(b)
      await silentAttempts(c, b, code, PAIRING_MAX_FAILURES - 1, 'itself')
      const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
      const closed = new Promise<void>((resolve) => held.ws.once('close', () => resolve()))
      await b.service[cut]()
      await closed
      await expect.poll(() => b.pairingFailures.length).toBe(PAIRING_MAX_FAILURES)
      expect(b.pairingFailures.some((message) => /too many failed pairing attempts/.test(message))).toBe(false)
    })
  }
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
