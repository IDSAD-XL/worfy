// The Health check report with the features' messages (src/main/first-run/health-reports.ts,
// worfy-auth-check ticket 03; spec: the solution, point 4, when to check, Q7, Q8). A clock of the test's
// own; the "network" is a re-check the test answers when it wants, so a test can tell what happened
// before any request answered.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HealthReports, RECHECK_AFTER_FAILURE_MS, RECHECK_ON_FOCUS_MS, type Recheck } from '../../src/main/first-run/health-reports'
import type { Check, CheckProject, FirstRunReport } from '../../src/shared/ipc/first-run'

const ALPHA: CheckProject = { id: 'alpha-0000000a', name: 'alpha' }
const BETA: CheckProject = { id: 'beta-0000000b', name: 'beta' }

const machineRow = (id: Check['id'], status: Check['status'], extra: Partial<Check> = {}): Check => ({
  id,
  group: 'Command-line tools',
  title: id,
  status,
  severity: 'critical',
  detail: status === 'ok' ? 'found' : 'not found',
  hint: '',
  command: null,
  actions: [],
  ...extra,
})
const accessRow = (project: CheckProject, status: Check['status'], detail = status === 'ok' ? 'alice, keyring' : 'no access'): Check => ({
  id: 'github-access',
  group: 'Projects',
  title: 'GitHub access',
  status,
  severity: 'critical',
  project,
  detail,
  hint: '',
  command: null,
  actions: [],
})
const report = (...checks: Check[]): FirstRunReport => ({ checks, checkedAt: new Date(0).toISOString() })
const rowOf = (from: FirstRunReport | null, id: Check['id'], project?: CheckProject): Check | undefined => from?.checks.find((check) => check.id === id && check.project?.id === project?.id)

/** A report with a clock the test moves, and every event it sends. */
function setup(start = 1_000_000) {
  let now = start
  const reports = new HealthReports(() => now)
  const events: FirstRunReport[] = []
  reports.subscribe((each) => events.push(each))
  return {
    reports,
    events,
    tick: (ms: number) => {
      now += ms
    },
  }
}

