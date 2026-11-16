// The code a step of a Code story shows, read from git (worfy-code-stories ticket 08; harness/bin/TICKETS.md, "Story
// anchor"), and the story file itself read through the same source as the workflow (ADR-0107): the Project's main
// branch in Full mode, the Workflow folder in Silent mode. Real git repositories in a temporary folder built from the
// shared fixtures, harness/bin/tests/fixtures/code-story/: `repo/` is the PR's head, `repo-main-shifted/` the main
// branch after a squash merge without a rebase. A bare `origin` on the disk; no network.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { parseStory } from '../../src/shared/stories/parse'
import type { StoryFragment } from '../../src/shared/stories/schema'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}))

const { anchorCommit, cachedPrCommits, placeFragment, PR_HEAD_TTL_MS, storyFragmentCode, TICKET_PR_TTL_MS, ticketPrFromModel } = await import('../../src/main/stories/code')
const { FRAGMENT_MAX_CHARS, FRAGMENT_MAX_LINES, storiesCode } = await import('../../src/shared/ipc/stories')
const { readStoryFile } = await import('../../src/main/ipc/stories')

const SHARED = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')
const STORY = '.scratch/demo-cart/stories/04-cart-total.md'

let dir: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-story-code-')))
  const home = join(dir, 'home')
  mkdirSync(home)
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')))
  env = { ...clean, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') }
  writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n')
})

afterEach(() => removeTestTree(dir))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim()
}

/** The git of the code under test, with this test's configuration: the user's own is never read. */
const runner = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolvePromise) => resolvePromise(execFileSync('git', args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })))

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

const fixture = (name: string): string => readFileSync(join(SHARED, name), 'utf8')

const fragmentsOf = (name: string): StoryFragment[] => {
  const parsed = parseStory(fixture(name))
  if (!parsed.ok || parsed.story.kind !== 'pr') throw new Error(`${name} is no PR story`)
  return parsed.story.steps.flatMap((step) => (step.kind === 'code' ? [step.fragment] : step.fragments))
}

/**
 * The main branch of the fixture's history: the PR's base (`repo/`), a commit of the main branch that adds three lines
 * above `cartTotal` (`repo-main-shifted/`), and the squash merge of the PR, which adds its story. Answers the shas.
 */
function mainWithSquash(repo: string, story = fixture('pr-en.md')): { base: string; squash: string } {
  git(dir, 'init', '-q', '-b', 'main', repo)
  cpSync(join(SHARED, 'repo'), repo, { recursive: true })
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  cpSync(join(SHARED, 'repo-main-shifted'), repo, { recursive: true })
  git(repo, 'commit', '-qam', 'main moves on')
  write(repo, STORY, story)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'Cart total in cents (#212)')
  return { base, squash: git(repo, 'rev-parse', 'HEAD') }
}

