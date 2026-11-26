// The duties of the Assistant (worfy-assistant ticket 07; spec, implementation decisions, duties; test decisions, seam A): items,
// a clock that is not the machine's and the settings in; out — what each duty shows and proposes, its counters, and
// whether it is paused. Fixture events take the shape of the events measurement (docs/product/proactive-runtime/), as
// in the tests of the attention core; the memory file and the Project's settings are real files in a temporary folder.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { AttentionEvent, AttentionItem } from '../../src/shared/assistant/attention'
import { BUILTIN_DUTIES, DUTY_ACTION_ALLOWED_MODES, DUTY_ACTION_MODES, DUTY_COUNTERS, projectRuleDutyId, sourceDutyId, type DutyLook } from '../../src/shared/assistant/duties'
import { SOURCE_CHECK_KINDS } from '../../src/shared/assistant/schedule/settings'
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

  it('All Projects widens a narrowed scope back: the item outside it shows again (ticket 25)', () => {
    const w = world()
    w.duties.configure('waits-for-user', { projects: ['p-beta'] })
    w.core.ingest(waits(1))
    expect(w.shownOf('waits-for-user')).toEqual([])
    w.duties.configure('waits-for-user', { projects: 'all' })
    expect(w.status('waits-for-user').scope.projects).toBe('all')
    expect(w.shownOf('waits-for-user')).toHaveLength(1)
    w.duties.configure('waits-for-user', { projects: [PROJECT] })
    expect(w.shownOf('waits-for-user')).toHaveLength(1)
  })

  it('a threshold of null drops the user\'s one: back to the duty\'s own, none for a duty that has none (Undo, ticket 25)', () => {
    const w = world()
    w.duties.configure('waits-for-user', { thresholdMinutes: 60 })
    w.duties.configure('source:slack', { thresholdMinutes: 45 })
    expect(w.status('source:slack').thresholdMinutes).toBe(45)
    w.duties.configure('waits-for-user', { thresholdMinutes: null })
    w.duties.configure('source:slack', { thresholdMinutes: null })
    expect(w.status('waits-for-user').thresholdMinutes).toBe(15)
    expect(w.status('source:slack').thresholdMinutes).toBeNull()
  })
})

