// A sample handler module, written exactly as a ticket would write src/main/ipc/<domain>.ts.
// src/main/ipc/index.ts discovers modules like this one; it is not edited to add them.
import { defineHandler, type HandlerModule } from '../../../../src/main/ipc/index'
import { sampleEcho, sampleFail, sampleLeak } from '../shared/sample'

/**
 * Every text sample.echo ran with. It stands in for a handler's side effect (a file written, an
 * agent started), so a test can tell whether the handler ran, not only what the caller got back.
 */
export const echoCalls: string[] = []

export default [
  defineHandler(sampleEcho, ({ text }) => {
    echoCalls.push(text)
    return { echoed: text }
  }),
  // Deliberately returns data outside the output schema when the test asks it to.
  defineHandler(sampleLeak, ({ reply }) => reply as { count: number }),
  defineHandler(sampleFail, () => {
    throw new Error('the sample handler broke')
  }),
] satisfies HandlerModule
