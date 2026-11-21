// Sign-in with OAuth (worfy-integrations ticket 05; ADR-0111 item 4) against the OAuth stub of
// test/fixtures/integrations/oauth-stub.ts — an MCP server and its authorization server on 127.0.0.1 that rotates the
// refresh token on every refresh, as Atlassian and Linear did in the live step of ticket 01's spike. The sign-in
// window is windowOpener over a stand-in of Electron whose page follows the service's redirects, so the request hook
// of the real window code catches the redirect. Through the proxy (src/main/integrations/proxy.ts) a Session's tool
// call meets an expired token, a refresh and a refused refresh. No real service, no real token, no Electron.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerModule } from '../../src/main/ipc/index'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { IntegrationOAuth, partitionOf, windowOpener, type OpenWindow, type WindowElectron } from '../../src/main/integrations/auth/oauth'
import { IntegrationProxy, signInNeeded } from '../../src/main/integrations/proxy'
import { INTEGRATION_SECRETS_FILE, IntegrationStore } from '../../src/main/integrations/store'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { settingsPath } from '../../src/main/projects/settings'
import { claudeMcpServer } from '../../src/main/vendors/claude/mcp'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { startOAuthStub, type OAuthStub } from '../fixtures/integrations/oauth-stub'

// The module's default export subscribes to the app's quit (ticket 06): Electron's app, which a test has not.
vi.mock('electron', () => ({ app: { on: () => undefined } }))

let root: string
let data: string
let stub: OAuthStub
let store: IntegrationStore
let proxy: IntegrationProxy
let oauth: IntegrationOAuth
let clients: Client[]
let logged: string[]
/** The partitions sign-in windows opened on, and the ones Sign out cleared. */
let windows: string[]
let cleared: string[]
/** Every access and refresh token the store kept at some point: what must not leak. */
let seen: Set<string>

/**
 * A stand-in of Electron's session and BrowserWindow: loadURL follows the page's redirects as a browser does and asks
 * the partition's request hook before each one; a cancelled request stops there.
 */
function fakeElectron(): WindowElectron {
  const hooks = new Map<string, ((details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void) | null>()
  return {
    session: { fromPartition: (partition) => ({ webRequest: { onBeforeRequest: (listener) => void hooks.set(partition, listener) } }) },
    BrowserWindow: class {
      private destroyed = false
      readonly webContents = {}
      constructor(private readonly options: Record<string, unknown>) {
        windows.push((options.webPreferences as { partition: string }).partition)
      }
      async loadURL(url: string): Promise<void> {
        const partition = (this.options.webPreferences as { partition: string }).partition
        let next = url
        for (let hop = 0; hop < 5; hop++) {
          const hook = hooks.get(partition)
          const cancelled = await new Promise<boolean>((resolve) => (hook === null || hook === undefined ? resolve(false) : hook({ url: next }, (response) => resolve(response.cancel === true))))
          if (cancelled) throw new Error('ERR_BLOCKED_BY_CLIENT')
          const answer = await fetch(next, { redirect: 'manual' })
          const location = answer.headers.get('location')
          if (location === null) return
          next = new URL(location, next).toString()
        }
      }
      on(): void {}
      isDestroyed(): boolean {
        return this.destroyed
      }
      destroy(): void {
        this.destroyed = true
      }
    },
  }
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-oauth-')))
  data = join(root, 'worfy-data')
  stub = await startOAuthStub()
  store = new IntegrationStore(join(data, 'integrations'))
  windows = []
  cleared = []
  clients = []
  seen = new Set()
  const openWindow: OpenWindow = windowOpener(fakeElectron())
  oauth = new IntegrationOAuth({
    store,
    openWindow,
    clearPartition: async (partition) => void cleared.push(partition),
    scopes: () => ['read', 'write'],
  })
  proxy = new IntegrationProxy({ store, oauth: (integration) => oauth.transport(integration) })
  logged = []
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    })
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const client of clients) await client.close()
  await proxy.close()
  await stub.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A custom server on the stub's address that signs in with OAuth. */
function addOAuth(label: string): string {
  return store.add({ service: 'custom', label, auth: 'oauth', transport: { kind: 'http', url: stub.url } }).id
}

/** The secrets of the Machine's secret store, by key; every token in it is remembered as one that must not leak. */
function secrets(): Record<string, string> {
  const kept = (JSON.parse(readFileSync(join(data, 'integrations', INTEGRATION_SECRETS_FILE), 'utf8')) as { secrets: Record<string, string> }).secrets
  for (const [key, value] of Object.entries(kept)) if (key.endsWith(':access') || key.endsWith(':refresh')) seen.add(value)
  return kept
}

