// The drafts of replies and Send (worfy-pr-inbox ticket 05, ADR-0105; src/main/github/pr-reply-send.ts) through the
// `prInbox` IPC handlers, against the gh stand-in (test/fixtures/gh/gh-stub.mjs) and the repository's own
// harness/bin/review-draft-lint over a temporary HOME and HARNESS_HOME:
// - Send posts once, and the body of the POST is byte for byte the text saved from the field;
// - reading the inbox and the drafts, saving and discarding post nothing: the stand-in's log has no write;
// - a trace of the workflow in the edited text: the lint finds it, nothing is posted, the draft keeps the reason;
// - GitHub 500: nothing more is posted; Send again when the text is on GitHub already only marks it sent;
// - a sent reply is not sent again; a repository that is not the Project's is refused before gh;
// - a Linked machine, at any access level, is refused every drafts channel before the handler.
// Nothing reaches GitHub or a model: owners, repositories, logins and texts are invented.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrInbox } from '../../src/main/github/inbox'
import { draftFilePath, IN_FLIGHT, NO_ACCOUNT, POSTS_PER_MINUTE, PrReplySender, UNCONFIRMED, type LintRun, type PrReplySenderOptions } from '../../src/main/github/pr-reply-send'
import { appUrlMatcher, registerIpc, type IpcMainLike, type ModuleLoader } from '../../src/main/ipc/index'
import { prInboxHandlers, type PrReplyDraftsAccess } from '../../src/main/ipc/pr-inbox'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { runHarnessScript } from '../../src/main/workflow/profile'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { prInboxDiscard, prInboxDrafts, prInboxSaveDraft, prInboxSend, prReplyDraftsSchema, type PrReplyDrafts, type PrReplySendResult } from '../../src/shared/ipc/pr-inbox'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { ghWorld, type GhWorld } from './gh-world'

const LINT = join(process.cwd(), 'harness', 'bin', 'review-draft-lint')

const ME = 'dev-me'
const ANA = 'dev-ana'
const API = 'demo-org/api'
const PR = 118
const THREAD = 'PRRT_demo1'
const REPLY_TO = 4211
const HEAD = 'a1b2c3d4e5f6'
const PROJECT = 'demo-0000000d'
/** What the user typed into the field: quotes, a line break, an `@`, a placeholder of gh, `=` and characters beyond ASCII. */
const TYPED = 'Good catch — the server drops the first try.\n@team: "{owner}" stays; retries=3, naïve ✓\n'

beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

interface Setup {
  gh: GhWorld
  root: string
  profileDir: string
  file: string
  sender: PrReplySender
  call: <T>(channel: string, input: unknown) => Promise<IpcResult<T>>
  /** The draft file as it is now. */
  draft: () => { headOid: string; items: Record<string, unknown>[] }
}

const threadItem = (body: string, over: Record<string, unknown> = {}) => ({ kind: 'thread', threadId: THREAD, replyTo: REPLY_TO, label: 'needs answer', body, fixPlan: null, state: 'draft', sentUrl: null, ...over })
const conversationItem = (body: string, over: Record<string, unknown> = {}) => ({ kind: 'conversation', label: 'FYI', body, fixPlan: null, state: 'draft', sentUrl: null, ...over })

/** A minimal PR of the stand-in's inbox reads: mine, with one thread whose last word is Ana's. */
const inboxPull = {
  repo: API,
  number: PR,
  updatedAt: '2026-11-10T08:00:00Z',
  headRefOid: HEAD,
  involves: true,
  reviewRequested: false,
  pull: {
    title: 'Retry the upload',
    url: `https://github.com/${API}/pull/${PR}`,
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-11-09T08:00:00Z',
    author: { login: ME },
    headRefName: 'feature/retry',
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    commits: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: {
      nodes: [
        {
          id: THREAD,
          isResolved: false,
          isOutdated: false,
          path: 'src/upload.ts',
          line: 12,
          viewerCanReply: true,
          comments: { nodes: [{ id: 'C1', databaseId: REPLY_TO, author: { login: ANA }, body: 'Why three tries?', createdAt: '2026-11-10T07:00:00Z', url: `https://github.com/${API}/pull/${PR}#discussion_r${REPLY_TO}` }] },
        },
      ],
    },
    comments: { nodes: [] },
  },
}

