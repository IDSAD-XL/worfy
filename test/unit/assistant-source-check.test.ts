// One check of a source through a claude.ai connector (worfy-assistant ticket 11; spec, the section on checking sources
// through claude.ai connectors): the connector found in the MCP list, one call of Haiku 5.5 over its read tools, the
// answer's form checked in main, the items into the attention core (seam A), the call into the usage ledger. The
// answers are recorded fixtures (test/fixtures/assistant-sources): no model is called and nothing reaches the network.
// The fake Claude Code gives its answer only once main sends the message, as the real one calls the model only then.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AssistantUsageLedger } from '../../src/main/assistant/budget/ledger'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import type { AttentionFile, AttentionStore } from '../../src/main/assistant/core/store'
import { sourceCheckRun, type ConnectorRecipe, type SourceCheckDeps } from '../../src/main/assistant/sources/connector-check'
import { CONNECTOR_TOOLS_MAX_TOKENS, askConnector, connectorsOf, type ConnectorQuery, type ConnectorQueryStarter } from '../../src/main/vendors/claude/connector-check'
import { sourceAnswerJsonSchema } from '../../src/shared/assistant/source-items'
import { removeTestTree } from '../remove'

const FIXTURES = join(__dirname, '..', 'fixtures', 'assistant-sources')
const json = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
const jsonl = (name: string): unknown[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)

const SERVERS = json('servers.json')
const CONTEXT = json('context-usage.json') as { mcpTools: { name: string; serverName: string; tokens: number }[]; systemTools: { name: string; tokens: number }[] }
const SLACK_STATUS = (SERVERS as { name: string }[]).filter((each) => each.name === 'claude.ai Slack')
const NOW = Date.parse('2026-11-25T13:00:00Z')
const SINCE = Date.parse('2026-11-25T12:50:00Z')

const RECIPE: ConnectorRecipe = {
  kind: 'slack',
  isConnector: (name) => name === 'claude.ai Slack',
  readTools: ['slack_search_public_and_private', 'slack_read_thread', 'slack_read_user_profile', 'slack_send_message'],
  task: ({ since }) => `Find the messages to the user since ${new Date(since).toISOString()}.`,
}

interface Fake {
  start: ConnectorQueryStarter
  /** The messages main sent: one per call that reached the model. */
  prompts: string[]
  closed: number
  specs: Parameters<ConnectorQueryStarter>[0][]
}

/**
 * Claude Code that answers with `answer` (a recorded fixture, or the messages themselves) once a message comes, and
 * lists `status` and `usage` before. Like the SDK, it reads its input from the start, whether or not anyone reads its
 * messages yet: a message sent before the check would reach it. `fail` makes it throw after the message.
 */
function fakeClaude(answer: string | unknown[], over: { status?: unknown; usage?: unknown; fail?: boolean } = {}): Fake {
  const fake: Fake = { prompts: [], closed: 0, specs: [], start: async () => Promise.reject(new Error('unset')) }
  fake.start = (spec, prompt) => {
    fake.specs.push(spec)
    const messages = typeof answer === 'string' ? jsonl(answer) : answer
    const sent = (async () => {
      for await (const message of prompt as AsyncIterable<SDKUserMessage>) {
        fake.prompts.push(String(message.message.content))
        return true
      }
      return false
    })()
    const query: ConnectorQuery = {
      close: () => {
        fake.closed += 1
      },
      mcpServerStatus: () => Promise.resolve(over.status ?? SLACK_STATUS),
      getContextUsage: () => Promise.resolve(over.usage ?? CONTEXT),
      async *[Symbol.asyncIterator]() {
        if (!(await sent)) return
        if (over.fail === true) throw new Error('Claude Code exited with code 1')
        for (const message of messages) yield message
      },
    }
    return Promise.resolve(query)
  }
  return fake
}

