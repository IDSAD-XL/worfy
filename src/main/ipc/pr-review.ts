// Handlers of the `prReview` domain (src/shared/ipc/pr-review.ts, worfy-pr-review ticket 07): the draft of a review of
// someone else's PR on this machine (src/main/github/pr-review-draft.ts), and its Agent review (ticket 08,
// src/main/github/pr-review-agent.ts). Every channel is `local`, so the link adapter refuses them to a Linked machine
// before any handler here runs. Only Start review (ticket 09) reads GitHub — once per PR, the files the account marked
// Viewed there, a GraphQL query through gh as the Project's account. Submit review (ticket 11, ADR-0112,
// src/main/github/pr-review-submit.ts) is the one write: one POST of the review on the person's click.
import { join } from 'node:path'
import { app } from 'electron'
import {
  prReviewAgentReview,
  prReviewChanged,
  prReviewCheck,
  prReviewDeleteComment,
  prReviewDiscard,
  prReviewDraft,
  prReviewDrafts,
  prReviewSaveComment,
  prReviewSetViewed,
  prReviewStart,
  prReviewStopAgent,
  prReviewSubmit,
} from '../../shared/ipc/pr-review'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import { sharedRegistry } from '../agent/app-registry'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import type { PrInbox } from '../github/inbox'
import { PrReviewAgent } from '../github/pr-review-agent'
import { appGithubHealth } from '../github/github-health'
import { PrReviewDrafts, viewedOnGithub, type GhCall } from '../github/pr-review-draft'
import { PrReviewSubmitter, submitLintArgs } from '../github/pr-review-submit'
import { accountAuth, ghRunner, type GhRunner } from '../github/prs'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import { harnessScriptEnv } from '../harness/script-env'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { HARNESS_SCRIPT_TIMEOUT_MS, readGithubAccount, readProfileFolder, runHarnessScript } from '../workflow/profile'
import { defineHandler, emit, type HandlerModule } from './index'
import { sharedPrInbox } from './pr-inbox'

/** The review drafts of a Project's PRs, by the Project's id. */
export interface PrReviewDraftsAccess {
  drafts: () => Pick<PrReviewDrafts, 'draft' | 'saveComment' | 'deleteComment' | 'setViewed' | 'discard' | 'list' | 'start'>
  /** The Project's root; throws for an unknown id. */
  root: (projectId: string) => string
  /** gh as the Project's account, for the files Viewed on github.com at Start review; absent — none are read. */
  github?: (projectId: string) => GhCall
  /** Agent review; absent — its channels are refused. */
  agent?: () => Pick<PrReviewAgent, 'start' | 'stop'>
  /** Submit review and the check of its dialog; absent — they are refused. */
  submitter?: () => Pick<PrReviewSubmitter, 'check' | 'submit'>
  /** The PR inbox, which reads a PR again once GitHub has its review (the approvals chip of its row); absent — none. */
  inbox?: () => Pick<PrInbox, 'refresh'>
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
    defineHandler(prReviewStart, ({ projectId, repo, number, head, files }) => {
      const github = access.github?.(projectId)
      return access.drafts().start(access.root(projectId), repo, number, { head, files, viewed: github === undefined ? null : () => viewedOnGithub(github, repo, number) })
    }),
    defineHandler(prReviewAgentReview, ({ projectId, repo, number, head, fill }) => agentOf(access).start({ projectId, root: access.root(projectId), repo, number, head, fill })),
    defineHandler(prReviewStopAgent, ({ projectId, repo, number }) => agentOf(access).stop({ projectId, root: access.root(projectId), repo, number })),
    defineHandler(prReviewCheck, ({ projectId, repo, number, event, body, comments }) => submitterOf(access).check(access.root(projectId), repo, number, { event, body, comments })),
    defineHandler(prReviewSubmit, async ({ projectId, repo, number, event, body, comments, commit, head }) => {
      const answer = await submitterOf(access).submit(access.root(projectId), repo, number, { event, body, comments, commit, head })
      // GitHub has the review: the PR inbox reads the PR now, not at its next turn, so its approvals chip counts it.
      if (answer.outcome === 'submitted' || answer.outcome === 'already-submitted')
        void access
          .inbox?.()
          .refresh(repo, number)
          .catch((error: unknown) => console.warn('[pr-review] reading the PR again after Submit failed', error))
      return answer
    }),
  ]
}

function submitterOf(access: PrReviewDraftsAccess): Pick<PrReviewSubmitter, 'check' | 'submit'> {
  if (access.submitter === undefined) throw new Error('Submit review is not available here')
  return access.submitter()
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
  // One listener for both: the watches of an Agent review end, and what waits is written.
  app.on('will-quit', () => {
    void sharedAgent?.closeAll()
    drafts.flushSync()
  })
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
  sharedAgent = agent
  return agent
}

let sharedGithub: ((projectId: string) => GhCall) | undefined
let sharedSubmitter: PrReviewSubmitter | undefined

/** gh as the PR inbox runs it: WORFY_GH (a stand-in in tests) with the app's environment, else `gh` with the login shell's. */
function appGh(): GhRunner {
  const stub = process.env.WORFY_GH
  return ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env })
}

/** The Project's GitHub account (`github.account`), read again on each Submit; null when the Profile names none. */
async function projectAccount(root: string): Promise<string | null> {
  return (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account
}

/**
 * The app's Submit review: gh of appGh as the account the Project's Profile names (none: nothing is posted), the
 * drafts of the app, review-draft-lint of the Harness on the machine, started as every Harness script is.
 */
export function sharedPrReviewSubmitter(): PrReviewSubmitter {
  sharedSubmitter ??= new PrReviewSubmitter({
    run: appGh(),
    account: projectAccount,
    drafts: sharedPrReviewDrafts(),
    health: appGithubHealth('Submit review'),
    profileDir: async (root) => readProfileFolder({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined }),
    lint: async (draft, root, rules) => {
      const harness = locateHarness(harnessHomes(claudeHome()))
      const env = scriptEnv(harness, await harnessScriptEnv())
      return runHarnessScript(join(harness.binDir, 'review-draft-lint'), submitLintArgs(root, rules), env, { stdin: draft, timeoutMs: HARNESS_SCRIPT_TIMEOUT_MS })
    },
  })
  return sharedSubmitter
}

/**
 * gh as the PR inbox runs it — WORFY_GH (a stand-in in tests) with the app's environment, else `gh` with the login
 * shell's — as the account the Project's Profile names (accountAuth), made on first use.
 */
function appGithub(projectId: string): GhCall {
  if (sharedGithub === undefined) {
    const run = appGh()
    const auth = accountAuth({ account: async (root) => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account, run })
    sharedGithub = (id) => {
      const root = projectStore().get(id).path
      return async (args) => run(args, root, await auth(root))
    }
  }
  return sharedGithub(projectId)
}

const sharedAccess: PrReviewDraftsAccess = { drafts: sharedPrReviewDrafts, root: (projectId) => projectStore().get(projectId).path, github: appGithub, agent: sharedPrReviewAgent, submitter: sharedPrReviewSubmitter, inbox: sharedPrInbox }

export default prReviewHandlers() satisfies HandlerModule
