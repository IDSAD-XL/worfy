// The only bridge between the renderer and the main process. It forwards calls and events by
// channel name and does not know the channel list: channels are added in src/shared/ipc/ and
// src/main/ipc/, never here (ADR-0006). The prefix keeps the renderer off any other IPC channel.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNEL_PREFIX, type IpcResult, type WorfyBridge } from '../shared/ipc/channels'

const subscriptions = new Map<number, { channel: string; listener: (event: IpcRendererEvent, payload: unknown) => void }>()
let nextSubscription = 1

const bridge: WorfyBridge = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_CHANNEL_PREFIX + channel, input) as Promise<IpcResult<unknown>>,
  on: (channel, handler) => {
    const prefixed = IPC_CHANNEL_PREFIX + channel
    // The Electron event stays here: it would hand the renderer a handle on ipcRenderer.
    const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on(prefixed, listener)
    const id = nextSubscription++
    subscriptions.set(id, { channel: prefixed, listener })
    return id
  },
  off: (id) => {
    const subscription = subscriptions.get(id)
    if (!subscription) return
    ipcRenderer.removeListener(subscription.channel, subscription.listener)
    subscriptions.delete(id)
  },
}

contextBridge.exposeInMainWorld('worfy', bridge)
