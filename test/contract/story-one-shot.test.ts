// The invisible build of a Code story (worfy-code-stories ticket 04, src/main/stories/one-shot.ts): one
// oneShot of the Project's Vendor, through vendorDriver(<vendor>).oneShot, with no Session Node on the
// Canvas. Two stand-ins of Claude Code, neither of them a real one:
// - the Agent SDK's query(), standing in the way the inventory test does (test/contract/claude-mcp-inventory.test.ts):
//   it registers itself in <home>/sessions/<pid>.json with its cwd, and keeps a transcript under
//   <home>/projects/<its cwd's folder> unless persistSession is false, as Claude Code 2.1.322 does;
//   the request reaches it through the Claude driver's real options (claudeOneShotQuery);
// - the fake agent (src/main/agent/fake-query.ts) with the scripts story and story-hold, as the e2e runs of
//   tickets 11 and 12 play them, registering itself in <home>/sessions while it runs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput } from '../../src/shared/ipc/stories'
import { projectDirName } from '../../src/main/claude-home/registry'

const mocks = vi.hoisted(() => ({
  home: '',
  /** What the stand-in query() got: its options and the text of its one message. */
  calls: [] as { options: Record<string, unknown>; text: Promise<string> }[],
  /** The structured answer of the next query; `hold`: no result until the query is closed. */
  answer: undefined as unknown,
  hold: false,
  closed: 0,
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin:/bin', HOME: mocks.home }, from: 'login-shell', error: null }) }))
vi.mock('../../src/main/harness/locate', async (original) => ({ ...(await original<object>()), currentHarness: () => ({ kind: 'plugin' }) }))
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { projectDirName: dirName } = await import('../../src/main/claude-home/registry')
  const textOf = async (prompt: AsyncIterable<{ message: { content: unknown } }>): Promise<string> => {
    let text = ''
    for await (const message of prompt) text += String(message.message.content)
    return text
  }
  return {
    query: (params: { prompt: AsyncIterable<{ message: { content: unknown } }>; options: Record<string, unknown> }) => {
      const options = params.options
      mocks.calls.push({ options, text: textOf(params.prompt) })
      const at = String(options.cwd)
      const home = path.join(mocks.home, '.claude')
      fs.mkdirSync(path.join(home, 'sessions'), { recursive: true })
      fs.writeFileSync(path.join(home, 'sessions', `${String(process.pid)}.json`), JSON.stringify({ pid: process.pid, sessionId: 'story-1', cwd: at, entrypoint: 'sdk-ts', kind: 'sdk', startedAt: Date.now() }))
      if (options.persistSession !== false) {
        fs.mkdirSync(path.join(home, 'projects', dirName(at)), { recursive: true })
        fs.writeFileSync(path.join(home, 'projects', dirName(at), 'story-1.jsonl'), `${JSON.stringify({ type: 'user', cwd: at, sessionId: 'story-1', message: { role: 'user', content: 'Write the Code story' } })}\n`)
      }
      let release: () => void = () => undefined
      const closed = new Promise<void>((done) => (release = done))
      const answer = mocks.answer
      const hold = mocks.hold
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', cwd: at, session_id: 'story-1' }
          yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'statusLine' } }] } }
          if (hold) {
            await closed
            return
          }
          yield { type: 'result', subtype: 'success', result: '', structured_output: answer }
        },
        close: () => {
          mocks.closed += 1
          release()
        },
      }
    },
  }
})

