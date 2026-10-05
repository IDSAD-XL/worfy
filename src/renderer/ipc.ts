// Typed access to the main process for React code. The preload exposes an untyped bridge
// (window.worfy); the channel types come from IpcContract (src/shared/ipc/channels.ts).
import {
  type EventName,
  type EventPayload,
  type InvokeInput,
  type InvokeName,
  type InvokeOutput,
  type IpcResult,
  type WorfyBridge,
} from '../shared/ipc/channels'

/** A channel whose input accepts `undefined` may be invoked without one. */
type InputArgs<K extends InvokeName> = undefined extends InvokeInput<K> ? [input?: InvokeInput<K>] : [input: InvokeInput<K>]

export interface IpcClient {
  /** Resolves to {ok:false} instead of rejecting, including when the bridge itself fails. */
  invoke<K extends InvokeName>(channel: K, ...args: InputArgs<K>): Promise<IpcResult<InvokeOutput<K>>>
  /** Returns the function that unsubscribes. */
  subscribe<K extends EventName>(channel: K, handler: (payload: EventPayload<K>) => void): () => void
}

/** Builds a client over a bridge; the bridge is looked up on each call, so tests can pass a fake. */
export function createIpcClient(bridge: () => WorfyBridge): IpcClient {
  return {
    async invoke(channel, ...args) {
      try {
        return (await bridge().invoke(channel, args[0])) as IpcResult<never>
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    subscribe(channel, handler) {
      const target = bridge()
      const id = target.on(channel, (payload) => handler(payload as never))
      return () => target.off(id)
    },
  }
}

function windowBridge(): WorfyBridge {
  const bridge = (globalThis as { worfy?: WorfyBridge }).worfy
  if (!bridge) throw new Error('window.worfy is missing: the preload did not run')
  return bridge
}

export const { invoke, subscribe } = createIpcClient(windowBridge)
