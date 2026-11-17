// The handler stories.build (src/main/ipc/stories.ts, worfy-code-stories ticket 04) over a real git Project with
// one worktree: the folder the oneShot reads is the one storyFolder checked, never the path the window sent. A
// folder that is neither the Project's root nor one of its git worktrees is refused before any request. In a Project over
// several repositories (ticket 11; audit of PR #1890) a repository its Profile lists (`_resolved.repos`, the layout's
// `repos`, stood in here) and its worktrees are read too. The Vendor's driver is a stand-in that records the requests;
// no Claude Code runs. stories.stop reaches a story made by the button (stories.make) while main still reads the PR
// from gh — a stand-in of the PR tracker's gh that answers when the test lets it — and reaches a question
// (stories.ask, ticket 12) under its own id, leaving a build under another id running.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput } from '../../src/shared/ipc/stories'
import { storyFileSchema, type StoryFile } from '../../src/shared/stories/schema'
import type { OneShotOptions } from '../../src/main/vendors/one-shot'
import { ms } from '../time-scale'

const mocks = vi.hoisted(() => ({
  base: '',
  root: '',
  /** What the stand-in oneShot was asked: its prompt and options. */
  requests: [] as { prompt: string; opts: OneShotOptions }[],
  /** The repositories the Profile lists for the Project (the layout's `repos`); none for a Project of one repository. */
  repos: [] as { name: string; path: string }[],
  /** The structured answer of the stand-in oneShot; none by default, so a build or a question fails after its request. */
  structured: undefined as unknown,
  /** The gh calls of the PR tracker's stand-in. */
  gh: [] as string[][],
  /** The gh calls in flight, with their arguments: each answers when the test calls it. */
  waiting: [] as { args: string[]; answer: (out: string) => void }[],
  /** The events every client of the app got (src/main/broadcast.ts stood in): two windows, by their id. */
  clients: [] as { id: number; got: { channel: string; payload: unknown }[] }[],
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))
vi.mock('../../src/main/projects/store', () => ({
  projectStore: () => ({
    get: (id: string) => ({ id, path: mocks.root }),
    dataDir: (id: string) => join(mocks.base, 'worfy-data', 'projects', id),
  }),
}))
vi.mock('../../src/main/workflow/folder', async (original) => ({
  ...(await original<object>()),
  projectLayouts: () => ({ get: () => Promise.resolve({ root: mocks.root, mode: 'silent', repos: mocks.repos, failed: false }) }),
}))
vi.mock('../../src/main/storage/paths', async (original) => ({ ...(await original<object>()), dataRoot: () => join(mocks.base, 'worfy-data') }))
vi.mock('../../src/main/vendors/registry', () => ({
  vendorDriver: () => ({
    capabilities: () => Promise.resolve({ oneShotToolFree: true, unsupported: {} }),
    oneShot: (prompt: string, opts: OneShotOptions) => {
      mocks.requests.push({ prompt, opts })
      return Promise.resolve({ text: '', structured: mocks.structured })
    },
  }),
}))

vi.mock('../../src/main/broadcast', () => ({
  toEveryWindow: (send: (client: unknown) => void) => {
    for (const client of mocks.clients) send({ id: client.id, send: (channel: string, payload: unknown) => client.got.push({ channel, payload }), isDestroyed: () => false })
  },
}))

vi.mock('../../src/main/ipc/checks', () => ({
  sharedPrTracker: () => ({
    gh: (_folder: string, args: string[]) => {
      mocks.gh.push(args)
      return new Promise<string>((resolve) => mocks.waiting.push({ args, answer: resolve }))
    },
  }),
}))

const { default: handlers, answersKey, buttonBuildEvents } = await import('../../src/main/ipc/stories')
const { gitWorktrees } = await import('../../src/main/claude-home/registry')
const { storyFolder } = await import('../../src/main/stories/one-shot')

const input = (): StoryInput => ({
  kind: 'pr',
  header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: 'a'.repeat(40) },
  diff: 'diff --git a/src/cart.ts b/src/cart.ts\n',
  prText: 'Cart total in cents (demo-cart 04)',
  ticket: { file: '04-cart-total.md', text: '# 04 — Cart total in cents' },
  verdicts: [],
})

const git = (at: string, ...args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: at, env, stdio: 'pipe' })
}

