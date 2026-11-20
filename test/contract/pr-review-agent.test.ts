// Agent review (worfy-pr-review ticket 08, src/main/github/pr-review-agent.ts) through the `prReview` IPC handlers, on the
// fake agent (WORFY_AGENT=fake: a Session plays test/fixtures/agent-scripts/interrupt.jsonl, no model, no Claude Code):
// - prReview.agentReview starts a Session on Claude Code with the Team reviewer (`/human-review`) when the Project has
//   one built, else with `/worfy:code-review`, the rule of the draft in the same message; the draft gets
//   `agent: { sessionId, state: 'writing' }` on disk before the Session's first word;
// - `fill: 'add'` (Ask the agent to add comments) keeps the person's draft; `'new'` is refused over it, and a second
//   Agent review is refused while one writes;
// - main watches the draft file while the Session writes and sends prReview.changed; the watch ends with `done`;
// - prReview.stopAgent (Stop, Take over) stops the Session and marks the draft `stopped`, keeping what the agent wrote;
// - a Linked machine is refused both channels before the handler.
// Nothing reaches GitHub: no gh is given at all.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import { PrReviewAgent } from '../../src/main/github/pr-review-agent'
import { PrReviewDrafts, reviewDraftFilePath } from '../../src/main/github/pr-review-draft'
import { appUrlMatcher, registerIpc, type IpcMainLike, type ModuleLoader } from '../../src/main/ipc/index'
import { prReviewHandlers } from '../../src/main/ipc/pr-review'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { privateFolder, reviewerSkill } from '../../src/main/projects/review-offer'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { prReviewAgentReview, prReviewChanged, prReviewStopAgent, type PrReviewDraftAnswer, type ReviewDraft } from '../../src/shared/ipc/pr-review'
import type { VendorId } from '../../src/shared/vendors/vendor'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const API = 'demo-org/api'
const PR = 118
const HEAD = 'a1b2c3d4e5f6'
const PROJECT = 'demo-0000000d'
const RULE = 'Agent review: write the review draft only through bin/pr-review-draft (pr-review-draft --help); the verdict is only a suggestion; nothing goes to GitHub.'
const scriptsDir = join(process.cwd(), 'test', 'fixtures', 'agent-scripts')

const temps: string[] = []
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

interface Setup {
  root: string
  profileDir: string
  file: string
  agent: PrReviewAgent
  calls: FakeCall[]
  vendors: VendorId[]
  changed: unknown[]
  registry: SessionRegistry
  call: <T>(channel: string, input: unknown) => Promise<IpcResult<T>>
  onDisk: () => ReviewDraft
}

async function setup(options: { teamReviewer?: boolean } = {}): Promise<Setup> {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-review-agent-')))
  temps.push(base)
  const root = join(base, 'project')
  const profileDir = join(base, 'profile')
  mkdirSync(root, { recursive: true })
  if (options.teamReviewer === true) {
    const skill = reviewerSkill(privateFolder(profileDir))
    mkdirSync(join(skill, '..'), { recursive: true })
    writeFileSync(skill, '---\nname: human-review\n---\n')
  }
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script: 'interrupt', record: (call) => calls.push(call), releases: new FakeReleases() }), () => null, () => null)
  cleanups.push(() => registry.closeAll())
  const drafts = new PrReviewDrafts({ profileDir: async () => ({ dir: profileDir, reason: null }), warn: () => undefined })
  const vendors: VendorId[] = []
  const changed: unknown[] = []
  let nodes = 0
  const agent = new PrReviewAgent({
    drafts,
    profileDir: async () => ({ dir: profileDir, reason: null }),
    sessions: {
      create: (_projectId, _near, vendor) => {
        vendors.push(vendor)
        const session = registry.start(root, undefined, () => undefined)
        return { nodeId: `node-${++nodes}`, sessionId: session.id }
      },
    },
    registry: { get: (sessionId) => registry.get(sessionId) },
    changed: (input) => changed.push(input),
    pollMs: 50,
  })
  cleanups.push(() => agent.closeAll())
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './pr-review.ts': async () => prReviewHandlers({ drafts: () => drafts, root: () => root, agent: () => agent }) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async <T,>(channel: string, input: unknown) => (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
  const file = reviewDraftFilePath(profileDir, API, PR)
  return { root, profileDir, file, agent, calls, vendors, changed, registry, call, onDisk: () => JSON.parse(readFileSync(file, 'utf8')) as ReviewDraft }
}

function ok<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result.value
}

const pull = { projectId: PROJECT, repo: API, number: PR }
type Started = { nodeId: string; sessionId: string; text: string; draft: ReviewDraft }
const messages = (calls: FakeCall[]): string[] => calls.flatMap((each) => (each.kind === 'message' ? [each.text] : []))

/** What bin/pr-review-draft does to the file, without the script: the draft with `change`, through a rename. */
function agentWrites(file: string, change: (draft: ReviewDraft) => void): void {
  const draft = JSON.parse(readFileSync(file, 'utf8')) as ReviewDraft
  change(draft)
  writeFileSync(`${file}.agent.tmp`, JSON.stringify(draft, null, 2))
  renameSync(`${file}.agent.tmp`, file)
}

