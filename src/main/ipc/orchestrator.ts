// Handlers of the `orchestrator` domain (src/shared/ipc/orchestrator.ts). The Orchestrators
// themselves, and main's own opening of them, live in src/main/agent/app-orchestrators.ts.
import { orchestratorNewConversation, orchestratorOpen, orchestratorView } from '../../shared/ipc/orchestrator'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import type { Orchestrators } from '../agent/orchestrator'
import { defineHandler, type HandlerModule } from './index'

/** The handlers over a set of Orchestrators; tests pass their own. */
export function orchestratorHandlers(orchestrators: () => Pick<Orchestrators, 'open' | 'view' | 'newConversation'>): HandlerModule {
  return [
    defineHandler(orchestratorOpen, ({ projectId }) => orchestrators().open(projectId)),
    defineHandler(orchestratorView, ({ nodeId }) => ({ view: orchestrators().view(nodeId) })),
    defineHandler(orchestratorNewConversation, ({ projectId }) => orchestrators().newConversation(projectId)),
  ]
}

export default orchestratorHandlers(sharedOrchestrators) satisfies HandlerModule
