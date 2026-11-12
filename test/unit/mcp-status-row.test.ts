// The row of one MCP server of a Claude Session (worfy-mcp-live ticket 02): what mcpServerStatus()
// of Claude Code answers, as the rows the renderer draws (src/shared/agent/mcp-status.ts). The SDK's
// answers are those the spike recorded (test/fixtures/mcp-live/, worfy-mcp-live ticket 01; its scrub
// kept only the names of the tools, as `tool_names`), with the `source` words the SDK documents.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_SERVER_SOURCES, mcpServerRowSchema, mcpSourceOf } from '../../src/shared/agent/mcp-status'
import { initMcpServers, mcpServerRowsOf } from '../../src/shared/vendors/claude/events'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')

/**
 * A recorded list of servers in the SDK's shape, `tool_names` back into `tools`: the mcpServerStatus()
 * answer of the fixture `name` — the status after the call it records, or, with `answer`, the servers
 * the call itself answered (reloadPlugins).
 */
function recorded(name: string, part: 'status_after' | 'answer' = 'status_after'): unknown[] {
  const value = JSON.parse(readFileSync(join(FIXTURES, 'mcp-live', `mcp-live-${name}.json`), 'utf8')) as Record<string, unknown> | unknown[]
  const rows = (Array.isArray(value) ? value : part === 'answer' ? (value.answer as { mcpServers: unknown[] }).mcpServers : value.status_after) as Record<string, unknown>[]
  return rows.map(({ tool_names: names, ...row }) => (Array.isArray(names) ? { ...row, tools: names.map((tool: unknown) => ({ name: tool })) } : row))
}

/** The recorded user server with `source` changed to `word`. */
const withSource = (word: string | undefined): unknown => {
  const row = { ...(recorded('restart-status')[0] as Record<string, unknown>) }
  delete row.source
  return word === undefined ? row : { ...row, source: word }
}

describe('the source of a server', () => {
  it('each SDK word goes to its source: claude.ai, user config, Project or worfy', () => {
    const cases: [string, string][] = [
      ['claudeai', 'claudeai'],
      ['user', 'user'],
      ['local', 'user'],
      ['dynamic', 'user'],
      ['project', 'project'],
      ['sdk', 'worfy'],
      ['plugin', 'worfy'],
    ]
    for (const [word, source] of cases) {
      expect(mcpServerRowsOf([withSource(word)]), word).toEqual([expect.objectContaining({ source, sourceWord: null })])
    }
  })

  it('a word worfy does not know by name is user config, with the word kept for a tooltip', () => {
    for (const word of ['managed', 'enterprise', 'agent', 'something-new']) {
      expect(mcpSourceOf(word), word).toEqual({ source: 'user', sourceWord: word })
      expect(mcpServerRowsOf([withSource(word)]), word).toEqual([expect.objectContaining({ source: 'user', sourceWord: word })])
    }
    // A Claude Code older than the field says no word at all.
    expect(mcpServerRowsOf([withSource(undefined)])).toEqual([expect.objectContaining({ source: 'user', sourceWord: null })])
  })

  it('every source a row can have is one of the four', () => {
    expect(MCP_SERVER_SOURCES).toEqual(['claudeai', 'user', 'project', 'worfy'])
  })
})

