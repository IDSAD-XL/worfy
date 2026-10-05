import { describe, expect, it } from 'vitest'
import {
  BINDING_RULES,
  bindingReason,
  bindingTargetLabel,
  bindingWorkflowOf,
  EMPTY_AGENT_SIGNALS,
  resolveBinding,
  type AgentSignals,
  type BindingRule,
  type BindingWorkflow,
} from '../../src/shared/binding/resolve'
import { emptySignalState, extendSignals } from '../../src/shared/binding/signals'
import type { WorkflowModel } from '../../src/shared/workflow/types'

// The Binding of a Session or a Subagent (ticket 16): which Ticket or Epic it works on, from the
// signals of its work, strongest first, or from the user's manual Binding.

const workflow: BindingWorkflow = {
  epics: ['worfy-mvp', 'auction'],
  tickets: [
    { epic: 'worfy-mvp', num: 7, state: 'work' },
    { epic: 'worfy-mvp', num: 12, state: 'open' },
    { epic: 'worfy-mvp', num: 16, state: 'open' },
    { epic: 'auction', num: 12, state: 'done' },
    { epic: 'auction', num: 30, state: 'open' },
    { epic: 'worfy-mvp', num: 30, state: 'open' },
  ],
}

const signals = (change: Partial<AgentSignals>): AgentSignals => ({ ...EMPTY_AGENT_SIGNALS, ...change })
const claim = (epic: string, num: number) => ({ epic, num, command: `~/.claude/bin/ticket claim ${epic} ${num}` })

