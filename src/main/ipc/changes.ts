// Handlers of the `changes` domain (src/shared/ipc/changes.ts): the diff of a Ticket, read from git on this
// Machine (worfy-changes-view ticket 02; ADR-0110). Each call finds the Project's repositories and the facts of its
// Profile in the layout main already keeps (projectLayouts of src/main/workflow/folder.ts, no second `bin/profile`),
// the Ticket's subject in each repository (src/main/changes/subjects.ts), and reads the scope
// (src/main/changes/scopes.ts). Reading only: every git command goes through src/main/changes/git.ts. The list «To» of
// the comments on lines (`changes.targets`, ticket 05) reads the Layout, the Bindings and the live Sessions
// (src/main/changes/targets.ts).
//
// A pull request (worfy-pr-review ticket 06; ADR-0110, Amendment): read with the same git when its repository is one of
// the Project's (the `origin` of a checkout) and both its commits are there (`cat-file -e`), else from GitHub through
// src/main/changes/github.ts — GETs of `gh api` as the Project's account, kept in memory by head. Never a fetch.
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { changesCommits, changesFile, changesList, changesScopes, changesTargets } from '../../shared/ipc/changes'
import type { ChangesPrRef, ChangesScope, ChangesSubjectRef } from '../../shared/changes/types'
import { gitProbe } from '../changes/base'
import type { ChangesGit } from '../changes/git'
import { PrDiffs, prFileDiff, type GhGet } from '../changes/github'
import { compareBranches, fileDiff, listChanges, listCommits, resolveBase, scopeKinds, type ChangesContext, type RepoBase } from '../changes/scopes'
import { ticketSubjects, type RepoSubject, type TicketSubjectRef } from '../changes/subjects'
import { changesTargets as listTargets, type TargetsDeps } from '../changes/targets'
import type { ProjectLayout } from '../workflow/folder'
import { defineHandler, type HandlerModule } from './index'

/** What the handlers need of the app: a Project's root and layout, and the reading git. */
export interface ChangesDeps {
  /** The Project's root and its layout; rejects for a Project the store does not know. */
  project(projectId: string): Promise<{ root: string; layout: ProjectLayout }>
  git: ChangesGit
  /** What the list «To» reads, made on first use; without it `changes.targets` is refused. */
  targets?(): Promise<TargetsDeps>
  /**
   * `gh api <path>` in the Project as its GitHub account, for a pull request read from GitHub; the account is asked
   * only when a path is read. Without it such a PR is refused.
   */
  gh?(projectId: string): GhGet
  /** The repositories on GitHub of a checkout, `owner/name` of its `origin` (remoteRepos by default). */
  remotes?(folder: string): Promise<string[]>
}

/** The worktree's folder from the checkout, with `/`; absolute when it lies outside; empty for a branch or the checkout itself. */
export function worktreeOf(subject: Pick<RepoSubject, 'kind' | 'checkout' | 'cwd'>): string {
  if (subject.kind !== 'worktree') return ''
  const rel = relative(resolve(subject.checkout), resolve(subject.cwd))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return subject.cwd.split(sep).join('/')
  return rel.split(sep).join('/')
}