/** review-draft-lint as the app starts it (runHarnessScript), over a temporary HOME and HARNESS_HOME: no Profile of this machine is read. */
function lintRunner(base: string): PrReplySenderOptions['lint'] {
  const home = join(base, 'home')
  const harnessHome = join(base, 'harness-home')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  // An empty registry: the project is in none, so the lint checks without epic names, as for an unregistered folder.
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [] }))
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  // The gate names the registry of this machine in these; the scripts would read it instead of HARNESS_HOME.
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  env.PATH = `${dirname(scriptNode())}${delimiter}${env.PATH ?? ''}`
  return (draft, root, rules) => runHarnessScript(LINT, ['--reply', '-', '-C', root, ...(rules === null ? [] : ['--rules', rules])], env, { stdin: draft, timeoutMs: ms(30_000) })
}

async function setup(items: Record<string, unknown>[], options: { replies?: Record<string, unknown>; over?: Partial<PrReplySenderOptions> } = {}): Promise<Setup> {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-send-')))
  temps.push(base)
  const root = join(base, 'project')
  const profileDir = join(base, 'profile')
  mkdirSync(root, { recursive: true })
  const gh = ghWorld(join(base, 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  writeFileSync(join(gh.dir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: [inboxPull] }))
  writeFileSync(join(gh.dir, 'replies.json'), JSON.stringify({ threads: { [THREAD]: REPLY_TO }, ...options.replies }))
  const file = draftFilePath(profileDir, API, PR)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ schema: 1, repo: API, pr: PR, headOid: HEAD, items }, null, 2)}\n`)
  const sender = new PrReplySender({
    run: gh.run,
    account: async () => ME,
    profileDir: async () => ({ dir: profileDir, reason: null }),
    repos: async () => [API],
    lint: lintRunner(base),
    ...options.over,
  })
  const inbox = new PrInbox({ run: gh.run, projects: () => [{ id: PROJECT, root, dataDir: join(base, 'data') }], enabled: () => true, account: async () => ME, repos: async () => [API], retryWaitMs: 0 })
  mkdirSync(join(base, 'data'))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const drafts: PrReplyDraftsAccess = { sender: () => sender, root: () => root }
  await registerIpc(ipc, { modules: { './pr-inbox.ts': async () => prInboxHandlers(() => inbox, drafts) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async <T,>(channel: string, input: unknown) => (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
  return { gh, root, profileDir, file, sender, call, draft: () => JSON.parse(readFileSync(file, 'utf8')) as { headOid: string; items: Record<string, unknown>[] } }
}

/** The calls that would write to GitHub: a method but GET, a REST call with a field or an input, a GraphQL mutation. */
function writes(gh: GhWorld): string[][] {
  return gh.calls().filter((args) => {
    if (args[0] !== 'api') return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
    const method = args.find((arg, i) => args[i - 1] === '--method' || args[i - 1] === '-X')
    if (method !== undefined && method.toUpperCase() !== 'GET') return true
    if (args.some((arg) => /\bmutation\b/u.test(arg))) return true
    return args[1] !== 'graphql' && args.some((arg) => /^(?:-f|-F|--field|--raw-field|--input)$/u.test(arg))
  })
}

const posted = (gh: GhWorld): { repo: string; pr: number; replyTo: number | null; login: string; body: string; url: string }[] =>
  existsSync(join(gh.dir, 'posted.json')) ? JSON.parse(readFileSync(join(gh.dir, 'posted.json'), 'utf8')) : []

const pull = { projectId: PROJECT, repo: API, number: PR }
/** The reply in the thread as the view names it: its place when read, its kind and thread, and the text it read. */
const threadRef = (base = 'The server drops one try.') => ({ index: 0, kind: 'thread', threadId: THREAD, base })
const conversationRef = (index: number, base: string) => ({ index, kind: 'conversation', threadId: null, base })

type SendAnswer = { results: PrReplySendResult[]; drafts: PrReplyDrafts }

function ok<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result.value
}

describe('Send', () => {
  it('posts once: one POST …/replies whose body is byte for byte the text saved from the field; the draft file says sent with the URL', async () => {
    const s = await setup([threadItem('The server drops one try.'), conversationItem('Thanks, merged the docs.')])
    // The user edits the field; the edit is saved, then Send carries the text shown.
    ok(await s.call('prInbox.saveDraft', { ...pull, item: threadRef(), body: TYPED }))
    expect(writes(s.gh)).toEqual([])
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: TYPED }] }))

    const posts = writes(s.gh)
    expect(posts).toEqual([['api', '--method', 'POST', `repos/${API}/pulls/${PR}/comments/${REPLY_TO}/replies`, '-f', `body=${TYPED}`]])
    expect(Buffer.from(posts[0]![5]!.slice('body='.length), 'utf8').equals(Buffer.from(TYPED, 'utf8'))).toBe(true)
    // What the stand-in got as the body of the request, as GitHub would.
    expect(posted(s.gh)).toEqual([{ repo: API, pr: PR, replyTo: REPLY_TO, login: ME, body: TYPED, url: `https://github.com/${API}/pull/${PR}#discussion_r9001` }])
    expect(answer.results).toEqual([{ index: 0, outcome: 'sent', reason: null, sentUrl: `https://github.com/${API}/pull/${PR}#discussion_r9001` }])
    expect(prReplyDraftsSchema.parse(answer.drafts).items[0]).toMatchObject({ state: 'sent', sentUrl: `https://github.com/${API}/pull/${PR}#discussion_r9001`, body: TYPED, edited: true, error: null })

    const file = s.draft()
    expect(file.items[0]).toEqual({ ...threadItem(TYPED), state: 'sent', sentUrl: `https://github.com/${API}/pull/${PR}#discussion_r9001`, edited: true, error: null })
    // The other reply is untouched.
    expect(file.items[1]).toEqual(conversationItem('Thanks, merged the docs.'))
    // Before the POST, one read of the thread as the Project's account: was this text posted already?
    const reads = s.gh.calls().filter((args) => args[1] === 'graphql')
    expect(reads).toHaveLength(1)
    expect(reads[0]!.join(' ')).toContain(`thread=${THREAD}`)
  })

  it('a reply in the conversation goes to issues/{n}/comments; Send all posts one after another, in the order given', async () => {
    const s = await setup([threadItem('The server drops one try.'), conversationItem('The docs follow in a second change.')])
    const answer = ok(
      await s.call<SendAnswer>('prInbox.send', {
        ...pull,
        items: [
          { ...conversationRef(1, 'The docs follow in a second change.'), body: 'The docs follow in a second change.' },
          { ...threadRef(), body: 'The server drops one try.' },
        ],
      }),
    )
    expect(answer.results.map((result) => result.outcome)).toEqual(['sent', 'sent'])
    expect(writes(s.gh).map((args) => args[3])).toEqual([`repos/${API}/issues/${PR}/comments`, `repos/${API}/pulls/${PR}/comments/${REPLY_TO}/replies`])
    expect(s.draft().items.map((item) => item.state)).toEqual(['sent', 'sent'])
    // A text sent unchanged is not marked edited.
    expect(s.draft().items[0]!.edited).toBeUndefined()
  })
})