describe('resolveBinding: signals in order of strength', () => {
  it('a `ticket claim` beats the branch and the worktree folder', () => {
    const input = { signals: signals({ claim: claim('worfy-mvp', 12), gitBranch: 'worfy-mvp/07', cwd: '/repo/.claude/worktrees/07' }) }
    expect(resolveBinding(input, workflow)).toEqual({
      target: { kind: 'ticket', epic: 'worfy-mvp', num: 12 },
      source: 'claim',
      detail: '~/.claude/bin/ticket claim worfy-mvp 12',
    })
  })

  it('the manual Binding beats every signal', () => {
    const input = { manual: { kind: 'epic' as const, epic: 'auction' }, signals: signals({ claim: claim('worfy-mvp', 12), gitBranch: 'worfy-mvp/07' }) }
    expect(resolveBinding(input, workflow)).toEqual({ target: { kind: 'epic', epic: 'auction' }, source: 'manual', detail: null })
  })

  it('a launch Binding (ticket 23) is weaker than the manual one and stronger than `ticket claim`', () => {
    const launch = { kind: 'ticket' as const, epic: 'worfy-mvp', num: 16 }
    const strong = signals({ claim: claim('worfy-mvp', 12), skill: { name: 'epic-wave', args: 'auction' }, gitBranch: 'worfy-mvp/07' })
    expect(resolveBinding({ launch, signals: strong }, workflow)).toEqual({ target: launch, source: 'launch', detail: null })
    expect(resolveBinding({ manual: { kind: 'epic', epic: 'auction' }, launch, signals: strong }, workflow)).toEqual({ target: { kind: 'epic', epic: 'auction' }, source: 'manual', detail: null })
    expect(resolveBinding({ launch: null, signals: strong }, workflow)?.source).toBe('claim')
    expect(BINDING_RULES.map((rule) => rule.name).slice(0, 3)).toEqual(['manual', 'launch', 'claim'])
    expect(bindingReason({ target: launch, source: 'launch', detail: null })).toBe('launched')
  })

  it('without a claim, the branch <epic>/<NN> binds, in its slug form too', () => {
    expect(resolveBinding({ signals: signals({ gitBranch: 'worfy-mvp/07' }) }, workflow)).toEqual({
      target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 },
      source: 'branch',
      detail: 'worfy-mvp/07',
    })
    expect(resolveBinding({ signals: signals({ gitBranch: 'worfy-mvp/07-движок-сессий' }) }, workflow)?.target).toEqual({ kind: 'ticket', epic: 'worfy-mvp', num: 7 })
  })

  it('without a claim or a branch, the worktree folder binds; its Epic is the only one with that number', () => {
    for (const cwd of ['/repo/.claude/worktrees/07', '/repo/.claude/worktrees/07-движок-сессий', '/repo/.claude/worktrees/07/src/main']) {
      expect(resolveBinding({ signals: signals({ cwd, gitBranch: 'HEAD' }) }, workflow), cwd).toEqual({
        target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 },
        source: 'worktree',
        detail: cwd.slice('/repo/'.length).replace('/src/main', ''),
      })
    }
  })

  it('a folder number two Epics share goes to the one whose Ticket is not done, and to none when both are open', () => {
    expect(resolveBinding({ signals: signals({ cwd: '/repo/.claude/worktrees/12' }) }, workflow)?.target).toEqual({ kind: 'ticket', epic: 'worfy-mvp', num: 12 })
    expect(resolveBinding({ signals: signals({ cwd: '/repo/.claude/worktrees/30' }) }, workflow)).toBeNull()
    // Without the workflow model the folder does not say which Epic.
    expect(resolveBinding({ signals: signals({ cwd: '/repo/.claude/worktrees/07' }) }, undefined)).toBeNull()
  })

  it('folders and branches that do not name a Ticket do not bind', () => {
    for (const change of [
      { cwd: '/repo', gitBranch: 'main' },
      { cwd: '/repo/.claude/worktrees/worfy-mvp-epic-53fc44', gitBranch: 'claude/worfy-mvp-epic-53fc44' },
      { cwd: '/repo/.claude/worktrees/review-12-tests', gitBranch: 'HEAD' },
    ]) {
      expect(resolveBinding({ signals: signals(change) }, workflow), JSON.stringify(change)).toBeNull()
    }
  })

  it('/ship-ticket binds to its Ticket, /epic-wave to its Epic', () => {
    expect(resolveBinding({ signals: signals({ skill: { name: 'ship-ticket', args: 'worfy-mvp 16' } }) }, workflow)).toEqual({
      target: { kind: 'ticket', epic: 'worfy-mvp', num: 16 },
      source: 'skill',
      detail: '/ship-ticket worfy-mvp 16',
    })
    expect(resolveBinding({ signals: signals({ skill: { name: 'ship-ticket', args: 'worfy-mvp/07' } }) }, workflow)?.target).toEqual({ kind: 'ticket', epic: 'worfy-mvp', num: 7 })
    expect(resolveBinding({ signals: signals({ skill: { name: 'ship-ticket', args: '16' } }) }, workflow)?.target).toEqual({ kind: 'ticket', epic: 'worfy-mvp', num: 16 })
    expect(resolveBinding({ signals: signals({ skill: { name: 'epic-wave', args: 'волна 9 эпика worfy-mvp' } }) }, workflow)).toEqual({
      target: { kind: 'epic', epic: 'worfy-mvp' },
      source: 'skill',
      detail: '/epic-wave волна 9 эпика worfy-mvp',
    })
    // Without the workflow model, the last word that can be an Epic's name.
    expect(resolveBinding({ signals: signals({ skill: { name: 'epic-wave', args: 'wave 2 of auction' } }) }, undefined)?.target).toEqual({ kind: 'epic', epic: 'auction' })
    expect(resolveBinding({ signals: signals({ skill: { name: 'epic-wave', args: 'волна 2' } }) }, workflow)).toBeNull()
  })

  it('/epic-wave beats the branch and the worktree folder: the Orchestrator is bound to the Epic whatever its checkout holds', () => {
    // The Orchestrator's checkout often holds a Ticket's branch it does not work on (merges, checks).
    const wave = { skill: { name: 'epic-wave' as const, args: 'worfy-mvp' } }
    expect(resolveBinding({ signals: signals({ ...wave, gitBranch: 'worfy-mvp/16' }) }, workflow)).toEqual({ target: { kind: 'epic', epic: 'worfy-mvp' }, source: 'skill', detail: '/epic-wave worfy-mvp' })
    expect(resolveBinding({ signals: signals({ ...wave, cwd: '/repo/.claude/worktrees/16' }) }, workflow)?.target).toEqual({ kind: 'epic', epic: 'worfy-mvp' })
    expect(resolveBinding({ signals: signals({ ...wave, gitBranch: 'claude/worfy-mvp-epic-53fc44' }) }, workflow)?.target).toEqual({ kind: 'epic', epic: 'worfy-mvp' })
    // An /epic-wave that names no Epic of the Project leaves the branch to decide.
    expect(resolveBinding({ signals: signals({ skill: { name: 'epic-wave', args: 'волна 2' }, gitBranch: 'worfy-mvp/16' }) }, workflow)?.source).toBe('branch')
    // A claim is still stronger.
    expect(resolveBinding({ signals: signals({ ...wave, claim: claim('worfy-mvp', 7) }) }, workflow)?.source).toBe('claim')
  })

  it('a branch beats /ship-ticket: the call names the Ticket only when nothing stronger does', () => {
    expect(resolveBinding({ signals: signals({ skill: { name: 'ship-ticket', args: 'worfy-mvp 12' }, gitBranch: 'worfy-mvp/16' }) }, workflow)?.target).toEqual({ kind: 'ticket', epic: 'worfy-mvp', num: 16 })
  })

  it('a Subagent with no signals of its own is bound by the Ticket path in its task; a Session is not', () => {
    const input = { signals: signals({ task: { epic: 'worfy-mvp', num: 12 } }) }
    expect(resolveBinding({ ...input, subagent: true }, workflow)).toEqual({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 12 }, source: 'task', detail: '.scratch/worfy-mvp/issues/12-…' })
    expect(resolveBinding(input, workflow)).toBeNull()
    // Its own signal wins over the task.
    expect(resolveBinding({ signals: signals({ task: { epic: 'worfy-mvp', num: 12 }, claim: claim('worfy-mvp', 16) }), subagent: true }, workflow)?.target).toEqual({
      kind: 'ticket',
      epic: 'worfy-mvp',
      num: 16,
    })
    expect(resolveBinding({ subagent: true }, workflow)).toBeNull()
    expect(resolveBinding({ signals: null, subagent: true }, workflow)).toBeNull()
  })

  it('a signal that names a Ticket the Project does not have is skipped for the next one', () => {
    const input = { signals: signals({ claim: claim('other-epic', 3), gitBranch: 'worfy-mvp/07' }) }
    expect(resolveBinding(input, workflow)?.source).toBe('branch')
    // Without the model nothing can be checked: the claim stands.
    expect(resolveBinding(input, undefined)?.target).toEqual({ kind: 'ticket', epic: 'other-epic', num: 3 })
  })

  it('takes the rules as a list, so a later ticket adds one', () => {
    const always: BindingRule = { name: 'always', resolve: () => ({ target: { kind: 'epic', epic: 'auction' }, source: 'skill', detail: 'x' }) }
    expect(resolveBinding({}, workflow, [...BINDING_RULES, always])?.target).toEqual({ kind: 'epic', epic: 'auction' })
    expect(BINDING_RULES.map((rule) => rule.name)).toEqual(['manual', 'launch', 'claim', 'epic-wave', 'branch-or-worktree', 'ship-ticket', 'task'])
  })
})

