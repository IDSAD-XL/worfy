// The reader of the CI of a Project's main branch (worfy-assistant ticket 21): the `ci` source of the attention core for
// the duty «CI of the main branch is red». In: recorded answers of `gh api graphql` (test/fixtures/assistant-main-ci/),
// a clock that is not the machine's, the duties and the scheduler of checks; out — what reaches mainCiAttention, the
// items of the core, the log, and whether the check is registered. No test runs the real gh or reaches the network.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { attentionFileStore, attentionPaths } from '../../src/main/assistant/core/store'
import { Duties } from '../../src/main/assistant/duties/duties'
import { followMainCiDuty, MAIN_CI_KIND, mainCiCheck, type MainCiCheckOptions } from '../../src/main/assistant/duties/main-ci-check'
import { assistantMemoryPath, memoryFileStore } from '../../src/main/assistant/duties/memory'
import { CheckScheduler, memoryCheckMarks, type CheckRun } from '../../src/main/assistant/schedule/scheduler'
import { MAIN_CI_HISTORY, readMainBranchCi } from '../../src/main/github/main-ci'
import { removeTree } from '../../src/main/storage/remove'
import { ASSISTANT_CHECK_DEFAULTS, SOURCE_CHECK_KINDS, type AssistantScheduleSettings, type CheckKind } from '../../src/shared/assistant/schedule/settings'
import { ATTENTION_SOURCES, attentionSourceSchema } from '../../src/shared/assistant/attention'

const temp = mkdtempSync(join(tmpdir(), 'worfy-main-ci-'))
afterAll(() => removeTree(temp))

const MIN = 60_000
const PROJECT = 'p-alpha'
const ROOT = '/work/alpha'
const fixture = (name: 'red' | 'green'): string => readFileSync(join(__dirname, '..', 'fixtures', 'assistant-main-ci', `${name}.json`), 'utf8')
/** A recorded answer with each commit changed by `edit`. */
const edited = (name: 'red' | 'green', edit: (answer: { data: { repository: { defaultBranchRef: { name: string; target: { history: { nodes: Record<string, unknown>[] } } } | null } } }) => void): string => {
  const answer = JSON.parse(fixture(name))
  edit(answer)
  return JSON.stringify(answer)
}

let roots = 0
/** A core and the duties over one data root of their own, with a clock the test moves by hand. */
function world(start = '2026-11-25T09:58:00Z') {
  let at = Date.parse(start)
  const now = (): number => at
  const root = join(temp, `root-${roots++}`)
  const projectDir = (id: string): string => join(root, 'projects', id)
  const duties = new Duties({ now, store: memoryFileStore(assistantMemoryPath(root)), projects: () => [PROJECT] })
  const core = new AttentionCore({ now, store: attentionFileStore(attentionPaths(projectDir, root)), settings: () => ({ timeZone: 'UTC' }), projects: () => [PROJECT], dutyOf: (event) => duties.dutyOf(event) })
  const shown = () => duties.look([...core.items(null), ...core.items(PROJECT)]).shown.filter((each) => each.duty === 'main-ci-red')
  return { now, add: (ms: number) => (at += ms), duties, core, shown }
}

/** The check over one Project with repository acme/app, gh answering `answer`; the gh calls and the log lines kept. */
function check(w: ReturnType<typeof world>, answer: () => Promise<string>, options: Partial<MainCiCheckOptions> = {}) {
  const calls: { root: string; args: readonly string[] }[] = []
  const logged: string[] = []
  const made = mainCiCheck({
    projects: () => [{ id: PROJECT, root: ROOT }],
    repos: async () => ['acme/app'],
    gh: async (root, args) => {
      calls.push({ root, args })
      return answer()
    },
    core: w.core,
    thresholdMs: () => w.duties.thresholdMs('main-ci-red'),
    log: (message) => void logged.push(message),
    ...options,
  })
  const go = (): ReturnType<CheckRun> => made.run({ kind: MAIN_CI_KIND, since: null, now: w.now() })
  return { go, calls, logged, check: made }
}

type Check = { name: string; status?: string; conclusion?: string | null; completedAt?: string | null } | { context: string; state: string; createdAt?: string }

