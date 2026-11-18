// The level table of Health check and the worst level of a report (src/shared/health/severity.ts,
// worfy-auth-check ticket 03; spec: the levels table, Q2, Q3), and the state a row
// asks of the user (checkState, src/shared/ipc/first-run.ts).
import { describe, expect, it } from 'vitest'
import { severityOf, worstLevel } from '../../src/shared/health/severity'
import { checkIdSchema, checkState, type Check, type CheckId, type CheckStatus, type Severity } from '../../src/shared/ipc/first-run'

const level = (id: CheckId, githubProject = true, status: CheckStatus = 'fail'): Severity => severityOf({ id, status }, { githubProject })

describe('the level table (spec: the levels table)', () => {
  // Every row of the spec's table, with GitHub in play so gh and gh-auth read as the table's first case.
  const TABLE: [CheckId, Severity][] = [
    ['claude-login', 'critical'],
    ['git', 'critical'],
    ['node', 'critical'],
    ['harness', 'critical'],
    ['harness-scripts', 'critical'],
    ['git-bash', 'critical'],
    ['powershell', 'critical'],
    ['gh', 'critical'],
    ['gh-auth', 'critical'],
    ['github-access', 'critical'],
    ['claude-version', 'non-critical'],
    ['limits', 'non-critical'],
    ['windows', 'non-critical'],
    ['arch', 'non-critical'],
    ['jq', 'non-critical'],
    ['git-identity', 'non-critical'],
    ['worfy-update', 'non-critical'],
    ['legacy-harness', 'non-critical'],
    ['harness-dependencies', 'non-critical'],
    ['qmd', 'non-critical'],
    ['qmd-models', 'non-critical'],
    ['qmd-collections', 'non-critical'],
    ['codex-login', 'non-critical'],
    ['browser-profile', 'non-critical'],
    ['linked-machine', 'non-critical'],
  ]

  it('names every row id of the Epic', () => {
    expect(TABLE.map(([id]) => id).sort()).toEqual([...checkIdSchema.options].sort())
  })

  it.each(TABLE)('%s is %s', (id, expected) => {
    expect(level(id)).toBe(expected)
    expect(level(id, true, 'warn')).toBe(expected)
  })

  it('gh and gh-auth are critical only with a Project whose origin is on GitHub', () => {
    expect([level('gh', true), level('gh-auth', true)]).toEqual(['critical', 'critical'])
    expect([level('gh', false), level('gh-auth', false)]).toEqual(['non-critical', 'non-critical'])
  })

  it('the other rows do not depend on GitHub', () => {
    expect(level('git', false)).toBe('critical')
    expect(level('github-access', false)).toBe('critical')
    expect(level('qmd', true)).toBe('non-critical')
  })

  it('GitHub access is non-critical when github.account is empty and the token from the environment works', () => {
    expect(severityOf({ id: 'github-access', status: 'warn' }, { githubProject: true, environmentTokenOnly: true })).toBe('non-critical')
    expect(severityOf({ id: 'github-access', status: 'fail' }, { githubProject: true, environmentTokenOnly: false })).toBe('critical')
    // Only GitHub access reads the flag.
    expect(severityOf({ id: 'gh-auth', status: 'fail' }, { githubProject: true, environmentTokenOnly: true })).toBe('critical')
  })

  it('unknown is never critical', () => {
    for (const id of checkIdSchema.options) expect(level(id, true, 'unknown'), id).toBe('non-critical')
  })
})

describe('the worst level of a report (the Health check icon)', () => {
  const row = (status: CheckStatus, severity: Severity): Pick<Check, 'status' | 'severity'> => ({ status, severity })

  it('critical: a critical row is not ok', () => {
    expect(worstLevel({ checks: [row('ok', 'critical'), row('fail', 'critical'), row('warn', 'non-critical')] })).toBe('critical')
    expect(worstLevel({ checks: [row('warn', 'critical')] })).toBe('critical')
  })

  it('non-critical: only non-critical rows are not ok', () => {
    expect(worstLevel({ checks: [row('ok', 'critical'), row('fail', 'non-critical')] })).toBe('non-critical')
  })

  it('ok: every row is ok', () => {
    expect(worstLevel({ checks: [row('ok', 'critical'), row('ok', 'non-critical')] })).toBe('ok')
    expect(worstLevel({ checks: [] })).toBe('ok')
  })

  it('pending: no report yet, or "Check again" runs', () => {
    expect(worstLevel(null)).toBe('pending')
    expect(worstLevel({ checks: [row('fail', 'critical')] }, true)).toBe('pending')
  })

  it('an unknown row never makes it critical, whatever its severity says', () => {
    expect(worstLevel({ checks: [row('unknown', 'critical'), row('ok', 'critical')] })).toBe('non-critical')
  })
})

describe('the state a row asks of the user (checkState)', () => {
  const actions = (...list: Check['actions']): Check['actions'] => list

  it('ok and unknown are themselves, whatever the buttons', () => {
    expect(checkState({ status: 'ok', actions: actions({ id: 'use-login', label: 'Use alice', safe: true }) })).toBe('ok')
    expect(checkState({ status: 'unknown', actions: [] })).toBe('unknown')
  })

  it('a safe button makes the row fixable', () => {
    expect(checkState({ status: 'fail', actions: actions({ id: 'gh-login', label: 'Sign in…' }, { id: 'use-login', label: 'Use alice', safe: true }) })).toBe('fixable')
    expect(checkState({ status: 'warn', actions: actions({ id: 'use-login', label: 'Use alice', safe: true }) })).toBe('fixable')
  })

  it('a button without safe, and a row without a button, need the user', () => {
    expect(checkState({ status: 'fail', actions: actions({ id: 'gh-login', label: 'Sign in…' }) })).toBe('needs-user')
    expect(checkState({ status: 'fail', actions: [] })).toBe('needs-user')
  })
})
