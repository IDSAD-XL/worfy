// The proxy of an Integration (worfy-integrations ticket 06; ADR-0111 item 1; spec, implementation decisions, Proxy):
// worfy main keeps one connection to the service per Integration and Machine, shared by every Session, and a Session
// gets an MCP server of worfy's whose tools are the service's, cut by the Project's tools filter, each description led
// by the Integration's label. Here the Session side is what Claude Code meets: the SDK server claudeMcpServer makes of
// the proxy's server (a low-level Server of the MCP SDK), reached through an MCP client over an in-memory transport.
// The service side is a stub on 127.0.0.1 (test/fixtures/integrations/service-stub.ts) and a stdio stub
// (stdio-service-stub.mjs); no real service, no real token.
import { mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationProxy, signInNeeded, toolsCost, type SessionEntry } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import { claudeMcpServer } from '../../src/main/vendors/claude/mcp'
import type { IntegrationTools } from '../../src/shared/integrations/types'
import { startServiceStub, STUB_TOOLS, type ServiceStub } from '../fixtures/integrations/service-stub'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

/** The first folder of the agent environment's PATH: a stdio server starts with it first (the login shell's PATH). */
const LOGIN_BIN = join(tmpdir(), 'worfy-login-shell-bin')

const TOKEN_A = 'tok-alpha-5f1c9e2a'
const TOKEN_B = 'tok-beta-7d3b8e41'
const STDIO_STUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'integrations', 'stdio-service-stub.mjs')

let root: string
let stub: ServiceStub
let store: IntegrationStore
let proxy: IntegrationProxy
let clients: Client[] = []

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-proxy-')))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { PATH: [LOGIN_BIN, process.env.PATH ?? ''].join(delimiter) }, from: 'login-shell' })
  stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha', [TOKEN_B]: 'beta' } })
  store = new IntegrationStore(join(root, 'integrations'))
  proxy = new IntegrationProxy({ store })
})

afterEach(async () => {
  for (const client of clients) await client.close()
  clients = []
  await proxy.close()
  await stub.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A custom server on the stub's address signed in with a Bearer token. */
function addHttp(label: string, token: string | null): string {
  const added = store.add({ service: 'custom', label, auth: 'bearer', transport: { kind: 'http', url: stub.url } })
  if (token !== null) store.setSecret(added.id, 'access', token)
  return added.id
}

/** One Session's server of an Integration, as Claude Code meets it: an MCP client of the SDK server claudeMcpServer made. */
async function session(id: string, name: string, tools: IntegrationTools = 'all'): Promise<Client> {
  const entry: SessionEntry = { id, name, tools }
  const server = await claudeMcpServer(proxy.sessionServer(entry))
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  await (server.instance as unknown as { connect(transport: InMemoryTransport): Promise<void> }).connect(theirs)
  const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
  await client.connect(ours)
  clients.push(client)
  return client
}

type Content = { type: string; text?: string }
const textOf = (result: unknown): string =>
  (((result as { content?: unknown }).content ?? []) as Content[])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })
const toolCalls = () => stub.log.filter((entry) => entry.method === 'tools/call').length

describe('two Integrations on one address', () => {
  it('each reaches the service with its own token and answers with its own data', async () => {
    const a = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha')
    const b = await session(addHttp('Acme — beta', TOKEN_B), 'acme-beta')
    expect(textOf(await call(a, 'whoami'))).toBe('dataset alpha')
    expect(textOf(await call(b, 'whoami'))).toBe('dataset beta')
    expect(stub.log.filter((entry) => entry.method === 'tools/call').map((entry) => entry.dataset)).toEqual(['alpha', 'beta'])
  })

  it('two Sessions of one Integration share one connection to the service', async () => {
    const id = addHttp('Acme — alpha', TOKEN_A)
    const first = await session(id, 'acme-alpha')
    const second = await session(id, 'acme-alpha')
    await Promise.all([first.listTools(), second.listTools()])
    await Promise.all([call(first, 'whoami'), call(second, 'whoami'), call(first, 'list_items')])
    expect(stub.initialized('alpha')).toBe(1)
  })

  it('a session the service forgot (404) is opened again once, and the call goes through', async () => {
    const client = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha')
    expect(textOf(await call(client, 'whoami'))).toBe('dataset alpha')
    stub.expireSessions()
    const again = await call(client, 'whoami')
    expect(again.isError).not.toBe(true)
    expect(textOf(again)).toBe('dataset alpha')
    expect(stub.initialized('alpha')).toBe(2)
  })
})

describe('a stdio server worfy starts itself', () => {
  it('gets its secret in the environment, never in its arguments, and the PATH of the login shell', async () => {
    const added = store.add({
      service: 'custom',
      label: 'Local tool',
      auth: 'none',
      transport: { kind: 'stdio', command: scriptNode(), args: [STDIO_STUB, '--verbose'], env: {}, secretEnv: ['STUB_API_KEY'] },
    })
    store.setSecret(added.id, 'env:STUB_API_KEY', 'stdio-alpha-key')
    const client = await session(added.id, 'local-tool')
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami'])
    // The stub saw its key in its environment (dataset alpha), not among its arguments, of which it got the one given,
    // and the agent environment's PATH first, so a command such as npx is found as in a terminal.
    expect(textOf(await call(client, 'whoami'))).toBe(`dataset alpha; keyInArgs=false; args=1; firstPath=${LOGIN_BIN}`)
  }, ms(20_000))
})

