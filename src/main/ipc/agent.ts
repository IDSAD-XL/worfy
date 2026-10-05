// Handlers of the `agent` domain (src/shared/ipc/agent.ts). Events of a Session go to the window
// that started it. WORFY_AGENT=fake swaps Claude Code for the fake agent (fake-query.ts), which
// plays test/fixtures/agent-scripts/<WORFY_AGENT_SCRIPT or "turn">.jsonl.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { agentEnv } from '../agent/env'
import { fakeQueryFactory } from '../agent/fake-query'
import { sessionOptions } from '../agent/options'
import { SessionRegistry, type EventSink, type QueryFactory, type QueryHandle } from '../agent/session'
import { agentClose, agentEvent, agentInterrupt, agentList, agentSend, agentStart } from '../../shared/ipc/agent'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

/** Claude Code through the Agent SDK, with the user's login shell environment. */
export function sdkQueryFactory(): QueryFactory {
  return async (request) => {
    const [{ query }, environment] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), agentEnv()])
    const options = sessionOptions({
      cwd: request.cwd,
      env: environment.env,
      runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
      resume: request.resume,
      stderr: request.stderr,
    })
    return query({ prompt: request.prompt, options }) as QueryHandle
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

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`${path} is not a directory`)
}

/** The handlers over a registry; tests pass their own registry with the fake agent. */
export function agentHandlers(registry: () => SessionRegistry): HandlerModule {
  return [
    defineHandler(agentStart, async ({ cwd, resume }, { event }) => {
      await assertDirectory(cwd)
      const session = registry().start(cwd, resume, windowSink(event.sender))
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

/** The app's registry, made on first use; its Sessions close when the app quits. */
function sharedRegistry(): SessionRegistry {
  if (appRegistry === null) {
    const registry = new SessionRegistry(queryFactoryFromEnv())
    app.on('will-quit', () => registry.closeAll())
    appRegistry = registry
  }
  return appRegistry
}

export default agentHandlers(sharedRegistry) satisfies HandlerModule
