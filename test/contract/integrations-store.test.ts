// The Integrations of a Machine and of its Projects (worfy-integrations ticket 03; ADR-0111): the list in
// <WORFY_DATA_DIR>/integrations/integrations.json with no secret in it, the secrets in integrations/secrets.json
// (0600 in a 0700 folder, as the link's secrets), the field `integrations` of a Project's settings.json, and the
// channels `integrations.*` as a Linked machine reaches them. Real folders, no Electron.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HandlerModule } from '../../src/main/ipc/index'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { IntegrationStore, LabelTakenError } from '../../src/main/integrations/store'
import { createLinkIpc, LinkPeer, notOpenRefusal, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { readProjectIntegrations, readProjectSettings, settingsPath, writeProjectIntegrations, writeProjectSettings } from '../../src/main/projects/settings'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { removeTestTree } from '../remove'

const SECRET = 'lin_api_THE-SECRET-VALUE-0123456789'
const REFRESH = 'refresh-THE-OTHER-SECRET-9876'
const ENV_SECRET = 'env-THIRD-SECRET-5555'

/** Every file under `dir` with its sha256, to tell that nothing in it changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[relative(dir, path)] = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  return out
}

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-')))
})

afterEach(() => {
  removeTestTree(root)
})

describe('the Machine store: integrations.json and secrets.json', () => {
  it('keeps the list without a secret and the secrets 0600 in a 0700 folder, under <id>:… keys', () => {
    const dir = join(root, 'integrations')
    const store = new IntegrationStore(dir)
    const linear = store.add({ service: 'linear', label: 'Linear — client A', auth: 'bearer' })
    const tool = store.add({
      service: 'custom',
      label: 'Local tool',
      auth: 'none',
      transport: { kind: 'stdio', command: 'my-mcp', args: ['--stdio'], env: { MODE: 'plain' }, secretEnv: ['API_KEY'] },
    })
    store.setSecret(linear.id, 'access', SECRET)
    store.setSecret(linear.id, 'refresh', REFRESH)
    store.setSecret(tool.id, 'env:API_KEY', ENV_SECRET)

    const list = readFileSync(join(dir, 'integrations.json'), 'utf8')
    for (const secret of [SECRET, REFRESH, ENV_SECRET]) expect(list).not.toContain(secret)
    expect(JSON.parse(list).integrations.map((entry: { label: string }) => entry.label)).toEqual(['Linear — client A', 'Local tool'])
    expect(linear.transport).toEqual({ kind: 'http', url: 'https://mcp.linear.app/mcp' })

    const secrets = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as { secrets: Record<string, string> }
    expect(secrets.secrets).toEqual({ [`${linear.id}:access`]: SECRET, [`${linear.id}:refresh`]: REFRESH, [`${tool.id}:env:API_KEY`]: ENV_SECRET })
    // On Windows a file has no POSIX mode: the folder is the user's own AppData (link-pairing.test.ts does the same).
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'secrets.json')).mode & 0o777).toBe(0o600)
      expect(statSync(dir).mode & 0o777).toBe(0o700)
    }
    // A store read anew from the files answers the same.
    const again = new IntegrationStore(dir)
    expect(again.list()).toEqual(store.list())
    expect(again.hasSecret(linear.id, 'access')).toBe(true)
    expect(again.hasSecret(tool.id, 'access')).toBe(false)
  })

  it('keeps a label unique on the Machine, without case and spaces around', () => {
    const store = new IntegrationStore(join(root, 'integrations'))
    const first = store.add({ service: 'atlassian', label: 'Jira — client A', auth: 'oauth' })
    expect(() => store.add({ service: 'linear', label: '  jira — CLIENT a ', auth: 'bearer' })).toThrow(LabelTakenError)
    const second = store.add({ service: 'atlassian', label: 'Jira — client B', auth: 'oauth' })
    expect(() => store.rename(second.id, 'JIRA — client a')).toThrow(LabelTakenError)
    expect(store.rename(first.id, 'jira — client a').label).toBe('jira — client a')
    expect(store.list().map((entry) => entry.label)).toEqual(['jira — client a', 'Jira — client B'])
    expect(first.id).not.toBe(second.id)
  })

  it('refuses a service the catalogue lacks, a way to sign in the service does not take, and a secret variable it does not name', () => {
    const store = new IntegrationStore(join(root, 'integrations'))
    expect(() => store.add({ service: 'slack', label: 'Slack', auth: 'oauth' })).toThrow(/slack/)
    expect(() => store.add({ service: 'github', label: 'GitHub', auth: 'oauth' })).toThrow(/oauth/)
    expect(() => store.add({ service: 'custom', label: 'Custom', auth: 'none' })).toThrow(/address or a command/)
    const tool = store.add({ service: 'custom', label: 'Tool', auth: 'none', transport: { kind: 'stdio', command: 'x', args: [], env: {}, secretEnv: ['A'] } })
    expect(() => store.setSecret(tool.id, 'env:B', 'v')).toThrow(/B/)
    expect(() => store.setSecret('no-such-id', 'access', 'v')).toThrow(/no-such-id/)
    expect(store.list()).toHaveLength(1)
  })

  it('removes every secret of an Integration with it', () => {
    const dir = join(root, 'integrations')
    const store = new IntegrationStore(dir)
    const tool = store.add({ service: 'custom', label: 'Tool', auth: 'bearer', transport: { kind: 'stdio', command: 'x', args: [], env: {}, secretEnv: ['A'] } })
    const kept = store.add({ service: 'linear', label: 'Linear', auth: 'bearer' })
    for (const part of ['access', 'refresh', 'client', 'env:A'] as const) store.setSecret(tool.id, part, `${SECRET}-${part}`)
    store.setSecret(kept.id, 'access', 'kept-secret')
    store.remove(tool.id)
    expect(store.list().map((entry) => entry.id)).toEqual([kept.id])
    const secrets = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as { secrets: Record<string, string> }
    expect(secrets.secrets).toEqual({ [`${kept.id}:access`]: 'kept-secret' })
  })

  it('survives a write cut short: a half-written temporary file changes nothing, and the next write goes through', () => {
    const dir = join(root, 'integrations')
    const store = new IntegrationStore(dir)
    const first = store.add({ service: 'linear', label: 'Linear', auth: 'bearer' })
    const before = readFileSync(join(dir, 'integrations.json'), 'utf8')
    // A crash between the write of the temporary file and its rename leaves this beside the list.
    writeFileSync(join(dir, `.integrations.json.${process.pid}.999.tmp`), '{"version":1,"integrations":[{"id":"half')
    const fresh = new IntegrationStore(dir)
    expect(fresh.list()).toEqual([first])
    expect(readFileSync(join(dir, 'integrations.json'), 'utf8')).toBe(before)
    fresh.add({ service: 'notion', label: 'Notion', auth: 'oauth' })
    expect(new IntegrationStore(dir).list().map((entry) => entry.label)).toEqual(['Linear', 'Notion'])
  })

  it('a secret that cannot be written leaves the list and the old secrets as they were, and the error names no secret', () => {
    const dir = join(root, 'integrations')
    const store = new IntegrationStore(dir)
    const linear = store.add({ service: 'linear', label: 'Linear', auth: 'bearer' })
    store.setSecret(linear.id, 'access', 'first-secret')
    const list = readFileSync(join(dir, 'integrations.json'), 'utf8')
    // A folder in the place of secrets.json: no system renames a file over it.
    unlinkSync(join(dir, 'secrets.json'))
    mkdirSync(join(dir, 'secrets.json'))
    let message = ''
    try {
      store.setSecret(linear.id, 'access', SECRET)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/secrets\.json/)
    expect(message).not.toContain(SECRET)
    expect(readFileSync(join(dir, 'integrations.json'), 'utf8')).toBe(list)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('the field `integrations` of a Project settings.json', () => {
  it('reads an old settings.json without the field as an empty list, and a save of Project settings keeps the field', () => {
    const data = join(root, 'data', 'p1')
    mkdirSync(data, { recursive: true })
    writeFileSync(settingsPath(data), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
    expect(readProjectIntegrations(data)).toEqual([])
    writeProjectIntegrations(data, [{ id: 'abcd1234', enabled: true, tools: 'read-only', autopilot: false }])
    expect(readProjectIntegrations(data)).toEqual([{ id: 'abcd1234', enabled: true, tools: 'read-only', autopilot: false }])
    expect(JSON.parse(readFileSync(settingsPath(data), 'utf8')).integrations).toEqual([{ id: 'abcd1234', enabled: true, tools: 'read-only', autopilot: false }])
    // The dialog's Save does not send the field, and a Linked machine of an older build cannot: it stays.
    const dialog = { ...readProjectSettings(data, 'plugin'), terminalShell: 'powershell' as const, defaultVendor: 'codex' as const }
    delete dialog.integrations
    writeProjectSettings(data, dialog, 'plugin')
    expect(readProjectIntegrations(data)).toEqual([{ id: 'abcd1234', enabled: true, tools: 'read-only', autopilot: false }])
    expect(readProjectSettings(data, 'plugin').defaultVendor).toBe('codex')
    // An input that names the field does not write it either: only writeProjectIntegrations does.
    writeProjectSettings(data, { ...readProjectSettings(data, 'plugin'), integrations: [] }, 'plugin')
    expect(readProjectIntegrations(data)).toEqual([{ id: 'abcd1234', enabled: true, tools: 'read-only', autopilot: false }])
  })

  it('reads a broken field as an empty list and keeps the rest of the settings', () => {
    const data = join(root, 'data', 'p2')
    mkdirSync(data, { recursive: true })
    writeFileSync(settingsPath(data), `${JSON.stringify({ ...defaultProjectSettings('plugin'), defaultVendor: 'codex', integrations: [{ id: 'x' }] })}\n`)
    expect(readProjectIntegrations(data)).toEqual([])
    expect(readProjectSettings(data, 'plugin').defaultVendor).toBe('codex')
  })
})

interface Bench {
  module: HandlerModule
  store: IntegrationStore
  dataDir: (id: string) => string
  call: (channel: string, input: unknown) => Promise<unknown>
}

function bench(): Bench {
  const store = new IntegrationStore(join(root, 'worfy-data', 'integrations'))
  const projects = [
    { id: 'p1', name: 'One' },
    { id: 'p2', name: 'Two' },
  ]
  const dataDir = (id: string): string => join(root, 'worfy-data', 'projects', id)
  for (const project of projects) {
    mkdirSync(dataDir(project.id), { recursive: true })
    writeFileSync(settingsPath(dataDir(project.id)), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
  }
  // The token check of ticket 04 asks the service; these Integrations are on the catalogue's real addresses, so a
  // stand-in lets every token in and no request leaves the machine (test/contract/integrations-token-auth.test.ts
  // checks against a stub server).
  const module = integrationsHandlers({ store: () => store, projects: { list: () => projects, dataDir }, check: async () => ({ state: 'signed-in' }) })
  const call = async (channel: string, input: unknown): Promise<unknown> => {
    const handler = module.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler for ${channel}`)
    return handler.handle(handler.channel.input.parse(input), { event: {} as never })
  }
  return { module, store, dataDir, call }
}

describe('the channels integrations.*', () => {
  it('add enables the new Integration in its Project; another Project enables it with a tick; nothing outside the data folder changes', async () => {
    const repo = join(root, 'repo')
    const home = join(root, 'claude-home')
    mkdirSync(join(repo, '.git'), { recursive: true })
    writeFileSync(join(repo, '.mcp.json'), '{"mcpServers":{}}\n')
    mkdirSync(join(home, 'worfy-harness', 'projects', 'p'), { recursive: true })
    writeFileSync(join(home, 'worfy-harness', 'projects', 'p', 'profile.json'), '{"schema":2,"mcp":{"allowed":["qmd"]}}\n')
    writeFileSync(join(home, '.claude.json'), '{"mcpServers":{}}\n')
    const before = { repo: snapshot(repo), home: snapshot(home) }

    const { call, dataDir, store } = bench()
    const added = (await call('integrations.add', { projectId: 'p1', service: 'linear', label: 'Linear — client A', auth: 'bearer' })) as { integration: { id: string } }
    const id = added.integration.id
    await call('integrations.setSecret', { id, part: 'access', value: SECRET })
    expect(readProjectIntegrations(dataDir('p1'))).toEqual([{ id, enabled: true, tools: 'all', autopilot: false }])
    expect(readProjectIntegrations(dataDir('p2'))).toEqual([])

    await call('integrations.setEnabled', { projectId: 'p2', id, enabled: true })
    await call('integrations.setTools', { projectId: 'p2', id, tools: 'read-only' })
    await call('integrations.setAutopilot', { projectId: 'p2', id, autopilot: true })
    expect(readProjectIntegrations(dataDir('p2'))).toEqual([{ id, enabled: true, tools: 'read-only', autopilot: true }])
    await call('integrations.rename', { projectId: 'p2', id, label: 'Linear — client B' })
    expect(store.get(id)?.label).toBe('Linear — client B')

    const listed = (await call('integrations.list', { projectId: 'p2' })) as { items: { integration: { id: string }; project: unknown }[] }
    expect(listed.items).toEqual([{ integration: store.get(id), project: { id, enabled: true, tools: 'read-only', autopilot: true } }])
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(await call('integrations.status', { projectId: 'p2' })).toEqual({ statuses: [{ id, status: { state: 'signed-in' } }] })

    expect(snapshot(repo)).toEqual(before.repo)
    expect(snapshot(home)).toEqual(before.home)
  })

  it('a Project that does not use an Integration lists it unticked, and status says sign-in is needed without a token', async () => {
    const { call } = bench()
    const added = (await call('integrations.add', { projectId: 'p1', service: 'notion', label: 'Notion', auth: 'oauth' })) as { integration: { id: string } }
    const listed = (await call('integrations.list', { projectId: 'p2' })) as { items: { project: unknown }[] }
    expect(listed.items[0]?.project).toBeNull()
    expect(await call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id: added.integration.id, status: { state: 'needs-sign-in' } }] })
  })

  it('remove of an Integration enabled in another Project needs the confirmation; with it, the Integration leaves every Project', async () => {
    const { call, dataDir, store } = bench()
    const added = (await call('integrations.add', { projectId: 'p1', service: 'linear', label: 'Linear', auth: 'bearer' })) as { integration: { id: string } }
    const id = added.integration.id
    await call('integrations.setSecret', { id, part: 'access', value: SECRET })
    await call('integrations.setEnabled', { projectId: 'p2', id, enabled: true })

    expect(await call('integrations.remove', { projectId: 'p1', id })).toEqual({ status: 'confirm', projects: ['Two'] })
    expect(store.get(id)).toBeDefined()
    expect(store.hasSecret(id, 'access')).toBe(true)

    expect(await call('integrations.remove', { projectId: 'p1', id, confirmed: true })).toEqual({ status: 'removed' })
    expect(store.get(id)).toBeUndefined()
    expect(store.hasSecret(id, 'access')).toBe(false)
    expect(readProjectIntegrations(dataDir('p1'))).toEqual([])
    expect(readProjectIntegrations(dataDir('p2'))).toEqual([])
  })

  it('remove of an Integration only its own Project uses goes without the confirmation; a disabled one elsewhere does not count', async () => {
    const { call } = bench()
    const added = (await call('integrations.add', { projectId: 'p1', service: 'linear', label: 'Linear', auth: 'bearer' })) as { integration: { id: string } }
    const id = added.integration.id
    await call('integrations.setEnabled', { projectId: 'p2', id, enabled: false })
    expect(await call('integrations.remove', { projectId: 'p1', id })).toEqual({ status: 'removed' })
  })
})

describe('the channels integrations.* from a Linked machine', () => {
  const peers: LinkPeer[] = []

  afterEach(() => {
    for (const peer of peers.splice(0)) peer.close()
  })

  async function linked(level: 'read' | 'all'): Promise<{ call: (channel: string, input: unknown) => Promise<unknown>; b: Bench; id: string }> {
    const b = bench()
    const added = (await b.call('integrations.add', { projectId: 'p1', service: 'linear', label: 'Linear', auth: 'bearer' })) as { integration: { id: string } }
    await b.call('integrations.setEnabled', { projectId: 'p2', id: added.integration.id, enabled: true })
    const adapter = await createLinkIpc({ modules: { './integrations.ts': async () => b.module }, isLinked: () => true })
    const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
    peer.setAccess(level)
    peers.push(peer)
    return { b, id: added.integration.id, call: (channel, input) => adapter.call(peer, channel, input, 'Studio') }
  }

  it('Read only: list and status answer, setEnabled is refused and changes nothing', async () => {
    const { call, b, id } = await linked('read')
    const listed = (await call('integrations.list', { projectId: 'p1' })) as { ok: boolean }
    expect(listed.ok).toBe(true)
    expect(((await call('integrations.status', { projectId: 'p1' })) as { ok: boolean }).ok).toBe(true)
    for (const [channel, input] of [
      ['integrations.setEnabled', { projectId: 'p1', id, enabled: false }],
      ['integrations.setTools', { projectId: 'p1', id, tools: 'read-only' }],
      ['integrations.setAutopilot', { projectId: 'p1', id, autopilot: true }],
      ['integrations.rename', { projectId: 'p1', id, label: 'Other' }],
    ] as const) {
      expect(await call(channel, input)).toEqual({ ok: false, error: readOnlyRefusal('Studio') })
    }
    expect(readProjectIntegrations(b.dataDir('p1'))).toEqual([{ id, enabled: true, tools: 'all', autopilot: false }])
    expect(b.store.get(id)?.label).toBe('Linear')
  })

  it('Full access: setEnabled goes through; add, setSecret and remove are never open — no secret crosses the link', async () => {
    const { call, b, id } = await linked('all')
    expect(await call('integrations.setEnabled', { projectId: 'p1', id, enabled: false })).toEqual({ ok: true, value: { project: { id, enabled: false, tools: 'all', autopilot: false } } })
    expect(readProjectIntegrations(b.dataDir('p1'))).toEqual([{ id, enabled: false, tools: 'all', autopilot: false }])
    for (const [channel, input] of [
      ['integrations.add', { projectId: 'p1', service: 'notion', label: 'Notion', auth: 'oauth' }],
      ['integrations.setSecret', { id, part: 'access', value: SECRET }],
      ['integrations.remove', { projectId: 'p1', id, confirmed: true }],
    ] as const) {
      expect(await call(channel, input)).toEqual({ ok: false, error: notOpenRefusal(channel) })
    }
    expect(b.store.list().map((entry) => entry.label)).toEqual(['Linear'])
    expect(b.store.hasSecret(id, 'access')).toBe(false)
  })
})
