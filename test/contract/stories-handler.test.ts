// The handler stories.build (src/main/ipc/stories.ts, worfy-code-stories ticket 04) over a real git Project with
// one worktree: the folder the oneShot reads is the one storyFolder checked, never the path the window sent. A
// folder that is neither the Project's root nor one of its git worktrees is refused before any request. The
// Vendor's driver is a stand-in that records the requests; no Claude Code runs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput } from '../../src/shared/ipc/stories'
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

const { default: handlers } = await import('../../src/main/ipc/stories')
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
