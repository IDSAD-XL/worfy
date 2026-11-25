// The MCP server `worfy-app` (worfy-assistant ticket 09; ADR-0114, points 3 and 5; spec, the MCP server `worfy-app`):
// the one server of the Assistant's Session (ticket 10), built like worfy-canvas and worfy-mind-map — zod shapes
// (src/shared/assistant/app-tools.ts), the arguments parsed again here, a refusal is a result with `isError`, never an
// exception, and the server is described in worfy's terms (src/main/vendors/mcp.ts).
//
// - Bound to the app, not to a Session's cwd: the Assistant's Session runs in worfy's data folder, outside every
//   Project, where worfy-canvas and worfy-mind-map are not given (worfyAppForSession takes no cwd).
// - Reading: Projects and machines, the items the duties show, the workflow of a Project, the threads of a PR, the tail
//   of a Session, the Autopilot runs, Limits, and the feature pages of the build (ticket 17: features_search and
//   features_read, src/main/assistant/help/feature-pages.ts) in the language of the Guide, which the Assistant speaks.
//   Reading changes nothing but the duties' «shown» counters.
// - Proposals: create, update, remove (ProposalBook); Prepare keeps and answers the exact text of the future Session,
//   which only the user's click starts (boundary 3). A Prepare names a Project of this Machine only (boundary 5).
// - Actions: only APP_ACTIONS, only when the mode of that action in the item's duty is `self` or `pre-approved`
//   (ticket 07), and only through main's own functions, which check for themselves: the closed list of ticket 08
//   (ClosedListSeam: the action and the item, `by: 'assistant'`, no text — main sets it and writes the journal line),
//   the launcher's pr-follow (refused while Autopilot runs), autopilot_start's starter (it only opens the Start
//   Autopilot dialog); those two are journal lines here (`journal`). Each action that reached main is a journal line
//   with the item that caused it (boundary 6).
// - Outside text — what worfy did not write: an item's text, a PR comment, a Ticket title, a Session's line, an
//   Autopilot journal's details — is never a bare string of an answer: it is an OutsideText block with its source and
//   author (boundary 2), and the instructions tell the agent it is data.
// - No secrets: every string of every answer passes redactSecrets (src/shared/terminal-ai/redact.ts), and so does the
//   text of a proposal before it is kept, so the kept text and the answered one are the same.
// - Nothing goes out: no tool replies to a PR, posts or sends (boundary 4).
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AttentionItem } from '../../shared/assistant/attention'
import { APP_TOOL_NAMES, appToolDescriptions, appToolShapes, parseAppToolArgs, WORFY_APP_SERVER_NAME, type AppAction, type AppToolArgs, type AppToolName } from '../../shared/assistant/app-tools'
import type { DutyLook } from '../../shared/assistant/duties'
import type { JournalEvent } from '../../shared/autopilot/journal'
import type { LimitsState } from '../../shared/agent/limits'
import type { PrInboxComment, PrInboxSnapshot } from '../../shared/ipc/pr-inbox'
import type { PrFollowAction } from '../../shared/projects/action-templates'
import { redactSecrets } from '../../shared/terminal-ai/redact'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { PrFollowResult } from '../actions/launch'
import type { AssistantProposal } from '../../shared/assistant/proposals'
import type { ProposalBook } from '../assistant/proposals/book'
import { FeaturePageMissing, readFeaturePage, searchFeaturePages, type FeaturePageFile } from '../assistant/help/feature-pages'
import type { GuideLanguage } from '../../shared/settings/app-settings'
import type { AutopilotStarter } from '../autopilot/chat-confirm'
import { claudeMcpServer, type ClaudeMcpServer } from '../vendors/claude/mcp'
import type { McpServer, McpToolResult } from '../vendors/mcp'
import instructions from './agent-instructions-app.md?raw'

/** Text worfy did not write, given to the agent as data: where it came from and who wrote it (null: not known). */
export interface OutsideText {
  kind: 'outside-text'
  source: string
  author: string | null
  text: string
}

export const outsideText = (text: string, source: string, author: string | null = null): OutsideText => ({ kind: 'outside-text', source, author, text })