describe('the code of a fragment: found by its code in the anchor commit', () => {
  it('finds the anchor — the commit that added the story to the main branch — and not the later commit that appended to it', async () => {
    const repo = join(dir, 'project')
    const { squash } = mainWithSquash(repo)
    // The documents PR appends the review step after the merge: a change of the file, not its addition.
    write(repo, STORY, `${fixture('pr-en.md')}\n## 6. What review found and what remains\n\nNothing left.\n`)
    git(repo, 'commit', '-qam', 'docs: review step')
    expect(await anchorCommit(repo, 'HEAD', STORY, runner)).toBe(squash)
    expect(await anchorCommit(repo, 'HEAD', '.scratch/demo-cart/stories/99-none.md', runner)).toBeNull()
  })

  it('shows the anchor\'s line numbers where the main branch moved the code, the key lines shifted by the same amount', async () => {
    const repo = join(dir, 'project')
    mainWithSquash(repo)
    // A later commit of the main branch rewrites cartTotal: the anchor still holds the code the story quotes.
    write(repo, 'src/cart.ts', readFileSync(join(repo, 'src/cart.ts'), 'utf8').replace('let total = 0', 'let total: Cents = 0'))
    git(repo, 'commit', '-qam', 'later change')
    const [total, checkout] = fragmentsOf('pr-en.md')
    const layout = fullLayout(repo)
    const shown = await storyFragmentCode(layout, { path: 'demo-cart/stories/04-cart-total.md' }, total!, { git: runner })
    expect(shown).toEqual({ code: total!.code, startLine: 13, keyLines: [16, 17], fromHead: false, reason: null })
    expect(await storyFragmentCode(layout, { path: 'demo-cart/stories/04-cart-total.md' }, checkout!, { git: runner })).toEqual({
      code: checkout!.code,
      startLine: 23,
      keyLines: [24],
      fromHead: false,
      reason: null,
    })
  })

  it('shows the story\'s own code, marked with the reason: changed when the anchor holds other code or no such file, no-anchor when there is no anchor', async () => {
    const repo = join(dir, 'project')
    mainWithSquash(repo, fixture('bad-fragment.md'))
    const layout = fullLayout(repo)
    const changed = fragmentsOf('bad-fragment.md')[0]!
    const own = { code: changed.code, startLine: changed.startLine, keyLines: changed.keyLines, fromHead: true, reason: 'changed' }
    expect(await storyFragmentCode(layout, { path: 'demo-cart/stories/04-cart-total.md' }, changed, { git: runner })).toEqual(own)
    const gone = { ...changed, path: 'src/removed.ts' }
    expect(await storyFragmentCode(layout, { path: 'demo-cart/stories/04-cart-total.md' }, gone, { git: runner })).toMatchObject({ fromHead: true, reason: 'changed', startLine: changed.startLine })
    expect(await storyFragmentCode(layout, { path: 'demo-cart/stories/05-none.md' }, fragmentsOf('pr-en.md')[0]!, { git: runner })).toMatchObject({ fromHead: true, reason: 'no-anchor', startLine: 10 })
  })

  it('reads a story kept outside git at the head it names, and shows its own code, marked, when that commit is not in the repository', async () => {
    const repo = join(dir, 'project')
    const { base } = mainWithSquash(repo)
    const [total] = fragmentsOf('pr-en.md')
    const layout = fullLayout(repo)
    expect(await storyFragmentCode(layout, { commit: base }, total!, { git: runner })).toEqual({ code: total!.code, startLine: 10, keyLines: [13, 14], fromHead: false, reason: null })
    // A shallow clone, or a colleague's head never fetched.
    expect(await storyFragmentCode(layout, { commit: 'f'.repeat(40) }, total!, { git: runner })).toEqual({ code: total!.code, startLine: 10, keyLines: [13, 14], fromHead: true, reason: 'no-anchor' })
  })

  it('takes, of several places that hold the same code, the one nearest the story\'s line numbers; carriage returns do not count', () => {
    const fragment: StoryFragment = { path: 'a.ts', startLine: 9, endLine: 10, keyLines: [10], code: 'x()\ny()' }
    const file = ['x()', 'y()', '', '', '', '', '', '', '', 'x()', 'y()', '', 'x()', 'y()'].join('\r\n')
    expect(placeFragment(file, fragment)).toEqual({ code: 'x()\ny()', startLine: 10, keyLines: [11], fromHead: false, reason: null })
    expect(placeFragment(null, fragment)).toEqual({ code: 'x()\ny()', startLine: 9, keyLines: [10], fromHead: true, reason: 'changed' })
  })

  it('bounds the search: a file of like lines and a long fragment of them take at most the budget of comparisons', () => {
    const fragment: StoryFragment = { path: 'a.ts', startLine: 150_000, endLine: 150_399, keyLines: [150_000], code: Array.from({ length: 400 }, () => '').join('\n') }
    const file = '\n'.repeat(200_000)
    const started = performance.now()
    // Every place matches: the first ones are found before the budget is spent, and the nearest of them is shown.
    expect(placeFragment(file, fragment)).toMatchObject({ fromHead: false, startLine: expect.any(Number) as unknown })
    expect(performance.now() - started).toBeLessThan(5_000)
    // No place found within the budget: the story's own code.
    const late = { ...fragment, code: `${fragment.code}\nx` }
    expect(placeFragment(`${file}x`, late, 1_000)).toMatchObject({ fromHead: true, reason: 'changed' })
  })

  it('refuses a fragment over FRAGMENT_MAX_LINES or FRAGMENT_MAX_CHARS before git is read, and the channel refuses it too', async () => {
    const asked: string[][] = []
    const spy = (cwd: string, args: string[]) => {
      asked.push(args)
      return runner(cwd, args)
    }
    const many: StoryFragment = { path: 'a.ts', startLine: 1, endLine: FRAGMENT_MAX_LINES + 1, keyLines: [1], code: Array.from({ length: FRAGMENT_MAX_LINES + 1 }, () => 'x').join('\n') }
    const long: StoryFragment = { path: 'a.ts', startLine: 1, endLine: 1, keyLines: [1], code: 'x'.repeat(FRAGMENT_MAX_CHARS + 1) }
    for (const fragment of [many, long]) {
      await expect(storyFragmentCode(fullLayout(dir), { commit: 'a'.repeat(40) }, fragment, { git: spy })).rejects.toThrow(/not looked for in git/u)
      expect(storiesCode.input.safeParse({ projectId: 'p', at: { commit: 'a'.repeat(40) }, fragment }).success).toBe(false)
    }
    expect(asked).toEqual([])
  })

  it('reads the anchor with literal pathspecs, and a git that fails is no answer: it rejects, it is not "no anchor"', async () => {
    const asked: string[][] = []
    const spy = (cwd: string, args: string[]) => {
      asked.push(args)
      return Promise.resolve('')
    }
    expect(await anchorCommit(dir, 'HEAD', '.scratch/*/story.md', spy)).toBeNull()
    expect(asked[0]?.[0]).toBe('--literal-pathspecs')
    await expect(anchorCommit(dir, 'HEAD', STORY, () => Promise.reject(new Error('git died')))).rejects.toThrow('git died')
  })
})

