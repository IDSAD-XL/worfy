// The `bindings` domain (ticket 16): the manual Bindings of a Project's agents, which main keeps in
// `<Project data folder>/bindings.json` (ADR 0005; src/main/layout/bindings.ts), and the signals of
// a Session's transcript and of its Subagents' transcripts that the renderer resolves Bindings
// from (src/shared/binding/resolve.ts). worfy only reads transcripts (ADR 0002); a manual Binding
// is worfy's own state and is never written into the Project's repository or ~/.claude.
// Handled in src/main/ipc/bindings.ts (ADR 0006).
import { z } from 'zod'
import { agentSignalsSchema, bindingTargetSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'
import { agentIdSchema, sessionIdSchema } from './claude-home'

const projectId = z.string().min(1)

/** An absolute POSIX path; the main process resolves it again before use. */
const absolutePath = z
  .string()
  .min(1)
  .refine((path) => path.startsWith('/') && !path.includes('\0'), 'must be an absolute path')

/** The agent a manual Binding is for: a Session (`agentId` null) or one of its Subagents. */
export const bindingAgentSchema = z.object({ sessionId: sessionIdSchema, agentId: agentIdSchema.nullable() })
export type BindingAgent = z.infer<typeof bindingAgentSchema>

/**
 * One stored Binding: the agent and what the user dropped it on — or, with `source: 'launch'`, what
 * worfy started it for ("Ship ticket", "Run wave"; ticket 23). Without `source` it is manual, as
 * every Binding of ticket 16 was stored. An agent has at most one of each; the manual one wins.
 */
export const manualBindingSchema = bindingAgentSchema.extend({ target: bindingTargetSchema, source: z.literal('launch').optional() })
export type ManualBinding = z.infer<typeof manualBindingSchema>

/** A stored Binding that worfy wrote when it launched the agent, not the user. */
export const isLaunchBinding = (binding: Pick<ManualBinding, 'source'>): boolean => binding.source === 'launch'

/** A Project's stored Bindings: one manual and one launch Binding per agent at most. */
export const manualBindingsSchema = z.object({ projectId, bindings: z.array(manualBindingSchema) })
export type ManualBindings = z.infer<typeof manualBindingsSchema>

/** `<sessionId>` for a Session, `<sessionId>/<agentId>` for a Subagent: one key per agent. */
export const agentKey = (sessionId: string, agentId: string | null | undefined): string => (agentId ? `${sessionId}/${agentId}` : sessionId)

/**
 * The Project's manual Bindings. The call also subscribes the calling window to `bindings.changed`
 * until the window is gone, so every later change reaches it, whoever made it.
 */
export const bindingsGet = invokeChannel('bindings.get', z.object({ projectId }), manualBindingsSchema)

/** Binds an agent by hand, replacing its manual Binding if it had one; answers with all of them. */
export const bindingsSet = invokeChannel('bindings.set', bindingAgentSchema.extend({ projectId, target: bindingTargetSchema }), manualBindingsSchema)

/** Removes an agent's manual Binding ("Remove binding"): its automatic Binding applies again. */
export const bindingsRemove = invokeChannel('bindings.remove', bindingAgentSchema.extend({ projectId }), manualBindingsSchema)

/** Sent to every subscribed window after a manual Binding of a Project changed. */
export const bindingsChanged = eventChannel('bindings.changed', manualBindingsSchema)

/**
 * What a Session's transcript and its Subagents' transcripts (`<sessionId>/subagents/agent-*.jsonl`)
 * say that can bind them. Read incrementally in main: asking again costs only the new lines.
 * `found` is false when the Session has no transcript (yet).
 */
export const bindingsSignals = invokeChannel(
  'bindings.signals',
  z.object({ projectRoot: absolutePath, sessionId: sessionIdSchema }),
  z.object({
    found: z.boolean(),
    session: agentSignalsSchema,
    subagents: z.array(z.object({ agentId: agentIdSchema, signals: agentSignalsSchema })),
  }),
)
export type SessionBindingSignals = z.infer<typeof bindingsSignals.output>

declare module './channels' {
  interface IpcContract {
    'bindings.get': typeof bindingsGet
    'bindings.set': typeof bindingsSet
    'bindings.remove': typeof bindingsRemove
    'bindings.changed': typeof bindingsChanged
    'bindings.signals': typeof bindingsSignals
  }
}