describe('no write without Send', () => {
  it('drafts there, the inbox and the drafts read, a reply saved and one discarded: not one write in the stand-in log', async () => {
    const s = await setup([threadItem('The server drops one try.'), conversationItem('Thanks.')])
    ok(await s.call('prInbox.get', { projectId: PROJECT }))
    const drafts = prReplyDraftsSchema.parse(ok(await s.call('prInbox.drafts', pull)))
    expect(drafts.items.map((item) => [item.index, item.kind, item.state])).toEqual([
      [0, 'thread', 'draft'],
      [1, 'conversation', 'draft'],
    ])
    ok(await s.call('prInbox.saveDraft', { ...pull, item: threadRef(), body: 'Three tries: the server drops the first.' }))
    const after = prReplyDraftsSchema.parse(ok(await s.call('prInbox.discard', { ...pull, item: conversationRef(1, 'Thanks.'), body: 'Thanks.' })))
    expect(after.items.map((item) => [item.state, item.edited])).toEqual([
      ['draft', true],
      ['discarded', false],
    ])
    expect(s.gh.calls().length).toBeGreaterThan(0)
    expect(writes(s.gh)).toEqual([])
    expect(posted(s.gh)).toEqual([])
    // The edit is in the file as typed; nothing but the edit and the discard changed.
    expect(s.draft().items).toEqual([threadItem('Three tries: the server drops the first.', { edited: true }), conversationItem('Thanks.', { state: 'discarded' })])
  })

  it('the view reading the drafts every few seconds asks bin/profile for the Profile folder once in 30 s, and again when it found none', async () => {
    let now = 0
    let asked = 0
    let found: string | null = null
    const s = await setup([threadItem('ok')], {
      over: {
        now: () => now,
        profileDir: async () => {
          asked += 1
          return { dir: found, reason: found === null ? 'not registered yet' : null }
        },
      },
    })
    found = s.profileDir
    for (const at of [0, 5_000, 29_999]) {
      now = at
      expect(prReplyDraftsSchema.parse(ok(await s.call('prInbox.drafts', pull))).items).toHaveLength(1)
    }
    expect(asked).toBe(1)
    now = 30_000
    ok(await s.call('prInbox.drafts', pull))
    expect(asked).toBe(2)
    found = null
    now = 70_000
    expect(prReplyDraftsSchema.parse(ok(await s.call('prInbox.drafts', pull))).problem).toMatch(/not registered yet/u)
    now = 70_001
    ok(await s.call('prInbox.drafts', pull))
    expect(asked).toBe(4)
  })

  it('a save or a discard of a reply the Session moved meanwhile is refused, and the file stays', async () => {
    const s = await setup([conversationItem('Thanks.')])
    const before = readFileSync(s.file, 'utf8')
    const refused = await s.call('prInbox.saveDraft', { ...pull, item: threadRef(), body: 'x' })
    expect(refused.ok).toBe(false)
    expect(readFileSync(s.file, 'utf8')).toBe(before)
    expect(writes(s.gh)).toEqual([])
  })
})