/** A machine and its Projects; only this Machine's may be acted on. */
export interface AppMachine {
  name: string
  thisMachine: boolean
  projects: readonly { id: string; name: string }[]
}

/** One line of a Session's tail. */
export interface TailLine {
  /** ISO time; null when the transcript does not say. */
  at: string | null
  who: 'user' | 'agent'
  text: string
}

/** A request to main's closed list (ticket 08, ActionRequest of src/shared/assistant/actions.ts): no text in it. */
export interface ClosedListRequest {
  action: string
  itemId: string
  by: 'assistant'
}

/**
 * What main's closed list answers (ticket 08, ActionResult): done, with the line of the Assistant's journal it wrote
 * and the text it sent, or refused with its reason (`mode`, `busy`, `limits`…); the line is written either way.
 */
export type ClosedListResult = { ok: true; line: { text?: string | undefined } } | { ok: false; reason: string; line: { text?: string | undefined } }

/**
 * The seam of the closed list of actions in main (ticket 08: `appClosedList()`, whose act() has this shape). It checks
 * the duty's mode and the Session again, sends the text main sets and writes the journal line itself. `appClosedList()`
 * answers null before the closed list starts: the wiring that takes it guards that null and refuses with a reason.
 */
export interface ClosedListSeam {
  act(request: ClosedListRequest): ClosedListResult | Promise<ClosedListResult>
}

/** The actions done by main's own functions outside the closed list. */
type MainAction = Exclude<AppAction, 'wake-orchestrator' | 'continue-session'>

/** A line of the Assistant's journal: an action that reached main, the item that caused it, and what came of it. */
export interface AssistantActionEntry {
  at: number
  action: MainAction
  item: AttentionItem
  outcome: 'done' | 'refused'
  text: string
}

/** What the server reads and calls; the app's parts in the app (appWorfyAppDeps), stand-ins in tests. */
export interface WorfyAppDeps {
  now(): number
  /** This Machine and the Linked machine, with their Projects. */
  machines(): Promise<readonly AppMachine[]>
  /** This Machine's Projects: the only ones an action or a Prepare may name. */
  projects(): readonly { id: string; name: string }[]
  /** The items of the attention core, every scope of this Machine. */
  items(): readonly AttentionItem[]
  duties: { look(items: readonly AttentionItem[]): DutyLook }
  workflow(projectId: string): Promise<Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>>
  /** The PR inbox of a Project; null when it has none. */
  prInbox(projectId: string): PrInboxSnapshot | null
  sessionTail(sessionId: string, lines: number): Promise<readonly TailLine[]>
  /** The newest runs of a Project, newest first, each its journal's events. */
  autopilotRuns(projectId: string, runs: number): Promise<readonly (readonly JournalEvent[])[]>
  limits(): LimitsState
  proposals: Pick<ProposalBook, 'list' | 'create' | 'update' | 'remove'>
  closedList: ClosedListSeam
  /** The launcher's «Fix checks», «Resolve conflicts», «Address comments» (ActionLauncher.prFollow). */
  prFollow(projectId: string, repo: string, pr: number, action: PrFollowAction): Promise<PrFollowResult>
  /** autopilot_start's starter: asks the person in the Start Autopilot dialog first. */
  autopilotStart: AutopilotStarter
  /** The Assistant's own Session: the one autopilot_start's dialog names. */
  sessionId(): string | null
  /** Writes a line of the Assistant's journal for pr-follow and autopilot-start; the closed list writes its own. */
  journal(entry: AssistantActionEntry): void
  /** The feature pages of the build, English and Russian (ticket 17). */
  featurePages(): Promise<readonly FeaturePageFile[]>
  /** The language of the Guide: the person's choice, else the system's. The Assistant speaks it. */
  guideLanguage(): GuideLanguage
  /** The build version `<semver>+<SHA>`, whose commit a page's link names; null when not known. */
  buildVersion(): string | null
}

/** A refusal the agent reads; anything else thrown is answered the same way. */
class ToolError extends Error {}

const DEFAULT_TAIL_LINES = 20
/** The pages features_search answers without a limit. */
const DEFAULT_FEATURE_HITS = 5
/** The most events of one run an answer carries: the newest. */
const RUN_EVENTS_MAX = 40
/** The keys every journal event has, answered beside its details. */
const RUN_KEYS: ReadonlySet<string> = new Set(['at', 'kind', 'run', 'project', 'epic'])

