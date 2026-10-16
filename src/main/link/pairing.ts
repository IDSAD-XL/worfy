// Pairing (ADR-0052, point 4): Machine B shows a 6-digit code, the user types it on Machine A, and
// both end up with the other's certificate fingerprint and a token to enter the other.
//
// The code proves the two certificates, not only the code. The exchange is SPAKE2 (RFC 9382,
// https://www.rfc-editor.org/rfc/rfc9382, ciphersuite P256-SHA256-HKDF-HMAC) with the code as the
// password, over the TLS connection A opened to B (A presents its own certificate as the TLS client
// certificate). The identities in the SPAKE2 transcript are the two certificate fingerprints each
// side saw in this connection: A's certificate as A = client, B's certificate as B = server. A
// machine in the middle with certificates of its own makes the two sides see different
// fingerprints, so their transcripts differ, the key confirmation fails on both sides, and nothing
// is stored. SPAKE2 gives an attacker one guess per run: a captured exchange cannot be checked
// against other codes offline. B burns the code at the first message of any attempt and shows a
// new one; a code also expires (PAIRING_CODE_TTL_MS) and only one attempt runs at a time.
//
// The group arithmetic is @noble/curves (P-256, audited); the transcript, key schedule and
// confirmation follow RFC 9382 sections 3.3 and 4 and are checked against all four test vectors of
// its Appendix B (test/contract/link-pairing.test.ts). Per RFC 9382 section 3.2 the protocol defines w:
// scrypt (a memory-hard function) of the code, 64 bits longer than the group order, reduced mod p.
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { p256 } from '@noble/curves/nist.js'
import type WebSocket from 'ws'
import { z } from 'zod'
import { helloMessage, LINK_PROTOCOL_VERSION } from './messages'

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

const Point = p256.Point
type CurvePoint = InstanceType<typeof Point>
const ORDER = Point.Fn.ORDER

/** RFC 9382, section 6, for P-256. */
export const SPAKE2_M = Point.fromHex('02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f')
export const SPAKE2_N = Point.fromHex('03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49')

/** How long a pairing code lives. */
export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000

/** How long one step of a pairing attempt may wait for the other side. */
export const PAIRING_STEP_TIMEOUT_MS = 15_000

/** The associated data of the key confirmation (RFC 9382, section 4): the protocol, against downgrade. */
const PAIRING_AAD = Buffer.from(`worfy-link/${LINK_PROTOCOL_VERSION}`)

export type Spake2Role = 'A' | 'B'

