// The PR inbox's notifications and its morning digest (worfy-pr-inbox ticket 07): PrInboxNotices of
// src/main/notify.ts over snapshots of the reader (src/main/github/inbox.ts), and PrInboxDigest of
// src/main/github/inbox-digest.ts. No system notification is posted: the notes go to the test's own
// Notifier parts. Every login, repository and text is invented.
import { describe, expect, it, vi } from 'vitest'
import type { PrInboxGroup, PrInboxRow, PrInboxSnapshot, PrInboxThread } from '../../src/shared/ipc/pr-inbox'
import { PR_INBOX_GROUPS } from '../../src/shared/ipc/pr-inbox'

vi.mock('electron', () => ({
  app: { focus: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => false
  },
}))
// The real window module loads the app's page.
vi.mock('../../src/main/window', () => ({ createMainWindow: () => undefined }))

const { PrInboxNotices, prInboxNoteBody, openNote } = await import('../../src/main/notify')
const { PendingOpens } = await import('../../src/main/notify-pending')
const { PrInboxDigest, digestCounts, digestText } = await import('../../src/main/github/inbox-digest')

type PrInboxNote = Parameters<ConstructorParameters<typeof PrInboxNotices>[0]['show']>[0]

const ME = 'dev-me'
const ANA = 'dev-ana'
const PROJECT = { id: 'web-0000000w', name: 'web' }
const SECRET = 'Please rename the secret helper before merge'

const comment = (id: string, author: string | null, body = SECRET) => ({ id, databaseId: 1, author, body, createdAt: '2026-11-09T10:00:00Z', url: `https://github.com/example-org/web/pull/1#${id}` })
const thread = (id: string, comments: ReturnType<typeof comment>[], isResolved = false): PrInboxThread => ({ id, isResolved, isOutdated: false, path: 'src/a.ts', line: 3, viewerCanReply: true, comments })

function row(number: number, over: Partial<PrInboxRow> = {}): PrInboxRow {
  return {
    repo: 'example-org/web',
    number,
    title: `Change number ${number}`,
    url: `https://github.com/example-org/web/pull/${number}`,
    isDraft: false,
    author: ME,
    headRefName: `feature/${number}`,
    headRefOid: `sha${number}`,
    createdAt: '2026-11-08T10:00:00Z',
    updatedAt: '2026-11-09T10:00:00Z',
    ci: 'passing',
    reviewDecision: null,
    mergeStateStatus: 'CLEAN',
    viaTeam: false,
    unresolvedThreads: 0,
    newSinceSeen: 0,
    lastActivityAt: '2026-11-09T10:00:00Z',
    threads: [],
    comments: [],
    ...over,
  }
}

function snapshot(groups: Partial<Record<PrInboxGroup, PrInboxRow[]>>, over: Partial<PrInboxSnapshot> = {}): PrInboxSnapshot {
  return {
    projectId: PROJECT.id,
    enabled: true,
    viewer: ME,
    groups: PR_INBOX_GROUPS.map((group) => ({ group, rows: groups[group] ?? [] })),
    readAt: '2026-11-10T08:00:00Z',
    nextSearchAt: '2026-11-10T08:05:00Z',
    error: null,
    notice: null,
    ...over,
  }
}

/** PrInboxNotices over the test's own focus, display and switch. */
function notices() {
  const state = { focused: false as boolean | Promise<boolean>, on: true }
  const shown: { note: PrInboxNote; click: () => void }[] = []
  const opened: PrInboxNote[] = []
  const subject = new PrInboxNotices(
    {
      focused: () => state.focused,
      show: (note, click) => shown.push({ note, click }),
      open: (note) => opened.push(note),
    },
    () => state.on,
  )
  return { state, shown, opened, read: (snap: PrInboxSnapshot) => subject.read(PROJECT, snap) }
}

const asked = (number: number) => row(number, { author: ANA })
const mine = (number: number, threads: PrInboxThread[]) => row(number, { threads, unresolvedThreads: threads.filter((each) => !each.isResolved).length })