const { StoryBuilder, STORY_TOOLS, storyFolder } = await import('../../src/main/stories/one-shot')
const { vendorDriver } = await import('../../src/main/vendors/registry')
const { ClaudeHomeRegistry, gitWorktrees } = await import('../../src/main/claude-home/registry')
const { claudeOneShotOver, ONE_SHOT_DISALLOWED_TOOLS } = await import('../../src/main/vendors/claude/one-shot')
const { fakeQueryFactory, FakeReleases } = await import('../../src/main/agent/fake-query')
const { readStoryAnswer, seamsStepNumber, storyOutputSchema, storySchema } = await import('../../src/shared/stories/schema')
const { CODEX_CAPABILITIES } = await import('../../src/main/vendors/codex/capabilities')

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')
const AGENT_SCRIPTS = join(FIXTURES, 'agent-scripts')
/** The shared Code story cases of the Harness (harness/bin/TICKETS.md, "Code story"), and the code they quote. */
const SHARED = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')
/** The same cases as the JSON a oneShot answers with (test/fixtures/code-story-answers/README.md). */
const answerOf = (name: 'pr-en' | 'pr-ru' | 'epic-ru'): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, 'code-story-answers', `${name}.json`), 'utf8')) as Record<string, unknown>
const PR_EN = answerOf('pr-en')

const HEAD = 'a'.repeat(40)
const DIFF = 'diff --git a/src/cart.ts b/src/cart.ts\n+export function cartTotal(lines: CartLine[]): Cents {\n'
const input = (): Extract<StoryInput, { kind: 'pr' }> => ({
  kind: 'pr',
  header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: HEAD },
  diff: DIFF,
  prText: 'Cart total in cents (demo-cart 04)',
  ticket: { file: '04-cart-total.md', text: '# 04 — Cart total in cents' },
  verdicts: ['VERIFIED: the total is a sum of whole cents'],
})

let base: string
let root: string
let runDir: string

