// Unknown side effects (worfy-continuity ticket 16): the external calls without a result of a Session cut off by
// a restart and of each of its Interrupted Subagents, each Subagent with the Ticket of its Binding. The rule is
// the one of Auto-continue's `in-flight` refusal (continue-plan.ts): externalActions classifies, a call without
// its `tool_result` is in flight.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BindingWorkflow } from '../../src/shared/binding/resolve'
import { externalActions, type ExternalAction } from '../../src/shared/agent/continue-plan'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LiveSession } from '../../src/shared/agent/live-sessions'
import { unknownSideEffects, type InterruptedSubagent } from '../../src/shared/agent/unknown-side-effects'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'

const FIXTURES = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'unknown-side-effects')
/** A fixture transcript as the lines a reader of the file gets: split on newlines, empty lines dropped. */
const lines = (name: string): string[] => readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter((line) => line !== '')

const RECORD: LiveSession = {
  nodeId: 'node-orchestrator',
  kind: 'orchestrator',
  vendor: 'claude',
  vendorSessionId: 's-orch',
  state: 'busy',
  queue: { items: [], held: false },
  runId: null,
  lastEventAt: 1_763_460_000_000,
  continuedAt: [],
}
const WORKFLOW: BindingWorkflow = {
  epics: ['worfy-continuity'],
  tickets: [
    { epic: 'worfy-continuity', num: 7, state: 'open' },
    { epic: 'worfy-continuity', num: 16, state: 'work' },
  ],
}