/** A re-check whose answers the test gives: each call waits until `answer` is called. */
function pendingRecheck() {
  const calls: (CheckProject | undefined)[] = []
  const waiting: ((check: Check | null) => void)[] = []
  const recheck: Recheck = (project) => {
    calls.push(project)
    return new Promise((resolve) => waiting.push(resolve))
  }
  return { recheck, calls, answer: (check: Check | null) => waiting.shift()?.(check) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportFailure and reportOk', () => {
  it('a failure message changes the report and sends the event at once, before any request answers', () => {
    const { reports, events } = setup()
    const network = pendingRecheck()
    reports.registerRecheck('github-access', network.recheck)
    reports.setChecks(report(machineRow('git', 'ok')))
    events.length = 0

    reports.reportFailure('github-access', ALPHA, 'GitHub answered 401 for IDSAD-XL/worfy as alice', 'Sign in again with gh auth login')

    // The re-check was asked, but nothing answered: the change came from the message alone.
    expect(network.calls).toEqual([ALPHA])
    expect(events).toHaveLength(1)
    expect(rowOf(events[0] ?? null, 'github-access', ALPHA)).toEqual({
      id: 'github-access',
      group: 'Projects',
      title: 'GitHub access',
      status: 'fail',
      severity: 'critical',
      project: ALPHA,
      detail: 'GitHub answered 401 for IDSAD-XL/worfy as alice',
      hint: 'Sign in again with gh auth login',
      command: null,
      actions: [],
      opensFirstRun: false,
    })
    expect(reports.current()).toEqual(events[0])
  })

  it('before any check, a message alone makes a report', () => {
    const { reports, events } = setup()
    expect(reports.current()).toBeNull()
    reports.reportFailure('browser-profile', ALPHA, 'The sign-in of profile "staging" expired', 'Sign in to the Browser of this profile')
    expect(events.map((each) => each.checks.map((check) => [check.id, check.status]))).toEqual([[['browser-profile', 'fail']]])
    expect(rowOf(reports.current(), 'browser-profile', ALPHA)).toMatchObject({ severity: 'non-critical', group: 'Projects', opensFirstRun: false })
  })

  it('reportOk takes a row only a message made away, without a check', () => {
    const { reports, events } = setup()
    reports.setChecks(report(machineRow('git', 'ok')))
    reports.reportFailure('linked-machine', undefined, 'The certificate of "studio" changed', 'Link it again by its code')
    expect(rowOf(reports.current(), 'linked-machine')?.status).toBe('fail')
    events.length = 0
    reports.reportOk('linked-machine', undefined)
    expect(rowOf(reports.current(), 'linked-machine')).toBeUndefined()
    expect(events).toHaveLength(1)
  })

  it('reportOk takes a checked row that is not ok to ok, without a check', async () => {
    const { reports } = setup()
    reports.registerNetworkRows(() => Promise.resolve([accessRow(ALPHA, 'fail')]))
    reports.setChecks(report(machineRow('git', 'ok')))
    await reports.checkNetwork()
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('fail')
    reports.reportOk('github-access', ALPHA)
    expect(rowOf(reports.current(), 'github-access', ALPHA)).toMatchObject({ status: 'ok', actions: [] })
  })

  it('a message over a checked row keeps its title and buttons; it is a row that never opens First run', () => {
    const { reports } = setup()
    reports.setChecks(report({ ...accessRow(ALPHA, 'ok'), actions: [{ id: 'gh-login', label: 'Sign in…' }] }))
    reports.reportFailure('github-access', ALPHA, 'no access to IDSAD-XL/worfy as alice', 'Ask for access')
    expect(rowOf(reports.current(), 'github-access', ALPHA)).toMatchObject({ status: 'fail', title: 'GitHub access', actions: [{ id: 'gh-login', label: 'Sign in…' }], opensFirstRun: false })
  })

  it('the newest word wins: a check that started after the message replaces it, one that started before does not', () => {
    const { reports, tick } = setup()
    const startedBefore = 1_000_000
    tick(1000)
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    tick(1000)
    reports.setChecks(report(accessRow(ALPHA, 'ok')), startedBefore)
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('fail')
    tick(1000)
    reports.setChecks(report(accessRow(ALPHA, 'ok')))
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('ok')
  })

  it('the same message twice sends one event', () => {
    const { reports, events } = setup()
    reports.reportFailure('codex-login', undefined, 'Codex is not signed in', 'Sign in to Codex')
    reports.reportFailure('codex-login', undefined, 'Codex is not signed in', 'Sign in to Codex')
    expect(events).toHaveLength(1)
  })
})

describe('the re-check after a failure message', () => {
  it('runs at most once a minute per Project', async () => {
    const { reports, tick } = setup()
    const network = pendingRecheck()
    reports.registerRecheck('github-access', network.recheck)
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    tick(10_000)
    reports.reportFailure('github-access', ALPHA, 'no access again', 'Ask for access')
    tick(RECHECK_AFTER_FAILURE_MS - 20_000)
    reports.reportFailure('github-access', ALPHA, 'still no access', 'Ask for access')
    expect(network.calls).toEqual([ALPHA])
    // Another Project has its own minute.
    reports.reportFailure('github-access', BETA, 'no access', 'Ask for access')
    expect(network.calls).toEqual([ALPHA, BETA])
    // A minute after the first one, while that re-check still runs, nothing starts a second one.
    tick(10_000)
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    expect(network.calls).toEqual([ALPHA, BETA])
    // Once it answered, the next message a minute later checks again.
    network.answer(accessRow(ALPHA, 'fail'))
    network.answer(accessRow(BETA, 'fail'))
    await settle()
    tick(RECHECK_AFTER_FAILURE_MS)
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    expect(network.calls).toEqual([ALPHA, BETA, ALPHA])
  })

  it('its answer replaces the message: a row that passes now is ok', async () => {
    const { reports, events } = setup()
    const network = pendingRecheck()
    reports.registerRecheck('github-access', network.recheck)
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    events.length = 0
    network.answer(accessRow(ALPHA, 'ok'))
    await settle()
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('ok')
    expect(events).toHaveLength(1)
  })

  it('without a registered re-check a message checks nothing', () => {
    const { reports } = setup()
    const other = pendingRecheck()
    reports.registerRecheck('github-access', other.recheck)
    reports.reportFailure('linked-machine', undefined, 'secrets unreadable', 'Link it again')
    expect(other.calls).toEqual([])
  })
})

