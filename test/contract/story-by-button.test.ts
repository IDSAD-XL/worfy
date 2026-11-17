// A Code story made by the button (worfy-code-stories ticket 11, src/main/stories/by-button.ts) over the real builder of
// ticket 04 (src/main/stories/one-shot.ts) and the real store of ticket 08 (src/main/stories/store.ts) in a temporary
// data folder. The Vendor's oneShot is a stand-in that records what it was asked and answers a fixture story
// (test/fixtures/code-story-answers); gh, the workflow reader and the Profile are stand-ins too. Nothing reaches GitHub
// or a model.
//
// - The request of a PR holds its diff, its text, its Ticket's file and the review verdicts of the Project's account.
// - A colleague's PR: the kept file holds neither the PR's text nor its comments, nor its title.
// - Stop keeps nothing, whether it comes while main reads the material (gh, the workflow) or during the request; a
//   second press on a PR with a kept story opens it with no request.
// - A Ticket's PR in a Project over several repositories is read in the repository its `PR: <repo>#N` line names.
// - The story of an Epic before its end: each ready chapter names the head of its own PR, whatever the agent said, and
//   the code of a chapter is read at that head (storyFragmentCode, `{ commit }`); a Ticket not ready is marked in Start.
// - A Codex Project: the reason, and neither gh nor a request.
// - The builder (audit of PR #1890): two builds of one storyId — the second is refused, and Stop reaches the first.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput, StoryTarget } from '../../src/shared/ipc/stories'
import type { Story } from '../../src/shared/stories/schema'
import type { Capabilities } from '../../src/shared/vendors/capabilities'
import type { Epic, Ticket } from '../../src/shared/workflow/types'
import type { OneShotOptions } from '../../src/main/vendors/one-shot'
import type { PrRead, StoryMakerDeps, StoryRepo } from '../../src/main/stories/by-button'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))

const { StoryMaker, notReadyLine, settleChapters } = await import('../../src/main/stories/by-button')
const { StoryBuilder } = await import('../../src/main/stories/one-shot')
const { readSavedStory, storiesPath } = await import('../../src/main/stories/store')
const { storyFragmentCode } = await import('../../src/main/stories/code')
const { CODEX_CAPABILITIES } = await import('../../src/main/vendors/codex/capabilities')

const ANSWERS = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const CODE_REPO = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')
const answer = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(ANSWERS, `${name}.json`), 'utf8')) as Record<string, unknown>

const CLAUDE: Capabilities = { oneShotToolFree: true, unsupported: {} } as unknown as Capabilities
const HEAD = 'a'.repeat(40)
const REPO: StoryRepo = { slug: 'shop/demo-cart', folder: '', name: null }

const COLLEAGUE_TEXT = 'Colleague words: please keep this between us'
const COLLEAGUE_COMMENT = 'A private remark of a colleague in the conversation'
const VERDICT = 'VERIFIED\n\nThe total is in whole cents; src/cart.ts:13 skips zero quantities.'

let base: string
let dataDir: string
/** What the stand-in oneShot was asked. */
let requests: { prompt: string; opts: OneShotOptions }[]
/** The structured answer of the next request; `hold`: no answer until Stop. */
let next: { structured: unknown; hold: boolean }
/** The gh reads asked of the stand-in. */
let ghReads: string[]
/** The repositories (`owner/name`) the PR reads were asked in. */
let prRepos: string[]

