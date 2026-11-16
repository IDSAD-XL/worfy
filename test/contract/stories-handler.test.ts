// The handler stories.build (src/main/ipc/stories.ts, worfy-code-stories ticket 04) over a real git Project with
// one worktree: the folder the oneShot reads is the one storyFolder checked, never the path the window sent. A
// folder that is neither the Project's root nor one of its git worktrees is refused before any request. The
// Vendor's driver is a stand-in that records the requests; no Claude Code runs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput } from '../../src/shared/ipc/stories'
import { storyFileSchema, type StoryFile } from '../../src/shared/stories/schema'
import type { OneShotOptions } from '../../src/main/vendors/one-shot'

const mocks = vi.hoisted(() => ({
  base: '',
  root: '',
  /** What the stand-in oneShot was asked: its prompt and options. */
  requests: [] as { prompt: string; opts: OneShotOptions }[],
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))
vi.mock('../../src/main/projects/store', () => ({
  projectStore: () => ({
    get: (id: string) => ({ id, path: mocks.root }),
    dataDir: (id: string) => join(mocks.base, 'worfy-data', 'projects', id),
  }),
}))
vi.mock('../../src/main/storage/paths', async (original) => ({ ...(await original<object>()), dataRoot: () => join(mocks.base, 'worfy-data') }))
vi.mock('../../src/main/vendors/registry', () => ({
  vendorDriver: () => ({
    capabilities: () => Promise.resolve({ oneShotToolFree: true, unsupported: {} }),
    oneShot: (prompt: string, opts: OneShotOptions) => {
      mocks.requests.push({ prompt, opts })
      return Promise.resolve({ text: '' })
    },
  }),
}))

const { default: handlers, answersKey } = await import('../../src/main/ipc/stories')
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
    expect(await build('s1', foreign)).toEqual({ status: 'failed', reason: `${foreign} is neither the Project's folder nor one of its git worktrees.` })
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
