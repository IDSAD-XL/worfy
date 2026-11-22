// What a Linked machine may do with the Integrations of this Machine's Projects (worfy-integrations ticket 09; spec,
// «decided without the owner», 3; ADR-0111 item 8; ADR-0066). The `integrations` handlers run behind the link's
// adapter (src/main/link/ipc-adapter.ts) as the app's link serves them. Read only: the list and the statuses. Full
// access: on and off in a Project, the tools filter, «Available to Autopilot», the label, and Sign in — whose window
// opens here, on the Machine of the Project. Add integration, a token, Sign out, Remove and the Machine's own list are
// never open to a Linked machine, whatever its level: no secret crosses the link. No Electron; the OAuth service is the
// stub of test/fixtures/integrations/oauth-stub.ts, its sign-in window a stand-in that follows the stub's redirect.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { IntegrationOAuth, redirectOutcome, type OpenWindow } from '../../src/main/integrations/auth/oauth'
import { IntegrationStore } from '../../src/main/integrations/store'
import { createLinkIpc, LinkPeer, notOpenRefusal, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { settingsPath } from '../../src/main/projects/settings'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { startOAuthStub, type OAuthStub } from '../fixtures/integrations/oauth-stub'

vi.mock('electron', () => ({ app: { on: () => undefined } }))

const PROJECT = 'alpha-0000000a'

let scratch: string
let stub: OAuthStub
let store: IntegrationStore
let oauth: IntegrationOAuth
/** The Integrations a sign-in window opened for on this Machine. */
let windows: string[]
let peers: LinkPeer[]
let oauthId: string
let tokenId: string

const dataDir = (): string => join(scratch, 'projects', PROJECT)

const openWindow: OpenWindow = (request) => {
  windows.push(request.id)
  return {
    outcome: (async () => {
      const answer = await fetch(request.authorizationUrl, { redirect: 'manual' })
      const outcome = redirectOutcome(answer.headers.get('location') ?? '', request.id, request.state)
      if (outcome === null) throw new Error('no redirect')
      return outcome
    })(),
    close: () => undefined,
  }
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-linked-')))
  mkdirSync(dataDir(), { recursive: true })
  writeFileSync(settingsPath(dataDir()), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
  stub = await startOAuthStub()
  store = new IntegrationStore(join(scratch, 'integrations'))
  windows = []
  peers = []
  oauth = new IntegrationOAuth({ store, openWindow, clearPartition: async () => undefined })
  oauthId = store.add({ service: 'custom', label: 'Jira — client A', auth: 'oauth', transport: { kind: 'http', url: stub.url } }).id
  tokenId = store.add({ service: 'custom', label: 'Linear', auth: 'bearer', transport: { kind: 'http', url: stub.url } }).id
  store.setSecret(tokenId, 'access', 'tok-linear-0c4d88a1')
  store.setSignIn(tokenId, { account: null, site: null, at: '2026-11-20T09:00:00.000Z' })
})

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.close()
  await stub.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A call from a Linked machine with access `level`, served by this Machine's `integrations` handlers. */
async function linked(level: 'read' | 'all'): Promise<(channel: string, input?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>> {
  const module = integrationsHandlers({
    store: () => store,
    projects: { list: () => [{ id: PROJECT, name: 'alpha' }], dataDir },
    oauth: () => oauth,
    closeConnections: async () => undefined,
    proxy: () => ({ serviceToolsOf: async () => [], status: () => null, clearStatus: () => undefined, retell: () => undefined }),
  })
  const adapter = await createLinkIpc({ modules: { './integrations.ts': async () => module }, isLinked: () => true })
  const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
  peer.setAccess(level)
  peers.push(peer)
  return (channel, input) => adapter.call(peer, channel, input, 'Studio') as Promise<{ ok: boolean; value?: unknown; error?: string }>
}

/** The calls that change a Project's use of an Integration, each with its input. */
const writes = (): [string, unknown][] => [
  ['integrations.setEnabled', { projectId: PROJECT, id: tokenId, enabled: false }],
  ['integrations.setTools', { projectId: PROJECT, id: tokenId, tools: 'read-only' }],
  ['integrations.setAutopilot', { projectId: PROJECT, id: tokenId, autopilot: true }],
  ['integrations.rename', { projectId: PROJECT, id: tokenId, label: 'Linear — client A' }],
  ['integrations.signIn', { projectId: PROJECT, id: oauthId }],
]

/** The calls that carry a secret or change the Machine's own list: never over the link. */
const local = (): [string, unknown][] => [
  ['integrations.add', { projectId: PROJECT, service: 'custom', label: 'Notion', auth: 'bearer', transport: { kind: 'http', url: stub.url } }],
  ['integrations.setSecret', { id: tokenId, part: 'access', value: 'tok-from-the-link' }],
  ['integrations.remove', { projectId: PROJECT, id: tokenId, confirmed: true }],
  ['integrations.signOut', { id: oauthId }],
  ['integrations.machine', undefined],
  ['integrations.cleanUp', undefined],
  ['integrations.ghOffer', { projectId: PROJECT }],
  ['integrations.ghSignIn', { projectId: PROJECT, id: tokenId }],
]

const machineFiles = (): string[] => [join(scratch, 'integrations', 'integrations.json'), join(scratch, 'integrations', 'secrets.json'), settingsPath(dataDir())].map((file) => readFileSync(file, 'utf8'))

describe('a Linked machine with Read only', () => {
  it('reads the list and the statuses of the Project`s Integrations', async () => {
    const call = await linked('read')
    await linked('all').then((full) => full('integrations.setEnabled', { projectId: PROJECT, id: tokenId, enabled: true }))
    const list = await call('integrations.list', { projectId: PROJECT })
    expect(list.ok).toBe(true)
    expect((list.value as { items: { integration: { id: string } }[] }).items.map((item) => item.integration.id)).toEqual([oauthId, tokenId])
    const status = await call('integrations.status', { projectId: PROJECT })
    expect(status).toEqual({ ok: true, value: { statuses: [{ id: tokenId, status: { state: 'signed-in' } }] } })
    expect(JSON.stringify([list, status])).not.toContain('tok-linear-0c4d88a1')
  })

  it('changes nothing: every write is refused as read-only, and no window opens', async () => {
    const call = await linked('read')
    const before = machineFiles()
    for (const [channel, input] of writes()) expect(await call(channel, input)).toEqual({ ok: false, error: readOnlyRefusal('Studio') })
    expect(machineFiles()).toEqual(before)
    expect(windows).toEqual([])
    expect(stub.registrations).toEqual([])
  })
})

describe('a Linked machine with Full access', () => {
  it('turns an Integration on and off, sets its filter, «Available to Autopilot» and its label', async () => {
    const call = await linked('all')
    for (const [channel, input] of writes().filter(([name]) => name !== 'integrations.signIn')) expect((await call(channel, input)).ok).toBe(true)
    const settings = JSON.parse(readFileSync(settingsPath(dataDir()), 'utf8')) as { integrations: unknown[] }
    expect(settings.integrations).toEqual([{ id: tokenId, enabled: false, tools: 'read-only', autopilot: true }])
    expect(store.get(tokenId)?.label).toBe('Linear — client A')
  })

  it('signs in on the Machine of the Project: the window opens here, and the answer carries no token', async () => {
    const call = await linked('all')
    const answer = await call('integrations.signIn', { projectId: PROJECT, id: oauthId })
    expect(answer.ok).toBe(true)
    expect(windows).toEqual([oauthId])
    expect(store.hasSecret(oauthId, 'access')).toBe(true)
    expect(JSON.stringify(answer)).not.toContain(store.secret(oauthId, 'access') ?? 'none')
  })
})

describe('at any level', () => {
  it('Add integration, a token, Sign out, Remove and the Machine`s list are not open to a Linked machine', async () => {
    for (const level of ['read', 'all'] as const) {
      const call = await linked(level)
      const before = machineFiles()
      for (const [channel, input] of local()) expect(await call(channel, input)).toEqual({ ok: false, error: notOpenRefusal(channel) })
      expect(machineFiles()).toEqual(before)
    }
    expect(store.secret(tokenId, 'access')).toBe('tok-linear-0c4d88a1')
    expect(store.list().map((integration) => integration.id)).toEqual([oauthId, tokenId])
  })
})