const oneShot = (prompt: string, opts: OneShotOptions) => {
  requests.push({ prompt, opts })
  opts.onActivity?.('Read src/cart.ts')
  if (next.hold) {
    return new Promise<never>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  return Promise.resolve({ text: '', structured: next.structured })
}

const builderOf = (capabilities: Capabilities = CLAUDE) => new StoryBuilder({ oneShot: () => oneShot, capabilities: () => Promise.resolve(capabilities), runDir: () => join(base, 'run') })

const ticket = (num: number, pr: number | null, extra: Partial<Ticket> = {}): Ticket =>
  ({ epic: 'demo-cart', num, slug: ['', '', '', 'money', 'cart-total', 'coupon', 'receipt'][num] ?? 'x', title: `Ticket ${String(num)}`, state: 'done', pr, ...extra }) as unknown as Ticket

interface World {
  author: string
  viewer: string | null
  heads: Record<number, string>
}

function deps(world: World, options: { capabilities?: Capabilities; builder?: InstanceType<typeof StoryBuilder> } = {}): StoryMakerDeps {
  const epic = {
    epic: 'demo-cart',
    stories: [
      { kind: 'pr', path: 'demo-cart/stories/03-money.md', ticket: '03', version: '1' },
      { kind: 'pr', path: 'demo-cart/stories/04-cart-total.md', ticket: '04', version: '1' },
    ],
  } as unknown as Epic
  return {
    builder: options.builder ?? builderOf(options.capabilities),
    capabilities: () => Promise.resolve(options.capabilities ?? CLAUDE),
    project: () => ({ root: join(base, 'project'), dataDir, vendor: options.capabilities === undefined ? 'claude' : 'codex' }),
    repos: () => Promise.resolve([{ ...REPO, folder: join(base, 'project') }]),
    pr: (repo, number): Promise<PrRead> => {
      ghReads.push(`pr view ${String(number)}`)
      prRepos.push(repo.slug)
      return Promise.resolve({
        title: 'Cart total in cents',
        body: COLLEAGUE_TEXT,
        author: world.author,
        head: world.heads[number] ?? HEAD,
        branch: 'demo-cart/04',
        comments: [
          { author: 'someone-else', body: COLLEAGUE_COMMENT },
          { author: 'dev-me', body: VERDICT },
        ],
      })
    },
    diff: (_repo, number) => {
      ghReads.push(`pr diff ${String(number)}`)
      return Promise.resolve('diff --git a/src/cart.ts b/src/cart.ts\n+  if (line.quantity <= 0) continue\n')
    },
    checkout: (repo) => Promise.resolve(repo.folder),
    viewer: () => Promise.resolve(world.viewer),
    account: () => Promise.resolve('dev-me'),
    language: () => Promise.resolve('en'),
    workflow: () => Promise.resolve({ tickets: [ticket(3, 211), ticket(4, 212), ticket(5, 213), ticket(6, null, { state: 'open' } as Partial<Ticket>)], epics: [epic] }),
    ticketFile: (_root, one) => Promise.resolve({ file: `0${String(one.num)}-${one.slug}.md`, text: `# 0${String(one.num)} — the Ticket text` }),
    storyFile: (_root, path) => Promise.resolve(`# Code story of ${path}\n`),
    spec: () => Promise.resolve('# Demo cart\n\nThe spec text.'),
  }
}

const PR: StoryTarget = { kind: 'pr', repo: 'shop/demo-cart', number: 212 }
const make = (maker: InstanceType<typeof StoryMaker>, target: StoryTarget, storyId = 's1', rebuild = false) => maker.make({ storyId, projectId: 'p1', target, rebuild }, () => undefined)

beforeEach(async () => {
  base = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-story-by-button-')))
  dataDir = join(base, 'data', 'p1')
  mkdirSync(join(base, 'project'), { recursive: true })
  requests = []
  ghReads = []
  prRepos = []
  next = { structured: answer('pr-en'), hold: false }
})

afterEach(async () => {
  await removeTestTree(base)
})

describe('the story of a PR made by the button', () => {
  it("the request holds the PR's diff, its text, its Ticket's file and the verdicts of the Project's account, and reads the PR's checkout", async () => {
    const made = await make(new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} })), PR)
    expect(made).toMatchObject({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'story' } })
    expect(requests).toHaveLength(1)
    const { prompt, opts } = requests[0]!
    expect(prompt).toContain('=== Diff ===\ndiff --git a/src/cart.ts b/src/cart.ts\n+  if (line.quantity <= 0) continue')
    expect(prompt).toContain(`=== PR ===\nCart total in cents\n\n${COLLEAGUE_TEXT}`)
    expect(prompt).toContain('=== Ticket 04-cart-total.md ===\n# 04 — the Ticket text')
    expect(prompt).toContain(`=== Review verdict 1 ===\n${VERDICT}`)
    // The colleague's comment is no verdict of the Project's account.
    expect(prompt).not.toContain(COLLEAGUE_COMMENT)
    expect(opts.readFolders).toEqual([join(base, 'project')])
    expect(opts.readOnlyTools).toEqual(['Read', 'Glob', 'Grep'])
    const kept = JSON.parse(readFileSync(storiesPath(dataDir), 'utf8')) as { stories: Record<string, { colleague: boolean; story: { header: Record<string, unknown> } }> }
    expect(kept.stories['shop/demo-cart#212']!.colleague).toBe(false)
    expect(kept.stories['shop/demo-cart#212']!.story.header).toEqual({ title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: HEAD })
  })

  it("a colleague's PR: the kept file holds neither the PR's text nor its comments nor its title", async () => {
    const made = await make(new StoryMaker(deps({ author: 'a-colleague', viewer: 'dev-me', heads: {} })), PR)
    expect(made.outcome.status).toBe('story')
    // The agent did read them: they are in the request, in memory only, between the markers of the material.
    expect(requests[0]!.prompt).toContain(COLLEAGUE_TEXT)
    // The instruction above the material names the PR by its number, not by the colleague's title.
    const instruction = requests[0]!.prompt.split('=== Diff ===')[0]!
    expect(instruction).toContain('"PR #212"')
    expect(instruction).not.toContain('Cart total in cents')
    const file = readFileSync(storiesPath(dataDir), 'utf8')
    expect(file).not.toContain(COLLEAGUE_TEXT)
    expect(file).not.toContain(COLLEAGUE_COMMENT)
    expect(file).not.toContain('Cart total in cents')
    expect(file).not.toContain('VERIFIED')
    const kept = JSON.parse(file) as { stories: Record<string, { colleague: boolean; story: { header: { title: string } } }> }
    expect(kept.stories['shop/demo-cart#212']).toMatchObject({ colleague: true, story: { header: { title: 'PR #212' } } })
  })

  it("whose PR is unknown (no viewer, no account): it counts as a colleague's", async () => {
    const world = deps({ author: 'dev-me', viewer: null, heads: {} })
    await make(new StoryMaker({ ...world, account: () => Promise.resolve(null) }), PR)
    expect(readFileSync(storiesPath(dataDir), 'utf8')).not.toContain(COLLEAGUE_TEXT)
  })

  it('Stop during the build keeps nothing', async () => {
    next.hold = true
    const maker = new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }))
    const making = make(maker, PR, 's-stop')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(maker.stop('s-stop')).toBe(true)
    expect(await making).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(existsSync(storiesPath(dataDir))).toBe(false)
    expect(maker.stop('s-stop')).toBe(false)
  })

  it('Stop while main reads the diff: stopped, no request, nothing kept, and nothing more is read', async () => {
    let giveDiff: (text: string) => void = () => undefined
    const world = deps({ author: 'dev-me', viewer: 'dev-me', heads: {} })
    let workflowReads = 0
    const maker = new StoryMaker({
      ...world,
      workflow: (root) => {
        workflowReads += 1
        return world.workflow(root)
      },
      diff: () => {
        ghReads.push('pr diff')
        return new Promise<string>((resolve) => (giveDiff = resolve))
      },
    })
    const making = make(maker, PR, 's-early')
    await vi.waitFor(() => expect(ghReads).toContain('pr diff'))
    expect(maker.stop('s-early')).toBe(true)
    giveDiff('diff --git a/src/cart.ts b/src/cart.ts\n+  if (line.quantity <= 0) continue\n')
    expect(await making).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(requests).toEqual([])
    expect(workflowReads).toBe(0)
    expect(existsSync(storiesPath(dataDir))).toBe(false)
    expect(maker.stop('s-early')).toBe(false)
  })

  it('a second make under the same storyId while the first reads is refused, and reads nothing', async () => {
    let giveDiff: (text: string) => void = () => undefined
    const maker = new StoryMaker({ ...deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }), diff: () => new Promise<string>((resolve) => (giveDiff = resolve)) })
    const first = make(maker, PR, 'twice')
    await vi.waitFor(() => expect(ghReads).toContain('pr view 212'))
    const reads = ghReads.length
    expect(await make(maker, PR, 'twice')).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'failed', reason: 'The story twice is already being built.' } })
    expect(ghReads).toHaveLength(reads)
    giveDiff('diff --git a/x b/x\n+x\n')
    expect((await first).outcome.status).toBe('story')
  })

  it("the Vendor answers after Stop: the answer is dropped, the build is stopped and keeps nothing", async () => {
    // A oneShot that does not end on its signal: it answers a whole story once Stop came.
    const late = (prompt: string, opts: OneShotOptions) => {
      requests.push({ prompt, opts })
      return new Promise<{ text: string; structured: unknown }>((resolve) => opts.signal?.addEventListener('abort', () => resolve({ text: '', structured: answer('pr-en') })))
    }
    const builder = new StoryBuilder({ oneShot: () => late, capabilities: () => Promise.resolve(CLAUDE), runDir: () => join(base, 'run') })
    const maker = new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }, { builder }))
    const making = make(maker, PR, 's-late')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(maker.stop('s-late')).toBe(true)
    expect(await making).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(existsSync(storiesPath(dataDir))).toBe(false)
  })

  it('a second press on a PR with a kept story opens it with no new request; Rebuild asks again', async () => {
    const maker = new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }))
    const first = await make(maker, PR, 's1')
    const reads = ghReads.length
    const second = await make(maker, { kind: 'pr', repo: 'SHOP/demo-cart', number: 212 }, 's2')
    expect(second).toEqual({ key: 'shop/demo-cart#212', reused: true, outcome: first.outcome })
    expect(requests).toHaveLength(1)
    expect(ghReads).toHaveLength(reads)
    // A Ticket card names no repository: the Project's own, the same key.
    expect(await make(maker, { kind: 'pr', repo: null, number: 212 }, 's3')).toMatchObject({ key: 'shop/demo-cart#212', reused: true })
    expect(requests).toHaveLength(1)
    expect(await make(maker, PR, 's4', true)).toMatchObject({ reused: false, outcome: { status: 'story' } })
    expect(requests).toHaveLength(2)
  })

  it("a Ticket's PR in a Project over several repositories: read in the repository its `PR: <repo>#N` line names, with that Ticket's file", async () => {
    const world = deps({ author: 'dev-me', viewer: 'dev-me', heads: {} })
    const app: StoryRepo = { slug: 'shop/app', folder: join(base, 'app'), name: 'app' }
    const maker = new StoryMaker({
      ...world,
      repos: () => Promise.resolve([{ ...REPO, folder: join(base, 'project'), name: 'lib' }, app]),
      workflow: () => Promise.resolve({ tickets: [ticket(4, 212), ticket(5, 7, { repos: ['lib', 'app'], prs: [{ repo: 'lib', number: 31 }, { repo: 'app', number: 7 }] } as Partial<Ticket>)], epics: [] }),
    })
    const made = await make(maker, { kind: 'pr', repo: 'app', number: 7 })
    expect(made).toMatchObject({ key: 'shop/app#7', outcome: { status: 'story' } })
    expect(prRepos).toEqual(['shop/app'])
    expect(requests[0]!.prompt).toContain('=== Ticket 05-coupon.md ===')
    expect(requests[0]!.opts.readFolders).toEqual([join(base, 'app')])
    // PR #212 of the first repository is not the Ticket 04 PR of `app`: a bare `PR: #N` is the first repository's.
    await make(maker, { kind: 'pr', repo: 'app', number: 212 }, 's2')
    expect(requests[1]!.prompt).not.toContain('=== Ticket 04')
  })

  it('a repository that is not the Project\'s is refused before anything is read', async () => {
    const made = await make(new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} })), { kind: 'pr', repo: 'other/repo', number: 1 })
    expect(made).toEqual({ key: 'other/repo#1', reused: false, outcome: { status: 'failed', reason: 'other/repo is not a repository of this Project.' } })
    expect(ghReads).toEqual([])
    expect(requests).toEqual([])
  })
})

