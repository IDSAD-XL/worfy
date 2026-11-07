// The handler of `autopilot.confirm.answer` (src/shared/ipc/autopilot-confirm.ts, worfy-autopilot-queue
// ticket 11): the answer of the Start Autopilot window to an agent's `autopilot_start`. The asks are
// WindowAsks of src/main/autopilot/chat-confirm.ts; an answer counts only from the window that was
// asked (its webContents id), and the channel is `local`, so a Linked machine never answers one.
//
// Under WORFY_AGENT=fake the tool is also reachable from main for an e2e run
// (`globalThis.worfyCanvasTool`, as `globalThis.worfyBrowserTool` of src/main/mcp/browser-server.ts):
// the fake agent calls no MCP tool itself.
import { join } from 'node:path'
import type { CanvasToolName } from '../../shared/canvas/tools'
import { autopilotConfirmAnswer } from '../../shared/ipc/autopilot-confirm'
import { sharedWindowAsks, type WindowAsks } from '../autopilot/chat-confirm'
import type { ToolResult } from '../mcp/canvas-server'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

/** The tool `autopilot_start` of Session `sessionId` in Project `projectId`, answered as the canvas server answers it. */
export type FakeAgentCanvasTool = (projectId: string, sessionId: string, name: Extract<CanvasToolName, 'autopilot_start'>, args: unknown) => Promise<ToolResult>

/**
 * Under WORFY_AGENT=fake, `autopilot_start` as a Session's canvas server answers it, with the app's
 * starter, for an e2e run to call (test/e2e/autopilot-start-modal.spec.ts). Nothing without it.
 */
export function exposeCanvasToolToFakeAgent(env: NodeJS.ProcessEnv = process.env): void {
  if (env.WORFY_AGENT !== 'fake') return
  const tool: FakeAgentCanvasTool = async (projectId, sessionId, name, args) => {
    // Loaded at the call: the canvas server loads the Autopilot modules, which load this domain's peers.
    const { appDeps, canvasToolCaller } = await import('../mcp/canvas-server')
    const deps = appDeps()
    const caller = canvasToolCaller({
      projectId,
      cardsDir: join(deps.dataDir(projectId), 'cards'),
      layout: deps.layout,
      workflow: () => deps.workflow(projectStore().get(projectId).path),
      sessionId: () => sessionId,
      ...(deps.autopilotStart === undefined ? {} : { autopilotStart: deps.autopilotStart }),
    })
    return caller(name, args)
  }
  ;(globalThis as { worfyCanvasTool?: FakeAgentCanvasTool }).worfyCanvasTool = tool
}

/** The handler over `asks`; tests pass their own. */
export function autopilotConfirmHandlers(asks: () => WindowAsks = sharedWindowAsks): HandlerModule {
  return [defineHandler(autopilotConfirmAnswer, ({ id, answer, epics }, { event }) => asks().answer(id, answer, event.sender.id, epics))]
}

exposeCanvasToolToFakeAgent()

export default autopilotConfirmHandlers() satisfies HandlerModule