beforeEach(async () => {
  base = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-story-')))
  // HOME of the login shell's environment: the stand-ins write under its .claude, never the real one.
  mocks.home = join(base, 'home')
  mocks.calls = []
  mocks.answer = PR_EN
  mocks.hold = false
  mocks.closed = 0
  root = join(base, 'project')
  mkdirSync(join(root, 'src'), { recursive: true })
  runDir = join(base, 'worfy-data', 'terminal-ai')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

const claudeHome = () => join(mocks.home, '.claude')
/** The Canvas's view of a Project's Sessions: the registry of ~/.claude, as the Canvas reads it. */
const registry = () => new ClaudeHomeRegistry({ home: claudeHome(), listWorktrees: () => Promise.resolve([]), isAlive: () => Promise.resolve(true) })

/** The builder of the app: the Project's Vendor through its driver. */
const appBuilder = () =>
  new StoryBuilder({
    oneShot: (vendor) => vendorDriver(vendor).oneShot,
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    runDir: () => runDir,
  })

describe('the build of a story leaves no Session Node', () => {
  it('a oneShot for a folder inside a Project registers no Session of the Project and keeps no transcript there', async () => {
    const outcome = await appBuilder().build({ storyId: 's1', folder: join(root, 'src'), vendor: 'claude', input: input() }, () => undefined)
    expect(outcome.status).toBe('story')
    expect(mocks.calls).toHaveLength(1)
    expect(await registry().sessions(root)).toEqual({ live: [], history: [] })
    expect(existsSync(join(claudeHome(), 'projects', projectDirName(join(root, 'src'))))).toBe(false)
    expect(existsSync(join(claudeHome(), 'projects', projectDirName(root)))).toBe(false)
    // Claude Code did register the request, as it does: in worfy's own folder, which is no Project's.
    expect((await registry().liveAll()).map((session) => session.cwd)).toEqual([runDir])
  })

  it('keeps no transcript anywhere: the request text holds the diff, the PR and its verdicts', async () => {
    await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(mocks.calls[0]!.options.persistSession).toBe(false)
    expect(existsSync(join(claudeHome(), 'projects'))).toBe(false)
  })

  it('a oneShot that asks for neither ephemeral nor readFolders gets neither option', async () => {
    mocks.answer = { profile: {} }
    await vendorDriver('claude').oneShot('draft', { cwd: root, readOnlyTools: ['Read'], outputSchema: { type: 'object' } })
    expect(mocks.calls[0]!.options).not.toHaveProperty('persistSession')
    expect(mocks.calls[0]!.options).not.toHaveProperty('additionalDirectories')
  })
})

describe('the request', () => {
  it('reads with Read, Glob and Grep only, runs without Bash, carries the diff in its text and answers in the story schema', async () => {
    await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    const { options, text } = mocks.calls[0]!
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep'])
    expect(STORY_TOOLS).toEqual(['Read', 'Glob', 'Grep'])
    expect(options.disallowedTools).toEqual(ONE_SHOT_DISALLOWED_TOOLS)
    expect(options.disallowedTools).toContain('Bash')
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema: storyOutputSchema('pr') })
    const prompt = await text
    expect(prompt).toContain(DIFF.trimEnd())
    expect(prompt).toContain('Cart total in cents (demo-cart 04)')
    expect(prompt).toContain('# 04 — Cart total in cents')
    expect(prompt).toContain('../issues/04-cart-total.md')
    expect(prompt).toContain('VERIFIED: the total is a sum of whole cents')
    expect(prompt).toContain('"not recorded"')
    // The agent reads the Project by absolute path: the folder is named in the request.
    expect(prompt).toContain(root)
    // canUseTool refuses a tool outside the three, whatever the allow rules say.
    const canUseTool = options.canUseTool as (name: string, input: Record<string, unknown>, extra: unknown) => Promise<{ behavior: string }>
    expect((await canUseTool('Bash', { command: 'git log' }, { signal: new AbortController().signal })).behavior).toBe('deny')
    expect((await canUseTool('Read', { file_path: join(root, 'src', 'a.ts') }, { signal: new AbortController().signal })).behavior).toBe('allow')
  })

  it('the checkout is an extra folder of the request, so reads outside the working directory are not cut off', async () => {
    await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(mocks.calls[0]!.options.cwd).toBe(runDir)
    expect(mocks.calls[0]!.options.additionalDirectories).toEqual([root])
  })

  it('a story in Russian is asked for its own "not recorded" word', async () => {
    mocks.answer = answerOf('pr-ru')
    const ru = { ...input(), header: { ...input().header, language: 'ru' as const } }
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: ru }, () => undefined)
    expect(outcome.status).toBe('story')
    expect(await mocks.calls[0]!.text).toContain('"не записано"')
  })

  it('the story schema it asks for has no $schema key, which Claude Code refuses', () => {
    for (const kind of ['pr', 'epic'] as const) expect(storyOutputSchema(kind)).not.toHaveProperty('$schema')
    expect(storyOutputSchema('pr')).toMatchObject({ type: 'object', required: ['steps', 'checkYourself'] })
    expect(storyOutputSchema('epic')).toMatchObject({ type: 'object', required: ['start', 'chapters', 'seams', 'summary', 'check', 'checkYourself'] })
  })

  it('a story that fits the format comes back with the header worfy knows', async () => {
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome).toEqual({ status: 'story', story: { kind: 'pr', header: input().header, ...PR_EN } })
    expect(storySchema.safeParse(outcome.status === 'story' ? outcome.story : null).success).toBe(true)
  })
})