describe('labels', () => {
  it('says why, the way the Session rail shows it', () => {
    expect(bindingReason({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 }, source: 'branch', detail: 'worfy-mvp/07' })).toBe('branch worfy-mvp/07')
    expect(bindingReason({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 }, source: 'worktree', detail: '.claude/worktrees/07' })).toBe('worktree .claude/worktrees/07')
    expect(bindingReason({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 }, source: 'claim', detail: 'ticket claim worfy-mvp 07' })).toBe('ticket claim')
    expect(bindingReason({ target: { kind: 'epic', epic: 'worfy-mvp' }, source: 'manual', detail: null })).toBe('manual')
    expect(bindingReason({ target: { kind: 'epic', epic: 'worfy-mvp' }, source: 'skill', detail: '/epic-wave worfy-mvp' })).toBe('/epic-wave')
    expect(bindingReason({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 }, source: 'task', detail: null })).toBe('task')
    expect(bindingTargetLabel({ kind: 'ticket', epic: 'worfy-mvp', num: 7 })).toBe('worfy-mvp/07')
    expect(bindingTargetLabel({ kind: 'epic', epic: 'worfy-mvp' })).toBe('worfy-mvp')
  })

  it('reads the workflow model, and none while it is missing or failed', () => {
    const model = { root: '/r', epics: [{ epic: 'e', hasSpec: true, hasMap: false, title: null }], tickets: [{ epic: 'e', num: 1, state: 'open' }], error: null, branchErrors: [] } as unknown as WorkflowModel
    expect(bindingWorkflowOf(model)).toEqual({ epics: ['e'], tickets: [{ epic: 'e', num: 1, state: 'open' }] })
    expect(bindingWorkflowOf(undefined)).toBeUndefined()
    expect(bindingWorkflowOf({ ...model, error: { code: 'failed', message: 'x' } })).toBeUndefined()
  })
})