describe('a Project on Codex', () => {
  it('answers the reason of its capabilities, and reads no PR and asks no request', async () => {
    const made = await make(new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }, { capabilities: CODEX_CAPABILITIES })), PR)
    expect(made.outcome).toEqual({ status: 'unavailable', reason: CODEX_CAPABILITIES.unsupported.oneShotToolFree })
    expect(ghReads).toEqual([])
    expect(requests).toEqual([])
    expect(existsSync(storiesPath(dataDir))).toBe(false)
  })
})

describe('the story of an Epic before its end', () => {
  const git = (at: string, ...args: string[]): string => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: at, env, encoding: 'utf8' }).trim()
  }

  it('each ready chapter names the head of its own PR and its code is read there; the Tickets not ready are marked in Start', async () => {
    // Two heads: the PR of Ticket 03 at the fixture code, the PR of Ticket 04 where cart.ts stands three lines lower.
    const repo = join(base, 'project')
    git(repo, 'init', '-q', '-b', 'main')
    cpSync(join(CODE_REPO, 'repo', 'src'), join(repo, 'src'), { recursive: true })
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'PR 211')
    const head211 = git(repo, 'rev-parse', 'HEAD')
    cpSync(join(CODE_REPO, 'repo-main-shifted', 'src'), join(repo, 'src'), { recursive: true })
    git(repo, 'commit', '-q', '-am', 'PR 212')
    const head212 = git(repo, 'rev-parse', 'HEAD')

    // The agent's answer names heads of its own and calls Ticket 05 ready: worfy has the last word.
    next.structured = answer('epic-ru')
    const made = await make(new StoryMaker({ ...deps({ author: 'dev-me', viewer: 'dev-me', heads: { 211: head211, 212: head212 } }), language: () => Promise.resolve('ru') }), { kind: 'epic', epic: 'demo-cart' })
    expect(made).toMatchObject({ key: 'epic:demo-cart', reused: false, outcome: { status: 'story' } })

    // The request: the spec, a ready chapter with its PR and head, the Tickets not ready with why.
    const prompt = requests[0]!.prompt
    expect(prompt).toContain('=== Spec ===\n# Demo cart')
    expect(prompt).toContain(`Ticket 03 — Ticket 3\nReady: yes\nPR: #211\nHead: ${head211}\nThe Code story of its PR (demo-cart/stories/03-money.md):\n# Code story of demo-cart/stories/03-money.md`)
    expect(prompt).toContain('Ticket 05 — Ticket 5\nReady: no — PR #213 ещё не влит: его Code story нет в основной ветке')
    expect(prompt).toContain('Ticket 06 — Ticket 6\nReady: no — PR ещё нет')

    const kept = JSON.parse(readFileSync(storiesPath(dataDir), 'utf8')) as { stories: Record<string, { story: { start: { text: string }; chapters: { ticket: string; ready: boolean; pr: number | null; head: string | null; steps: { kind: string; fragment?: never }[] }[] } }> }
    const story = kept.stories['epic:demo-cart']!.story
    expect(story.chapters.map(({ ticket: num, ready, pr, head }) => ({ num, ready, pr, head }))).toEqual([
      { num: '03', ready: true, pr: 211, head: head211 },
      { num: '04', ready: true, pr: 212, head: head212 },
      { num: '05', ready: false, pr: null, head: null },
      { num: '06', ready: false, pr: null, head: null },
    ])
    expect(story.start.text.endsWith(notReadyLine('ru', ['05', '06']))).toBe(true)

    // The code of each chapter is read at its own head: cart.ts of Ticket 04 three lines lower than the fixture says.
    const layout = { root: repo, mode: 'full', workflowFolder: repo, ticketsRoot: join(repo, '.scratch'), repos: [], workspace: null, reason: null, failed: false } as const
    const step = (num: string) => (story.chapters.find((chapter) => chapter.ticket === num)!.steps.find((one) => one.kind === 'code') as unknown as { fragment: Parameters<typeof storyFragmentCode>[2] }).fragment
    const chapterHead = (num: string) => story.chapters.find((chapter) => chapter.ticket === num)!.head!
    expect(await storyFragmentCode(layout, { commit: chapterHead('03') }, step('03'))).toMatchObject({ startLine: 6, fromHead: false, reason: null })
    expect(await storyFragmentCode(layout, { commit: chapterHead('04') }, step('04'))).toMatchObject({ startLine: 13, fromHead: false, reason: null })
  })

  it("a Russian story gives worfy's reasons in Russian: no head from GitHub, no GitHub repository", async () => {
    next.structured = answer('epic-ru')
    const world = { ...deps({ author: 'dev-me', viewer: 'dev-me', heads: { 211: 'not-a-sha' } }), language: () => Promise.resolve('ru' as const) }
    await make(new StoryMaker(world), { kind: 'epic', epic: 'demo-cart' })
    expect(requests[0]!.prompt).toContain('Ticket 03 — Ticket 3\nReady: no — head PR #211 не прочитан: GitHub его не даёт')
    await make(new StoryMaker({ ...world, repos: () => Promise.resolve([]) }), { kind: 'epic', epic: 'demo-cart' }, 's2', true)
    expect(requests[1]!.prompt).toContain('Ticket 03 — Ticket 3\nReady: no — head PR #211 не прочитан: у Project-а нет репозитория на GitHub')
  })
})

