// Handlers of the `pipeline` domain (src/shared/ipc/pipeline.ts): the Stage of each Ticket of a
// Project, computed in main (src/main/workflow/stages.ts). Read-only (ADR-0002, ADR-0005). The PRs
// come from the app's one PR tracker, shared with the badges and Autopilot (sharedPrTracker), and the
// workflow model from the app's one workflow hub.
import { resolve } from 'node:path'
import { pipelineChanged, pipelineClose, pipelineGet } from '../../shared/ipc/pipeline'
import { ClientHolders, clientOf, type Client } from '../clients'
import { DeploymentReader } from '../github/deployments'
import { harnessHomes } from '../harness/locate'
import { harnessScriptEnv, type HarnessScriptEnvSource } from '../harness/script-env'
import { insideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readPipelineProfile } from '../workflow/profile'
import { StageHub, type StageSources, type StageSubscriber } from '../workflow/stages'
import { sharedPrTracker } from './checks'
import { defineHandler, emit, type HandlerModule } from './index'
import { workflowHub } from './workflow'

/** The Profile's Pipeline through `bin/profile --json`, with the Harness scripts' environment of the app. */
export function pipelineProfileSource(home: string, env: HarnessScriptEnvSource): StageSources['profile'] {
  return async (root) => {
    const read = await readPipelineProfile({ root, claudeHome: home, env: await env() })
    return read.ok ? read : { ok: false, reason: read.reason }
  }
}

/** The app's Stages: one computation per Project, shared by the windows that asked for it. */
export const stageHub = new StageHub({
  workflow: workflowHub,
  prs: sharedPrTracker(),
  profile: pipelineProfileSource(claudeHome(), harnessScriptEnv),
  deployments: new DeploymentReader({ gh: (root, args) => sharedPrTracker().gh(root, args) }),
  harnessHome: harnessHomes(claudeHome()).harnessHome,
})

export interface PipelineHandlersOptions {
  hub: Pick<StageHub, 'open' | 'close' | 'drop'>
  projects?: () => readonly { readonly path: string }[]
}

/** The handlers over a hub; a Linked machine reaches only the Projects of the list (src/main/link/caller.ts). */
export function pipelineHandlers(options: PipelineHandlersOptions): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  /** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => void options.hub.drop(id))
  const subscriberOf = (client: Client | undefined): StageSubscriber => {
    if (client === undefined) throw new Error('pipeline.get: the call came from no client')
    if (!holders.hold(client)) throw new Error('pipeline.get: the client is gone')
    return {
      id: client.id,
      send: (snapshot) => {
        if (!client.isDestroyed()) emit(client, pipelineChanged, snapshot)
      },
    }
  }
  return [
    defineHandler(pipelineGet, ({ root }, { event }) => {
      const checked = resolve(insideProjects(event, resolve(root), projects, 'the Project root'))
      return options.hub.open(checked, subscriberOf(clientOf(event)))
    }),
    defineHandler(pipelineClose, async ({ root }, { event }) => {
      const client = clientOf(event)
      const checked = resolve(insideProjects(event, resolve(root), projects, 'the Project root'))
      return { closed: client === undefined ? false : await options.hub.close(checked, client.id) }
    }),
  ]
}

export default pipelineHandlers({ hub: stageHub })
