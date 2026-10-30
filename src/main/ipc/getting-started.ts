// Handlers of the `gettingStarted` domain (src/shared/ipc/getting-started.ts). The creation of the
// Demo project lives in src/main/getting-started/demo.ts; here it is wired to the app: the user's
// home and temporary folders, git and bin/project-connect with the login shell's environment, the
// Project list, the app's Orchestrators, the state file in worfy's data folder, and the step it is
// on sent to every window.
//
// The state (ticket 06) is read and written through src/main/getting-started/state.ts; its steps are
// marked by src/main/getting-started/progress.ts, which startGettingStarted() wires to the app's
// sources once at startup, together with `gettingStarted.changed` to every window.
import { homedir, tmpdir } from 'node:os'
import {
  gettingStartedChanged,
  gettingStartedCreateDemo,
  gettingStartedCreateProgress,
  gettingStartedNoticeSeen,
  gettingStartedSetSection,
  gettingStartedStateChannel,
  type CreateDemoResult,
} from '../../shared/ipc/getting-started'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { agentEnv } from '../agent/env'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { toEveryWindow } from '../broadcast'
import { DemoCreator, demoGit, gateRegistryRepos } from '../getting-started/demo'
import { GettingStartedProgress } from '../getting-started/progress'
import { gettingStartedState, type GettingStartedState } from '../getting-started/state'
import { harnessHomes, locateHarness } from '../harness/locate'
import { layoutStore } from '../layout/store'
import { connectScriptRunner } from '../projects/connect'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'
import { stageHub } from './pipeline'
import { workflowHub } from './workflow'

/** The handlers over a creation of the Demo project and a state; tests pass their own. */
export function gettingStartedHandlers(
  createDemo: () => Promise<CreateDemoResult>,
  state: () => Pick<GettingStartedState, 'read' | 'setSection' | 'noticeSeen'> = gettingStartedState,
): HandlerModule {
  return [
    defineHandler(gettingStartedCreateDemo, () => createDemo()),
    defineHandler(gettingStartedStateChannel, () => state().read()),
    defineHandler(gettingStartedSetSection, ({ section }) => state().setSection(section)),
    defineHandler(gettingStartedNoticeSeen, () => state().noticeSeen()),
  ]
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

/**
 * Whether `sessionId` is the live Session of `projectId`'s Orchestrator: the Session behind the
 * Project's Orchestrator Node, by either of its ids (the temporary one and Claude Code's).
 */
function isOrchestratorOf(projectId: string, sessionId: string): boolean {
  try {
    const node = layoutStore()
      .get(projectId)
      .layout.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)
    const live = node === undefined ? null : (sharedOrchestrators().view(node.id)?.sessionId ?? null)
    if (live === null) return false
    const registry = sharedRegistry()
    return registry.get(live) === registry.get(sessionId)
  } catch {
    // No Layout for the Project, or no live Session under one of the ids.
    return false
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
    isOrchestratorOf,
  }).start()
  return () => {
    stopProgress()
    stopChanged()
  }
}

export default gettingStartedHandlers(() => appCreator().create()) satisfies HandlerModule
