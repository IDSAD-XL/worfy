// Sign in to an MCP server of a Claude Session (worfy-mcp-live ticket 05; spec, Q5). The spike of ticket 01
// chose Claude Code's own sign-in: mcpAuthenticate(name) — in the SDK's code, not in its documented types —
// answers the server's sign-in page (F:oauth-authenticate); worfy opens it in the system browser
// (shell.openExternal), Claude Code listens for the callback on localhost and takes the token itself. The
// action ends once the server is out of needs-auth. A claude.ai connector signs in on claude.ai with no
// callback: the action ends once the page is open, and the row offers Reconnect for after. A Claude Code
// without mcpAuthenticate offers no Sign in: the row says where to sign in. The page — its state and code
// challenge — never reaches a log, an event or the IPC answer, and worfy never holds a token.
//
// On the fake agent: its sign-in page is on a host that never resolves, the browser is the test's stub, and
// the sign-in lands when the test releases `sign-in:<name>`, as Claude Code's listener would. No network.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryHandle } from '../../src/main/agent/session'
import { SIGN_IN_ELSEWHERE } from '../../src/main/vendors/claude/mcp'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'

const mocks = vi.hoisted(() => ({ openExternal: vi.fn<(url: string) => Promise<void>>() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: mocks.openExternal },
}))