describe('the tools filter of the Project', () => {
  it('read-only lists only the tools the service marks readOnlyHint, and refuses a call to another', async () => {
    const client = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha', 'read-only')
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami', 'list_items'])
    const before = toolCalls()
    const refused = await call(client, 'create_item', { title: 'x' })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toMatch(/create_item/u)
    // The refusal is the proxy's: the call never reached the service.
    expect(toolCalls()).toBe(before)
  })

  it('a list of names lists those tools only, and refuses the rest', async () => {
    const client = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha', ['create_item', 'no_such_tool'])
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['create_item'])
    expect(textOf(await call(client, 'create_item', { title: 'x' }))).toBe('created in alpha')
    const before = toolCalls()
    expect((await call(client, 'whoami')).isError).toBe(true)
    expect(toolCalls()).toBe(before)
  })

  it('all lists every tool, each description led by the label, with the service`s own schema', async () => {
    const client = await session(addHttp('Jira — client A', TOKEN_A), 'jira-client-a')
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(STUB_TOOLS.map((tool) => tool.name))
    for (const tool of tools) expect(tool.description).toMatch(/^\[Jira — client A\] /u)
    expect(tools.find((tool) => tool.name === 'create_item')?.inputSchema).toEqual(STUB_TOOLS.find((tool) => tool.name === 'create_item')?.inputSchema)
    expect(tools.find((tool) => tool.name === 'whoami')?.annotations).toEqual({ readOnlyHint: true })
  })
})

describe('what a call answers', () => {
  it('text, an image and a link to a resource pass as the service gave them', async () => {
    const client = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha')
    const answer = await call(client, 'picture')
    expect((answer.content as Content[]).map((block) => block.type)).toEqual(['text', 'image', 'resource_link'])
    expect((answer.content as Record<string, unknown>[])[2]).toMatchObject({ uri: 'stub://alpha/item/1', name: 'item 1' })
  })

  it('a refused sign-in (401) answers isError «Sign-in needed: <label>…» and the status is needs-sign-in', async () => {
    const id = addHttp('Jira — client A', TOKEN_A)
    const client = await session(id, 'jira-client-a')
    expect(textOf(await call(client, 'whoami'))).toBe('dataset alpha')
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
    stub.revoke(TOKEN_A)
    const answer = await call(client, 'whoami')
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toBe(signInNeeded('Jira — client A'))
    expect(textOf(answer)).toMatch(/^Sign-in needed: Jira — client A\. Ask the user to sign in in worfy/u)
    expect(proxy.status(id)?.status).toEqual({ state: 'needs-sign-in' })
  })

  it('an Integration with no token kept answers «Sign-in needed» without asking the service', async () => {
    const id = addHttp('Jira — client B', null)
    const client = await session(id, 'jira-client-b')
    // Nothing was listed yet: the server fails its tools/list with the same words.
    await expect(client.listTools()).rejects.toThrow(signInNeeded('Jira — client B'))
    expect(proxy.status(id)?.status).toEqual({ state: 'needs-sign-in' })
    expect(stub.log).toEqual([])
  })

  it('an Integration removed from the Machine while the Session runs answers an error that names it', async () => {
    const id = addHttp('Jira — client A', TOKEN_A)
    const client = await session(id, 'jira-client-a')
    await client.listTools()
    store.remove(id)
    const answer = await call(client, 'whoami')
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/Jira — client A/u)
  })

  it('a token the service quotes back, in an answer or an HTTP error, reaches the Session hidden', async () => {
    const client = await session(addHttp('Acme — alpha', TOKEN_A), 'acme-alpha')
    const careless = textOf(await call(client, 'careless'))
    expect(careless).toMatch(/\[redacted\]/u)
    expect(careless).not.toContain(TOKEN_A)
    const broken = await call(client, 'broken')
    expect(broken.isError).toBe(true)
    expect(textOf(broken)).toMatch(/^Acme — alpha: /u)
    expect(textOf(broken)).not.toContain(TOKEN_A)
  })
})

describe('the price of the tools', () => {
  it('the status counts the service`s tools and their size: the length of their JSON over 4', async () => {
    const id = addHttp('Acme — alpha', TOKEN_A)
    const client = await session(id, 'acme-alpha', 'read-only')
    await client.listTools()
    const json = JSON.stringify(STUB_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))
    expect(proxy.status(id)?.tools).toEqual({ count: STUB_TOOLS.length, tokens: Math.ceil(json.length / 4) })
    expect(toolsCost(STUB_TOOLS)).toEqual({ count: STUB_TOOLS.length, tokens: Math.ceil(json.length / 4) })
  })

  it('a tool whose full name would pass 128 characters is left out of the list and named in the status', async () => {
    const id = addHttp('Acme — alpha', TOKEN_A)
    // mcp__ + 24 + __ leaves 97 characters for the tool: list_items fits, a server name that long leaves no room for whoami's twin.
    const server = 'a'.repeat(24)
    const longName = 'x'.repeat(98)
    await stub.close()
    stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha' }, tools: [...STUB_TOOLS.slice(0, 2), { name: longName, description: 'long', inputSchema: { type: 'object' } }] })
    store.remove(id)
    const again = addHttp('Acme — alpha', TOKEN_A)
    const client = await session(again, server)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami', 'list_items'])
    expect(proxy.status(again)?.hidden).toEqual([longName])
  })
})