describe('the rows of a recorded answer', () => {
  it('a user server and worfy-canvas, connected, with their tool counts', () => {
    expect(mcpServerRowsOf(recorded('restart-status'))).toEqual([
      { name: 'example-notes', status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: [] },
      { name: 'worfy-canvas', status: 'connected', tools: 1, error: null, source: 'worfy', sourceWord: null, actions: [] },
    ])
  })

  it('a failed server has its error and Reconnect', () => {
    const [row] = mcpServerRowsOf(recorded('locked-keychain-status')) ?? []
    expect(row).toMatchObject({ name: 'example-oauth', status: 'failed', tools: null, source: 'user', actions: ['reconnect'] })
    expect(row?.error).toMatch(/^Couldn't read the stored credentials/)
  })

  it('pending, needs-auth and disabled servers have no action of this ticket', () => {
    const rows = [...(mcpServerRowsOf(recorded('inventory-status')) ?? []), ...(mcpServerRowsOf(recorded('allowed-reload-plugins', 'answer')) ?? []), ...(mcpServerRowsOf(recorded('allowed-toggle-off')) ?? [])]
    const statuses = new Set(rows.map((row) => row.status))
    expect([...statuses].sort()).toEqual(expect.arrayContaining(['needs-auth', 'pending', 'disabled']))
    for (const row of rows) if (row.status !== 'failed') expect(row.actions, `${row.name} ${row.status}`).toEqual([])
  })

  it('no row of any recorded answer offers Turn off or Turn on: those come with the Restart of ticket 03', () => {
    const answers = ['restart-status', 'locked-keychain-status', 'inventory-status', 'allowed-reload-plugins', 'allowed-reload-local-project', 'allowed-toggle-off', 'allowed-toggle-on', 'restart-user-reconnect', 'cut-status-start']
    for (const name of answers) {
      const rows = mcpServerRowsOf(recorded(name))
      expect(rows, name).not.toBeNull()
      for (const row of rows ?? []) {
        expect(mcpServerRowSchema.parse(row)).toEqual(row)
        expect(row.actions, `${name}: ${row.name}`).not.toContain('turn-off')
        expect(row.actions, `${name}: ${row.name}`).not.toContain('turn-on')
      }
    }
  })

  it('the config of a server (its URL, its headers) never reaches a row', () => {
    const row = { ...(withSource('user') as object), config: { type: 'http', url: 'https://example-tracker.invalid/mcp', headers: { Authorization: 'Bearer example-secret' } }, scope: 'user', serverInfo: { name: 'example', version: '1' } }
    const rows = mcpServerRowsOf([row])
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toMatch(/example-tracker|example-secret|config|scope|serverInfo/)
  })

  it('an answer that is no list is no data; an entry with no name or no status is left out', () => {
    expect(mcpServerRowsOf(null)).toBeNull()
    expect(mcpServerRowsOf({ servers: [] })).toBeNull()
    expect(mcpServerRowsOf([{ name: 'example-notes' }, { status: 'connected' }, { name: 'example-new', status: 7 }, withSource('user')])).toEqual([
      expect.objectContaining({ name: 'example-notes', status: 'connected' }),
    ])
  })

  it('a status worfy does not know is a row all the same: disabled, with Claude Code\'s word in its error', () => {
    // Claude Code's mcp_status passes its own connection states through (only `cached` becomes `pending`):
    // a server it reports as, say, `blocked` must not vanish from both groups of the popover.
    const [known, blocked] = mcpServerRowsOf([withSource('user'), { name: 'example-docs', status: 'blocked', source: 'claudeai', scope: 'claudeai' }]) ?? []
    expect(known).toMatchObject({ name: 'example-notes', status: 'connected' })
    expect(blocked).toEqual({ name: 'example-docs', status: 'disabled', tools: null, error: 'Claude Code reports this server as “blocked”.', source: 'claudeai', sourceWord: null, actions: [] })
  })
})

describe('the servers of a system/init', () => {
  it('are kept: the rows without tool counts, from each recorded init', () => {
    const lines = readFileSync(join(FIXTURES, 'sdk-messages', 'plugin-mcp-live-restart-same-conversation.jsonl'), 'utf8').trim().split('\n')
    expect(initMcpServers(JSON.parse(lines[0]!))).toEqual([
      { name: 'example-notes', status: 'connected', tools: null, error: null, source: 'user', sourceWord: null, actions: [] },
      { name: 'worfy-canvas', status: 'connected', tools: null, error: null, source: 'worfy', sourceWord: null, actions: [] },
    ])
  })

  it('another message has none', () => {
    expect(initMcpServers({ type: 'system', subtype: 'status', status: null })).toBeNull()
    expect(initMcpServers({ type: 'result', subtype: 'success' })).toBeNull()
  })
})