describe('the built-in duties', () => {
  it('are the general ones: work stands, CI of the main branch is red, waits for the user, the morning summary, one per outside source', () => {
    expect(BUILTIN_DUTIES.map((duty) => duty.id)).toEqual(['work-stalled', 'main-ci-red', 'waits-for-user', 'morning-summary', ...SOURCE_CHECK_KINDS.map(sourceDutyId)])
    // The check of the main branch's CI (ticket 21) feeds «CI of the main branch is red»: no duty of a source of its own.
    expect(BUILTIN_DUTIES.map((duty) => duty.id)).not.toContain('source:main-ci')
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

describe('review round 1', () => {
  it('a question after a turn-end of the same day waits its threshold from the question, not from the turn-end', () => {
    const w = world('2026-11-25T10:00:00Z')
    w.duties.configure('waits-for-user', { thresholdMinutes: 20 })
    w.session('s-5', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-5', { type: 'result', isError: false, interrupted: false, at: w.now() } as AgentEvent)
    w.add(2 * HOUR)
    w.session('s-5', { type: 'question_request', requestId: 'q5', toolUseId: null, questions: [{ question: 'Deploy?' }], at: w.now() } as AgentEvent)
    // Glued into the day's item of the Session, whose first event was the turn-end two hours ago.
    expect(w.core.items(PROJECT).filter((item) => item.condition === undefined)).toHaveLength(1)
    w.add(19 * MIN)
    expect(w.shownOf('waits-for-user')).toEqual([])
    w.add(MIN)
    expect(w.shownOf('waits-for-user').map((item) => `${item.subject.id}:${item.kind}`)).toEqual(['s-5:question'])
  })

  it('a threshold or a pause count beyond the limits of the memory file throws, and nothing changes', () => {
    const w = world()
    w.duties.configure('main-ci-red', { thresholdMinutes: 60 })
    expect(() => w.duties.configure('main-ci-red', { thresholdMinutes: 7 * 24 * 60 + 1 })).toThrow()
    expect(() => w.duties.setPauseAfter(101)).toThrow()
    expect(w.status('main-ci-red').thresholdMinutes).toBe(60)
    // The memory still writes: a dislike reaches the file.
    w.core.ingest(waits(1))
    w.duties.rate(w.shownOf('waits-for-user')[0]!, 'dislike')
    expect(w.memory().rules).toHaveLength(1)
    expect(w.memory().duties['main-ci-red'].thresholdMinutes).toBe(60)
    expect(w.memory().pauseAfter).toBeUndefined()
  })

  it('a rule of the Project started by an item hears the items of «nothing happened» conditions too', () => {
    const w = world()
    writeProjectAssistantRules(w.projectDir(PROJECT), [{ id: 'asleep-after-wait', title: 'still asleep after the wait', when: { item: { source: 'session', kind: 'waiting' } }, quietMinutes: 10 }], 'plugin')
    const rules = projectRuleAttention(w.core, (id) => w.duties.projectRules(id), w.projectOf, w.now)
    w.core.onItem(rules.item)
    w.session('s-6', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-6', { type: 'result', isError: false, interrupted: false, at: w.now() } as AgentEvent)
    w.add(15 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT).map((item) => item.kind)).toEqual(['turn-end', 'waiting'])
    w.add(10 * MIN)
    w.core.tick()
    expect(w.shownOf(projectRuleDutyId(PROJECT, 'asleep-after-wait')).map((item) => item.text)).toEqual(['still asleep after the wait'])
  })

  it('an item glued into another duty starts its counters anew in that duty', () => {
    const w = world()
    w.duties.setPauseAfter(100)
    w.session('s-7', { type: 'init', cwd: PROJECT_PATH } as AgentEvent)
    w.session('s-7', { type: 'question_request', requestId: 'q7', toolUseId: null, questions: [{ question: 'Port?' }], at: w.now() } as AgentEvent)
    w.add(15 * MIN)
    expect(w.shownOf('waits-for-user')).toHaveLength(1)
    w.session('s-7', { type: 'state', state: 'error', error: 'rate_limit', at: w.now() } as AgentEvent)
    expect(w.shownOf('work-stalled').map((item) => item.kind)).toEqual(['error'])
    expect(w.status('work-stalled').counters.shown).toBe(1)
    w.add(IGNORED_AFTER_MS)
    w.look()
    expect(w.status('waits-for-user').counters).toEqual(expect.objectContaining({ shown: 1, ignored: 0 }))
    expect(w.status('work-stalled').counters).toEqual(expect.objectContaining({ shown: 1, ignored: 1 }))
  })

  it('the default pause comes after five ignored proposals in a row, not four or six', () => {
    const w = world()
    for (const num of [1, 2, 3, 4]) w.core.ingest(waits(num))
    w.look()
    w.add(IGNORED_AFTER_MS)
    w.look()
    expect(w.status('waits-for-user').paused).toBeNull()
    w.core.ingest(waits(5))
    w.look()
    w.add(IGNORED_AFTER_MS)
    w.look()
    expect(w.status('waits-for-user').paused).toEqual({ at: w.now(), by: 'ignored' })
  })

  it.each(['accepted', 'declined'] as const)('a proposal %s ends the run of ignored ones', (reaction) => {
    const w = world()
    w.duties.setPauseAfter(3)
    for (const num of [1, 2]) w.core.ingest(waits(num))
    w.look()
    w.add(IGNORED_AFTER_MS)
    w.look()
    w.core.ingest(waits(3))
    w.duties.react(w.shownOf('waits-for-user').find((item) => item.subject.id === 'worfy-x/3')!, reaction)
    for (const num of [4, 5]) w.core.ingest(waits(num))
    w.look()
    w.add(IGNORED_AFTER_MS)
    w.look()
    expect(w.status('waits-for-user').counters.ignored).toBe(4)
    expect(w.status('waits-for-user').paused).toBeNull()
  })

  it('Dismiss of a shown item counts as declined', () => {
    const w = world()
    w.core.ingest(waits(1))
    const [item] = w.shownOf('waits-for-user')
    w.core.mark(PROJECT, item!.id, 'dismissed')
    w.look()
    expect(w.status('waits-for-user').counters).toEqual(expect.objectContaining({ shown: 1, declined: 1 }))
  })

  it('a Save of the Project settings keeps the saved rules, whatever its input says of them', () => {
    const w = world()
    const rule = { id: 'land-then-asleep', title: 'land finished, and the Orchestrator sleeps', when: { task: 'land' }, quietMinutes: 10 }
    writeProjectAssistantRules(w.projectDir(PROJECT), [rule], 'plugin')
    const rest = { ...readProjectSettings(w.projectDir(PROJECT), 'plugin') }
    delete rest.assistantRules
    expect(rest).not.toHaveProperty('assistantRules')
    writeProjectSettings(w.projectDir(PROJECT), rest, 'plugin')
    expect(readProjectAssistantRules(w.projectDir(PROJECT), 'plugin')).toEqual([rule])
    writeProjectSettings(w.projectDir(PROJECT), { ...rest, assistantRules: [] }, 'plugin')
    expect(readProjectAssistantRules(w.projectDir(PROJECT), 'plugin')).toEqual([rule])
  })
})

describe('pr-follow is never self (ticket 24, the owner\'s decision of 2026-11-26; ADR-0114, point 4)', () => {
  const prItem = (w: ReturnType<typeof world>): void =>
    void w.core.ingest({ source: 'pr-inbox', id: 'acme/app#7:needs-review', revision: '2026-11-25T09:30:00Z', projectId: PROJECT, subject: { kind: 'pr', id: 'acme/app#7', label: 'acme/app#7 Fix' }, kind: 'needs-review', text: 'Needs your review: acme/app#7 Fix' })
  const prFollowMode = (w: ReturnType<typeof world>) => w.look().shown.find((each) => each.duty === 'waits-for-user')!.proposals.find((each) => each.action === 'pr-follow')?.mode

  it('one list says which modes each action may have: pr-follow only ask or hand-over (ticket 26), the rest all four', () => {
    expect(DUTY_ACTION_ALLOWED_MODES['pr-follow']).toEqual(['ask', 'hand-over'])
    for (const [action, modes] of Object.entries(DUTY_ACTION_ALLOWED_MODES)) if (action !== 'pr-follow') expect(modes, action).toEqual(DUTY_ACTION_MODES)
    // Every built-in default is a mode its action may have.
    for (const duty of BUILTIN_DUTIES) for (const [action, mode] of Object.entries(duty.actions)) expect(DUTY_ACTION_ALLOWED_MODES[action as keyof typeof DUTY_ACTION_ALLOWED_MODES], `${duty.id} ${action}`).toContain(mode)
  })

  it('configure refuses self and pre-approved for pr-follow with a reason and changes nothing; ask, hand-over, and every mode of autopilot-start, are taken', () => {
    const w = world()
    w.duties.configure('waits-for-user', { modes: { 'pr-follow': 'hand-over' } })
    for (const mode of ['self', 'pre-approved'] as const) {
      expect(() => w.duties.configure('waits-for-user', { modes: { 'pr-follow': mode } })).toThrow(new RegExp(`pr-follow may not be ${mode}: it may be ask, hand-over`))
      expect(() => w.duties.configure('waits-for-user', { modes: { open: 'ask', 'pr-follow': mode } })).toThrow()
    }
    expect(w.status('waits-for-user').modes).toEqual({ open: 'hand-over', 'pr-follow': 'hand-over' })
    expect(w.memory().duties['waits-for-user'].modes).toEqual({ 'pr-follow': 'hand-over' })
    for (const mode of ['ask', 'hand-over'] as const) {
      w.duties.configure('waits-for-user', { modes: { 'pr-follow': mode } })
      expect(w.status('waits-for-user').modes['pr-follow']).toBe(mode)
    }
    for (const mode of DUTY_ACTION_MODES) {
      w.duties.configure('work-stalled', { modes: { 'autopilot-start': mode } })
      expect(w.status('work-stalled').modes['autopilot-start']).toBe(mode)
    }
  })

  it('a memory file that holds pre-approved for pr-follow, chosen before ticket 26, reads it as the default ask, with a line in the log', () => {
    const w = world()
    const file = assistantMemoryPath(w.root)
    mkdirSync(dirname(file), { recursive: true })
    const counters = { shown: 0, accepted: 0, declined: 0, ignored: 0, liked: 0, disliked: 0 }
    writeFileSync(file, JSON.stringify({ duties: { 'waits-for-user': { modes: { 'pr-follow': 'pre-approved', open: 'ask' }, counters, streak: 0 }, 'work-stalled': { modes: { 'autopilot-start': 'pre-approved' }, counters, streak: 0 } }, rules: [], items: {} }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      prItem(w)
      w.add(20 * MIN)
      expect(prFollowMode(w)).toBe('ask')
      expect(w.status('waits-for-user').modes).toEqual({ open: 'ask', 'pr-follow': 'ask' })
      expect(w.status('work-stalled').modes['autopilot-start']).toBe('pre-approved')
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/pr-follow: pre-approved/))
      expect(w.memory().duties['waits-for-user'].modes).toEqual({ open: 'ask' })
    } finally {
      warn.mockRestore()
    }
  })

  it('a memory file that holds self for pr-follow reads it as the default ask, with a line in the log; the rest of the file reads as written', () => {
    const w = world()
    const file = assistantMemoryPath(w.root)
    mkdirSync(dirname(file), { recursive: true })
    const counters = { shown: 0, accepted: 0, declined: 0, ignored: 0, liked: 0, disliked: 0 }
    writeFileSync(
      file,
      JSON.stringify({
        duties: {
          'waits-for-user': { modes: { 'pr-follow': 'self', open: 'ask' }, thresholdMinutes: 20, counters, streak: 0 },
          'work-stalled': { modes: { 'autopilot-start': 'self' }, counters, streak: 0 },
        },
        rules: [],
        items: {},
      }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      prItem(w)
      w.add(20 * MIN)
      expect(prFollowMode(w)).toBe('ask')
      expect(w.status('waits-for-user').modes).toEqual({ open: 'ask', 'pr-follow': 'ask' })
      expect(w.status('waits-for-user').thresholdMinutes).toBe(20)
      expect(w.status('work-stalled').modes['autopilot-start']).toBe('self')
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/pr-follow.*self/))
      // The look counted the item as shown and wrote the duties: the refused mode is no longer in the file.
      expect(w.memory().duties['waits-for-user'].modes).toEqual({ open: 'ask' })
      expect(w.memory().duties['work-stalled'].modes).toEqual({ 'autopilot-start': 'self' })
    } finally {
      warn.mockRestore()
    }
  })
})
