// Handlers of the `changes` domain (src/shared/ipc/changes.ts): the diff of a Ticket, read from git on this
// Machine (worfy-changes-view ticket 02; ADR-0110). Each call finds the Project's repositories and the facts of its
// Profile in the layout main already keeps (projectLayouts of src/main/workflow/folder.ts, no second `bin/profile`),
// the Ticket's subject in each repository (src/main/changes/subjects.ts), and reads the scope
// (src/main/changes/scopes.ts). Reading only: every git command goes through src/main/changes/git.ts. The list «To» of
// the comments on lines (`changes.targets`, ticket 05) reads the Layout, the Bindings and the live Sessions
// (src/main/changes/targets.ts).
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { changesCommits, changesFile, changesList, changesScopes, changesTargets } from '../../shared/ipc/changes'
import type { ChangesScope } from '../../shared/changes/types'
import type { ChangesGit } from '../changes/git'
import { compareBranches, fileDiff, listChanges, listCommits, resolveBase, scopeKinds, type ChangesContext } from '../changes/scopes'
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

/** The contexts of the Ticket's repositories, in the order of the Profile. */
async function contexts(deps: ChangesDeps, projectId: string, ticket: TicketSubjectRef): Promise<ChangesContext[]> {
  const { root, layout } = await deps.project(projectId)
  const checkouts = layout.repos.length > 0 ? layout.repos : [{ name: basename(root), path: root }]
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

/** The repositories a scope reads: `commit` and `compare` only the one they name. */
const scoped = (all: ChangesContext[], scope: ChangesScope): ChangesContext[] => (scope.kind === 'commit' || scope.kind === 'compare' ? all.filter((context) => context.subject.repo === scope.repo) : all)

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function changesHandlers(deps: ChangesDeps): HandlerModule {
  return [
    defineHandler(changesScopes, async ({ projectId, ticket }) => {
      const found = await contexts(deps, projectId, ticket)
      const repos = await Promise.all(
        found.map(async (context) => {
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
            branches: await compareBranches(context),
            error: base.error,
            checkout: subject.checkout,
            worktree: worktreeOf(subject),
          }
        }),
      )
      return { repos }
    }),
    defineHandler(changesList, async ({ projectId, ticket, scope, hideWhitespace }) => {
      const found = scoped(await contexts(deps, projectId, ticket), scope)
      return { repos: await Promise.all(found.map((context) => listChanges(context, scope, { hideWhitespace }))) }
    }),
    defineHandler(changesFile, async ({ projectId, ticket, repo, scope, path, oldPath, untracked, whole, expand, hideWhitespace }) => {
      const context = await contextOf(deps, projectId, ticket, repo)
      return { file: await fileDiff(context, scope, { path, oldPath, untracked }, { whole, expand, hideWhitespace }) }
    }),
    defineHandler(changesCommits, async ({ projectId, ticket, repo }) => listCommits(await contextOf(deps, projectId, ticket, repo))),
    defineHandler(changesTargets, async ({ projectId, ticket }) => {
      if (deps.targets === undefined) throw new Error('This build cannot list the Sessions comments go to')
      return listTargets(await deps.targets(), projectId, ticket)
    }),
  ]
}

let shared: ChangesDeps | undefined

/** The app's dependencies, made on first use: the Project store, the layouts main keeps, the reading git. */
async function appDeps(): Promise<ChangesDeps> {
  const [{ projectStore }, { projectLayouts }, { changesGit }] = await Promise.all([import('../projects/store'), import('../workflow/folder'), import('../changes/git')])
  shared ??= {
    project: async (projectId) => {
      const root = projectStore().get(projectId).path
      return { root, layout: await projectLayouts().get(root) }
    },
    git: changesGit,
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
}) satisfies HandlerModule
