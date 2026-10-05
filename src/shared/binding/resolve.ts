// The Binding of a Session or a Subagent (CONTEXT.md, «Привязка»): the one Ticket or Epic it works
// on. Pure, so main, the renderer and tests resolve it the same way.
//
// A Binding comes from the strongest signal that names a target, in this order:
//
//   1. manual    — the user dropped the agent's Node on a Ticket or an Epic frame (bindings.json);
//   2. claim     — the last Bash command `ticket claim <epic> <NN>` (or `<epic>/<NN>`) the agent ran;
//   3. branch    — its git branch `<epic>/<NN>[-<slug>]`, else its cwd inside
//      worktree      `.claude/worktrees/<NN>[-<slug>]` (ticket-ref.ts, ticket 10); a folder does not
//                 carry the Epic, so it binds only when the workflow model says which Epic it is;
//   4. skill     — the last `/ship-ticket` (to its Ticket) or `/epic-wave` (to its Epic) call;
//   5. task      — for a Subagent only: the path `.scratch/<epic>/issues/<NN>-…` in its task.
//
// So the Orchestrator that runs a Wave (`/epic-wave`) is bound to the Epic, while its implementers
// and reviewers, who claim, work in a worktree or get a Ticket's path, are bound to their Tickets.
//
// The rules are a list (BINDING_RULES), so a later ticket adds a signal by adding a rule. The
// signals themselves are extracted from transcripts by signals.ts.
import { z } from 'zod'
import type { WorkflowModel } from '../workflow/types'
import { parseTicketBranch, parseWorktreeFolder } from '../workflow/ticket-ref'

/** An Epic is a folder name under `.scratch/`: one path segment. */
export const EPIC_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

export const epicNameSchema = z.string().max(128).regex(EPIC_NAME, 'not an Epic name')
export const ticketNumSchema = z.number().int().nonnegative().max(99999)

/** What an agent is bound to: a Ticket of an Epic, or a whole Epic. */
export const bindingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ticket'), epic: epicNameSchema, num: ticketNumSchema }),
  z.object({ kind: z.literal('epic'), epic: epicNameSchema }),
])
export type BindingTarget = z.infer<typeof bindingTargetSchema>

export const ticketRefSchema = z.object({ epic: epicNameSchema, num: ticketNumSchema })
export type TicketRef = z.infer<typeof ticketRefSchema>

export const SKILL_NAMES = ['ship-ticket', 'epic-wave'] as const

/** Longest command, arguments and paths kept from a transcript. */
export const COMMAND_MAX = 500
export const ARGS_MAX = 1000
export const PATH_MAX = 4096
export const BRANCH_MAX = 512

/** What one agent's transcript says that can bind it (signals.ts extracts these). */
export const agentSignalsSchema = z.object({
  /** The last `ticket claim` Bash command: the Ticket it names and the command as run. */
  claim: ticketRefSchema.extend({ command: z.string().max(COMMAND_MAX) }).nullable(),
  /** cwd of the last record that names one. */
  cwd: z.string().max(PATH_MAX).nullable(),
  /** Git branch of the last record that names one. */
  gitBranch: z.string().max(BRANCH_MAX).nullable(),
  /** The last `/ship-ticket` or `/epic-wave` call, typed as a command or made through the Skill tool. */
  skill: z.object({ name: z.enum(SKILL_NAMES), args: z.string().max(ARGS_MAX) }).nullable(),
  /** For a Subagent: the first `.scratch/<epic>/issues/<NN>-…` path in its task. */
  task: ticketRefSchema.nullable(),
})
export type AgentSignals = z.infer<typeof agentSignalsSchema>

export const EMPTY_AGENT_SIGNALS: AgentSignals = { claim: null, cwd: null, gitBranch: null, skill: null, task: null }

export type BindingSource = 'manual' | 'claim' | 'branch' | 'worktree' | 'skill' | 'task'