/** The Tickets root from `checkout`, with `/`, in Full mode when it lies in that checkout; else null. */
export function workflowPrefixOf(layout: ProjectLayout, checkout: string): string | null {
  if (layout.mode !== 'full' || resolve(checkout) !== resolve(layout.root)) return null
  const rel = relative(resolve(layout.root), resolve(layout.ticketsRoot))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/** The checkouts of the Project: those of its layout, or its root for a Project of one repository. */
async function checkoutsOf(deps: ChangesDeps, projectId: string): Promise<{ layout: ProjectLayout; checkouts: readonly { name: string; path: string }[] }> {
  const { root, layout } = await deps.project(projectId)
  return { layout, checkouts: layout.repos.length > 0 ? layout.repos : [{ name: basename(root), path: root }] }
}

/** The contexts of the Ticket's repositories, in the order of the Profile. */
async function contexts(deps: ChangesDeps, projectId: string, ticket: TicketSubjectRef): Promise<ChangesContext[]> {
  const { layout, checkouts } = await checkoutsOf(deps, projectId)
  const subjects = await ticketSubjects(checkouts, ticket, deps.git)
  return subjects.map((subject) => ({
    subject,
    git: deps.git,
    facts: { mainBranch: layout.mainBranch ?? null, finish: layout.finish ?? null },
    // In a worktree the Tickets root lies at the same place from its top folder as in the checkout.
    workflowPrefix: workflowPrefixOf(layout, subject.checkout),
  }))
}

/** The context of the repository named `repo`; throws when the Ticket has nothing there. */
async function contextOf(deps: ChangesDeps, projectId: string, ticket: TicketSubjectRef, repo: string): Promise<ChangesContext> {
  const found = (await contexts(deps, projectId, ticket)).find((context) => context.subject.repo === repo)
  if (!found) throw new Error(`Ticket ${ticket.epic}/${String(ticket.num).padStart(2, '0')} has no worktree or branch in ${repo}`)
  return found
}

/** Where a pull request is read: the Project's git, or GitHub. */
type PrSource = { kind: 'git'; context: ChangesContext } | { kind: 'github'; get: GhGet }

/**
 * The checkout whose `origin` is the PR's repository and which has both its commits: the PR is read there, as a branch
 * checked out nowhere whose base is the PR's. Else GitHub: the commits are never fetched.
 */
async function prSource(deps: ChangesDeps, projectId: string, pr: ChangesPrRef): Promise<PrSource> {
  const { layout, checkouts } = await checkoutsOf(deps, projectId)
  const remotes = deps.remotes ?? (async (folder: string) => (await import('../github/inbox')).remoteRepos([folder]))
  for (const { path } of checkouts) {
    const slugs = await remotes(path).catch((): string[] => [])
    if (!slugs.some((slug) => slug.toLowerCase() === pr.repo.toLowerCase())) continue
    const probe = gitProbe(path, deps.git)
    if (!(await probe.exists(pr.headOid)) || !(await probe.exists(pr.baseOid))) continue
    const subject: RepoSubject = { repo: pr.repo, checkout: path, cwd: path, kind: 'pr', branch: `#${pr.number}`, head: pr.headOid, headSha: pr.headOid }
    return { kind: 'git', context: { subject, git: deps.git, facts: {}, workflowPrefix: workflowPrefixOf(layout, path), base: pr.baseOid } }
  }
  if (deps.gh === undefined) throw new Error(`This build cannot read ${pr.repo}#${pr.number} from GitHub`)
  return { kind: 'github', get: deps.gh(projectId) }
}

/** The base of a PR read from GitHub: its base commit; `pulls/{n}/files` does not name the merge-base. */
const githubBase = (pr: ChangesPrRef): RepoBase => ({ ref: pr.baseOid, from: 'pr', mergeBase: '' })

/** The repository a request names is the PR's, in any case of its letters: GitHub's names are not case-sensitive. */
const isPrRepo = (pr: ChangesPrRef, repo: string): boolean => repo.toLowerCase() === pr.repo.toLowerCase()

function samePrRepo(pr: ChangesPrRef, repo: string): void {
  if (!isPrRepo(pr, repo)) throw new Error(`Pull request ${pr.repo}#${pr.number} has nothing in ${repo}`)
}

const SHA = /^[0-9a-f]{7,64}$/u

/** The repositories a scope reads: `commit` and `compare` only the one they name. */
const scoped = (all: ChangesContext[], scope: ChangesScope): ChangesContext[] => (scope.kind === 'commit' || scope.kind === 'compare' ? all.filter((context) => context.subject.repo === scope.repo) : all)

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The Ticket of a subject as src/main/changes/subjects.ts takes it. */
const ticketOf = ({ epic, num, branch, repos }: Extract<ChangesSubjectRef, { kind: 'ticket' }>): TicketSubjectRef => ({ epic, num, branch, repos })

/** One repository's entry of `changes.scopes`, read with git. */
async function gitScopes(context: ChangesContext) {
  const base = await resolveBase(context).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error: message(error) }),
  )
  const { subject } = context
  return {
    repo: subject.repo,
    kind: subject.kind,
    branch: subject.branch,
    headSha: subject.headSha,
    base: base.value,
    scopes: scopeKinds(subject),
    // A pull request compares only against a commit (Since my review), never against a branch.
    branches: subject.kind === 'pr' ? [] : await compareBranches(context),
    error: base.error,
    checkout: subject.checkout,
    worktree: worktreeOf(subject),
    source: 'git' as const,
  }
}

