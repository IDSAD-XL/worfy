// Handlers of the `gettingStarted` domain (src/shared/ipc/getting-started.ts). The creation of the
// Demo project lives in src/main/getting-started/demo.ts; here it is wired to the app: the user's
// home and temporary folders, git and bin/project-connect with the login shell's environment, the
// Project list, the app's Orchestrators, the state file in worfy's data folder, and the step it is
// on sent to every window.
//
// The state (ticket 06) is read and written through src/main/getting-started/state.ts; its steps are
// marked by src/main/getting-started/progress.ts, which startGettingStarted() wires to the app's
// sources once at startup, together with `gettingStarted.changed` to every window.
//
// Ticket 09: `gettingStarted.hintSeen` records a hint shown, `gettingStarted.setCost` switches the
// demo's Orchestrator through DemoCostSwitch (src/main/getting-started/demo.ts), wired here to the
// app's Layouts, Session settings, Orchestrators and Sessions.
import { homedir, tmpdir } from 'node:os'
import {
  gettingStartedChanged,
  gettingStartedCreateDemo,
  gettingStartedCreateProgress,
  gettingStartedHintSeen,
  gettingStartedNoticeSeen,
  gettingStartedSetCost,
  gettingStartedSetSection,
  gettingStartedStateChannel,
  type CreateDemoResult,
  type DemoCost,
  type GettingStartedSnapshot,
} from '../../shared/ipc/getting-started'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { agentEnv } from '../agent/env'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import type { Orchestrators } from '../agent/orchestrator'
import type { SessionRegistry } from '../agent/session'
import { SessionSettingsStore } from '../agent/session-settings'
import { toEveryWindow } from '../broadcast'
import { DemoCostSwitch, DemoCreator, demoGit, gateRegistryRepos, type CostDeps } from '../getting-started/demo'
import { GettingStartedProgress } from '../getting-started/progress'
import { gettingStartedState, type GettingStartedState } from '../getting-started/state'
import { harnessHomes, locateHarness } from '../harness/locate'
import { layoutStore, type LayoutStore } from '../layout/store'
import { connectScriptRunner } from '../projects/connect'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'
import { stageHub } from './pipeline'
import { workflowHub } from './workflow'

/** The handlers over a creation of the Demo project, a state and a cost switch; tests pass their own. */
export function gettingStartedHandlers(
  createDemo: () => Promise<CreateDemoResult>,
  state: () => Pick<GettingStartedState, 'read' | 'setSection' | 'noticeSeen' | 'hintSeen'> = gettingStartedState,
  setCost: (cost: DemoCost) => Promise<GettingStartedSnapshot> = (cost) => appCostSwitch().set(cost),
): HandlerModule {
  return [
    defineHandler(gettingStartedCreateDemo, () => createDemo()),
    defineHandler(gettingStartedStateChannel, () => state().read()),
    defineHandler(gettingStartedSetSection, ({ section }) => state().setSection(section)),
    defineHandler(gettingStartedNoticeSeen, () => state().noticeSeen()),
    defineHandler(gettingStartedHintSeen, ({ id }) => ({ first: state().hintSeen(id) })),
    defineHandler(gettingStartedSetCost, ({ cost }) => setCost(cost)),
  ]
}

/** The id of the Orchestrator Node in the Project's Layout, or null. */
export function orchestratorNodeOf(layout: Pick<LayoutStore, 'get'>, projectId: string): string | null {
  return layout.get(projectId).layout.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)?.id ?? null
}

/**
 * The live Session of the Orchestrator behind `nodeId`, for the cost switch: none when that
 * Orchestrator was never opened in this run or its Session closed; after a failed start, the one
 * that failed if it is still live (never a new one); otherwise the one it runs once it has started
 * (open() of an open Orchestrator starts nothing). A change through it is told to the
 * registry first, as `agent.configure` tells it: a person acts on the Session (Autopilot's journal).
 */
export function liveOrchestratorSession(
  orchestrators: Pick<Orchestrators, 'view' | 'open'>,
  registry: Pick<SessionRegistry, 'get' | 'noteInput'>,
): CostDeps['liveSession'] {
  return async (projectId, nodeId) => {
    const view = orchestrators.view(nodeId)
    if (view === null || view.state === 'closed') return null
    // After a failed start open() would start a new Session: the one that failed, when it is still
    // live, gets the change itself, and the next start reads the saved picks.
    const sessionId = view.state === 'error' ? view.sessionId : (await orchestrators.open(projectId)).sessionId
    if (sessionId === null) return null
    let session: ReturnType<SessionRegistry['get']>
    try {
      session = registry.get(sessionId)
    } catch {
      // Closed in between: its next start reads the saved picks.
      return null
    }
    return {
      configure: (change) => {
        registry.noteInput(sessionId, 'changed the model and effort (Getting started)')
        return session.configure(change)
      },
    }
  }
}

