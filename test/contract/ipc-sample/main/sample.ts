// A sample handler module, written exactly as a ticket would write src/main/ipc/<domain>.ts.
// src/main/ipc/index.ts discovers modules like this one; it is not edited to add them.
import { defineHandler, type HandlerModule } from '../../../../src/main/ipc/index'
import { sampleEcho, sampleFail, sampleLeak } from '../shared/sample'

export default [
  defineHandler(sampleEcho, ({ text }) => ({ echoed: text })),
  // Deliberately returns data outside the output schema when the test asks it to.
  defineHandler(sampleLeak, ({ reply }) => reply as { count: number }),
  defineHandler(sampleFail, () => {
    throw new Error('the sample handler broke')
  }),
] satisfies HandlerModule