export function changesHandlers(deps: ChangesDeps): HandlerModule {
  // The reads of PRs from GitHub, kept by head while these handlers live.
  const diffs = new PrDiffs()

  /** `changes.list` of a PR: never throws, a failure is the answer's `error`, as a Ticket's. */
  const prList = async (source: PrSource, pr: ChangesPrRef, scope: ChangesScope, hideWhitespace: boolean | undefined) => {
    if (scope.kind === 'compare' && !SHA.test(scope.ref)) {
      return { repo: pr.repo, kind: 'pr' as const, branch: `#${pr.number}`, scope: scope.kind, base: null, headSha: pr.headOid, workTree: false, files: [], additions: 0, deletions: 0, error: `Since my review takes a commit of ${pr.repo}, not ${scope.ref}`, source: source.kind }
    }
    if (source.kind === 'git') return { ...(await listChanges(source.context, scope, { hideWhitespace })), source: 'git' as const }
    const answer = { repo: pr.repo, kind: 'pr' as const, branch: `#${pr.number}`, scope: scope.kind, base: scope.kind === 'all' ? githubBase(pr) : null, headSha: pr.headOid, workTree: false, source: 'github' as const }
    try {
      const { files, truncatedAt } = await diffs.files(source.get, pr, scope)
      const changed = files.map((each) => each.file)
      const sum = (pick: (file: (typeof changed)[number]) => number | null): number => changed.reduce((total, file) => total + (pick(file) ?? 0), 0)
      return { ...answer, files: changed, additions: sum((file) => file.additions), deletions: sum((file) => file.deletions), error: null, truncatedAt }
    } catch (error) {
      return { ...answer, files: [], additions: 0, deletions: 0, error: message(error), truncatedAt: null }
    }
  }

  return [
    defineHandler(changesScopes, async ({ projectId, subject }) => {
      if (subject.kind === 'pr') {
        const source = await prSource(deps, projectId, subject)
        if (source.kind === 'git') return { repos: [await gitScopes(source.context)] }
        return { repos: [{ repo: subject.repo, kind: 'pr' as const, branch: `#${subject.number}`, headSha: subject.headOid, base: githubBase(subject), scopes: ['all' as const, 'commit' as const, 'compare' as const], branches: [], error: null, source: 'github' as const }] }
      }
      return { repos: await Promise.all((await contexts(deps, projectId, ticketOf(subject))).map(gitScopes)) }
    }),
    defineHandler(changesList, async ({ projectId, subject, scope, hideWhitespace }) => {
      if (subject.kind === 'pr') {
        if ((scope.kind === 'commit' || scope.kind === 'compare') && !isPrRepo(subject, scope.repo)) return { repos: [] }
        return { repos: [await prList(await prSource(deps, projectId, subject), subject, scope, hideWhitespace)] }
      }
      const found = scoped(await contexts(deps, projectId, ticketOf(subject)), scope)
      return { repos: await Promise.all(found.map(async (context) => ({ ...(await listChanges(context, scope, { hideWhitespace })), source: 'git' as const }))) }
    }),
    defineHandler(changesFile, async ({ projectId, subject, repo, scope, path, oldPath, untracked, whole, expand, hideWhitespace }) => {
      if (subject.kind === 'pr') {
        samePrRepo(subject, repo)
        const source = await prSource(deps, projectId, subject)
        // A pull request has no file outside git: `untracked` has no meaning for it.
        if (source.kind === 'git') return { file: await fileDiff(source.context, scope, { path, oldPath }, { whole, expand, hideWhitespace }) }
        const entry = (await diffs.files(source.get, subject, scope)).files.find((each) => each.file.path === path)
        if (entry === undefined) throw new Error(`${path} has no changes in this scope`)
        return { file: prFileDiff(entry, { expand }) }
      }
      const context = await contextOf(deps, projectId, ticketOf(subject), repo)
      return { file: await fileDiff(context, scope, { path, oldPath, untracked }, { whole, expand, hideWhitespace }) }
    }),
    defineHandler(changesCommits, async ({ projectId, subject, repo }) => {
      if (subject.kind === 'pr') {
        samePrRepo(subject, repo)
        const source = await prSource(deps, projectId, subject)
        if (source.kind === 'git') return listCommits(source.context)
        return { base: githubBase(subject), commits: await diffs.commits(source.get, subject) }
      }
      return listCommits(await contextOf(deps, projectId, ticketOf(subject), repo))
    }),
    defineHandler(changesTargets, async ({ projectId, ticket }) => {
      if (deps.targets === undefined) throw new Error('This build cannot list the Sessions comments go to')
      return listTargets(await deps.targets(), projectId, ticket)
    }),
  ]
}

