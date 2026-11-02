// The session part of the Claude driver: Claude Code through the Agent SDK, or the fake agent under
// WORFY_AGENT=fake, as src/main/agent/app-registry.ts starts it today.
//
// app-registry.ts imports this driver back (sharedRegistry): nothing here may touch an import while
// the module loads, only when it is called.
import { queryFactoryFromEnv } from '../../agent/app-registry'
import type { SessionPart } from '../session'

export const claudeSession: SessionPart = {
  queryFactory: (env) => queryFactoryFromEnv(env),
}
