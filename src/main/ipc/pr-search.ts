// Handlers of the `prSearch` domain (src/shared/ipc/pr-search.ts, worfy-pr-review ticket 04) and the app's one PR
// search (src/main/github/pr-search.ts): it searches as the Project's account, takes the rows of the app's PR inbox
// (src/main/ipc/pr-inbox.ts) and shares its rate-limit pause. A Linked machine searches through these channels on the
// Project machine; with read-only access the link adapter refuses `prSearch.save` and `prSearch.forget` before any
// handler here runs (ADR-0066).
import { ghRunner, type GhRunner } from '../github/prs'
import { remoteRepos } from '../github/inbox'
import { PrSearch, forgetSearch, saveSearch, savedSearches, type PrSearchProject } from '../github/pr-search'
import { agentEnv } from '../agent/env'
import { harnessScriptEnv } from '../harness/script-env'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { readGithubAccount } from '../workflow/profile'
import { prSearchForget, prSearchPull, prSearchRun, prSearchSave, prSearchSaved } from '../../shared/ipc/pr-search'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import { sharedPrInbox } from './pr-inbox'
import { defineHandler, type HandlerModule } from './index'

/** A Project of this Machine by its id, as the search and the saved searches need it; throws for an unknown id. */
export interface PrSearchProjects {
  project: (projectId: string) => PrSearchProject & { dataDir: string }
}

/** The handlers over a search and the Projects; tests pass their own. */
export function prSearchHandlers(search: () => Pick<PrSearch, 'run' | 'pull'>, projects: PrSearchProjects = machineProjects): HandlerModule {
  return [
    defineHandler(prSearchRun, ({ projectId, text, scope, cursor }) => search().run(projects.project(projectId), { text, scope, cursor: cursor ?? null })),
    defineHandler(prSearchPull, ({ projectId, repo, number, updatedAt, refresh }) => search().pull(projects.project(projectId), { repo, number, updatedAt: updatedAt ?? null, refresh: refresh ?? false })),
    defineHandler(prSearchSaved, ({ projectId }) => ({ searches: savedSearches(projects.project(projectId).dataDir) })),
    defineHandler(prSearchSave, ({ projectId, name, query, scope }) => ({ searches: saveSearch(projects.project(projectId).dataDir, { name, query, scope }) })),
    defineHandler(prSearchForget, ({ projectId, id }) => ({ searches: forgetSearch(projects.project(projectId).dataDir, id) })),
  ]
}

const machineProjects: PrSearchProjects = {
  project: (projectId) => {
    const store = projectStore()
    const project = store.get(projectId)
    return { id: project.id, root: project.path, dataDir: store.dataDir(project.id) }
  },
}

/** The row of the PR in the Project's PR inbox as the app's reader last read it; null when it has none. */
function inboxRow(projectId: string, repo: string, number: number): PrInboxRow | null {
  for (const { rows } of sharedPrInbox().snapshot(projectId).groups) {
    const row = rows.find((each) => each.number === number && each.repo.toLowerCase() === repo.toLowerCase())
    if (row !== undefined) return row
  }
  return null
}

/** gh as the PR inbox runs it: WORFY_GH (a stand-in in tests) with the app's own environment, else `gh` with the login shell's. */
function appGh(): GhRunner {
  const stub = process.env.WORFY_GH
  return ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env })
}

/** The folders of the Project's repositories: those of its layout, or its root for a Project of one repository. */
async function repoFolders(root: string): Promise<string[]> {
  const layout = await projectLayouts().get(root)
  return layout.repos.length > 0 ? layout.repos.map((repo) => repo.path) : [root]
}

let shared: PrSearch | undefined

/** The app's search: gh of appGh, the account of the Project's Profile, the rows and the pause of the app's PR inbox. */
export function sharedPrSearch(): PrSearch {
  shared ??= new PrSearch({
    run: appGh(),
    account: async (root) => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account,
    repos: async (root) => remoteRepos(await repoFolders(root)),
    inboxRow,
    rates: sharedPrInbox(),
  })
  return shared
}

export default prSearchHandlers(sharedPrSearch) satisfies HandlerModule