/** stories.build as the window calls it, with a window that takes the progress lines. */
async function build(storyId: string, folder: string | undefined): Promise<{ status: string; reason?: string }> {
  const handler = handlers.find((entry) => entry.channel.name === 'stories.build')
  if (handler === undefined) throw new Error('no handler of stories.build')
  const sender = { send: () => undefined, isDestroyed: () => false }
  const answer = await handler.handle({ storyId, projectId: 'p1', ...(folder === undefined ? {} : { folder }), input: input() } as never, { event: { sender } } as never)
  return answer as { status: string; reason?: string }
}

let worktree: string

beforeEach(async () => {
  mocks.base = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-stories-handler-')))
  mocks.root = join(mocks.base, 'project')
  mocks.requests = []
  mocks.repos = []
  mocks.gh = []
  mocks.clients = []
  mocks.structured = undefined
  mocks.waiting = []
  mkdirSync(mocks.root, { recursive: true })
  git(mocks.root, 'init', '-q', '-b', 'main')
  writeFileSync(join(mocks.root, 'a.txt'), 'a')
  git(mocks.root, 'add', 'a.txt')
  git(mocks.root, 'commit', '-q', '-m', 'first')
  worktree = join(mocks.root, '.claude', 'worktrees', 'pr-212')
  git(mocks.root, 'worktree', 'add', '-q', worktree)
})

afterEach(async () => {
  await rm(mocks.base, { recursive: true, force: true })
})

describe('stories.build reads only the folder storyFolder checked', () => {
  it('a folder outside the Project is refused with its reason, and no request starts', async () => {
    const foreign = join(mocks.base, 'elsewhere')
    mkdirSync(foreign)
    expect(await build('s1', foreign)).toEqual({ status: 'failed', reason: `${foreign} is neither the Project's folder nor one of its repositories or git worktrees.` })
    expect(mocks.requests).toEqual([])
  })

  it("a worktree named another way is read under the worktree's own path, not the path the window sent", async () => {
    // Not through join(), which would fold the '..' away.
    const asked = [worktree, '..', 'pr-212'].join(sep)
    const checked = storyFolder(mocks.root, asked, await gitWorktrees(mocks.root))
    if (!checked.ok) throw new Error(checked.reason)
    expect(checked.folder).not.toBe(asked)
    await build('s2', asked)
    expect(mocks.requests).toHaveLength(1)
    expect(mocks.requests[0]!.opts.readFolders).toEqual([checked.folder])
    expect(mocks.requests[0]!.prompt).toContain(`The repository is the folder ${checked.folder}.`)
    expect(mocks.requests[0]!.prompt).not.toContain(asked)
  })

  it('no folder asked: the request reads the Project root', async () => {
    await build('s3', undefined)
    expect(mocks.requests.map((request) => request.opts.readFolders)).toEqual([[mocks.root]])
  })
})

describe('the key the answers of a story are kept under (answersKey)', () => {
  const steps = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'pr-en.json'), 'utf8')) as object
  const prStory = (commit: string | null): StoryFile =>
    storyFileSchema.parse({ kind: 'pr', header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit }, ...steps })
  /** The workflow model of the Project: Epic demo-cart with the story file of Ticket 04's PR and its own story. */
  const model = () =>
    Promise.resolve({
      epics: [
        {
          epic: 'demo-cart',
          stories: [
            { kind: 'epic' as const, path: 'demo-cart/story.md', ticket: null, version: 'v1' },
            { kind: 'pr' as const, path: 'demo-cart/stories/04-cart-total.md', ticket: '04', version: 'v1' },
          ],
        },
      ],
    } as never)

  beforeEach(() => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/example-org/demo-cart.git')
  })

  it('a story read from its file: the file the workflow model lists for its Epic and Ticket', async () => {
    const repo = vi.fn((root: string) => Promise.resolve(root === mocks.root ? 'example-org/demo-cart' : null))
    expect(await answersKey(mocks.root, prStory(null), { model, repo })).toBe('demo-cart/stories/04-cart-total.md')
    // Without the model's entry it is named by its PR, so a question is still kept.
    expect(await answersKey(mocks.root, prStory(null), { model: () => Promise.reject(new Error('no epic-status')), repo })).toBe('example-org/demo-cart#212')
  })

  it("a story made by the button: owner/name#N of the Project's GitHub remote, read from git", async () => {
    const { remoteRepos } = await import('../../src/main/github/inbox')
    expect(await answersKey(mocks.root, prStory('b'.repeat(40)), { model, repo: async (root) => (await remoteRepos([root]))[0] ?? null })).toBe('example-org/demo-cart#212')
  })
})