describe('PrInboxNotices: a new review request', () => {
  it('without the focus gives one notification; the same PR and event again gives none', () => {
    const { shown, opened, read } = notices()
    read(snapshot({}))
    read(snapshot({ 'needs-review': [asked(5)] }))
    expect(shown).toHaveLength(1)
    expect(shown[0]!.note).toMatchObject({ title: 'web', sessionId: null, pr: { projectId: PROJECT.id, repo: 'example-org/web', number: 5 } })
    expect(shown[0]!.note.body).toBe('Review requested: example-org/web#5 Change number 5')
    read(snapshot({ 'needs-review': [asked(5)] }))
    read(snapshot({ 'needs-review': [asked(5)] }))
    expect(shown).toHaveLength(1)
    // A click opens the Pull requests view on that PR.
    shown[0]!.click()
    expect(opened).toEqual([shown[0]!.note])
  })

  it('with a worfy window in focus gives none, and none later for the same request', async () => {
    const { state, shown, read } = notices()
    read(snapshot({}))
    state.focused = true
    read(snapshot({ 'needs-review': [asked(5)] }))
    state.focused = Promise.resolve(true)
    read(snapshot({ 'needs-review': [asked(5), asked(6)] }))
    await Promise.resolve()
    state.focused = false
    read(snapshot({ 'needs-review': [asked(5), asked(6)] }))
    expect(shown).toHaveLength(0)
  })

  it('waits for the system when the focus is a promise, and shows once', async () => {
    const { state, shown, read } = notices()
    read(snapshot({}))
    state.focused = Promise.resolve(false)
    read(snapshot({ 'needs-review': [asked(5)] }))
    read(snapshot({ 'needs-review': [asked(5)] }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shown.map((each) => each.note.pr.number)).toEqual([5])
  })

  it('what the first read of a Project holds gives nothing; a request asked again after it went gives one more', () => {
    const { shown, read } = notices()
    read(snapshot({ 'needs-review': [asked(5)] }))
    expect(shown).toHaveLength(0)
    // The user reviewed: the PR left the group, then the review is asked again.
    read(snapshot({ waiting: [] }))
    read(snapshot({ 'needs-review': [asked(5)] }))
    expect(shown).toHaveLength(1)
  })

  it('a snapshot not read yet, of a reader that is off, or without a viewer is no first read', () => {
    const { shown, read } = notices()
    read(snapshot({}, { readAt: null }))
    read(snapshot({ 'needs-review': [asked(5)] }, { viewer: null }))
    read(snapshot({ 'needs-review': [asked(5)] }, { enabled: false }))
    read(snapshot({ 'needs-review': [asked(5)] }))
    expect(shown).toHaveLength(0)
    read(snapshot({ 'needs-review': [asked(5), asked(6)] }))
    expect(shown.map((each) => each.note.pr.number)).toEqual([6])
  })

  it('two Projects are counted apart', () => {
    const { shown, read } = notices()
    read(snapshot({}))
    read(snapshot({ 'needs-review': [asked(5)] }))
    const other = new PrInboxNotices({ focused: () => false, show: (note) => shown.push({ note, click: () => undefined }), open: () => undefined })
    other.read({ id: 'ops-0000000o', name: 'ops' }, snapshot({}, { projectId: 'ops-0000000o' }))
    other.read({ id: 'ops-0000000o', name: 'ops' }, snapshot({ 'needs-review': [asked(5)] }, { projectId: 'ops-0000000o' }))
    expect(shown.map((each) => each.note.title)).toEqual(['web', 'ops'])
  })
})

describe('PrInboxNotices: a new reply in a thread of my PR', () => {
  it('a colleague’s reply gives one notification; my own reply gives none', () => {
    const { shown, read } = notices()
    read(snapshot({ waiting: [mine(118, [thread('T1', [comment('C1', ME, 'first')])])] }))
    // My own reply: still the last comment is mine.
    read(snapshot({ waiting: [mine(118, [thread('T1', [comment('C1', ME, 'first'), comment('C2', ME, 'second')])])] }))
    expect(shown).toHaveLength(0)
    // A colleague answers.
    read(snapshot({ 'needs-answer': [mine(118, [thread('T1', [comment('C1', ME), comment('C2', ME), comment('C3', ANA)])])] }))
    expect(shown).toHaveLength(1)
    expect(shown[0]!.note.body).toBe('New reply: example-org/web#118 Change number 118')
    // The same reply in the next read: nothing more.
    read(snapshot({ 'needs-answer': [mine(118, [thread('T1', [comment('C1', ME), comment('C2', ME), comment('C3', ANA)])])] }))
    expect(shown).toHaveLength(1)
    // Replies in two threads at once: one notification for the PR.
    read(
      snapshot({
        'needs-answer': [mine(118, [thread('T1', [comment('C3', ANA), comment('C4', ANA)]), thread('T2', [comment('C5', ANA)])])],
      }),
    )
    expect(shown).toHaveLength(2)
  })

  it('a reply in a resolved thread, or on a PR of someone else, gives none', () => {
    const { shown, read } = notices()
    read(snapshot({}))
    read(snapshot({ waiting: [mine(118, [thread('T1', [comment('C1', ME), comment('C2', ANA)], true)])] }))
    read(snapshot({ 'needs-answer': [row(7, { author: ANA, threads: [thread('T9', [comment('C8', ME), comment('C9', ANA)])] })] }))
    expect(shown).toHaveLength(0)
  })

  it('the text names repo#N, the title and the kind of event, never a comment', () => {
    const { shown, read } = notices()
    read(snapshot({}))
    read(snapshot({ 'needs-answer': [mine(118, [thread('T1', [comment('C1', ANA, SECRET)])])], 'needs-review': [row(5, { author: ANA, comments: [comment('C7', ANA, SECRET)] })] }))
    expect(shown).toHaveLength(2)
    for (const { note } of shown) {
      expect(`${note.title} ${note.body}`).not.toContain('secret helper')
      expect(note.body).not.toContain(ANA)
    }
    expect(prInboxNoteBody('reply', { repo: 'example-org/web', number: 3, title: 'x'.repeat(200) }).length).toBeLessThan(120)
  })
})

describe('PrInboxNotices: the switch prInboxNotify', () => {
  it('off gives no notification, and what came while it was off does not come later', () => {
    const { state, shown, read } = notices()
    read(snapshot({}))
    state.on = false
    read(snapshot({ 'needs-review': [asked(5)], 'needs-answer': [mine(118, [thread('T1', [comment('C1', ANA)])])] }))
    expect(shown).toHaveLength(0)
    state.on = true
    read(snapshot({ 'needs-review': [asked(5)], 'needs-answer': [mine(118, [thread('T1', [comment('C1', ANA)])])] }))
    expect(shown).toHaveLength(0)
  })
})

describe('openNote of a PR inbox note', () => {
  it('raises the window and leaves the PR for its renderer to open in the Pull requests view', async () => {
    const { BrowserWindow } = await import('electron')
    const emitted: string[] = []
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
      focus: vi.fn(),
      webContents: { id: 7, once: vi.fn(), send: (channel: string) => emitted.push(channel), isDestroyed: () => false },
    }
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([window as never])
    const pending = new PendingOpens()
    openNote({ title: 'web', body: 'Review requested: example-org/web#5 x', sessionId: null, pr: { projectId: PROJECT.id, repo: 'example-org/web', number: 5 } }, pending, () => window as never, {
      takesFocus: true,
      systemNotifications: false,
    } as never)
    expect(pending.take(7)).toEqual({ view: 'pull-requests', projectId: PROJECT.id, repo: 'example-org/web', number: 5 })
  })
})