const RESULT_USAGE = { input_tokens: 4000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
/** A result of Claude Code with `items` as its structured answer. */
const resultOf = (items: unknown[], over: Record<string, unknown> = {}): unknown => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  total_cost_usd: 0.003,
  usage: RESULT_USAGE,
  structured_output: { items },
  ...over,
})
/** A right entry, written `n` seconds after 12:00. */
const entry = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: 'slack',
  id: `C01MADEUP/${n}`,
  author: 'Dana Example',
  at: new Date(Date.parse('2026-11-25T12:00:00Z') + n * 1000).toISOString(),
  url: `https://example.slack.com/archives/C01MADEUP/p${n}`,
  text: `Message ${n}`,
  concernsUser: true,
  urgent: false,
  project: null,
  ticket: null,
  ...over,
})

/** The attention core's files in memory. */
function memoryStore(): AttentionStore & { files: Map<string | null, AttentionFile> } {
  const files = new Map<string | null, AttentionFile>()
  return { files, read: (scope) => structuredClone(files.get(scope)), write: (scope, file) => files.set(scope, structuredClone(file)) }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-source-check-'))
})
afterEach(() => removeTestTree(dir))

function setup(fake: Fake, over: Partial<SourceCheckDeps> = {}) {
  const core = new AttentionCore({ now: () => NOW, store: memoryStore(), settings: () => ({ timeZone: 'UTC' }), projects: () => ['p-worfy'] })
  const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => NOW })
  const journal: string[] = []
  let listed = 0
  const deps: SourceCheckDeps = {
    listConnectors: () => {
      listed += 1
      return Promise.resolve(connectorsOf(SERVERS))
    },
    ask: (spec, message) => askConnector(fake.start, spec, message, { settleMs: 0, pollMs: 0 }),
    core,
    ledger,
    projects: () => [
      { id: 'p-worfy', name: 'worfy' },
      { id: 'p-other', name: 'Other' },
    ],
    log: (line) => journal.push(line),
    ...over,
  }
  return { core, ledger, journal, deps, listed: () => listed, run: () => sourceCheckRun(RECIPE, deps)({ kind: 'slack', since: SINCE, now: NOW }) }
}

describe('a check over a connector', () => {
  it('sends one message with the recipe’s task, over the connector’s read tools in the shape of the items', async () => {
    const fake = fakeClaude('answer-good.jsonl')
    await setup(fake).run()
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('Find the messages to the user since 2026-11-25T12:50:00.000Z.')
    expect(fake.prompts[0]).toContain('worfy')
    expect(fake.prompts[0]).toContain('Other')
    expect(fake.specs).toHaveLength(1)
    expect(fake.specs[0]?.connector.name).toBe('claude.ai Slack')
    expect(fake.specs[0]?.readTools).toEqual(['slack_search_public_and_private', 'slack_read_thread', 'slack_read_user_profile'])
    expect(fake.specs[0]?.outputSchema).toEqual(sourceAnswerJsonSchema())
    expect(fake.closed).toBe(1)
  })

  it('turns a right answer into items with the source, id, author, time, link, text, whether it concerns the user, urgency, Project and Ticket', async () => {
    const { core, run } = setup(fakeClaude('answer-good.jsonl'))
    await run()
    const [deploy] = core.items('p-worfy')
    expect(deploy).toMatchObject({
      source: 'slack',
      projectId: 'p-worfy',
      subject: { kind: 'message', id: 'slack:C01MADEUP/1764072000.000100', label: 'Dana Example' },
      kind: 'urgent-message',
      text: 'Can you look at the failing deploy of worfy before 15:00?',
      startedAt: Date.parse('2026-11-25T12:00:00Z'),
      state: 'new',
      message: {
        source: 'slack',
        id: 'C01MADEUP/1764072000.000100',
        author: 'Dana Example',
        at: '2026-11-25T12:00:00Z',
        url: 'https://example.slack.com/archives/C01MADEUP/p1764072000000100',
        concernsUser: true,
        urgent: true,
        project: 'worfy',
        ticket: 'worfy-assistant/11',
      },
    })
    // No Project named: the Machine's own items.
    expect(core.items(null)).toEqual([
      expect.objectContaining({ source: 'slack', projectId: null, kind: 'message', message: expect.objectContaining({ author: 'Lee Example', concernsUser: false, urgent: false, project: null }) }),
    ])
  })

  it('notes the call in the usage ledger as a check of its source, with the tokens and the cost of the result', async () => {
    const { ledger, run } = setup(fakeClaude('answer-good.jsonl'))
    await run()
    expect(ledger.snapshot().calls).toEqual([
      {
        at: NOW,
        kind: 'source-check',
        source: 'slack',
        wakeId: null,
        model: 'claude-haiku-5-5',
        usage: { inputTokens: 5200, outputTokens: 640, cacheCreationInputTokens: 4100, cacheReadInputTokens: 8200 },
        costUsd: 0.0042,
      },
    ])
  })

  it('takes a repeat of the same messages at the next check as nothing new', async () => {
    const { core, run } = setup(fakeClaude('answer-good.jsonl'))
    await run()
    await run()
    expect(core.items('p-worfy')).toHaveLength(1)
    expect(core.items(null)).toHaveLength(1)
  })
})

