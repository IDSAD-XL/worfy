// Pairing two Machines by a 6-digit code (worfy-link ticket 01; ADR-0052, point 4): what each side
// stores, where the secrets live, the one-time code, and a machine in the middle. Every service
// runs over its own temporary data folder on 127.0.0.1 (test/contract/link-bench.ts). How a pairing
// fails and closes is in link-pairing-failures.test.ts.
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tls from 'node:tls'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkConnectError, openLinkSocket } from '../../src/main/link/client'
import { fingerprintOf, generateCertificate } from '../../src/main/link/identity'
import { CONNECT_PATH, LINK_PROTOCOL_HEADER, LINK_PROTOCOL_VERSION, PAIR_PATH } from '../../src/main/link/messages'
import {
  PAIRING_CLOSE_FAILED,
  PAIRING_CODE_TTL_MS,
  PAIRING_FAILED,
  PAIRING_FAILURE_WINDOW_MS,
  PAIRING_HOURLY_FAILURES,
  PAIRING_MAX_FAILURES,
  PAIRING_PAUSED,
  PairingWindow,
  SPAKE2_M,
  SPAKE2_N,
  spake2Finish,
  spake2Share,
} from '../../src/main/link/pairing'
import type { PairingPause } from '../../src/main/link/service'
import { tokenHash } from '../../src/main/link/store'
import { LinkBench, type BenchMachine } from './link-bench'
import { linkPairingHelpers } from './link-pairing-helpers'

const MINUTE = 60_000

let bench: LinkBench
const { errors, rejection, linkFile, certificateOf, secretsOf, outgoingToken } = linkPairingHelpers(() => bench)

beforeEach(() => {
  bench = new LinkBench()
  errors.length = 0
})

afterEach(async () => {
  // No pairing code and no token in the console output or in any error text a test met.
  expect(bench.leakedSecrets(errors)).toEqual([])
  await bench.close()
})

