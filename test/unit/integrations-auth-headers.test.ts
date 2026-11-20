// The sign-in an Integration sends with a token (worfy-integrations ticket 04; ADR-0111): Bearer, Basic of an e-mail
// and a token, a header of its own, and the secret variables of a stdio server, which go into the process's
// environment and never into its arguments. The secrets are read from the store on every connection.
import { describe, expect, it } from 'vitest'
import { basicSecret, connectionHeaders, MissingSecretError, scrubServiceText, signInHeaders, stdioLaunch } from '../../src/main/integrations/auth/tokens'
import type { Integration, IntegrationSecretPart } from '../../src/shared/integrations/types'

const TOKEN = 'tok-UNIT-SECRET-0123456789'

function integration(overrides: Partial<Integration>): Integration {
  return {
    id: 'abcd1234',
    service: 'custom',
    label: 'Stub',
    transport: { kind: 'http', url: 'https://mcp.example.test/mcp' },
    auth: 'bearer',
    headerName: null,
    signIn: null,
    ...overrides,
  }
}

const reading =
  (secrets: Partial<Record<IntegrationSecretPart, string>>) =>
  (part: IntegrationSecretPart): string | undefined =>
    secrets[part]

describe('signInHeaders', () => {
  it('puts a bearer token in Authorization: Bearer', () => {
    expect(signInHeaders(integration({ auth: 'bearer' }), reading({ access: TOKEN }))).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('puts an e-mail and a token in Authorization: Basic, base64 of e-mail:token', () => {
    const secret = basicSecret('me@example.test', TOKEN)
    const headers = signInHeaders(integration({ auth: 'basic' }), reading({ access: secret }))
    expect(headers).toEqual({ Authorization: `Basic ${Buffer.from(`me@example.test:${TOKEN}`, 'utf8').toString('base64')}` })
  })

  it('puts the token in the header the Integration names', () => {
    expect(signInHeaders(integration({ auth: 'header', headerName: 'X-Api-Key' }), reading({ access: TOKEN }))).toEqual({ 'X-Api-Key': TOKEN })
  })

  it('sends nothing for a server without sign-in, and leaves OAuth to its provider', () => {
    expect(signInHeaders(integration({ auth: 'none' }), reading({ access: TOKEN }))).toEqual({})
    expect(signInHeaders(integration({ auth: 'oauth' }), reading({ access: TOKEN }))).toEqual({})
  })

  it('throws MissingSecretError naming the part when the token is not kept', () => {
    expect(() => signInHeaders(integration({ auth: 'bearer' }), reading({}))).toThrow(MissingSecretError)
    expect(() => signInHeaders(integration({ auth: 'bearer' }), reading({}))).toThrow(/access/)
  })

  it('refuses a Basic secret without an e-mail, and an e-mail with a colon, never quoting the token', () => {
    let message = ''
    try {
      signInHeaders(integration({ auth: 'basic' }), reading({ access: TOKEN }))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/e-mail/)
    expect(message).not.toContain(TOKEN)
    expect(() => basicSecret('me:you@example.test', TOKEN)).toThrow(/colon/)
    expect(() => basicSecret('', TOKEN)).toThrow(/e-mail/)
    expect(() => basicSecret('me@example.test', '')).toThrow(/token/)
  })
})

describe('connectionHeaders', () => {
  it('reads the secret store on every connection: a new token is the next connection’s token', () => {
    const secrets = new Map<string, string>([['abcd1234:access', TOKEN]])
    const stored = integration({ auth: 'bearer' })
    const store = { get: (id: string) => (id === stored.id ? stored : undefined), secret: (id: string, part: IntegrationSecretPart) => secrets.get(`${id}:${part}`) }
    expect(connectionHeaders(store, stored.id)).toEqual({ Authorization: `Bearer ${TOKEN}` })
    secrets.set('abcd1234:access', 'tok-NEXT')
    expect(connectionHeaders(store, stored.id)).toEqual({ Authorization: 'Bearer tok-NEXT' })
    expect(() => connectionHeaders(store, 'no-such-id')).toThrow(/no-such-id/)
  })
})

describe('stdioLaunch', () => {
  const stdio = integration({
    auth: 'none',
    transport: { kind: 'stdio', command: '/usr/bin/tool', args: ['--serve', '--port', '0'], env: { LOG_LEVEL: 'info' }, secretEnv: ['API_KEY', 'OTHER_SECRET'] },
  })

  it('puts the secret variables into the environment, next to the plain ones, and never into the arguments', () => {
    const launch = stdioLaunch(stdio, reading({ 'env:API_KEY': TOKEN, 'env:OTHER_SECRET': 'other-SECRET' }))
    expect(launch).toEqual({ command: '/usr/bin/tool', args: ['--serve', '--port', '0'], env: { LOG_LEVEL: 'info', API_KEY: TOKEN, OTHER_SECRET: 'other-SECRET' } })
    expect(JSON.stringify([launch.command, ...launch.args])).not.toContain(TOKEN)
  })

  it('throws MissingSecretError naming the variable that is not kept', () => {
    expect(() => stdioLaunch(stdio, reading({ 'env:API_KEY': TOKEN }))).toThrow(MissingSecretError)
    expect(() => stdioLaunch(stdio, reading({ 'env:API_KEY': TOKEN }))).toThrow(/OTHER_SECRET/)
  })

  it('refuses an http Integration', () => {
    expect(() => stdioLaunch(integration({}), reading({}))).toThrow(/stdio/)
  })
})

describe('scrubServiceText', () => {
  it('hides each secret, its base64 form and anything shaped like a credential in what the service said', () => {
    const basic = Buffer.from(`me@example.test:${TOKEN}`, 'utf8').toString('base64')
    const text = scrubServiceText(`bad token ${TOKEN}; got Basic ${basic}; Authorization: Bearer abc.def`, [TOKEN, `me@example.test:${TOKEN}`])
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(basic)
    expect(text).not.toContain('abc.def')
    expect(text).toMatch(/^bad token/)
  })

  it('keeps a long answer short', () => {
    expect(scrubServiceText('x'.repeat(5_000), []).length).toBeLessThanOrEqual(400)
  })
})
