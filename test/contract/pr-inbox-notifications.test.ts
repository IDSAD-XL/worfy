// The notifications trigger of the PR inbox (worfy-pr-inbox ticket 08, src/main/github/inbox-notifications.ts)
// against the gh stand-in (test/fixtures/gh/gh-stub.mjs), which answers `gh api -i notifications…` as gh does: the
// status line and headers on stdout, and on a 304 `gh: HTTP 304` on stderr with exit code 1. A 304 is "nothing
// changed", a 200 refreshes the PRs of the Project it names, a 403 turns the trigger off with a notice, any other
// failure doubles the trigger's interval only. Nothing reaches GitHub: owners, repositories and logins are made up,
// and the stand-in's log shows the trigger only reads.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INBOX_SEARCH_INTERVAL_MS, PrInbox, type PrInboxOptions, type PrInboxProject } from '../../src/main/github/inbox'
import { NOTIFICATIONS_OFF_NOTICE, NOTIFICATIONS_PATH, notifiedPulls, parseNotificationsAnswer } from '../../src/main/github/inbox-notifications'
import { GhExitError } from '../../src/main/github/prs'
import { PR_INBOX_FILE, prInboxSetting, readNotificationsCursor, writeNotificationsCursor } from '../../src/main/projects/pr-inbox-state'
import { removeTestTree } from '../remove'
import { ghWorld, type GhWorld } from './gh-world'

beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-inbox-notifications-')))
  temps.push(dir)
  return dir
}

const ME = 'dev-me'
const API = 'demo-org/api'
const OTHER = 'demo-org/other'
const START = Date.parse('2026-11-10T09:00:00Z')
const SECOND = 1000
const MINUTE = 60_000
/** GitHub's Last-Modified of the notifications, as HTTP dates. */
const L0 = 'Tue, 10 Nov 2026 08:00:00 GMT'
const L1 = 'Tue, 10 Nov 2026 09:00:30 GMT'
const L2 = 'Tue, 10 Nov 2026 09:05:00 GMT'

