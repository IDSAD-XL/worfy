// The app's Session registry. Its Sessions are the Claude driver's (src/main/vendors/claude/session.ts),
// which start Claude Code — or the fake agent under WORFY_AGENT=fake — through
// src/main/vendors/claude/query.ts.
import { app } from 'electron'
import { vendorDriver } from '../vendors/registry'
import { SessionRegistry } from './session'

let appRegistry: SessionRegistry | null = null

/**
 * The app's registry, made on first use; its Sessions close when the app quits. The Sessions of
 * `agent.start` (src/main/ipc/agent.ts) and the Orchestrators (app-orchestrators.ts) run in it,
 * so `agent.*` reaches every one of them.
 */
export function sharedRegistry(): SessionRegistry {
  if (appRegistry === null) {
    // The Sessions are the Claude driver's (src/main/vendors/claude/session.ts): queryFactoryFromEnv,
    // with every Session's rate_limit_event feeding the Limits (ticket 22), the fake agent's too.
    const registry = new SessionRegistry(vendorDriver('claude').session)
    app.on('will-quit', () => registry.closeAll())
    appRegistry = registry
  }
  return appRegistry
}
