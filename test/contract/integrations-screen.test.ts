// The channels the Integrations screen adds (worfy-integrations ticket 08; ADR-0111), against the proxy of ticket 06 and
// the service stub of test/fixtures/integrations/service-stub.ts on 127.0.0.1 — no real service, no real token.
//
// - integrations.tools answers the service's whole list, before the Project's filter, with each tool's size. The
//   price the screen shows (src/renderer/integrations/cost.ts) is counted AFTER the filter: for every filter it is
//   the proxy's toolsCost of the very tools a Session's server of the Project lists. An Integration without its
//   secret starts nothing.
// - integrations.signOut, integrations.machine (where each Integration is used, and the entries of Integrations the
//   Machine no longer has), integrations.cleanUp, integrations.remove without a Project, and the gh account's token
//   through integrations.ghOffer and integrations.ghSignIn, with a 503 or 429 on a new token.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GhRunner } from '../../src/main/github/prs'
import { filterTools, IntegrationProxy, toolsCost, type ServiceTool } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { readProjectIntegrations, settingsPath, writeProjectIntegrations } from '../../src/main/projects/settings'
import { costOf, filtered } from '../../src/renderer/integrations/cost'
import type { IntegrationTools } from '../../src/shared/integrations/types'
import type { IntegrationToolInfo } from '../../src/shared/ipc/integrations'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { startHttpStub, type HttpStub } from '../fixtures/integrations/http-stub'
import { startServiceStub, STUB_TOOLS, type ServiceStub } from '../fixtures/integrations/service-stub'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({ app: { on: () => undefined } }))

const TOKEN_A = 'tok-SCREEN-A-SECRET-0123456789'
const TOKEN_B = 'tok-SCREEN-B-SECRET-9876543210'
const GH_TOKEN = 'gh-fake-SCREEN-token-1111'

let root: string
let stub: ServiceStub
let store: IntegrationStore
let proxy: IntegrationProxy
let closed: (string | undefined)[]

const PROJECTS = [
  { id: 'p1', name: 'One', path: '/work/one' },
  { id: 'p2', name: 'Two', path: '/work/two' },
]
const dataDir = (id: string): string => join(root, 'worfy-data', 'projects', id)

const gh: GhRunner = async (args) => {
  if (args.join(' ') === 'auth token -u alice') return `${GH_TOKEN}\n`
  if (args.join(' ') === 'auth status --json hosts') return JSON.stringify({ hosts: { 'github.com': [{ login: 'alice', scopes: 'repo' }] } })
  throw new Error(`unexpected gh ${args.join(' ')}`)
}