/** A resolved Binding and why: the signal it came from and what that signal said. */
export interface Binding {
  target: BindingTarget
  source: BindingSource
  /** The branch, the folder, the command or the call; null for a manual Binding. */
  detail: string | null
}

/** What the workflow model says about the Project's Epics and Tickets, as far as a Binding needs it. */
export interface BindingWorkflow {
  epics: readonly string[]
  tickets: readonly { epic: string; num: number; state: string }[]
}

export interface BindingInput {
  manual?: BindingTarget | null | undefined
  signals?: AgentSignals | null | undefined
  /** A Subagent: only it is bound by the Ticket path in its task. */
  subagent?: boolean | undefined
}

/**
 * One signal: a Binding when the signal is there and names a target, else null. `workflow` is
 * undefined while the workflow model is unknown; then nothing can be checked against it.
 */
export interface BindingRule {
  name: string
  resolve(input: BindingInput, workflow: BindingWorkflow | undefined): Binding | null
}

/** The workflow model as a Binding needs it; undefined while there is none or it failed. */
export function bindingWorkflowOf(model: WorkflowModel | undefined): BindingWorkflow | undefined {
  if (model === undefined || model.error !== null) return undefined
  return { epics: model.epics.map((epic) => epic.epic), tickets: model.tickets.map(({ epic, num, state }) => ({ epic, num, state })) }
}

/** True when the Project has the target, or when that cannot be known. */
function exists(target: BindingTarget, workflow: BindingWorkflow | undefined): boolean {
  if (workflow === undefined) return true
  if (target.kind === 'ticket') return workflow.tickets.some((ticket) => ticket.epic === target.epic && ticket.num === target.num)
  return workflow.epics.includes(target.epic) || workflow.tickets.some((ticket) => ticket.epic === target.epic)
}

/** The Ticket a bare number names: the only Epic that has it, else the only one where it is not done. */
function ticketByNumber(num: number, workflow: BindingWorkflow | undefined): BindingTarget | null {
  if (workflow === undefined) return null
  const matches = workflow.tickets.filter((ticket) => ticket.num === num)
  const pick = matches.length === 1 ? matches : matches.filter((ticket) => ticket.state !== 'done')
  return pick.length === 1 ? { kind: 'ticket', epic: pick[0]!.epic, num } : null
}

const ticket = (epic: string, num: number): BindingTarget => ({ kind: 'ticket', epic, num })
const isNumber = (word: string): boolean => /^\d+$/u.test(word)
const isEpicWord = (word: string): boolean => EPIC_NAME.test(word) && !isNumber(word)

/** The Ticket in a `/ship-ticket` call's arguments: `<epic> <NN>`, `<epic>/<NN>` or a bare `<NN>`. */
function ticketInArgs(args: string, workflow: BindingWorkflow | undefined): BindingTarget | null {
  const words = args.split(/\s+/u).filter((word) => word !== '')
  for (const [index, word] of words.entries()) {
    const branch = parseTicketBranch(word)
    if (branch) return ticket(branch.epic, branch.num)
    const next = words[index + 1]
    if (isEpicWord(word) && next !== undefined && isNumber(next)) return ticket(word, Number(next))
  }
  const bare = words.find(isNumber)
  return bare === undefined ? null : ticketByNumber(Number(bare), workflow)
}

/** The Epic in an `/epic-wave` call's arguments: the last word that is one of the Project's Epics (any Epic-like word without the model). */
function epicInArgs(args: string, workflow: BindingWorkflow | undefined): BindingTarget | null {
  const words = args.split(/\s+/u).filter(isEpicWord)
  const known = workflow === undefined ? words : words.filter((word) => exists({ kind: 'epic', epic: word }, workflow))
  const epic = known.at(-1)
  return epic === undefined ? null : { kind: 'epic', epic }
}

