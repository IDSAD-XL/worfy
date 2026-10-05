// window.worfy inside a Card (ticket 26): Promise wrappers over the postMessage protocol of
// src/shared/cards/bridge.ts. The worfy-card:// protocol puts this function, as source text, into
// the <head> of every HTML file a Card serves (src/main/cards/protocol.ts, CARD_RUNTIME_SCRIPT),
// so it runs before the Card's own scripts.
//
// Because it is shipped as text, installWorfyCard must be self-contained: no imports, nothing from
// the module around it, only what the function declares inside itself. Its parameter is typed by
// hand rather than with the DOM library, so the main process (which has no DOM types) can import it.
//
// The Card talks only to its parent, the worfy window: requests go to window.parent, and a message
// is taken only when its source is window.parent. The window, in turn, accepts a message only from
// this frame and this origin (src/renderer/canvas/card-bridge.ts).

/** The parts of a Card's window the runtime uses. */
export interface CardRuntimeHost {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(type: 'message', listener: (event: { source: unknown; data: unknown }) => void): void
  document: { body: { innerText?: string; textContent: string | null } | null }
}

/** The API a Card gets as window.worfy. */
export interface WorfyCardApi {
  data: {
    /** The Card's own data; null until it stores some. */
    get(): Promise<unknown>
    /** Replaces the Card's data with a JSON value of at most 1 MB. */
    set(value: unknown): Promise<void>
  }
  /** Asks the user to send `text` to the Session that last edited the Card (or the Orchestrator). */
  ask(text: string): Promise<{ sent: true } | { sent: false; canceled: true }>
  workflow: {
    /** Epics and Tickets of the Project with their Waves and Gate / PR / CI badges, read-only. */
    get(): Promise<unknown>
    /** Calls `listener` with the snapshot now and on every change; returns the function that stops it. */
    subscribe(listener: (snapshot: unknown) => void): () => void
  }
}

export function installWorfyCard(host: CardRuntimeHost): void {
  const TEXT_LIMIT = 100000
  let counter = 0
  const pending = new Map<string, { op: string; resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(snapshot: unknown) => void>()
  /** The subscription's request, once sent; null again after it failed. */
  let subscription: Promise<void> | null = null
  /** The newest snapshot: the subscription's answer, then each event. */
  let latest: { value: unknown } | null = null

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

  const request = (op: string, args?: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      counter += 1
      const requestId = `c${counter}`
      pending.set(requestId, { op, resolve, reject })
      // The parent is the worfy window on file:// (or the dev server), whose origin a Card cannot
      // name; the window checks this frame and its origin on its side.
      host.parent.postMessage(args === undefined ? { type: 'worfy.request', requestId, op } : { type: 'worfy.request', requestId, op, args }, '*')
    })

  const notify = (snapshot: unknown): void => {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot)
      } catch (error) {
        console.error('[worfy] a workflow listener threw', error)
      }
    }
  }

  const visibleText = (): string => {
    const body = host.document.body
    if (body === null) return ''
    const text = typeof body.innerText === 'string' ? body.innerText : (body.textContent ?? '')
    return text.slice(0, TEXT_LIMIT)
  }

  host.addEventListener('message', (event) => {
    if (event.source !== host.parent) return
    const message = event.data
    if (!isRecord(message)) return
    if (message.type === 'worfy.response' && typeof message.requestId === 'string') {
      const entry = pending.get(message.requestId)
      if (entry === undefined) return
      pending.delete(message.requestId)
      if (message.ok === true) entry.resolve(entry.op === 'session.ask' ? { sent: true } : message.data)
      else if (entry.op === 'session.ask' && message.canceled === true) entry.resolve({ sent: false, canceled: true })
      else entry.reject(new Error(typeof message.error === 'string' ? message.error : 'worfy refused the request'))
      return
    }
    if (message.type === 'worfy.event' && message.event === 'workflow') {
      latest = { value: message.data }
      notify(message.data)
      return
    }
    if (message.type === 'worfy.request' && message.op === 'card.text' && typeof message.requestId === 'string') {
      host.parent.postMessage({ type: 'worfy.response', requestId: message.requestId, ok: true, data: { text: visibleText() } }, '*')
    }
  })

  const api: WorfyCardApi = {
    data: Object.freeze({
      get: () => request('data.get'),
      set: (value: unknown) => request('data.set', { value }).then(() => undefined),
    }),
    ask: (text: string) => request('session.ask', { text }) as Promise<{ sent: true } | { sent: false; canceled: true }>,
    workflow: Object.freeze({
      get: () => request('workflow.get'),
      subscribe: (listener: (snapshot: unknown) => void) => {
        listeners.add(listener)
        if (latest !== null) {
          // Subscribed already: this listener gets the newest snapshot, the others are not called again.
          const { value } = latest
          void Promise.resolve().then(() => {
            if (listeners.has(listener)) listener(value)
          })
        } else if (subscription === null) {
          subscription = request('workflow.subscribe').then(
            (snapshot) => {
              // An event may have come first; it is newer than this answer.
              if (latest !== null) return
              latest = { value: snapshot }
              notify(snapshot)
            },
            (error: unknown) => {
              subscription = null
              console.error('[worfy] workflow.subscribe failed', error)
            },
          )
        }
        return () => {
          listeners.delete(listener)
        }
      },
    }),
  }
  Object.defineProperty(host, 'worfy', { value: Object.freeze(api), enumerable: true, configurable: false, writable: false })
}