describe('the "read" marks and the answers to "Check yourself" through the handlers (ticket 13)', () => {
  const steps = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'pr-en.json'), 'utf8')) as object
  const made = storyFileSchema.parse({ kind: 'pr', header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: 'b'.repeat(40) }, ...steps })
  const call = async (channel: string, payload: object): Promise<unknown> => {
    const handler = handlers.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler of ${channel}`)
    return handler.handle(payload as never, { event: { sender: { send: () => undefined } } } as never)
  }

  it("names the key of the story as its answers have it, keeps the marks and the answers in worfy's data under it, and nothing in the Project", async () => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/example-org/demo-cart.git')
    const status = () => execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: mocks.root, encoding: 'utf8' })
    const before = status()
    const first = (await call('stories.marks', { projectId: 'p1', story: made })) as { key: string }
    expect(first).toEqual({ key: 'example-org/demo-cart#212', read: [], checks: [] })
    expect(await call('stories.markRead', { projectId: 'p1', key: first.key, mark: { ticket: '04', step: 2 } })).toEqual({ kept: true })
    expect(await call('stories.markRead', { projectId: 'p1', key: first.key, mark: { ticket: '04', step: 2 } })).toEqual({ kept: false })
    const kept = (await call('stories.selfCheck', { projectId: 'p1', key: first.key, answer: { question: 'Why cents?', answer: 'Floats drift.' } })) as { at: string }
    expect(kept).toEqual({ at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/u) as unknown as string, question: 'Why cents?', answer: 'Floats drift.' })

    // As after a restart: main reads them again from stories.json of the Project data folder.
    expect(await call('stories.marks', { projectId: 'p1', story: made })).toEqual({ key: first.key, read: [{ ticket: '04', step: 2 }], checks: [kept] })
    expect(JSON.parse(readFileSync(join(mocks.base, 'worfy-data', 'projects', 'p1', 'stories.json'), 'utf8'))).toMatchObject({ read: { [first.key]: [{ ticket: '04', step: 2 }] } })
    expect(status()).toBe(before)
  })
})

describe('a Project over several repositories', () => {
  it('a repository its Profile lists, and a worktree of it, is read; a folder beside them is still refused', async () => {
    // The Project's root is the folder above its repositories, no repository itself.
    mocks.root = join(mocks.base, 'workspace')
    const app = join(mocks.root, 'app')
    const api = join(mocks.root, 'api')
    for (const repo of [app, api]) {
      mkdirSync(repo, { recursive: true })
      git(repo, 'init', '-q', '-b', 'main')
      writeFileSync(join(repo, 'a.txt'), 'a')
      git(repo, 'add', 'a.txt')
      git(repo, 'commit', '-q', '-m', 'first')
    }
    const apiWorktree = join(mocks.base, 'api-pr-7')
    git(api, 'worktree', 'add', '-q', apiWorktree)
    mocks.repos = [
      { name: 'app', path: app },
      { name: 'api', path: api },
    ]
    // The stand-in answers no story, so each build fails after its request: what counts is that the request ran.
    await build('m1', api)
    await build('m2', apiWorktree)
    expect(mocks.requests.map((request) => request.opts.readFolders)).toEqual([[api], [realpathSync.native(apiWorktree)]])
    const beside = join(mocks.root, 'notes')
    mkdirSync(beside)
    expect(await build('m3', beside)).toEqual({ status: 'failed', reason: `${beside} is neither the Project's folder nor one of its repositories or git worktrees.` })
    expect(mocks.requests).toHaveLength(2)
  })
})

describe('the fake agent of the e2e runs (WORFY_AGENT=fake)', () => {
  it('plays story-epic for the story of an Epic and the build script for a PR, each answer in the format', async () => {
    const { storyOneShotFromEnv } = await import('../../src/main/ipc/stories')
    const { readStoryAnswer, storyOutputSchema } = await import('../../src/shared/stories/schema')
    const scripts = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
    const oneShot = storyOneShotFromEnv({ WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scripts })('claude')
    const ask = (kind: 'pr' | 'epic') => oneShot('Write the Code story', { cwd: mocks.base, readFolders: [mocks.root], ephemeral: true, readOnlyTools: ['Read', 'Glob', 'Grep'], outputSchema: storyOutputSchema(kind) })
    const epic = await ask('epic')
    expect(readStoryAnswer('epic', 'en', epic.structured)).toMatchObject({ ok: true })
    const pr = await ask('pr')
    expect(readStoryAnswer('pr', 'en', pr.structured)).toMatchObject({ ok: true })
  })
})