describe('the check before Send', () => {
  it('a trace of the workflow in the edited text: review-draft-lint finds it, nothing is posted, the draft keeps the reason', async () => {
    const s = await setup([threadItem('The server drops one try.')])
    const traced = 'Done in .scratch/demo-epic/issues/07, see HANDOFF.md'
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: traced }] }))
    expect(answer.results).toHaveLength(1)
    expect(answer.results[0]).toMatchObject({ outcome: 'refused', sentUrl: null })
    expect(answer.results[0]!.reason).toMatch(/^Not sent: review-draft-lint found .*\.scratch/u)
    expect(writes(s.gh)).toEqual([])
    expect(posted(s.gh)).toEqual([])
    const item = s.draft().items[0]!
    expect(item).toMatchObject({ state: 'draft', body: traced, edited: true, sentUrl: null })
    expect(item.error).toBe(answer.results[0]!.reason)
  })

  it('an AI authorship line or an empty text is refused too; a lint that cannot run refuses, never posts', async () => {
    const s = await setup([threadItem('ok')])
    for (const body of ['Fixed.\n\nCo-Authored-By: Claude <noreply@anthropic.com>', '   ']) {
      const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('ok'), body }] }))
      expect(answer.results[0]!.outcome, body).toBe('refused')
    }
    const broken = await setup([threadItem('Fine as it is.')], { over: { lint: async (): Promise<LintRun> => ({ code: 2, stdout: '', stderr: 'review-draft-lint: lint.json broken\n' }) } })
    const answer = ok(await broken.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Fine as it is.'), body: 'Fine as it is.' }] }))
    expect(answer.results[0]).toMatchObject({ outcome: 'refused', reason: 'Not sent: review-draft-lint gave exit 2: review-draft-lint: lint.json broken' })
    // A lint that exits 0 without saying it checked the reply is no check either.
    const silent = await setup([threadItem('Fine as it is.')], { over: { lint: async (): Promise<LintRun> => ({ code: 0, stdout: '', stderr: '' }) } })
    expect(ok(await silent.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Fine as it is.'), body: 'Fine as it is.' }] })).results[0]!.outcome).toBe('refused')
    for (const each of [s, broken, silent]) expect(writes(each.gh)).toEqual([])
  })
})