const use = (id: string, name: string, input: unknown): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null })
const bash = (id: string, command: string): AgentEvent => use(id, 'Bash', { command })
const result = (toolUseId: string): AgentEvent => ({ type: 'tool_result', toolUseId, content: 'ok', isError: false, parentToolUseId: null })
const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
/** One line of a Subagent's own transcript: an assistant record that calls `name` with `input`. */
const useLine = (id: string, name: string, input: unknown): string =>
  JSON.stringify({ type: 'assistant', isSidechain: true, agentId: 'a-x', message: { id: `msg-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const resultLine = (id: string): string => JSON.stringify({ type: 'user', isSidechain: true, agentId: 'a-x', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })

const ofSession = (events: readonly AgentEvent[]) => unknownSideEffects({ session: RECORD, events, subagents: [], workflow: WORKFLOW })
const ofSubagents = (subagents: readonly InterruptedSubagent[], workflow: BindingWorkflow | undefined = WORKFLOW) =>
  unknownSideEffects({ session: RECORD, events: [], subagents, workflow }).subagents
const callsOf = (actions: readonly ExternalAction[]) => actions.map(({ toolUseId, description }) => ({ toolUseId, description }))

describe('unknownSideEffects: the Session', () => {
  it('finds a git push that has no tool_result', () => {
    const found = ofSession([prompt('ship it'), bash('t-push', 'git push origin main')])
    expect(found.nodeId).toBe('node-orchestrator')
    expect(found.session).toEqual([{ toolUseId: 't-push', tool: 'Bash', description: 'git push origin main', done: false, known: true }])
  })

  it('leaves out a git push that has its tool_result', () => {
    expect(ofSession([bash('t-push', 'git push origin main'), result('t-push')]).session).toEqual([])
  })

  it('does not count reading a file without a result as an external call', () => {
    expect(ofSession([use('t-read', 'Read', { file_path: '/repo/a.ts' }), use('t-grep', 'Grep', { pattern: 'x' })]).session).toEqual([])
  })

  it('keeps every call without a result in call order, an unclassified command and an Agent call included', () => {
    const found = ofSession([
      bash('t-1', 'git commit -m fix'),
      result('t-1'),
      bash('t-2', 'make deploy'),
      use('t-3', 'Agent', { subagent_type: 'worfy:implementer', prompt: 'x' }),
      bash('t-4', 'git status'),
    ])
    expect(found.session.map(({ toolUseId, description, known }) => ({ toolUseId, description, known }))).toEqual([
      { toolUseId: 't-2', description: 'make deploy', known: false },
      { toolUseId: 't-3', description: 'Agent (worfy:implementer)', known: true },
    ])
  })

  it('reads a Session transcript cut off in a torn last line without throwing, keeping the call whose tool_use was read', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'push it' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't-push', name: 'Bash', input: { command: 'git push origin main' } }] } }),
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t-pu',
    ]
    const found = ofSession(mainThreadEvents(parseTranscriptLines(transcript)))
    expect(callsOf(found.session)).toEqual([{ toolUseId: 't-push', description: 'git push origin main' }])
  })
})

describe('unknownSideEffects: Interrupted Subagents', () => {
  it('finds gh pr merge 1234 without a result in its own transcript and binds it to the Ticket of its Binding', () => {
    const merge = externalActions([bash('tu-merge', 'gh pr merge 1234 --squash --delete-branch')])[0]!
    expect(merge.description).toMatch(/^gh pr merge 1234/u)
    expect(ofSubagents([{ agentId: 'a-impl', lines: lines('implementer-merge.jsonl') }])).toEqual([
      { agentId: 'a-impl', ticket: { epic: 'worfy-continuity', num: 16 }, calls: [{ ...merge, done: false }] },
    ])
  })

  it('finds the call of a Subagent without a Binding, with the Ticket null', () => {
    const found = ofSubagents([{ agentId: 'a-free', lines: lines('unbound-merge.jsonl') }])
    expect(found).toHaveLength(1)
    expect(found[0]!.ticket).toBeNull()
    expect(callsOf(found[0]!.calls)).toEqual([{ toolUseId: 'tu-merge', description: 'gh pr merge 1234' }])
  })

  it('reads a Ticket path the Project does not have as no Binding', () => {
    const workflow: BindingWorkflow = { epics: ['worfy-continuity'], tickets: [{ epic: 'worfy-continuity', num: 7, state: 'open' }] }
    const [found] = ofSubagents([{ agentId: 'a-impl', lines: lines('implementer-merge.jsonl') }], workflow)
    expect(found?.ticket).toBeNull()
    expect(callsOf(found!.calls)).toEqual([{ toolUseId: 'tu-merge', description: expect.stringMatching(/^gh pr merge 1234/u) }])
  })

  it('takes the manual Binding over the task, binds by the launch Binding, and gives no Ticket for a Binding to an Epic', () => {
    const subagents: InterruptedSubagent[] = [
      { agentId: 'a-impl', lines: lines('implementer-merge.jsonl'), manual: { kind: 'ticket', epic: 'worfy-continuity', num: 7 } },
      { agentId: 'a-free', lines: lines('unbound-merge.jsonl'), launch: { kind: 'ticket', epic: 'worfy-continuity', num: 16 } },
      { agentId: 'a-wave', lines: lines('implementer-merge.jsonl'), manual: { kind: 'epic', epic: 'worfy-continuity' } },
    ]
    expect(ofSubagents(subagents).map(({ agentId, ticket }) => ({ agentId, ticket }))).toEqual([
      { agentId: 'a-impl', ticket: { epic: 'worfy-continuity', num: 7 } },
      { agentId: 'a-free', ticket: { epic: 'worfy-continuity', num: 16 } },
      { agentId: 'a-wave', ticket: null },
    ])
  })

  it('leaves out a Subagent whose calls all have their results, and keeps the order of the others', () => {
    const finished: InterruptedSubagent = { agentId: 'a-done', lines: [useLine('t-push', 'Bash', { command: 'git push' }), resultLine('t-push')] }
    const found = ofSubagents([
      { agentId: 'a-free', lines: lines('unbound-merge.jsonl') },
      finished,
      { agentId: 'a-impl', lines: lines('implementer-merge.jsonl') },
      { agentId: 'a-empty', lines: [] },
    ])
    expect(found.map(({ agentId }) => agentId)).toEqual(['a-free', 'a-impl'])
  })

  it('reads a torn last line without throwing and keeps the call whose tool_use was read', () => {
    const found = ofSubagents([{ agentId: 'a-torn', lines: lines('torn-tail.jsonl') }])
    expect(found.map(({ agentId, ticket, calls }) => ({ agentId, ticket, calls: callsOf(calls) }))).toEqual([
      { agentId: 'a-torn', ticket: null, calls: [{ toolUseId: 'tu-push', description: 'git push origin release' }] },
    ])
  })

  it('reads a transcript of torn and foreign lines alone as no calls', () => {
    expect(ofSubagents([{ agentId: 'a-junk', lines: ['{"type":"assistant","message":{"content":[{"type":"tool_u', 'not json', '42', 'null'] }])).toEqual([])
  })

  it('counts the Subagent calls only for the Subagent, not for the Session', () => {
    const found = unknownSideEffects({ session: RECORD, events: [], subagents: [{ agentId: 'a-free', lines: lines('unbound-merge.jsonl') }], workflow: WORKFLOW })
    expect(found.session).toEqual([])
    expect(found.subagents).toHaveLength(1)
  })
})

// The fixtures of test/unit/continue-plan.test.ts, one of each kind: the classification is externalActions' own.
const COMMANDS: readonly string[] = [
  'git push origin main',
  'git commit -m fix',
  'git reset --hard HEAD~1',
  'gh pr merge 12',
  'gh pr create --fill',
  'gh api -X POST repos/o/r/issues -f title=x',
  'curl -d x https://example.com',
  'npm publish',
  `bash -c 'git push'`,
  'git config alias.p push && git p',
  'make deploy',
  './deploy.sh',
  'docker build .',
  'irm @params',
  'git status',
  'git log --grep push',
  'gh pr view 12',
  'pnpm test 2>&1 | tail -5',
  'curl -fsSL https://example.com',
  // A script reads as local here, as in Auto-continue (spec, risk 9).
  'node scripts/x.mjs',
]
const TOOLS: readonly [string, unknown][] = [
  ['Read', { file_path: '/a' }],
  ['Write', { file_path: '/a', content: 'x' }],
  ['WebFetch', { url: 'https://example.com' }],
  ['Agent', { subagent_type: 'worfy:reviewer' }],
  ['Task', { subagent_type: 'general-purpose' }],
  ['SendMessage', { to: 'impl-03' }],
  ['mcp__worfy-canvas__list_nodes', {}],
  ['mcp__worfy-canvas__create_card', { title: 'x' }],
  ['mcp__worfy-browser__browser_read', {}],
  ['mcp__github__merge_pull_request', { pullNumber: 1 }],
  ['SomeNewTool', {}],
  ['PowerShell', { command: 'git push' }],
  ['commandExecution', { command: ['gh', 'pr', 'merge', '7'] }],
]
const CALLS: readonly [string, unknown][] = [...COMMANDS.map((command): [string, unknown] => ['Bash', { command }]), ...TOOLS]

describe('unknownSideEffects: the classification is externalActions', () => {
  const expected = (tool: string, input: unknown) => externalActions([use('t1', tool, input)])

  it('the fixtures hold external, unclassified and local calls', () => {
    const kinds = CALLS.map(([tool, input]) => {
      const [found] = expected(tool, input)
      return found === undefined ? 'local' : found.known ? 'external' : 'unclassified'
    })
    expect(new Set(kinds)).toEqual(new Set(['external', 'unclassified', 'local']))
  })

  it.each(CALLS)('a Session call of %s without a result reads as externalActions reads it', (tool, input) => {
    expect(ofSession([use('t1', tool, input)]).session).toEqual(expected(tool, input))
  })

  it.each(CALLS)('a Subagent call of %s without a result in its transcript reads as externalActions reads it', (tool, input) => {
    const want = expected(tool, input)
    const found = ofSubagents([{ agentId: 'a-x', lines: [useLine('t1', tool, input)] }])
    expect(found).toEqual(want.length === 0 ? [] : [{ agentId: 'a-x', ticket: null, calls: want }])
  })
})