describe('the format of TICKETS.md, over the shared fixtures', () => {
  /** Lines `from` to `to` of a file of the fixtures' repo/: the code a fragment quotes. */
  const repoLines = (path: string, from: number, to: number): string =>
    readFileSync(join(SHARED, 'repo', path), 'utf8')
      .split('\n')
      .slice(from - 1, to)
      .join('\n')
  type Fragment = { path: string; startLine: number; endLine: number; code: string }
  const fragmentsOf = (value: unknown): Fragment[] => {
    if (Array.isArray(value)) return value.flatMap(fragmentsOf)
    if (typeof value !== 'object' || value === null) return []
    const record = value as Record<string, unknown>
    const own = typeof record.path === 'string' && typeof record.code === 'string' ? [record as unknown as Fragment] : []
    return [...own, ...Object.values(record).flatMap(fragmentsOf)]
  }

  it('the JSON answers are the Markdown fixtures: every fragment is the code of repo/ at its lines', () => {
    const all = (['pr-en', 'pr-ru', 'epic-ru'] as const).flatMap((name) => fragmentsOf(answerOf(name)))
    expect(all.length).toBe(10)
    for (const fragment of all) expect(fragment.code, `${fragment.path}:${String(fragment.startLine)}`).toBe(repoLines(fragment.path, fragment.startLine, fragment.endLine))
    // And they come from the Markdown fixtures: each fragment line of the Markdown is in an answer.
    const markdown = ['pr-en.md', 'pr-ru.md', 'epic-ru.md'].map((file) => readFileSync(join(SHARED, file), 'utf8')).join('\n')
    const places = [...markdown.matchAll(/^Code: `([^`]+)`/gm)].map((match) => match[1])
    expect(all.map((fragment) => `${fragment.path}:${String(fragment.startLine)}-${String(fragment.endLine)}`).sort()).toEqual(places.sort())
  })

  it('reads the English and the Russian PR story, the review step with its own fragment included', () => {
    expect(readStoryAnswer('pr', 'en', answerOf('pr-en')).ok).toBe(true)
    const ru = readStoryAnswer('pr', 'ru', answerOf('pr-ru'))
    expect(ru.ok).toBe(true)
    expect(ru.ok ? ru.answer.steps.map((step) => (step.kind === 'frame' ? step.frame : 'code')) : []).toEqual(['wrong', 'code', 'code', 'checked', 'review'])
  })

  it('reads the Epic story: chapters with their heads, one not ready, the numbered Seams with a dropped handoff and its reason', () => {
    const read = readStoryAnswer('epic', 'ru', answerOf('epic-ru'))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.answer.chapters.map((chapter) => [chapter.ready, chapter.pr, chapter.ticket, chapter.steps.length])).toEqual([
      [true, 211, '03', 2],
      [true, 212, '04', 1],
      [true, 213, '05', 2],
      [false, null, '06', 0],
    ])
    expect(read.answer.chapters[3]!.why).toBe('PR ещё не открыт; передача от 05 к 04 ждёт этот Ticket.')
    // The Seams step of epic-ru.md is "## 6.": numbered on from the five steps of the chapters.
    expect(seamsStepNumber(read.answer)).toBe(6)
    expect(read.answer.seams.handoffs.filter((handoff) => !handoff.done)).toEqual([{ from: '05', to: '04', what: 'скидка купона в итоге корзины', done: false, why: '`cartTotal` не вызывает `discountFor`, итог на чеке без скидки' }])
    expect(read.answer.checkYourself).toHaveLength(2)
  })

  it('an Epic story breaks the format with a not-ready chapter that has steps, or a dropped handoff without its reason', () => {
    const epic = answerOf('epic-ru') as { chapters: Record<string, unknown>[]; seams: { handoffs: Record<string, unknown>[] } }
    const steps = (epic.chapters[0] as { steps: unknown[] }).steps
    const broken = { ...epic, chapters: [...epic.chapters.slice(0, 3), { ...epic.chapters[3], steps }], seams: { ...epic.seams, handoffs: epic.seams.handoffs.map((handoff) => ({ ...handoff, why: null })) } }
    const read = readStoryAnswer('epic', 'ru', broken)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('chapters.3.steps: a chapter not ready has no steps')
    expect(read.ok ? '' : read.reason).toContain('seams.handoffs.2.why: a dropped handoff says why')
  })

  it('no limit on the number of steps: a reader never refuses a story by its size', () => {
    const code = (PR_EN.steps as Record<string, unknown>[])[1]!
    const long = { ...PR_EN, steps: [(PR_EN.steps as unknown[])[0], ...Array.from({ length: 30 }, () => code)] }
    expect(readStoryAnswer('pr', 'en', long).ok).toBe(true)
  })

  it('"not recorded" follows the language: the English word is no Requirement of a Russian story', () => {
    const ru = answerOf('pr-ru') as { steps: Record<string, unknown>[] }
    const english = { ...ru, steps: ru.steps.map((step, index) => (index === 1 ? { ...step, requirement: 'not recorded' } : step)) }
    const read = readStoryAnswer('pr', 'ru', english)
    expect(read.ok ? '' : read.reason).toContain('steps.1.requirement: not a Markdown link [text](target), nor "не записано"')
    const russian = { ...ru, steps: ru.steps.map((step, index) => (index === 1 ? { ...step, requirement: 'не записано' } : step)) }
    expect(readStoryAnswer('pr', 'ru', russian).ok).toBe(true)
  })

  it('the header: Epic and Ticket together, the Ticket in two digits, the language en or ru, the PR head required', () => {
    const story = { kind: 'pr', header: input().header, ...PR_EN }
    expect(storySchema.safeParse(story).success).toBe(true)
    const broken = (header: Record<string, unknown>) => storySchema.safeParse({ ...story, header: { ...input().header, ...header } }).success
    expect(broken({ ticket: null })).toBe(false)
    expect(broken({ epic: null, ticket: null })).toBe(true)
    expect(broken({ ticket: '4' })).toBe(false)
    expect(broken({ language: 'de' })).toBe(false)
    expect(broken({ commit: undefined })).toBe(false)
    expect(broken({ commit: 'abc' })).toBe(false)
  })
})

describe('an answer that does not fit the format', () => {
  it('is a failure with its reason, not a throw, and nothing is written', async () => {
    const steps = PR_EN.steps as Record<string, unknown>[]
    const code = steps[1] as { fragment: Record<string, unknown> }
    mocks.answer = { ...PR_EN, steps: [steps[0], { ...code, fragment: { ...code.fragment, keyLines: [40] }, risks: '' }] }
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome.status).toBe('failed')
    const reason = outcome.status === 'failed' ? outcome.reason : ''
    expect(reason).toContain('The answer does not fit the Code story format')
    expect(reason).toContain('steps.1.fragment.keyLines: key line 40 is outside 10-17')
    expect(reason).toContain('steps.1.risks')
    expect(readdirSync(root)).toEqual(['src'])
    expect(readdirSync(join(root, 'src'))).toEqual([])
  })

  it('a code step without its fragment, or a "What was wrong" without its Requirement, is refused', async () => {
    const steps = PR_EN.steps as Record<string, unknown>[]
    mocks.answer = { ...PR_EN, steps: [{ ...steps[0], requirement: null }, { ...steps[1], fragment: undefined }] }
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome.status === 'failed' ? outcome.reason : '').toContain('steps.1.fragment')
    mocks.answer = { ...PR_EN, steps: [{ ...steps[0], requirement: null }, steps[1]] }
    const second = await appBuilder().build({ storyId: 's2', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(second.status === 'failed' ? second.reason : '').toContain('steps.0.requirement: the frame "What was wrong" carries a Requirement')
  })

  it('no answer at all is a failure with the Vendor’s reason', async () => {
    mocks.answer = 'just text'
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome).toMatchObject({ status: 'failed' })
  })
})

describe('the checkout a story reads', () => {
  const git = (at: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: at, stdio: 'pipe' })

  it('is the Project root by default, a git worktree of the Project when asked, and nothing else', async () => {
    git(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, 'a.txt'), 'a')
    git(root, 'add', 'a.txt')
    git(root, 'commit', '-q', '-m', 'first')
    const worktree = join(root, '.claude', 'worktrees', 'pr-212')
    git(root, 'worktree', 'add', '-q', worktree)
    const other = join(base, 'elsewhere')
    mkdirSync(other)
    const worktrees = await gitWorktrees(root)
    expect(storyFolder(root, undefined, worktrees)).toEqual({ ok: true, folder: root })
    expect(storyFolder(root, root, worktrees)).toEqual({ ok: true, folder: root })
    expect(storyFolder(root, worktree, worktrees)).toEqual({ ok: true, folder: worktree })
    // A path that names the worktree another way is the same folder.
    expect(storyFolder(root, join(worktree, '..', 'pr-212'), worktrees)).toEqual({ ok: true, folder: worktree })
    for (const refused of [other, join(root, 'src'), join(root, '.claude', 'worktrees')]) {
      expect(storyFolder(root, refused, worktrees)).toEqual({ ok: false, reason: `${refused} is neither the Project's folder nor one of its git worktrees.` })
    }
  })

  it('the worktree asked for is the one the request reads and names', async () => {
    const worktree = join(base, 'wt')
    mkdirSync(worktree)
    await appBuilder().build({ storyId: 's1', folder: worktree, vendor: 'claude', input: input() }, () => undefined)
    expect(mocks.calls[0]!.options.additionalDirectories).toEqual([worktree])
    expect(await mocks.calls[0]!.text).toContain(`The repository is the folder ${worktree}.`)
  })
})

