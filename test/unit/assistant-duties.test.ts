// The duties of the Assistant (worfy-assistant ticket 07; spec, implementation decisions, duties; test decisions, seam A): items,
// a clock that is not the machine's and the settings in; out — what each duty shows and proposes, its counters, and
// whether it is paused. Fixture events take the shape of the events measurement (docs/product/proactive-runtime/), as
// in the tests of the attention core; the memory file and the Project's settings are real files in a temporary folder.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { AttentionEvent, AttentionItem } from '../../src/shared/assistant/attention'
import { BUILTIN_DUTIES, DUTY_ACTION_MODES, DUTY_COUNTERS, projectRuleDutyId, sourceDutyId, type DutyLook } from '../../src/shared/assistant/duties'
import { CHECK_KINDS } from '../../src/shared/assistant/schedule/settings'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { sessionAttention } from '../../src/main/assistant/core/sources'
import { attentionFileStore, attentionPaths } from '../../src/main/assistant/core/store'
import { Duties, IGNORED_AFTER_MS } from '../../src/main/assistant/duties/duties'
import { mainCiAttention, type MainCiObservation } from '../../src/main/assistant/duties/main-ci'
import { assistantMemoryPath, memoryFileStore } from '../../src/main/assistant/duties/memory'
import { projectRuleAttention } from '../../src/main/assistant/duties/rules'
import { readProjectAssistantRules, readProjectSettings, writeProjectAssistantRules, writeProjectSettings } from '../../src/main/projects/settings'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-duties-'))
afterAll(() => removeTree(temp))

const PROJECT = 'p-alpha'
const PROJECT_PATH = join(temp, 'work', 'alpha')
const MIN = 60_000
const HOUR = 60 * MIN

let roots = 0
/** A core and the duties over one data root of their own, with a clock the test moves by hand. */
function world(start = '2026-11-25T10:00:00Z') {
  let at = Date.parse(start)
  const now = (): number => at
  const root = join(temp, `root-${roots++}`)
  const projectDir = (id: string): string => join(root, 'projects', id)
  const duties = new Duties({ now, store: memoryFileStore(assistantMemoryPath(root)), projects: () => [PROJECT], projectRules: (id) => readProjectAssistantRules(projectDir(id), 'plugin') })
  const core = new AttentionCore({ now, store: attentionFileStore(attentionPaths(projectDir, root)), settings: () => ({ timeZone: 'UTC' }), projects: () => [PROJECT], dutyOf: (event) => duties.dutyOf(event) })
  const projectOf = (cwd: string): string | null => (cwd.startsWith(PROJECT_PATH) ? PROJECT : null)
  const session = sessionAttention(core, projectOf, now, () => false, () => duties.thresholdMs('work-stalled'))
  const look = (): DutyLook => duties.look([...core.items(null), ...core.items(PROJECT)])
  const shownOf = (duty: string): AttentionItem[] => look().shown.filter((each) => each.duty === duty).map((each) => each.item)
  const status = (duty: string) => look().duties.find((each) => each.id === duty)!
  return { now, add: (ms: number) => (at += ms), root, projectDir, duties, core, session, look, shownOf, status, projectOf, memory: () => JSON.parse(readFileSync(assistantMemoryPath(root), 'utf8')) }
}

/** CI of the main branch as an observation of it: red since `redSince`, after the PR that went in last. */
const red = (redSince: number, pr: { number: number; title: string } | null = { number: 2202, title: 'attention core in main' }): MainCiObservation => ({
  projectId: PROJECT,
  repo: 'acme/app',
  branch: 'main',
  state: 'red',
  commit: '897167a80',
  redSince,
  pr,
})

/** A Ticket that waits for the owner (rule (f) of the events measurement). */
const waits = (num: number, revision = 'r1'): AttentionEvent => ({
  source: 'ticket-waits',
  id: `worfy-x/${num}`,
  revision,
  projectId: PROJECT,
  subject: { kind: 'ticket', id: `worfy-x/${num}`, label: `worfy-x ${num}` },
  kind: 'waits',
  text: 'acceptance by the owner',
})

