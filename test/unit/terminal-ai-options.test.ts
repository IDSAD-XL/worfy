// The options of the assist process (src/main/terminal-ai/options.ts): what the spare process starts
// with at prewarm(), and what each feature sets at claim().
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSIST_SYSTEM_PROMPT, FEATURE_TIMEOUT_MS, claimOptions, coldQueryOptions, prewarmOptions } from '../../src/main/terminal-ai/options'
import { DEFAULT_TERMINAL_AI_SETTINGS, TERMINAL_AI_FEATURES } from '../../src/shared/terminal-ai/settings'

const DATA_DIR = '/Users/me/Library/Application Support/worfy'
const DEV = { packaged: false, resourcesPath: '/nowhere', platform: 'darwin' as const, arch: 'arm64' }
const PACKAGED = { packaged: true, resourcesPath: '/Applications/worfy.app/Contents/Resources', platform: 'darwin' as const, arch: 'arm64' }
const ENV = { HOME: '/Users/me', PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'sk-ant-made-up', ANTHROPIC_AUTH_TOKEN: 'made-up' }

describe('prewarmOptions', () => {
  it('starts the spare without settings, MCP servers, tools or a transcript, one turn, the shared system prompt', () => {
    const options = prewarmOptions({ env: ENV, runtime: DEV })
    expect(options).toMatchObject({
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      tools: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: true,
      includeHookEvents: true,
      systemPrompt: ASSIST_SYSTEM_PROMPT,
    })
  })

  it('drops the API keys of the environment: Claude Code signs in by subscription', () => {
    const options = prewarmOptions({ env: ENV, runtime: DEV })
    expect(options.env).toEqual({ HOME: '/Users/me', PATH: '/usr/bin:/bin' })
    expect(ENV.ANTHROPIC_API_KEY).toBe('sk-ant-made-up') // the input is not changed
  })

  it('has no cwd: at prewarm() it would only be the parking folder', () => {
    expect(prewarmOptions({ env: ENV, runtime: DEV })).not.toHaveProperty('cwd')
  })

  it('runs the bundled Claude Code in the packaged app, the SDK finds it otherwise', () => {
    expect(prewarmOptions({ env: ENV, runtime: DEV })).not.toHaveProperty('pathToClaudeCodeExecutable')
    // The path follows the runtime's platform (darwin here), not the machine that runs the test.
    expect(prewarmOptions({ env: ENV, runtime: PACKAGED }).pathToClaudeCodeExecutable).toBe(
      posix.join(PACKAGED.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'),
    )
  })
})

describe('claimOptions', () => {
  it('runs every feature in the terminal-ai folder of the data folder, with its own instruction and title', () => {
    const prompts = new Set<string>()
    const titles = new Set<string>()
    for (const feature of TERMINAL_AI_FEATURES) {
      const options = claimOptions(feature, DEFAULT_TERMINAL_AI_SETTINGS, DATA_DIR)
      expect(options.cwd).toBe(join(DATA_DIR, 'terminal-ai'))
      prompts.add(options.appendSystemPrompt ?? '')
      titles.add(options.title ?? '')
    }
    expect(prompts.size).toBe(4)
    expect(titles.size).toBe(4)
  })

  it('asks Haiku without thinking for a Suggestion', () => {
    const options = claimOptions('suggest', DEFAULT_TERMINAL_AI_SETTINGS, DATA_DIR)
    expect(options).toMatchObject({ model: 'haiku', maxThinkingTokens: 0 })
    expect(options).not.toHaveProperty('settings')
  })

  it('asks Sonnet at low effort for Next command, Command request and Fix', () => {
    for (const feature of ['next', 'request', 'fix'] as const) {
      const options = claimOptions(feature, DEFAULT_TERMINAL_AI_SETTINGS, DATA_DIR)
      expect(options).toMatchObject({ model: 'sonnet', settings: { effortLevel: 'low' } })
      expect(options).not.toHaveProperty('maxThinkingTokens')
    }
  })

  it('asks Haiku without thinking for Next command when Settings say Haiku; the other features stay', () => {
    const settings = { ...DEFAULT_TERMINAL_AI_SETTINGS, nextCommandModel: 'haiku' as const }
    expect(claimOptions('next', settings, DATA_DIR)).toMatchObject({ model: 'haiku', maxThinkingTokens: 0 })
    expect(claimOptions('fix', settings, DATA_DIR)).toMatchObject({ model: 'sonnet' })
  })
})

describe('coldQueryOptions', () => {
  it('gives a cold query() the same process options and the claim of the feature', () => {
    const prewarm = prewarmOptions({ env: ENV, runtime: DEV })
    const options = coldQueryOptions(prewarm, claimOptions('fix', DEFAULT_TERMINAL_AI_SETTINGS, DATA_DIR))
    expect(options).toMatchObject({ settingSources: [], mcpServers: {}, tools: [], persistSession: false, cwd: join(DATA_DIR, 'terminal-ai'), model: 'sonnet', effort: 'low' })
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(String(options.systemPrompt)).toContain(ASSIST_SYSTEM_PROMPT)
    expect(String(options.systemPrompt)).toContain('corrected command')
  })
})

it('waits 5 s for a Suggestion, 8 s for Next command and 30 s for the on-demand features', () => {
  expect(FEATURE_TIMEOUT_MS).toEqual({ suggest: 5000, next: 8000, request: 30_000, fix: 30_000 })
})