describe('failures and a second Send', () => {
  it('GitHub 500: no second POST by itself, the draft keeps the reason; Send again with the text there only marks it sent', async () => {
    // The POST lands on GitHub, but gh reports 500: the answer was lost on the way.
    const s = await setup([threadItem('The server drops one try.'), conversationItem('Thanks.')], { replies: { status: 500, landed: true } })
    const first = ok(
      await s.call<SendAnswer>('prInbox.send', {
        ...pull,
        items: [
          { ...threadRef(), body: 'The server drops one try.' },
          { ...conversationRef(1, 'Thanks.'), body: 'Thanks.' },
        ],
      }),
    )
    expect(first.results.map((result) => result.outcome)).toEqual(['failed', 'skipped'])
    expect(first.results[0]!.reason).toMatch(/^GitHub did not confirm the reply: gh: Server Error \(HTTP 500\)/u)
    expect(writes(s.gh)).toHaveLength(1)
    expect(s.draft().items[0]).toMatchObject({ state: 'draft', sentUrl: null, error: first.results[0]!.reason })
    expect(s.draft().items[1]).toEqual(conversationItem('Thanks.'))

    // GitHub answers again; the reply is there already: marked sent, not posted twice.
    writeFileSync(join(s.gh.dir, 'replies.json'), JSON.stringify({ threads: { [THREAD]: REPLY_TO } }))
    const second = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }))
    expect(second.results).toEqual([{ index: 0, outcome: 'already-sent', reason: 'It was on GitHub already: marked sent, not posted again', sentUrl: `https://github.com/${API}/pull/${PR}#discussion_r9001` }])
    expect(writes(s.gh)).toHaveLength(1)
    expect(posted(s.gh)).toHaveLength(1)
    expect(s.draft().items[0]).toMatchObject({ state: 'sent', sentUrl: `https://github.com/${API}/pull/${PR}#discussion_r9001`, error: null })
  })

  it('GitHub 500 and nothing landed: Send again posts it, once', async () => {
    const s = await setup([threadItem('The server drops one try.')], { replies: { status: 500 } })
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] })).results[0]!.outcome).toBe('failed')
    expect(posted(s.gh)).toEqual([])
    writeFileSync(join(s.gh.dir, 'replies.json'), JSON.stringify({ threads: { [THREAD]: REPLY_TO } }))
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] })).results[0]!.outcome).toBe('sent')
    expect(writes(s.gh)).toHaveLength(2)
    expect(posted(s.gh)).toHaveLength(1)
  })

  it('the same text from another account in the thread is not this reply: it is posted', async () => {
    const s = await setup([threadItem('Same words.')])
    writeFileSync(join(s.gh.dir, 'posted.json'), JSON.stringify([{ repo: API, pr: PR, replyTo: REPLY_TO, login: ANA, body: 'Same words.', url: 'https://github.com/x' }]))
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Same words.'), body: 'Same words.' }] })).results[0]!.outcome).toBe('sent')
    expect(writes(s.gh)).toHaveLength(1)
  })

  it('Send of a reply sent already is refused: no second POST; a discarded one is refused too', async () => {
    const s = await setup([threadItem('The server drops one try.'), conversationItem('Thanks.', { state: 'discarded' })])
    ok(await s.call('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }))
    const again = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }))
    expect(again.results[0]).toMatchObject({ outcome: 'refused', reason: `Sent already: https://github.com/${API}/pull/${PR}#discussion_r9001` })
    const discarded = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...conversationRef(1, 'Thanks.'), body: 'Thanks.' }] }))
    expect(discarded.results[0]).toMatchObject({ outcome: 'refused', reason: 'This reply is discarded' })
    expect(writes(s.gh)).toHaveLength(1)
    // A sent reply is neither edited nor discarded afterwards.
    expect((await s.call('prInbox.saveDraft', { ...pull, item: threadRef(), body: 'later' })).ok).toBe(false)
    expect((await s.call('prInbox.discard', { ...pull, item: threadRef(), body: 'The server drops one try.' })).ok).toBe(false)
  })

  it('two Sends of one reply at once: one POST', async () => {
    const s = await setup([threadItem('The server drops one try.')])
    const input = { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }
    const both = await Promise.all([s.call<SendAnswer>('prInbox.send', input), s.call<SendAnswer>('prInbox.send', input)])
    expect(both.map((result) => ok(result).results[0]!.outcome).sort()).toEqual(['refused', 'sent'])
    expect(writes(s.gh)).toHaveLength(1)
  })

  it('a repository that is not the Project\'s, or a Project without a Profile folder: refused before any gh call', async () => {
    const s = await setup([threadItem('ok')], { over: { repos: async () => ['demo-org/other'] } })
    expect(await s.call('prInbox.send', { ...pull, items: [{ ...threadRef('ok'), body: 'ok' }] })).toEqual({ ok: false, error: `prInbox.send failed: ${API} is not a repository of this Project: nothing is sent` })
    const none = await setup([threadItem('ok')], { over: { profileDir: async () => ({ dir: null, reason: 'the folder is in no registered project' }) } })
    expect((await none.call('prInbox.send', { ...pull, items: [{ ...threadRef('ok'), body: 'ok' }] })).ok).toBe(false)
    expect(prReplyDraftsSchema.parse(ok(await none.call('prInbox.drafts', pull))).problem).toBe('The Project has no Profile folder, where drafts live: the folder is in no registered project')
    expect(s.gh.calls()).toEqual([])
    expect(none.gh.calls()).toEqual([])
  })
})

