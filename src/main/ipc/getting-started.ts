// Handlers of the `gettingStarted` domain (src/shared/ipc/getting-started.ts). The creation of the
// Demo project lives in src/main/getting-started/demo.ts; here it is wired to the app: the user's
// home and temporary folders, git and bin/project-connect with the login shell's environment, the
// Project list, the app's Orchestrators, the state file in worfy's data folder, and the step it is
// on sent to every window.
import { homedir, tmpdir } from 'node:os'
import { gettingStartedCreateDemo, gettingStartedCreateProgress, type CreateDemoResult } from '../../shared/ipc/getting-started'
import { agentEnv } from '../agent/env'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { toEveryWindow } from '../broadcast'
import { DemoCreator, demoGit, gateRegistryRepos } from '../getting-started/demo'
import { gettingStartedState } from '../getting-started/state'
import { harnessHomes, locateHarness } from '../harness/locate'
import { connectScriptRunner } from '../projects/connect'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a creation of the Demo project; tests pass their own. */
export function gettingStartedHandlers(createDemo: () => Promise<CreateDemoResult>): HandlerModule {
  return [defineHandler(gettingStartedCreateDemo, () => createDemo())]
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

export default gettingStartedHandlers(() => appCreator().create()) satisfies HandlerModule
