// Handlers of the `prInbox` domain (src/shared/ipc/pr-inbox.ts, worfy-pr-inbox ticket 02), and the app's one PR inbox
// reader (src/main/github/inbox.ts): it reads the Projects of this Machine only, so a Linked machine gets the snapshot
// of the Project machine through these channels and never polls GitHub itself. Every change of a Project's inbox
// reaches every client as `prInbox.changed`, and the PR inbox notifications of main (worfy-pr-inbox ticket 07,
// appPrInboxSource). `prInbox.digest` answers the morning digest to a window of this Machine (inbox-digest.ts).
//
// The drafts of replies and Send (worfy-pr-inbox ticket 05, src/main/github/pr-reply-send.ts): `local` channels, so
// the link adapter refuses them to a Linked machine before any handler here runs (ADR-0105).
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { prInboxChanged, prInboxDigest, prInboxDiscard, prInboxDrafts, prInboxGet, prInboxMarkSeen, prInboxSaveDraft, prInboxSend } from '../../shared/ipc/pr-inbox'
import { prInboxDigestOf } from '../../shared/settings/app-settings'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import { PrInbox, remoteRepos, type PrInboxProject } from '../github/inbox'
import { PrInboxDigest } from '../github/inbox-digest'
import { PrReplySender } from '../github/pr-reply-send'
import type { PrInboxSource } from '../notify'
import { appSettingsStore } from '../settings/store'
import { accountAuth, ghRunner, type GhRunner } from '../github/prs'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import { harnessScriptEnv } from '../harness/script-env'
import { prInboxSetting } from '../projects/pr-inbox-state'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { HARNESS_SCRIPT_TIMEOUT_MS, readGithubAccount, readProfileFolder, runHarnessScript } from '../workflow/profile'
import { defineHandler, emit, type HandlerModule } from './index'

/** The drafts of replies of a Project's PRs and their Send, by the Project's id. */
export interface PrReplyDraftsAccess {
  sender: () => Pick<PrReplySender, 'drafts' | 'save' | 'discard' | 'send'>
  /** The Project's root; throws for an unknown id. */
  root: (projectId: string) => string
}

/** The handlers over a reader, the drafts and the morning digest; tests pass their own. */
export function prInboxHandlers(
  inbox: () => Pick<PrInbox, 'ensureRead' | 'snapshot' | 'markSeen'>,
  drafts: PrReplyDraftsAccess = sharedDrafts,
  digest: () => Pick<PrInboxDigest, 'ask'> = sharedPrInboxDigest,
): HandlerModule {
  return [
    defineHandler(prInboxDigest, async () => digest().ask()),
    defineHandler(prInboxGet, async ({ projectId }) => {
      await inbox().ensureRead(projectId)
      return inbox().snapshot(projectId)
    }),
    defineHandler(prInboxMarkSeen, async ({ projectId, repo, number }) => inbox().markSeen(projectId, repo, number)),
    defineHandler(prInboxDrafts, ({ projectId, repo, number }) => drafts.sender().drafts(drafts.root(projectId), repo, number)),
    defineHandler(prInboxSaveDraft, ({ projectId, repo, number, item, body }) => drafts.sender().save(drafts.root(projectId), repo, number, item, body)),
    defineHandler(prInboxDiscard, ({ projectId, repo, number, item }) => drafts.sender().discard(drafts.root(projectId), repo, number, item)),
    defineHandler(prInboxSend, ({ projectId, repo, number, items }) => drafts.sender().send(drafts.root(projectId), repo, number, items)),
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
let sharedSender: PrReplySender | undefined

/** gh as the PR badges run it (src/main/ipc/checks.ts): WORFY_GH (a stub in tests) with the app's own environment, else `gh` with the login shell's. */
function appGh(): GhRunner {
  const stub = process.env.WORFY_GH
  return ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env })
}

/** The Project's GitHub account from its Profile, read again on each call; its reason for none left to the PR badges to log. */
const projectAccount = async (root: string): Promise<string | null> => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account

/** Those who follow the changes of the app's reader in main: the PR inbox notifications (src/main/notify.ts). */
const changeListeners = new Set<(projectId: string) => void>()

/**
 * The app's reader: gh of appGh, the account of the Project's Profile.
 */
export function sharedPrInbox(): PrInbox {
  shared ??= new PrInbox({
    run: appGh(),
    projects: machineProjects,
    enabled: (project) => prInboxSetting(project.dataDir),
    account: projectAccount,
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

/**
 * The app's drafts and Send: gh of appGh as the Project's account (accountAuth), the Profile folder from bin/profile,
 * and review-draft-lint of the Harness on the machine, started as every Harness script is.
 */
export function sharedPrReplySender(): PrReplySender {
  if (sharedSender !== undefined) return sharedSender
  const run = appGh()
  sharedSender = new PrReplySender({
    run,
    auth: accountAuth({ account: projectAccount, run }),
    // The reason for no folder goes to the view with the drafts, not to the log on each look.
    profileDir: async (root) => readProfileFolder({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined }),
    repos: async (root) => remoteRepos(await repoFolders(root)),
    lint: async (draft, root, rules) => {
      const harness = locateHarness(harnessHomes(claudeHome()))
      const env = scriptEnv(harness, await harnessScriptEnv())
      const args = ['--reply', '-', '-C', root, ...(rules === null ? [] : ['--rules', rules])]
      return runHarnessScript(join(harness.binDir, 'review-draft-lint'), args, env, { stdin: draft, timeoutMs: HARNESS_SCRIPT_TIMEOUT_MS })
    },
  })
  return sharedSender
}

const sharedDrafts: PrReplyDraftsAccess = { sender: sharedPrReplySender, root: (projectId) => projectStore().get(projectId).path }

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
