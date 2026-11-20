// Handlers of the `prReview` domain (src/shared/ipc/pr-review.ts, worfy-pr-review ticket 07): the draft of a review of
// someone else's PR on this machine (src/main/github/pr-review-draft.ts), and its Agent review (ticket 08,
// src/main/github/pr-review-agent.ts). Every channel is `local`, so the link adapter refuses them to a Linked machine
// before any handler here runs. Nothing here reaches GitHub.
import { app } from 'electron'
import { prReviewAgentReview, prReviewChanged, prReviewDeleteComment, prReviewDiscard, prReviewDraft, prReviewDrafts, prReviewSaveComment, prReviewSetViewed, prReviewStopAgent } from '../../shared/ipc/pr-review'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import { sharedRegistry } from '../agent/app-registry'
import { toEveryWindow } from '../broadcast'
import { PrReviewAgent } from '../github/pr-review-agent'
import { PrReviewDrafts } from '../github/pr-review-draft'
import { harnessScriptEnv } from '../harness/script-env'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readProfileFolder } from '../workflow/profile'
import { defineHandler, emit, type HandlerModule } from './index'

/** The review drafts of a Project's PRs, by the Project's id. */
export interface PrReviewDraftsAccess {
  drafts: () => Pick<PrReviewDrafts, 'draft' | 'saveComment' | 'deleteComment' | 'setViewed' | 'discard' | 'list'>
  /** The Project's root; throws for an unknown id. */
  root: (projectId: string) => string
  /** Agent review; absent — its channels are refused. */
  agent?: () => Pick<PrReviewAgent, 'start' | 'stop'>
}

/** The handlers over the drafts; tests pass their own. */
export function prReviewHandlers(access: PrReviewDraftsAccess = sharedAccess): HandlerModule {
  return [
    defineHandler(prReviewDraft, ({ projectId, repo, number }) => access.drafts().draft(access.root(projectId), repo, number)),
    defineHandler(prReviewSaveComment, ({ projectId, repo, number, head, ref, comment, anchor }) => access.drafts().saveComment(access.root(projectId), repo, number, { head, ref, comment, anchor })),
    defineHandler(prReviewDeleteComment, ({ projectId, repo, number, ref }) => access.drafts().deleteComment(access.root(projectId), repo, number, ref)),
    defineHandler(prReviewSetViewed, ({ projectId, repo, number, head, path, blob }) => access.drafts().setViewed(access.root(projectId), repo, number, head, path, blob)),
    defineHandler(prReviewDiscard, ({ projectId, repo, number }) => access.drafts().discard(access.root(projectId), repo, number)),
    defineHandler(prReviewDrafts, ({ projectId }) => access.drafts().list(access.root(projectId))),
    defineHandler(prReviewAgentReview, ({ projectId, repo, number, head, fill }) => agentOf(access).start({ projectId, root: access.root(projectId), repo, number, head, fill })),
    defineHandler(prReviewStopAgent, ({ projectId, repo, number }) => agentOf(access).stop({ projectId, root: access.root(projectId), repo, number })),
  ]
}

function agentOf(access: PrReviewDraftsAccess): Pick<PrReviewAgent, 'start' | 'stop'> {
  if (access.agent === undefined) throw new Error('Agent review is not available here')
  return access.agent()
}

let shared: PrReviewDrafts | undefined
let sharedAgent: PrReviewAgent | undefined

/** The app's drafts: the Profile folder from bin/profile; what waits for a write is written when worfy quits. */
export function sharedPrReviewDrafts(): PrReviewDrafts {
  if (shared !== undefined) return shared
  const drafts = new PrReviewDrafts({
    // The reason for no folder goes to the view, not to the log on each look.
    profileDir: async (root) => readProfileFolder({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined }),
  })
  app.on('will-quit', () => drafts.flushSync())
  shared = drafts
  return drafts
}

/** The app's Agent review: Session Nodes of the app, its live Sessions, `prReview.changed` to every window. */
export function sharedPrReviewAgent(): PrReviewAgent {
  if (sharedAgent !== undefined) return sharedAgent
  const agent = new PrReviewAgent({
    drafts: sharedPrReviewDrafts(),
    profileDir: async (root) => readProfileFolder({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined }),
    sessions: { create: (projectId, near, vendor) => sharedNodeSessions().create(projectId, near, vendor) },
    registry: { get: (sessionId) => sharedRegistry().get(sessionId) },
    changed: (input) => toEveryWindow((client) => emit(client, prReviewChanged, input)),
  })
  app.on('will-quit', () => void agent.closeAll())
  sharedAgent = agent
  return agent
}

const sharedAccess: PrReviewDraftsAccess = { drafts: sharedPrReviewDrafts, root: (projectId) => projectStore().get(projectId).path, agent: sharedPrReviewAgent }

export default prReviewHandlers() satisfies HandlerModule
