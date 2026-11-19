// What the GitHub features tell Health check (worfy-auth-check ticket 07, src/main/github/github-health.ts): which of
// gh's reasons are a refused sign-in, the Project of a folder, one report per failure and an ok only after one.
import { describe, expect, it } from 'vitest'
import { accessDetail, githubHealth, isSignInFailure, projectOfFolder } from '../../src/main/github/github-health'
import type { FirstRunReport } from '../../src/shared/ipc/first-run'

describe('isSignInFailure', () => {
  it.each([
    'gh: Bad credentials (HTTP 401)',
    'HTTP 401: Requires authentication (https://api.github.com/graphql)',
    "no gh login for dev-me, the Project's GitHub account: no oauth token found for github.com account dev-me; run `gh auth login` and sign in as dev-me",
    'gh auth token -u dev-me printed no token; run `gh auth login` and sign in as dev-me',
    'To get started with GitHub CLI, please run:  gh auth login',
    'GraphQL: Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.',
  ])('takes %s as a refused sign-in', (reason) => {
    expect(isSignInFailure(reason)).toBe(true)
  })

  it.each([
    'error connecting to api.github.com',
    'HTTP 502: Bad Gateway (https://api.github.com/graphql)',
    'HTTP 503: Service Unavailable',
    'GitHub rate limit: 10 of 5000 left; the PR inbox waits until 2026-11-19T10:00:00Z',
    'API rate limit exceeded for user ID 1 (HTTP 403)',
    'gh not found (gh)',
    'Command failed: gh pr list (timeout)',
    '',
  ])('does not take %s as one', (reason) => {
    expect(isSignInFailure(reason)).toBe(false)
  })

  it('takes no reason as none', () => {
    expect(isSignInFailure(null)).toBe(false)
    expect(isSignInFailure(undefined)).toBe(false)
  })
})

describe('projectOfFolder', () => {
  const projects = [
    { id: 'ws', name: 'workspace', path: '/work/space' },
    { id: 'api', name: 'api', path: '/work/space/api' },
    { id: 'shop', name: 'shop', path: '/work/shop' },
  ]

  it('is the Project of its root, the deepest one holding a repository folder, and none outside every Project', () => {
    expect(projectOfFolder(projects, '/work/shop')).toEqual({ id: 'shop', name: 'shop' })
    expect(projectOfFolder(projects, '/work/space/web')).toEqual({ id: 'ws', name: 'workspace' })
    expect(projectOfFolder(projects, '/work/space/api')).toEqual({ id: 'api', name: 'api' })
    expect(projectOfFolder(projects, '/work/shopping')).toBeUndefined()
    expect(projectOfFolder(projects, '/elsewhere')).toBeUndefined()
  })
})

describe('githubHealth', () => {
  const TOKEN = `ghp_${'Ab3'.repeat(12)}`

  function setup(report: FirstRunReport | null = null) {
    const calls: unknown[][] = []
    const health = githubHealth({
      feature: 'PR inbox',
      reports: { reportFailure: (...args) => void calls.push(['fail', ...args]), reportOk: (...args) => void calls.push(['ok', ...args]), current: () => report },
      project: (root) => (root.startsWith('/p') ? { id: 'p', name: 'Project' } : undefined),
    })
    return { calls, health }
  }

  it('reports a refused sign-in once per reason, with the feature and the first line, without a token; ok once after it', () => {
    const { calls, health } = setup()
    health.answered('/p')
    health.failed('/p', `gh: Bad credentials (HTTP 401) ${TOKEN}\nmore text`)
    health.failed('/p', `gh: Bad credentials (HTTP 401) ${TOKEN}\nmore text`)
    health.failed('/p', 'error connecting to api.github.com')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 3)).toEqual(['fail', 'github-access', { id: 'p', name: 'Project' }])
    expect(calls[0]?.[3]).toBe('PR inbox: gh: Bad credentials (HTTP 401) [redacted]')
    expect(JSON.stringify(calls)).not.toContain(TOKEN)
    expect(String(calls[0]?.[4])).toContain('Health check')
    health.answered('/p')
    health.answered('/p')
    expect(calls[1]).toEqual(['ok', 'github-access', { id: 'p', name: 'Project' }])
    expect(calls).toHaveLength(2)
    // A new failure after the success is reported again.
    health.failed('/p', 'gh: Bad credentials (HTTP 401)')
    expect(calls).toHaveLength(3)
  })

  it('reports signInFailed whatever its words; a folder of no Project reports nothing', () => {
    const { calls, health } = setup()
    health.signInFailed('/p', "Not sent: the Project's Profile names no GitHub account (github.account)")
    health.failed('/elsewhere', 'gh: Bad credentials (HTTP 401)')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[3]).toContain('names no GitHub account')
  })

  it('reason is the detail of the Project\'s GitHub access row while it is not ok', () => {
    const row = (status: 'ok' | 'fail', detail: string) => ({ checkedAt: '2026-11-19T00:00:00Z', checks: [{ id: 'github-access' as const, group: 'Projects' as const, title: 'GitHub access', project: { id: 'p', name: 'Project' }, status, severity: 'critical' as const, detail, hint: '', command: null, actions: [], opensFirstRun: false as const }] })
    expect(setup(row('fail', 'no access to o/r as dev-me')).health.reason('/p')).toBe('no access to o/r as dev-me')
    expect(setup(row('ok', 'dev-me · o/r')).health.reason('/p')).toBeNull()
    expect(setup(null).health.reason('/p')).toBeNull()
    expect(accessDetail(row('fail', 'x'), 'other')).toBeNull()
  })
})