let shared: ChangesDeps | undefined

/**
 * The app's dependencies, made on first use: the Project store, the layouts main keeps, the reading git, and gh as the
 * PR inbox runs it — WORFY_GH (a stand-in in tests) with the app's environment, else `gh` with the login shell's — as
 * the account the Project's Profile names (accountAuth), asked only when a pull request is read from GitHub.
 */
async function appDeps(): Promise<ChangesDeps> {
  const [{ projectStore }, { projectLayouts }, { changesGit }, { accountAuth, ghRunner }, { agentEnv }, { harnessScriptEnv }, { claudeHome }, { readGithubAccount }] = await Promise.all([
    import('../projects/store'),
    import('../workflow/folder'),
    import('../changes/git'),
    import('../github/prs'),
    import('../agent/env'),
    import('../harness/script-env'),
    import('../storage/paths'),
    import('../workflow/profile'),
  ])
  if (shared !== undefined) return shared
  const stub = process.env.WORFY_GH
  const run = ghRunner(stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env })
  const auth = accountAuth({ account: async (root) => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account, run })
  shared = {
    project: async (projectId) => {
      const root = projectStore().get(projectId).path
      return { root, layout: await projectLayouts().get(root) }
    },
    git: changesGit,
    // `gh api <path>`: a GET, never with --method or a field (ADR-0110, Amendment).
    gh: (projectId) => async (path) => {
      const root = projectStore().get(projectId).path
      return run(['api', path], root, await auth(root))
    },
  }
  return shared
}

let sharedTargets: Promise<TargetsDeps> | undefined

/**
 * What the list «To» reads of the app, made on first use: the Layouts, the stored Bindings, the transcripts' times as
 * the actions on a PR read them (src/main/ipc/actions.ts), the live Session Nodes and Orchestrators, and Autopilot.
 */
function appTargets(): Promise<TargetsDeps> {
  sharedTargets ??= (async (): Promise<TargetsDeps> => {
    const [{ layoutStore }, { bindingStore }, { ClaudeHomeRegistry }, { claudeHome }, { projectStore }, { sharedNodeSessions }, { sharedOrchestrators }, { sharedAutopilot }] = await Promise.all([
      import('../layout/store'),
      import('../layout/bindings'),
      import('../claude-home/registry'),
      import('../storage/paths'),
      import('../projects/store'),
      import('../agent/app-node-sessions'),
      import('../agent/app-orchestrators'),
      import('./autopilot'),
    ])
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    const reported = (id: string | null | undefined): string | null => (typeof id === 'string' && id !== '' && !id.startsWith('pending-') ? id : null)
    return {
      nodes: (projectId) => layoutStore().get(projectId).layout.nodes,
      stored: (projectId) => bindingStore().get(projectId).bindings,
      lastAt: async (projectId, sessionIds) => {
        const wanted = new Set(sessionIds)
        // This Machine's own call (RegistryRoot), as the actions on a PR read the same times.
        const { history } = await claude.sessions({ path: projectStore().get(projectId).path, local: true })
        return new Map(history.flatMap((session) => (wanted.has(session.sessionId) && session.lastAt !== undefined && !Number.isNaN(Date.parse(session.lastAt)) ? [[session.sessionId, Date.parse(session.lastAt)] as const] : [])))
      },
      live: (projectId, nodeId) => reported(sharedOrchestrators().view(nodeId)?.sessionId) ?? reported(sharedNodeSessions().list(projectId).find((view) => view.nodeId === nodeId)?.sessionId),
      autopilot: (projectId) => sharedAutopilot().running(projectId),
    }
  })()
  return sharedTargets
}

/** The handlers over the app's dependencies; loading this module starts nothing. */
export default changesHandlers({
  project: async (projectId) => (await appDeps()).project(projectId),
  git: async (cwd, args, options) => (await appDeps()).git(cwd, args, options),
  targets: appTargets,
  gh: (projectId) => async (path) => (await appDeps()).gh!(projectId)(path),
}) satisfies HandlerModule
