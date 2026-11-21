// The row of an MCP server of a Codex Session (worfy-mcp-live ticket 06, src/main/vendors/codex/mcp.ts):
// a server of mcpServerStatus/list (codexMcpRow) and a mcpServer/startupStatus/updated notification over
// the row before it (codexStartupRow). The forms are those of the pinned Codex 0.166.0
// (src/main/vendors/codex/protocol/ts/v2/); the names are made up. worfy-integrations ticket 07: the row of an
// Integration's server over the row Codex gave (codexIntegrationRow).
import { describe, expect, it } from 'vitest'
import { codexIntegrationRow, codexMcpRow, codexStartupRow, worfyServerNames } from '../../src/main/vendors/codex/mcp'
import { mcpServerRowSchema } from '../../src/shared/agent/mcp-status'
import type { McpServerStatus } from '../../src/main/vendors/codex/protocol/ts/v2/McpServerStatus'
import type { McpServerStatusUpdatedNotification } from '../../src/main/vendors/codex/protocol/ts/v2/McpServerStatusUpdatedNotification'

const server = (fields: Partial<McpServerStatus>): McpServerStatus => ({
  name: 'example-notes',
  runtimeStatus: 'connected',
  pluginId: null,
  httpOrigin: null,
  serverInfo: null,
  serverCapabilities: null,
  toolListMeta: null,
  tools: { search: { name: 'search', inputSchema: { type: 'object' } } },
  toolsError: null,
  resources: [],
  resourceTemplates: [],
  authStatus: 'unsupported',
  ...fields,
})

const update = (fields: Partial<McpServerStatusUpdatedNotification>): McpServerStatusUpdatedNotification => ({
  threadId: 'thr_1',
  name: 'example-notes',
  status: 'ready',
  error: null,
  failureReason: null,
  ...fields,
})

describe('codexMcpRow: a server of mcpServerStatus/list', () => {
  it('maps every runtimeStatus; null — the configuration changed — is still starting', () => {
    const statuses = (['notStarted', 'starting', 'connected', 'authenticationRequired', 'failed', 'cancelled', 'disabled', null] as const).map((runtimeStatus) => codexMcpRow(server({ runtimeStatus }), []).status)
    expect(statuses).toEqual(['pending', 'pending', 'connected', 'needs-auth', 'failed', 'failed', 'disabled', 'pending'])
  })

  it('a server without a sign-in that is not connected needs one; a connected one stays connected', () => {
    expect(codexMcpRow(server({ runtimeStatus: 'failed', authStatus: 'notLoggedIn', httpOrigin: 'https://wiki.example' }), [])).toMatchObject({ status: 'needs-auth', actions: ['sign-in'] })
    expect(codexMcpRow(server({ runtimeStatus: 'connected', authStatus: 'notLoggedIn' }), [])).toMatchObject({ status: 'connected', tools: 1, actions: [] })
  })

  it('offers Sign in only to an HTTP server; one without an origin (stdio) gets Reconnect', () => {
    expect(codexMcpRow(server({ runtimeStatus: 'authenticationRequired', httpOrigin: null }), []).actions).toEqual(['reconnect'])
    expect(codexMcpRow(server({ runtimeStatus: 'failed', toolsError: 'connection refused' }), [])).toMatchObject({ tools: null, error: 'connection refused', actions: ['reconnect'] })
  })

  it('counts the tools of a connected server only, and none when their discovery failed', () => {
    expect(codexMcpRow(server({}), []).tools).toBe(1)
    expect(codexMcpRow(server({ toolsError: 'tools/list timed out', tools: {} }), [])).toMatchObject({ status: 'connected', tools: null, error: 'tools/list timed out' })
    expect(codexMcpRow(server({ runtimeStatus: 'starting' }), []).tools).toBeNull()
  })

  it('the source: worfy for a server worfy gave the Session, user config otherwise, a plugin\'s with the word kept', () => {
    expect(codexMcpRow(server({ name: 'worfy-canvas' }), ['worfy-canvas'])).toMatchObject({ source: 'worfy', sourceWord: null })
    expect(codexMcpRow(server({ name: 'worfy-canvas' }), [])).toMatchObject({ source: 'user', sourceWord: null })
    expect(codexMcpRow(server({ pluginId: 'example-plugin@example' }), [])).toMatchObject({ source: 'user', sourceWord: 'plugin' })
  })

  it('never is not-allowed and never offers Allow, Turn off, Turn on or Restart (spec Q8)', () => {
    const rows = (['notStarted', 'connected', 'authenticationRequired', 'failed', 'disabled'] as const).flatMap((runtimeStatus) =>
      (['notLoggedIn', 'oAuth'] as const).map((authStatus) => codexMcpRow(server({ runtimeStatus, authStatus, httpOrigin: 'https://wiki.example' }), [])),
    )
    for (const row of rows) {
      expect(row.status).not.toBe('not-allowed')
      expect(row.actions.filter((action) => action !== 'reconnect' && action !== 'sign-in')).toEqual([])
    }
  })
})

