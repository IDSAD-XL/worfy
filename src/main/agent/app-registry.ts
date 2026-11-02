// The app's Session registry. Its Sessions are the Claude driver's (src/main/vendors/claude/session.ts),
// which start Claude Code — or the fake agent under WORFY_AGENT=fake — through
// src/main/vendors/claude/query.ts.
//
// The driver never imports this module (test/contract/vendor-imports.test.ts): what the fake agent
// needs from the registry — whether a Session runs unattended — is wired here, where the registry
// is made.
import { app } from 'electron'
import { exposeBrowserToolsToFakeAgent } from '../mcp/browser-server'
import { vendorDriver } from '../vendors/registry'
import { SessionRegistry } from './session'

/** Whether the Session `sessionId` of `registry` runs unattended now, as its launch says; false for a Session it does not hold. */
export function unattendedIn(registry: Pick<SessionRegistry, 'get'>, sessionId: string): boolean {
  try {
    return registry.get(sessionId).unattended
  } catch {
    return false
  }
}

/**
 * Under WORFY_AGENT=fake, the Browser tools a Session would call, in main for an e2e run to call
 * (test/e2e/browser-mcp.spec.ts): the fake agent calls no MCP tool. A Session of `registry` that
 * runs unattended gets them in Autopilot mode, as a real Session's server would be made.
 */
export function exposeBrowserToolsForFakeAgent(
  registry: Pick<SessionRegistry, 'get'>,
  env: NodeJS.ProcessEnv = process.env,
  expose: (unattended: (sessionId: string) => boolean) => void = exposeBrowserToolsToFakeAgent,
): void {
  if (env.WORFY_AGENT === 'fake') expose((sessionId) => unattendedIn(registry, sessionId))
}

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
    exposeBrowserToolsForFakeAgent(registry)
    appRegistry = registry
  }
  return appRegistry
}