describe('the pace of Send all', () => {
  it(`at most ${POSTS_PER_MINUTE} posts a minute: the next one waits for the oldest to be a minute old`, async () => {
    let now = 0
    const waits: number[] = []
    const posts: number[] = []
    const items = Array.from({ length: POSTS_PER_MINUTE + 1 }, (_, n) => conversationItem(`Reply ${n}`))
    const s = await setup(items, {
      over: {
        now: () => now,
        sleep: async (wait) => {
          waits.push(wait)
          now += wait
        },
        // A stand-in in memory: 81 processes would only slow the test.
        run: async (args) => {
          if (args[0] === 'auth') return 'tok-me\n'
          if (args[1] === 'graphql') throw new Error('a first Send of a reply in the conversation reads nothing')
          posts.push(now)
          now += 10
          return JSON.stringify({ html_url: `https://github.com/${API}/pull/${PR}#issuecomment-${posts.length}` })
        },
        lint: async (): Promise<LintRun> => ({ code: 0, stdout: 'review-draft-lint: clean (1 replies)\n', stderr: '' }),
      },
    })
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: items.map((item, index) => ({ ...conversationRef(index, item.body), body: item.body })) }))
    expect(answer.results.every((result) => result.outcome === 'sent')).toBe(true)
    expect(posts).toHaveLength(POSTS_PER_MINUTE + 1)
    expect(waits).toEqual([60_000 - POSTS_PER_MINUTE * 10])
    expect(posts.at(-1)! - posts[0]!).toBeGreaterThanOrEqual(60_000)
  })
})

