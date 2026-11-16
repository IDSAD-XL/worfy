// The invisible build of a Code story (worfy-code-stories ticket 04, src/main/stories/one-shot.ts): one
// oneShot of the Project's Vendor, through vendorDriver(<vendor>).oneShot, with no Session Node on the
// Canvas. Two stand-ins of Claude Code, neither of them a real one:
// - the Agent SDK's query(), standing in the way the inventory test does (test/contract/claude-mcp-inventory.test.ts):
//   it registers itself in <home>/sessions/<pid>.json with its cwd, and keeps a transcript under
//   <home>/projects/<its cwd's folder> unless persistSession is false, as Claude Code 2.1.322 does;
//   the request reaches it through the Claude driver's real options (claudeOneShotQuery);
// - the fake agent (src/main/agent/fake-query.ts) with the scripts story and story-hold, as the e2e runs of
//   tickets 11 and 12 play them, registering itself in <home>/sessions while it runs.
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
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

const { StoryBuilder, STORY_TOOLS } = await import('../../src/main/stories/one-shot')
const { vendorDriver } = await import('../../src/main/vendors/registry')
const { ClaudeHomeRegistry } = await import('../../src/main/claude-home/registry')
const { claudeOneShotOver, ONE_SHOT_DISALLOWED_TOOLS } = await import('../../src/main/vendors/claude/one-shot')
const { fakeQueryFactory, FakeReleases } = await import('../../src/main/agent/fake-query')
const { storyOutputSchema } = await import('../../src/shared/stories/schema')
const { CODEX_CAPABILITIES } = await import('../../src/main/vendors/codex/capabilities')

const AGENT_SCRIPTS = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')

const VALID = {
  steps: [
    {
      title: 'The status line kept the old PR number',
      fragment: { path: 'src/status.ts', startLine: 10, endLine: 12, mainLines: [11], code: 'a\nb\nc' },
      what: 'Builds the line.',
      why: 'not recorded',
      without: 'The old PR shows.',
      requirement: 'Ticket, item 1',
      risks: 'not recorded',
    },
  ],
  handoffs: [],
}

const DIFF = 'diff --git a/src/status.ts b/src/status.ts\n+export function statusLine(pr: number): string {\n'
const input = (): StoryInput => ({
  header: { kind: 'pr', epic: 'worfy-example', ticket: '07', pr: 4321, language: 'en' },
  diff: DIFF,
  prText: 'Fix the status line (worfy-example 07)',
  ticket: '# 07 — The status line',
  verdicts: ['VERIFIED: the line is rebuilt per PR'],
})

let base: string
let root: string
let runDir: string

beforeEach(async () => {
  base = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-story-')))
  // HOME of the login shell's environment: the stand-ins write under its .claude, never the real one.
  mocks.home = join(base, 'home')
  mocks.calls = []
  mocks.answer = VALID
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
})

describe('the request', () => {
  it('reads with Read, Glob and Grep only, runs without Bash, carries the diff in its text and answers in the story schema', async () => {
    await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    const { options, text } = mocks.calls[0]!
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep'])
    expect(STORY_TOOLS).toEqual(['Read', 'Glob', 'Grep'])
    expect(options.disallowedTools).toEqual(ONE_SHOT_DISALLOWED_TOOLS)
    expect(options.disallowedTools).toContain('Bash')
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema: storyOutputSchema() })
    const prompt = await text
    expect(prompt).toContain(DIFF.trimEnd())
    expect(prompt).toContain('Fix the status line (worfy-example 07)')
    expect(prompt).toContain('# 07 — The status line')
    expect(prompt).toContain('VERIFIED: the line is rebuilt per PR')
    // The agent reads the Project by absolute path: the folder is named in the request.
    expect(prompt).toContain(root)
    // canUseTool refuses a tool outside the three, whatever the allow rules say.
    const canUseTool = options.canUseTool as (name: string, input: Record<string, unknown>, extra: unknown) => Promise<{ behavior: string }>
    expect((await canUseTool('Bash', { command: 'git log' }, { signal: new AbortController().signal })).behavior).toBe('deny')
    expect((await canUseTool('Read', { file_path: join(root, 'src', 'a.ts') }, { signal: new AbortController().signal })).behavior).toBe('allow')
  })

  it('the story schema it asks for has no $schema key, which Claude Code refuses', () => {
    expect(storyOutputSchema()).not.toHaveProperty('$schema')
    expect(storyOutputSchema()).toMatchObject({ type: 'object', required: ['steps', 'handoffs'] })
  })

  it('a story that fits the schema comes back with the header worfy knows', async () => {
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome).toEqual({ status: 'story', story: { header: input().header, ...VALID } })
  })
})

describe('an answer that does not fit the schema', () => {
  it('is a failure with its reason, not a throw, and nothing is written', async () => {
    mocks.answer = { steps: [{ ...VALID.steps[0], fragment: { ...VALID.steps[0]!.fragment, mainLines: [40] }, risks: '' }], handoffs: [] }
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome.status).toBe('failed')
    const reason = outcome.status === 'failed' ? outcome.reason : ''
    expect(reason).toContain("The answer does not fit the story's schema")
    expect(reason).toContain('steps.0.fragment.mainLines: main line 40 is outside 10-12')
    expect(reason).toContain('steps.0.risks')
    expect(readdirSync(root)).toEqual(['src'])
    expect(readdirSync(join(root, 'src'))).toEqual([])
  })

  it('no answer at all is a failure with the Vendor’s reason', async () => {
    mocks.answer = 'just text'
    const outcome = await appBuilder().build({ storyId: 's1', folder: root, vendor: 'claude', input: input() }, () => undefined)
    expect(outcome).toMatchObject({ status: 'failed' })
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
    expect(lines).toEqual(['Claude Code started', 'Grep statusLine', 'Read src/status.ts', 'The draft is ready'])
    expect(outcome.status).toBe('story')
    expect(outcome.status === 'story' ? outcome.story.steps.map((step) => step.title) : []).toEqual(['The status line kept the old PR number', 'How it was checked'])
  })

  it('while it runs, the Project has no live Session; Stop ends it and the process is gone', async () => {
    const builder = fakeBuilder('story-hold')
    const lines: string[] = []
    const building = builder.build({ storyId: 's1', folder: join(root, 'src'), vendor: 'claude', input: input() }, (text) => lines.push(text))
    await vi.waitFor(() => expect(lines).toContain('Grep statusLine'))
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
