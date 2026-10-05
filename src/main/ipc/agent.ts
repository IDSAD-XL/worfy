// Handlers of the `agent` domain (src/shared/ipc/agent.ts). Events of a Session go to the window
// that started it, and the Session closes when that window is destroyed: on macOS the app outlives
// its windows, and a Session nobody can see would keep Claude Code running. WORFY_AGENT=fake swaps Claude Code for the fake agent (fake-query.ts), which
// plays test/fixtures/agent-scripts/<WORFY_AGENT_SCRIPT or "turn">.jsonl.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { agentEnv } from '../agent/env'
import { fakeQueryFactory } from '../agent/fake-query'
import { sessionOptions } from '../agent/options'
import { SessionRegistry, type EventSink, type QueryFactory, type QueryHandle, type QueryRequest, type Session } from '../agent/session'
import { canvasForSession, type CanvasResolver, type CanvasSession } from '../mcp/canvas-server'
import { agentClose, agentEvent, agentInterrupt, agentList, agentSend, agentStart } from '../../shared/ipc/agent'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

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
    })
    const handle = query({ prompt: request.prompt, options }) as QueryHandle
    return attached ? attached.observe(handle) : handle
  }
}

export function queryFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): QueryFactory {
  if (env.WORFY_AGENT !== 'fake') return sdkQueryFactory()
  return fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_AGENT_SCRIPT ?? 'turn',
  })
}

/** Sends a Session's events to a window, as long as the window is alive. */
export function windowSink(target: EventTarget & Partial<Pick<WebContents, 'isDestroyed'>>): EventSink {
  return (sessionId, event) => {
    if (target.isDestroyed?.() === true) return
    emit(target, agentEvent, { sessionId, event })
  }
}

/** A window's webContents as far as Session ownership needs it. */
export interface SessionOwner {
  once(event: 'destroyed', listener: () => void): unknown
}

/** Closes each window's Sessions when the window is destroyed; one listener per window. */
function ownership(): (owner: SessionOwner, session: Session) => void {
  const owned = new WeakMap<SessionOwner, Set<Session>>()
  return (owner, session) => {
    let sessions = owned.get(owner)
    if (sessions === undefined) {
      const forOwner = new Set<Session>()
      owned.set(owner, forOwner)
      owner.once('destroyed', () => {
        owned.delete(owner)
        for (const each of forOwner) {
          try {
            each.close()
          } catch (error) {
            // One Session failing to report its close must not keep the others running.
            console.warn(`[agent] closing ${each.id} with its window failed`, error)
          }
        }
      })
      sessions = forOwner
    }
    // Sessions closed by agent.close are dropped here rather than kept until the window goes.
    for (const each of sessions) if (each.state === 'closed') sessions.delete(each)
    sessions.add(session)
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`${path} is not a directory`)
}

/** The handlers over a registry; tests pass their own registry with the fake agent. */
export function agentHandlers(registry: () => SessionRegistry): HandlerModule {
  const own = ownership()
  return [
    defineHandler(agentStart, async ({ cwd, resume }, { event }) => {
      await assertDirectory(cwd)
      const session = registry().start(cwd, resume, windowSink(event.sender))
      own(event.sender, session)
      return { sessionId: session.id }
    }),
    defineHandler(agentSend, ({ sessionId, text }) => {
      registry().get(sessionId).send(text)
    }),
    defineHandler(agentInterrupt, async ({ sessionId }) => ({ interrupted: await registry().get(sessionId).interrupt() })),
    defineHandler(agentClose, ({ sessionId }) => {
      registry().get(sessionId).close()
    }),
    defineHandler(agentList, () => registry().list()),
  ]
}

let appRegistry: SessionRegistry | null = null

/**
 * The app's registry, made on first use; its Sessions close when the app quits. The Orchestrators
 * (src/main/ipc/orchestrator.ts) run in it too, so `agent.*` reaches them like any Session.
 */
export function sharedRegistry(): SessionRegistry {
  if (appRegistry === null) {
    const registry = new SessionRegistry(queryFactoryFromEnv())
    app.on('will-quit', () => registry.closeAll())
    appRegistry = registry
  }
  return appRegistry
}

export default agentHandlers(sharedRegistry) satisfies HandlerModule
