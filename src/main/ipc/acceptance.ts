// Handlers of the `acceptance` domain (src/shared/ipc/acceptance.ts, worfy-acceptance ticket 01): the checks that wait
// for the owner in every Project of this Machine, from the app's one service (src/main/acceptance/service.ts) over the
// workflow hub. A window subscribes with its first `acceptance.get` and stays subscribed until it is gone; a Linked
// machine's client the same way, as `projectPulse.get` (src/main/ipc/project-pulse.ts).
//
// The Stable copy line (worfy-acceptance ticket 02) asks gh through the app's PR tracker, as the Project's GitHub
// account, and reads the Available update of the app's Update service; both modules are loaded when first needed.
//
// A Linked machine sees no Project kept on this Machine only (`localOnly`), as in `projects.list`: neither in the answer
// nor in any event after it. The link's own event filter looks at the top of a payload only, so the filter is here.
import { app } from 'electron'
import { acceptanceChanged, acceptanceGet, type AcceptanceState } from '../../shared/ipc/acceptance'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { AcceptanceService } from '../acceptance/service'
import { stableCopyCommit, type StableLineSources } from '../acceptance/stable-line'
import { runsFromStableCopy } from '../update/stable-copy'
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

/** The app's Update module once loaded: its snapshot holds the Available update and the commit of this run. */
let update: typeof import('./update') | undefined

/** What the Stable copy line reads in the app, each part replaceable in tests. */
export interface StableSourceParts {
  gh: StableLineSources['gh']
  /** This run is the packaged Stable copy (runsFromStableCopy). */
  thisRunIsStable: () => boolean
  /** The Update snapshot of this run; null while its module is not loaded. */
  snapshot: () => Pick<UpdateSnapshot, 'enabled' | 'available'> | null
  /** This run's own commit (appRunning); undefined while not known yet, null when it names none. Read once. */
  ownCommit: () => string | null | undefined
  /** The commit the file next to the Stable copy names (stableCopyCommit). */
  fileCommit: () => string | null
}

/**
 * The sources of the Stable copy line (spec, "Stable copy of an item"): when this run is the Stable copy, its own commit,
 * read once — not the `running` of the update state, which an update check writes only once it ends, so right after a
 * restart into an Update it still names the copy before; else, and until this run's commit is known, the file next to
 * the copy. Whether this copy checks for updates and its Available update come from the Update snapshot.
 */
export function stableSources(parts: StableSourceParts): StableLineSources {
  let own: string | null | undefined
  const ownCommit = (): string | null => {
    if (own === undefined) own = parts.ownCommit()
    return own ?? null
  }
  return {
    gh: parts.gh,
    stableCommit: () => (parts.thisRunIsStable() ? ownCommit() : null) ?? parts.fileCommit(),
    update: () => {
      const snapshot = parts.snapshot()
      return { checks: snapshot?.enabled ?? false, available: snapshot?.available ?? null }
    },
  }
}

/** The app's sources: gh as the Project's account (the PR tracker's) and the app's Update service, loaded when first needed. */
function appStableSources(): StableLineSources {
  void import('./update').then(
    (module) => (update = module),
    (error: unknown) => console.warn('[acceptance] the Update service did not load: no Available update for Update first', error),
  )
  return stableSources({
    gh: async (root, args) => (await import('./checks')).sharedPrTracker().gh(root, args),
    thisRunIsStable: () => runsFromStableCopy({ packaged: app.isPackaged, execPath: process.execPath, env: process.env }),
    snapshot: () => update?.appUpdate().snapshot() ?? null,
    ownCommit: () => (update === undefined ? undefined : update.appRunning().commit || null),
    fileCommit: () => stableCopyCommit(),
  })
}

/** The app's one service over the workflow hub and the Project list, made at the first call. */
export function appAcceptance(): AcceptanceService {
  shared ??= new AcceptanceService({
    hub: workflowHub,
    projects: () => projectStore().list(),
    dataDir: (projectId) => projectStore().dataDir(projectId),
    onProjectsChange: (listener) => projectStore().onChange(() => listener()),
    stable: appStableSources(),
  })
  return shared
}

export default acceptanceHandlers(appAcceptance) satisfies HandlerModule
