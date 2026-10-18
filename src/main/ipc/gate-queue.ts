// Handlers of the `gateQueue` domain (src/shared/ipc/gate-queue.ts), and the app's one reader of the
// cross-machine gate queue (src/main/github/gate-queue.ts): the palette and the Project menu ask it
// here, "Process gate queue" asks it for this Machine's role (src/main/ipc/actions.ts), and the
// notification of a PR that waits over an hour reads it for every Project in the list
// (src/main/notify.ts). One reader, so gh runs at most once per interval for all of them.
import { gateQueueGet } from '../../shared/ipc/gate-queue'
import { agentEnv } from '../agent/env'
import { GateQueueReader, gateQueueView } from '../github/gate-queue'
import { ghRunner } from '../github/prs'
import { harnessScriptEnv } from '../harness/script-env'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { profileRunner } from '../workflow/profile'
import { defineHandler, type HandlerModule } from './index'

/** The handlers over a reader and the Projects' roots; tests pass their own. */
export function gateQueueHandlers(reader: () => Pick<GateQueueReader, 'read'>, projectRoot: (projectId: string) => string): HandlerModule {
  return [defineHandler(gateQueueGet, async ({ projectId }) => gateQueueView(await reader().read(projectRoot(projectId))))]
}

let shared: GateQueueReader | undefined

/**
 * The app's reader. gh as the PR badges run it (src/main/ipc/checks.ts): WORFY_GH (a stub in tests)
 * with the app's own environment, else `gh` with the login shell's; `bin/profile` with the
 * environment of the Harness scripts (src/main/harness/script-env.ts).
 */
export function sharedGateQueue(): GateQueueReader {
  const stub = process.env.WORFY_GH
  shared ??= new GateQueueReader({
    claudeHome: claudeHome(),
    env: () => harnessScriptEnv(),
    profile: async (cwd, args) => profileRunner(claudeHome(), await harnessScriptEnv())(cwd, args),
    run: ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env }),
  })
  return shared
}

export default gateQueueHandlers(sharedGateQueue, (projectId) => projectStore().get(projectId).path) satisfies HandlerModule