let cwd: string
let emptyHome: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-mcp-sign-in-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-mcp-sign-in-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A Session on the fake agent playing `script` from `dir`; `wrap` may change its query. */
async function harness(script = 'mcp-sign-in', dir = AGENT_SCRIPTS, wrap: (query: QueryHandle) => QueryHandle = (query) => query) {
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const fake = fakeQueryFactory({ scriptsDir: dir, script, releases, record: (call) => calls.push(call) })
  const registry = new SessionRegistry(async (request) => wrap(await fake(request)))
  registries.push(registry)
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
  await vi.waitFor(() => expect(session.state).toBe('idle'))
  session.send('one')
  await vi.waitFor(() => expect(events.some((event) => event.type === 'result')).toBe(true))
  await vi.waitFor(() => expect(session.state).toBe('idle'))
  await vi.waitFor(() => expect(events.some((event) => event.type === 'mcp')).toBe(true))
  const rowOf = (name: string): McpServerRow | undefined => [...events].reverse().find((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp')?.servers?.find((each) => each.name === name)
  return { calls, releases, session, events, rowOf }
}

/** example-oauth of F:inventory-status, before the sign-in. */
const NEEDS_AUTH: McpServerRow = { name: 'example-oauth', status: 'needs-auth', tools: null, error: null, source: 'user', sourceWord: null, actions: ['sign-in', 'reconnect'] }

describe('Sign in to a server in needs-auth', () => {
  it('opens the page mcpAuthenticate() gave in the browser and ends once Claude Code took the callback: the server is connected', async () => {
    const h = await harness()
    expect(h.rowOf('example-oauth')).toEqual(NEEDS_AUTH)

    const signing = h.session.mcpAction('example-oauth', 'sign-in')
    await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledTimes(1))
    const page = new URL(mocks.openExternal.mock.calls[0]![0])
    // The page of F:oauth-authenticate: the parameters the spike recorded, on the server's host.
    expect(page.protocol).toBe('https:')
    expect([...page.searchParams.keys()].sort()).toEqual(['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'resource', 'response_type', 'state'])
    expect(h.calls.filter((call) => call.kind === 'mcpAuthenticate')).toEqual([{ kind: 'mcpAuthenticate', name: 'example-oauth' }])
    // The person signs in in the browser; the redirect reaches Claude Code's listener on localhost.
    h.releases.release('sign-in:example-oauth')
    const answer = await signing
    expect(answer.error).toBeNull()
    expect(answer.servers?.find((each) => each.name === 'example-oauth')).toMatchObject({ status: 'connected', actions: ['turn-off'] })
    // Connected by the sign-in itself: no Reconnect was needed, and Claude Code's toggle never.
    expect(h.calls.filter((call) => call.kind === 'reconnectMcpServer' || call.kind === 'toggleMcpServer')).toEqual([])
  })

  it('the page, its state and its code challenge reach no log, no event and no answer; worfy holds no token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined))
    const h = await harness()
    const signing = h.session.mcpAction('example-oauth', 'sign-in')
    await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledTimes(1))
    const page = new URL(mocks.openExternal.mock.calls[0]![0])
    h.releases.release('sign-in:example-oauth')
    const answer = await signing
    const secrets = [page.toString(), page.searchParams.get('state')!, page.searchParams.get('code_challenge')!, page.host]
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)))).join('\n')
    const seen = JSON.stringify(h.events) + JSON.stringify(answer)
    for (const secret of secrets) {
      expect(logged, secret).not.toContain(secret)
      expect(seen, secret).not.toContain(secret)
    }
    expect(`${logged}\n${seen}`).not.toMatch(/access_token|refresh_token|Bearer /u)
  })

  it('a claude.ai connector signs in on claude.ai: the action ends once the page is open, and the row offers Reconnect for after', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worfy-mcp-sign-in-scripts-'))
    try {
      const lines = readFileSync(join(AGENT_SCRIPTS, 'mcp-sign-in.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '')
      lines[0] = JSON.stringify({ fake: 'mcp', servers: [{ name: 'example-connector', status: 'needs-auth', source: 'claudeai', scope: 'claudeai' }] })
      await writeFile(join(dir, 'connector.jsonl'), `${lines.join('\n')}\n`)
      const h = await harness('connector', dir)
      expect(h.rowOf('example-connector')).toEqual({ ...NEEDS_AUTH, name: 'example-connector', source: 'claudeai' })
      const answer = await h.session.mcpAction('example-connector', 'sign-in')
      expect(mocks.openExternal).toHaveBeenCalledTimes(1)
      expect(answer.error).toBeNull()
      expect(answer.servers?.find((each) => each.name === 'example-connector')).toMatchObject({ status: 'needs-auth', actions: ['sign-in', 'reconnect'] })
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('a sign-in page that is not a web page is refused before anything opens it', async () => {
    const h = await harness('mcp-sign-in', AGENT_SCRIPTS, (query) => Object.assign(query, { mcpAuthenticate: () => Promise.resolve({ authUrl: 'file:///etc/passwd', requiresUserAction: true, callbackExpected: true }) }))
    const answer = await h.session.mcpAction('example-oauth', 'sign-in')
    expect(answer.error).toBe('Claude Code gave a sign-in page that is not a web page')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
  it.each([
    ['a leading tab', '\thttps://ok', 'https://ok/'],
    ['a trailing line break', 'https://ok\n', 'https://ok/'],
    ['backslashes for slashes', 'http:\\\\evil', 'http://evil/'],
  ])('a sign-in page with %s opens as the URL parser reads it, not as the raw string', async (_what, given, opened) => {
    const h = await harness('mcp-sign-in', AGENT_SCRIPTS, (query) => Object.assign(query, { mcpAuthenticate: () => Promise.resolve({ authUrl: given, requiresUserAction: true, callbackExpected: false }) }))
    const answer = await h.session.mcpAction('example-oauth', 'sign-in')
    expect(answer.error).toBeNull()
    expect(mocks.openExternal.mock.calls).toEqual([[opened]])
  })

  it('a row that does not offer Sign in is refused before Claude Code is asked: no mcpAuthenticate, no page', async () => {
    const h = await harness()
    expect(h.rowOf('example-notes')?.actions).not.toContain('sign-in')
    await expect(h.session.mcpAction('example-notes', 'sign-in')).rejects.toMatchObject({ name: 'McpActionRefused' })
    expect(h.calls.filter((call) => call.kind === 'mcpAuthenticate')).toEqual([])
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('a server that ends failed after the sign-in is reconnected once', async () => {
    let signedIn = false
    const reconnected: string[] = []
    const h = await harness('mcp-sign-in', AGENT_SCRIPTS, (query) => {
      const status = query.mcpServerStatus!.bind(query)
      return Object.assign(query, {
        mcpAuthenticate: () => {
          signedIn = true
          return Promise.resolve({ authUrl: 'https://auth.example.invalid/authorize', requiresUserAction: true, callbackExpected: true })
        },
        mcpServerStatus: async () => {
          const rows = (await status()) as { name: string; status: string }[]
          return signedIn ? rows.map((row) => (row.name === 'example-oauth' ? { ...row, status: 'failed', error: 'the token was refused' } : row)) : rows
        },
        reconnectMcpServer: (name: string) => {
          reconnected.push(name)
          return Promise.resolve()
        },
      })
    })
    const answer = await h.session.mcpAction('example-oauth', 'sign-in')
    expect(answer.error).toBeNull()
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(reconnected).toEqual(['example-oauth'])
  })
})

describe('a Claude Code without mcpAuthenticate (the method is not in the SDK’s documented types)', () => {
  it('offers no Sign in: the row says where to sign in and offers Reconnect; Sign in is refused before anything happens', async () => {
    const h = await harness('mcp-sign-in', AGENT_SCRIPTS, (query) => Object.assign(query, { mcpAuthenticate: undefined }))
    expect(h.rowOf('example-oauth')).toEqual({ ...NEEDS_AUTH, error: SIGN_IN_ELSEWHERE, actions: ['reconnect'] })
    await expect(h.session.mcpAction('example-oauth', 'sign-in')).rejects.toThrow(/not available/)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