let costSwitch: DemoCostSwitch | null = null

/** The app's cost switch, made on the first call: importing this module does no I/O. */
function appCostSwitch(): DemoCostSwitch {
  costSwitch ??= new DemoCostSwitch(() => ({
    state: gettingStartedState(),
    orchestratorNode: (projectId) => orchestratorNodeOf(layoutStore(), projectId),
    settings: new SessionSettingsStore((projectId) => projectStore().dataDir(projectStore().get(projectId).id)),
    liveSession: liveOrchestratorSession(sharedOrchestrators(), sharedRegistry()),
  }))
  return costSwitch
}

/** The login shell's environment without the caller's GIT_* variables (a GIT_DIR would point git elsewhere). */
async function gitEnv(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries((await agentEnv()).env)) {
    if (!key.startsWith('GIT_')) env[key] = value
  }
  return env
}

let creator: DemoCreator | null = null

/** The app's creator, made on the first call: importing this module does no I/O. */
function appCreator(): DemoCreator {
  creator ??= new DemoCreator(() => ({
    home: homedir(),
    tmpdir: tmpdir(),
    git: async (args, cwd) => demoGit(await gitEnv())(args, cwd),
    connect: connectScriptRunner({ harness: () => locateHarness(harnessHomes(claudeHome())), env: async () => (await agentEnv()).env }),
    projects: projectStore(),
    openOrchestrator: (projectId, firstSettings) => sharedOrchestrators().open(projectId, { firstSettings }),
    state: gettingStartedState(),
    registeredRepos: gateRegistryRepos(() => locateHarness(harnessHomes(claudeHome())).gateDir),
    progress: (step) => toEveryWindow((client) => emit(client, gettingStartedCreateProgress, { step })),
  }))
  return creator
}

/** Where orchestratorMatcher looks: the Layouts, the Orchestrators and the Sessions of the app. */
export interface OrchestratorLookup {
  layout: Pick<LayoutStore, 'get'>
  orchestrators: Pick<Orchestrators, 'view'>
  registry: Pick<SessionRegistry, 'get'>
}

/**
 * Whether `sessionId` is the live Session of `projectId`'s Orchestrator: the Session behind the
 * Project's Orchestrator Node, by either of its ids (the temporary one and Claude Code's). `lookup`
 * is asked on each call, so making the matcher creates none of the app's stores.
 */
export function orchestratorMatcher(lookup: () => OrchestratorLookup): (projectId: string, sessionId: string) => boolean {
  return (projectId, sessionId) => {
    try {
      const { layout, orchestrators, registry } = lookup()
      const nodeId = orchestratorNodeOf(layout, projectId)
      const live = nodeId === null ? null : (orchestrators.view(nodeId)?.sessionId ?? null)
      if (live === null) return false
      return registry.get(live) === registry.get(sessionId)
    } catch {
      // No Layout for the Project, or no live Session under one of the ids.
      return false
    }
  }
}

/**
 * Starts Getting started in main, once, before the first window: reads the state (the first read
 * decides a new or an existing user, decision 7, before the user can add a Project), sends
 * `gettingStarted.changed` to every window after each change, and marks the steps from the app's
 * sources. Answers the stop.
 */
export function startGettingStarted(): () => void {
  const state = gettingStartedState()
  state.read()
  const stopChanged = state.onChange(() => {
    const snapshot = state.read()
    toEveryWindow((client) => emit(client, gettingStartedChanged, snapshot))
  })
  const stopProgress = new GettingStartedProgress({
    state,
    projects: { list: () => projectStore().list(), onChange: (listener) => projectStore().onChange(() => listener()) },
    stages: stageHub,
    workflow: workflowHub,
    sessions: sharedRegistry(),
    isOrchestratorOf: orchestratorMatcher(() => ({ layout: layoutStore(), orchestrators: sharedOrchestrators(), registry: sharedRegistry() })),
  }).start()
  return () => {
    stopProgress()
    stopChanged()
  }
}

export default gettingStartedHandlers(() => appCreator().create()) satisfies HandlerModule
