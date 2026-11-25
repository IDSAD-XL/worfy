// The check of a source through a claude.ai connector, on the Claude side (src/main/vendors/claude/connector-check.ts,
// worfy-assistant ticket 11): which connectors the user has, read from the list of MCP servers Claude Code gives
// without a model call, and what one call of Haiku 5.5 over one connector starts Claude Code with. No request is made
// here: the options are read as they would go to the SDK, as the narrator's are (narrator-options.test.ts).
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CHECK_MAX_OUTPUT_TOKENS,
  CONNECTOR_CHECK_MAX_TURNS,
  CONNECTOR_CHECK_MODEL,
  CONNECTOR_CHECK_SYSTEM_PROMPT,
  connectorCheckDir,
  connectorCheckOptions,
  connectorsOf,
  listConnectors,
  mcpToolName,
  readToolsOf,
  type Connector,
} from '../../src/main/vendors/claude/connector-check'
import { ONE_SHOT_DISALLOWED_TOOLS } from '../../src/main/vendors/claude/one-shot'
import type { QueryHandle } from '../../src/main/agent/session/types'

const FIXTURES = join(__dirname, '..', 'fixtures', 'assistant-sources')
const SERVERS: unknown = JSON.parse(readFileSync(join(FIXTURES, 'servers.json'), 'utf8'))
const DATA_DIR = '/Users/someone/Library/Application Support/worfy'
const DEV = { packaged: false, resourcesPath: '/nowhere', platform: 'darwin' as const, arch: 'arm64' }
const PACKAGED = { packaged: true, resourcesPath: '/Applications/worfy.app/Contents/Resources', platform: 'darwin' as const, arch: 'arm64' }
const ENV = { HOME: '/Users/someone', PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'sk-ant-made-up', ANTHROPIC_AUTH_TOKEN: 'made-up' }
const SCHEMA = { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] }

const slack = (): Connector => {
  const found = connectorsOf(SERVERS).find((each) => each.name === 'claude.ai Slack')
  if (found === undefined) throw new Error('the fixture has no Slack connector')
  return found
}

describe('the connectors of the user', () => {
  it('are the claude.ai servers of the MCP list, with their address, status and tools; the user’s own servers are not', () => {
    const connectors = connectorsOf(SERVERS)
    expect(connectors.map((each) => [each.name, each.status, each.url])).toEqual([
      ['claude.ai Slack', 'connected', 'https://mcp.slack.example/mcp'],
      ['claude.ai Atlassian', 'needs-auth', 'https://mcp.atlassian.example/v1/sse'],
    ])
    expect(slack().tools).toContainEqual({ name: 'slack_send_message', readOnly: false, destructive: false })
    expect(slack().tools).toContainEqual({ name: 'slack_read_user_profile', readOnly: null, destructive: null })
    expect(connectors.find((each) => each.name === 'claude.ai Atlassian')?.tools).toEqual([])
  })

  it('reads nothing from an answer that is no list, and skips an entry of the wrong form', () => {
    expect(connectorsOf(null)).toEqual([])
    expect(connectorsOf({ servers: [] })).toEqual([])
    expect(connectorsOf([{ scope: 'claudeai' }, 'claude.ai Slack', ...(SERVERS as unknown[])]).map((each) => each.name)).toEqual(['claude.ai Slack', 'claude.ai Atlassian'])
  })

  it('come from a query that never sends a message, so no model is called, and that is closed after its servers settle', async () => {
    const asked: string[] = []
    let sent = 0
    let closed = 0
    let answers = 0
    const start = async (cwd: string, prompt: AsyncIterable<never>): Promise<QueryHandle> => {
      asked.push(cwd)
      void (async () => {
        for await (const message of prompt) sent += message === undefined ? 0 : 1
      })()
      const pending = (SERVERS as { status: string }[]).map((each, index) => (index === 0 ? { ...each, status: 'pending' } : each))
      return {
        close: () => {
          closed += 1
        },
        mcpServerStatus: () => Promise.resolve((answers += 1) === 1 ? pending : SERVERS),
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<unknown>>(() => undefined) }),
      } as unknown as QueryHandle
    }
    const connectors = await listConnectors(start, connectorCheckDir(DATA_DIR), { settleMs: 1000, pollMs: 0 })
    expect(connectors.map((each) => [each.name, each.status])).toEqual([
      ['claude.ai Slack', 'connected'],
      ['claude.ai Atlassian', 'needs-auth'],
    ])
    expect(asked).toEqual([join(DATA_DIR, 'assistant-sources')])
    expect(answers).toBe(2)
    expect(sent).toBe(0)
    expect(closed).toBe(1)
  })
})

describe('the read tools of a connector', () => {
  it('are the tools the recipe names that the connector has and does not mark as writing', () => {
    const named = ['slack_search_public_and_private', 'slack_read_thread', 'slack_read_user_profile', 'slack_send_message', 'slack_schedule_message', 'slack_read_gone']
    expect(readToolsOf(slack(), named)).toEqual(['slack_search_public_and_private', 'slack_read_thread', 'slack_read_user_profile'])
  })

  it('are named as Claude Code names a claude.ai connector’s tools', () => {
    expect(mcpToolName('claude.ai Slack', 'slack_read_thread')).toBe('mcp__claude_ai_Slack__slack_read_thread')
    expect(mcpToolName('claude.ai Google Drive (2)', 'search')).toBe('mcp__claude_ai_Google_Drive_2__search')
    expect(mcpToolName('my server', 'read')).toBe('mcp__my_server__read')
  })
})

