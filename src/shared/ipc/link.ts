// The `link` domain (worfy-link ticket 01; ADR-0052): this Machine as the link knows it. The one
// channel open to Linked machines so far (src/main/link/ipc-adapter.ts, LINK_OPEN_CHANNELS); a
// window may call it too.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** This Machine: its id and name, the link protocol it speaks and its build version. */
export const linkMachineSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  protocol: z.number().int().positive(),
  build: z.string().min(1),
})

export const linkPing = invokeChannel('link.ping', z.void(), linkMachineSchema)

declare module './channels' {
  interface IpcContract {
    'link.ping': typeof linkPing
  }
}