describe('prReview.agentReview', () => {
  it('without a Team reviewer: a Session on Claude Code with /worfy:code-review and the rule; the draft is created on the head with the agent writing', async () => {
    const s = await setup()
    const started = ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'new' }))
    expect(started.text).toBe(`/worfy:code-review ${API}#${PR} ${RULE}`)
    expect(s.vendors).toEqual(['claude'])
    expect(started.nodeId).toBe('node-1')
    expect(s.onDisk()).toEqual({ schema: 1, repo: API, pr: PR, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft', agent: { sessionId: started.sessionId, state: 'writing' } })
    expect(started.draft).toEqual(s.onDisk())
    await vi.waitFor(() => expect(messages(s.calls)).toEqual([started.text]))
  })

  it('with the Team reviewer built: /human-review over the PR', async () => {
    const s = await setup({ teamReviewer: true })
    const started = ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'new' }))
    expect(started.text).toBe(`/human-review ${API}#${PR} ${RULE}`)
    await vi.waitFor(() => expect(messages(s.calls)).toEqual([started.text]))
  })

  it('fill add keeps the person’s draft and asks to add; new is refused over it; a second one is refused while the first writes', async () => {
    const s = await setup()
    ok(await s.call('prReview.saveComment', { ...pull, head: HEAD, comment: { path: 'src/upload.ts', line: 12, side: 'RIGHT', body: 'Why three tries?' }, anchor: 'line 12' }))
    expect(await s.call('prReview.agentReview', { ...pull, head: HEAD, fill: 'new' })).toEqual({
      ok: false,
      error: 'prReview.agentReview failed: This pull request has a review draft already: Ask the agent to add comments to it',
    })
    expect(s.vendors).toEqual([])
    const started = ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'add' }))
    expect(started.text).toBe(`/worfy:code-review ${API}#${PR} ${RULE} Add your comments to the person's draft: their comments and their summary stay.`)
    expect(s.onDisk()).toMatchObject({ payload: { comments: [{ body: 'Why three tries?' }] }, anchors: [{ by: 'person' }], agent: { sessionId: started.sessionId, state: 'writing' } })
    expect(await s.call('prReview.agentReview', { ...pull, head: HEAD, fill: 'add' })).toEqual({
      ok: false,
      error: `prReview.agentReview failed: Agent review is writing the review of ${API}#${PR} already: Stop it first`,
    })
    expect(s.vendors).toEqual(['claude'])
  })

  it('sends prReview.changed while the agent writes the file; done ends the watch', { timeout: ms(30_000) }, async () => {
    const s = await setup()
    ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'new' }))
    const before = s.changed.length
    expect(s.agent.watching()).toBe(1)
    agentWrites(s.file, (draft) => {
      draft.payload.comments.push({ path: 'src/upload.ts', line: 3, side: 'RIGHT', body: 'A magic number.' })
      draft.anchors.push({ text: 'const tries = 3', by: 'agent' })
    })
    await vi.waitFor(() => expect(s.changed.length).toBeGreaterThan(before), { timeout: ms(10_000) })
    expect(s.changed.at(-1)).toEqual(pull)
    agentWrites(s.file, (draft) => {
      draft.agent = { sessionId: draft.agent?.sessionId ?? '', state: 'done' }
    })
    await vi.waitFor(() => expect(s.agent.watching()).toBe(0), { timeout: ms(10_000) })
  })
})

describe('prReview.stopAgent', () => {
  it('stops the Session, marks the draft stopped and keeps what the agent wrote; the watch ends', { timeout: ms(30_000) }, async () => {
    const s = await setup()
    const started = ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'new' }))
    await vi.waitFor(() => expect(s.registry.get(started.sessionId).state).toBe('busy'))
    agentWrites(s.file, (draft) => {
      draft.payload.comments.push({ path: 'src/upload.ts', line: 3, side: 'RIGHT', body: 'A magic number.' })
      draft.anchors.push({ text: 'const tries = 3', by: 'agent' })
    })
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.stopAgent', pull))
    expect(answer.draft).toMatchObject({ payload: { comments: [{ body: 'A magic number.' }] }, anchors: [{ by: 'agent' }], agent: { sessionId: started.sessionId, state: 'stopped' } })
    expect(s.onDisk()).toEqual(answer.draft)
    await vi.waitFor(() => expect(s.registry.get(started.sessionId).state).not.toBe('busy'))
    expect(s.agent.watching()).toBe(0)
    expect(s.changed.at(-1)).toEqual(pull)
    // Stopped: a new Agent review may start over it.
    ok(await s.call<Started>('prReview.agentReview', { ...pull, head: HEAD, fill: 'add' }))
  })

  it('without an Agent review: refused, nothing written', async () => {
    const s = await setup()
    expect(await s.call('prReview.stopAgent', pull)).toEqual({ ok: false, error: `prReview.stopAgent failed: No Agent review writes the review of ${API}#${PR}` })
  })
})

describe('a Linked machine', () => {
  const LINKED = '66666666-6666-4666-8666-666666666666'

  it('the Agent review channels are `local`', () => {
    expect([prReviewAgentReview, prReviewStopAgent, prReviewChanged].map((channel) => channel.access)).toEqual(['local', 'local', 'local'])
  })

  it.each(['all', 'read'] as const)('with access %s: both are refused before the handler; no Session starts', async (level) => {
    const spy = { start: vi.fn(), stop: vi.fn(), closeAll: vi.fn(), watching: vi.fn() }
    const drafts = { draft: vi.fn(), saveComment: vi.fn(), deleteComment: vi.fn(), setViewed: vi.fn(), discard: vi.fn(), list: vi.fn() }
    const modules: Record<string, ModuleLoader> = { './pr-review.ts': async () => prReviewHandlers({ drafts: () => drafts as never, root: () => '/nowhere', agent: () => spy as never }) }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess(level)
    for (const [channel, input] of [
      ['prReview.agentReview', { ...pull, head: HEAD, fill: 'new' }],
      ['prReview.stopAgent', pull],
    ] as const)
      expect(await adapter.call(peer, channel, input, 'Beta')).toEqual({ ok: false, error: `${channel}: not open to Linked machines` })
    for (const each of [...Object.values(spy), ...Object.values(drafts)]) expect(each).not.toHaveBeenCalled()
  })
})
