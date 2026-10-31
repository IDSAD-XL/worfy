// The decision of the Update check (worfy-update ticket 01, spec R2–R4) over a fake GitHub client:
// no network. And the schedule of the checks, on fake timers.
import { win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changesApp, checkForUpdate, UpdateChecks, type CheckOutcome, type UpdateGitHub } from '../../src/main/update/check'
import { runningOf, stableCopyPath, updateEnabled } from '../../src/main/update/stable-copy'

const RUNNING = 'a'.repeat(40)
const HEAD = 'b1c2d3e4f5' + '0'.repeat(30)
const AT = new Date('2026-10-31T10:00:00.000Z')

interface FakeAnswers {
  head?: string
  ciOk?: 'success' | 'pending' | 'failure' | 'missing'
  status?: 'ahead' | 'behind' | 'diverged' | 'identical' | 'missing'
  files?: string[]
  version?: string
  /** A read that is skipped, with its reason. */
  skip?: keyof UpdateGitHub
}

/** A client answering from `answers`, counting its reads by name. */
function fakeClient(answers: FakeAnswers): UpdateGitHub & { reads: string[] } {
  const reads: string[] = []
  const answer = <T>(name: keyof UpdateGitHub, value: T) => {
    reads.push(name)
    return Promise.resolve(answers.skip === name ? { ok: false as const, reason: `${name}: HTTP 403` } : { ok: true as const, value })
  }
  return {
    reads,
    headOfMain: () => answer('headOfMain', answers.head ?? HEAD),
    ciOk: () => answer('ciOk', answers.ciOk ?? 'success'),
    compare: () =>
      answer(
        'compare',
        answers.status === 'missing' ? null : { status: answers.status ?? 'ahead', files: answers.files ?? ['src/main/x.ts'], commits: [{ sha: HEAD, message: 'feat: x (#1)' }] },
      ),
    packageVersion: () => answer('packageVersion', answers.version ?? '0.4.0'),
  }
}

async function check(answers: FakeAnswers, extra: { rolledBackFrom?: string | null; manual?: boolean; running?: string } = {}): Promise<CheckOutcome> {
  return checkForUpdate({ client: fakeClient(answers), running: extra.running ?? RUNNING, rolledBackFrom: extra.rolledBackFrom ?? null, manual: extra.manual ?? false, now: () => AT })
}

describe('the Update check', () => {
  it('finds no Update when only documents changed, and one when the app did', async () => {
    expect((await check({ files: ['docs/a.md'] })).available).toBeNull()
    expect((await check({ files: ['docs/a.md', '.scratch/x/spec.md', 'HANDOFF.md'] })).available).toBeNull()
    expect((await check({ files: ['docs/a.md', '.scratch/x/spec.md', 'HANDOFF.md', 'src/main/x.ts'] })).available).toEqual({ sha: HEAD, version: '0.4.0+b1c2d3e', quiet: false })
    expect((await check({ files: ['HANDOFF.md', 'harness/skills/x/SKILL.md'] })).available).not.toBeNull()
  })

  it('counts a list of 300 files as changing the app: GitHub cuts the list there', async () => {
    const files = Array.from({ length: 300 }, (_, n) => `docs/page-${n}.md`)
    expect((await check({ files })).available).not.toBeNull()
    expect(changesApp(files.slice(0, 299))).toBe(false)
  })

  it('reads only the paths outside docs, .scratch, test, .github and the Markdown files of the root as the app', () => {
    expect(changesApp(['test/unit/x.test.ts', '.github/workflows/ci.yml', 'README.md', 'CONTEXT.md'])).toBe(false)
    expect(changesApp(['scripts/install-stable.mjs'])).toBe(true)
    expect(changesApp(['src/README.md'])).toBe(true)
    expect(changesApp(['package.json'])).toBe(true)
  })

  it('finds no Update when the head of main is the running commit, after one read', async () => {
    const client = fakeClient({ head: RUNNING })
    const outcome = await checkForUpdate({ client, running: RUNNING, rolledBackFrom: null, manual: false, now: () => AT })
    expect(outcome).toEqual({ lastCheck: { at: AT.toISOString(), result: 'ok' }, available: null })
    expect(client.reads).toEqual(['headOfMain'])
    // The short SHA of a build version names the same commit.
    expect((await check({ head: RUNNING }, { running: RUNNING.slice(0, 7) })).available).toBeNull()
  })

  it.each(['pending', 'failure', 'missing'] as const)('finds no Update while ci-ok on the head is %s', async (ciOk) => {
    const outcome = await check({ ciOk })
    expect(outcome.lastCheck.result).toBe('ok')
    expect(outcome.available).toBeNull()
  })

  it.each(['diverged', 'behind', 'identical', 'missing'] as const)('finds no Update when the comparison is %s', async (status) => {
    expect((await check({ status })).available).toBeNull()
  })

  it('marks the Update quiet when the head is the commit rolled back from, unless the check was asked for', async () => {
    expect((await check({}, { rolledBackFrom: HEAD })).available?.quiet).toBe(true)
    expect((await check({}, { rolledBackFrom: HEAD, manual: true })).available?.quiet).toBe(false)
    expect((await check({}, { rolledBackFrom: RUNNING })).available?.quiet).toBe(false)
  })

  it.each(['headOfMain', 'ciOk', 'compare', 'packageVersion'] as const)('is skipped with the reason when %s is not answered', async (skip) => {
    const outcome = await check({ skip })
    expect(outcome).toEqual({ lastCheck: { at: AT.toISOString(), result: 'skipped', reason: `${skip}: HTTP 403` } })
  })

  it('is skipped when the running commit is not known', async () => {
    const outcome = await check({}, { running: '' })
    expect(outcome.lastCheck.result).toBe('skipped')
  })
})