describe('PrInboxDigest: the morning digest', () => {
  const NOW = Date.parse('2026-11-10T09:00:00')
  const counted = snapshot({
    'needs-review': [row(5, { author: ANA, createdAt: new Date(NOW - 2 * 86_400_000 - 60_000).toISOString() }), row(6, { author: ANA, createdAt: new Date(NOW - 3_600_000).toISOString() }), row(9, { author: ANA })],
    'needs-answer': [row(118, { newSinceSeen: 2 })],
    'needs-fix': [row(40, { newSinceSeen: 1 })],
    ready: [row(12)],
  })

  it('counts the reviews, their oldest, the PRs with new comments and those ready to merge', () => {
    expect(digestCounts([counted], NOW)).toMatchObject({ reviews: 3, commented: 2, ready: 1 })
    expect(digestText(digestCounts([counted], NOW))).toBe('3 reviews wait for you (oldest 2 days) · 2 PRs have new comments · 1 ready to merge')
    expect(digestText(digestCounts([snapshot({ 'needs-review': [row(6, { author: ANA, createdAt: new Date(NOW - 5 * 3_600_000).toISOString() })] })], NOW))).toBe('1 review waits for you (5 hours)')
    expect(digestText(digestCounts([snapshot({ waiting: [row(3, { newSinceSeen: 1 })] })], NOW))).toBe('1 PR has new comments')
    expect(digestText(digestCounts([snapshot({ waiting: [row(3)] })], NOW))).toBeNull()
  })

  it('a PR two Projects both read is counted once', () => {
    const twice = [snapshot({ ready: [row(12)] }), snapshot({ ready: [row(12)] }, { projectId: 'ops-0000000o' })]
    expect(digestCounts(twice, NOW).ready).toBe(1)
  })

  function digest(snapshots: PrInboxSnapshot[], on = true) {
    const clock = { now: NOW }
    const state = { on, snapshots }
    const subject = new PrInboxDigest({ snapshots: () => state.snapshots, enabled: () => state.on, now: () => clock.now })
    return { clock, state, ask: () => subject.ask() }
  }

  it('the first ask of a day shows it once; the next ask that day shows nothing; the next day shows it again', () => {
    const { clock, ask } = digest([counted])
    expect(ask()).toEqual({ state: 'show', text: '3 reviews wait for you (oldest 2 days) · 2 PRs have new comments · 1 ready to merge', projectIds: [PROJECT.id] })
    expect(ask()).toEqual({ state: 'none' })
    clock.now += 3 * 3_600_000
    expect(ask()).toEqual({ state: 'none' })
    clock.now += 24 * 3_600_000
    expect(ask().state).toBe('show')
  })

  it('waits while a Project on is not read yet, and an empty inbox shows nothing', () => {
    const { state, ask } = digest([snapshot({}, { readAt: null })])
    expect(ask()).toEqual({ state: 'pending' })
    expect(ask()).toEqual({ state: 'pending' })
    state.snapshots = [snapshot({ waiting: [row(3)] })]
    expect(ask()).toEqual({ state: 'none' })
    // The day is taken: a request that comes later that day waits for the next one.
    state.snapshots = [counted]
    expect(ask()).toEqual({ state: 'none' })
  })

  it('a Project whose read failed, or that is off, does not hold the digest back', () => {
    const { ask } = digest([counted, snapshot({}, { projectId: 'a-1', readAt: null, error: 'gh failed' }), snapshot({}, { projectId: 'b-2', readAt: null, enabled: false })])
    expect(ask().state).toBe('show')
  })

  it('off (prInboxDigest false) shows nothing and keeps the day for when it is on', () => {
    const { state, ask } = digest([counted], false)
    expect(ask()).toEqual({ state: 'none' })
    state.on = true
    expect(ask().state).toBe('show')
  })

  it('names the Projects with something to show, in the order of the list', () => {
    const { ask } = digest([snapshot({ waiting: [row(3)] }, { projectId: 'a-1' }), snapshot({ ready: [row(4)] }, { projectId: 'b-2' }), snapshot({ 'needs-review': [row(5, { author: ANA })] }, { projectId: 'c-3' })])
    expect(ask()).toMatchObject({ state: 'show', projectIds: ['b-2', 'c-3'] })
  })
})