const iso = (ms: number): string => new Date(ms).toISOString()

/** Every string of `value` with its secrets hidden; keys and shape as they were. */
function redacted(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redacted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redacted(inner)]))
  return value
}

const text = (value: unknown, isError = false): McpToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? redactSecrets(value) : JSON.stringify(redacted(value)) }], ...(isError ? { isError: true } : {}) })

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/**
 * The id the agent knows an item by: worfy's own, made from the core's. The core's id holds its subject's id, and the
 * subject of a message of Slack or Jira is the message's id as the Haiku check wrote it — free text (ticket 11). The
 * server finds the item again by making the id of each one (itemOfPublicId); main keeps the core's id.
 */
export const publicItemId = (id: string): string => `item-${digest(id)}`

/** A subject's id as the agent reads it: a message's id is a source's text, so worfy makes one of its own. */
const subjectId = (subject: AttentionItem['subject']): string => (subject.kind === 'message' ? `message-${digest(subject.id)}` : subject.id)

/** An item as the agent reads it: what the core and the duties say, the outside text in blocks. */
function itemView(item: AttentionItem, actions: DutyLook['shown'][number]['proposals']) {
  const message = item.message
  // A message of a source names its own source and author; the core's other items have no author it knows.
  const source = message?.source ?? item.source
  const author = message?.author ?? null
  const block = (text: string): OutsideText => outsideText(text, source, author)
  return {
    id: publicItemId(item.id),
    projectId: item.projectId,
    source: item.source,
    kind: item.kind,
    state: item.state,
    duty: item.duty,
    startedAt: iso(item.startedAt),
    lastAt: iso(item.lastAt ?? item.startedAt),
    events: item.events,
    subject: { kind: item.subject.kind, id: subjectId(item.subject), label: block(item.subject.label) },
    text: block(item.text),
    ...(message === undefined
      ? {}
      : {
          message: {
            at: message.at,
            url: block(message.url),
            concernsUser: message.concernsUser,
            urgent: message.urgent,
            project: message.project === null ? null : block(message.project),
            ticket: message.ticket === null ? null : block(message.ticket),
          },
        }),
    ...(item.pr === undefined ? {} : { pr: { repo: item.pr.repo, number: item.pr.number, title: outsideText(item.pr.title, 'github') } }),
    // An action's text may quote the item (`Open <label>`): a block too.
    actions: actions.map((each) => ({ action: each.action, mode: each.mode, text: block(each.text) })),
  }
}

const commentView = (comment: PrInboxComment) => ({ author: comment.author, at: comment.createdAt, url: comment.url, body: outsideText(comment.body, 'github', comment.author) })

/** `owner/name#number` of a PR item's subject. */
function prOf(item: AttentionItem): { repo: string; number: number } {
  const match = item.subject.kind === 'pr' ? /^(.+)#(\d+)$/u.exec(item.subject.id) : null
  if (match === null) throw new ToolError(`Item ${item.id} is not about a pull request: pr-follow takes a PR item`)
  return { repo: match[1]!, number: Number(match[2]) }
}

type Handlers = { [Name in AppToolName]: (args: AppToolArgs[Name]) => Promise<unknown> | unknown }