/** A PR of mine the search finds, without threads. */
function stubPull(repo: string, number: number) {
  return {
    repo,
    number,
    updatedAt: '2026-11-10T08:00:00Z',
    headRefOid: `sha-${number}`,
    involves: true,
    pull: {
      title: `Change ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: '2026-11-09T08:00:00Z',
      author: { login: ME },
      headRefName: `feature/${number}`,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { nodes: [] },
      comments: { nodes: [] },
    },
  }
}

/** A notification thread as GET /notifications lists it. */
function thread(repo: string, type: string, number: number, updatedAt: string) {
  const kind = type === 'PullRequest' ? 'pulls' : type === 'Issue' ? 'issues' : 'releases'
  return { id: `${repo}-${number}`, unread: true, reason: 'review_requested', updated_at: updatedAt, subject: { title: `Thing ${number}`, url: `https://api.github.com/repos/${repo}/${kind}/${number}`, type }, repository: { full_name: repo } }
}

interface Notifications {
  lastModified?: string
  pollInterval?: number
  status?: number
  message?: string
  retryAfter?: number
  rate?: { limit: number; remaining: number; reset: number }
  notifications?: unknown[]
}

interface World extends GhWorld {
  notify(answer: Notifications): void
}

function world(): World {
  const gh = ghWorld(join(tempDir(), 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: [stubPull(API, 1), stubPull(API, 2), stubPull(OTHER, 3)] }))
  const notify = (answer: Notifications) => writeFileSync(join(gh.dir, 'notifications.json'), JSON.stringify(answer))
  notify({ lastModified: L0, notifications: [] })
  return { ...gh, notify }
}

interface TestProject extends PrInboxProject {
  repos: string[]
}

function project(id: string, repos: string[]): TestProject {
  const base = tempDir()
  mkdirSync(join(base, 'data'), { recursive: true })
  mkdirSync(join(base, 'root'))
  return { id, root: join(base, 'root'), dataDir: join(base, 'data'), repos }
}

let clock = START
let focused = true

beforeEach(() => {
  clock = START
  focused = true
})

function reader(gh: GhWorld, projects: TestProject[], over: Partial<PrInboxOptions> = {}): PrInbox {
  return new PrInbox({
    run: gh.run,
    projects: () => projects,
    enabled: (each) => prInboxSetting(each.dataDir),
    account: async () => ME,
    repos: async (root) => projects.find((each) => each.root === root)?.repos ?? [],
    now: () => clock,
    retryWaitMs: 0,
    notifications: { focused: () => focused },
    ...over,
  })
}

const isNotifications = (args: readonly string[]): boolean => args[0] === 'api' && args.some((arg) => arg.startsWith('notifications'))
const polls = (gh: GhWorld): string[][] => gh.calls().filter(isNotifications)
const searches = (gh: GhWorld): string[][] => gh.calls().filter((args) => args[1] === 'graphql' && args.some((arg) => arg.includes('search(')))

/** The PRs each details call asked for, as `owner/name#N`, call by call. */
function detailsAsked(gh: GhWorld): string[][] {
  return gh
    .calls()
    .filter((args) => args[1] === 'graphql' && args.some((arg) => arg.includes('pullRequest(number: $k0)')))
    .map((args) => {
      const vars = new Map(args.filter((_, i) => args[i - 1] === '-f' || args[i - 1] === '-F').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
      return [...vars.keys()].filter((name) => /^k\d+$/u.test(name)).map((name) => `${vars.get(`o${name.slice(1)}`)}/${vars.get(`n${name.slice(1)}`)}#${vars.get(name)}`)
    })
}

/** Ticks at `ms` after START; returns how many notification polls were made so far. */
async function at(inbox: PrInbox, gh: GhWorld, ms: number): Promise<number> {
  clock = START + ms
  await inbox.tick()
  return polls(gh).length
}

const sinceOf = (args: readonly string[]): string | null => {
  const header = args.find((arg, i) => args[i - 1] === '-H')
  return header === undefined ? null : header.replace(/^If-Modified-Since: /u, '')
}

describe('the notifications trigger', () => {
  it('304 (the stand-in exits 1 with "gh: HTTP 304", as gh does): no details read, no error, the interval not doubled', async () => {
    const gh = world()
    const p = project('p1', [API])
    const inbox = reader(gh, [p])
    expect(await at(inbox, gh, 0)).toBe(1)
    const detailsAfterSearch = detailsAsked(gh).length
    // GitHub's poll interval with the focus: 60 s.
    expect(await at(inbox, gh, 59 * SECOND)).toBe(1)
    expect(await at(inbox, gh, MINUTE)).toBe(2)
    expect(sinceOf(polls(gh)[1]!)).toBe(L0)
    // That was a 304: nothing read, no error, and the next poll after 60 s again, not 120 s.
    expect(detailsAsked(gh)).toHaveLength(detailsAfterSearch)
    expect(inbox.snapshot('p1').error).toBeNull()
    expect(inbox.snapshot('p1').notice).toBeNull()
    expect(await at(inbox, gh, 2 * MINUTE)).toBe(3)
    expect(await at(inbox, gh, 3 * MINUTE)).toBe(4)
    expect(detailsAsked(gh)).toHaveLength(detailsAfterSearch)

    // The stand-in answers a 304 as gh does: the status line and headers on stdout, `gh: HTTP 304` and exit code 1.
    const direct = gh.run(['api', '-i', NOTIFICATIONS_PATH, '-H', `If-Modified-Since: ${L0}`], p.root, {}, 'all')
    await expect(direct).rejects.toBeInstanceOf(GhExitError)
    const output = await direct.catch((error: GhExitError) => error.output)
    expect(output).toMatch(/^HTTP\/2\.0 304 Not Modified\n/u)
    expect(output).toContain('gh: HTTP 304')
    expect(parseNotificationsAnswer(output).status).toBe(304)
  })

  it('200 naming a PR of the Project: its details are read at once; a PR of another repository, an issue, a release or an old thread — nothing', async () => {
    const gh = world()
    const inbox = reader(gh, [project('p1', [API])])
    await at(inbox, gh, 0)
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${API}#2`]])

    gh.notify({
      lastModified: L1,
      notifications: [
        thread(API, 'PullRequest', 1, '2026-11-10T09:00:30Z'),
        thread(OTHER, 'PullRequest', 3, '2026-11-10T09:00:30Z'),
        thread(API, 'Issue', 7, '2026-11-10T09:00:30Z'),
        thread(API, 'Release', 8, '2026-11-10T09:00:30Z'),
        // Already there at the previous Last-Modified: the search read it.
        thread(API, 'PullRequest', 2, '2026-11-10T07:59:00Z'),
        // Twice in the list: read once.
        thread(API, 'PullRequest', 1, '2026-11-10T09:00:20Z'),
      ],
    })
    await at(inbox, gh, MINUTE)
    expect(polls(gh)).toHaveLength(2)
    expect(searches(gh)).toHaveLength(1)
    expect(detailsAsked(gh)).toEqual([[`${API}#1`, `${API}#2`], [`${API}#1`]])
    expect(gh.calls().flat().join(' ')).not.toContain(OTHER)

    // A PR the search did not find yet joins the inbox from its notification.
    writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: [stubPull(API, 1), stubPull(API, 2), { ...stubPull(API, 9), involves: false }] }))
    gh.notify({ lastModified: L2, notifications: [thread(API, 'PullRequest', 9, '2026-11-10T09:04:00Z')] })
    await at(inbox, gh, 2 * MINUTE)
    expect(detailsAsked(gh).at(-1)).toEqual([`${API}#9`])
    expect(inbox.snapshot('p1').groups.flatMap((group) => group.rows.map((row) => row.number)).sort()).toEqual([1, 2, 9])
  })

  it('the next poll sends If-Modified-Since from the last Last-Modified, kept in pr-inbox.json across a restart; the pace is X-Poll-Interval with the focus, 5 minutes without', async () => {
    const gh = world()
    const p = project('p1', [API])
    gh.notify({ lastModified: L0, pollInterval: 90, notifications: [] })
    const inbox = reader(gh, [p])
    await at(inbox, gh, 0)
    expect(sinceOf(polls(gh)[0]!)).toBeNull()
    expect(readNotificationsCursor(p.dataDir, ME)).toBe(L0)

    // X-Poll-Interval: 90 — not at 60 s, at 90 s.
    expect(await at(inbox, gh, MINUTE)).toBe(1)
    gh.notify({ lastModified: L1, pollInterval: 90, notifications: [] })
    expect(await at(inbox, gh, 90 * SECOND)).toBe(2)
    expect(sinceOf(polls(gh)[1]!)).toBe(L0)
    expect(readNotificationsCursor(p.dataDir, ME)).toBe(L1)
    expect(await at(inbox, gh, 180 * SECOND)).toBe(3)
    expect(sinceOf(polls(gh)[2]!)).toBe(L1)

    // Without the focus: every 5 minutes.
    focused = false
    expect(await at(inbox, gh, 180 * SECOND + 4 * MINUTE)).toBe(3)
    expect(await at(inbox, gh, 180 * SECOND + 5 * MINUTE)).toBe(4)
    focused = true

    // Marking a PR seen keeps the cursor; the cursor holds no text, only the header.
    inbox.markSeen('p1', API, 1)
    expect(readNotificationsCursor(p.dataDir, ME)).toBe(L1)
    expect(JSON.parse(readFileSync(join(p.dataDir, PR_INBOX_FILE), 'utf8')).notifications).toEqual({ [ME]: { lastModified: L1 } })

    // A new reader (worfy restarted) starts from the saved cursor.
    const again = reader(gh, [p])
    const before = polls(gh).length
    await at(again, gh, 20 * MINUTE)
    expect(polls(gh)).toHaveLength(before + 1)
    expect(sinceOf(polls(gh).at(-1)!)).toBe(L1)
  })

  it('the newest saved cursor of the account\'s Projects is the one sent', async () => {
    const gh = world()
    const p1 = project('p1', [API])
    const p2 = project('p2', [API])
    writeNotificationsCursor(p1.dataDir, ME, L0)
    writeNotificationsCursor(p2.dataDir, ME, L1)
    writeNotificationsCursor(p2.dataDir, 'someone-else', L2)
    const inbox = reader(gh, [p1, p2])
    await at(inbox, gh, 0)
    expect(polls(gh).map(sinceOf)).toEqual([L1])
  })

  it('403: the trigger is off with a notice in the snapshot, and the search every 5 minutes goes on', async () => {
    const gh = world()
    gh.notify({ status: 403 })
    const inbox = reader(gh, [project('p1', [API])])
    expect(await at(inbox, gh, 0)).toBe(1)
    const snapshot = inbox.snapshot('p1')
    expect(snapshot.notice).toBe(NOTIFICATIONS_OFF_NOTICE)
    expect(snapshot.notice).toBe('GitHub notifications unavailable for this token — checking every 5 minutes')
    expect(snapshot.error).toBeNull()
    expect(snapshot.groups.flatMap((group) => group.rows)).toHaveLength(2)

    gh.notify({ lastModified: L1, notifications: [] })
    expect(await at(inbox, gh, MINUTE)).toBe(1)
    expect(await at(inbox, gh, INBOX_SEARCH_INTERVAL_MS)).toBe(1)
    expect(await at(inbox, gh, 2 * INBOX_SEARCH_INTERVAL_MS)).toBe(1)
    expect(searches(gh)).toHaveLength(3)
    expect(inbox.snapshot('p1').notice).toBe(NOTIFICATIONS_OFF_NOTICE)
  })

  it('a 403 of the rate limit is a pause until X-Ratelimit-Reset, not off', async () => {
    const gh = world()
    const reset = (START + 10 * MINUTE) / 1000
    gh.notify({ status: 403, message: 'API rate limit exceeded for user ID 1.', rate: { limit: 5000, remaining: 0, reset } })
    const inbox = reader(gh, [project('p1', [API])])
    expect(await at(inbox, gh, 0)).toBe(1)
    expect(inbox.snapshot('p1').notice).toBeNull()
    gh.notify({ lastModified: L0, notifications: [] })
    expect(await at(inbox, gh, 9 * MINUTE)).toBe(1)
    expect(await at(inbox, gh, 10 * MINUTE)).toBe(2)
  })

  it('a 403 of the secondary rate limit (Retry-After) is a pause for that many seconds, not off', async () => {
    const gh = world()
    gh.notify({ status: 403, message: 'You have exceeded a secondary rate limit.', retryAfter: 600 })
    const inbox = reader(gh, [project('p1', [API])])
    expect(await at(inbox, gh, 0)).toBe(1)
    expect(inbox.snapshot('p1').notice).toBeNull()
    gh.notify({ lastModified: L0, notifications: [] })
    expect(await at(inbox, gh, 9 * MINUTE)).toBe(1)
    expect(await at(inbox, gh, 10 * MINUTE)).toBe(2)
  })

  it('less than 10 % of the REST rate limit left: no poll until X-Ratelimit-Reset, focused or not', async () => {
    const gh = world()
    const reset = (START + 10 * MINUTE) / 1000
    gh.notify({ lastModified: L0, notifications: [], rate: { limit: 5000, remaining: 499, reset } })
    const inbox = reader(gh, [project('p1', [API])])
    expect(await at(inbox, gh, 0)).toBe(1)
    expect(await at(inbox, gh, MINUTE)).toBe(1)
    expect(await at(inbox, gh, 9 * MINUTE)).toBe(1)
    // The next reset is still ahead: exactly 10 % left is not below the floor, so no pause.
    gh.notify({ lastModified: L0, notifications: [], rate: { limit: 5000, remaining: 500, reset: reset + 20 * 60 } })
    expect(await at(inbox, gh, 10 * MINUTE)).toBe(2)
    expect(await at(inbox, gh, 11 * MINUTE)).toBe(3)
  })

  it('500: the trigger\'s interval doubles up to 30 minutes; the search is not touched; an answer brings back the pace', async () => {
    const gh = world()
    gh.notify({ status: 500 })
    const inbox = reader(gh, [project('p1', [API])])
    expect(await at(inbox, gh, 0)).toBe(1)
    const snapshot = inbox.snapshot('p1')
    expect(snapshot.error).toBeNull()
    expect(snapshot.notice).toBeNull()
    expect(snapshot.nextSearchAt).toBe(new Date(START + INBOX_SEARCH_INTERVAL_MS).toISOString())
    // 60 s doubled: 120 s.
    expect(await at(inbox, gh, MINUTE)).toBe(1)
    expect(await at(inbox, gh, 2 * MINUTE)).toBe(2)
    // 240 s.
    expect(await at(inbox, gh, 5 * MINUTE)).toBe(2)
    expect(await at(inbox, gh, 6 * MINUTE)).toBe(3)
    // 480 s, 960 s, then 30 minutes at most (not 1920 s).
    expect(await at(inbox, gh, 14 * MINUTE)).toBe(4)
    expect(await at(inbox, gh, 30 * MINUTE)).toBe(5)
    expect(await at(inbox, gh, 59 * MINUTE)).toBe(5)
    expect(await at(inbox, gh, 60 * MINUTE)).toBe(6)
    // The search kept its own 5 minutes: at 0, 5, 14, 30 and 59 minutes.
    expect(searches(gh)).toHaveLength(5)
    expect(inbox.snapshot('p1').error).toBeNull()

    gh.notify({ lastModified: L0, notifications: [] })
    expect(await at(inbox, gh, 90 * MINUTE)).toBe(7)
    expect(await at(inbox, gh, 91 * MINUTE)).toBe(8)
  })

  it('gh that does not start counts as a failure of the trigger only', async () => {
    const gh = world()
    const p = project('p1', [API])
    let broken = false
    const run: PrInboxOptions['run'] = (args, cwd, env, output) => (broken && isNotifications(args) ? Promise.reject(new Error('gh not found (gh)')) : gh.run(args, cwd, env, output))
    const inbox = reader(gh, [p], { run })
    broken = true
    await at(inbox, gh, 0)
    expect(inbox.snapshot('p1').error).toBeNull()
    broken = false
    expect(await at(inbox, gh, MINUTE)).toBe(0)
    expect(await at(inbox, gh, 2 * MINUTE)).toBe(1)
  })

  it('the stand-in\'s log: only GET of notifications — never PATCH, never --method other than GET, never a thread', async () => {
    const gh = world()
    const inbox = reader(gh, [project('p1', [API])])
    await at(inbox, gh, 0)
    gh.notify({ lastModified: L1, notifications: [thread(API, 'PullRequest', 1, '2026-11-10T09:00:30Z')] })
    await at(inbox, gh, MINUTE)
    await at(inbox, gh, 2 * MINUTE)
    gh.notify({ status: 500 })
    await at(inbox, gh, 3 * MINUTE)
    gh.notify({ status: 403 })
    await at(inbox, gh, 5 * MINUTE)
    expect(polls(gh)).toHaveLength(5)
    expect(detailsAsked(gh).at(-1)).toEqual([`${API}#1`])
    for (const args of gh.calls()) {
      expect(args).not.toContain('--method')
      expect(args).not.toContain('-X')
      expect(args.join(' ')).not.toMatch(/PATCH|PUT|DELETE|POST|mutation|notifications\/threads/u)
    }
    for (const args of polls(gh)) expect(args.slice(0, 3)).toEqual(['api', '-i', NOTIFICATIONS_PATH])
  })

  it('without the notifications option the reader never asks for notifications', async () => {
    const gh = world()
    const inbox = reader(gh, [project('p1', [API])], { notifications: undefined })
    await at(inbox, gh, 0)
    await at(inbox, gh, 10 * MINUTE)
    expect(polls(gh)).toEqual([])
    expect(inbox.snapshot('p1').notice).toBeNull()
  })
})