describe('Stop', () => {
  it('ends the request through its signal: Claude Code is closed, no story answers and nothing is written', async () => {
    mocks.hold = true
    const builder = appBuilder()
    const lines: string[] = []
    const building = builder.build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, (text) => lines.push(text))
    await vi.waitFor(() => expect(lines).toContain('Grep statusLine'))
    expect(builder.stop('s1')).toBe(true)
    expect(await building).toEqual({ status: 'stopped' })
    expect(mocks.closed).toBeGreaterThanOrEqual(1)
    expect(builder.stop('s1')).toBe(false)
    expect(readdirSync(join(root, 'src'))).toEqual([])
  })
})

describe('on the fake agent (the e2e runs of tickets 11 and 12)', () => {
  /** The builder over the fake agent, registering itself in <home>/sessions while it runs, as Claude Code does. */
  const fakeBuilder = (script: string, releases = new FakeReleases()) =>
    new StoryBuilder({
      oneShot: () => claudeOneShotOver((request) => fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script, registryHome: claudeHome(), releases })(request)),
      capabilities: (vendor) => vendorDriver(vendor).capabilities(),
      runDir: () => runDir,
    })

  it('plays the story script: the activity lines in order, the story of the script', async () => {
    const lines: string[] = []
    const outcome = await fakeBuilder('story').build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, (text) => lines.push(text))
    expect(lines).toEqual(['Claude Code started', 'Grep cartTotal', 'Read src/cart.ts', 'The draft is ready'])
    expect(outcome).toEqual({ status: 'story', story: { kind: 'pr', header: input().header, ...PR_EN } })
  })

  it('while it runs, the Project has no live Session; Stop ends it and the process is gone', async () => {
    const builder = fakeBuilder('story-hold')
    const lines: string[] = []
    const building = builder.build({ storyId: 's1', folder: join(root, 'src'), vendor: 'claude', input: input() }, (text) => lines.push(text))
    await vi.waitFor(() => expect(lines).toContain('Grep cartTotal'))
    expect(await registry().sessions(root)).toEqual({ live: [], history: [] })
    expect((await registry().liveAll()).map((session) => session.cwd)).toEqual([runDir])
    expect(builder.stop('s1')).toBe(true)
    expect(await building).toEqual({ status: 'stopped' })
    // The fake agent removes its <home>/sessions entry when its query is closed, as Claude Code's process does when it exits.
    expect(await registry().liveAll()).toEqual([])
    expect(lines).not.toContain('The draft is ready')
  })
})

describe('a Project on Codex', () => {
  it('starts no request and answers the reason of the Codex capabilities', async () => {
    const oneShot = vi.fn()
    const builder = new StoryBuilder({ oneShot, capabilities: (vendor) => vendorDriver(vendor).capabilities(), runDir: () => runDir })
    const outcome = await builder.build({ storyId: 's1', folder: root, vendor: 'codex', input: input() }, () => undefined)
    expect(outcome).toEqual({ status: 'unavailable', reason: CODEX_CAPABILITIES.unsupported.oneShotToolFree })
    // The text the progress bar test shows (test/unit/story-progress.test.tsx).
    expect(CODEX_CAPABILITIES.unsupported.oneShotToolFree).toBe('One-off requests (the Project profile draft, Terminal AI, a Code story) run on Claude Code only.')
    expect(oneShot).not.toHaveBeenCalled()
    expect(existsSync(runDir)).toBe(false)
  })
})
