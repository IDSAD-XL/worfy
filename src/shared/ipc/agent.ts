// The `agent` domain: Sessions of Claude Code run by main (src/main/agent/session.ts).
//
// A Session is started with `agent.start` and gets a temporary id; once Claude Code reports its
// own session id (system/init), events carry that id and a `renamed` event names the old one.
// Both ids are accepted by the other channels. Every event of every Session arrives on
// `agent.event`, tagged with its Session's id.
import { z } from 'zod'
import { agentEventEnvelope, sessionState } from '../agent/events'
import { eventChannel, invokeChannel } from './channels'

const sessionId = z.string().min(1)

export const agentStart = invokeChannel(
  'agent.start',
  z.object({
    /** Root of the Project: an absolute path to an existing directory. */
    cwd: z.string().startsWith('/', 'cwd must be an absolute path'),
    /** SDK session id to continue. */
    resume: sessionId.optional(),
  }),
  z.object({ sessionId }),
)

export const agentSend = invokeChannel('agent.send', z.object({ sessionId, text: z.string().min(1) }), z.void())

export const agentInterrupt = invokeChannel('agent.interrupt', z.object({ sessionId }), z.object({ interrupted: z.boolean() }))

export const agentClose = invokeChannel('agent.close', z.object({ sessionId }), z.void())

export const agentList = invokeChannel('agent.list', z.void(), z.array(z.object({ sessionId, cwd: z.string(), state: sessionState })))

export const agentEvent = eventChannel('agent.event', agentEventEnvelope)

declare module './channels' {
  interface IpcContract {
    'agent.start': typeof agentStart
    'agent.send': typeof agentSend
    'agent.interrupt': typeof agentInterrupt
    'agent.close': typeof agentClose
    'agent.list': typeof agentList
    'agent.event': typeof agentEvent
  }
}
