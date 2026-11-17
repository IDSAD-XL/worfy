// The app's Session registry. Each Session runs on its Vendor's driver (worfy-multi-vendor ticket 23):
// Claude Code's (src/main/vendors/claude/session.ts, the fake agent under WORFY_AGENT=fake) or
// Codex's (src/main/vendors/codex/session.ts, the fake app-server under WORFY_CODEX=fake). The
// Orchestrator's Sessions run on the Project's defaultVendor (app-orchestrators.ts, ticket 37).
//
// The driver never imports this module (test/contract/vendor-imports.test.ts): what the fake agent
// needs from the registry — whether a Session runs unattended — is wired here, where the registry
// is made.
import { app } from 'electron'
import { exposeBrowserToolsToFakeAgent } from '../mcp/browser-server'
import { vendorDriver } from '../vendors/registry'
import { SessionRegistry } from './session'
import { QUIET_LOOK_MS, type QuietWatch } from './session/quiet-signs'

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

/**
 * The e2e tests' seam (worfy-stuck-agents ticket 06): with WORFY_QUIET_MARK_MS a whole number of ms above zero, in a
 * build that is not packaged, a turn is marked quiet after that long without a sign of life, looked at as often —
 * seconds, not the 10 minutes of QUIET_MARK_MS. The app's own watch without it.
 */
export function quietMarkSeam(env: NodeJS.ProcessEnv, packaged: boolean): Partial<QuietWatch> {
  const given = env.WORFY_QUIET_MARK_MS
  if (packaged || given === undefined || !/^[1-9]\d*$/u.test(given)) return {}
  const markMs = Number(given)
  return { markMs, lookMs: Math.min(markMs, QUIET_LOOK_MS) }
}

let appRegistry: SessionRegistry | null = null

/**
 * The app's registry, made on first use; its Sessions close when the app quits. The Sessions of
 * `agent.start` (src/main/ipc/agent.ts) and the Orchestrators (app-orchestrators.ts) run in it,
 * so `agent.*` reaches every one of them.
 */
export function sharedRegistry(): SessionRegistry {
  if (appRegistry === null) {
    // Each Session on the session part of its Vendor's driver, made when the first Session of that
    // Vendor starts; the driver's capabilities and commands answer its pickers and slash menu. Claude's: queryFactoryFromEnv, with every Session's rate_limit_event feeding the
    // Limits (ticket 22), the fake agent's too.
    const registry = new SessionRegistry(
      { sessionsOf: (vendor) => vendorDriver(vendor).session, partsOf: (vendor) => vendorDriver(vendor) },
      undefined,
      undefined,
      quietMarkSeam(process.env, app.isPackaged),
    )
    app.on('will-quit', () => registry.closeAll())
    exposeBrowserToolsForFakeAgent(registry)
    appRegistry = registry
  }
  return appRegistry
}
