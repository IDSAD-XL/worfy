// The session part of a Vendor driver (ADR-0094 item 2): how worfy starts and drives the Vendor's
// agent for a Session.
import type { Attachment } from '../../shared/agent/attachments'
import type { AgentEvent } from '../../shared/agent/events'
import type { QueryFactory } from '../agent/session/types'

/** A message of the user, in worfy's types rather than the Vendor's. */
export interface SessionMessage {
  text: string
  attachments: readonly Attachment[]
}

/**
 * A live Session of a Vendor's agent, in worfy's types only: the Vendor's own messages never come
 * out of it.
 */
export interface SessionHandle {
  /** Sends a message: queued while a turn runs, or into the turn when the Vendor can steer. */
  send(message: SessionMessage): Promise<void>
  interrupt(): Promise<void>
  close(): void
  /** null: the Vendor's default model. */
  setModel(model: string | null): Promise<void>
  /** A level of the Vendor's `effortLevels`; null: the model's default. */
  setEffort(effort: string | null): Promise<void>
  /** The id of one of the Vendor's `permissionPresets`. */
  setPermissionPreset(id: string): Promise<void>
  events: AsyncIterable<AgentEvent>
}

export interface SessionPart {
  /**
   * What starts the agent of a Session in the given environment (`process.env` by default).
   * shortcut: the factory still speaks Claude Code's Query (src/main/agent/session/types.ts), not
   * SessionHandle; ticket 14 of worfy-multi-vendor replaces it with start(opts) and resume(id).
   */
  queryFactory(env?: NodeJS.ProcessEnv): QueryFactory
}