function handlers(deps: WorfyAppDeps): Handlers {
  const ownProject = (projectId: string, what: string): void => {
    if (!deps.projects().some((project) => project.id === projectId)) throw new ToolError(`${what}: ${projectId} is not a Project of this Machine. The other machine's Projects are read-only.`)
  }
  /** The core's id of the item the agent names by its id (publicItemId). */
  const itemOfPublicId = (id: string): string => {
    const found = deps.items().find((item) => publicItemId(item.id) === id)
    if (found === undefined) throw new ToolError(`No item ${id}: items_list lists them`)
    return found.id
  }
  /** A proposal as the agent reads it: its item by worfy's id. */
  const proposalView = (proposal: AssistantProposal): AssistantProposal => ({ ...proposal, item: proposal.item === null ? null : publicItemId(proposal.item) })
  /** The text a proposal keeps: its secrets hidden before it is kept, so what the user sees is what was answered. */
  const clean = <T extends { title?: string | undefined; why?: string | undefined; prepare?: { projectId: string; text: string } | null | undefined }>(draft: T): T => ({
    ...draft,
    ...(draft.title === undefined ? {} : { title: redactSecrets(draft.title) }),
    ...(draft.why === undefined ? {} : { why: redactSecrets(draft.why) }),
    ...(draft.prepare === undefined || draft.prepare === null ? {} : { prepare: { projectId: draft.prepare.projectId, text: redactSecrets(draft.prepare.text) } }),
  })
  const checkPrepare = (prepare: { projectId: string } | null | undefined): void => {
    if (prepare !== undefined && prepare !== null) ownProject(prepare.projectId, 'A Session is prepared only in a Project of this Machine')
  }

  /**
   * Runs pr-follow or autopilot-start through main's function; a refusal of main is journaled and answered as the
   * refusal. (The closed list journals its own actions.)
   */
  const act = async (args: AppToolArgs['action_run'] & { action: MainAction }, item: AttentionItem): Promise<string> => {
    const run = (): Promise<string> => {
      if (args.action === 'pr-follow') {
        if (args.follow === undefined) throw new ToolError('pr-follow needs follow: fixChecks, resolveConflicts or addressComments')
        const { repo, number } = prOf(item)
        return deps.prFollow(item.projectId!, repo, number, args.follow).then((result) => `${args.follow} on ${repo}#${number}: ${result.delivery === 'new' ? 'a new Session started' : `${result.delivery} to Session ${result.sessionId}`}`)
      }
      if (args.epic === undefined) throw new ToolError('autopilot-start needs epic: the Epic the dialog offers to run')
      return deps.autopilotStart({ projectId: item.projectId!, epic: args.epic, session: deps.sessionId() })
    }
    let done: string
    try {
      done = await run()
    } catch (error) {
      if (error instanceof ToolError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      deps.journal({ at: deps.now(), action: args.action, item, outcome: 'refused', text: reason })
      throw new ToolError(reason)
    }
    deps.journal({ at: deps.now(), action: args.action, item, outcome: 'done', text: done })
    return done
  }

  return {
    projects_list: async () => ({
      machines: (await deps.machines()).map((machine) => ({ name: machine.name, thisMachine: machine.thisMachine, readOnly: !machine.thisMachine, projects: machine.projects.map((project) => ({ id: project.id, name: project.name })) })),
    }),

    items_list: () => ({ items: deps.duties.look(deps.items()).shown.map((shown) => itemView(shown.item, shown.proposals)) }),

    workflow_read: async ({ projectId, epic }) => {
      const model = await deps.workflow(projectId)
      const tickets = model.tickets.filter((ticket) => (epic === undefined ? ticket.state !== 'done' : ticket.epic === epic))
      return {
        projectId,
        error: model.error === null ? null : outsideText(model.error.message, 'workflow'),
        epics: model.epics.filter((each) => epic === undefined || each.epic === epic).map((each) => ({ epic: each.epic, title: each.title === null ? null : outsideText(each.title, 'workflow') })),
        tickets: tickets.map((ticket) => ({
          epic: ticket.epic,
          num: ticket.num,
          title: outsideText(ticket.title, 'workflow'),
          state: ticket.state,
          pr: ticket.pr ?? null,
          blockedBy: ticket.blockedNums,
          blockedReason: ticket.blockedReason == null ? null : outsideText(ticket.blockedReason, 'workflow'),
          waits: ticket.waits == null ? null : outsideText(ticket.waits, 'workflow'),
        })),
      }
    },

    pr_threads_read: ({ projectId, repo, number }) => {
      const snapshot = deps.prInbox(projectId)
      if (snapshot === null) throw new ToolError(`Project ${projectId} has no PR inbox`)
      const row = snapshot.groups.flatMap((group) => group.rows).find((each) => each.repo.toLowerCase() === repo.toLowerCase() && each.number === number)
      if (row === undefined) throw new ToolError(`${repo}#${number} is not an open PR of the PR inbox of ${projectId}`)
      return {
        repo: row.repo,
        number: row.number,
        url: row.url,
        author: row.author,
        title: outsideText(row.title, 'github', row.author),
        // A path is the PR author's text too.
        threads: row.threads.map((thread) => ({ path: thread.path === null ? null : outsideText(thread.path, 'github', row.author), line: thread.line, resolved: thread.isResolved, outdated: thread.isOutdated, comments: thread.comments.map(commentView) })),
        comments: row.comments.map(commentView),
      }
    },

    session_tail_read: async ({ sessionId, lines }) => ({
      sessionId,
      lines: (await deps.sessionTail(sessionId, lines ?? DEFAULT_TAIL_LINES)).map((line) => ({ at: line.at, who: line.who, text: outsideText(line.text, 'session', `Session ${sessionId} · ${line.who}`) })),
    }),

    autopilot_runs_read: async ({ projectId, runs }) => ({
      runs: (await deps.autopilotRuns(projectId, runs ?? 1)).flatMap((events) => {
        const first = events[0]
        if (first === undefined) return []
        return [
          {
            run: first.run,
            epic: first.epic,
            startedAt: first.at,
            events: events.slice(-RUN_EVENTS_MAX).map((event) => {
              const { at, kind } = event
              const details = Object.fromEntries(Object.entries(event).filter(([key]) => !RUN_KEYS.has(key)))
              return { at, kind, details: Object.keys(details).length === 0 ? null : outsideText(JSON.stringify(details), 'autopilot', 'Autopilot journal') }
            }),
          },
        ]
      }),
    }),

    limits_read: () => ({
      windows: Object.fromEntries(Object.entries(deps.limits().windows).map(([name, window]) => [name, { utilization: window.utilization, resetsAt: window.resetsAt === null ? null : iso(window.resetsAt * 1000), status: window.status }])),
    }),

    // The pages are worfy's own text, shipped in the build: not outside text. They pass redactSecrets like every answer.
    features_search: async ({ query, limit }) => {
      const options = { language: deps.guideLanguage(), version: deps.buildVersion() }
      return { guideLanguage: options.language, results: searchFeaturePages(await deps.featurePages(), query, limit ?? DEFAULT_FEATURE_HITS, options) }
    },

    features_read: async ({ page, section }) => {
      const files = await deps.featurePages()
      try {
        return readFeaturePage(files, page, section, { language: deps.guideLanguage(), version: deps.buildVersion() })
      } catch (error) {
        if (error instanceof FeaturePageMissing) throw new ToolError(error.message)
        throw error
      }
    },

    proposals_list: () => ({ proposals: deps.proposals.list().map(proposalView) }),

    proposal_create: (args) => {
      const item = args.item === undefined ? null : itemOfPublicId(args.item)
      checkPrepare(args.prepare)
      const draft = clean({ title: args.title, why: args.why, prepare: args.prepare ?? null })
      return { proposal: proposalView(deps.proposals.create({ title: draft.title, why: draft.why, item, prepare: draft.prepare })) }
    },

    proposal_update: (args) => {
      checkPrepare(args.prepare)
      const { id, ...change } = clean(args)
      try {
        return { proposal: proposalView(deps.proposals.update(id, change)) }
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error))
      }
    },

    proposal_remove: ({ id }) => {
      try {
        deps.proposals.remove(id)
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error))
      }
      return { removed: id }
    },

    action_run: async (args) => {
      const shown = deps.duties.look(deps.items()).shown.find((each) => publicItemId(each.item.id) === args.item)
      if (shown === undefined) throw new ToolError(`No item ${args.item} is shown now: items_list lists the items you may act on. Nothing was done.`)
      const proposal = shown.proposals.find((each) => each.action === args.action)
      if (proposal === undefined) throw new ToolError(`The duty ${shown.duty} has no action ${args.action} for item ${args.item}. Nothing was done.`)
      if (proposal.mode === 'ask') throw new ToolError(`The mode of ${args.action} in the duty ${shown.duty} is ask: propose it with proposal_create and let the user decide. Nothing was done.`)
      if (proposal.mode === 'hand-over') throw new ToolError(`The mode of ${args.action} in the duty ${shown.duty} is hand-over: the user does it; tell them. Nothing was done.`)
      const item = shown.item
      if (item.projectId === null && args.action !== 'wake-orchestrator' && args.action !== 'continue-session') throw new ToolError(`${args.action} needs an item of a Project. Nothing was done.`)
      if (item.projectId !== null) ownProject(item.projectId, `${args.action} is done only in a Project of this Machine`)
      if (args.action === 'wake-orchestrator' || args.action === 'continue-session') {
        // main checks again, sends its own text and writes the journal line itself.
        const result = await deps.closedList.act({ action: args.action, itemId: item.id, by: 'assistant' })
        if (!result.ok) throw new ToolError(`main refused ${args.action} (${result.reason}). Nothing was sent.`)
        return { action: args.action, item: args.item, done: result.line.text ?? args.action }
      }
      return { action: args.action, item: args.item, done: await act({ ...args, action: args.action }, item) }
    },
  }
}