describe('an answer of the wrong form', () => {
  it('gives no item for an entry that fails the check, writes why to the journal, and keeps the entries that pass', async () => {
    const { core, journal, ledger, run } = setup(fakeClaude('answer-bad-items.jsonl'))
    await run()
    expect(core.items(null).map((item) => item.subject.id)).toEqual(['slack:C01MADEUP/1764072000.000100'])
    expect(journal).toHaveLength(4)
    expect(journal.join('\n')).toMatch(/item 2 .*author/u)
    expect(journal.join('\n')).toMatch(/item 3 .*url/u)
    expect(journal.join('\n')).toMatch(/item 4 .*source/u)
    expect(journal.join('\n')).toMatch(/item 5 .*at/u)
    // The journal says why, never what the source wrote.
    expect(journal.join('\n')).not.toContain('Click me')
    expect(journal.join('\n')).not.toContain('Mallory')
    expect(ledger.snapshot().calls).toHaveLength(1)
  })

  it('gives no item at all for an answer outside the shape, writes it to the journal, and fails the run so the next one covers the same time', async () => {
    const { core, journal, ledger, run } = setup(fakeClaude('answer-bad-shape.jsonl'))
    await expect(run()).rejects.toThrow(/form/u)
    expect(core.items(null)).toEqual([])
    expect(core.items('p-worfy')).toEqual([])
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatch(/slack/u)
    expect(journal[0]).not.toContain('Ignore the schema')
    expect(ledger.snapshot().calls).toHaveLength(1)
  })

  it('fails the run on a call that ended without an answer, after noting what it cost', async () => {
    const { core, ledger, run } = setup(fakeClaude('answer-max-turns.jsonl'))
    await expect(run()).rejects.toThrow(/error_max_turns/u)
    expect(core.items(null)).toEqual([])
    expect(ledger.snapshot().calls).toEqual([expect.objectContaining({ kind: 'source-check', source: 'slack', costUsd: 0.006 })])
  })
})

