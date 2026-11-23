// Handlers of the `acceptance` domain (src/shared/ipc/acceptance.ts, worfy-acceptance ticket 01): the checks that wait
// for the owner in every Project of this Machine, from the app's one service (src/main/acceptance/service.ts) over the
// workflow hub. A window subscribes with its first `acceptance.get` and stays subscribed until it is gone; a Linked
// machine's client the same way, as `projectPulse.get` (src/main/ipc/project-pulse.ts).
//
// A Linked machine sees no Project kept on this Machine only (`localOnly`), as in `projects.list`: neither in the answer
// nor in any event after it. The link's own event filter looks at the top of a payload only, so the filter is here.
import { acceptanceChanged, acceptanceGet, type AcceptanceState } from '../../shared/ipc/acceptance'
import { AcceptanceService } from '../acceptance/service'
import { isRemoteCall } from '../link/caller'
import { ClientHolders, clientOf } from '../clients'
import { projectStore } from '../projects/store'
import { workflowHub } from './workflow'
import { defineHandler, emit, type HandlerModule } from './index'

/** The ids of the Projects kept on this Machine only. */
function appLocalOnly(): ReadonlySet<string> {
  return new Set(projectStore().list().filter((project) => project.localOnly === true).map((project) => project.id))
}

/** The queue without the rows of the Projects of `hidden`. */
function without(state: AcceptanceState, hidden: ReadonlySet<string>): AcceptanceState {
  if (hidden.size === 0) return state
  return { groups: state.groups.map(({ group, rows }) => ({ group, rows: rows.filter((row) => !hidden.has(row.ticket.projectId)) })) }
}

/** The handlers over a service; tests pass their own service and list of local-only Projects. */
export function acceptanceHandlers(service: () => Pick<AcceptanceService, 'subscribe' | 'unsubscribe'>, localOnly: () => ReadonlySet<string> = appLocalOnly): HandlerModule {
  /** The client holding each id leaves the service when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => void service().unsubscribe(id))
  return [
    defineHandler(acceptanceGet, async (_input, { event }) => {
      const client = clientOf(event)
      if (client === undefined) throw new Error('acceptance.get: the call came from no client')
      if (!holders.hold(client)) throw new Error('acceptance.get: the client is gone')
      // Read at every answer and event: a Project may be made local-only while the client is subscribed.
      const shown = isRemoteCall(event) ? (state: AcceptanceState) => without(state, localOnly()) : (state: AcceptanceState) => state
      const state = await service().subscribe(client.id, (next) => {
        if (!client.isDestroyed()) emit(client, acceptanceChanged, shown(next))
      })
      return shown(state)
    }),
  ]
}

let shared: AcceptanceService | undefined

/** The app's one service over the workflow hub and the Project list, made at the first call. */
export function appAcceptance(): AcceptanceService {
  shared ??= new AcceptanceService({
    hub: workflowHub,
    projects: () => projectStore().list(),
    dataDir: (projectId) => projectStore().dataDir(projectId),
    onProjectsChange: (listener) => projectStore().onChange(() => listener()),
  })
  return shared
}

export default acceptanceHandlers(appAcceptance) satisfies HandlerModule