describe('a Linked machine', () => {
  const LINKED = '66666666-6666-4666-8666-666666666666'

  it('the four channels are `local`', () => {
    expect([prInboxDrafts, prInboxSaveDraft, prInboxDiscard, prInboxSend].map((channel) => channel.access)).toEqual(['local', 'local', 'local', 'local'])
  })

  it.each(['all', 'read'] as const)('with access %s: every drafts channel is refused before the handler; nothing is read, written or sent', async (level) => {
    const s = await setup([threadItem('The server drops one try.')])
    const spy = { drafts: vi.fn(), save: vi.fn(), discard: vi.fn(), send: vi.fn() }
    const fakeInbox = { ensureRead: vi.fn(async () => undefined), snapshot: vi.fn(), markSeen: vi.fn() }
    const modules: Record<string, ModuleLoader> = { './pr-inbox.ts': async () => prInboxHandlers(() => fakeInbox as never, { sender: () => spy as never, root: () => s.root }) }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    // The reads of the inbox are open to it; the drafts are not even registered.
    expect(adapter.channels()).toEqual(['prInbox.get', 'prInbox.markSeen'])
    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess(level)
    const before = readFileSync(s.file, 'utf8')
    for (const [channel, input] of [
      ['prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }],
      ['prInbox.drafts', pull],
      ['prInbox.saveDraft', { ...pull, item: threadRef(), body: 'x' }],
      ['prInbox.discard', { ...pull, item: threadRef(), body: 'The server drops one try.' }],
    ] as const)
      expect(await adapter.call(peer, channel, input, 'Beta')).toEqual({ ok: false, error: `${channel}: not open to Linked machines` })
    for (const each of Object.values(spy)) expect(each).not.toHaveBeenCalled()
    expect(readFileSync(s.file, 'utf8')).toBe(before)
    expect(s.gh.calls()).toEqual([])
  })
})

describe('a second Send only looks on GitHub first', () => {
  /** Comments of this account on GitHub already: in the thread, and in the conversation. */
  const before = (gh: GhWorld, body: string, login = ME): void =>
    writeFileSync(
      join(gh.dir, 'posted.json'),
      JSON.stringify([
        { repo: API, pr: PR, replyTo: REPLY_TO, login, body, url: `https://github.com/${API}/pull/${PR}#discussion_r42` },
        { repo: API, pr: PR, replyTo: null, login, body, url: `https://github.com/${API}/pull/${PR}#issuecomment-43` },
      ]),
    )

  it('a first Send of a «Thanks!» this account posted before, in the thread and in the conversation: posted, not marked sent with the old link', async () => {
    const s = await setup([threadItem('Thanks!'), conversationItem('Thanks!')])
    before(s.gh, 'Thanks!')
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Thanks!'), body: 'Thanks!' }, { ...conversationRef(1, 'Thanks!'), body: 'Thanks!' }] }))
    expect(answer.results.map((result) => result.outcome)).toEqual(['sent', 'sent'])
    expect(writes(s.gh)).toHaveLength(2)
    expect(s.draft().items.map((item) => item.sentUrl)).toEqual([`https://github.com/${API}/pull/${PR}#discussion_r9003`, `https://github.com/${API}/pull/${PR}#issuecomment-9004`])
  })

  it('the mark is in the file before the POST, and gone after it', async () => {
    const seen: unknown[] = []
    const watched: Setup = await setup([conversationItem('Noted.')], {
      over: {
        // The file as it is when the POST goes out.
        run: async (args, cwd, env) => {
          if (args[2] === 'POST') seen.push(watched.draft().items[0]!.error)
          return watched.gh.run(args, cwd, env)
        },
      },
    })
    expect(ok(await watched.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...conversationRef(0, 'Noted.'), body: 'Noted.' }] })).results[0]!.outcome).toBe('sent')
    expect(seen).toEqual([IN_FLIGHT])
    expect(watched.draft().items[0]!.error).toBeNull()
  })

  it('worfy stopped after the mark (a crash, an answer lost): the next Send finds the text of this account and only marks it; without it there, posts', async () => {
    const s = await setup([threadItem('Thanks!', { error: IN_FLIGHT }), conversationItem('Thanks!', { error: IN_FLIGHT })])
    before(s.gh, 'Thanks!')
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Thanks!'), body: 'Thanks!' }, { ...conversationRef(1, 'Thanks!'), body: 'Thanks!' }] }))
    expect(answer.results.map((result) => [result.outcome, result.sentUrl])).toEqual([
      ['already-sent', `https://github.com/${API}/pull/${PR}#discussion_r42`],
      ['already-sent', `https://github.com/${API}/pull/${PR}#issuecomment-43`],
    ])
    expect(writes(s.gh)).toEqual([])
    const fresh = await setup([threadItem('Thanks!', { error: IN_FLIGHT })])
    expect(ok(await fresh.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Thanks!'), body: 'Thanks!' }] })).results[0]!.outcome).toBe('sent')
    expect(writes(fresh.gh)).toHaveLength(1)
  })

  it.each([
    ['CRLF line ends', 'Two lines:\nfirst, second.', 'Two lines:\r\nfirst, second.'],
    ['trailing white space', 'Done.\n', 'Done.'],
  ])('GitHub gives the text back with %s: still the same reply, only marked', async (_, body, onGitHub) => {
    const s = await setup([threadItem(body, { error: `${UNCONFIRMED}: gh: Server Error (HTTP 502)` })])
    before(s.gh, onGitHub)
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(body), body }] })).results[0]!.outcome).toBe('already-sent')
    expect(writes(s.gh)).toEqual([])
  })

  it('a refusal of a reply whose Send GitHub did not confirm keeps the mark: the Send after it still looks first', async () => {
    let clean = false
    const s = await setup([threadItem('Thanks!', { error: IN_FLIGHT })], {
      over: { lint: async (): Promise<LintRun> => (clean ? { code: 0, stdout: 'review-draft-lint: clean (1 replies)\n', stderr: '' } : { code: 1, stdout: 'items[0]: too long\n', stderr: '' }) },
    })
    before(s.gh, 'Thanks!')
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Thanks!'), body: 'Thanks!' }] })).results[0]!.outcome).toBe('refused')
    expect(s.draft().items[0]!.error).toContain(UNCONFIRMED)
    clean = true
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef('Thanks!'), body: 'Thanks!' }] })).results[0]!.outcome).toBe('already-sent')
    expect(writes(s.gh)).toEqual([])
  })
})