describe("worfy's last word on the chapters of an Epic story (settleChapters)", () => {
  const H3 = '3'.repeat(40)
  const H4 = '4'.repeat(40)
  const known = [
    { ticket: '03', title: 'Ticket 3', ready: { pr: 211, head: H3, story: '', path: 'demo-cart/stories/03-money.md' }, why: null },
    { ticket: '04', title: 'Ticket 4', ready: { pr: 212, head: H4, story: '', path: 'demo-cart/stories/04-cart-total.md' }, why: null },
  ]

  it('keeps only the Tickets worfy knows; a ready Ticket the answer left out is a chapter not ready, with why', () => {
    const given = answer('epic-ru') as { chapters: Record<string, unknown>[] }
    // The agent dropped Ticket 04 and invented Ticket 99, ready with a head of its own.
    const chapters = [...given.chapters.filter((one) => one['ticket'] !== '04'), { ...given.chapters[0]!, ticket: '99', head: '9'.repeat(40) }]
    const story = { kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, ...given, chapters } as unknown as Extract<Story, { kind: 'epic' }>
    const settled = settleChapters(story, known)
    expect(settled.chapters.map(({ ticket: num, ready, pr, head, why }) => ({ num, ready, pr, head, why }))).toEqual([
      { num: '03', ready: true, pr: 211, head: H3, why: null },
      { num: '04', ready: false, pr: null, head: null, why: 'в story нет его шагов: ответ пропустил этот Ticket' },
    ])
    expect(settled.start.text.endsWith(notReadyLine('ru', ['04']))).toBe(true)
  })
})

