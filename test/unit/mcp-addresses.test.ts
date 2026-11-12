// The entries of the policy tier's allowedMcpServers worfy writes (worfy-mcp-live ticket 12; the spike of
// ticket 11): Claude Code takes a serverName of letters, digits, `_` and `-` only, so a claude.ai connector
// (`claude.ai <name>`) passes only by its address, and once any serverUrl entry is on the list a remote server
// matches by its address only. Every name here is made up.
import { describe, expect, it } from 'vitest'
import { allowableByName, allowedMcpEntries, remoteAddressesOf, serverUrlPattern } from '../../src/main/vendors/claude/mcp-addresses'

describe('the names Claude Code takes in a serverName entry', () => {
  it('letters, digits, `_` and `-` only: a connector’s name with its dot and space is not one', () => {
    expect(allowableByName('acme-notes')).toBe(true)
    expect(allowableByName('plugin_worfy_qmd')).toBe(true)
    expect(allowableByName('claude.ai Acme Docs')).toBe(false)
    expect(allowableByName('acme.notes')).toBe(false)
    expect(allowableByName('acme notes')).toBe(false)
    expect(allowableByName('')).toBe(false)
  })
})

describe('the serverUrl pattern of an address', () => {
  it('an address with no query is written as it is', () => {
    expect(serverUrlPattern('https://mcp.acme.example/v1/sse')).toBe('https://mcp.acme.example/v1/sse')
    expect(serverUrlPattern('http://127.0.0.1:4100/mcp')).toBe('http://127.0.0.1:4100/mcp')
  })

  it('an address with a query is its origin and path followed by `*`: the token never reaches --managed-settings', () => {
    const pattern = serverUrlPattern('https://mcp.acme.example/v1/mcp?token=acme-secret-123&team=7')
    expect(pattern).toBe('https://mcp.acme.example/v1/mcp*')
    expect(pattern).not.toContain('acme-secret-123')
  })

  it('a fragment, a user name and password, a bare `?` go the same way', () => {
    expect(serverUrlPattern('https://mcp.acme.example/mcp#acme-secret')).toBe('https://mcp.acme.example/mcp*')
    const withPassword = new URL('https://mcp.acme.example/mcp')
    withPassword.username = 'acme'
    withPassword.password = 'acme-secret'
    expect(serverUrlPattern(withPassword.href)).toBe('https://mcp.acme.example/mcp*')
    expect(serverUrlPattern('https://mcp.acme.example/mcp?')).toBe('https://mcp.acme.example/mcp*')
  })

  it('what is not an http or https address has no pattern', () => {
    expect(serverUrlPattern('not an address')).toBeNull()
    expect(serverUrlPattern('file:///tmp/acme.sock')).toBeNull()
  })
})

describe('the addresses of remote servers in an answer of mcpServerStatus()', () => {
  const answer = [
    { name: 'acme-notes', status: 'connected', scope: 'user', config: { type: 'stdio', command: 'acme-notes' } },
    { name: 'acme-remote', status: 'connected', scope: 'user', config: { type: 'http', url: 'https://remote.acme.example/mcp' } },
    { name: 'acme-events', status: 'failed', scope: 'project', config: { type: 'sse', url: 'https://events.acme.example/sse' } },
    { name: 'claude.ai Acme Docs', status: 'connected', scope: 'claudeai', config: { type: 'claudeai-proxy', url: 'https://docs.acme.example/mcp', id: 'acme-1' } },
    // The proxy case: a claudeai-proxy server that is not one of the user's connectors. Its address is not taken.
    { name: 'acme-proxied', status: 'connected', scope: 'managed', config: { type: 'claudeai-proxy', url: 'https://proxy.acme.example/acme-2', id: 'acme-2' } },
    // A connector the answer gives no address for.
    { name: 'claude.ai Acme Wiki', status: 'needs-auth', scope: 'claudeai', config: { type: 'claudeai-proxy', id: 'acme-3' } },
    { name: 'acme-bare', status: 'connected' },
    'not an entry',
  ]

  it('takes config.url of http and sse servers of any scope and of servers whose scope is claudeai, nothing else', () => {
    expect(Object.fromEntries(remoteAddressesOf(answer))).toEqual({
      'acme-remote': 'https://remote.acme.example/mcp',
      'acme-events': 'https://events.acme.example/sse',
      'claude.ai Acme Docs': 'https://docs.acme.example/mcp',
    })
  })

  it('an answer that is not a list has none', () => {
    expect(remoteAddressesOf(null).size).toBe(0)
    expect(remoteAddressesOf({ servers: answer }).size).toBe(0)
  })
})

describe('allowedMcpEntries', () => {
  const addresses = new Map([
    ['acme-remote', 'https://remote.acme.example/mcp'],
    ['claude.ai Acme Docs', 'https://docs.acme.example/mcp?workspace=acme-secret'],
    ['claude.ai Acme Docs (2)', 'https://docs.acme.example/mcp?workspace=other'],
  ])

  it('stdio and other names without an address by name, every remote server the inventory knows by its address', () => {
    expect(allowedMcpEntries(['acme-notes', 'acme-remote', 'claude.ai Acme Docs', 'plugin_worfy_qmd'], addresses)).toEqual([
      { serverName: 'acme-notes' },
      { serverUrl: 'https://remote.acme.example/mcp' },
      { serverUrl: 'https://docs.acme.example/mcp*' },
      { serverName: 'plugin_worfy_qmd' },
    ])
  })

  it('a remote server known by address never goes by name too, and one pattern goes once', () => {
    const entries = allowedMcpEntries(['claude.ai Acme Docs', 'claude.ai Acme Docs (2)', 'acme-remote'], addresses)
    expect(entries).toEqual([{ serverUrl: 'https://docs.acme.example/mcp*' }, { serverUrl: 'https://remote.acme.example/mcp' }])
    expect(JSON.stringify(entries)).not.toContain('acme-secret')
  })

  it('a name Claude Code cannot read and has no address is left out; a readable one with no address yet goes by name', () => {
    expect(allowedMcpEntries(['claude.ai Acme Wiki', 'acme-later'], addresses)).toEqual([{ serverName: 'acme-later' }])
  })

  it('no inventory answer yet: every readable name by name', () => {
    expect(allowedMcpEntries(['acme-remote', 'claude.ai Acme Docs'], null)).toEqual([{ serverName: 'acme-remote' }])
  })

  it('an empty list, or one of nothing Claude Code can allow, is an empty list', () => {
    expect(allowedMcpEntries([], addresses)).toEqual([])
    expect(allowedMcpEntries(['claude.ai Acme Wiki'], addresses)).toEqual([])
  })

  it('an address that is not http or https is no address: the name goes by name if it can', () => {
    expect(allowedMcpEntries(['acme-odd'], new Map([['acme-odd', 'not an address']]))).toEqual([{ serverName: 'acme-odd' }])
  })
})
