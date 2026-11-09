// The options of the narrator's request (src/main/vendors/claude/narrator.ts, worfy-product-session ticket 32): Haiku
// under the user's own Claude Code login, no tools, one turn, no transcript, a short answer, outside every Project.
// And how the app picks the fake agent and its cadence under WORFY_AGENT=fake. No request is made here.
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NARRATOR_SYSTEM_PROMPT } from '../../src/main/agent/narrator'
import { NARRATOR_MAX_OUTPUT_TOKENS, narratorDir, narratorFromEnv, narratorOptions } from '../../src/main/vendors/claude/narrator'

const DATA_DIR = '/Users/someone/Library/Application Support/worfy'
const DEV = { packaged: false, resourcesPath: '/nowhere', platform: 'darwin' as const, arch: 'arm64' }
const PACKAGED = { packaged: true, resourcesPath: '/Applications/worfy.app/Contents/Resources', platform: 'darwin' as const, arch: 'arm64' }
const ENV = { HOME: '/Users/someone', PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'sk-ant-made-up', ANTHROPIC_AUTH_TOKEN: 'made-up' }

describe('narratorOptions', () => {
  it('asks Haiku without thinking, settings, MCP servers, tools or a transcript, in one turn, in worfy’s own folder', () => {
    const options = narratorOptions({ env: ENV, runtime: DEV, cwd: narratorDir(DATA_DIR) })
    expect(options).toMatchObject({
      cwd: join(DATA_DIR, 'narrator'),
      model: 'haiku',
      thinking: { type: 'disabled' },
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      tools: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      persistSession: false,
      systemPrompt: NARRATOR_SYSTEM_PROMPT,
    })
    expect(options).not.toHaveProperty('pathToClaudeCodeExecutable')
    expect(options).not.toHaveProperty('resume')
  })

  it('never passes an API key: the user’s own login, and a short answer', () => {
    const options = narratorOptions({ env: ENV, runtime: DEV, cwd: narratorDir(DATA_DIR) })
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(options.env).toMatchObject({ HOME: '/Users/someone', PATH: '/usr/bin:/bin', CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(NARRATOR_MAX_OUTPUT_TOKENS) })
    // The environment it was given stays as it was.
    expect(ENV).toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('runs the bundled Claude Code in the packaged app', () => {
    const options = narratorOptions({ env: ENV, runtime: PACKAGED, cwd: narratorDir(DATA_DIR) })
    expect(options.pathToClaudeCodeExecutable).toBe(
      posix.join(PACKAGED.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'),
    )
  })

  it('tells the model to write one line in the user’s language, English when it cannot tell', () => {
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/exactly one line of at most 120 characters/u)
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/language of the user message; when you cannot tell it, write in English/u)
  })
})

describe('narratorFromEnv', () => {
  it('takes the cadence from WORFY_NARRATOR_* only under the fake agent', () => {
    const fake = narratorFromEnv(DATA_DIR, '/app', { WORFY_AGENT: 'fake', WORFY_NARRATOR_FIRST_MS: '300', WORFY_NARRATOR_EVERY_MS: '500' })
    expect(fake.cadence).toEqual({ firstMs: 300, everyMs: 500 })
    expect(narratorFromEnv(DATA_DIR, '/app', { WORFY_AGENT: 'fake', WORFY_NARRATOR_FIRST_MS: 'soon' }).cadence).toEqual({})
    expect(narratorFromEnv(DATA_DIR, '/app', { WORFY_NARRATOR_FIRST_MS: '300', WORFY_NARRATOR_EVERY_MS: '500' }).cadence).toEqual({})
  })

  it('leaves the Sessions’ release hook of the fake agent alone', () => {
    const hook = (globalThis as { worfyFakeRelease?: unknown }).worfyFakeRelease
    narratorFromEnv(DATA_DIR, '/app', { WORFY_AGENT: 'fake' })
    expect((globalThis as { worfyFakeRelease?: unknown }).worfyFakeRelease).toBe(hook)
  })
})