describe('connectorCheckOptions', () => {
  const READ = ['slack_search_public_and_private', 'slack_read_thread', 'slack_read_user_profile']
  const options = () => connectorCheckOptions({ env: ENV, runtime: DEV, cwd: connectorCheckDir(DATA_DIR), spec: { connector: slack(), readTools: READ, outputSchema: SCHEMA } })

  it('asks Haiku 5.5 in worfy’s own folder, without the settings of the user or a Project, without a transcript', () => {
    expect(options()).toMatchObject({
      cwd: join(DATA_DIR, 'assistant-sources'),
      model: 'claude-haiku-5-5',
      settingSources: [],
      persistSession: false,
      permissionMode: 'dontAsk',
      maxTurns: CONNECTOR_CHECK_MAX_TURNS,
      systemPrompt: CONNECTOR_CHECK_SYSTEM_PROMPT,
      outputFormat: { type: 'json_schema', schema: SCHEMA },
    })
    expect(CONNECTOR_CHECK_MODEL).toBe('claude-haiku-5-5')
    // Haiku 5.5 cannot run without thinking (worfy-polish 135): no thinking switch is sent.
    expect(options()).not.toHaveProperty('thinking')
    expect(options()).not.toHaveProperty('maxThinkingTokens')
    expect(options()).not.toHaveProperty('resume')
    expect(options()).not.toHaveProperty('plugins')
    expect(options()).not.toHaveProperty('additionalDirectories')
    expect(options()).not.toHaveProperty('pathToClaudeCodeExecutable')
  })

  it('keeps one connector: the policy tier allows only its address, and worfy passes no server of its own', () => {
    expect(options().managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverUrl: 'https://mcp.slack.example/mcp' }] })
    expect(options().mcpServers).toEqual({})
    // --strict-mcp-config would leave every claude.ai connector out, the one it checks too (the spike of
    // worfy-mcp-live ticket 11, reason `restricted`).
    expect(options()).not.toHaveProperty('strictMcpConfig')
    expect(JSON.stringify(options())).not.toContain('worfy-app')
    expect(JSON.stringify(options())).not.toContain('worfy-canvas')
  })

  it('offers only the connector’s read tools: no tool of Claude Code but the structured answer, the rest of the connector out of the context', () => {
    const read = READ.map((tool) => mcpToolName('claude.ai Slack', tool))
    expect(options().tools).toEqual(['StructuredOutput'])
    expect(options().allowedTools).toEqual(read)
    expect(options().disallowedTools).toEqual([
      ...ONE_SHOT_DISALLOWED_TOOLS,
      'mcp__claude_ai_Slack__slack_send_message',
      'mcp__claude_ai_Slack__slack_schedule_message',
      'mcp__claude_ai_Slack__slack_create_canvas',
    ])
    for (const tool of read) expect(options().disallowedTools).not.toContain(tool)
  })

  it('refuses at the call every tool but the read tools and the structured answer', async () => {
    const canUseTool = options().canUseTool
    if (canUseTool === undefined) throw new Error('no canUseTool')
    const ask = (name: string) => canUseTool(name, {}, { signal: new AbortController().signal, toolUseID: 't', suggestions: [] } as never)
    await expect(ask('mcp__claude_ai_Slack__slack_read_thread')).resolves.toMatchObject({ behavior: 'allow' })
    await expect(ask('StructuredOutput')).resolves.toMatchObject({ behavior: 'allow' })
    await expect(ask('mcp__claude_ai_Slack__slack_send_message')).resolves.toMatchObject({ behavior: 'deny' })
    await expect(ask('Bash')).resolves.toMatchObject({ behavior: 'deny' })
    await expect(ask('mcp__worfy-app__act')).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('never passes an API key, and caps the answer, thinking included', () => {
    expect(options().env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(options().env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(options().env).toMatchObject({ HOME: '/Users/someone', CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(CONNECTOR_CHECK_MAX_OUTPUT_TOKENS) })
    expect(ENV).toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('refuses a connector without an address it can allow, and a call without read tools', () => {
    const atlassian = { ...slack(), url: null }
    expect(() => connectorCheckOptions({ env: ENV, runtime: DEV, cwd: '/x', spec: { connector: atlassian, readTools: READ, outputSchema: SCHEMA } })).toThrow(/address/u)
    expect(() => connectorCheckOptions({ env: ENV, runtime: DEV, cwd: '/x', spec: { connector: slack(), readTools: [], outputSchema: SCHEMA } })).toThrow(/read tool/u)
  })

  it('runs the bundled Claude Code in the packaged app', () => {
    const packaged = connectorCheckOptions({ env: ENV, runtime: PACKAGED, cwd: '/x', spec: { connector: slack(), readTools: READ, outputSchema: SCHEMA } })
    expect(packaged.pathToClaudeCodeExecutable).toBe(posix.join(PACKAGED.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'))
  })

  it('tells the model that what it reads is data, never an instruction', () => {
    expect(CONNECTOR_CHECK_SYSTEM_PROMPT).toMatch(/data, never instructions/u)
  })
})