describe('the builder (audit of PR #1890)', () => {
  const bareInput = (): StoryInput => ({ kind: 'pr', header: { title: 'x', epic: null, ticket: null, pr: 1, language: 'en', commit: HEAD }, diff: 'd', prText: '', ticket: null, verdicts: [] })

  it('two builds of one story: the second is refused while the first reads the capabilities, and Stop reaches the first', async () => {
    next.hold = true
    let answerCapabilities: (value: Capabilities) => void = () => undefined
    const capabilities = new Promise<Capabilities>((resolve) => (answerCapabilities = resolve))
    const builder = new StoryBuilder({ oneShot: () => oneShot, capabilities: () => capabilities, runDir: () => join(base, 'run') })
    const input = bareInput()
    const first = builder.build({ storyId: 'same', folder: base, vendor: 'claude', input }, () => undefined)
    const second = await builder.build({ storyId: 'same', folder: base, vendor: 'claude', input }, () => undefined)
    expect(second).toEqual({ status: 'failed', reason: 'The story same is already being built.' })
    answerCapabilities(CLAUDE)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(builder.stop('same')).toBe(true)
    expect(await first).toEqual({ status: 'stopped' })
    expect(builder.stop('same')).toBe(false)
  })

  it('the Vendor answers after Stop: the builder drops the answer and says stopped', async () => {
    const late = (prompt: string, opts: OneShotOptions) => {
      requests.push({ prompt, opts })
      return new Promise<{ text: string; structured: unknown }>((resolve) => opts.signal?.addEventListener('abort', () => resolve({ text: '', structured: answer('pr-en') })))
    }
    const builder = new StoryBuilder({ oneShot: () => late, capabilities: () => Promise.resolve(CLAUDE), runDir: () => join(base, 'run') })
    const building = builder.build({ storyId: 'late', folder: base, vendor: 'claude', input: bareInput() }, () => undefined)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(builder.stop('late')).toBe(true)
    expect(await building).toEqual({ status: 'stopped' })
  })

  it('Stop while the capabilities are read: no request starts', async () => {
    let answerCapabilities: (value: Capabilities) => void = () => undefined
    const capabilities = new Promise<Capabilities>((resolve) => (answerCapabilities = resolve))
    const builder = new StoryBuilder({ oneShot: () => oneShot, capabilities: () => capabilities, runDir: () => join(base, 'run') })
    const input = bareInput()
    const building = builder.build({ storyId: 'early', folder: base, vendor: 'claude', input }, () => undefined)
    expect(builder.stop('early')).toBe(true)
    answerCapabilities(CLAUDE)
    expect(await building).toEqual({ status: 'stopped' })
    expect(requests).toEqual([])
  })
})