const bigintOf = (bytes: Uint8Array): bigint => BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`)
const bytes32 = (value: bigint): Buffer => Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
const le64 = (length: number): Buffer => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(length))
  return buffer
}
const field = (value: Uint8Array): Buffer => Buffer.concat([le64(value.length), Buffer.from(value)])

/** A uniformly random scalar in [1, p). */
export function randomScalar(): bigint {
  return (bigintOf(randomBytes(48)) % (ORDER - 1n)) + 1n
}

/** w for a pairing code: scrypt of the code, 40 bytes (p plus 64 bits), mod p. */
export async function codeScalar(code: string): Promise<bigint> {
  const derived = await scrypt(code, 'worfy-link pairing code', 40, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return bigintOf(derived) % ORDER
}

/** pA = w*M + x*P for A, pB = w*N + y*P for B, uncompressed SEC1. */
export function spake2Share(role: Spake2Role, w: bigint, secret: bigint): Uint8Array {
  const blind = role === 'A' ? SPAKE2_M : SPAKE2_N
  return blind.multiply(w).add(Point.BASE.multiply(secret)).toBytes(false)
}

export interface Spake2Result {
  /** The shared secret Ke (unused by the link: TLS already encrypts; kept for the RFC test). */
  ke: Buffer
  kcA: Buffer
  kcB: Buffer
  /** cA = MAC(KcA, TT) and cB = MAC(KcB, TT). */
  confirmA: Buffer
  confirmB: Buffer
}

export interface Spake2FinishInput {
  role: Spake2Role
  w: bigint
  secret: bigint
  ownShare: Uint8Array
  peerShare: Uint8Array
  idA: Uint8Array
  idB: Uint8Array
  aad: Uint8Array
}

const INVALID_SHARE = 'pairing: the other share is invalid'

/**
 * The other side's share as a point of the group. RFC 9382 section 6 encodes P-256 shares as
 * uncompressed SEC1 points (65 bytes, 0x04 first); fromBytes alone would also take a compressed
 * point, an encoding the protocol does not define. fromBytes rejects a point off the curve and a
 * coordinate outside the field; the identity has no uncompressed encoding. Every refusal is the
 * same error.
 */
function peerPoint(share: Uint8Array): CurvePoint {
  if (share.length !== 65 || share[0] !== 0x04) throw new Error(INVALID_SHARE)
  try {
    const point = Point.fromBytes(share)
    point.assertValidity()
    return point
  } catch {
    throw new Error(INVALID_SHARE)
  }
}

/** RFC 9382 sections 3.3 and 4: K, the transcript TT, Ke || Ka = Hash(TT), KcA || KcB, the confirmations. */
export function spake2Finish({ role, w, secret, ownShare, peerShare, idA, idB, aad }: Spake2FinishInput): Spake2Result {
  const peer = peerPoint(peerShare)
  const unblind = role === 'A' ? SPAKE2_N : SPAKE2_M
  const shared = peer.subtract(unblind.multiply(w))
  if (shared.is0()) throw new Error(INVALID_SHARE)
  const k = shared.multiply(secret)
  // A second guard: unreachable while shared is not the identity and secret is in [1, p).
  if (k.is0()) throw new Error('pairing: the shared point K is the identity')
  const [pA, pB] = role === 'A' ? [ownShare, peerShare] : [peerShare, ownShare]
  const transcript = Buffer.concat([field(idA), field(idB), field(pA), field(pB), field(k.toBytes(false)), field(bytes32(w))])
  const digest = createHash('sha256').update(transcript).digest()
  const ke = digest.subarray(0, 16)
  const ka = digest.subarray(16)
  const confirmationKeys = Buffer.from(hkdfSync('sha256', ka, Buffer.alloc(0), Buffer.concat([Buffer.from('ConfirmationKeys'), Buffer.from(aad)]), 32))
  const kcA = confirmationKeys.subarray(0, 16)
  const kcB = confirmationKeys.subarray(16)
  return {
    ke,
    kcA,
    kcB,
    confirmA: createHmac('sha256', kcA).update(transcript).digest(),
    confirmB: createHmac('sha256', kcB).update(transcript).digest(),
  }
}

/** A 6-digit code, uniform over 000000–999999. */
export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export const PAIRING_CODE_PATTERN = /^\d{6}$/

/** A pairing failure; its message never carries the code or a token. */
export class PairingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PairingError'
  }
}

/** What the code proves wrong: the user cannot tell a typo from a machine in the middle, so neither do we. */
export const PAIRING_FAILED = 'the code did not match, or the connection to the other Machine was intercepted; nothing was linked'

/**
 * Failed attempts in a row after which "Link a machine" closes by itself. Each attempt is one guess
 * at one code, so this keeps an attacker on the network at 10 guesses per opening, 1 in 100 000.
 * An attempt that ends without the first SPAKE2 message counts too, whether it timed out or closed
 * itself, so a silent connection holds the one slot for at most 10 steps per opening.
 */
export const PAIRING_MAX_FAILURES = 10

/**
 * B's side of "Link a machine": whether linking is open, the current code, its age, and the one
 * attempt that may run. Codes are one-time: every attempt that reached the first SPAKE2 message
 * burns the code, and the next one is shown.
 */
export class PairingWindow {
  private current: { code: string; createdAt: number } | null = null
  private attemptRunning = false
  /** The running attempt has taken the code. */
  private burnt = false
  /** This side closed linking while the attempt ran, so the attempt is not the other Machine's failure. */
  private cut = false
  private failures = 0

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: number,
    private readonly onCodeChange: () => void,
  ) {}

  get isOpen(): boolean {
    return this.current !== null
  }

  open(): void {
    if (this.current !== null) return
    this.failures = 0
    this.rotate()
  }

  close(): void {
    if (this.attemptRunning) this.cut = true
    this.current = null
    this.onCodeChange()
  }

  /** The code to show and when it expires; an expired code is replaced first. Null when closed. */
  code(): { code: string; expiresAt: number } | null {
    if (this.current === null) return null
    if (this.expired()) this.rotate()
    return { code: this.current.code, expiresAt: this.current.createdAt + this.ttlMs }
  }

  /** Why a new attempt cannot start now, or null when it may (it then holds the one slot). */
  begin(): string | null {
    if (this.current === null) return 'linking is not open on this Machine'
    if (this.attemptRunning) return 'another Machine is linking right now; try again in a moment'
    if (this.expired()) {
      this.rotate()
      return 'the pairing code has expired; use the new code'
    }
    this.attemptRunning = true
    this.burnt = false
    this.cut = false
    return null
  }

  /** The code of the running attempt; from now on it is burnt, whatever the attempt ends with. */
  take(): string | null {
    this.burnt = true
    return this.current?.code ?? null
  }

  /**
   * Ends the running attempt, once. A failed attempt counts whether or not it took the code, and the
   * PAIRING_MAX_FAILURES-th failure in a row closes linking (the result is then 'closed'). Only a
   * burnt code is replaced: an attempt without the first message saw nothing. An attempt cut off by
   * close() neither counts nor replaces the code, even if linking was opened again meanwhile.
   */
  end(succeeded: boolean): 'open' | 'closed' {
    if (!this.attemptRunning) return this.isOpen ? 'open' : 'closed'
    this.attemptRunning = false
    const burnt = this.burnt
    const cut = this.cut
    this.burnt = false
    this.cut = false
    if (this.current === null) return 'closed'
    if (cut) return 'open'
    if (succeeded) this.failures = 0
    else this.failures += 1
    if (this.failures >= PAIRING_MAX_FAILURES) {
      this.close()
      return 'closed'
    }
    if (burnt) this.rotate()
    return 'open'
  }

  private expired(): boolean {
    return this.current !== null && this.now() - this.current.createdAt >= this.ttlMs
  }

  private rotate(): void {
    this.current = { code: newPairingCode(), createdAt: this.now() }
    this.onCodeChange()
  }
}

const base64 = z.string().regex(/^[A-Za-z0-9+/_=-]+$/).max(400)
const helloSchema = helloMessage.schema
export type Hello = z.output<typeof helloSchema>

// Each side introduces itself (name, build, port, id) only after the other's confirmation held, so
// a side without the code learns nothing about the other: A in pake3, after cB; B in pake4, after
// cA. Each checks who the other claims to be (PairingSide.accept) before anything is stored. B
// stores the link only once A accepted B (pake5), and A only once B stored it (pake6): A dials B
// right after linking, and a token B has not stored yet would make A forget B.
const pake1 = z.object({ t: z.literal('pake1'), pA: base64 })
const pake2 = z.object({ t: z.literal('pake2'), pB: base64, cB: base64 })
const pake3 = z.object({ t: z.literal('pake3'), cA: base64, machine: helloSchema, token: base64 })
const pake4 = z.object({ t: z.literal('pake4'), machine: helloSchema, token: base64 })
const pake5 = z.object({ t: z.literal('pake5') })
const pake6 = z.object({ t: z.literal('pake6') })

/** Close code of a pairing that failed; the reason is PAIRING_FAILED or a timeout. */
export const PAIRING_CLOSE_FAILED = 4001

/** A fresh device token: 32 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

const fingerprintBytes = (fingerprint: string): Buffer => Buffer.from(fingerprint.replace(/:/g, ''), 'hex')

/** Waits for the next frame and parses it with `schema`; rejects on close, timeout or a wrong frame. */
function nextFrame<S extends z.ZodType>(ws: WebSocket, schema: S, timeoutMs: number): Promise<z.output<S>> {
  return new Promise((resolve, reject) => {
    // A socket closed meanwhile (closeLinking, a peer gone during scrypt) has no 'close' left to wait for.
    if (ws.readyState !== ws.OPEN) {
      reject(new PairingError('the connection closed while linking; nothing was linked'))
      return
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      ws.off('error', onError)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new PairingError('the other Machine did not answer in time; nothing was linked'))
    }, timeoutMs)
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup()
      let parsed: z.ZodSafeParseResult<z.output<S>>
      try {
        parsed = schema.safeParse(JSON.parse(String(data)))
      } catch {
        reject(new PairingError('the other Machine sent a malformed pairing message; nothing was linked'))
        return
      }
      if (parsed.success) resolve(parsed.data)
      else reject(new PairingError('the other Machine sent an unexpected pairing message; nothing was linked'))
    }
    const onClose = (code: number): void => {
      cleanup()
      reject(new PairingError(code === PAIRING_CLOSE_FAILED ? PAIRING_FAILED : 'the other Machine closed the connection while linking; nothing was linked'))
    }
    const onError = (): void => {
      cleanup()
      reject(new PairingError('the connection broke while linking; nothing was linked'))
    }
    ws.on('message', onMessage)
    ws.once('close', onClose)
    ws.once('error', onError)
  })
}

function sendFrame(ws: WebSocket, frame: object): void {
  ws.send(JSON.stringify(frame))
}

function fail(ws: WebSocket): never {
  ws.close(PAIRING_CLOSE_FAILED, 'pairing failed')
  throw new PairingError(PAIRING_FAILED)
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface PairingResult {
  /** The other Machine as it introduced itself. */
  peer: Hello
  /** The token this side presents to the other (the other keeps its hash). */
  outgoingToken: string
  /** The token this side issued to the other (this side keeps its hash only). */
  incomingToken: string
}

export interface PairingSide {
  /** This Machine, as the other side will store it. */
  local: Hello
  /** A's certificate fingerprint as seen in this connection (A's own, or the one B received). */
  clientFingerprint: string
  /** B's certificate fingerprint as seen in this connection. */
  serverFingerprint: string
  /**
   * Whether the other Machine, as it introduced itself, may be linked; throws a PairingError when
   * not. Called once the other's key confirmation held and the other introduced itself, before
   * anything is stored.
   */
  accept: (peer: Hello) => void
  /** Stores the link; called only after both confirmations held. Throwing aborts the pairing. */
  commit: (result: PairingResult) => void
  stepTimeoutMs?: number
}

function checkPeer(ws: WebSocket, side: PairingSide, peer: Hello): void {
  try {
    if (peer.id === side.local.id) throw new PairingError('a Machine cannot be linked with itself')
    side.accept(peer)
  } catch (error) {
    ws.close(PAIRING_CLOSE_FAILED, 'pairing failed')
    throw error
  }
}

/** A's side: runs SPAKE2 as A with the code typed by the user. */
export async function initiatePairing(ws: WebSocket, code: string, side: PairingSide): Promise<PairingResult> {
  const timeout = side.stepTimeoutMs ?? PAIRING_STEP_TIMEOUT_MS
  const w = await codeScalar(code)
  const x = randomScalar()
  const pA = spake2Share('A', w, x)
  sendFrame(ws, { t: 'pake1', pA: Buffer.from(pA).toString('base64') })

  const second = await nextFrame(ws, pake2, timeout)
  let keys: Spake2Result
  try {
    keys = spake2Finish({
      role: 'A',
      w,
      secret: x,
      ownShare: pA,
      peerShare: Buffer.from(second.pB, 'base64'),
      idA: fingerprintBytes(side.clientFingerprint),
      idB: fingerprintBytes(side.serverFingerprint),
      aad: PAIRING_AAD,
    })
  } catch {
    fail(ws)
  }
  if (!sameBytes(keys.confirmB, Buffer.from(second.cB, 'base64'))) fail(ws)

  // B knows the code and saw the same two certificates: the channel is B's, the token may go. It
  // opens nothing until A stores its hash (commit).
  const incomingToken = newToken()
  sendFrame(ws, { t: 'pake3', cA: keys.confirmA.toString('base64'), machine: side.local, token: incomingToken })
  const fourth = await nextFrame(ws, pake4, timeout)
  checkPeer(ws, side, fourth.machine)
  sendFrame(ws, { t: 'pake5' })
  await nextFrame(ws, pake6, timeout)
  const result: PairingResult = { peer: fourth.machine, outgoingToken: fourth.token, incomingToken }
  side.commit(result)
  ws.close(1000, 'linked')
  return result
}

/**
 * B's side: waits for A's share, takes (and so burns) the code, runs SPAKE2 as B. `takeCode`
 * returns null when linking was closed meanwhile.
 */
export async function respondToPairing(ws: WebSocket, takeCode: () => string | null, side: PairingSide): Promise<PairingResult> {
  const timeout = side.stepTimeoutMs ?? PAIRING_STEP_TIMEOUT_MS
  const first = await nextFrame(ws, pake1, timeout)
  const code = takeCode()
  if (code === null) fail(ws)
  const w = await codeScalar(code)
  const y = randomScalar()
  const pB = spake2Share('B', w, y)
  let keys: Spake2Result
  try {
    keys = spake2Finish({
      role: 'B',
      w,
      secret: y,
      ownShare: pB,
      peerShare: Buffer.from(first.pA, 'base64'),
      idA: fingerprintBytes(side.clientFingerprint),
      idB: fingerprintBytes(side.serverFingerprint),
      aad: PAIRING_AAD,
    })
  } catch {
    fail(ws)
  }
  sendFrame(ws, { t: 'pake2', pB: Buffer.from(pB).toString('base64'), cB: keys.confirmB.toString('base64') })

  const third = await nextFrame(ws, pake3, timeout)
  if (!sameBytes(keys.confirmA, Buffer.from(third.cA, 'base64'))) fail(ws)
  checkPeer(ws, side, third.machine)
  // A knows the code: B introduces itself now. Its token opens nothing until B stores its hash.
  const incomingToken = newToken()
  sendFrame(ws, { t: 'pake4', machine: side.local, token: incomingToken })
  await nextFrame(ws, pake5, timeout)
  const result: PairingResult = { peer: third.machine, outgoingToken: third.token, incomingToken }
  try {
    side.commit(result)
  } catch (error) {
    ws.close(PAIRING_CLOSE_FAILED, 'pairing failed')
    throw error
  }
  sendFrame(ws, { t: 'pake6' })
  return result
}