describe('the story file and its code through the source of the workflow (ADR-0107)', () => {
  /** A bare `origin`, a clone `seed` that pushes, and the Project folder, a clone left at the PR's base. */
  function withOrigin(): { project: string; seed: string } {
    const origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    const seed = join(dir, 'seed')
    const { base } = mainWithSquash(seed)
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', 'origin', 'main')
    const project = join(dir, 'project')
    git(dir, 'clone', '-q', origin, project)
    git(project, 'checkout', '-q', '--detach', base)
    return { project, seed }
  }

  it('reads the story of origin/main, not the folder\'s, and finds its code in its anchor there', async () => {
    const { project } = withOrigin()
    // An untracked story in the folder where the main branch has its own: the folder does not count.
    write(project, STORY, '# not the story\n')
    const layout: ProjectLayout = fullLayout(project)
    const read = await readStoryFile(layout, 'demo-cart/stories/04-cart-total.md', { git: runner })
    expect(read).toMatchObject({ ok: true, path: 'demo-cart/stories/04-cart-total.md', dir: '.scratch/demo-cart/stories' })
    if (!read.ok || read.story.kind !== 'pr') throw new Error('no PR story')
    expect(read.story.header).toMatchObject({ epic: 'demo-cart', ticket: '04', pr: 212, commit: null })
    const total = read.story.steps[1]!
    if (total.kind !== 'code') throw new Error('step 2 is no code step')
    expect(await storyFragmentCode(layout, { path: 'demo-cart/stories/04-cart-total.md' }, total.fragment, { git: runner })).toMatchObject({ startLine: 13, fromHead: false })
  })

  it('gives the reason for a story that is not there, that does not parse, and a path that is no story of an Epic', async () => {
    const { project, seed } = withOrigin()
    write(seed, '.scratch/demo-cart/stories/05-broken.md', fixture('missing-field.md'))
    git(seed, 'add', '-A')
    git(seed, 'commit', '-qm', 'broken story')
    git(seed, 'push', '-q', 'origin', 'main')
    git(project, 'fetch', '-q', 'origin')
    const layout = fullLayout(project)
    expect(await readStoryFile(layout, 'demo-cart/stories/09-none.md', { git: runner })).toMatchObject({ ok: false, reason: expect.stringContaining('does not exist') as unknown })
    expect(await readStoryFile(layout, 'demo-cart/stories/05-broken.md', { git: runner })).toMatchObject({ ok: false, reason: expect.stringContaining('"Why here"') as unknown })
    for (const path of ['../outside/story.md', 'demo-cart/issues/04-cart-total.md', 'demo-cart/stories/deeper/x.md', '/etc/story.md', 'demo-cart\\story.md']) {
      expect(await readStoryFile(layout, path, { git: runner })).toMatchObject({ ok: false, reason: expect.stringContaining('not a story') as unknown })
    }
  })

  it('reads a Silent Project\'s story from its Workflow folder; its code is read at its PR\'s merge commit, else the head, and marked no-anchor without a PR', async () => {
    const repo = join(dir, 'silent-repo')
    const { base, squash } = mainWithSquash(repo)
    const folder = join(dir, 'workflow-folder')
    const scratch = join(folder, '.scratch')
    write(scratch, 'demo-cart/story.md', fixture('epic-ru.md'))
    const layout: ProjectLayout = { ...fullLayout(repo), mode: 'silent', workflowFolder: folder, ticketsRoot: scratch }
    const read = await readStoryFile(layout, 'demo-cart/story.md', { git: runner, home: join(dir, 'home') })
    expect(read).toMatchObject({ ok: true, path: 'demo-cart/story.md', dir: '../workflow-folder/.scratch/demo-cart' })
    if (!read.ok || read.story.kind !== 'epic') throw new Error('no Epic story')
    const step = read.story.chapters[0]!.steps[0]!
    if (step.kind !== 'code') throw new Error('no code step')
    // `PR -`, or no source of the PR's commits: no anchor.
    expect(await storyFragmentCode(layout, { path: 'demo-cart/story.md' }, step.fragment, { git: runner })).toMatchObject({ startLine: step.fragment.startLine, fromHead: true, reason: 'no-anchor' })
    const asked: number[] = []
    const merged = (merge: string | null, head: string | null) => (root: string, pr: number) => {
      expect(root).toBe(layout.root)
      asked.push(pr)
      return Promise.resolve({ merge, head })
    }
    // The fragment cart.ts:10-17 of chapter PR #212: merged, its merge commit holds it three lines lower.
    const cart = read.story.chapters[1]!.steps[0]!
    if (cart.kind !== 'code') throw new Error('no code step')
    expect(await storyFragmentCode(layout, { path: 'demo-cart/story.md', pr: 212 }, cart.fragment, { git: runner, prCommits: merged(squash, base) })).toMatchObject({ startLine: 13, fromHead: false, reason: null })
    // Open, not merged: its head holds it where the story says.
    expect(await storyFragmentCode(layout, { path: 'demo-cart/story.md', pr: 212 }, cart.fragment, { git: runner, prCommits: merged(null, base) })).toMatchObject({ startLine: 10, fromHead: false, reason: null })
    // A head this clone never fetched.
    expect(await storyFragmentCode(layout, { path: 'demo-cart/story.md', pr: 212 }, cart.fragment, { git: runner, prCommits: merged(null, 'e'.repeat(40)) })).toMatchObject({ fromHead: true, reason: 'no-anchor' })
    expect(await storyFragmentCode(layout, { path: 'demo-cart/story.md', pr: null }, cart.fragment, { git: runner, prCommits: merged(squash, base) })).toMatchObject({ reason: 'no-anchor' })
    expect(asked).toEqual([212, 212, 212])
  })

  /** A Silent Project over `repo` whose Workflow folder holds the PR story of ticket 04 with `story` for its text. */
  function silentWithStory(repo: string, story: string): ProjectLayout {
    const folder = join(dir, 'workflow-folder')
    const scratch = join(folder, '.scratch')
    write(scratch, 'demo-cart/stories/04-cart-total.md', story)
    return { ...fullLayout(repo), mode: 'silent', workflowFolder: folder, ticketsRoot: scratch }
  }

  it('reads a Silent story whose header says PR - at the PR its Ticket names in the workflow model, and without one marks it no-anchor', async () => {
    const repo = join(dir, 'silent-repo')
    const { base, squash } = mainWithSquash(repo)
    const layout = silentWithStory(repo, fixture('pr-en.md').replace('PR: #212', 'PR: -'))
    const read = await readStoryFile(layout, 'demo-cart/stories/04-cart-total.md', { git: runner, home: join(dir, 'home') })
    if (!read.ok || read.story.kind !== 'pr') throw new Error('no PR story')
    expect(read.story.header.pr).toBeNull()
    const cart = fragmentsOf('pr-en.md').find((fragment) => fragment.path === 'src/cart.ts' && fragment.startLine === 10)!
    const models: string[] = []
    const asked: number[] = []
    const model = (pr: number | null) =>
      ticketPrFromModel((root) => {
        models.push(root)
        return Promise.resolve({ tickets: [{ epic: 'demo-cart', num: 4, pr }, { epic: 'other', num: 4, pr: 999 }, { epic: 'demo-cart', num: 5, pr: 998 }] })
      })
    const prCommits = (root: string, pr: number) => {
      expect(root).toBe(layout.root)
      asked.push(pr)
      return Promise.resolve(pr === 212 ? { merge: squash, head: base } : { merge: null, head: null })
    }
    const at = { path: 'demo-cart/stories/04-cart-total.md', pr: null }
    // Ticket 04 has `PR: #212`, merged: the code is read at its merge commit, three lines lower — not no-anchor.
    expect(await storyFragmentCode(layout, at, cart, { git: runner, prCommits, ticketPr: model(212) })).toMatchObject({ startLine: 13, fromHead: false, reason: null })
    expect(await storyFragmentCode(layout, { path: at.path }, cart, { git: runner, prCommits, ticketPr: model(212) })).toMatchObject({ startLine: 13, reason: null })
    expect(asked).toEqual([212, 212])
    // The Ticket has no PR line yet: no anchor, and gh is not asked.
    expect(await storyFragmentCode(layout, at, cart, { git: runner, prCommits, ticketPr: model(null) })).toMatchObject({ fromHead: true, reason: 'no-anchor' })
    expect(asked).toEqual([212, 212])
    expect(models).toEqual([repo, repo, repo])
  })

  it('asks gh once per PR: thirty fragments of a story share one answer, an open PR is asked again after PR_HEAD_TTL_MS, a merged one never, a failure at once', async () => {
    const repo = join(dir, 'silent-repo')
    const { base, squash } = mainWithSquash(repo)
    const layout = silentWithStory(repo, fixture('pr-en.md').replace('PR: #212', 'PR: -'))
    let clock = 1_000_000
    const now = () => clock
    let answer = { merge: null as string | null, head: base }
    let calls = 0
    const prCommits = cachedPrCommits(() => {
      calls += 1
      return Promise.resolve(answer)
    }, now)
    let reads = 0
    const ticketPr = ticketPrFromModel(() => {
      reads += 1
      return Promise.resolve({ tickets: [{ epic: 'demo-cart', num: 4, pr: 212 }] })
    }, now)
    const fragments = fragmentsOf('pr-en.md')
    const nth = (index: number): StoryFragment => fragments[index % fragments.length]!
    const at = { path: 'demo-cart/stories/04-cart-total.md', pr: null }
    const thirty = () => Promise.all(Array.from({ length: 30 }, (_, index) => storyFragmentCode(layout, at, nth(index), { git: runner, prCommits, ticketPr })))
    const cart = fragments.findIndex((fragment) => fragment.path === 'src/cart.ts' && fragment.startLine === 10)
    expect((await thirty()).every((code) => code.reason === null)).toBe(true)
    expect([calls, reads]).toEqual([1, 1])
    clock += Math.min(PR_HEAD_TTL_MS, TICKET_PR_TTL_MS) - 1
    await thirty()
    expect([calls, reads]).toEqual([1, 1])
    // The head of an open PR may move: asked again once its answer is older than PR_HEAD_TTL_MS; the Ticket's PR too.
    clock += Math.max(PR_HEAD_TTL_MS, TICKET_PR_TTL_MS) + 1
    await thirty()
    expect([calls, reads]).toEqual([2, 2])
    // Merged now: its merge commit is kept for good.
    answer = { merge: squash, head: base }
    clock += PR_HEAD_TTL_MS + 1
    expect((await thirty())[cart]).toMatchObject({ startLine: 13 })
    clock += 1_000 * PR_HEAD_TTL_MS
    expect((await thirty())[cart]).toMatchObject({ startLine: 13 })
    expect(calls).toBe(3)
    // A failure is not kept: the next step asks again.
    let failures = 0
    const failing = cachedPrCommits(() => {
      failures += 1
      return Promise.reject(new Error('gh: HTTP 502'))
    }, now)
    const numbered = { path: at.path, pr: 212 }
    expect(await storyFragmentCode(layout, numbered, nth(0), { git: runner, prCommits: failing })).toMatchObject({ reason: 'no-anchor' })
    expect(await storyFragmentCode(layout, numbered, nth(0), { git: runner, prCommits: failing })).toMatchObject({ reason: 'no-anchor' })
    expect(failures).toBe(2)
  })
})