describe('the focus of a worfy window (Q8)', () => {
  it('checks again only the rows not in ok whose last check is over 5 minutes old', async () => {
    const { reports, tick } = setup()
    const asked: string[] = []
    reports.registerRecheck('github-access', (project) => {
      asked.push(project?.name ?? 'machine')
      return Promise.resolve(accessRow(project ?? ALPHA, 'ok'))
    })
    reports.registerRecheck('git', () => {
      asked.push('git')
      return Promise.resolve(machineRow('git', 'ok'))
    })
    const gamma: CheckProject = { id: 'gamma-0000000c', name: 'gamma' }
    // alpha fails and beta is ok, both checked now; gamma fails, checked later.
    reports.registerNetworkRows(() => Promise.resolve([accessRow(ALPHA, 'fail'), accessRow(BETA, 'ok')]))
    reports.setChecks(report(machineRow('git', 'ok')))
    await reports.checkNetwork()
    tick(RECHECK_ON_FOCUS_MS - 60_000)
    reports.reportFailure('github-access', gamma, 'no access', 'Ask for access')
    asked.length = 0

    // Not yet 5 minutes: nothing is checked.
    await reports.focus()
    expect(asked).toEqual([])

    // alpha's last check is over 5 minutes old; beta is ok; gamma's word is a minute old.
    tick(120_000)
    await reports.focus()
    expect(asked).toEqual(['alpha'])
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('ok')

    // Just checked: the next focus asks nothing.
    await reports.focus()
    expect(asked).toEqual(['alpha'])
  })

  it('a row whose re-check still runs is not checked a second time by the next focus', async () => {
    const { reports, tick } = setup()
    const network = pendingRecheck()
    reports.registerRecheck('github-access', network.recheck)
    reports.registerNetworkRows(() => Promise.resolve([accessRow(ALPHA, 'fail')]))
    reports.setChecks(report(machineRow('git', 'ok')))
    await reports.checkNetwork()
    tick(RECHECK_ON_FOCUS_MS + 1)
    const first = reports.focus()
    void reports.focus()
    expect(network.calls).toEqual([ALPHA])
    network.answer(accessRow(ALPHA, 'fail'))
    await first
    // Answered: the row was just checked, so a later focus waits its 5 minutes again.
    tick(RECHECK_ON_FOCUS_MS + 1)
    void reports.focus()
    expect(network.calls).toEqual([ALPHA, ALPHA])
  })

  it('a row with no re-check of its own is left for "Check again"', async () => {
    const { reports, tick } = setup()
    reports.setChecks(report(machineRow('jq', 'fail', { severity: 'non-critical' })))
    tick(RECHECK_ON_FOCUS_MS * 2)
    await reports.focus()
    expect(rowOf(reports.current(), 'jq')?.status).toBe('fail')
  })
})