describe('codexStartupRow: mcpServer/startupStatus/updated over the row before', () => {
  const listed = codexMcpRow(server({ tools: { a: { name: 'a', inputSchema: {} }, b: { name: 'b', inputSchema: {} } } }), [])

  it('starting → pending, ready → connected with the tools the list gave, failed and cancelled → failed with the error', () => {
    expect(codexStartupRow(listed, update({ status: 'starting' }), [])).toMatchObject({ status: 'pending', tools: null, error: null, actions: [] })
    expect(codexStartupRow(listed, update({ status: 'ready' }), [])).toMatchObject({ status: 'connected', tools: 2, error: null, actions: [] })
    expect(codexStartupRow(listed, update({ status: 'failed', error: 'connection refused' }), [])).toMatchObject({ status: 'failed', tools: null, error: 'connection refused', actions: ['reconnect'] })
    expect(codexStartupRow(listed, update({ status: 'cancelled', error: null }), [])).toMatchObject({ status: 'failed', actions: ['reconnect'] })
  })

  it('a failure for want of a new sign-in needs one, with Sign in', () => {
    expect(codexStartupRow(listed, update({ status: 'failed', error: 'expired', failureReason: 'reauthenticationRequired' }), [])).toMatchObject({ status: 'needs-auth', error: 'expired', actions: ['sign-in'] })
  })

  it('a server the rows did not have yet: no tools, its source by the names worfy gave; a known one keeps its source', () => {
    expect(codexStartupRow(undefined, update({ name: 'worfy-browser' }), ['worfy-browser'])).toEqual({ name: 'worfy-browser', status: 'connected', tools: null, error: null, source: 'worfy', sourceWord: null, actions: [] })
    const plugin = codexMcpRow(server({ pluginId: 'example-plugin@example' }), [])
    expect(codexStartupRow(plugin, update({ status: 'starting' }), [])).toMatchObject({ source: 'user', sourceWord: 'plugin' })
  })
})

describe('worfyServerNames', () => {
  it('names the servers of the `mcp_servers.<name>` keys of a Session\'s config, nothing else', () => {
    expect(worfyServerNames({ 'mcp_servers.worfy-canvas': {}, 'mcp_servers.worfy-browser': {}, 'shell_environment_policy.include_only': [] })).toEqual(['worfy-canvas', 'worfy-browser'])
  })
})

describe('codexIntegrationRow: the row of an Integration`s server', () => {
  const SIGN_IN = 'Sign-in needed: Jira — client A. Ask the user to sign in in worfy.'
  const given = codexMcpRow(server({ name: 'jira-client-a', httpOrigin: 'http://127.0.0.1:4100', authStatus: 'bearerToken' }), ['jira-client-a'])

  it('has the source integration and the label, whatever source Codex`s row had', () => {
    const row = codexIntegrationRow(given, 'Jira — client A', null)
    expect(row).toEqual({ name: 'jira-client-a', status: 'connected', tools: 1, error: null, source: 'integration', sourceWord: null, label: 'Jira — client A', actions: [] })
    expect(mcpServerRowSchema.parse(row)).toEqual(row)
    expect(codexIntegrationRow({ ...given, source: 'user', sourceWord: 'plugin' }, 'Jira — client A', null)).toMatchObject({ source: 'integration', sourceWord: null })
  })

  it('a refused sign-in of the proxy is needs-auth with its text, and offers Reconnect only', () => {
    expect(codexIntegrationRow(given, 'Jira — client A', SIGN_IN)).toMatchObject({ status: 'needs-auth', tools: 1, error: SIGN_IN, actions: ['reconnect'] })
    // A server Codex has not started yet, or one turned off, stays as Codex says.
    expect(codexIntegrationRow({ ...given, status: 'pending', tools: null }, 'Jira — client A', SIGN_IN)).toMatchObject({ status: 'pending', error: null, actions: [] })
    expect(codexIntegrationRow({ ...given, status: 'disabled' }, 'Jira — client A', SIGN_IN)).toMatchObject({ status: 'disabled', error: null, actions: [] })
  })

  it('never offers Codex`s own Sign in: it would sign in to worfy`s endpoint, not to the service', () => {
    const waiting = codexMcpRow(server({ name: 'jira-client-a', runtimeStatus: 'authenticationRequired', httpOrigin: 'http://127.0.0.1:4100' }), ['jira-client-a'])
    expect(waiting.actions).toEqual(['sign-in'])
    expect(codexIntegrationRow(waiting, 'Jira — client A', null)).toMatchObject({ status: 'needs-auth', actions: ['reconnect'] })
    expect(codexIntegrationRow({ ...given, status: 'failed', error: 'connection refused', actions: ['reconnect'] }, 'Jira — client A', null)).toMatchObject({ status: 'failed', actions: ['reconnect'] })
  })
})