describe('updateEnabled', () => {
  const home = '/Users/u'
  const mac = { platform: 'darwin' as const, home, env: {} }
  const copy = '/Users/u/Applications/worfy-stable.app'

  it('is off in a dev build and on in the packaged Stable copy', () => {
    expect(updateEnabled({ ...mac, packaged: false, execPath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' })).toBe(false)
    expect(updateEnabled({ ...mac, packaged: false, execPath: `${copy}/Contents/MacOS/worfy` })).toBe(false)
    expect(updateEnabled({ ...mac, packaged: true, execPath: `${copy}/Contents/MacOS/worfy` })).toBe(true)
  })

  it('is off in a packaged build elsewhere', () => {
    expect(updateEnabled({ ...mac, packaged: true, execPath: '/tmp/x.app/Contents/MacOS/worfy' })).toBe(false)
    expect(updateEnabled({ ...mac, packaged: true, execPath: '/Users/u/Applications/worfy-stable.app.old/Contents/MacOS/worfy' })).toBe(false)
  })

  it('is on with WORFY_UPDATE=1, as e2e runs the unpacked build', () => {
    expect(updateEnabled({ ...mac, env: { WORFY_UPDATE: '1' }, packaged: false, execPath: '/repo/Electron' })).toBe(true)
    expect(updateEnabled({ ...mac, env: { WORFY_UPDATE: '0' }, packaged: false, execPath: '/repo/Electron' })).toBe(false)
  })

  it('takes the Stable copy from WORFY_UPDATE_STABLE', () => {
    const env = { WORFY_UPDATE_STABLE: '/tmp/t/worfy-stable.app' }
    expect(stableCopyPath('darwin', env, home)).toBe('/tmp/t/worfy-stable.app')
    expect(updateEnabled({ ...mac, env, packaged: true, execPath: '/tmp/t/worfy-stable.app/Contents/MacOS/worfy' })).toBe(true)
    expect(updateEnabled({ ...mac, env, packaged: true, execPath: `${copy}/Contents/MacOS/worfy` })).toBe(false)
  })

  it('reads Windows paths with the rules of Windows', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
    const windows = { platform: 'win32' as const, home: 'C:\\Users\\u', env }
    expect(stableCopyPath('win32', env, 'C:\\Users\\u')).toBe(win32.join('C:\\Users\\u\\AppData\\Local', 'worfy-stable'))
    expect(stableCopyPath('win32', {}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\worfy-stable')
    expect(updateEnabled({ ...windows, packaged: true, execPath: 'C:\\Users\\u\\AppData\\Local\\worfy-stable\\worfy.exe' })).toBe(true)
    // Windows does not tell letters apart by case.
    expect(updateEnabled({ ...windows, packaged: true, execPath: 'c:\\users\\U\\appdata\\local\\WORFY-STABLE\\worfy.exe' })).toBe(true)
    expect(updateEnabled({ ...windows, packaged: true, execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\worfy\\worfy.exe' })).toBe(false)
    expect(updateEnabled({ ...windows, packaged: false, execPath: 'C:\\Users\\u\\AppData\\Local\\worfy-stable\\worfy.exe' })).toBe(false)
  })
})

describe('the running commit', () => {
  it('is the commit of the file next to the copy, or the SHA of the build version without it', () => {
    expect(runningOf({ commit: RUNNING }, '0.3.0+1415059')).toEqual({ commit: RUNNING, version: '0.3.0+1415059' })
    expect(runningOf(undefined, '0.3.0+1415059')).toEqual({ commit: '1415059', version: '0.3.0+1415059' })
    expect(runningOf(undefined, '0.3.0+1415059.dirty')).toEqual({ commit: '1415059', version: '0.3.0+1415059.dirty' })
    expect(runningOf({ commit: 'not a sha' }, '0.3.0')).toEqual({ commit: '', version: '0.3.0' })
  })
})

describe('the schedule of the checks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks 10 s after the start and then every hour, one check at a time, until stopped', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const checks = new UpdateChecks(run)
    const stop = checks.start()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(run).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    // A scheduled check asked for while one runs gets that one's result.
    const joined = checks.now()
    expect(run).toHaveBeenCalledTimes(1)
    release?.()
    await joined
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(2)
    release?.()
    stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs a check asked for by the user after the scheduled one that runs, once for every asker', async () => {
    const calls: boolean[] = []
    const releases: (() => void)[] = []
    const checks = new UpdateChecks(
      (manual) =>
        new Promise<void>((resolve) => {
          calls.push(manual)
          releases.push(resolve)
        }),
    )
    const scheduled = checks.now(false)
    await vi.waitFor(() => expect(calls).toEqual([false]))
    const asked = [checks.now(true), checks.now(true)]
    expect(calls).toEqual([false])
    releases.shift()?.()
    await scheduled
    await vi.waitFor(() => expect(calls).toEqual([false, true]))
    // A check asked for while one asked for runs joins it.
    const third = checks.now(true)
    releases.shift()?.()
    await Promise.all([...asked, third])
    expect(calls).toEqual([false, true])
    expect(checks.checking).toBe(false)
  })

  it('neither throws nor rejects when the listener of its changes throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn(() => Promise.resolve())
    const checks = new UpdateChecks(run, () => {
      throw new Error('EISDIR: illegal operation on a directory, read')
    })
    let done: Promise<void> | undefined
    expect(() => {
      done = checks.now()
    }).not.toThrow()
    await expect(done).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
    expect(checks.checking).toBe(false)
    expect(errors).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })
})
