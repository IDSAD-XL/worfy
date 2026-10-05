// The app's Session registry and how its Sessions start Claude Code. WORFY_AGENT=fake swaps
// Claude Code for the fake agent (fake-query.ts), which plays
// test/fixtures/agent-scripts/<WORFY_AGENT_SCRIPT or "turn">.jsonl. With WORFY_AGENT_LOG set, the
// fake agent also appends what it was asked to do (FakeCall, one JSON line each) to that file, so
// e2e runs can see the control calls.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { agentEnv } from './env'
import { fakeQueryFactory } from './fake-query'
import { appLimits } from './limits'
import { sessionOptions } from './options'
import { canvasForSession, type CanvasResolver, type CanvasSession } from '../mcp/canvas-server'
import { SessionRegistry, type QueryFactory, type QueryHandle, type QueryRequest } from './session'

/** The canvas of a Session (ticket 24); a failure leaves the Session without canvas tools rather than without a Session. */
async function canvasOrNull(canvas: CanvasResolver, request: QueryRequest): Promise<CanvasSession | null> {
  try {
    return await canvas({ cwd: request.cwd, resume: request.resume })
  } catch (error) {
    console.warn(`[agent] no canvas tools for ${request.cwd}`, error)
    return null
  }
}

/** Claude Code through the Agent SDK, with the user's login shell environment and the Project's canvas. */
export function sdkQueryFactory(canvas: CanvasResolver = canvasForSession): QueryFactory {
  return async (request) => {
    const [{ query }, environment, attached] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), agentEnv(), canvasOrNull(canvas, request)])
    const options = sessionOptions({
      cwd: request.cwd,
      env: environment.env,
      runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
      resume: request.resume,
      stderr: request.stderr,
      canvas: attached?.attachment,
      settings: request.settings,
    })
    const handle = query({ prompt: request.prompt, options }) as QueryHandle
    return attached ? attached.observe(handle) : handle
  }
}

export function queryFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): QueryFactory {
  if (env.WORFY_AGENT !== 'fake') return sdkQueryFactory()
  const log = env.WORFY_AGENT_LOG
  return fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_AGENT_SCRIPT ?? 'turn',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify(call)}\n`) : undefined,
  })
}

let appRegistry: SessionRegistry | null = null

/**
 * The app's registry, made on first use; its Sessions close when the app quits. The Sessions of
 * `agent.start` (src/main/ipc/agent.ts) and the Orchestrators (app-orchestrators.ts) run in it,
 * so `agent.*` reaches every one of them.
 */
export function sharedRegistry(): SessionRegistry {
  if (appRegistry === null) {
    // Every Session's rate_limit_event feeds the Limits (ticket 22), the fake agent's too.
    const registry = new SessionRegistry(appLimits().observe(queryFactoryFromEnv()))
    app.on('will-quit', () => registry.closeAll())
    appRegistry = registry
  }
  return appRegistry
}