/** One Session's server of an Integration, as Claude Code meets it (as integrations-proxy.test.ts builds it). */
async function session(id: string, name: string): Promise<Client> {
  const server = await claudeMcpServer(proxy.sessionServer({ id, name, tools: 'all' }))
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  await (server.instance as unknown as { connect(transport: InMemoryTransport): Promise<void> }).connect(theirs)
  const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
  await client.connect(ours)
  clients.push(client)
  return client
}

const textOf = (result: unknown): string =>
  (((result as { content?: unknown }).content ?? []) as { type: string; text?: string }[])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')

const whoami = (client: Client) => client.callTool({ name: 'whoami', arguments: {} })

describe('sign-in with OAuth', () => {
  it('discovers the service, registers once per Integration, sends PKCE S256 and the resource, and keeps the tokens under <id>:… keys', async () => {
    const id = addOAuth('Acme — client A')
    const signIn = await oauth.signIn(id)
    expect(signIn).toMatchObject({ account: null, site: null })
    expect(store.get(id)?.signIn?.at).toBe(signIn.at)

    expect(stub.registrations).toHaveLength(1)
    // The catalogue's scope, not the four the resource metadata lists.
    expect(stub.registrations[0]).toMatchObject({ scope: 'read write', redirectUris: [`http://127.0.0.1/worfy-oauth/${id}`] })
    expect(stub.authorizations).toEqual([
      expect.objectContaining({ clientId: 'client-1', codeChallengeMethod: 'S256', resource: stub.url, scope: 'read write', redirectUri: `http://127.0.0.1/worfy-oauth/${id}` }),
    ])
    expect(stub.authorizations[0]?.state).toMatch(/^[\w-]{16,}$/u)
    expect(stub.tokenRequests).toEqual([{ grant: 'authorization_code', resource: stub.url, verifierMatched: true, outcome: 'issued' }])

    const kept = secrets()
    expect(Object.keys(kept).sort()).toEqual([`${id}:access`, `${id}:client`, `${id}:refresh`])
    expect(JSON.parse(kept[`${id}:client`] ?? '{}')).toMatchObject({ client_id: 'client-1', issuer: stub.origin })
    expect(stub.honours(kept[`${id}:access`] ?? '')).toBe(true)
    expect(stub.honours(kept[`${id}:refresh`] ?? '')).toBe(true)
    expect(windows).toEqual([partitionOf(id)])

    // A second sign-in of the same Integration registers no other client, and replaces the tokens.
    await oauth.signIn(id)
    expect(stub.registrations).toHaveLength(1)
    expect(secrets()[`${id}:access`]).not.toBe(kept[`${id}:access`])

    const client = await session(id, 'acme-client-a')
    expect(textOf(await whoami(client))).toBe('dataset client-1')
  })

  it('in the system browser: the loopback redirect on a random port signs in, without a window', async () => {
    const id = addOAuth('Acme — client A')
    const opened: string[] = []
    const browser = new IntegrationOAuth({
      store,
      scopes: () => [],
      openWindow: () => {
        throw new Error('no window for the system browser')
      },
      openExternal: async (url) => {
        opened.push(url)
        // The browser follows the service's redirect to the loopback listener.
        const location = (await fetch(url, { redirect: 'manual' })).headers.get('location') ?? ''
        void fetch(location).then((answer) => answer.text())
      },
    })
    await browser.signIn(id, { via: 'browser' })
    expect(opened).toHaveLength(1)
    expect(stub.authorizations[0]?.redirectUri).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/worfy-oauth/${id}$`, 'u'))
    // No scope of the catalogue: the scopes the resource metadata lists.
    expect(stub.authorizations[0]?.scope).toBe('read write delete admin')
    expect(stub.tokenRequests.map((entry) => entry.outcome)).toEqual(['issued'])
    expect(windows).toEqual([])
  })

  it('refuses a redirect that brings the service’s refusal, and keeps no token', async () => {
    const id = addOAuth('Acme — client A')
    const refusing = new IntegrationOAuth({
      store,
      openWindow: () => ({ outcome: Promise.resolve({ error: 'access_denied' }), close: () => undefined }),
    })
    await expect(refusing.signIn(id)).rejects.toThrow(/Acme — client A: the service did not sign you in: access_denied/u)
    expect(store.hasSecret(id, 'access')).toBe(false)
    expect(store.get(id)?.signIn).toBeNull()
  })
})

describe('an expired access token, through the proxy', () => {
  it('is refreshed without a Restart of the Session: the next call goes through, ten calls at once make one refresh', async () => {
    const id = addOAuth('Acme — client A')
    await oauth.signIn(id)
    const client = await session(id, 'acme-client-a')
    expect(textOf(await whoami(client))).toBe('dataset client-1')

    stub.expireAccessTokens()
    const one = await whoami(client)
    expect(one.isError).not.toBe(true)
    expect(textOf(one)).toBe('dataset client-1')
    expect(stub.refreshes()).toBe(1)

    for (const round of [2, 3]) {
      stub.expireAccessTokens()
      const answers = await Promise.all(Array.from({ length: 10 }, () => whoami(client)))
      expect(answers.filter((answer) => answer.isError !== true && textOf(answer) === 'dataset client-1')).toHaveLength(10)
      expect(stub.refreshes()).toBe(round)
    }
    // Every refresh went out with a refresh token the service still honoured: none was spent twice.
    expect(stub.tokenRequests.filter((entry) => entry.grant === 'refresh_token').map((entry) => entry.outcome)).toEqual(['issued', 'issued', 'issued'])
    expect(stub.honours(secrets()[`${id}:refresh`] ?? '')).toBe(true)
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
    // A refreshed token keeps the connection: no call ran on a connection retired under it.
    expect(stub.initializes()).toBe(1)
  })

  it('a refused refresh answers «Sign-in needed: <label>…» with isError, sets needs-sign-in, and asks the service once', async () => {
    const id = addOAuth('Acme — client A')
    await oauth.signIn(id)
    const client = await session(id, 'acme-client-a')
    expect(textOf(await whoami(client))).toBe('dataset client-1')

    stub.expireAccessTokens()
    stub.expireRefreshTokens()
    const answers = await Promise.all(Array.from({ length: 10 }, () => whoami(client)))
    for (const answer of answers) {
      expect(answer.isError).toBe(true)
      expect(textOf(answer)).toBe(signInNeeded('Acme — client A'))
    }
    expect(stub.refreshes()).toBe(1)
    expect(proxy.status(id)?.status).toEqual({ state: 'needs-sign-in' })
    // The package threw the refused tokens away; the registered client stays for the next sign-in.
    expect(store.hasSecret(id, 'access')).toBe(false)
    expect(store.hasSecret(id, 'client')).toBe(true)
    // No sign-in window opened behind the Session's back.
    expect(windows).toEqual([partitionOf(id)])
    expect(stub.registrations).toHaveLength(1)
  })

  it('an Integration never signed in answers «Sign-in needed» without asking the service', async () => {
    const id = addOAuth('Acme — client A')
    const client = await session(id, 'acme-client-a')
    // The Session's tool list is refused as a call is (ticket 06): the service has never listed its tools.
    await expect(whoami(client)).rejects.toThrow(signInNeeded('Acme — client A'))
    expect(stub.registrations).toEqual([])
    expect(stub.tokenRequests).toEqual([])
  })
})

describe('two Integrations on one address', () => {
  it('have two client ids, two partitions and each its own tokens', async () => {
    const a = addOAuth('Acme — client A')
    const b = addOAuth('Acme — client B')
    await oauth.signIn(a)
    await oauth.signIn(b)
    expect(stub.registrations.map((entry) => entry.clientId)).toEqual(['client-1', 'client-2'])
    expect(windows).toEqual([partitionOf(a), partitionOf(b)])
    expect(partitionOf(a)).not.toBe(partitionOf(b))
    const kept = secrets()
    expect(JSON.parse(kept[`${a}:client`] ?? '{}').client_id).toBe('client-1')
    expect(JSON.parse(kept[`${b}:client`] ?? '{}').client_id).toBe('client-2')
    expect(kept[`${a}:access`]).not.toBe(kept[`${b}:access`])
    expect(kept[`${a}:refresh`]).not.toBe(kept[`${b}:refresh`])

    const first = await session(a, 'acme-client-a')
    const second = await session(b, 'acme-client-b')
    expect(textOf(await whoami(first))).toBe('dataset client-1')
    expect(textOf(await whoami(second))).toBe('dataset client-2')
    // A refresh of one leaves the other's tokens alone.
    stub.expireAccessTokens()
    expect(textOf(await whoami(first))).toBe('dataset client-1')
    expect(secrets()[`${b}:refresh`]).toBe(kept[`${b}:refresh`])
  })
})

/** Every file under `dir` but the secrets file, with its text. */
function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === INTEGRATION_SECRETS_FILE) continue
    const path = join(entry.parentPath, entry.name)
    out[relative(dir, path)] = readFileSync(path, 'utf8')
  }
  return out
}

describe('Sign out', () => {
  it('revokes the tokens at the service, removes every <id>:* key and clears the partition; no token is anywhere else', async () => {
    const id = addOAuth('Acme — client A')
    const other = addOAuth('Acme — client B')
    await oauth.signIn(id)
    secrets()
    await oauth.signIn(other)
    secrets()
    const client = await session(id, 'acme-client-a')
    stub.expireAccessTokens()
    expect(textOf(await whoami(client))).toBe('dataset client-1')
    const before = secrets()
    const access = before[`${id}:access`] ?? ''
    const refresh = before[`${id}:refresh`] ?? ''

    expect(await oauth.signOut(id)).toEqual({ revoked: true })
    expect(stub.revocations).toEqual([
      { hint: 'refresh_token', known: true },
      { hint: 'access_token', known: true },
    ])
    expect(stub.honours(access)).toBe(false)
    expect(stub.honours(refresh)).toBe(false)
    const after = secrets()
    expect(Object.keys(after).filter((key) => key.startsWith(`${id}:`))).toEqual([])
    expect(Object.keys(after).filter((key) => key.startsWith(`${other}:`)).sort()).toEqual([`${other}:access`, `${other}:client`, `${other}:refresh`])
    expect(store.get(id)?.signIn).toBeNull()
    expect(cleared).toEqual([partitionOf(id)])
    // The Session's next call needs a sign-in, without asking the service for one.
    const answer = await whoami(client)
    expect(textOf(answer)).toBe(signInNeeded('Acme — client A'))

    expect(seen.size).toBe(6)
    for (const [file, text] of Object.entries(filesOf(data))) {
      for (const token of seen) expect(text, file).not.toContain(token)
    }
    expect(filesOf(data)).toHaveProperty(['integrations/integrations.json'])
    for (const line of logged) for (const token of seen) expect(line).not.toContain(token)
  })

  it('without a revocation endpoint still removes the keys and clears the partition', async () => {
    await stub.close()
    stub = await startOAuthStub({ revocation: false })
    const id = addOAuth('Acme — client A')
    await oauth.signIn(id)
    expect(await oauth.signOut(id)).toEqual({ revoked: false })
    expect(stub.revocations).toEqual([])
    expect(Object.keys(secrets()).filter((key) => key.startsWith(`${id}:`))).toEqual([])
    expect(cleared).toEqual([partitionOf(id)])
  })
})

describe('integrations.signIn', () => {
  const peers: LinkPeer[] = []

  afterEach(() => {
    for (const peer of peers.splice(0)) peer.close()
  })

  function handlers(): HandlerModule {
    const projects = [{ id: 'p1', name: 'One' }]
    const dataDir = (projectId: string): string => join(data, 'projects', projectId)
    mkdirSync(dataDir('p1'), { recursive: true })
    writeFileSync(settingsPath(dataDir('p1')), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
    return integrationsHandlers({ store: () => store, projects: { list: () => projects, dataDir }, oauth: () => oauth, closeConnections: async () => undefined })
  }

  async function linked(level: 'read' | 'all'): Promise<(channel: string, input: unknown) => Promise<unknown>> {
    const module = handlers()
    const adapter = await createLinkIpc({ modules: { './integrations.ts': async () => module }, isLinked: () => true })
    const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
    peer.setAccess(level)
    peers.push(peer)
    return (channel, input) => adapter.call(peer, channel, input, 'Studio')
  }

  it('from a Linked machine with Read only is refused, and no window opens', async () => {
    const id = addOAuth('Acme — client A')
    const call = await linked('read')
    expect(await call('integrations.signIn', { projectId: 'p1', id })).toEqual({ ok: false, error: readOnlyRefusal('Studio') })
    expect(windows).toEqual([])
    expect(stub.registrations).toEqual([])
  })

  it('from a Linked machine with Full access signs in on this Machine, and the answer carries no token', async () => {
    const id = addOAuth('Acme — client A')
    const call = await linked('all')
    const answer = (await call('integrations.signIn', { projectId: 'p1', id })) as { ok: boolean; value: { signIn: { account: null; at: string } } }
    expect(answer.ok).toBe(true)
    expect(answer.value.signIn).toMatchObject({ account: null, site: null })
    expect(windows).toEqual([partitionOf(id)])
    for (const token of Object.values(secrets())) expect(JSON.stringify(answer)).not.toContain(token)
  })

  it('refuses an Integration that does not sign in with OAuth', async () => {
    const id = store.add({ service: 'custom', label: 'Token one', auth: 'bearer', transport: { kind: 'http', url: stub.url } }).id
    const module = handlers()
    const handler = module.find((entry) => entry.channel.name === 'integrations.signIn')
    await expect(handler?.handle(handler.channel.input.parse({ projectId: 'p1', id }), { event: {} as never })).rejects.toThrow(/does not sign in with OAuth/u)
    expect(stub.registrations).toEqual([])
  })
})