export type WorfyAppToolCaller = (name: AppToolName, args: unknown) => Promise<McpToolResult>

/** The tools as one function: parse the arguments, apply, answer with secrets hidden. Never throws. */
export function worfyAppToolCaller(deps: WorfyAppDeps): WorfyAppToolCaller {
  const table = handlers(deps)
  return async (name, args) => {
    const parsed = parseAppToolArgs(name, args)
    if (!parsed.success) return text(`Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`, true)
    try {
      const handler = table[name] as (input: unknown) => unknown
      return text(await handler(parsed.data))
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true)
    }
  }
}

/** The server in worfy's terms. */
export function worfyAppServer(deps: WorfyAppDeps): McpServer {
  const call = worfyAppToolCaller(deps)
  return {
    name: WORFY_APP_SERVER_NAME,
    version: '1.0.0',
    tools: APP_TOOL_NAMES.map((name) => ({ name, description: appToolDescriptions[name], shape: appToolShapes[name] as z.ZodRawShape, call: (args: unknown) => call(name, args) })),
  }
}

const LANGUAGE_NAMES: Readonly<Record<GuideLanguage, string>> = { en: 'English', ru: 'Russian' }

/**
 * The agent instructions of `worfy-app`, appended to the Assistant Session's system prompt (ticket 10), and the language
 * the Assistant speaks: the Guide's (ticket 17). A new Session starts on each wake-up, so a change of the Guide's
 * language is heard from the next one.
 */
