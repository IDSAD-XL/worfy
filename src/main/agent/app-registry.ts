// The app's Session registry and how its Sessions start Claude Code. WORFY_AGENT=fake swaps
// Claude Code for the fake agent (fake-query.ts), which plays
// test/fixtures/agent-scripts/<WORFY_AGENT_SCRIPT or "turn">.jsonl. With WORFY_AGENT_LOG set, the
// fake agent also appends what it was asked to do (FakeCall, one JSON line each) to that file, so
// e2e runs can see the control calls.
//
// The autocompact window (worfy-polish ticket 24) is read from the app settings of this Machine
// each time a Session starts Claude Code — the Orchestrator's for a Project's Orchestrator, the
// other one for any other Session — so a change reaches the next start, never a running process.
// A window the person never chose gives way to `autoCompactWindow` of the user's settings.json,
// read at the same moment (worfy-polish ticket 29, autoCompactWindowSource).
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { agentEnv, type Env } from './env'
import { fakeQueryFactory } from './fake-query'
import { appLimits } from './limits'
import { sessionHarnessPlugin, sessionOptions } from './options'
import { currentHarness } from '../harness/locate'
import { canvasForSession, type CanvasResolver, type CanvasSession } from '../mcp/canvas-server'
import { readUserAutoCompactWindow } from '../claude-home/user-model'
import { appSettingsStore } from '../settings/store'
import { claudeHome } from '../storage/paths'
import { autoCompactWindowFor } from '../../shared/settings/app-settings'
import { readMcpAllowlist } from '../workflow/profile'
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

/**
 * The MCP servers a Session in the Project at `cwd` may use (ADR-0021); never rejects. `env` is
 * the login shell environment the Session itself gets.
 */
export type McpAllowlistResolver = (cwd: string, env: Env) => Promise<readonly string[]>

/**
 * The list from the Profile of the Project the Session runs in, or the default list (profile.ts).
 * `bin/profile` runs with the login shell environment: from Finder worfy's own PATH has no node.
 */
const profileAllowlist: McpAllowlistResolver = async (cwd, env) => (await readMcpAllowlist({ root: cwd, claudeHome: claudeHome(), env })).servers

/**
 * The autocompact window a Session starts with, by whether it is a Project's Orchestrator; null
 * passes none. Never throws.
 */
export type AutoCompactWindowReader = (orchestrator: boolean) => number | null

/**
 * The window from the app settings of this Machine (src/main/settings/store.ts) and, for a window
 * not chosen there, from the user's <claudeHome>/settings.json.
 */
const appAutoCompactWindow: AutoCompactWindowReader = (orchestrator) => {
  try {
    return autoCompactWindowFor(appSettingsStore().get(), orchestrator, readUserAutoCompactWindow())
  } catch (error) {
    // The store answers the defaults for a file it cannot read; this is past that. The Session
    // still starts, with Claude Code's own window.
    console.warn('[agent] could not read the autocompact window, the Session starts with Claude Code\'s own', error)
    return null
  }
}

/** The part of the Agent SDK a Session start uses: query(), which starts the Claude Code process. */
export interface AgentSdk {
  query(params: { prompt: QueryRequest['prompt']; options: Options }): unknown
}

/** The Agent SDK itself, imported on the first Session start (Node keeps the module after that). */
const importSdk = (): Promise<AgentSdk> => import('@anthropic-ai/claude-agent-sdk')

export interface SdkQueryFactoryOptions {
  /** The autocompact window of a Session's role; the app settings of this Machine by default. */
  autoCompactWindow?: AutoCompactWindowReader
  /**
   * Where query() comes from; the Agent SDK by default. A test passes its own, so the SDK module is
   * never imported there and no Claude Code process can start.
   */
  loadSdk?: () => Promise<AgentSdk>
}

/**
 * Claude Code through the Agent SDK, with the user's login shell environment and the Project's
 * canvas. A Session in a Project (one the canvas attaches to) gets only the MCP servers its Profile
 * lists; a Session outside every Project, or whose canvas failed, keeps the user's servers as they are.
 * Every Session gets the Harness copy of this build inline unless the old Harness is on the machine
 * (sessionHarnessPlugin, ADR-0049), and the autocompact window of its role (`autoCompactWindow`),
 * read when the options are built — after the environment and the canvas are in, so a change made
 * while they load still reaches this start. worfy starts the Claude Code process itself, as the SDK
 * would, and tells the Session of it (watchedSpawn, ADR-0064).
 */
export function sdkQueryFactory(
  canvas: CanvasResolver = canvasForSession,
  mcpAllowlist: McpAllowlistResolver = profileAllowlist,
  { autoCompactWindow = appAutoCompactWindow, loadSdk = importSdk }: SdkQueryFactoryOptions = {},
): QueryFactory {
  return async (request) => {
    const [{ query }, environment, attached] = await Promise.all([loadSdk(), agentEnv(), canvasOrNull(canvas, request)])
    const allowlist = attached ? await mcpAllowlist(request.cwd, environment.env) : null
    const options = sessionOptions({
      cwd: request.cwd,
      env: environment.env,
      runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
      resume: request.resume,
      sessionId: request.sessionId,
      stderr: request.stderr,
      spawned: request.spawned,
      canvas: attached?.attachment,
      settings: request.settings,
      canUseTool: request.canUseTool,
      unattended: request.unattended,
      mcpAllowlist: allowlist,
      // Looked for at every Session start: worfy's own Harness inline unless the old one is on the machine (ADR-0049).
      harnessPlugin: sessionHarnessPlugin(currentHarness().kind),
      autoCompactWindow: autoCompactWindow(request.orchestrator === true),
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
    // WORFY_AGENT_REGISTRY=1: each fake Claude Code writes its entry to <WORFY_CLAUDE_HOME>/sessions, as the real one does.
    registryHome: env.WORFY_AGENT_REGISTRY === '1' ? env.WORFY_CLAUDE_HOME : undefined,
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
