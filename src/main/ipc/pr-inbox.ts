// Handlers of the `prInbox` domain (src/shared/ipc/pr-inbox.ts, worfy-pr-inbox ticket 02), and the app's one PR inbox
// reader (src/main/github/inbox.ts): it reads the Projects of this Machine only, so a Linked machine gets the snapshot
// of the Project machine through these channels and never polls GitHub itself. Every change of a Project's inbox
// reaches every client as `prInbox.changed`, and the PR inbox notifications of main (worfy-pr-inbox ticket 07,
// appPrInboxSource). `prInbox.digest` answers the morning digest to a window of this Machine (inbox-digest.ts).
import { BrowserWindow } from 'electron'
import { prInboxChanged, prInboxDigest, prInboxGet, prInboxMarkSeen } from '../../shared/ipc/pr-inbox'
import { prInboxDigestOf } from '../../shared/settings/app-settings'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import { PrInbox, remoteRepos, type PrInboxProject } from '../github/inbox'
import { PrInboxDigest } from '../github/inbox-digest'
import type { PrInboxSource } from '../notify'
import { appSettingsStore } from '../settings/store'
import { ghRunner } from '../github/prs'
import { harnessScriptEnv } from '../harness/script-env'
import { prInboxSetting } from '../projects/pr-inbox-state'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { readGithubAccount } from '../workflow/profile'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a reader and the morning digest; tests pass their own. */
export function prInboxHandlers(inbox: () => Pick<PrInbox, 'ensureRead' | 'snapshot' | 'markSeen'>, digest: () => Pick<PrInboxDigest, 'ask'> = sharedPrInboxDigest): HandlerModule {
  return [
    defineHandler(prInboxDigest, async () => digest().ask()),
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

/** Those who follow the changes of the app's reader in main: the PR inbox notifications (src/main/notify.ts). */
const changeListeners = new Set<(projectId: string) => void>()

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
    onChange: (projectId) => {
      toEveryWindow((client) => emit(client, prInboxChanged, { projectId }))
      for (const listener of changeListeners) listener(projectId)
    },
    // GitHub's notifications as a trigger (ticket 08): its own poll interval while a worfy window has the focus.
    notifications: { focused: () => BrowserWindow.getFocusedWindow() !== null },
  })
  return shared
}

/** Starts the app's reader: every Project of this Machine whose search is due is read. Returns its stop. */
export function startPrInbox(): () => void {
  return sharedPrInbox().start()
}

/** The app's reader as the PR inbox notifications read it (installPrInboxNotifications of src/main/notify.ts). */
export function appPrInboxSource(): PrInboxSource {
  return {
    snapshot: (projectId) => sharedPrInbox().snapshot(projectId),
    onChange: (listener) => {
      changeListeners.add(listener)
      return () => void changeListeners.delete(listener)
    },
  }
}

let digest: PrInboxDigest | undefined

/** The morning digest of this Machine's Projects (src/main/github/inbox-digest.ts), over the app's reader. */
export function sharedPrInboxDigest(): PrInboxDigest {
  digest ??= new PrInboxDigest({
    snapshots: () => machineProjects().map((project) => sharedPrInbox().snapshot(project.id)),
    enabled: () => prInboxDigestOf(appSettingsStore().get()),
    // Read at each ask, so an e2e test may move main's clock.
    now: () => Date.now(),
  })
  return digest
}

export default prInboxHandlers(sharedPrInbox) satisfies HandlerModule