// ── signals from transcript lines ───────────────────────────────────────────

const line = (record: Record<string, unknown>): string => JSON.stringify({ uuid: 'u', timestamp: '2026-10-05T00:00:00Z', ...record })
const bash = (command: string, extra: Record<string, unknown> = {}): string =>
  line({ type: 'assistant', cwd: '/repo', ...extra, message: { id: 'm', content: [{ type: 'tool_use', id: `t-${command.length}`, name: 'Bash', input: { command } }] } })
const userText = (text: string, extra: Record<string, unknown> = {}): string => line({ type: 'user', ...extra, message: { role: 'user', content: text } })

describe('extendSignals', () => {
  it('keeps the last `ticket claim` of the Bash tool, in both spellings', () => {
    let state = extendSignals(emptySignalState(), [bash('~/.claude/bin/ticket claim worfy-mvp 07')], { subagent: false })
    expect(state.signals.claim).toEqual({ epic: 'worfy-mvp', num: 7, command: '~/.claude/bin/ticket claim worfy-mvp 07' })
    state = extendSignals(state, [bash('cd /repo && ~/.claude/bin/ticket claim worfy-mvp/16; echo "КОД=$?"'), bash('git status')], { subagent: false })
    expect(state.signals.claim).toMatchObject({ epic: 'worfy-mvp', num: 16 })
    // Other subcommands, other tools and text are not claims.
    state = extendSignals(state, [bash('~/.claude/bin/ticket done worfy-mvp 12'), line({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'ticket claim worfy-mvp 30' }] } })], { subagent: false })
    expect(state.signals.claim).toMatchObject({ num: 16 })
  })

  it('keeps the cwd and the branch of the last record that names them', () => {
    const state = extendSignals(
      emptySignalState(),
      [userText('hi', { cwd: '/repo', gitBranch: 'main' }), line({ type: 'system', subtype: 'x', cwd: '/repo/.claude/worktrees/07', gitBranch: 'worfy-mvp/07' }), line({ type: 'system', subtype: 'y' })],
      { subagent: false },
    )
    expect(state.signals).toMatchObject({ cwd: '/repo/.claude/worktrees/07', gitBranch: 'worfy-mvp/07' })
  })

  it('reads /ship-ticket and /epic-wave typed as commands and called through the Skill tool; the last one counts', () => {
    let state = extendSignals(emptySignalState(), [userText('<command-name>/epic-wave</command-name>\n<command-args>волна 9 эпика worfy-mvp</command-args>')], { subagent: false })
    expect(state.signals.skill).toEqual({ name: 'epic-wave', args: 'волна 9 эпика worfy-mvp' })
    state = extendSignals(state, [line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'ship-ticket', args: 'worfy-mvp 16' } }] } })], { subagent: false })
    expect(state.signals.skill).toEqual({ name: 'ship-ticket', args: 'worfy-mvp 16' })
    state = extendSignals(state, [userText('<command-name>/qmd</command-name>\n<command-args>x</command-args>')], { subagent: false })
    expect(state.signals.skill?.name).toBe('ship-ticket')
  })

  it('in a Session file, leaves out what a Subagent wrote there', () => {
    const state = extendSignals(emptySignalState(), [bash('ticket claim worfy-mvp 07', { isSidechain: true, cwd: '/repo/.claude/worktrees/07' })], { subagent: false })
    expect(state.signals).toEqual(EMPTY_AGENT_SIGNALS)
  })

  it('in a Subagent file, takes the Ticket path from the first prompt only', () => {
    const prompt = 'Тикет: /Users/x/repo/.scratch/worfy-mvp/issues/12-рамка.md (один файл); соседи: .scratch/worfy-mvp/issues/16-привязка.md'
    let state = extendSignals(emptySignalState(), [userText(prompt, { isSidechain: true, cwd: '/repo' })], { subagent: true })
    expect(state.signals.task).toEqual({ epic: 'worfy-mvp', num: 12 })
    state = extendSignals(state, [userText('now .scratch/auction/issues/30-x.md', { isSidechain: true })], { subagent: true })
    expect(state.signals.task).toEqual({ epic: 'worfy-mvp', num: 12 })
    const blocks = extendSignals(emptySignalState(), [line({ type: 'user', message: { content: [{ type: 'text', text: 'see .scratch/auction/issues/30-x.md' }] } })], { subagent: true })
    expect(blocks.signals.task).toEqual({ epic: 'auction', num: 30 })
  })

  it('in a Subagent file, drops cwd and gitBranch: they are the parent Session\'s, so the Ticket path in its task decides', () => {
    // Claude Code writes the Session's cwd and branch into every record of a Subagent's file.
    const inherited = { isSidechain: true, cwd: '/repo/.claude/worktrees/26', gitBranch: 'worfy-mvp/26' }
    const state = extendSignals(
      emptySignalState(),
      [userText('Ревью тикета .scratch/worfy-mvp/issues/16-привязка.md', inherited), line({ type: 'system', subtype: 'x', ...inherited })],
      { subagent: true },
    )
    expect(state.signals).toEqual({ ...EMPTY_AGENT_SIGNALS, task: { epic: 'worfy-mvp', num: 16 } })
    expect(resolveBinding({ signals: state.signals, subagent: true }, workflow)).toMatchObject({ target: { kind: 'ticket', epic: 'worfy-mvp', num: 16 }, source: 'task' })
    // A Subagent with no task and only the inherited branch is not bound.
    const scout = extendSignals(emptySignalState(), [userText('map the canvas code', inherited)], { subagent: true })
    expect(resolveBinding({ signals: scout.signals, subagent: true }, workflow)).toBeNull()
    // The Session's own file keeps them.
    expect(extendSignals(emptySignalState(), [userText('hi', { ...inherited, isSidechain: false })], { subagent: false }).signals).toMatchObject({ cwd: inherited.cwd, gitBranch: inherited.gitBranch })
  })

  it('survives lines that are not JSON or not records', () => {
    const state = extendSignals(emptySignalState(), ['{not json', '42', 'null', bash('ticket claim worfy-mvp 07')], { subagent: false })
    expect(state.signals.claim?.num).toBe(7)
  })
})