describe('the fake agent releases of every story request are one set', () => {
  it('a build made before the asker is still released by globalThis.worfyFakeRelease once the asker is made', async () => {
    const { storyOneShotFromEnv } = await import('../../src/main/ipc/stories')
    const { storyOutputSchema } = await import('../../src/shared/stories/schema')
    const env = { WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: join(import.meta.dirname, '..', 'fixtures', 'agent-scripts') }
    const build = storyOneShotFromEnv(env, 'story-hold')('claude')
    // The asker's oneShot, made later, as the handlers make it on the first question.
    storyOneShotFromEnv(env, 'story-answer')
    const answering = build('Write the Code story', { cwd: mocks.base, readFolders: [mocks.root], ephemeral: true, readOnlyTools: ['Read', 'Glob', 'Grep'], outputSchema: storyOutputSchema('pr') })
    ;(globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('story')
    expect((await answering).structured).toBeDefined()
  })
})

describe('stories.stop and a story made by the button (stories.make)', () => {
  const handle = (channel: string, input: unknown) => {
    const handler = handlers.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler of ${channel}`)
    return handler.handle(input as never, { event: { sender: { send: () => undefined, isDestroyed: () => false } } } as never)
  }

  it('Stop while main reads the PR from gh: stopped, and no request starts', async () => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/shop/demo-cart.git')
    const making = handle('stories.make', { storyId: 'by-button', projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } })
    await vi.waitFor(() => expect(mocks.gh).toHaveLength(1))
    expect(mocks.gh[0]!.slice(0, 2)).toEqual(['pr', 'view'])
    expect(await handle('stories.stop', { storyId: 'by-button' })).toEqual({ stopped: true })
    for (const call of mocks.waiting.splice(0)) call.answer(JSON.stringify({ title: 'Cart total in cents', body: '', author: { login: 'dev-me' }, headRefOid: 'a'.repeat(40), headRefName: 'demo-cart/04', comments: [] }))
    expect(await making).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(mocks.gh).toHaveLength(1)
    expect(mocks.requests).toEqual([])
  })

  // worfy-polish 122: a button that comes back to its PR asks stories.running; the end of the build reaches the window
  // that pressed as stories.made, after the build has left the registry.
  // worfy-polish 122: a button that comes back to its PR asks stories.running; the lines and the end of the build go to
  // every client — a window opened anew from the Dock, or a Linked machine, that took the build up hears them too.
  it('stories.running names the build under way of a PR, under its key; its end goes to every window as stories.made', async () => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/shop/demo-cart.git')
    // The window that pressed (1) is closed; window 2 took the build up after it.
    mocks.clients = [{ id: 2, got: [] }]
    const handler = (channel: string) => handlers.find((entry) => entry.channel.name === channel)!
    const pressed = { send: () => undefined, isDestroyed: () => true }
    const making = handler('stories.make').handle({ storyId: 'by-button', projectId: 'p1', target: { kind: 'pr', repo: 'shop/demo-cart', number: 212 } } as never, { event: { sender: pressed } } as never)
    await vi.waitFor(() => expect(mocks.gh).toHaveLength(1))
    // A Ticket card names no repository: the Project's own, the same build.
    expect(await handle('stories.running', { projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } })).toEqual({ storyId: 'by-button', key: 'shop/demo-cart#212', lines: [] })
    expect(await handle('stories.running', { projectId: 'p1', target: { kind: 'pr', repo: null, number: 213 } })).toBeNull()
    expect(mocks.clients[0]!.got).toEqual([])
    expect(await handle('stories.stop', { storyId: 'by-button' })).toEqual({ stopped: true })
    for (const call of mocks.waiting.splice(0)) call.answer(JSON.stringify({ title: 'Cart total in cents', body: '', author: { login: 'dev-me' }, headRefOid: 'a'.repeat(40), headRefName: 'demo-cart/04', comments: [] }))
    const made = { key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } }
    expect(await making).toEqual(made)
    expect(mocks.clients[0]!.got).toEqual([{ channel: 'worfy:stories.made', payload: { storyId: 'by-button', projectId: 'p1', made } }])
    expect(await handle('stories.running', { projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } })).toBeNull()
  })

  it('the lines and the end of a build by the button reach every client, not only the window that pressed', () => {
    mocks.clients = [
      { id: 1, got: [] },
      { id: 2, got: [] },
    ]
    const events = buttonBuildEvents('by-button', 'p1')
    events.activity('Grep cartTotal')
    const made = { key: 'shop/demo-cart#212', reused: false, outcome: { status: 'failed' as const, reason: 'no' } }
    events.end(made)
    for (const client of mocks.clients) {
      expect(client.got).toEqual([
        { channel: 'worfy:stories.activity', payload: { storyId: 'by-button', text: 'Grep cartTotal' } },
        { channel: 'worfy:stories.made', payload: { storyId: 'by-button', projectId: 'p1', made } },
      ])
    }
  })
})

describe('stories.stop reaches a question (stories.ask) as well as a build: the two ids are told apart', () => {
  const handle = (channel: string, input: unknown) => {
    const handler = handlers.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler of ${channel}`)
    return handler.handle(input as never, { event: { sender: { send: () => undefined, isDestroyed: () => false } } } as never)
  }
  const steps = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'pr-en.json'), 'utf8')) as object
  const story = (): StoryFile => storyFileSchema.parse({ kind: 'pr', header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: null }, ...steps })

  /** A PR read of a story by the button names its repository (`--repo`); a question's reads, in the Project's root, do not. */
  const ofBuild = (args: readonly string[]) => args.includes('--repo')
  const VIEW = JSON.stringify({ title: 'Cart total in cents', body: '', author: { login: 'dev-me' }, headRefOid: 'a'.repeat(40), headRefName: 'demo-cart/04', comments: [] })

  /** Answers the gh calls `which` picks — those already asked and those still to come — until `until` settles. */
  async function answering<T>(until: Promise<T>, which: (args: readonly string[]) => boolean): Promise<T> {
    let settled = false
    void until.finally(() => (settled = true))
    while (!settled) {
      for (const call of mocks.waiting.filter((one) => which(one.args))) {
        mocks.waiting.splice(mocks.waiting.indexOf(call), 1)
        call.answer(call.args[1] === 'diff' ? 'diff --git a/x b/x\n+x\n' : VIEW)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return until
  }

  it('Stop of a question while main reads its PR from gh: stopped, no request; a build under another id runs on', async () => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/shop/demo-cart.git')
    const making = handle('stories.make', { storyId: 'build-1', projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } }) as Promise<unknown>
    const asking = handle('stories.ask', { questionId: 'question-1', projectId: 'p1', story: story(), about: { ticket: '04', step: 2, path: 'src/cart.ts', from: 13, to: 14 }, code: 'x', question: 'Why cents?' }) as Promise<unknown>
    // Both wait for gh: the build for `pr view`, the question for its PR's text.
    await vi.waitFor(() => expect(mocks.waiting.some((call) => ofBuild(call.args)) && mocks.waiting.some((call) => !ofBuild(call.args))).toBe(true), { timeout: ms(10_000) })
    expect(await handle('stories.stop', { storyId: 'question-1' })).toEqual({ stopped: true })
    expect(await handle('stories.stop', { storyId: 'nobody' })).toEqual({ stopped: false })
    expect(await answering(asking, (args) => !ofBuild(args))).toEqual({ status: 'stopped' })
    expect(mocks.requests).toEqual([])
    // The build was not stopped by the question's Stop: it still waits for its `pr view`; Stop under its own id ends it.
    expect(await handle('stories.stop', { storyId: 'build-1' })).toEqual({ stopped: true })
    expect(await answering(making, ofBuild)).toEqual({ key: 'shop/demo-cart#212', reused: false, outcome: { status: 'stopped' } })
    expect(mocks.requests).toEqual([])
  })
})

