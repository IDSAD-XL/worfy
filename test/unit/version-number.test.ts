// worfy-update ticket 14: the version as the screen shows it, `<major>.<minor>.<N>` with N the build
// number (src/shared/version-number.ts), and the number of an Available update from GitHub's
// `ahead_by` (src/main/update/check.ts, src/main/update/github.ts). Without a number everything reads
// as the build version, as before the ticket.
import { describe, expect, it } from 'vitest'
import { checkForUpdate, type UpdateGitHub } from '../../src/main/update/check'
import { updateGitHub } from '../../src/main/update/github'
import { buildVersionTooltip, numberedBuilds, numberedVersion, versionLabel } from '../../src/shared/version-number'

describe('numberedVersion', () => {
  it('puts the build number in place of the patch and drops the SHA', () => {
    expect(numberedVersion('0.3.0+28753213', 1187)).toBe('0.3.1187')
    expect(numberedVersion('1.12.4+abcdef0123', 7)).toBe('1.12.7')
  })

  it('keeps .dirty: the build does not match its commit', () => {
    expect(numberedVersion('0.3.0+28753213.dirty', 1187)).toBe('0.3.1187.dirty')
  })

  it('shows the build version as before without a number (shallow clone, no git)', () => {
    expect(numberedVersion('0.3.0+28753213', undefined)).toBe('0.3.0+28753213')
    expect(numberedVersion('0.3.0+28753213', null)).toBe('0.3.0+28753213')
    expect(numberedVersion('0.3.0+28753213.dirty', undefined)).toBe('0.3.0+28753213.dirty')
  })

  it('leaves what is not a build version, and a number that is not a count, as it is', () => {
    expect(numberedVersion('0.3.0', 5)).toBe('0.3.0')
    expect(numberedVersion('', 5)).toBe('')
    expect(numberedVersion('aaaaaaa', 5)).toBe('aaaaaaa')
    expect(numberedVersion('0.3.0+28753213', 0)).toBe('0.3.0+28753213')
    expect(numberedVersion('0.3.0+28753213', 2.5)).toBe('0.3.0+28753213')
    expect(numberedVersion('0.3.0+28753213', -1)).toBe('0.3.0+28753213')
  })
})

describe('buildVersionTooltip', () => {
  it('names the full build version with its commit when the version shows numbered', () => {
    expect(buildVersionTooltip('0.3.0+28753213', 1187)).toBe('worfy 0.3.0+28753213')
  })

  it('says a dirty build does not match its commit', () => {
    expect(buildVersionTooltip('0.3.0+28753213.dirty', 1187)).toBe('worfy 0.3.0+28753213.dirty: built with uncommitted changes, not the same as its commit')
  })

  it('is absent without a number: the line is what it was', () => {
    expect(buildVersionTooltip('0.3.0+28753213', undefined)).toBeUndefined()
  })
})