describe('a duty', () => {
  it('has a trigger, a scope, a mode for each action, the six counters and a pause', () => {
    const w = world()
    for (const duty of w.look().duties) {
      expect(duty.trigger).toBeDefined()
      expect(duty.scope.projects).toBe('all')
      expect(Object.keys(duty.modes).length).toBeGreaterThan(0)
      for (const mode of Object.values(duty.modes)) expect(DUTY_ACTION_MODES).toContain(mode)
      expect(Object.keys(duty.counters).sort()).toEqual([...DUTY_COUNTERS].sort())
      expect(Object.values(duty.counters).every((count) => count === 0)).toBe(true)
      expect(duty.paused).toBeNull()
    }
  })

  it('takes each of the four modes for an action, and a scope narrowed to some Projects', () => {
    const w = world()
    for (const mode of DUTY_ACTION_MODES) {
      w.duties.configure('main-ci-red', { modes: { 'fix-session': mode } })
      expect(w.status('main-ci-red').modes['fix-session']).toBe(mode)
    }
    w.duties.configure('waits-for-user', { projects: ['p-beta'] })
    expect(w.status('waits-for-user').scope.projects).toEqual(['p-beta'])
    w.core.ingest(waits(1))
    expect(w.shownOf('waits-for-user')).toEqual([])
    // A mode no duty knows is refused, and nothing changes.
    expect(() => w.duties.configure('main-ci-red', { modes: { 'fix-session': 'always' as never } })).toThrow()
    expect(w.status('main-ci-red').modes['fix-session']).toBe('hand-over')
  })
})

describe('the built-in duties', () => {
  it('are the general ones: work stands, CI of the main branch is red, waits for the user, the morning summary, one per outside source', () => {
    expect(BUILTIN_DUTIES.map((duty) => duty.id)).toEqual(['work-stalled', 'main-ci-red', 'waits-for-user', 'morning-summary', ...CHECK_KINDS.map(sourceDutyId)])
  })

  it('none of them names land, pc-main-red or gate', () => {
    expect(JSON.stringify(BUILTIN_DUTIES)).not.toMatch(/\bland\b|pc-main-red|\bgate\b/i)
  })
})

describe('CI of the main branch is red', () => {
  it('gives an item only after N minutes, N from the settings; the item names the PR after which it went red and proposes a fix Session', () => {
    const w = world()
    w.duties.configure('main-ci-red', { thresholdMinutes: 45 })
    const since = w.now()
    mainCiAttention(w.core, red(since), w.duties.thresholdMs('main-ci-red'))
    w.add(44 * MIN)
    // The next read of the branch finds it still red: the item stays due at N minutes from the first red run.
    mainCiAttention(w.core, red(since), w.duties.thresholdMs('main-ci-red'))
    w.core.tick()
    expect(w.shownOf('main-ci-red')).toEqual([])

    w.add(MIN)
    w.core.tick()
    const [shown] = w.look().shown.filter((each) => each.duty === 'main-ci-red')
    expect(shown?.item.pr).toEqual({ repo: 'acme/app', number: 2202, title: 'attention core in main' })
    expect(shown?.item.text).toContain('acme/app#2202')
    const fix = shown?.proposals.find((proposal) => proposal.action === 'fix-session')
    expect(fix).toEqual(expect.objectContaining({ mode: 'ask' }))
    expect(fix?.text).toContain('acme/app#2202')
    expect(fix?.text).toContain('main')

    // Green again: the item closes.
    mainCiAttention(w.core, { projectId: PROJECT, repo: 'acme/app', branch: 'main', state: 'green' }, w.duties.thresholdMs('main-ci-red'))
    expect(w.shownOf('main-ci-red')).toEqual([])
  })

  it('red for less than N minutes and green again gives nothing', () => {
    const w = world()
    mainCiAttention(w.core, red(w.now()), w.duties.thresholdMs('main-ci-red'))
    w.add(10 * MIN)
    mainCiAttention(w.core, { projectId: PROJECT, repo: 'acme/app', branch: 'main', state: 'green' }, w.duties.thresholdMs('main-ci-red'))
    w.add(HOUR)
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
  })
})