/** A commit of the history as gh gives it: its checks (none: CI skipped it) and the PR merged as it. */
function commit(oid: string, checks: readonly Check[] | null, pr?: { number: number; title: string }): Record<string, unknown> {
  return {
    oid,
    committedDate: '2026-11-25T08:00:00Z',
    statusCheckRollup: checks === null ? null : { contexts: { nodes: checks.map((each) => ('context' in each ? { __typename: 'StatusContext', ...each } : { __typename: 'CheckRun', status: 'COMPLETED', ...each })) } },
    associatedPullRequests: { nodes: pr === undefined ? [] : [{ ...pr, state: 'MERGED', baseRefName: 'main', mergeCommit: { oid } }] },
  }
}

/** A gh answer with the history `nodes`, newest first. */
const history = (...nodes: Record<string, unknown>[]): string => JSON.stringify({ data: { repository: { defaultBranchRef: { name: 'main', target: { history: { nodes } } } } } })

const passed = (name = 'test'): Check => ({ name, conclusion: 'SUCCESS', completedAt: '2026-11-25T08:10:00Z' })
const failed = (at: string, name = 'test'): Check => ({ name, conclusion: 'FAILURE', completedAt: at })
const cancelled = (name = 'test'): Check => ({ name, conclusion: 'CANCELLED', completedAt: '2026-11-25T09:05:00Z' })
const running = (name = 'test'): Check => ({ name, status: 'IN_PROGRESS', conclusion: null, completedAt: null })