describe('the numbered builds of an Update snapshot', () => {
  const RUNNING = { commit: 'a'.repeat(40), version: '0.3.0+aaaaaaa', number: 100 }
  const AVAILABLE = { sha: 'b'.repeat(40), version: '0.3.0+bbbbbbb', quiet: false, number: 104 }

  it('numbers this run, the copy the check saw run, the previous copy, the Available update and the build of its commit', () => {
    const builds = numberedBuilds({
      current: { version: '0.3.0+ccccccc', number: 99 },
      running: RUNNING,
      previous: { version: '0.3.0+eeeeeee', number: 97 },
      available: AVAILABLE,
      build: { sha: AVAILABLE.sha, version: '0.3.0+bbbbbbbb' },
    })
    expect(versionLabel('0.3.0+ccccccc', builds)).toBe('0.3.99')
    expect(versionLabel('0.3.0+eeeeeee', builds)).toBe('0.3.97')
    expect(versionLabel('0.3.0+aaaaaaa', builds)).toBe('0.3.100')
    expect(versionLabel('0.3.0+bbbbbbb', builds)).toBe('0.3.104')
    // The build in worfy's clone may name its SHA longer: it is the same commit.
    expect(versionLabel('0.3.0+bbbbbbbb', builds)).toBe('0.3.104')
  })

  it('names a version no build numbers, a build of another commit and an unnumbered update as they are', () => {
    const builds = numberedBuilds({ running: RUNNING, previous: { version: '0.3.0+eeeeeee' }, available: { ...AVAILABLE, number: undefined }, build: { sha: 'c'.repeat(40), version: '0.3.0+ccccccc' } })
    expect(versionLabel('0.3.0+eeeeeee', builds)).toBe('0.3.0+eeeeeee')
    expect(versionLabel('0.3.0+bbbbbbb', builds)).toBe('0.3.0+bbbbbbb')
    expect(versionLabel('0.3.0+ccccccc', builds)).toBe('0.3.0+ccccccc')
    expect(versionLabel('0.2.0+ddddddd', builds)).toBe('0.2.0+ddddddd')
    expect(versionLabel('0.3.0+aaaaaaa', numberedBuilds({ running: null, previous: null, available: null, build: {} }))).toBe('0.3.0+aaaaaaa')
  })

  it('does not give the number of the Available update to a ready build of another commit', () => {
    // A build of an older commit is still ready while the check found a newer head: it is not that head.
    const builds = numberedBuilds({ running: RUNNING, previous: null, available: AVAILABLE, build: { sha: 'c'.repeat(40), version: '0.3.0+ccccccc' } })
    expect(versionLabel('0.3.0+bbbbbbb', builds)).toBe('0.3.104')
    expect(versionLabel('0.3.0+ccccccc', builds)).toBe('0.3.0+ccccccc')
  })
})

const RUNNING_SHA = 'a'.repeat(40)
const HEAD = 'b1c2d3e4f5' + '0'.repeat(30)

/** A client whose comparison says `aheadBy`, or says nothing of it. */
function client(aheadBy: number | undefined): UpdateGitHub {
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
  return {
    headOfMain: () => ok(HEAD),
    ciOk: () => ok('success' as const),
    compare: () => ok({ status: 'ahead' as const, files: ['src/main/x.ts'], commits: [], ...(aheadBy === undefined ? {} : { aheadBy }) }),
    packageVersion: () => ok('0.3.0'),
  }
}

describe('the number of an Available update', () => {
  it('is the number of the copy that runs plus the commits the head is ahead by', async () => {
    const outcome = await checkForUpdate({ client: client(4), running: RUNNING_SHA, runningNumber: 1187, rolledBackFrom: null, manual: false })
    expect(outcome.available).toEqual({ sha: HEAD, version: '0.3.0+b1c2d3e', quiet: false, number: 1191 })
  })

  it('is absent when the copy that runs has no number, or GitHub did not say ahead_by', async () => {
    for (const outcome of [
      await checkForUpdate({ client: client(4), running: RUNNING_SHA, rolledBackFrom: null, manual: false }),
      await checkForUpdate({ client: client(undefined), running: RUNNING_SHA, runningNumber: 1187, rolledBackFrom: null, manual: false }),
    ]) {
      expect(outcome.available).toEqual({ sha: HEAD, version: '0.3.0+b1c2d3e', quiet: false })
      expect(outcome.available).not.toHaveProperty('number')
    }
  })
})

describe('ahead_by from GitHub', () => {
  /** A client over a fetch that answers the comparison with `body`; no network. */
  const github = (body: unknown) =>
    updateGitHub({ env: { WORFY_UPDATE_API: 'http://github.invalid' }, fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) })

  it('is read from the comparison', async () => {
    const read = await github({ status: 'ahead', ahead_by: 4, files: [], commits: [] }).compare(RUNNING_SHA, HEAD)
    expect(read).toEqual({ ok: true, value: { status: 'ahead', files: [], commits: [], aheadBy: 4 } })
  })

  it('is left out when absent or odd, and the comparison still reads', async () => {
    for (const ahead of [undefined, -1, 'four', 1.5]) {
      const read = await github({ status: 'ahead', ahead_by: ahead, files: [{ filename: 'src/a.ts' }], commits: [] }).compare(RUNNING_SHA, HEAD)
      expect(read).toEqual({ ok: true, value: { status: 'ahead', files: ['src/a.ts'], commits: [] } })
      expect(read.ok && read.value).not.toHaveProperty('aheadBy')
    }
  })
})
