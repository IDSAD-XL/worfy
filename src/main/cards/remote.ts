// The second source of Card files (worfy-link ticket 10; ADR-0052, ADR-0053): the Cards of Linked
// machines that a window of this Machine shows. Their address carries the machine label of the
// Linked machine (worfy-card://<card id>.<project label>.<machine label>/<path>,
// src/main/cards/protocol.ts); this module finds the Linked machine with that label and asks it for
// the file with `cards.file` (src/shared/ipc/cards.ts) over the link, piece by piece. The Linked
// machine finds and checks the file itself (readCardFileChunk there); what comes back is held to
// the channel's schema by the link (src/main/link/remote-calls.ts) and to the size limit here.
//
// The link is loaded on the first request only: the protocol module stays light for the tests and
// the start of the app.
import { machineLabel } from '../../shared/cards/bridge'
import type { IpcResult } from '../../shared/ipc/channels'
import { CARD_FILE_CHUNK_BYTES, CARD_FILE_LIMIT_BYTES, cardFileAnswerSchema } from '../../shared/ipc/cards'
import type { LinkedCardFile, LinkedCardRequest, LinkedCardSource } from './protocol'

/** What the source needs of the link. */
export interface LinkedCardDeps {
  /** The Linked machines of this Machine, by id. */
  machines(): Promise<readonly { id: string }[]>
  /** Calls a channel on Linked machine `machine`; resolves with its result, never rejects. */
  call(machine: string, channel: string, input: unknown): Promise<IpcResult<unknown>>
}

/** A file whose size or type changed between two pieces is not glued together: it is read again from the start, at most this often. */
const READ_ATTEMPTS = 2

/** The second source over `deps`; protocol.ts's createCardHandler takes it. */
export function createLinkedCardSource(deps: LinkedCardDeps): LinkedCardSource {
  return async (request) => {
    const matches = (await deps.machines()).filter((machine) => machineLabel(machine.id) === request.machineLabel)
    const [machine] = matches
    // None, or two Linked machines whose labels collide: no telling whose Card it is.
    if (matches.length !== 1 || machine === undefined) return { status: 'unknown-machine' }
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      const file = await readFrom(deps, machine.id, request)
      if (file !== 'changed') return file
    }
    return { status: 'missing' }
  }
}

/** One read of the whole file; 'changed' when it changed between two pieces. */
async function readFrom(deps: LinkedCardDeps, machine: string, request: LinkedCardRequest): Promise<LinkedCardFile | 'changed'> {
  const chunks: Uint8Array[] = []
  let received = 0
  let first: { extension: string; size: number } | undefined
  for (;;) {
    const length = request.head ? 0 : CARD_FILE_CHUNK_BYTES
    const input = { projectLabel: request.projectLabel, cardId: request.cardId, path: request.pathname, offset: received, length }
    const result = await deps.call(machine, 'cards.file', input)
    if (!result.ok) return { status: 'unreachable', reason: result.error }
    const answer = cardFileAnswerSchema.safeParse(result.value)
    if (!answer.success) return { status: 'unreachable', reason: 'cards.file: the Linked machine answered outside the contract' }
    const piece = answer.data
    if (piece.status === 'too-large') return { status: 'too-large' }
    if (piece.status === 'missing') return first === undefined ? { status: 'missing' } : 'changed'
    if (piece.size > CARD_FILE_LIMIT_BYTES) return { status: 'too-large' }
    if (first === undefined) first = { extension: piece.extension, size: piece.size }
    else if (piece.size !== first.size || piece.extension !== first.extension) return 'changed'
    const bytes = Buffer.from(piece.base64, 'base64')
    if (bytes.byteLength > CARD_FILE_CHUNK_BYTES || received + bytes.byteLength > first.size) return 'changed'
    chunks.push(bytes)
    received += bytes.byteLength
    if (request.head || received === first.size) return { status: 'file', extension: first.extension, bytes: concat(chunks, received) }
    // A piece with nothing in it before the end: the file got shorter meanwhile.
    if (bytes.byteLength === 0) return 'changed'
  }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0]
  const whole = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.byteLength
  }
  return whole
}

/** The app's second source: the Linked machines of the app's link service, called from main (worfy-link ticket 09). */
export const appLinkedCardSource: LinkedCardSource = createLinkedCardSource({
  machines: async () => {
    const { appLinkService } = await import('../link/service')
    return appLinkService()?.linkedMachines() ?? []
  },
  call: async (machine, channel, input) => {
    const { callOn } = await import('../link/remote-calls')
    return callOn(machine, channel, input)
  },
})
