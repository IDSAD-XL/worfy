// The catalogue of services an Integration starts from (worfy-integrations ticket 03; spec, "decided without the owner",
// 5; owner's answer Q6): every row is data — an https address or a custom server, at least one way to sign in and a
// default name. A new service is a row here, never code.
import { describe, expect, it } from 'vitest'
import { CATALOGUE, catalogueEntry } from '../../src/shared/integrations/catalogue'
import { INTEGRATION_AUTH } from '../../src/shared/integrations/types'

describe('the catalogue of Integrations', () => {
  it('has the services of the first version, keyed once each, and the custom server', () => {
    expect(CATALOGUE.map((entry) => entry.key)).toEqual(['atlassian', 'linear', 'notion', 'sentry', 'github', 'figma', 'custom'])
    expect(new Set(CATALOGUE.map((entry) => entry.key)).size).toBe(CATALOGUE.length)
  })

  it('gives every row an https address or a custom server (http and stdio), a way to sign in and a default name', () => {
    for (const entry of CATALOGUE) {
      if (entry.server.kind === 'http') {
        expect(new URL(entry.server.url).protocol, entry.key).toBe('https:')
      } else {
        expect(entry.key).toBe('custom')
        expect(entry.server.transports).toEqual(['http', 'stdio'])
      }
      expect(entry.auth.length, entry.key).toBeGreaterThan(0)
      for (const auth of entry.auth) expect(INTEGRATION_AUTH).toContain(auth)
      expect(entry.defaultLabel.trim(), entry.key).not.toBe('')
      expect(entry.name.trim(), entry.key).not.toBe('')
    }
  })

  it('names a place to get a token for every service that signs in with one', () => {
    for (const entry of CATALOGUE) {
      if (entry.key === 'custom') continue
      const token = entry.auth.some((auth) => auth === 'bearer' || auth === 'basic' || auth === 'header')
      if (token) expect(entry.tokenHint, entry.key).toMatch(/\S/)
    }
  })

  it('signs in to GitHub with a token only: its OAuth is closed to a client like worfy', () => {
    expect(catalogueEntry('github')?.auth).toEqual(['bearer'])
    expect(catalogueEntry('github')?.server).toEqual({ kind: 'http', url: 'https://api.githubcopilot.com/mcp/' })
  })

  it('marks Figma as a service that may refuse worfy, and no other catalogue service', () => {
    expect(catalogueEntry('figma')?.mayRefuse).toMatch(/may refuse worfy/)
    for (const entry of CATALOGUE.filter((row) => row.key !== 'figma')) expect(entry.mayRefuse, entry.key).toBeNull()
  })

  it('keeps the Atlassian address of the Rovo MCP server', () => {
    expect(catalogueEntry('atlassian')?.server).toEqual({ kind: 'http', url: 'https://mcp.atlassian.com/v2/mcp' })
    expect(catalogueEntry('atlassian')?.auth).toContain('oauth')
  })

  it('has no Slack (Q6: Slack stays with the claude.ai connector)', () => {
    expect(catalogueEntry('slack')).toBeUndefined()
    for (const entry of CATALOGUE) {
      expect(entry.key).not.toMatch(/slack/i)
      if (entry.server.kind === 'http') expect(entry.server.url).not.toMatch(/slack/i)
    }
  })
})
