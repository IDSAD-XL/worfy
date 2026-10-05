// The window's side of the Card API (src/shared/cards/bridge.ts, ticket 26). A Card runs in an
// iframe on its own origin (ADR-0012) and talks to worfy only by postMessage. A message counts
// only when it comes from the contentWindow of a Card frame on the Canvas *and* carries that
// frame's own origin, worfy-card://<card id>.<project label>; anything else is dropped without an
// answer. The request is parsed with zod, and only the parsed request reaches the backend: the
// Card's own data and `session.ask` go to main over IPC, the workflow snapshot comes from what
// the window already reads. The answer goes back to the same frame, addressed to its origin.
//
// The other direction, worfy → Card: `cardText(cardId)` asks a Card for its visible text (ticket
// 31, search over the Canvas), and `publishWorkflow` sends a new snapshot to Cards that subscribed.
//
// This module touches no DOM global: the overlay that mounts it (overlays/CardBridge.tsx) finds the
// frames and feeds it the window's `message` events, and tests drive it with plain objects.
import {
  canceledResponse,
  cardTextRequest,
  cardTextResponseSchema,
  errorResponse,
  okResponse,
  parseCardRequest,
  workflowEvent,
  type CardData,
  type CardRequest,
  type CardResponse,
  type WorkflowSnapshot,
} from '../../shared/cards/bridge'

/** The part of a frame's contentWindow the bridge uses. */
export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

/** A Card frame on the Canvas. */
export interface CardFrame {
  cardId: string
  /** The frame's origin, worfy-card://<card id>.<project label>; the only origin accepted from it. */
  origin: string
  /** The frame's contentWindow: the only sender accepted, and where answers go. */
  window: MessageTarget
}

/** The part of a `message` event the bridge reads. */
export interface BridgeMessage {
  source: unknown
  origin: string
  data: unknown
}

/** What answers a Card's requests. Each call names the Card; a rejection becomes an error answer. */
export interface CardBridgeBackend {
  dataGet(cardId: string): Promise<CardData>
  dataSet(cardId: string, value: CardData): Promise<void>
  /** `sent: false` when the user said no in the confirmation dialog. */
  ask(cardId: string, text: string): Promise<{ sent: boolean }>
  workflow(): Promise<WorkflowSnapshot>
}

export interface CardBridgeOptions {
  /** The Card frames on the Canvas now. */
  frames: () => readonly CardFrame[]
  backend: CardBridgeBackend
  /** How long `cardText` waits for a Card's answer. */
  textTimeoutMs?: number
}

export interface CardBridge {
  /** Takes one `message` event of the window; true when it came from a Card frame and was taken. */
  receive(message: BridgeMessage): boolean
  /** Sends a new workflow snapshot to the Cards that subscribed and still have a frame. */
  publishWorkflow(snapshot: WorkflowSnapshot): void
  /** A Card's visible text, at most CARD_TEXT_LIMIT characters; null when it has no frame or does not answer. */
  cardText(cardId: string): Promise<string | null>
  /** Forgets subscriptions and gives up waiting for answers. */
  dispose(): void
}

export const CARD_TEXT_TIMEOUT_MS = 2000

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createCardBridge(options: CardBridgeOptions): CardBridge {
  const { backend } = options
  /** Frames whose Card subscribed to the workflow, by their window. */
  const subscribed = new Set<MessageTarget>()
  /** worfy's own requests to Cards (card.text), by request id. */
  const waiting = new Map<string, { frame: CardFrame; resolve: (text: string | null) => void; timer: ReturnType<typeof setTimeout> }>()
  let counter = 0

  const frameOf = (message: BridgeMessage): CardFrame | null => {
    const frame = options.frames().find((each) => each.window === message.source)
    if (!frame || message.origin !== frame.origin) return null
    return frame
  }

  const reply = (frame: CardFrame, response: CardResponse | ReturnType<typeof workflowEvent>): void => {
    try {
      frame.window.postMessage(response, frame.origin)
    } catch (error) {
      console.warn(`[card-bridge] could not answer Card ${frame.cardId}`, error)
    }
  }

  async function answer(frame: CardFrame, request: CardRequest): Promise<CardResponse> {
    const { requestId } = request
    switch (request.op) {
      case 'data.get':
        return okResponse(requestId, await backend.dataGet(frame.cardId))
      case 'data.set':
        await backend.dataSet(frame.cardId, request.args.value)
        return okResponse(requestId, null)
      case 'session.ask': {
        const { sent } = await backend.ask(frame.cardId, request.args.text)
        return sent ? okResponse(requestId, { sent: true }) : canceledResponse(requestId)
      }
      case 'workflow.get':
        return okResponse(requestId, await backend.workflow())
      case 'workflow.subscribe': {
        const snapshot = await backend.workflow()
        subscribed.add(frame.window)
        return okResponse(requestId, snapshot)
      }
    }
  }

  function takeTextAnswer(frame: CardFrame, data: unknown): void {
    const parsed = cardTextResponseSchema.safeParse(data)
    if (!parsed.success) return
    const entry = waiting.get(parsed.data.requestId)
    if (!entry || entry.frame.window !== frame.window) return
    waiting.delete(parsed.data.requestId)
    clearTimeout(entry.timer)
    entry.resolve(parsed.data.data.text)
  }

  return {
    receive(message) {
      const frame = frameOf(message)
      if (frame === null) return false
      const { data } = message
      if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'worfy.response') {
        takeTextAnswer(frame, data)
        return true
      }
      const parsed = parseCardRequest(data)
      if (!parsed.ok) {
        if (parsed.requestId !== null) reply(frame, errorResponse(parsed.requestId, parsed.error))
        return parsed.requestId !== null
      }
      void answer(frame, parsed.request).then(
        (response) => reply(frame, response),
        (error: unknown) => reply(frame, errorResponse(parsed.request.requestId, messageOf(error))),
      )
      return true
    },

    publishWorkflow(snapshot) {
      const frames = options.frames()
      for (const target of [...subscribed]) {
        const frame = frames.find((each) => each.window === target)
        if (!frame) {
          subscribed.delete(target)
          continue
        }
        reply(frame, workflowEvent(snapshot))
      }
    },

    cardText(cardId) {
      const frame = options.frames().find((each) => each.cardId === cardId)
      if (!frame) return Promise.resolve(null)
      counter += 1
      const requestId = `w${counter}`
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(requestId)
          resolve(null)
        }, options.textTimeoutMs ?? CARD_TEXT_TIMEOUT_MS)
        waiting.set(requestId, { frame, resolve, timer })
        try {
          frame.window.postMessage(cardTextRequest(requestId), frame.origin)
        } catch {
          clearTimeout(timer)
          waiting.delete(requestId)
          resolve(null)
        }
      })
    },

    dispose() {
      subscribed.clear()
      for (const entry of waiting.values()) {
        clearTimeout(entry.timer)
        entry.resolve(null)
      }
      waiting.clear()
    },
  }
}

let current: CardBridge | null = null

/** The bridge of this window, set by the overlay that mounts it. */
export function setCurrentCardBridge(bridge: CardBridge | null): void {
  current = bridge
}

/** A Card's visible text for search (ticket 31); null when no bridge runs or the Card has no frame. */
export function requestCardText(cardId: string): Promise<string | null> {
  return current ? current.cardText(cardId) : Promise.resolve(null)
}