describe('SPAKE2 (RFC 9382, Appendix B, P256-SHA256-HKDF-HMAC)', () => {
  // All four test vectors of Appendix B, copied from the text of the RFC
  // (https://www.rfc-editor.org/rfc/rfc9382.txt), not computed: identities A and B, w, x, y, the
  // shares pA and pB, Ke, KcA, KcB and the confirmations cA ("A conf") and cB ("B conf"). AAD is empty.
  const vectors = [
    {
      idA: 'server',
      idB: 'client',
      w: '2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f',
      x: '43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729',
      y: 'dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be',
      pA: '04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c',
      pB: '0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7',
      ke: '0e0672dc86f8e45565d338b0540abe69',
      kcA: '00c12546835755c86d8c0db7851ae86f',
      kcB: 'a9fa3406c3b781b93d804485430ca27a',
      cA: '58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0',
      cB: 'd3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b',
    },
    {
      idA: '',
      idB: 'client',
      w: '0548d8729f730589e579b0475a582c1608138ddf7054b73b5381c7e883e2efae',
      x: '403abbe3b1b4b9ba17e3032849759d723939a27a27b9d921c500edde18ed654b',
      y: '903023b6598908936ea7c929bd761af6039577a9c3f9581064187c3049d87065',
      pA: '04a897b769e681c62ac1c2357319a3d363f610839c4477720d24cbe32f5fd85f44fb92ba966578c1b712be6962498834078262caa5b441ecfa9d4a9485720e918a',
      pB: '04e0f816fd1c35e22065d5556215c097e799390d16661c386e0ecc84593974a61b881a8c82327687d0501862970c64565560cb5671f696048050ca66ca5f8cc7fc',
      ke: '642f05c473c2cd79909f9a841e2f30a7',
      kcA: 'c6be376fc7cd1301fd0a13adf3e7bffd',
      kcB: 'b7243f4ae60440a49b3f8cab3c1fba07',
      cA: '47d29e6666af1b7dd450d571233085d7a9866e4d49d2645e2df975489521232b',
      cB: '3313c5cefc361d27fb16847a91c2a73b766ffa90a4839122a9b70a2f6bd1d6df',
    },
    {
      idA: 'server',
      idB: '',
      w: '626e0cdc7b14c9db3e52a0b1b3a768c98e37852d5db30febe0497b14eae8c254',
      x: '07adb3db6bc623d3399726bfdbfd3d15a58ea776ab8a308b00392621291f9633',
      y: 'b6a4fc8dbb629d4ba51d6f91ed1532cf87adec98f25dd153a75accafafedec16',
      pA: '04f88fb71c99bfffaea370966b7eb99cd4be0ff1a7d335caac4211c4afd855e2e15a873b298503ad8ba1d9cbb9a392d2ba309b48bfd7879aefd0f2cea6009763b0',
      pB: '040c269d6be017dccb15182ac6bfcd9e2a14de019dd587eaf4bdfd353f031101e7cca177f8eb362a6e83e7d5e729c0732e1b528879c086f39ba0f31a9661bd34db',
      ke: '005184ff460da2ce59062c87733c299c',
      kcA: 'f3da53604f0aeecea5a33be7bddf6edf',
      kcB: '9e3f86848736f159bd92b6e107ec6799',
      cA: 'bc9f9bbe99f26d0b2260e6456e05a86196a3307ec6663a18bf6ac825736533b2',
      cB: 'c2370e1bf813b086dff0d834e74425a06e6390f48f5411900276dcccc5a297ec',
    },
    {
      idA: '',
      idB: '',
      w: '7bf46c454b4c1b25799527d896508afd5fc62ef4ec59db1efb49113063d70cca',
      x: '8cef65df64bb2d0f83540c53632de911b5b24b3eab6cc74a97609fd659e95473',
      y: 'd7a66f64074a84652d8d623a92e20c9675c61cb5b4f6a0063e4648a2fdc02d53',
      pA: '04a65b367a3f613cf9f0654b1b28a1e3a8a40387956c8ba6063e8658563890f46ca1ef6a676598889fc28de2950ab8120b79a5ef1ea4c9f44bc98f585634b46d66',
      pB: '04589f13218822710d98d8b2123a079041052d9941b9cf88c6617ddb2fcc0494662eea8ba6b64692dc318250030c6af045cb738bc81ba35b043c3dcb46adf6f58d',
      ke: 'fc6374762ba5cf11f4b2caa08b2cd1b9',
      kcA: '5dbd2f477166b7fb6d61febbd77a5563',
      kcB: '7689b4654407a5faeffdc8f18359d8a3',
      cA: 'dfb4db8d48ae5a675963ea5e6c19d98d4ea028d8e898dad96ea19a80ade95dca',
      cB: 'd0f0609d1613138d354f7e95f19fb556bf52d751947241e8c7118df5ef0ae175',
    },
  ]
  const INVALID_SHARE = 'pairing: the other share is invalid'
  const hex = (text: string): Buffer => Buffer.from(text, 'hex')
  const scalar = (text: string): bigint => BigInt(`0x${text}`)

  it.each(vectors)("computes the shares, keys and confirmations of the RFC for A='$idA', B='$idB'", (vector) => {
    const w = scalar(vector.w)
    const pA = Buffer.from(spake2Share('A', w, scalar(vector.x)))
    const pB = Buffer.from(spake2Share('B', w, scalar(vector.y)))
    expect(pA.toString('hex')).toBe(vector.pA)
    expect(pB.toString('hex')).toBe(vector.pB)
    const common = { w, idA: Buffer.from(vector.idA), idB: Buffer.from(vector.idB), aad: Buffer.alloc(0) }
    const sides = {
      A: spake2Finish({ ...common, role: 'A', secret: scalar(vector.x), ownShare: pA, peerShare: pB }),
      B: spake2Finish({ ...common, role: 'B', secret: scalar(vector.y), ownShare: pB, peerShare: pA }),
    }
    for (const [role, side] of Object.entries(sides)) {
      expect(side.ke.toString('hex'), `Ke on ${role}`).toBe(vector.ke)
      expect(side.kcA.toString('hex'), `KcA on ${role}`).toBe(vector.kcA)
      expect(side.kcB.toString('hex'), `KcB on ${role}`).toBe(vector.kcB)
      expect(side.confirmA.toString('hex'), `cA on ${role}`).toBe(vector.cA)
      expect(side.confirmB.toString('hex'), `cB on ${role}`).toBe(vector.cB)
    }
  })

  const [first] = vectors
  if (first === undefined) throw new Error('no test vector')
  const w = scalar(first.w)
  const x = scalar(first.x)
  const y = scalar(first.y)
  const pA = hex(first.pA)
  const pB = hex(first.pB)

  it('gives different confirmations when the two sides saw different identities', () => {
    const a = spake2Finish({ w, role: 'A', secret: x, ownShare: pA, peerShare: pB, idA: Buffer.from('server'), idB: Buffer.from('client'), aad: Buffer.alloc(0) })
    const b = spake2Finish({ w, role: 'B', secret: y, ownShare: pB, peerShare: pA, idA: Buffer.from('server'), idB: Buffer.from('mallory'), aad: Buffer.alloc(0) })
    expect(b.confirmA.equals(a.confirmA)).toBe(false)
    expect(b.confirmB.equals(a.confirmB)).toBe(false)
  })

  // RFC 9382, section 7: a share that is not a member of the group aborts the protocol; section 6:
  // P-256 shares are uncompressed SEC1 points, 65 bytes starting with 0x04.
  describe.each([
    { role: 'A' as const, secret: x, ownShare: pA, validPeer: pB, unblind: SPAKE2_N },
    { role: 'B' as const, secret: y, ownShare: pB, validPeer: pA, unblind: SPAKE2_M },
  ])('refuses an invalid share of the other side, as $role', ({ role, secret, ownShare, validPeer, unblind }) => {
    const finish = (peerShare: Uint8Array) => () =>
      spake2Finish({ role, w, secret, ownShare, peerShare, idA: Buffer.from('server'), idB: Buffer.from('client'), aad: Buffer.alloc(0) })
    const withPrefix = (prefix: number): Buffer => Buffer.concat([Buffer.from([prefix]), validPeer.subarray(1)])
    const fieldOrder = hex('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff')

    it('accepts the valid share it is checked against', () => {
      expect(finish(validPeer)).not.toThrow()
    })

    it('a point off the curve (the last byte of y changed)', () => {
      const share = Buffer.from(validPeer)
      share[64] = (share[64] ?? 0) ^ 0x01
      expect(finish(share)).toThrow(INVALID_SHARE)
    })

    it('an empty share', () => {
      expect(finish(Buffer.alloc(0))).toThrow(INVALID_SHARE)
    })

    it('the single byte 0x00 (the SEC1 encoding of the identity)', () => {
      expect(finish(Buffer.from([0x00]))).toThrow(INVALID_SHARE)
    })

    it('64 bytes (the point without its prefix)', () => {
      expect(finish(validPeer.subarray(1))).toThrow(INVALID_SHARE)
    })

    it('66 bytes (the point with a byte appended)', () => {
      expect(finish(Buffer.concat([validPeer, Buffer.from([0x00])]))).toThrow(INVALID_SHARE)
    })

    it('x equal to the field modulus p', () => {
      expect(finish(Buffer.concat([Buffer.from([0x04]), fieldOrder, validPeer.subarray(33)]))).toThrow(INVALID_SHARE)
    })

    it('the hybrid encoding 0x06', () => {
      expect(finish(withPrefix(0x06))).toThrow(INVALID_SHARE)
    })

    it('the hybrid encoding 0x07', () => {
      expect(finish(withPrefix(0x07))).toThrow(INVALID_SHARE)
    })

    it('the compressed encoding of a point on the curve (33 bytes)', () => {
      const yIsOdd = ((validPeer[64] ?? 0) & 1) === 1
      const compressed = Buffer.concat([Buffer.from([yIsOdd ? 0x03 : 0x02]), validPeer.subarray(1, 33)])
      expect(finish(compressed)).toThrow(INVALID_SHARE)
    })

    it('a share that unblinds to the identity (the other side sent only its blinding point times w)', () => {
      expect(finish(unblind.multiply(w).toBytes(false))).toThrow(INVALID_SHARE)
    })
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
    expect(await a.service.call(ids.b, 'link.ping')).toEqual({ ok: true, value: { id: ids.b, name: 'beta', protocol: LINK_PROTOCOL_VERSION, build: '0.2.0+bench' } })
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
    // B gets the 4001 close frame of A, not a cut connection (1006): it names the code, not the network.
    await expect.poll(() => b.pairingFailures).toEqual([PAIRING_FAILED])
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

  it(`pauses linking after ${PAIRING_HOURLY_FAILURES} failed attempts within an hour across two openings, refuses the next attempt before SPAKE2 and notifies once`, async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    // B stays listening through the pause because it is linked with C; a success counts nothing.
    await bench.link(c, b)
    const pauses: PairingPause[] = []
    b.service.on('pairing-paused', (pause) => pauses.push(pause))
    const port = bench.portOf(b)
    // A minute between failures: each one has its own time, so the pause's end names the oldest.
    const failedAt: number[] = []
    const fail = async (count: number): Promise<void> => {
      for (let attempt = 0; attempt < count; attempt++) {
        bench.advance(MINUTE)
        failedAt.push(bench.now)
        const before = b.pairingFailures.length
        const shown = b.service.pairingCode()?.code ?? ''
        const wrong = shown === '000000' ? '000001' : '000000'
        await rejection(a.service.pair({ host: '127.0.0.1', port, code: wrong }))
        await expect.poll(() => b.pairingFailures.length).toBeGreaterThan(before)
      }
    }
    await bench.codeOf(b)
    await fail(5)
    await b.service.closeLinking()
    // The second opening starts its own count of failures in a row, but not of failures in the hour.
    await b.service.openLinking()
    await fail(PAIRING_HOURLY_FAILURES - 6)
    expect(b.service.pairingCode()).not.toBeNull()
    expect(b.service.pairingPausedUntil()).toBeNull()
    expect(pauses).toEqual([])
    await fail(1)

    await expect.poll(() => b.service.pairingCode()).toBeNull()
    const until = (failedAt[0] ?? 0) + PAIRING_FAILURE_WINDOW_MS
    expect(b.service.pairingPausedUntil()).toBe(until)
    expect(pauses).toEqual([{ failures: PAIRING_HOURLY_FAILURES, addresses: ['127.0.0.1'], until }])
    expect(b.pairingFailures.at(-1)).toMatch(/too many failed pairing attempts within an hour; "Link a machine" is paused/)
    const counted = b.pairingFailures.length

    // "Link a machine" does not open during the pause.
    await b.service.openLinking()
    expect(b.service.pairingCode()).toBeNull()
    // The 11th attempt, minutes later, is refused when its connection is upgraded, before any SPAKE2
    // message. It says that linking is paused, not until when, and it is not counted: the end of the
    // pause stays an hour after the oldest of the ten.
    bench.advance(5 * MINUTE)
    const refused = await rejection(a.service.pair({ host: '127.0.0.1', port, code: '123456' }))
    expect(refused.message).toContain(PAIRING_PAUSED)
    expect(refused.message).not.toMatch(/until|\d{1,2}:\d{2}/)
    await b.service.settled()
    expect(b.service.pairingPausedUntil()).toBe(until)
    expect(b.pairingFailures.length).toBe(counted)
    expect(pauses).toHaveLength(1)
    expect(a.service.linkedMachines()).toEqual([])
    // Neither the pause nor its texts carry a code or a token.
    expect(bench.leakedSecrets([JSON.stringify(pauses), ...b.pairingFailures, refused.message])).toEqual([])

    // The pause ends an hour after the oldest of the ten failures.
    bench.advance(until - bench.now - 1)
    await b.service.openLinking()
    expect(b.service.pairingCode()).toBeNull()
    bench.advance(1)
    expect(b.service.pairingPausedUntil()).toBeNull()
    await b.service.openLinking()
    expect(b.service.pairingCode()).not.toBeNull()
  })

  it('counts an attempt whose WebSocket handshake fails after admission, with the address it came from', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const pauses: PairingPause[] = []
    b.service.on('pairing-paused', (pause) => pauses.push(pause))
    await bench.codeOf(b)
    const port = bench.portOf(b)
    for (let attempt = 1; attempt < PAIRING_HOURLY_FAILURES; attempt++) {
      const shown = b.service.pairingCode()?.code ?? ''
      await rejection(a.service.pair({ host: '127.0.0.1', port, code: shown === '000000' ? '000001' : '000000' }))
      await expect.poll(() => b.pairingFailures.length).toBeGreaterThanOrEqual(attempt)
    }
    expect(pauses).toEqual([])
    // An upgrade to /link/pair that passes admission but has no Sec-WebSocket-Key: ws never hands
    // over a WebSocket, the socket closes, and the attempt ends through the server's abort.
    const socket = tls.connect({ host: '127.0.0.1', port, key: secretsOf(c)['machine-key'] ?? '', cert: certificateOf(c), minVersion: 'TLSv1.3', rejectUnauthorized: false })
    socket.on('error', () => undefined)
    await new Promise<void>((resolve) => socket.once('secureConnect', () => resolve()))
    socket.write(`GET ${PAIR_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${LINK_PROTOCOL_HEADER}: ${LINK_PROTOCOL_VERSION}\r\n\r\n`)
    // Read B's 400 answer to its end: a socket nobody reads never sees the end, and never closes.
    socket.resume()
    await new Promise<void>((resolve) => socket.once('close', () => resolve()))
    await expect.poll(() => pauses).toHaveLength(1)
    expect(pauses[0]?.addresses).toEqual(['127.0.0.1'])
  })

  it('does not listen for linking during the pause, when no Linked machine keeps the server open', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    await bench.codeOf(b)
    const port = bench.portOf(b)
    for (let attempt = 1; attempt <= PAIRING_HOURLY_FAILURES; attempt++) {
      const shown = b.service.pairingCode()?.code ?? ''
      await rejection(a.service.pair({ host: '127.0.0.1', port, code: shown === '000000' ? '000001' : '000000' }))
      await expect.poll(() => b.pairingFailures.length).toBeGreaterThanOrEqual(attempt)
    }
    await expect.poll(() => b.service.pairingPausedUntil()).not.toBeNull()
    await b.service.openLinking()
    await b.service.settled()
    expect(b.service.pairingCode()).toBeNull()
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

describe('B introduces itself only after A proved the code', () => {
  it('a side without the code gets pake2 with pB and cB only, and after a wrong cA nothing more', async () => {
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    await bench.codeOf(b)
    const held = await openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c) })
    const received: string[] = []
    held.ws.on('message', (data: Buffer) => received.push(data.toString('utf8')))
    const closed = new Promise<number>((resolve) => held.ws.once('close', (closeCode: number) => resolve(closeCode)))
    // A valid share made with a guessed code: B answers it with its own share and confirmation.
    held.ws.send(JSON.stringify({ t: 'pake1', pA: Buffer.from(spake2Share('A', 123456n, 987654321n)).toString('base64') }))
    await expect.poll(() => received.length).toBe(1)
    const second = JSON.parse(received[0] ?? '{}') as Record<string, unknown>
    expect(second.t).toBe('pake2')
    expect(Object.keys(second).sort()).toEqual(['cB', 'pB', 't'])

    // A confirmation that cannot hold, with a well-formed introduction and token: B closes.
    const machine = { id: randomUUID(), name: 'gamma', protocol: LINK_PROTOCOL_VERSION, build: '0.2.0+bench', port: 1 }
    held.ws.send(JSON.stringify({ t: 'pake3', cA: randomBytes(32).toString('base64'), machine, token: randomBytes(32).toString('base64url') }))
    expect(await closed).toBe(PAIRING_CLOSE_FAILED)
    expect(received).toHaveLength(1)
    for (const detail of [b.service.machine.id, '"beta"', '0.2.0+bench']) expect(received.join('\n')).not.toContain(detail)
    expect(b.service.linkedMachines()).toEqual([])
  })

  it('a pairing carries B\'s details in pake4, after A\'s confirmation, and A\'s in pake3', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    const frames: string[] = []
    const send = WebSocket.prototype.send
    const sendSpy = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (typeof data === 'string' && data.startsWith('{"t":"pake')) frames.push(data)
      return (send as (...args: unknown[]) => void).call(this, data, ...rest)
    })
    try {
      await bench.link(a, b)
    } finally {
      sendSpy.mockRestore()
    }
    const kinds = frames.map((frame) => (JSON.parse(frame) as { t: string }).t)
    expect(kinds).toEqual(['pake1', 'pake2', 'pake3', 'pake4', 'pake5', 'pake6'])
    expect(frames.filter((frame) => frame.includes(b.service.machine.id)).map((frame) => (JSON.parse(frame) as { t: string }).t)).toEqual(['pake4'])
    expect(frames.filter((frame) => frame.includes(a.service.machine.id)).map((frame) => (JSON.parse(frame) as { t: string }).t)).toEqual(['pake3'])
  })

  it(`refuses a worfy of link protocol 1, whose pake2 still carries B's details, by version and not as a wrong code`, async () => {
    // The pairing frames changed with protocol 2: an older worfy would otherwise fail the schema of pake2.
    expect(LINK_PROTOCOL_VERSION).toBe(3)
    const b = await bench.machine('beta')
    const c = await bench.machine('gamma')
    const code = await bench.codeOf(b)
    const error = await rejection(
      openLinkSocket({ host: '127.0.0.1', port: bench.portOf(b), path: PAIR_PATH, key: secretsOf(c)['machine-key'] ?? '', certificate: certificateOf(c), protocolVersion: 1 }),
    )
    expect((error as LinkConnectError).kind).toBe('protocol')
    expect(error.message).toMatch(/speaks link protocol 3, the connecting worfy speaks 1/)
    // The refusal comes before the attempt: the code is neither burnt nor counted.
    expect(b.service.pairingCode()?.code).toBe(code)
    expect(b.pairingFailures).toEqual([])
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

describe('PairingWindow', () => {
  const openWindow = (): { win: PairingWindow; changes: () => number } => {
    let changes = 0
    const win = new PairingWindow(() => 0, PAIRING_CODE_TTL_MS, () => (changes += 1))
    win.open()
    return { win, changes: () => changes }
  }

  it(`closes after ${PAIRING_MAX_FAILURES} attempts in a row that ended before the first message, like ${PAIRING_MAX_FAILURES} wrong codes, and keeps the code`, () => {
    const silent = openWindow()
    const code = silent.win.code()?.code
    for (let attempt = 1; attempt < PAIRING_MAX_FAILURES; attempt++) {
      expect(silent.win.begin()).toBeNull()
      expect(silent.win.end(false)).toBe('open')
      expect(silent.win.code()?.code).toBe(code)
    }
    expect(silent.win.begin()).toBeNull()
    expect(silent.win.end(false)).toBe('closed')
    expect(silent.win.isOpen).toBe(false)
    // Only the opening and the closing changed the code shown: no attempt replaced it.
    expect(silent.changes()).toBe(2)

    const wrong = openWindow()
    for (let attempt = 1; attempt < PAIRING_MAX_FAILURES; attempt++) {
      expect(wrong.win.begin()).toBeNull()
      wrong.win.take()
      expect(wrong.win.end(false)).toBe('open')
    }
    expect(wrong.win.code()?.code).not.toBe(code)
    expect(wrong.win.begin()).toBeNull()
    wrong.win.take()
    expect(wrong.win.end(false)).toBe('closed')
  })

  /** A window over a clock the test moves; each attempt reopens it, so only the count over the hour can close it. */
  const clockedWindow = (): { win: PairingWindow; at: (ms: number) => void; fail: (address?: string) => 'open' | 'closed' } => {
    let now = 0
    const win = new PairingWindow(() => now, PAIRING_CODE_TTL_MS, () => undefined)
    return {
      win,
      at: (ms) => {
        now = ms
      },
      fail: (address = '10.0.0.1') => {
        win.close()
        win.open()
        expect(win.begin()).toBeNull()
        return win.end(false, address)
      },
    }
  }

  it('counts only the failures of the last hour: one older than an hour no longer counts (the clock is moved)', () => {
    const { win, at, fail } = clockedWindow()
    expect(fail()).toBe('open')
    at(31 * MINUTE)
    for (let attempt = 2; attempt < PAIRING_HOURLY_FAILURES; attempt++) expect(fail()).toBe('open')
    // The first failure is now exactly an hour old: out of the window, so 9 failures still leave linking open.
    at(PAIRING_FAILURE_WINDOW_MS)
    expect(fail()).toBe('open')
    expect(win.pausedUntil()).toBeNull()
    at(PAIRING_FAILURE_WINDOW_MS + MINUTE)
    expect(fail()).toBe('closed')
    // Paused until the oldest of the ten failures in the window is an hour old.
    const until = 31 * MINUTE + PAIRING_FAILURE_WINDOW_MS
    expect(win.pausedUntil()).toBe(until)
    expect(win.open()).toBe(false)
    expect(win.isOpen).toBe(false)
    expect(win.begin()).toBe(PAIRING_PAUSED)
    at(until - 1)
    expect(win.open()).toBe(false)
    at(until)
    expect(win.pausedUntil()).toBeNull()
    expect(win.open()).toBe(true)
    expect(win.begin()).toBeNull()
  })

  it('a successful link does not reset the count of failures in the hour', () => {
    let now = 0
    const win = new PairingWindow(() => now, PAIRING_CODE_TTL_MS, () => undefined)
    win.open()
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(win.begin()).toBeNull()
      expect(win.end(false, '10.0.0.1')).toBe('open')
    }
    now = MINUTE
    expect(win.begin()).toBeNull()
    win.take()
    expect(win.end(true)).toBe('open')
    // The success reset the failures in a row (5 after it are not 10), but not the 10 in the hour.
    for (let attempt = 1; attempt < PAIRING_HOURLY_FAILURES - 5; attempt++) {
      expect(win.begin()).toBeNull()
      expect(win.end(false, '10.0.0.2')).toBe('open')
    }
    expect(win.begin()).toBeNull()
    expect(win.end(false, '10.0.0.2')).toBe('closed')
    expect(win.pausedUntil()).toBe(PAIRING_FAILURE_WINDOW_MS)
    expect(win.recentFailures()).toEqual({ failures: PAIRING_HOURLY_FAILURES, addresses: ['10.0.0.1', '10.0.0.2'] })
  })

  it('counts an attempt that is ended twice (its socket closed as its step timed out) once', () => {
    const { win } = openWindow()
    for (let attempt = 1; attempt < PAIRING_MAX_FAILURES; attempt++) {
      expect(win.begin()).toBeNull()
      expect(win.end(false)).toBe('open')
      expect(win.end(false)).toBe('open')
    }
    expect(win.begin()).toBeNull()
    expect(win.end(false)).toBe('closed')
  })

  it('does not count an attempt that close() cut off, nor replace the code, even when linking was opened again before it ended', () => {
    const { win, changes } = openWindow()
    expect(win.begin()).toBeNull()
    win.close()
    expect(win.end(false)).toBe('closed')

    win.open()
    expect(win.begin()).toBeNull()
    win.take()
    win.close()
    win.open()
    const reopened = win.code()?.code
    const shown = changes()
    // The attempt cut off by close() ends only now, in the new opening.
    expect(win.end(false)).toBe('open')
    expect(win.code()?.code).toBe(reopened)
    expect(changes()).toBe(shown)
    for (let attempt = 1; attempt < PAIRING_MAX_FAILURES; attempt++) {
      expect(win.begin()).toBeNull()
      expect(win.end(false)).toBe('open')
    }
    expect(win.begin()).toBeNull()
    expect(win.end(false)).toBe('closed')
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
    const frames: string[] = []
    const send = WebSocket.prototype.send
    const sendSpy = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (typeof data === 'string' && data.startsWith('{"t":"pake')) frames.push(data)
      return (send as (...args: unknown[]) => void).call(this, data, ...rest)
    })
    let error: Error
    try {
      error = await rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(impostor), code }))
    } finally {
      sendSpy.mockRestore()
    }
    expect(error.message).toMatch(/already linked with another certificate/)
    await expect.poll(() => impostor.pairingFailures.length).toBe(1)
    // A learns who B claims to be from pake4, after both confirmations, and refuses before it accepts.
    const kinds = frames.map((frame) => JSON.parse(frame) as { t: string; token?: string })
    expect(kinds.map((frame) => frame.t)).toEqual(['pake1', 'pake2', 'pake3', 'pake4'])
    expect(a.service.linkedMachines()).toEqual(before)
    expect(impostor.service.linkedMachines()).toEqual([])

    // The token A handed over in pake3 was never stored by A: it opens nothing there.
    const handedOver = kinds.find((frame) => frame.t === 'pake3')?.token ?? ''
    expect(handedOver).not.toBe('')
    expect(bench.files(a).some((file) => file.bytes.toString('utf8').includes(tokenHash(handedOver)))).toBe(false)
    const entry = await rejection(
      openLinkSocket({
        host: '127.0.0.1',
        port: bench.portOf(a),
        path: CONNECT_PATH,
        key: secretsOf(impostor)['machine-key'] ?? '',
        certificate: certificateOf(impostor),
        expectFingerprint: fingerprintOf(certificateOf(a)),
        token: handedOver,
      }),
    )
    expect((entry as LinkConnectError).kind).toBe('unauthorized')
  })

  /**
   * Holds back the pairing frames of the kinds passed to hold() (until pass()), whichever bench socket sends
   * them, in the order they were sent, and the close of a socket that has a frame held;
   * release(t, i) sends the i-th held frame of kind t, then that socket's close. Lets a test put
   * two attempts between their check of the peer and their commit at once.
   */
  function frameGate(): {
    hold: (t: string) => void
    pass: (t: string) => void
    held: (t: string) => number
    release: (t: string, index: number) => void
    restore: () => void
  } {
    const send = WebSocket.prototype.send as (...args: unknown[]) => void
    const close = WebSocket.prototype.close as (...args: unknown[]) => void
    const holding = new Set<string>()
    const queues = new Map<string, { ws: WebSocket; args: unknown[] }[]>()
    const waiting = new Map<WebSocket, unknown[] | null>()
    const spies = [
      vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, data: unknown, ...rest: unknown[]) {
        const kind = typeof data === 'string' ? /^\{"t":"(pake\d)"/.exec(data)?.[1] : undefined
        if (kind !== undefined && holding.has(kind)) {
          queues.get(kind)?.push({ ws: this, args: [data, ...rest] })
          waiting.set(this, null)
          return
        }
        send.call(this, data, ...rest)
      }),
      vi.spyOn(WebSocket.prototype, 'close').mockImplementation(function (this: WebSocket, ...args: unknown[]) {
        if (waiting.has(this)) waiting.set(this, args)
        else close.call(this, ...args)
      }),
    ]
    return {
      hold: (t) => {
        holding.add(t)
        if (!queues.has(t)) queues.set(t, [])
      },
      pass: (t) => holding.delete(t),
      held: (t) => queues.get(t)?.length ?? 0,
      release: (t, index) => {
        const frame = queues.get(t)?.[index]
        if (frame === undefined) throw new Error(`no held ${t} frame #${index}`)
        send.call(frame.ws, ...frame.args)
        const closed = waiting.get(frame.ws)
        waiting.delete(frame.ws)
        if (closed !== null && closed !== undefined) close.call(frame.ws, ...closed)
      },
      restore: () => {
        for (const spy of spies) spy.mockRestore()
      },
    }
  }

  const linkedFile = (machine: BenchMachine): unknown => linkFile<unknown>(machine, 'linked.json')

  it('A refuses the second of two pair() calls at once with one id and different certificates, and keeps the first link', async () => {
    const a = await bench.machine('alpha')
    const c = await bench.machine('gamma')
    const impostor = await impostorOf(c)
    // A checks the peer on pake4 and commits on pake6: holding every pake6 puts both attempts
    // past the check and before the commit.
    const frames = frameGate()
    frames.hold('pake6')
    let second: Promise<Error> | undefined
    try {
      const codeOfC = await bench.codeOf(c)
      const first = a.service.pair({ host: '127.0.0.1', port: bench.portOf(c), code: codeOfC })
      await expect.poll(() => frames.held('pake6')).toBe(1)
      const codeOfImpostor = await bench.codeOf(impostor)
      second = rejection(a.service.pair({ host: '127.0.0.1', port: bench.portOf(impostor), code: codeOfImpostor }))
      await expect.poll(() => frames.held('pake6')).toBe(2)

      frames.release('pake6', 0)
      const linked = await first
      expect(linked).toMatchObject({ id: c.service.machine.id, fingerprint: fingerprintOf(certificateOf(c)) })
      const record = linkedFile(a)
      const secrets = secretsOf(a)

      frames.release('pake6', 1)
      const error = await second
      expect(error.message).toMatch(/already linked with another certificate/)
      expect(linkedFile(a)).toEqual(record)
      expect(secretsOf(a)).toEqual(secrets)
      expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ id: c.service.machine.id, fingerprint: fingerprintOf(certificateOf(c)) })])
    } finally {
      frames.restore()
      await second?.catch(() => undefined)
    }
  })

  it('A, answering as B, refuses a peer with the id it is linking at the same time under another certificate', async () => {
    const a = await bench.machine('alpha')
    const c = await bench.machine('gamma')
    const impostor = await impostorOf(c)
    // A as the initiator checks C on pake4 and commits on pake6; A as the responder checks the
    // impostor on pake3 and commits on pake5. pake5 is held only once A has sent its own to C.
    const frames = frameGate()
    frames.hold('pake6')
    let answered: Promise<Error> | undefined
    try {
      const codeOfC = await bench.codeOf(c)
      const first = a.service.pair({ host: '127.0.0.1', port: bench.portOf(c), code: codeOfC })
      await expect.poll(() => frames.held('pake6')).toBe(1)
      frames.hold('pake5')
      const codeOfA = await bench.codeOf(a)
      answered = rejection(impostor.service.pair({ host: '127.0.0.1', port: bench.portOf(a), code: codeOfA }))
      await expect.poll(() => frames.held('pake5')).toBe(1)

      frames.release('pake6', 0)
      frames.pass('pake6')
      expect(await first).toMatchObject({ id: c.service.machine.id, fingerprint: fingerprintOf(certificateOf(c)) })
      const record = linkedFile(a)
      const secrets = secretsOf(a)

      frames.release('pake5', 0)
      expect((await answered).message).toBe(PAIRING_FAILED)
      await expect.poll(() => a.pairingFailures.some((message) => message.includes('already linked with another certificate'))).toBe(true)
      expect(linkedFile(a)).toEqual(record)
      expect(secretsOf(a)).toEqual(secrets)
      expect(a.service.linkedMachines()).toEqual([expect.objectContaining({ id: c.service.machine.id, fingerprint: fingerprintOf(certificateOf(c)) })])
    } finally {
      frames.restore()
      await answered?.catch(() => undefined)
    }
  })
})