describe('a Session that is silent or waits for an answer', () => {
  it('longer than the threshold from the settings gives an item; shorter does not', () => {
    const w = world()
    w.duties.configure('work-stalled', { thresholdMinutes: 30 })
    w.session('s-1', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-1', { type: 'result', isError: false, interrupted: false, at: w.now() } as AgentEvent)
    w.add(29 * MIN)
    w.core.tick()
    expect(w.shownOf('work-stalled')).toEqual([])
    w.add(MIN)
    w.core.tick()
    expect(w.shownOf('work-stalled').map((item) => `${item.subject.id}:${item.kind}`)).toEqual(['s-1:waiting'])
  })

  it('a question waits for its answer: shown once it waited the threshold of «waits for the user», not before', () => {
    const w = world()
    w.duties.configure('waits-for-user', { thresholdMinutes: 20 })
    w.session('s-2', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-2', { type: 'question_request', requestId: 'q1', toolUseId: null, questions: [{ question: 'Which port?' }], at: w.now() } as AgentEvent)
    w.add(19 * MIN)
    expect(w.shownOf('waits-for-user')).toEqual([])
    w.add(MIN)
    expect(w.shownOf('waits-for-user').map((item) => `${item.subject.id}:${item.kind}`)).toEqual(['s-2:question'])
  })

  it('a Session that ended its turn is no item of any duty', () => {
    const w = world()
    w.session('s-3', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-3', { type: 'result', isError: false, interrupted: false, at: w.now() } as AgentEvent)
    expect(w.core.items(PROJECT).map((item) => item.kind)).toEqual(['turn-end'])
    expect(w.look().shown).toEqual([])
  })
})

describe('a Run that stopped and a PR that waits for the user', () => {
  it('give items of the built-in duties at once', () => {
    const w = world()
    w.core.ingest({ source: 'autopilot', id: 'run-1@2026-11-25T09:59:00Z:run-stopped', revision: 'a1', projectId: PROJECT, subject: { kind: 'run', id: 'run-1', label: 'Autopilot · worfy-x' }, kind: 'run-stopped', text: 'worfy-x: blocked-tickets' })
    w.core.ingest({ source: 'pr-inbox', id: 'acme/app#7:needs-review', revision: '2026-11-25T09:30:00Z', projectId: PROJECT, subject: { kind: 'pr', id: 'acme/app#7', label: 'acme/app#7 Fix' }, kind: 'needs-review', text: 'Needs your review: acme/app#7 Fix' })
    expect(w.shownOf('work-stalled').map((item) => item.kind)).toEqual(['run-stopped'])
    expect(w.shownOf('waits-for-user').map((item) => item.kind)).toEqual(['needs-review'])
    expect(w.core.items(PROJECT).map((item) => item.duty)).toEqual(['work-stalled', 'waits-for-user'])
  })
})

describe('a rule of the Project', () => {
  it('is kept in the Project settings, and «land finished, and the Orchestrator sleeps» raises an item', () => {
    const w = world()
    const rule = { id: 'land-then-asleep', title: 'land finished, and the Orchestrator sleeps', when: { task: 'land' }, quietMinutes: 10 }
    writeProjectAssistantRules(w.projectDir(PROJECT), [rule], 'plugin')
    // A Save of the Project settings dialog does not send the rules: they stay.
    writeProjectSettings(w.projectDir(PROJECT), readProjectSettings(w.projectDir(PROJECT), 'plugin'), 'plugin')
    expect(readProjectAssistantRules(w.projectDir(PROJECT), 'plugin')).toEqual([rule])
    expect(w.look().duties.map((duty) => duty.id)).toContain(projectRuleDutyId(PROJECT, rule.id))

    const rules = projectRuleAttention(w.core, (id) => w.duties.projectRules(id), w.projectOf, w.now)
    rules.session('orch', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    rules.session('orch', { type: 'subagent', phase: 'finished', taskId: 't-1', toolUseId: null, description: 'Land PR #2202 (N=373)', subagentType: null, status: 'completed', summary: null, isBackgrounded: true, at: w.now() } as AgentEvent)
    w.add(9 * MIN)
    w.core.tick()
    expect(w.look().shown).toEqual([])
    w.add(MIN)
    w.core.tick()
    const shown = w.look().shown.filter((each) => each.duty === projectRuleDutyId(PROJECT, rule.id))
    expect(shown.map((each) => `${each.item.subject.id}:${each.item.text}`)).toEqual(['orch:land finished, and the Orchestrator sleeps'])
  })

  it('does not raise an item when the Orchestrator went on within the quiet minutes', () => {
    const w = world()
    writeProjectAssistantRules(w.projectDir(PROJECT), [{ id: 'land-then-asleep', title: 'land finished, and the Orchestrator sleeps', when: { task: 'land' }, quietMinutes: 10 }], 'plugin')
    const rules = projectRuleAttention(w.core, (id) => w.duties.projectRules(id), w.projectOf, w.now)
    for (const sink of [rules.session, w.session]) sink('orch', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    rules.session('orch', { type: 'subagent', phase: 'finished', taskId: 't-1', toolUseId: null, description: 'land N=373', subagentType: null, status: 'completed', summary: null, isBackgrounded: true, at: w.now() } as AgentEvent)
    w.add(4 * MIN)
    w.session('orch', { type: 'result', isError: false, interrupted: false, at: w.now() } as AgentEvent)
    w.add(20 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT).filter((item) => item.source === 'rule')).toEqual([])
  })
})

describe('like and dislike', () => {
  it('after a dislike such items of this duty are no longer shown, and the memory file holds a rule; a deleted rule no longer acts', () => {
    const w = world()
    w.core.ingest(waits(1))
    const [item] = w.shownOf('waits-for-user')
    const rule = w.duties.rate(item!, 'dislike')
    expect(rule).toEqual(expect.objectContaining({ duty: 'waits-for-user', projectId: PROJECT, source: 'ticket-waits', kind: 'waits' }))
    expect(w.memory().rules).toEqual([expect.objectContaining({ id: rule!.id, duty: 'waits-for-user', text: expect.any(String) })])
    w.core.ingest(waits(2))
    expect(w.shownOf('waits-for-user')).toEqual([])
    // Another duty's items stay.
    w.core.ingest({ source: 'autopilot', id: 'run-1:x', revision: 'a', projectId: PROJECT, subject: { kind: 'run', id: 'run-1', label: 'run' }, kind: 'run-stopped', text: 'stopped' })
    expect(w.shownOf('work-stalled')).toHaveLength(1)
    expect(w.status('waits-for-user').counters).toEqual(expect.objectContaining({ shown: 1, disliked: 1 }))

    w.duties.deleteRule(rule!.id)
    expect(w.memory().rules).toEqual([])
    expect(w.shownOf('waits-for-user').map((each) => each.subject.id)).toEqual(['worfy-x/1', 'worfy-x/2'])
  })

  it('a like counts and breaks a run of dislikes', () => {
    const w = world()
    w.core.ingest(waits(1))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'like')
    expect(w.status('waits-for-user').counters).toEqual(expect.objectContaining({ shown: 1, liked: 1 }))
  })
})

describe('the counters and the pause', () => {
  it('count shown, accepted, declined and ignored once per item', () => {
    const w = world()
    for (const num of [1, 2, 3]) w.core.ingest(waits(num))
    const [one, two] = w.shownOf('waits-for-user')
    w.look()
    w.duties.react(one!, 'accepted')
    w.duties.react(two!, 'declined')
    w.duties.react(two!, 'declined')
    w.add(IGNORED_AFTER_MS)
    w.look()
    w.look()
    expect(w.status('waits-for-user').counters).toEqual({ shown: 3, accepted: 1, declined: 1, ignored: 1, liked: 0, disliked: 0 })
  })

  it('after N ignored proposals in a row the duty is paused, and that is seen', () => {
    const w = world()
    w.duties.setPauseAfter(3)
    for (const num of [1, 2, 3]) w.core.ingest(waits(num))
    w.look()
    w.add(IGNORED_AFTER_MS)
    const look = w.look()
    expect(look.duties.find((duty) => duty.id === 'waits-for-user')?.paused).toEqual({ at: w.now(), by: 'ignored' })
    expect(look.shown.filter((each) => each.duty === 'waits-for-user')).toEqual([])
    w.duties.resume('waits-for-user')
    expect(w.status('waits-for-user').paused).toBeNull()
    expect(w.shownOf('waits-for-user')).toHaveLength(3)
  })

  it('after N dislikes in a row the duty is paused; a like between them breaks the run', () => {
    const w = world()
    w.duties.setPauseAfter(3)
    const kinds = ['waits', 'blocked', 'other', 'more']
    const event = (n: number): AttentionEvent => ({ ...waits(n), kind: kinds[n]! })
    w.core.ingest(event(0))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'dislike')
    w.core.ingest(event(1))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'like')
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'dislike')
    w.core.ingest(event(2))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'dislike')
    expect(w.status('waits-for-user').paused).toBeNull()
    w.core.ingest(event(3))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'dislike')
    expect(w.status('waits-for-user').paused).toEqual({ at: w.now(), by: 'disliked' })
    // The memory outlives a restart: a new Duties over the same file sees the pause and the rules.
    const again = new Duties({ now: w.now, store: memoryFileStore(assistantMemoryPath(w.root)), projectRules: () => [] })
    expect(again.look([]).duties.find((duty) => duty.id === 'waits-for-user')?.paused).toEqual({ at: w.now(), by: 'disliked' })
    expect(again.rules()).toHaveLength(4)
  })
})
