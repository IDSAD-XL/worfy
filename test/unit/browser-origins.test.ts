// Where a Session may take a Browser (worfy-browser ticket 04, ADR-0078 item 5): only to the
// origins of the Browser's profile, matched as whole origins — scheme, host and port — never by the
// host alone; anything that is not an http(s) page is refused, and with no origins listed the
// Session goes nowhere (src/main/browser/origins.ts).
import { describe, expect, it } from 'vitest'
import { originOf, originRefusal, sessionMayGo } from '../../src/main/browser/origins'

const ORIGINS = ['http://localhost:3000', 'https://staging.example.com']

describe('a page a Session may go to', () => {
  it('is one on an origin of the list, with any path, query or fragment', () => {
    expect(sessionMayGo('http://localhost:3000/', ORIGINS)).toBe(true)
    expect(sessionMayGo('http://localhost:3000/admin/users?page=2#top', ORIGINS)).toBe(true)
    expect(sessionMayGo('https://staging.example.com/login', ORIGINS)).toBe(true)
    // The browser's own spelling: the default port of the scheme and a host in capitals are the same origin.
    expect(sessionMayGo('https://STAGING.example.com:443/', ORIGINS)).toBe(true)
  })

  it('is not one outside the list', () => {
    expect(sessionMayGo('https://example.com/', ORIGINS)).toBe(false)
    expect(sessionMayGo('https://evil.staging.example.com/', ORIGINS)).toBe(false)
    expect(sessionMayGo('http://localhost.evil.com:3000/', ORIGINS)).toBe(false)
  })

  it('is not one on another port of a listed host', () => {
    expect(sessionMayGo('http://localhost:3001/', ORIGINS)).toBe(false)
    expect(sessionMayGo('http://localhost/', ORIGINS)).toBe(false)
    expect(sessionMayGo('https://staging.example.com:8443/', ORIGINS)).toBe(false)
  })

  it('is not one on another scheme of a listed host', () => {
    expect(sessionMayGo('https://localhost:3000/', ORIGINS)).toBe(false)
    expect(sessionMayGo('http://staging.example.com/', ORIGINS)).toBe(false)
    expect(sessionMayGo('ws://localhost:3000/', ORIGINS)).toBe(false)
  })

  it('is never about:blank, a data: page, a javascript: address or a file', () => {
    for (const url of ['about:blank', 'data:text/html,<h1>hi</h1>', 'javascript:alert(1)', 'file:///etc/passwd', 'blob:http://localhost:3000/1234', 'chrome://gpu', 'not a url', '']) {
      expect(sessionMayGo(url, ORIGINS), url).toBe(false)
    }
  })

  it('is none at all with an empty list', () => {
    for (const url of ['http://localhost:3000/', 'https://staging.example.com/', 'about:blank']) expect(sessionMayGo(url, []), url).toBe(false)
  })
})

describe('the origin of an address, as a refusal names it', () => {
  it('is scheme://host:port of an http(s) page, the scheme of anything else', () => {
    expect(originOf('http://localhost:3001/a?b')).toBe('http://localhost:3001')
    expect(originOf('https://Example.com:443/')).toBe('https://example.com')
    expect(originOf('about:blank')).toBe('about:')
    expect(originOf('javascript:alert(1)')).toBe('javascript:')
    expect(originOf('nonsense')).toBe('nonsense')
  })
})

describe('the refusal of a page outside the list', () => {
  it('names the origin and the list, and is null for a page in it', () => {
    expect(originRefusal('http://localhost:3000/x', 'admin', ORIGINS)).toBeNull()
    const refusal = originRefusal('http://localhost:3001/x', 'admin', ORIGINS)
    expect(refusal).toContain('http://localhost:3001')
    expect(refusal).toContain('"admin"')
    expect(refusal).toContain('http://localhost:3000, https://staging.example.com')
  })

  it('says that the list is empty when it is', () => {
    expect(originRefusal('http://localhost:3000/', 'user', [])).toMatch(/lists no origins/)
  })
})