describe('which reply, and where it goes', () => {
  const T0 = 'PRRT_demo0'
  const T1 = 'PRRT_demo1b'

  it('text the view typed for thread T1 sent under T0: refused, nothing posted, the file stays', async () => {
    const s = await setup([threadItem('Draft zero', { threadId: T0, replyTo: 500 }), threadItem('Draft one', { threadId: T1, replyTo: 501 })], { replies: { threads: { [T0]: 500, [T1]: 501 } } })
    const file = readFileSync(s.file, 'utf8')
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ index: 1, kind: 'thread', threadId: T0, base: 'Draft one', body: 'Text meant for thread T1' }] }))
    expect(answer.results[0]).toMatchObject({ outcome: 'refused', reason: 'The drafts changed meanwhile (the Session wrote new ones): look at them again' })
    expect(writes(s.gh)).toEqual([])
    expect(readFileSync(s.file, 'utf8')).toBe(file)
  })

  it('the Session moved the replies: the one with the text the view read is sent, the other edited reply at its old place is untouched', async () => {
    // The view read [Alpha, Beta]; the Session kept the edited Beta first and appended Alpha.
    const s = await setup([conversationItem('Beta, edited by the user', { edited: true }), conversationItem('Alpha')])
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...conversationRef(0, 'Alpha'), body: 'Alpha, typed' }] }))
    expect(answer.results[0]!.outcome).toBe('sent')
    expect(posted(s.gh).map((each) => each.body)).toEqual(['Alpha, typed'])
    expect(s.draft().items).toEqual([conversationItem('Beta, edited by the user', { edited: true }), conversationItem('Alpha, typed', { edited: true, state: 'sent', sentUrl: `https://github.com/${API}/pull/${PR}#issuecomment-9001`, error: null })])
  })

  it('a reply whose own text and the text read are both gone from the file: refused, the other reply not overwritten', async () => {
    const s = await setup([conversationItem('Beta, edited by the user', { edited: true }), conversationItem('Gamma')])
    const file = readFileSync(s.file, 'utf8')
    for (const [channel, input] of [
      ['prInbox.saveDraft', { ...pull, item: conversationRef(0, 'Alpha'), body: 'Alpha, typed' }],
      ['prInbox.discard', { ...pull, item: conversationRef(0, 'Alpha'), body: 'Alpha, typed' }],
    ] as const)
      expect((await s.call(channel, input)).ok, channel).toBe(false)
    expect(ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...conversationRef(0, 'Alpha'), body: 'Alpha, typed' }] })).results[0]!.outcome).toBe('refused')
    expect(readFileSync(s.file, 'utf8')).toBe(file)
    expect(writes(s.gh)).toEqual([])
  })

  it('a draft whose replyTo is not the first comment of its thread on GitHub: refused before the POST', async () => {
    const s = await setup([threadItem('The server drops one try.')], { replies: { threads: { [THREAD]: 9999 } } })
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }))
    expect(answer.results[0]).toMatchObject({ outcome: 'refused', reason: `Not sent: the draft answers comment ${REPLY_TO}, but the thread on GitHub starts with comment 9999` })
    expect(writes(s.gh)).toEqual([])
    expect(s.draft().items[0]!.error).toBe(answer.results[0]!.reason)
  })

  it('a Profile that names no GitHub account: Send refused before any gh call, with what to set', async () => {
    const s = await setup([threadItem('ok')], { over: { account: async () => null } })
    expect(await s.call('prInbox.send', { ...pull, items: [{ ...threadRef('ok'), body: 'ok' }] })).toEqual({ ok: false, error: `prInbox.send failed: ${NO_ACCOUNT}` })
    expect(NO_ACCOUNT).toMatch(/github\.account/u)
    expect(s.gh.calls()).toEqual([])
  })
})

describe('a Session writing the file', () => {
  it('a write of pr-reply-draft between the last read and the rename is not lost: the change is made again over it', async () => {
    let wrote = false
    const s = await setup([threadItem('The server drops one try.')], {
      over: {
        beforeRename: async (file) => {
          if (wrote) return
          wrote = true
          // As pr-reply-draft writes: a temporary file and a rename, a new reply appended.
          const content = JSON.parse(readFileSync(file, 'utf8')) as { items: unknown[] }
          content.items.push(conversationItem('Appended by the Session'))
          writeFileSync(`${file}.session.tmp`, `${JSON.stringify(content, null, 2)}\n`)
          renameSync(`${file}.session.tmp`, file)
        },
      },
    })
    ok(await s.call('prInbox.saveDraft', { ...pull, item: threadRef(), body: 'Three tries.' }))
    expect(wrote).toBe(true)
    expect(s.draft().items).toEqual([threadItem('Three tries.', { edited: true }), conversationItem('Appended by the Session')])
  })
})
