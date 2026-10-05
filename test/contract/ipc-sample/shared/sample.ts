// A sample channel domain, written exactly as a ticket would write src/shared/ipc/<domain>.ts.
// It extends the contract by declaration merging; channels.ts itself is not edited.
import { z } from 'zod'
import { eventChannel, invokeChannel } from '../../../../src/shared/ipc/channels'

export const sampleEcho = invokeChannel('sample.echo', z.object({ text: z.string() }), z.object({ echoed: z.string() }))

// Returns whatever the test put in `reply`, so a test can make the handler break its own contract.
export const sampleLeak = invokeChannel('sample.leak', z.object({ reply: z.unknown() }), z.object({ count: z.number() }))

export const sampleFail = invokeChannel('sample.fail', z.void(), z.void())

export const sampleTicked = eventChannel('sample.ticked', z.object({ n: z.number().int() }))

declare module '../../../../src/shared/ipc/channels' {
  interface IpcContract {
    'sample.echo': typeof sampleEcho
    'sample.leak': typeof sampleLeak
    'sample.fail': typeof sampleFail
    'sample.ticked': typeof sampleTicked
  }
}