function handlers(account: string | null = 'alice') {
  const module = integrationsHandlers({
    store: () => store,
    projects: { list: () => PROJECTS, dataDir },
    proxy: () => proxy,
    closeConnections: async (id) => void closed.push(id),
    gh: () => ({ account: () => Promise.resolve(account), run: gh }),
  })
  return async (channel: string, input?: unknown): Promise<unknown> => {
    const handler = module.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler for ${channel}`)
    return handler.handle(handler.channel.input.parse(input), { event: {} as never })
  }
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-screen-')))
  stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha', [TOKEN_B]: 'beta' } })
  store = new IntegrationStore(join(root, 'worfy-data', 'integrations'))
  proxy = new IntegrationProxy({ store })
  closed = []
  for (const project of PROJECTS) {
    mkdirSync(dataDir(project.id), { recursive: true })
    writeFileSync(settingsPath(dataDir(project.id)), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
  }
})

afterEach(async () => {
  await proxy.close()
  await stub.close()
  removeTestTree(root)
})

/** A custom server on the stub, signed in with `token`, added from Project `projectId`. */
async function added(call: Awaited<ReturnType<typeof handlers>>, label: string, token: string | null, projectId = 'p1'): Promise<string> {
  const { integration } = (await call('integrations.add', { projectId, service: 'custom', label, auth: 'bearer', transport: { kind: 'http', url: stub.url } })) as { integration: { id: string } }
  if (token !== null) await call('integrations.setSecret', { id: integration.id, part: 'access', value: token })
  return integration.id
}

describe('integrations.tools and the price of the tools', () => {
  it('answers the whole list before the filter, and the price after the filter is what the Sessions of the Project get', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A)
    await call('integrations.setTools', { projectId: 'p1', id, tools: 'read-only' })
    const answer = (await call('integrations.tools', { projectId: 'p1', id })) as { status: unknown; tools: IntegrationToolInfo[] }
    expect(answer.status).toEqual({ state: 'signed-in' })
    // Before the filter: every tool of the service, the read-only filter of the Project notwithstanding.
    expect(answer.tools.map((tool) => tool.name)).toEqual(STUB_TOOLS.map((tool) => tool.name))
    expect(answer.tools.map((tool) => tool.readOnly)).toEqual([true, true, false, null, null, null])
    expect(JSON.stringify(answer)).not.toContain(TOKEN_A)

    const service = STUB_TOOLS as unknown as ServiceTool[]
    const filters: IntegrationTools[] = ['all', 'read-only', ['whoami', 'create_item']]
    for (const filter of filters) {
      // The screen's count of `filter` is the proxy's toolsCost of the same tools…
      expect(costOf(filtered(answer.tools, filter))).toEqual(toolsCost(filterTools(service, filter)))
      // …and those are the tools a Session's server of the Project lists with that filter.
      const listed = await proxy.sessionServer({ id, name: 'stub-a', tools: filter }).listTools!()
      expect(listed.map((tool) => tool.name)).toEqual(filtered(answer.tools, filter).map((tool) => tool.name))
    }
    expect(costOf(filtered(answer.tools, 'read-only')).count).toBeLessThan(costOf(answer.tools).count)
  })

  it('asks the service nothing for an Integration without its secret', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — none', null)
    expect(await call('integrations.tools', { projectId: 'p1', id })).toEqual({ status: { state: 'needs-sign-in' }, tools: null, hidden: [] })
    expect(stub.log).toEqual([])
  })

  it('asks the service nothing for a token kept but never checked: the sign-in comes first', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — unchecked', null)
    // Kept without the check of setSecret, as a sign-in cut short leaves it.
    store.setSecret(id, 'access', TOKEN_A)
    expect(await call('integrations.tools', { projectId: 'p1', id })).toEqual({ status: { state: 'needs-sign-in' }, tools: null, hidden: [] })
    expect(stub.log).toEqual([])
  })

  it('a token the service refuses gives needs-sign-in and no tools', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A)
    stub.revoke(TOKEN_A)
    const answer = (await call('integrations.tools', { projectId: 'p1', id })) as { status: { state: string }; tools: unknown }
    expect(answer.status.state).toBe('needs-sign-in')
    expect(answer.tools).toBeNull()
  })

  it('two Integrations on one address list their tools each with its own token', async () => {
    const call = handlers()
    const a = await added(call, 'Stub — A', TOKEN_A, 'p1')
    const b = await added(call, 'Stub — B', TOKEN_B, 'p2')
    await call('integrations.tools', { projectId: 'p1', id: a })
    await call('integrations.tools', { projectId: 'p2', id: b })
    expect(stub.log.filter((entry) => entry.method === 'tools/list').map((entry) => entry.dataset)).toEqual(['alpha', 'beta'])
  })
})

describe('integrations.signOut', () => {
  it('deletes the secret, needs sign-in afterwards and closes the connection', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A)
    expect(await call('integrations.signOut', { id })).toEqual({ status: { state: 'needs-sign-in' } })
    expect(store.hasSecret(id, 'access')).toBe(false)
    expect(store.get(id)?.signIn).toBeNull()
    expect(closed).toEqual([id])
  })
})

describe('the Machine’s Integrations: where each is used, and orphans', () => {
  it('names the Projects of each Integration; one no Project uses has none, and an entry the Machine lost is dangling until cleaned up', async () => {
    const call = handlers()
    const used = await added(call, 'Stub — A', TOKEN_A, 'p1')
    await call('integrations.setEnabled', { projectId: 'p2', id: used, enabled: false })
    const unused = await added(call, 'Stub — unused', TOKEN_B, 'p1')
    writeProjectIntegrations(dataDir('p1'), readProjectIntegrations(dataDir('p1')).filter((entry) => entry.id !== unused))
    // A Remove cut short after the store and before the Projects: p2 still names an Integration that is gone.
    writeProjectIntegrations(dataDir('p2'), [...readProjectIntegrations(dataDir('p2')), { id: 'gone0001', enabled: true, tools: 'all', autopilot: false }])

    const machine = (await call('integrations.machine')) as { items: { integration: { id: string }; status: unknown; projects: unknown[] }[]; dangling: unknown[] }
    expect(machine.items.map((item) => [item.integration.id, item.projects])).toEqual([
      [
        used,
        [
          { id: 'p1', name: 'One', enabled: true },
          { id: 'p2', name: 'Two', enabled: false },
        ],
      ],
      [unused, []],
    ])
    expect(machine.items.map((item) => item.status)).toEqual([{ state: 'signed-in' }, { state: 'signed-in' }])
    expect(machine.dangling).toEqual([{ projectId: 'p2', name: 'Two', count: 1 }])

    expect(await call('integrations.cleanUp')).toEqual({ removed: 1 })
    expect(readProjectIntegrations(dataDir('p2')).map((entry) => entry.id)).toEqual([used])
    expect(readProjectIntegrations(dataDir('p1')).map((entry) => entry.id)).toEqual([used])
    expect(((await call('integrations.machine')) as { dangling: unknown[] }).dangling).toEqual([])
    expect(await call('integrations.cleanUp')).toEqual({ removed: 0 })
  })

  it.each([
    ['damaged', '{"version": 1, "integrations": ['],
    ['of another version', '{"version": 99, "integrations": []}'],
  ])('a list of the Machine that could not be read (%s) names no orphan, and Clean up erases nothing', async (_kind, text) => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A, 'p1')
    await call('integrations.setTools', { projectId: 'p1', id, tools: 'read-only' })
    const before = readProjectIntegrations(dataDir('p1'))
    writeFileSync(join(root, 'worfy-data', 'integrations', 'integrations.json'), text)

    // The first read sets the file aside, so the Machine's list reads as empty from then on.
    for (let read = 0; read < 2; read++) expect(((await call('integrations.machine')) as { dangling: unknown[] }).dangling).toEqual([])
    expect(await call('integrations.cleanUp')).toEqual({ removed: 0 })
    expect(readProjectIntegrations(dataDir('p1'))).toEqual(before)
  })

  it('a new Integration after a damaged list was set aside still names no orphan: the old list may yet be put back', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A, 'p1')
    writeFileSync(join(root, 'worfy-data', 'integrations', 'integrations.json'), '{"version": 1, "integrations": [')
    await call('integrations.machine')
    // A new list is written beside the one set aside.
    const fresh = await added(call, 'Stub — B', TOKEN_B, 'p1')
    const machine = (await call('integrations.machine')) as { items: { integration: { id: string; label: string } }[]; dangling: unknown[] }
    // The Machine's Integrations still show, with Sign out and Remove: only the orphans wait for the old list.
    expect(machine.items.map((item) => [item.integration.id, item.integration.label])).toEqual([[fresh, 'Stub — B']])
    expect(machine.dangling).toEqual([])
    // Why Clean up waits (worfy-integrations ticket 09): the file set aside, by its name.
    expect((machine as unknown as { setAside: string | null }).setAside).toMatch(/^integrations\.json\.unreadable-/u)
    expect(await call('integrations.cleanUp')).toEqual({ removed: 0 })
    expect(readProjectIntegrations(dataDir('p1')).map((entry) => entry.id)).toContain(id)
  })

  it('a Machine with no list of Integrations at all names no orphan either', async () => {
    const call = handlers()
    writeProjectIntegrations(dataDir('p1'), [{ id: 'gone0001', enabled: true, tools: 'all', autopilot: false }])
    expect(((await call('integrations.machine')) as { dangling: unknown[] }).dangling).toEqual([])
    // Nothing was set aside: no line about one.
    expect(((await call('integrations.machine')) as { setAside: string | null }).setAside).toBeNull()
    expect(await call('integrations.cleanUp')).toEqual({ removed: 0 })
    expect(readProjectIntegrations(dataDir('p1')).map((entry) => entry.id)).toEqual(['gone0001'])
  })

  it('removes from Settings, without a Project: every Project that has it enabled asks for the confirmation first', async () => {
    const call = handlers()
    const id = await added(call, 'Stub — A', TOKEN_A, 'p1')
    await call('integrations.setEnabled', { projectId: 'p2', id, enabled: true })
    expect(await call('integrations.remove', { id })).toEqual({ status: 'confirm', projects: ['One', 'Two'] })
    expect(store.get(id)).toBeDefined()
    expect(await call('integrations.remove', { id, confirmed: true })).toEqual({ status: 'removed' })
    expect(store.get(id)).toBeUndefined()
    expect(readProjectIntegrations(dataDir('p1'))).toEqual([])
    expect(readProjectIntegrations(dataDir('p2'))).toEqual([])
  })
})

describe('the gh account’s token through the channels', () => {
  let http: HttpStub

  beforeEach(async () => {
    http = await startHttpStub({ bearer: { [TOKEN_A]: 'alpha', [GH_TOKEN]: 'gh' } })
  })
  afterEach(async () => {
    await http.close()
  })

  const github = async (call: Awaited<ReturnType<typeof handlers>>): Promise<string> => {
    const { integration } = (await call('integrations.add', { projectId: 'p1', service: 'custom', label: 'GitHub', auth: 'bearer', transport: { kind: 'http', url: http.url } })) as { integration: { id: string } }
    return integration.id
  }

  it('offers the account with its scopes, never the token; none without a GitHub account', async () => {
    const offer = (await handlers()('integrations.ghOffer', { projectId: 'p1' })) as { offer: { account: string; scopes: string[] } }
    expect(offer.offer).toMatchObject({ account: 'alice', scopes: ['repo'] })
    expect(JSON.stringify(offer)).not.toContain(GH_TOKEN)
    expect(await handlers(null)('integrations.ghOffer', { projectId: 'p1' })).toEqual({ offer: null })
  })

  it('signs in with a copy of the gh token', async () => {
    const call = handlers()
    const id = await github(call)
    expect(await call('integrations.ghSignIn', { projectId: 'p1', id })).toEqual({ status: { state: 'signed-in' } })
    expect(store.get(id)?.signIn?.account).toBe('alice')
  })

  it.each([503, 429])('a new gh token met with %s leaves no sign-in, and the status shows the error', async (code) => {
    const call = handlers()
    const id = await github(call)
    await call('integrations.setSecret', { id, part: 'access', value: TOKEN_A })
    expect(store.get(id)?.signIn).not.toBeNull()
    http.unavailable.set(GH_TOKEN, code)
    const answer = (await call('integrations.ghSignIn', { projectId: 'p1', id })) as { status: { state: string; message: string } }
    expect(answer.status.state).toBe('error')
    expect(answer.status.message).toContain(String(code))
    expect(answer.status.message).not.toContain(GH_TOKEN)
    expect(store.get(id)?.signIn).toBeNull()
    expect(await call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: answer.status }] })
  })
})
