// The review offer's probe and Health check (worfy-auth-check ticket 07, src/main/projects/review-offer.ts): the probe
// runs `review-history probe` with GH_TOKEN of the Profile's GitHub account (accountAuth over the gh stand-in,
// test/fixtures/gh/gh-stub.mjs). No gh login for that account, or a sign-in GitHub refused, puts the Project's GitHub
// access row out of `ok`; a probe that answered takes it back. Another failure — no origin on GitHub, a time limit,
// no network — is one line in the log, as before, and no message. The Harness script is a function here: nothing
// runs it and nothing reaches GitHub.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { githubHealth, type GithubHealth } from '../../src/main/github/github-health'
import { accountAuth } from '../../src/main/github/prs'
import type { HarnessLocation } from '../../src/main/harness/locate'
import { offerTeamReviewer, probeRunner, type ReviewOfferDeps } from '../../src/main/projects/review-offer'
import type { ProfileRun } from '../../src/main/workflow/profile'
import { removeTestTree } from '../remove'
import { ghWorld } from './gh-world'

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

const ROOT = '/projects/shop'
const ME = 'dev-me'
const HARNESS: HarnessLocation = { kind: 'plugin', binDir: '/harness/bin', gateDir: '/harness/gate', harnessHome: '/harness', checked: ['/legacy/epic-status', '/harness/bin/epic-status'] }

function recorder(): { calls: string[]; health: GithubHealth } {
  const calls: string[] = []
  const health = githubHealth({
    feature: 'team reviewer probe',
    reports: { reportFailure: (id, project, reason) => void calls.push(`fail ${id} ${project?.id ?? '-'} ${reason}`), reportOk: (id, project) => void calls.push(`ok ${id} ${project?.id ?? '-'}`), current: () => null },
    project: (root) => (root === ROOT ? { id: 'shop-1', name: 'shop' } : undefined),
  })
  return { calls, health }
}

/** The offer over a probe that runs accountAuth on the stand-in for `account`, then answers `answer` for the script. */
function offer(options: { account: string | null; answer: () => ProfileRun; health: GithubHealth; log: string[] }): { deps: ReviewOfferDeps; scriptEnvs: Record<string, string | undefined>[] } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-review-offer-')))
  temps.push(dir)
  const gh = ghWorld(join(dir, 'gh'), { accounts: [{ login: ME, token: 'gho_me_token' }] })
  const scriptEnvs: Record<string, string | undefined>[] = []
  const probe = probeRunner({
    harness: () => HARNESS,
    env: async () => ({ PATH: '/bin' }),
    ghEnv: async (root): Promise<Record<string, string>> => {
      const env = await accountAuth({ account: async () => options.account, run: gh.run })(dir)
      expect(root).toBe(ROOT)
      return env.GH_TOKEN === undefined ? {} : { GH_TOKEN: env.GH_TOKEN }
    },
    run: async (_script, _args, env) => {
      scriptEnvs.push(env)
      return options.answer()
    },
  })
  return {
    deps: { probe, answered: () => false, profileDir: async () => Promise.reject(new Error('no Profile folder')), emit: () => undefined, log: (line) => void options.log.push(line), health: options.health },
    scriptEnvs,
  }
}

const voice = (value: 'yes' | 'no'): ProfileRun => ({ code: 0, stdout: JSON.stringify({ voice: value, line: `voice: ${value}` }), stderr: '' })

describe('the review offer and Health check (worfy-auth-check ticket 07)', () => {
  it('no gh login for the Profile\'s account: the GitHub access row names it, and the probe does not run', async () => {
    const { calls, health } = recorder()
    const log: string[] = []
    const { deps, scriptEnvs } = offer({ account: 'dev-nobody', answer: () => voice('yes'), health, log })
    expect(await offerTeamReviewer(deps, 'shop-1', ROOT)).toBe(false)
    expect(scriptEnvs).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^fail github-access shop-1 team reviewer probe: no gh login for dev-nobody/u)
    expect(log.join('\n')).toContain('no gh login for dev-nobody')
  })

  it('a probe whose gh GitHub refused (exit code 3, 401) reports the row; the next probe that answers reports ok', async () => {
    const { calls, health } = recorder()
    const log: string[] = []
    let answer: ProfileRun = { code: 3, stdout: '', stderr: 'review-history: gh api failed: gh: Bad credentials (HTTP 401)\n' }
    const { deps, scriptEnvs } = offer({ account: ME, answer: () => answer, health, log })
    expect(await offerTeamReviewer(deps, 'shop-1', ROOT)).toBe(false)
    // The probe ran as the Profile's account: its token from gh's keyring, never in the reason.
    expect(scriptEnvs[0]?.GH_TOKEN).toBe('gho_me_token')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('Bad credentials (HTTP 401)')
    expect(calls.join('\n')).not.toContain('gho_me_token')

    answer = voice('no')
    expect(await offerTeamReviewer(deps, 'shop-1', ROOT)).toBe(false)
    expect(calls).toEqual([calls[0], 'ok github-access shop-1'])
  })

  it('a probe that failed for another reason reports nothing: no origin on GitHub, the time limit', async () => {
    const { calls, health } = recorder()
    const log: string[] = []
    let answer: ProfileRun = { code: 3, stdout: '', stderr: 'review-history: no origin on GitHub\n' }
    const { deps } = offer({ account: ME, answer: () => answer, health, log })
    await offerTeamReviewer(deps, 'shop-1', ROOT)
    answer = { code: null, stdout: '', stderr: '' }
    await offerTeamReviewer(deps, 'shop-1', ROOT)
    expect(calls).toEqual([])
    expect(log).toHaveLength(2)
  })

  it('a voice sends the offer and, with no failure before it, changes no row', async () => {
    const { calls, health } = recorder()
    const log: string[] = []
    const emitted: string[] = []
    const { deps } = offer({ account: ME, answer: () => voice('yes'), health, log })
    expect(await offerTeamReviewer({ ...deps, emit: (id) => void emitted.push(id) }, 'shop-1', ROOT)).toBe(true)
    expect(emitted).toEqual(['shop-1'])
    expect(calls).toEqual([])
  })
})