describe('the read of the main branch from a recorded gh answer', () => {
  it('a red branch gives its first red commit, when it went red and the PR merged as that commit', async () => {
    const gh = vi.fn<(args: readonly string[]) => Promise<string>>(async () => fixture('red'))
    // The newest commit still runs its checks, the two before it failed, the one before them passed: the run of red
    // starts at c1, PR #10 (not the open #14 whose branch holds that commit too); a failing `review` mark is no CI.
    expect(await readMainBranchCi(gh, 'acme/app')).toEqual({
      repo: 'acme/app',
      branch: 'main',
      state: 'red',
      commit: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
      redSince: Date.parse('2026-11-25T09:20:00Z'),
      pr: { number: 10, title: 'Add the parser' },
    })
    const [args] = gh.mock.calls[0]!
    expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
    expect(args).toContain('owner=acme')
    expect(args).toContain('name=app')
    expect(args.join(' ')).toContain(`history(first: ${MAIN_CI_HISTORY})`)
    expect(args.join(' ')).not.toMatch(/\bmutation\b/u)
  })

  it('a green branch gives green: a commit without checks and a failed `deploy` mark do not count', async () => {
    expect(await readMainBranchCi(async () => fixture('green'), 'acme/app')).toEqual({ repo: 'acme/app', branch: 'main', state: 'green' })
  })

  it('the branch is the repository default one, and a red commit pushed without a PR has no PR', async () => {
    const answer = edited('red', (data) => {
      data.data.repository.defaultBranchRef!.name = 'trunk'
      for (const node of data.data.repository.defaultBranchRef!.target.history.nodes) node.associatedPullRequests = { nodes: [] }
    })
    expect(await readMainBranchCi(async () => answer, 'acme/app')).toMatchObject({ branch: 'trunk', state: 'red', commit: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1', pr: null })
  })

  it('no settled commit, or an empty repository, gives nothing to say', async () => {
    const running = edited('red', (data) => {
      const nodes = data.data.repository.defaultBranchRef!.target.history.nodes
      nodes.splice(1)
    })
    expect(await readMainBranchCi(async () => running, 'acme/app')).toBeNull()
    const empty = edited('red', (data) => {
      data.data.repository.defaultBranchRef = null
    })
    expect(await readMainBranchCi(async () => empty, 'acme/app')).toBeNull()
  })
})

describe('a run cancelled by a newer one, and the agents’ marks', () => {
  const read = (answer: string) => readMainBranchCi(async () => answer, 'acme/app')

  it('a commit whose only failures are cancelled runs says nothing: the commit before it decides', async () => {
    // green c0 → c1 cancelled by c2 (concurrency: cancel-in-progress) → c2 still running: green, not «red since PR #10».
    expect(await read(history(commit('c2', [running()]), commit('c1', [passed('lint'), cancelled()], { number: 10, title: 'Add the parser' }), commit('c0', [passed()])))).toEqual({
      repo: 'acme/app',
      branch: 'main',
      state: 'green',
    })
    // Only cancelled runs among the newest: nothing to say yet.
    expect(await read(history(commit('c1', [cancelled()]), commit('c0', [cancelled()])))).toBeNull()
  })

  it('a cancelled commit inside a red run neither ends it nor starts it; a real failure beside a cancelled run is red', async () => {
    const answer = history(
      commit('c3', [cancelled()]),
      commit('c2', [failed('2026-11-25T09:40:00Z')], { number: 11, title: 'Rename' }),
      commit('c1', [failed('2026-11-25T09:20:00Z'), cancelled('lint')], { number: 10, title: 'Add the parser' }),
      commit('c0', [passed()]),
    )
    expect(await read(answer)).toMatchObject({ state: 'red', commit: 'c1', redSince: Date.parse('2026-11-25T09:20:00Z'), pr: { number: 10 } })
  })

  it('the time the branch went red leaves the agents’ marks out: a failed `check/windows` or `review` before the CI failure does not count', async () => {
    const answer = history(
      commit('c1', [failed('2026-11-25T09:20:00Z'), { context: 'check/windows', state: 'FAILURE', createdAt: '2026-11-25T09:01:00Z' }, { context: 'review', state: 'FAILURE', createdAt: '2026-11-25T09:02:00Z' }]),
      commit('c0', [passed()]),
    )
    expect(await read(answer)).toMatchObject({ state: 'red', commit: 'c1', redSince: Date.parse('2026-11-25T09:20:00Z') })
  })
})

describe('the sources of the attention core', () => {
  it('main-ci is a kind of check, not a source of items: its items come from `ci`', () => {
    expect(ATTENTION_SOURCES).toContain('ci')
    expect(ATTENTION_SOURCES).not.toContain('main-ci')
    expect(attentionSourceSchema.safeParse('main-ci').success).toBe(false)
    for (const kind of SOURCE_CHECK_KINDS) expect(ATTENTION_SOURCES).toContain(kind)
  })
})

describe('a red condition without later reads', () => {
  it('a failed read disarms the pending red condition; the next red read arms it again for the same moment', async () => {
    const w = world()
    w.duties.configure('main-ci-red', { thresholdMinutes: 45 })
    let fail = false
    const { go } = check(w, async () => {
      if (fail) throw new Error('HTTP 502: Bad Gateway')
      return fixture('red')
    })
    await go()
    fail = true
    await go()
    // Due at 10:05 by the first read; the failed read left nothing armed.
    w.add(10 * MIN)
    w.core.tick()
    expect(w.shown()).toEqual([])
    fail = false
    await go()
    w.core.tick()
    expect(w.shown().map((each) => each.item.pr?.number)).toEqual([10])
  })

  it('a failed read keeps an item already raised: only the pending condition goes', async () => {
    const w = world()
    let fail = false
    const { go } = check(w, async () => {
      if (fail) throw new Error('HTTP 502: Bad Gateway')
      return fixture('red')
    })
    await go()
    w.core.tick()
    expect(w.shown()).toHaveLength(1)
    fail = true
    await go()
    w.core.tick()
    expect(w.shown()).toHaveLength(1)
  })

  it('a disarm while a run still reads: what the run armed before goes, and what it reads after arms nothing', async () => {
    const w = world()
    const pending: ((answer: string) => void)[] = []
    const { go, check: made, calls } = check(
      w,
      async () => {
        if (calls.length === 1) return fixture('red')
        return new Promise<string>((resolve) => void pending.push(resolve))
      },
      { repos: async () => ['acme/app', 'acme/lib', 'acme/tool'] },
    )
    const reading = go()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    made.disarm()
    pending[0]!(fixture('red'))
    // The read of acme/lib, answered after the disarm, arms nothing even for a moment: a tick now raises nothing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
    for (const answer of pending.slice(1)) answer(fixture('red'))
    await reading
    expect(calls).toHaveLength(2)
    w.add(24 * 60 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
  })

  it('a repository gone from the Project: its pending red condition goes with the next run', async () => {
    const w = world()
    w.duties.configure('main-ci-red', { thresholdMinutes: 45 })
    let repos = ['acme/app']
    const { go } = check(w, async () => fixture('red'), { repos: async () => repos })
    await go()
    repos = []
    await go()
    w.add(24 * 60 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
  })

  it('disabling the duty, stopping, or turning the check off disarms what the check armed', async () => {
    for (const how of ['duty', 'stop', 'setting'] as const) {
      const w = world()
      w.duties.configure('main-ci-red', { thresholdMinutes: 45 })
      const { go, check: made } = check(w, async () => fixture('red'))
      let on = true
      const listeners = new Set<() => void>()
      const setting = { enabled: () => on, onChange: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)) }
      const stop = followMainCiDuty({ register: () => () => undefined }, w.duties, made, setting)
      await go()
      if (how === 'duty') w.duties.configure('main-ci-red', { enabled: false })
      if (how === 'stop') stop()
      if (how === 'setting') {
        on = false
        for (const listener of listeners) listener()
      }
      w.add(60 * MIN)
      w.core.tick()
      expect(w.core.items(PROJECT), how).toEqual([])
      stop()
    }
  })
})

describe('the check of the main branch CI', () => {
  it('a red branch reaches mainCiAttention: the item comes after the duty threshold, names the PR, and green closes it', async () => {
    const w = world()
    w.duties.configure('main-ci-red', { thresholdMinutes: 45 })
    let answer = fixture('red')
    const { go, calls } = check(w, async () => answer)
    await go()
    expect(calls).toEqual([{ root: ROOT, args: expect.arrayContaining(['api', 'graphql']) }])
    // Red since 09:20, threshold 45 minutes: due at 10:05, not at 09:58.
    w.core.tick()
    expect(w.shown()).toEqual([])
    w.add(6 * MIN)
    w.core.tick()
    expect(w.shown()).toEqual([])
    w.add(MIN)
    await go()
    w.core.tick()
    const [shown] = w.shown()
    expect(shown?.item.source).toBe('ci')
    expect(shown?.item.pr).toEqual({ repo: 'acme/app', number: 10, title: 'Add the parser' })
    expect(shown?.proposals.find((proposal) => proposal.action === 'fix-session')?.text).toContain('acme/app#10')
    // One item per red run: the next read of the same red run raises nothing new.
    await go()
    w.add(60 * MIN)
    w.core.tick()
    expect(w.shown()).toHaveLength(1)

    answer = fixture('green')
    await go()
    expect(w.shown()).toEqual([])
  })

  it('a green branch gives no item', async () => {
    const w = world()
    const { go } = check(w, async () => fixture('green'))
    await go()
    w.add(24 * 60 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
  })

  it('a Project without a GitHub repository is not read and gives no item', async () => {
    const w = world()
    const { go, calls, logged } = check(w, async () => fixture('red'), { repos: async () => [] })
    await go()
    w.add(24 * 60 * MIN)
    w.core.tick()
    expect(calls).toEqual([])
    expect(logged).toEqual([])
    expect(w.core.items(PROJECT)).toEqual([])
  })

  it('a gh error, or no sign-in for the Project account, is written to the log once until it changes and gives no item', async () => {
    const w = world()
    let failure = new Error('no gh login for octo, the Project’s GitHub account')
    const { go, logged } = check(w, async () => {
      throw failure
    })
    await go()
    await go()
    expect(logged).toEqual([expect.stringMatching(/acme\/app.*no gh login for octo/u)])
    failure = new Error('HTTP 502: Bad Gateway')
    await go()
    expect(logged).toHaveLength(2)
    expect(logged[1]).toMatch(/acme\/app.*HTTP 502/u)
    // An answer gh gave but the reader cannot read is an error too, not an item.
    const garbled = check(w, async () => '{"data":{}}')
    await garbled.go()
    expect(garbled.logged).toEqual([expect.stringContaining('acme/app')])
    w.add(24 * 60 * MIN)
    w.core.tick()
    expect(w.core.items(PROJECT)).toEqual([])
  })

  it('one Project that fails does not stop the read of the next', async () => {
    const w = world()
    const { go, calls, logged } = check(w, async () => fixture('red'), {
      projects: () => [
        { id: 'p-broken', root: '/work/broken' },
        { id: PROJECT, root: ROOT },
      ],
      repos: async (root) => {
        if (root === '/work/broken') throw new Error('the layout could not be read')
        return ['acme/app']
      },
    })
    await go()
    expect(logged).toEqual([expect.stringContaining('the layout could not be read')])
    expect(calls.map((call) => call.root)).toEqual([ROOT])
  })
})

describe('the schedule of the check', () => {
  /** A scheduler of checks that never waits on a real timer: a check due now goes at once, nothing goes later. */
  function scheduler(w: ReturnType<typeof world>, settings: AssistantScheduleSettings): CheckScheduler {
    const made = new CheckScheduler({ now: w.now, settings: () => settings, marks: memoryCheckMarks(), random: () => 0.5, setTimer: () => ({}), clearTimer: () => undefined })
    made.start()
    return made
  }

  it('is off by default: no gh call at all until the person turns the check on', async () => {
    expect(ASSISTANT_CHECK_DEFAULTS[MAIN_CI_KIND]).toEqual({ enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: false })
    const w = world()
    const gh = vi.fn(async () => fixture('red'))
    const run = mainCiCheck({ projects: () => [{ id: PROJECT, root: ROOT }], repos: async () => ['acme/app'], gh, core: w.core, thresholdMs: () => 0 })
    const stop = followMainCiDuty(scheduler(w, {}), w.duties, run)
    await Promise.resolve()
    expect(gh).not.toHaveBeenCalled()
    stop()
  })

  it('is registered in the scheduler of checks only while the duty «CI of the main branch is red» is enabled', async () => {
    const w = world()
    const registered: CheckKind[] = []
    const fake = {
      register: (kind: CheckKind) => {
        registered.push(kind)
        return () => void registered.splice(registered.indexOf(kind), 1)
      },
    }
    const run = { run: (async () => undefined) satisfies CheckRun, disarm: () => undefined }
    const stop = followMainCiDuty(fake, w.duties, run)
    expect(registered).toEqual([MAIN_CI_KIND])
    w.duties.configure('main-ci-red', { enabled: false })
    expect(registered).toEqual([])
    // Another duty's change does not register it again.
    w.duties.configure('work-stalled', { thresholdMinutes: 20 })
    expect(registered).toEqual([])
    w.duties.configure('main-ci-red', { enabled: true })
    expect(registered).toEqual([MAIN_CI_KIND])
    w.duties.configure('main-ci-red', { thresholdMinutes: 40 })
    expect(registered).toEqual([MAIN_CI_KIND])
    stop()
    expect(registered).toEqual([])
    // Stopped: a later change of the duty registers nothing.
    w.duties.configure('main-ci-red', { enabled: false })
    w.duties.configure('main-ci-red', { enabled: true })
    expect(registered).toEqual([])
  })

  it('with the check turned on, the scheduler runs it while the duty is enabled, and not once the duty is disabled', async () => {
    const w = world()
    const gh = vi.fn(async () => fixture('green'))
    const run = mainCiCheck({ projects: () => [{ id: PROJECT, root: ROOT }], repos: async () => ['acme/app'], gh, core: w.core, thresholdMs: () => 0 })
    w.duties.configure('main-ci-red', { enabled: false })
    const on = scheduler(w, { assistantSchedule: { checks: { [MAIN_CI_KIND]: { enabled: true } } } })
    const stop = followMainCiDuty(on, w.duties, run)
    expect(on.runNow(MAIN_CI_KIND)).toBe(false)
    expect(gh).not.toHaveBeenCalled()
    // Enabled: a kind that never ran goes at once.
    w.duties.configure('main-ci-red', { enabled: true })
    await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(on.running(MAIN_CI_KIND)).toBe(false))
    w.duties.configure('main-ci-red', { enabled: false })
    expect(on.nextRun(MAIN_CI_KIND)).toBeNull()
    expect(on.runNow(MAIN_CI_KIND)).toBe(false)
    stop()
    on.stop()
  })
})