describe('the call is limited before the model is called', () => {
  const refused = async (fake: Fake, pattern: RegExp) => {
    const { core, ledger, journal, run } = setup(fake)
    await expect(run()).rejects.toThrow(pattern)
    // The message never went: no model was called, and nothing was spent.
    expect(fake.prompts).toEqual([])
    expect(fake.closed).toBe(1)
    expect(ledger.snapshot().calls).toEqual([])
    expect(core.items(null)).toEqual([])
    expect(journal).toHaveLength(1)
  }

  it('refuses when Claude Code started another server next to the connector', async () => {
    const status = [...SLACK_STATUS, ...(SERVERS as { name: string }[]).filter((each) => each.name === 'github')]
    await refused(fakeClaude('answer-good.jsonl', { status }), /github/u)
  })

  it('refuses when the connector itself did not connect', async () => {
    const status = SLACK_STATUS.map((each) => ({ ...each, status: 'needs-auth' }))
    await refused(fakeClaude('answer-good.jsonl', { status }), /needs-auth/u)
  })

  it('refuses when the context holds a tool of the connector that is not a read tool', async () => {
    const usage = { ...CONTEXT, mcpTools: [...CONTEXT.mcpTools, { name: 'mcp__claude_ai_Slack__slack_send_message', serverName: 'claude_ai_Slack', tokens: 400 }] }
    await refused(fakeClaude('answer-good.jsonl', { usage }), /slack_send_message/u)
  })

  it('refuses when the context holds a tool of Claude Code that writes or reaches out', async () => {
    const usage = { ...CONTEXT, systemTools: [...CONTEXT.systemTools, { name: 'Bash', tokens: 900 }] }
    await refused(fakeClaude('answer-good.jsonl', { usage }), /Bash/u)
  })

  it('refuses when the connector’s tools take more of the context than the ceiling', async () => {
    const usage = { ...CONTEXT, mcpTools: CONTEXT.mcpTools.map((tool, index) => (index === 0 ? { ...tool, tokens: CONNECTOR_TOOLS_MAX_TOKENS } : tool)) }
    await refused(fakeClaude('answer-good.jsonl', { usage }), /tokens/u)
  })

  it('refuses when Claude Code cannot say what the context holds', async () => {
    await refused(fakeClaude('answer-good.jsonl', { usage: { categories: [] } }), /context/u)
  })
})

describe('a source without its connector', () => {
  it('fails the run without a call when the user has no connector for the source', async () => {
    const fake = fakeClaude('answer-good.jsonl')
    const { journal, run } = setup(fake, { listConnectors: () => Promise.resolve([]) })
    await expect(run()).rejects.toThrow(/no claude.ai connector/u)
    expect(fake.specs).toEqual([])
    expect(journal).toHaveLength(1)
  })

  it('fails the run without a call when the connector waits for a sign-in in claude.ai', async () => {
    const fake = fakeClaude('answer-good.jsonl')
    const atlassian: ConnectorRecipe = { ...RECIPE, kind: 'jira', isConnector: (name) => name === 'claude.ai Atlassian', readTools: ['search'] }
    const { deps } = setup(fake)
    await expect(sourceCheckRun(atlassian, deps)({ kind: 'jira', since: null, now: NOW })).rejects.toThrow(/needs-auth/u)
    expect(fake.specs).toEqual([])
  })

  it('fails the run without a call when none of the recipe’s tools is a read tool of the connector', async () => {
    const fake = fakeClaude('answer-good.jsonl')
    const { deps } = setup(fake)
    await expect(sourceCheckRun({ ...RECIPE, readTools: ['slack_send_message'] }, deps)({ kind: 'slack', since: SINCE, now: NOW })).rejects.toThrow(/read tool/u)
    expect(fake.specs).toEqual([])
  })
})

describe('only the structured answer among the tools of Claude Code', () => {
  const refusedBy = async (usage: unknown, pattern: RegExp) => {
    const fake = fakeClaude('answer-good.jsonl', { usage })
    const { ledger, run } = setup(fake)
    await expect(run()).rejects.toThrow(pattern)
    expect(fake.prompts).toEqual([])
    expect(ledger.snapshot().calls).toEqual([])
  }

  it('refuses any other built-in tool in the context, not only the ones that write', async () => {
    await refusedBy({ ...CONTEXT, systemTools: [...CONTEXT.systemTools, { name: 'ToolSearch', tokens: 200 }] }, /ToolSearch/u)
  })

  it('refuses a built-in tool left out of the context but loadable on demand', async () => {
    await refusedBy({ ...CONTEXT, deferredBuiltinTools: [{ name: 'Bash', tokens: 900, isLoaded: false }] }, /Bash/u)
  })

  it('takes the structured answer among the deferred ones', async () => {
    const fake = fakeClaude('answer-good.jsonl', { usage: { ...CONTEXT, deferredBuiltinTools: [{ name: 'StructuredOutput', tokens: 300, isLoaded: false }] } })
    await setup(fake).run()
    expect(fake.prompts).toHaveLength(1)
  })
})

