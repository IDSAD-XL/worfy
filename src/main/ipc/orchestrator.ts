// Handlers of the `orchestrator` domain (src/shared/ipc/orchestrator.ts). The Orchestrators
// themselves, and main's own opening of them, live in src/main/agent/app-orchestrators.ts.
import { orchestratorOpen, orchestratorView } from '../../shared/ipc/orchestrator'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import type { Orchestrators } from '../agent/orchestrator'
import { defineHandler, type HandlerModule } from './index'

/** The handlers over a set of Orchestrators; tests pass their own. */
export function orchestratorHandlers(orchestrators: () => Pick<Orchestrators, 'open' | 'view'>): HandlerModule {
  return [
    defineHandler(orchestratorOpen, ({ projectId }) => orchestrators().open(projectId)),
    defineHandler(orchestratorView, ({ nodeId }) => ({ view: orchestrators().view(nodeId) })),
  ]
}

export default orchestratorHandlers(sharedOrchestrators) satisfies HandlerModule
