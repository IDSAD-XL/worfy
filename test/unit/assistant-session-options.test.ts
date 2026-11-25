// The options the Session of the Assistant starts Claude Code with (worfy-assistant ticket 10; ADR-0114, point 2 and
// boundary 1; spec, test decisions, seam B: «a separate unit test — the Assistant's Session has no Bash»). The function
// is pure: the test reads exactly what goes into the SDK. No Claude Code starts here.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_TOOL_NAMES, appToolUseName, WORFY_APP_SERVER_NAME } from '../../src/shared/assistant/app-tools'
import { ASSISTANT_SESSION_DIR, ASSISTANT_SESSION_MODEL, assistantSessionDir, assistantSessionOptions } from '../../src/main/vendors/claude/assistant-session'
import { HAIKU_MODEL_ID } from '../../src/main/vendors/claude/terminal-ai'
import { ASSISTANT_SESSION_KIND, SESSION_KIND_VARIABLE } from '../../src/main/vendors/claude/options'
import type { ClaudeMcpServer } from '../../src/main/vendors/claude/mcp'

const DATA = join('/Users', 'someone', 'Library', 'Application Support', 'worfy')
const server = { type: 'sdk', name: WORFY_APP_SERVER_NAME, instance: { connect: () => Promise.resolve() } } as unknown as ClaudeMcpServer
const runtime = { packaged: false, resourcesPath: '/nowhere', platform: 'darwin' as const, arch: 'arm64' }

const options = (overrides: Partial<Parameters<typeof assistantSessionOptions>[0]> = {}) =>
  assistantSessionOptions({
    cwd: assistantSessionDir(DATA),
    env: { PATH: '/usr/bin', HOME: '/Users/someone', ANTHROPIC_API_KEY: 'sk-ant-secret', ANTHROPIC_AUTH_TOKEN: 'token' },
    runtime,
    sessionId: 'b6f0c3c4-5f00-4d4e-9b70-000000000001',
    server,
    instructions: 'the instructions of worfy-app',
    harnessPlugin: '/Applications/worfy.app/Contents/Resources/harness',
    ...overrides,
  })

/** Every name of a tool Claude Code could offer the Session that writes, runs a shell or reaches the network. */
const FORBIDDEN = ['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent']

describe('the Session of the Assistant: where it runs', () => {
  it("runs in worfy's data folder, in a folder of its own, outside every Project", () => {
    expect(assistantSessionDir(DATA)).toBe(join(DATA, 'assistant', ASSISTANT_SESSION_DIR))
    expect(options().cwd).toBe(join(DATA, 'assistant', ASSISTANT_SESSION_DIR))
  })

  it("reads no settings file: no Project's CLAUDE.md, hooks or settings, and no user's either", () => {
    expect(options().settingSources).toEqual([])
  })

  it('is the third kind of Session for the Harness: WORFY_SESSION_KIND is assistant, and the Harness plugin of the build comes along', () => {
    const env = options().env!
    expect(ASSISTANT_SESSION_KIND).toBe('assistant')
    expect(env[SESSION_KIND_VARIABLE]).toBe('assistant')
    expect(options().plugins).toEqual([{ type: 'local', path: '/Applications/worfy.app/Contents/Resources/harness', skipMcpDiscovery: true }])
    expect(options({ harnessPlugin: null }).plugins).toBeUndefined()
  })

  it('carries no API key: it runs on the subscription, as every Session of worfy', () => {
    const env = options().env!
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })
})

describe('the Session of the Assistant: only the tools of worfy-app (boundary 1)', () => {
  it('has no built-in tool at all: no Bash, no file write, no network', () => {
    expect(options().tools).toEqual([])
    for (const tool of FORBIDDEN) expect(options().disallowedTools).toContain(tool)
  })

  it('has one MCP server, worfy-app, and the policy tier lets no server of the user or connector of claude.ai in', () => {
    const opts = options()
    expect(Object.keys(opts.mcpServers ?? {})).toEqual([WORFY_APP_SERVER_NAME])
    expect(opts.mcpServers?.[WORFY_APP_SERVER_NAME]).toBe(server)
    expect(opts.managedSettings).toMatchObject({ allowManagedMcpServersOnly: true, allowedMcpServers: [], allowManagedPermissionRulesOnly: true })
  })

  it('allows exactly the tools of worfy-app and asks about nothing: whatever else is denied', async () => {
    const opts = options()
    expect([...(opts.allowedTools ?? [])].sort()).toEqual(APP_TOOL_NAMES.map(appToolUseName).sort())
    expect(opts.permissionMode).toBe('dontAsk')
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined()
    const ask = opts.canUseTool!
    const signal = new AbortController().signal
    for (const tool of [...FORBIDDEN, 'Read', 'Glob', 'Grep', 'mcp__worfy-canvas__create_card', 'mcp__claude_ai_Slack__slack_send_message', 'mcp__plugin_worfy_qmd__query']) {
      const answer = await ask(tool, {}, { signal, toolUseID: 't1' } as never)
      expect(answer?.behavior, tool).toBe('deny')
    }
    expect((await ask(appToolUseName('items_list'), {}, { signal, toolUseID: 't2' } as never))?.behavior).toBe('allow')
  })

  it("puts worfy-app's instructions in the system prompt", () => {
    expect(options().systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'the instructions of worfy-app' })
  })
})

describe('the Session of the Assistant: each wake is a new Session', () => {
  it('starts under the id it is given and resumes nothing', () => {
    const opts = options()
    expect(opts.sessionId).toBe('b6f0c3c4-5f00-4d4e-9b70-000000000001')
    expect(opts.resume).toBeUndefined()
    expect(opts.continue).toBeUndefined()
    expect(opts.persistSession).toBe(false)
  })
})

describe('the Session of the Assistant: the model', () => {
  it('reasons on the strong model, not on Haiku: Haiku 5.5 only sorts the text of sources (ticket 11)', () => {
    expect(options().model).toBe(ASSISTANT_SESSION_MODEL)
    expect(ASSISTANT_SESSION_MODEL).toBe('opus')
    expect(options().model).not.toBe(HAIKU_MODEL_ID)
    expect(String(options().model).toLowerCase()).not.toContain('haiku')
  })
})