// worfy-polish 122 (owner's bug report 2026-11-17): a build by the button runs to its end whatever view is open, so main
// keeps the builds under way by Project and key. A button that comes back finds its build (`running`), a second press
// of a key under way starts no second request, the story is kept under its own key, and Stop ends only its own build.
describe('the builds by the button under way, by key (worfy-polish 122)', () => {
  const PR_B: StoryTarget = { kind: 'pr', repo: 'shop/demo-cart', number: 213 }

  /** A maker whose requests each hold until the test lets them go, in the order they came; Stop ends one. */
  function heldMaker(): { maker: InstanceType<typeof StoryMaker>; letGo: (index: number) => void } {
    const answers: (() => void)[] = []
    const held = (prompt: string, opts: OneShotOptions) => {
      requests.push({ prompt, opts })
      opts.onActivity?.(`Read the diff of request ${String(requests.length)}`)
      return new Promise<{ text: string; structured: unknown }>((resolve, reject) => {
        answers.push(() => resolve({ text: '', structured: answer('pr-en') }))
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    const builder = new StoryBuilder({ oneShot: () => held, capabilities: () => Promise.resolve(CLAUDE), runDir: () => join(base, 'run') })
    return { maker: new StoryMaker(deps({ author: 'dev-me', viewer: 'dev-me', heads: {} }, { builder })), letGo: (index) => answers[index]!() }
  }

  const keptPr = (key: string): number | null => {
    const saved = readSavedStory(dataDir, key)
    return saved !== null && saved.story.kind === 'pr' ? saved.story.header.pr : null
  }

  it('two keys build side by side; each story is kept under its own key, whichever ends first', async () => {
    const { maker, letGo } = heldMaker()
    const a = make(maker, PR, 'build-a')
    const b = make(maker, PR_B, 'build-b')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(await maker.runningOf('p1', PR)).toEqual({ storyId: 'build-a', key: 'shop/demo-cart#212', lines: ['Read the diff of request 1'] })
    // A Ticket card names no repository: the Project's own, the same key.
    expect(await maker.runningOf('p1', { kind: 'pr', repo: null, number: 213 })).toEqual({ storyId: 'build-b', key: 'shop/demo-cart#213', lines: ['Read the diff of request 2'] })
    expect(await maker.runningOf('p2', PR)).toBeNull()
    // B ends while A still builds: its story goes under its own key, and A's key has none yet.
    letGo(1)
    expect(await b).toMatchObject({ key: 'shop/demo-cart#213', outcome: { status: 'story' } })
    expect(keptPr('shop/demo-cart#213')).toBe(213)
    expect(keptPr('shop/demo-cart#212')).toBeNull()
    expect(await maker.runningOf('p1', PR_B)).toBeNull()
    expect(await maker.runningOf('p1', PR)).toMatchObject({ storyId: 'build-a' })
    letGo(0)
    expect(await a).toMatchObject({ key: 'shop/demo-cart#212', outcome: { status: 'story' } })
    expect(keptPr('shop/demo-cart#212')).toBe(212)
    expect(await maker.runningOf('p1', PR)).toBeNull()
  })

  it('a second make of a key under way starts no second request: it hears that build and answers its story; Rebuild too', async () => {
    const { maker, letGo } = heldMaker()
    const first = make(maker, PR, 'first')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const heard: string[] = []
    const again = maker.make({ storyId: 'again', projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } }, (text) => heard.push(text))
    const rebuild = make(maker, PR, 'rebuild', true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    letGo(0)
    const made = await first
    expect(made.outcome.status).toBe('story')
    expect(await again).toEqual(made)
    expect(await rebuild).toEqual(made)
    expect(requests).toHaveLength(1)
    expect(await maker.runningOf('p1', PR)).toBeNull()
  })

  it('Stop ends only its own build; Stop under a press that joined a build ends that build', async () => {
    const { maker } = heldMaker()
    const a = make(maker, PR, 'build-a')
    const b = make(maker, PR_B, 'build-b')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(maker.stop('build-a')).toBe(true)
    expect(await a).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(await maker.runningOf('p1', PR_B)).toMatchObject({ storyId: 'build-b' })
    const joined = make(maker, PR_B, 'joined')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(maker.stop('joined')).toBe(true)
    expect(await b).toMatchObject({ key: 'shop/demo-cart#213', outcome: { status: 'stopped' } })
    expect(await joined).toMatchObject({ outcome: { status: 'stopped' } })
    expect(requests).toHaveLength(2)
    expect(existsSync(storiesPath(dataDir))).toBe(false)
  })

  it('the end of a build is told once, to the press that started it, not to one that joined it', async () => {
    const { maker, letGo } = heldMaker()
    const ends: string[] = []
    const first = maker.make({ storyId: 'first', projectId: 'p1', target: PR }, () => undefined, (made) => ends.push(`first ${made.outcome.status}`))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const again = maker.make({ storyId: 'again', projectId: 'p1', target: PR }, () => undefined, (made) => ends.push(`again ${made.outcome.status}`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    letGo(0)
    await Promise.all([first, again])
    expect(ends).toEqual(['first story'])
    // When it is told, the build is no longer under way: a button that asks then finds none.
    expect(await maker.runningOf('p1', PR)).toBeNull()
  })
})