export const worfyAppInstructions = (language: GuideLanguage = 'en'): string =>
  `${instructions.trimEnd()}\n\n## Language\n\nThe user reads worfy's Guide in ${LANGUAGE_NAMES[language]}. Speak ${LANGUAGE_NAMES[language]} to the user, whatever language the text you read is in; the feature pages come in it too. The names of worfy's actions and views stay as the app shows them, in English.\n`

export interface WorfyAppRequest {
  /** The Assistant's Session: the one autopilot_start's dialog names. */
  sessionId: string | null
}

/**
 * The server of the Assistant's Session, for Claude Code's options (ticket 10). It takes no cwd: it is the app's, and
 * answers wherever the Session runs.
 */
export async function worfyAppForSession(request: WorfyAppRequest, deps?: WorfyAppDeps): Promise<{ server: ClaudeMcpServer; instructions: string }> {
  const base = deps ?? (await appWorfyAppDeps())
  return { server: await claudeMcpServer(worfyAppServer({ ...base, sessionId: () => request.sessionId })), instructions: worfyAppInstructions(base.guideLanguage()) }
}

/**
 * The app's parts, loaded at the call: they load the attention core, the launcher and the Autopilot starter, which
 * load much of main.
 */
async function appWorfyAppDeps(): Promise<WorfyAppDeps> {
  const [{ appNow }, { projectStore }, { appAttentionCore }, { appDuties }, { readWorkflow }, { claudeHome }, { harnessScriptEnv }, { sharedPrInbox }, { sharedRegistry }, { vendorDriver }, { VENDOR_IDS }, { readRecentRuns }, { appLimits }, { appProposals }, { sharedLauncher }, { appAutopilotStarter }] =
    await Promise.all([
      import('../clock'),
      import('../projects/store'),
      import('../assistant/core/app'),
      import('../assistant/duties/app'),
      import('../workflow/reader'),
      import('../storage/paths'),
      import('../harness/script-env'),
      import('../ipc/pr-inbox'),
      import('../agent/app-registry'),
      import('../vendors/registry'),
      import('../../shared/vendors/vendor'),
      import('../autopilot/journal'),
      import('../agent/limits'),
      import('../assistant/proposals/book'),
      import('../ipc/actions'),
      import('../autopilot/chat-confirm'),
    ])
  const projects = (): { id: string; name: string }[] => projectStore().list().map((project) => ({ id: project.id, name: project.name }))
  return {
    now: appNow,
    // shortcut: this Machine only; the Projects of the Linked machine, read-only, are worfy-assistant ticket 18.
    machines: () => Promise.resolve([{ name: 'This machine', thisMachine: true, projects: projects() }]),
    projects,
    items: () => {
      const core = appAttentionCore()
      return core === null ? [] : [null, ...projects().map((project) => project.id)].flatMap((scope) => core.items(scope))
    },
    duties: appDuties(),
    workflow: async (projectId) => (await readWorkflow({ root: projectStore().get(projectId).path, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
    prInbox: (projectId) => sharedPrInbox().snapshot(projectId),
    sessionTail: async (sessionId, lines) => {
      const { sdkSessionId, cwd } = sharedRegistry().get(sessionId).info()
      if (sdkSessionId === null) return []
      for (const vendor of VENDOR_IDS) {
        const entries = await vendorDriver(vendor)
          .history.read(sdkSessionId, cwd)
          .catch(() => null)
        if (entries === null) continue
        return entries
          .filter((entry) => !entry.sidechain)
          .flatMap((entry): TailLine[] => {
            const event = entry.event
            if (event.type === 'text' && !event.synthetic) return [{ at: entry.timestamp ?? null, who: 'agent', text: event.text }]
            if (event.type === 'notice' && event.kind === 'user') return [{ at: entry.timestamp ?? null, who: 'user', text: event.text }]
            return []
          })
          .slice(-lines)
      }
      throw new Error(`The transcript of Session ${sessionId} cannot be read`)
    },
    autopilotRuns: (projectId, runs) => readRecentRuns(projectId, { limit: runs }),
    limits: () => appLimits().snapshot(),
    proposals: appProposals(),
    // shortcut: refuses until the closed list of actions (worfy-assistant ticket 08) is in main; then this takes
    // appClosedList(), guarding its null (the closed list not started yet).
    closedList: { act: () => ({ ok: false, reason: 'the closed list of actions is not in this build yet (worfy-assistant ticket 08)', line: {} }) },
    prFollow: (projectId, repo, pr, action) => sharedLauncher().prFollow(projectId, repo, pr, action),
    autopilotStart: appAutopilotStarter(),
    sessionId: () => null,
    // shortcut: only a line in the log: the Assistant's journal of ticket 08 takes no line from outside. Ticket 10, which
    // wires this server to the Assistant's Session, writes these lines to that journal with the item that caused them.
    journal: (entry) => console.info(`[assistant] ${entry.action} on item ${entry.item.id}: ${entry.outcome}`),
    ...(await appHelpDeps()),
  }
}

/** The feature pages of the build, read once per server on first use, the Guide's language and the build version. */
async function appHelpDeps(): Promise<Pick<WorfyAppDeps, 'featurePages' | 'guideLanguage' | 'buildVersion'>> {
  const [{ app }, { featurePagesDir, readFeaturePages }, { appSettingsStore }, { guideLanguage }, { bundledHarnessVersion }] = await Promise.all([
    import('electron'),
    import('../assistant/help/feature-pages'),
    import('../settings/store'),
    import('../../shared/guide/language'),
    import('../harness/bundled'),
  ])
  let pages: Promise<readonly FeaturePageFile[]> | undefined
  return {
    featurePages: () => (pages ??= readFeaturePages(featurePagesDir()).catch((error: unknown) => {
      pages = undefined
      throw error
    })),
    guideLanguage: () => guideLanguage(appSettingsStore().get().guideLanguage, app.getPreferredSystemLanguages()),
    // The version the Guide's links use too (main's `app.version`).
    buildVersion: () => bundledHarnessVersion() ?? app.getVersion(),
  }
}