describe('rows checked over the network', () => {
  it('"Check again" keeps a row only a re-check made; a source that answers for it now replaces it', async () => {
    const { reports } = setup()
    reports.registerRecheck('github-access', (project) => Promise.resolve(accessRow(project ?? ALPHA, 'fail', 'still no access')))
    let answer: Check[] = []
    reports.registerNetworkRows(() => Promise.resolve(answer))
    reports.setChecks(report(machineRow('git', 'ok')))
    reports.reportFailure('github-access', ALPHA, 'no access', 'Ask for access')
    await settle()
    expect(rowOf(reports.current(), 'github-access', ALPHA)).toMatchObject({ status: 'fail', detail: 'still no access' })

    reports.setChecks(report(machineRow('git', 'ok')))
    await reports.checkNetwork()
    expect(rowOf(reports.current(), 'github-access', ALPHA)).toMatchObject({ status: 'fail', detail: 'still no access' })

    answer = [accessRow(ALPHA, 'ok')]
    await reports.checkNetwork()
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.status).toBe('ok')
  })

  it('a source row that a re-check refreshed is still the source\'s: the next run without it drops it', async () => {
    const { reports, tick } = setup()
    reports.registerRecheck('github-access', (project) => Promise.resolve(accessRow(project ?? ALPHA, 'fail', 'rechecked')))
    let answer: Check[] = [accessRow(ALPHA, 'fail')]
    reports.registerNetworkRows(() => Promise.resolve(answer))
    reports.setChecks(report(machineRow('git', 'ok')))
    await reports.checkNetwork()
    tick(RECHECK_ON_FOCUS_MS + 1)
    await reports.focus()
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.detail).toBe('rechecked')
    answer = []
    await reports.checkNetwork()
    expect(rowOf(reports.current(), 'github-access', ALPHA)).toBeUndefined()
  })

  it('come after the local checks, never open First run, and a source that throws adds nothing', async () => {
    const { reports, events } = setup()
    reports.registerNetworkRows(() => Promise.resolve([{ ...accessRow(ALPHA, 'fail') }, machineRow('gh-auth', 'fail')]))
    reports.registerNetworkRows(() => Promise.reject(new Error('no network')))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const merged = reports.setChecks(report(machineRow('git', 'ok')))
    expect(merged.checks.map((check) => check.id)).toEqual(['git'])
    await reports.checkNetwork()
    expect(reports.current()?.checks.map((check) => [check.id, check.opensFirstRun])).toEqual([
      ['git', undefined],
      ['github-access', false],
      ['gh-auth', false],
    ])
    expect(events.at(-1)).toEqual(reports.current())
  })
})

describe('a token never reaches the report or the log', () => {
  it('a message carrying a known token in its reason and step: the token is in no event, report or log line', async () => {
    // Built here, so the source holds no token-shaped text for the personal-data check.
    const TOKEN = ['ghp', '0123456789abcdefABCDEF0123456789abcd'].join('_')
    const PAT = ['github', 'pat', '11ABCDEFG0123456789', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV'].join('_')
    const { reports, events } = setup()
    const output: unknown[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(...args))
    reports.registerRecheck('github-access', () => Promise.reject(new Error(`gh failed with GH_TOKEN=${TOKEN}`)))
    reports.setChecks(report(machineRow('git', 'ok')))
    reports.reportFailure('github-access', ALPHA, `GitHub refused the token ${TOKEN} (reasonmarker)`, `Unset GH_TOKEN=${PAT} or authorize it (stepmarker)`)
    await settle()

    const logged = JSON.stringify(output.map((each) => (each instanceof Error ? `${each.name} ${each.message}` : String(each))))
    const everything = JSON.stringify({ events, current: reports.current(), logged })
    expect(everything).not.toContain(TOKEN)
    expect(everything).not.toContain(PAT)
    // The module logs neither the reason nor the step, redacted or not: a secret of a shape
    // redactSecrets does not know would go out with them.
    expect(output.length).toBeGreaterThan(0)
    expect(logged).not.toContain('reasonmarker')
    expect(logged).not.toContain('stepmarker')
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.detail).toContain('reasonmarker')
    // The reason still reads: the variable's name stays, its value goes.
    expect(rowOf(reports.current(), 'github-access', ALPHA)?.hint).toContain('GH_TOKEN')
  })
})
