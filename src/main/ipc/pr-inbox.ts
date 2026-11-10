// Handlers of the `prInbox` domain (src/shared/ipc/pr-inbox.ts, worfy-pr-inbox ticket 02), and the app's one PR inbox
// reader (src/main/github/inbox.ts): it reads the Projects of this Machine only, so a Linked machine gets the snapshot
// of the Project machine through these channels and never polls GitHub itself. Every change of a Project's inbox
// reaches every client as `prInbox.changed`.
import { BrowserWindow } from 'electron'
import { prInboxChanged, prInboxGet, prInboxMarkSeen } from '../../shared/ipc/pr-inbox'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import { PrInbox, remoteRepos, type PrInboxProject } from '../github/inbox'
import { ghRunner } from '../github/prs'
import { harnessScriptEnv } from '../harness/script-env'
import { prInboxSetting } from '../projects/pr-inbox-state'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { readGithubAccount } from '../workflow/profile'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a reader; tests pass their own. */
export function prInboxHandlers(inbox: () => Pick<PrInbox, 'ensureRead' | 'snapshot' | 'markSeen'>): HandlerModule {
  return [
    defineHandler(prInboxGet, async ({ projectId }) => {
      await inbox().ensureRead(projectId)
      return inbox().snapshot(projectId)
    }),
    defineHandler(prInboxMarkSeen, async ({ projectId, repo, number }) => inbox().markSeen(projectId, repo, number)),
  ]
}

/** The Projects of this Machine with their data folders. */
function machineProjects(): PrInboxProject[] {
  const store = projectStore()
  return store.list().map((project) => ({ id: project.id, root: project.path, dataDir: store.dataDir(project.id) }))
}

/** The folders of the Project's repositories: those of its layout, or its root for a Project of one repository. */
async function repoFolders(root: string): Promise<string[]> {
  const layout = await projectLayouts().get(root)
  return layout.repos.length > 0 ? layout.repos.map((repo) => repo.path) : [root]
}

let shared: PrInbox | undefined

/**
 * The app's reader. gh as the PR badges run it (src/main/ipc/checks.ts): WORFY_GH (a stub in tests) with the app's
 * own environment, else `gh` with the login shell's; the account from the Profile, read again on each search, its
 * reason for none left to the PR badges to log.
 */
export function sharedPrInbox(): PrInbox {
  const stub = process.env.WORFY_GH
  shared ??= new PrInbox({
    run: ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env }),
    projects: machineProjects,
    enabled: (project) => prInboxSetting(project.dataDir),
    account: async (root) => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account,
    repos: async (root) => remoteRepos(await repoFolders(root)),
    onChange: (projectId) => toEveryWindow((client) => emit(client, prInboxChanged, { projectId })),
    // GitHub's notifications as a trigger (ticket 08): its own poll interval while a worfy window has the focus.
    notifications: { focused: () => BrowserWindow.getFocusedWindow() !== null },
  })
  return shared
}

/** Starts the app's reader: every Project of this Machine whose search is due is read. Returns its stop. */
export function startPrInbox(): () => void {
  return sharedPrInbox().start()
}

export default prInboxHandlers(sharedPrInbox) satisfies HandlerModule