describe('a question about a story made by the button of a PR in a Project over several repositories', () => {
  const handle = (channel: string, input: unknown) => {
    const handler = handlers.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler of ${channel}`)
    return handler.handle(input as never, { event: { sender: { send: () => undefined, isDestroyed: () => false } } } as never) as Promise<unknown>
  }
  const steps = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'code-story-answers', 'pr-en.json'), 'utf8')) as object
  /** PR #7 as a story made by the button: kept outside the Project, its head in the header. */
  const madeStory = (): StoryFile => storyFileSchema.parse({ kind: 'pr', header: { title: 'PR #7', epic: null, ticket: null, pr: 7, language: 'en', commit: 'c'.repeat(40) }, ...steps })
  const VIEW = JSON.stringify({ title: 'PR seven', body: '', comments: [] })

  /** Answers every gh call, those asked and those to come, until `until` settles. */
  async function answeringAll<T>(until: Promise<T>): Promise<T> {
    let settled = false
    void until.finally(() => (settled = true))
    while (!settled) {
      for (const call of mocks.waiting.splice(0)) call.answer(call.args[1] === 'diff' ? `diff of ${call.args.join(' ')}` : VIEW)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return until
  }

  it('PR #7 of two repositories: each question reads its own repository and checkout, and its answers are kept apart', async () => {
    // The Project's root is the folder above its repositories, no repository itself.
    mocks.root = join(mocks.base, 'workspace')
    const app = join(mocks.root, 'app')
    const api = join(mocks.root, 'api')
    for (const [repo, slug] of [[app, 'shop/app'], [api, 'shop/api']] as const) {
      mkdirSync(repo, { recursive: true })
      git(repo, 'init', '-q', '-b', 'main')
      writeFileSync(join(repo, 'a.txt'), 'a')
      git(repo, 'add', 'a.txt')
      git(repo, 'commit', '-q', '-m', 'first')
      git(repo, 'remote', 'add', 'origin', `https://github.com/${slug}.git`)
    }
    mocks.repos = [
      { name: 'app', path: app },
      { name: 'api', path: api },
    ]
    const story = madeStory()
    const ask = (questionId: string, key: string, answer: string) => {
      mocks.structured = { answer, source: 'none', lines: [] }
      return answeringAll(handle('stories.ask', { questionId, projectId: 'p1', key, story, about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 13 }, code: 'x', question: 'Why?' }))
    }

    expect(await ask('q-api', 'shop/api#7', 'From api')).toMatchObject({ status: 'answer' })
    expect(mocks.requests[0]!.opts.readFolders).toEqual([api])
    const apiReads = mocks.gh.filter((args) => args[0] === 'pr')
    expect(apiReads.length).toBeGreaterThan(0)
    for (const args of apiReads) expect(args.slice(-2)).toEqual(['--repo', 'shop/api'])
    expect(mocks.requests[0]!.prompt).toContain('diff of pr diff 7 --repo shop/api')

    mocks.gh = []
    expect(await ask('q-app', 'shop/app#7', 'From app')).toMatchObject({ status: 'answer' })
    expect(mocks.requests[1]!.opts.readFolders).toEqual([app])
    for (const args of mocks.gh.filter((one) => one[0] === 'pr')) expect(args.slice(-2)).toEqual(['--repo', 'shop/app'])

    const answersOf = async (key: string) => ((await handle('stories.answers', { projectId: 'p1', story, key })) as { answers: { answer: string }[] }).answers.map((one) => one.answer)
    expect(await answersOf('shop/api#7')).toEqual(['From api'])
    expect(await answersOf('shop/app#7')).toEqual(['From app'])

    // The read marks (ticket 13) go under the same key as the answers: those of shop/api#7 are not shop/app#7's.
    const marksOf = async (key: string) => (await handle('stories.marks', { projectId: 'p1', story, key })) as { key: string; read: unknown[] }
    expect((await marksOf('shop/api#7')).key).toBe('shop/api#7')
    await handle('stories.markRead', { projectId: 'p1', key: 'shop/api#7', mark: { ticket: null, step: 2 } })
    expect((await marksOf('shop/api#7')).read).toEqual([{ ticket: null, step: 2 }])
    expect(await marksOf('shop/app#7')).toMatchObject({ key: 'shop/app#7', read: [] })
  })

  it('a key that names no repository of the Project, or another PR, is refused before anything is read', async () => {
    git(mocks.root, 'remote', 'add', 'origin', 'https://github.com/shop/demo-cart.git')
    const story = madeStory()
    const ask = (key: string) => handle('stories.ask', { questionId: `q-${key}`, projectId: 'p1', key, story, about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 13 }, code: 'x', question: 'Why?' })
    expect(await ask('other/repo#7')).toEqual({ status: 'failed', reason: 'other/repo is not a repository of this Project.' })
    expect(await ask('shop/demo-cart#8')).toEqual({ status: 'failed', reason: 'The key shop/demo-cart#8 names another PR than the story (#7).' })
    expect(mocks.gh).toEqual([])
    expect(mocks.requests).toEqual([])
  })
})
