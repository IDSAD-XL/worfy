// Handlers of the `runs` domain (src/shared/ipc/runs.ts): the Runs of a Project and the timeline of
// one Run from the app's one Flight Recorder service (src/main/flight-recorder/service.ts). Read-only
// (ADR-0002, ADR-0005): the Journals, the transcripts, the gate logs, git and gh are only read.
//
// A window on a Linked machine reaches these channels while "Linked machines can work with my
// Projects" is on (`project`, `read`): it reads the Runs on the Machine where they ran (decision 01,
// Q7). Its client is held like a window's (ClientHolders): when access goes off the link destroys the
// client, and every Run it held open is let go.
import { runsChanged, runsClose, runsList, runsOpen, runsRetry } from '../../shared/ipc/runs'
import { ClientHolders, clientOf } from '../clients'
import type { FlightRecorder, RunProfile } from '../flight-recorder/service'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a service; the app's (sharedFlightRecorder) when the module is loaded. */
export function runsHandlers(service: () => Promise<Pick<FlightRecorder, 'list' | 'open' | 'close' | 'drop' | 'retry'>>): HandlerModule {
  /** The client holding each id lets go of every Run when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => {
    void service().then((recorder) => recorder.drop(id))
  })
  return [
    defineHandler(runsList, async ({ projectId, epic }) => ({ runs: await (await service()).list(projectId, epic) })),
    defineHandler(runsOpen, async ({ projectId, run }, { event }) => {
      const client = clientOf(event)
      if (client === undefined) throw new Error('runs.open: the call came from no client')
      if (!holders.hold(client)) throw new Error('runs.open: the client is gone')
      return (await service()).open(projectId, run, {
        id: client.id,
        send: (view) => {
          if (!client.isDestroyed()) emit(client, runsChanged, view)
        },
      })
    }),
    defineHandler(runsClose, async ({ projectId, run }, { event }) => {
      const client = clientOf(event)
      return { closed: client === undefined ? false : (await service()).close(projectId, run, client.id) }
    }),
    defineHandler(runsRetry, async ({ projectId, run }) => (await service()).retry(projectId, run)),
  ]
}

let shared: Promise<FlightRecorder> | undefined

/** The Profile's values the timeline needs, through `bin/profile` with the Harness scripts' environment. */
async function appProfile(root: string): Promise<RunProfile> {
  const [{ readGithubAccount, readPipelineProfile, profileRunner }, { readCrossMachineGate }, { harnessScriptEnv }, { claudeHome }, { DEFAULT_PIPELINE }] = await Promise.all([
    import('../workflow/profile'),
    import('../github/gate-queue'),
    import('../harness/script-env'),
    import('../storage/paths'),
    import('../../shared/workflow/pipeline'),
  ])
  const home = claudeHome()
  const env = await harnessScriptEnv()
  const read = await readPipelineProfile({ root, claudeHome: home, env })
  const account = await readGithubAccount({ root, claudeHome: home, env })
  const gate = await readCrossMachineGate(profileRunner(home, env), root)
  const crossMachineGate = gate.gate === null ? null : { label: gate.gate.label, checksSection: gate.gate.checksSection }
  if (!read.ok) return { name: null, mode: 'full', finish: null, pipeline: DEFAULT_PIPELINE, account: account.account, accountReason: account.reason, crossMachineGate, reason: read.reason }
  const { name, mode, finish, pipeline, pipelineReason } = read.profile
  return { name, mode, finish, pipeline, account: account.account, accountReason: account.reason, crossMachineGate, reason: pipelineReason }
}

/**
 * The app's service, made on first use: the Projects of the store, gh through the app's one PR tracker
 * (GH_TOKEN of the Profile's account, WORFY_GH for a stand-in), the branches of the workflow model the
 * app watches, and Autopilot's state for whether a Run goes on. Imported lazily, so loading this module
 * starts none of them.
 */
export function sharedFlightRecorder(): Promise<FlightRecorder> {
  shared ??= (async () => {
    const [{ FlightRecorder }, { sharedAutopilot }, { sharedPrTracker }, { workflowHub }, { projectStore }, { harnessHomes }, { claudeHome }, { branchOfTicket }] = await Promise.all([
      import('../flight-recorder/service'),
      import('./autopilot'),
      import('./checks'),
      import('./workflow'),
      import('../projects/store'),
      import('../harness/locate'),
      import('../storage/paths'),
      import('../workflow/stages'),
    ])
    return new FlightRecorder({
      harnessHome: harnessHomes(claudeHome()).harnessHome,
      projectRoot: (projectId) => projectStore().get(projectId).path,
      profile: appProfile,
      gh: (root, args) => sharedPrTracker().gh(root, args),
      running: (projectId, epic) => {
        const state = sharedAutopilot().state(projectId)
        return state.status !== 'stopped' && state.epic === epic
      },
      // The model of a Project the app watches; none is started for this.
      branches: async (root, epic) => {
        const model = await workflowHub.model(root)
        return new Map((model?.tickets ?? []).filter((ticket) => ticket.epic === epic).map((ticket) => [ticket.num, branchOfTicket(ticket)]))
      },
    })
  })()
  // A failed start is not kept: the next call tries again.
  shared.catch(() => {
    shared = undefined
  })
  return shared
}

export default runsHandlers(sharedFlightRecorder) satisfies HandlerModule