/** `<anything>/.claude/worktrees/<NN>[-<slug>]/<anything>` → `.claude/worktrees/<NN>[-<slug>]`. */
function worktreeFolderOf(cwd: string): string | null {
  const match = /(?:^|\/)(\.claude\/worktrees\/[^/]+)/u.exec(cwd)
  return match?.[1] ?? null
}

const manualRule: BindingRule = {
  name: 'manual',
  resolve: ({ manual }) => (manual ? { target: manual, source: 'manual', detail: null } : null),
}

const claimRule: BindingRule = {
  name: 'claim',
  resolve({ signals }, workflow) {
    const claim = signals?.claim
    if (!claim) return null
    const target = ticket(claim.epic, claim.num)
    return exists(target, workflow) ? { target, source: 'claim', detail: claim.command } : null
  },
}

const branchRule: BindingRule = {
  name: 'branch-or-worktree',
  resolve({ signals }, workflow) {
    const branch = signals?.gitBranch ? parseTicketBranch(signals.gitBranch) : null
    if (branch) {
      const target = ticket(branch.epic, branch.num)
      if (exists(target, workflow)) return { target, source: 'branch', detail: signals!.gitBranch!.replace(/^refs\/heads\//u, '') }
    }
    const folder = signals?.cwd ? worktreeFolderOf(signals.cwd) : null
    const ref = folder === null ? null : parseWorktreeFolder(folder)
    if (folder === null || ref === null) return null
    const target = ticketByNumber(ref.num, workflow)
    return target ? { target, source: 'worktree', detail: folder } : null
  },
}

const skillRule: BindingRule = {
  name: 'skill',
  resolve({ signals }, workflow) {
    const skill = signals?.skill
    if (!skill) return null
    const target = skill.name === 'ship-ticket' ? ticketInArgs(skill.args, workflow) : epicInArgs(skill.args, workflow)
    if (target === null || !exists(target, workflow)) return null
    return { target, source: 'skill', detail: `/${skill.name}${skill.args === '' ? '' : ` ${skill.args}`}` }
  },
}

const taskRule: BindingRule = {
  name: 'task',
  resolve({ signals, subagent }, workflow) {
    const task = signals?.task
    if (subagent !== true || !task) return null
    const target = ticket(task.epic, task.num)
    return exists(target, workflow) ? { target, source: 'task', detail: `.scratch/${task.epic}/issues/${String(task.num).padStart(2, '0')}-…` } : null
  },
}

/** The signals, strongest first. */
export const BINDING_RULES: readonly BindingRule[] = [manualRule, claimRule, branchRule, skillRule, taskRule]

/** The Binding from the strongest rule that gives one; null when the agent is not bound. */
export function resolveBinding(input: BindingInput, workflow: BindingWorkflow | undefined, rules: readonly BindingRule[] = BINDING_RULES): Binding | null {
  for (const rule of rules) {
    const binding = rule.resolve(input, workflow)
    if (binding) return binding
  }
  return null
}

/** `worfy-mvp/07` for a Ticket, `worfy-mvp` for an Epic. */
export function bindingTargetLabel(target: BindingTarget): string {
  return target.kind === 'ticket' ? `${target.epic}/${String(target.num).padStart(2, '0')}` : target.epic
}

/** Why the agent is bound, in a few words: «branch worfy-mvp/07», «ticket claim», «manual». */
export function bindingReason(binding: Binding): string {
  switch (binding.source) {
    case 'manual':
      return 'manual'
    case 'claim':
      return 'ticket claim'
    case 'branch':
      return `branch ${binding.detail ?? ''}`.trim()
    case 'worktree':
      return `worktree ${binding.detail ?? ''}`.trim()
    case 'skill':
      return binding.detail?.split(/\s/u)[0] ?? 'skill'
    case 'task':
      return 'task'
  }
}

/** Two targets are the same Ticket or the same Epic. */
export function sameTarget(a: BindingTarget | null | undefined, b: BindingTarget | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.kind === b.kind && a.epic === b.epic && (a.kind === 'epic' || a.num === (b as { num: number }).num)
}