describe('an answer at its cap', () => {
  it('takes the oldest 30 entries and covers only up to the last of them, so the next check reads the rest', async () => {
    // 45 entries, newest first, past the cap the schema asks for.
    const entries = Array.from({ length: 45 }, (_, index) => entry(45 - index))
    const fake = fakeClaude([resultOf(entries)])
    const { core, run } = setup(fake)
    await expect(run()).resolves.toEqual({ coveredUntil: Date.parse(String(entry(30).at)) })
    expect(core.items(null).map((item) => item.subject.id)).toEqual(Array.from({ length: 30 }, (_, index) => `slack:C01MADEUP/${index + 1}`))
  })

  it('covers its whole time when the answer is under the cap', async () => {
    const { run } = setup(fakeClaude([resultOf([entry(1), entry(2)])]))
    await expect(run()).resolves.toBeUndefined()
  })

  it('asks the call to report the oldest messages when more came than it may carry', async () => {
    const fake = fakeClaude('answer-good.jsonl')
    await setup(fake).run()
    expect(fake.prompts[0]).toMatch(/at most 30 .*oldest/u)
  })
})

describe('the Project of an item', () => {
  it('is found by its name in any case', async () => {
    const { core, run } = setup(fakeClaude([resultOf([entry(1, { project: 'OTHER' })])]))
    await run()
    expect(core.items('p-other').map((item) => item.subject.id)).toEqual(['slack:C01MADEUP/1'])
  })
})

describe('a message read again', () => {
  it('glued into its item on the same day carries the newer message', async () => {
    const { core, run } = setup(fakeClaude([resultOf([entry(1)])]))
    await run()
    const again = setup(fakeClaude([resultOf([entry(1, { at: '2026-11-25T12:30:00Z', author: 'Dana Edited' })])]), { core })
    await again.run()
    expect(core.items(null)).toEqual([expect.objectContaining({ events: 2, message: expect.objectContaining({ at: '2026-11-25T12:30:00Z', author: 'Dana Edited' }) })])
  })
})

describe('a call that reached the model and was lost', () => {
  it('notes the call when Claude Code ends without a result after the message', async () => {
    const fake = fakeClaude([])
    const { ledger, run } = setup(fake)
    await expect(run()).rejects.toThrow(/no answer/u)
    expect(fake.prompts).toHaveLength(1)
    expect(ledger.snapshot().calls).toEqual([expect.objectContaining({ kind: 'source-check', source: 'slack', costUsd: 0 })])
  })

  it('notes the call when Claude Code fails after the message', async () => {
    const fake = fakeClaude('answer-good.jsonl', { fail: true })
    const { ledger, run } = setup(fake)
    await expect(run()).rejects.toThrow(/no answer/u)
    expect(fake.closed).toBe(1)
    expect(ledger.snapshot().calls).toEqual([expect.objectContaining({ kind: 'source-check', source: 'slack', costUsd: 0 })])
  })

  it('keeps the items of a paid answer when the usage ledger cannot be written', async () => {
    const { core, journal, run } = setup(fakeClaude('answer-good.jsonl'), {
      ledger: {
        noteCall: () => {
          throw new Error('EACCES: the disk refused')
        },
      },
    })
    await run()
    expect(core.items('p-worfy')).toHaveLength(1)
    expect(journal.join('\n')).toMatch(/usage ledger/u)
  })

  it('writes only the count of the result’s errors to the journal, never their text', async () => {
    const errors = ['Output does not match the schema: "text": "Secret plan from Mallory Example"', 'Reached maximum number of turns (8)']
    const { journal, run } = setup(fakeClaude([resultOf([], { subtype: 'error_max_turns', is_error: true, structured_output: undefined, errors })]))
    await expect(run()).rejects.toThrow(/error_max_turns/u)
    expect(journal.join('\n')).toMatch(/2 errors/u)
    expect(journal.join('\n')).not.toContain('Mallory')
  })
})
