// Handlers of the `projectPulse` domain (src/shared/ipc/project-pulse.ts, worfy-polish ticket 99): the live
// state of every Project of this Machine from the app's one hub (src/main/claude-home/pulse.ts), over the
// app's registry of live Sessions, PR inbox reader and Stages. A window subscribes with its first
// `projectPulse.get` and stays subscribed until it is gone; a Linked machine's client the same way.
//
// A Linked machine sees no Project kept on this Machine only (`localOnly`), as in `projects.list`
// (src/main/ipc/projects.ts, visibleTo): neither in the answer nor in any event after it. The link's own event
// filter (src/main/link/ipc-adapter.ts, localProjectIn) looks at the top of a payload only, so the filter is here.
import { PR_NEED_YOU } from '../../shared/ipc/pr-inbox'
import { projectPulseChanged, projectPulseGet, waitsForPerson, type ProjectPulseState } from '../../shared/ipc/project-pulse'
import { isRemoteCall } from '../link/caller'
import type { PrInboxSource } from '../notify'
import { ProjectPulseHub, type PulseSources } from '../claude-home/pulse'
import { ClaudeHomeRegistry, processGoneNow } from '../claude-home/registry'
import { ClientHolders, clientOf } from '../clients'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import type { StageHub } from '../workflow/stages'
import { stageHub } from './pipeline'
import { appPrInboxSource } from './pr-inbox'
import { defineHandler, emit, type HandlerModule } from './index'

/** The ids of the Projects kept on this Machine only. */
function appLocalOnly(): ReadonlySet<string> {
  return new Set(projectStore().list().filter((project) => project.localOnly === true).map((project) => project.id))
}

/** The state without the Projects of `hidden`. */
function without(state: ProjectPulseState, hidden: ReadonlySet<string>): ProjectPulseState {
  if (hidden.size === 0) return state
  return { projects: state.projects.filter((project) => !hidden.has(project.projectId)) }
}

/** The handlers over a hub; tests pass their own hub and list of local-only Projects. */
export function projectPulseHandlers(hub: () => Pick<ProjectPulseHub, 'subscribe' | 'unsubscribe'>, localOnly: () => ReadonlySet<string> = appLocalOnly): HandlerModule {
  /** The client holding each id leaves the hub when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => void hub().unsubscribe(id))
  return [
    defineHandler(projectPulseGet, async (_input, { event }) => {
      const client = clientOf(event)
      if (client === undefined) throw new Error('projectPulse.get: the call came from no client')
      if (!holders.hold(client)) throw new Error('projectPulse.get: the client is gone')
      // Read at every answer and event: a Project may be made local-only while the client is subscribed.
      const shown = isRemoteCall(event) ? (state: ProjectPulseState) => without(state, localOnly()) : (state: ProjectPulseState) => state
      const state = await hub().subscribe(client.id, (next) => {
        if (!client.isDestroyed()) emit(client, projectPulseChanged, shown(next))
      })
      return shown(state)
    }),
  ]
}

/** The pull requests that need the user in a PR inbox snapshot; null while the inbox is off or the Project is gone. */
function needYou(inbox: Pick<PrInboxSource, 'snapshot'>, projectId: string): number | null {
  try {
    const snapshot = inbox.snapshot(projectId)
    if (!snapshot.enabled) return null
    return snapshot.groups.filter(({ group }) => PR_NEED_YOU.has(group)).reduce((sum, { rows }) => sum + rows.length, 0)
  } catch {
    // A Project removed between the list and this read.
    return null
  }
}

export interface AppPulseParts {
  registry?: ClaudeHomeRegistry
  inbox?: PrInboxSource
  stages?: Pick<StageHub, 'current' | 'onChange'>
}

/** The sources of the app: its registry of live Sessions, its PR inbox reader, its Stages and its Project list. */
export function appPulseSources(parts: AppPulseParts = {}): PulseSources {
  const registry = parts.registry ?? new ClaudeHomeRegistry({ home: claudeHome() })
  const inbox = parts.inbox ?? appPrInboxSource()
  const stages = parts.stages ?? stageHub
  return {
    projects: () => projectStore().list(),
    live: () => registry.liveAll(),
    gone: processGoneNow,
    stamp: () => registry.registryStamp(),
    roots: (path) => registry.roots({ path, local: true }),
    prNeedYou: (projectId) => needYou(inbox, projectId),
    onPrChange: (listener) => inbox.onChange(() => listener()),
    waits: (path) => stages.current(path)?.tickets.filter(waitsForPerson).length ?? null,
    onWaitsChange: (listener) => stages.onChange(listener),
    onProjectsChange: (listener) => projectStore().onChange(() => listener()),
  }
}

let shared: ProjectPulseHub | undefined

/** The app's one hub, made at the first call. */
export function appProjectPulse(): ProjectPulseHub {
  shared ??= new ProjectPulseHub(appPulseSources())
  return shared
}

export default projectPulseHandlers(appProjectPulse) satisfies HandlerModule