describe('reading the answer of gh api -i', () => {
  it('the status, headers by lower-case name and body; without a status line, gh\'s HTTP code on stderr', () => {
    const answer = parseNotificationsAnswer('HTTP/2.0 200 OK\nLast-Modified: Tue, 10 Nov 2026 08:00:00 GMT\r\nX-Poll-Interval: 60\r\n\r\n[{"a":1}]\n')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('last-modified')).toBe('Tue, 10 Nov 2026 08:00:00 GMT')
    expect(answer.headers.get('x-poll-interval')).toBe('60')
    expect(answer.body).toBe('[{"a":1}]\n')
    expect(parseNotificationsAnswer('\ngh: HTTP 304\n').status).toBe(304)
    expect(parseNotificationsAnswer('\nconnection refused\n').status).toBeNull()
  })

  it('notifiedPulls: only PR threads of the given repositories newer than the cursor; none without a cursor', () => {
    // The type decides, not the address; another repository is never named.
    const issueAtPullAddress = { ...thread(API, 'Issue', 5, '2026-11-10T09:00:30Z'), subject: { title: 'Odd', url: `https://api.github.com/repos/${API}/pulls/5`, type: 'Issue' } }
    const threads = [thread(API, 'PullRequest', 1, '2026-11-10T09:00:30Z'), thread('Demo-Org/API', 'PullRequest', 4, '2026-11-10T09:00:30Z'), thread(API, 'PullRequest', 2, '2026-11-10T08:00:00Z'), issueAtPullAddress, thread(OTHER, 'PullRequest', 6, '2026-11-10T09:00:30Z')]
    expect(notifiedPulls(threads, [API], L0)).toEqual([
      { repo: API, number: 1 },
      { repo: API, number: 4 },
    ])
    expect(notifiedPulls(threads, [API], null)).toEqual([])
    expect(notifiedPulls({ message: 'not a list' }, [API], L0)).toEqual([])
  })
})
