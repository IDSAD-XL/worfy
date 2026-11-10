// Handlers of the `projectPulse` domain (src/shared/ipc/project-pulse.ts, worfy-polish ticket 99): the live
// state of every Project of this Machine from the app's one hub (src/main/claude-home/pulse.ts), over the
// app's registry of live Sessions, PR inbox reader and Stages. A window subscribes with its first
// `projectPulse.get` and stays subscribed until it is gone; a Linked machine's client the same way.
import { PR_NEED_YOU_GROUPS, projectPulseChanged, projectPulseGet, waitsForPerson } from '../../shared/ipc/project-pulse'
import { ProjectPulseHub, type PulseSources } from '../claude-home/pulse'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { ClientHolders, clientOf } from '../clients'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { stageHub } from './pipeline'
import { appPrInboxSource } from './pr-inbox'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a hub; tests pass their own. */
export function projectPulseHandlers(hub: () => Pick<ProjectPulseHub, 'subscribe' | 'unsubscribe'>): HandlerModule {
  /** The client holding each id leaves the hub when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => void hub().unsubscribe(id))
  return [
    defineHandler(projectPulseGet, async (_input, { event }) => {
      const client = clientOf(event)
      if (client === undefined) throw new Error('projectPulse.get: the call came from no client')
      if (!holders.hold(client)) throw new Error('projectPulse.get: the client is gone')
      return hub().subscribe(client.id, (state) => {
        if (!client.isDestroyed()) emit(client, projectPulseChanged, state)
      })
    }),
  ]
}

/** The sources of the app: its registry of live Sessions, its PR inbox reader, its Stages and its Project list. */
export function appPulseSources(registry: ClaudeHomeRegistry = new ClaudeHomeRegistry({ home: claudeHome() })): PulseSources {
  const inbox = appPrInboxSource()
  return {
    projects: () => projectStore().list(),
    live: () => registry.liveAll(),
    stamp: () => registry.registryStamp(),
    roots: (path) => registry.roots({ path, local: true }),
    prNeedYou: (projectId) => {
      try {
        const snapshot = inbox.snapshot(projectId)
        if (!snapshot.enabled) return null
        return snapshot.groups.filter(({ group }) => PR_NEED_YOU_GROUPS.includes(group)).reduce((sum, { rows }) => sum + rows.length, 0)
      } catch {
        // A Project removed between the list and this read.
        return null
      }
    },
    onPrChange: (listener) => inbox.onChange(() => listener()),
    waits: (path) => stageHub.current(path)?.tickets.filter(waitsForPerson).length ?? null,
    onWaitsChange: (listener) => stageHub.onChange(listener),
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
