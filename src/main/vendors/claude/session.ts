// The session part of the Claude driver: Claude Code through the Agent SDK, or the fake agent under
// WORFY_AGENT=fake, as src/main/agent/app-registry.ts starts it today.
//
// app-registry.ts imports this driver back (sharedRegistry): nothing here may touch an import while
// the module loads, only when it is called.
import { queryFactoryFromEnv } from '../../agent/app-registry'
import type { CommandCatalog } from '../../agent/commands'
import type { QueryHandle } from '../../agent/session/types'
import type { SessionHandle, SessionPart } from '../session'

/**
 * What the SessionHandle of the Claude driver holds of Claude Code, for the other parts of this
 * driver (commands, capabilities): its live query and the catalog of its slash commands. The
 * handle itself comes with worfy-multi-vendor ticket 14.
 */
export interface ClaudeLiveSession {
  /** The live query; null between queries. */
  readonly query: QueryHandle | null
  /** The commands of system/init and system/commands_changed (src/main/agent/commands.ts). */
  readonly catalog: CommandCatalog
}

/** What the Claude driver holds of the Session `session`; null for a handle that is not its own. */
export function claudeLive(session: SessionHandle): ClaudeLiveSession | null {
  const live = session as SessionHandle & Partial<ClaudeLiveSession>
  return live.catalog !== undefined && live.query !== undefined ? { query: live.query, catalog: live.catalog } : null
}

export const claudeSession: SessionPart = {
  queryFactory: (env) => queryFactoryFromEnv(env),
}
