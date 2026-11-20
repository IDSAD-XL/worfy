// The proxy of an Integration (worfy-integrations ticket 06; ADR-0111 item 1; spec, implementation decisions, Proxy):
// worfy main keeps one connection to the service per Integration and Machine, shared by every Session, and a Session
// gets an MCP server of worfy's whose tools are the service's, cut by the Project's tools filter, each description led
// by the Integration's label. Here the Session side is what Claude Code meets: the SDK server claudeMcpServer makes of
// the proxy's server (a low-level Server of the MCP SDK), reached through an MCP client over an in-memory transport.
// The service side is a stub on 127.0.0.1 (test/fixtures/integrations/service-stub.ts) and a stdio stub
// (stdio-service-stub.mjs); no real service, no real token.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
/** `text` as a literal part of a regular expression. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
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
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami', 'slow'])
    // The stub saw its key in its environment (dataset alpha), not among its arguments, of which it got the one given,
    // and the agent environment's PATH first, so a command such as npx is found as in a terminal.
    expect(textOf(await call(client, 'whoami'))).toMatch(new RegExp(`^dataset alpha; keyInArgs=false; args=1; firstPath=${escape(LOGIN_BIN)}; pid=\\d+$`, 'u'))
  }, ms(20_000))

  it('a bare command name is found on the PATH of the login shell — on Windows a .cmd shim, run through cmd.exe', async () => {
    // As `npx` is: a shim in a folder of the login shell's PATH, named without its extension.
    const bin = join(root, 'shim-bin')
    mkdirSync(bin)
    if (process.platform === 'win32') {
      writeFileSync(join(bin, 'worfy-stdio-stub.cmd'), `@"${scriptNode()}" "${STDIO_STUB}" %*\r\n`)
    } else {
      writeFileSync(join(bin, 'worfy-stdio-stub'), `#!/bin/sh\nexec "${scriptNode()}" "${STDIO_STUB}" "$@"\n`)
      chmodSync(join(bin, 'worfy-stdio-stub'), 0o755)
    }
    mocks.agentEnv.mockResolvedValue({ env: { PATH: [bin, process.env.PATH ?? ''].join(delimiter) }, from: 'login-shell' })
    const added = store.add({
      service: 'custom',
      label: 'Shim tool',
      auth: 'none',
      transport: { kind: 'stdio', command: 'worfy-stdio-stub', args: ['--verbose'], env: {}, secretEnv: ['STUB_API_KEY'] },
    })
    store.setSecret(added.id, 'env:STUB_API_KEY', 'stdio-alpha-key')
    const client = await session(added.id, 'shim-tool')
    expect(textOf(await call(client, 'whoami'))).toMatch(/^dataset alpha; keyInArgs=false; args=1; /u)
  }, ms(20_000))
})

/** A stdio Integration of the stub with no secret or with `key`; each process it starts appends its id to `log`. */
function addStdio(label: string, log: string, key: string | null = null): string {
  const added = store.add({
    service: 'custom',
    label,
    auth: 'none',
    transport: { kind: 'stdio', command: scriptNode(), args: [STDIO_STUB], env: { STUB_SPAWN_LOG: log }, secretEnv: key === null ? [] : ['STUB_API_KEY'] },
  })
  if (key !== null) store.setSecret(added.id, 'env:STUB_API_KEY', key)
  return added.id
}

/** The ids of the processes the stdio stub started, by its log. */
const spawned = (log: string): number[] => logLines(log).filter((line) => /^\d+$/u.test(line)).map(Number)
const logLines = (log: string): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const pidOf = (text: string): number => Number(/pid=(\d+)/u.exec(text)?.[1])

describe('one call that ends early', () => {
  it('a call one Session cancels ends that call only: another Session`s call answers on the same process', async () => {
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log)
    const a = await session(id, 'local-tool')
    const b = await session(id, 'local-tool')
    await Promise.all([a.listTools(), b.listTools()])
    const cancel = new AbortController()
    const cancelled = a.callTool({ name: 'slow', arguments: { ms: ms(10_000) } }, undefined, { signal: cancel.signal })
    const answered = b.callTool({ name: 'slow', arguments: { ms: ms(600) } })
    setTimeout(() => cancel.abort('the agent stopped'), ms(100))
    await expect(cancelled).rejects.toThrow()
    const answer = await answered
    expect(answer.isError).not.toBe(true)
    expect(textOf(answer)).toMatch(/^slow done pid=\d+$/u)
    const [pid] = spawned(log)
    expect(pidOf(textOf(answer))).toBe(pid)
    expect(pidOf(textOf(await call(b, 'whoami')))).toBe(pid)
    expect(spawned(log)).toHaveLength(1)
    expect(alive(pid ?? -1)).toBe(true)
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
  }, ms(20_000))

  it('a call past the time limit fails alone, naming the Integration; the connection stays', async () => {
    await proxy.close()
    proxy = new IntegrationProxy({ store, callTimeoutMs: ms(300) })
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log)
    const client = await session(id, 'local-tool')
    const late = call(client, 'slow', { ms: ms(5_000) })
    expect(textOf(await call(client, 'whoami'))).toMatch(/^dataset none;/u)
    const answer = await late
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/^Local tool: /u)
    expect(textOf(await call(client, 'whoami'))).toMatch(/^dataset none;/u)
    expect(spawned(log)).toHaveLength(1)
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
  }, ms(20_000))
})

describe('a changed sign-in', () => {
  it('calls made together after a new secret open one new connection, and the old process ends', async () => {
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log, 'stdio-alpha-key')
    const client = await session(id, 'local-tool')
    expect(textOf(await call(client, 'whoami'))).toMatch(/^dataset alpha;/u)
    store.setSecret(id, 'env:STUB_API_KEY', 'stdio-other-key')
    const answers = await Promise.all([call(client, 'whoami'), call(client, 'whoami'), call(client, 'whoami')])
    for (const answer of answers) expect(textOf(answer)).toMatch(/^dataset none;/u)
    const pids = spawned(log)
    expect(pids).toHaveLength(2)
    await vi.waitFor(() => expect(alive(pids[0] ?? -1)).toBe(false), { timeout: ms(5_000) })
    expect(alive(pids[1] ?? -1)).toBe(true)
  }, ms(20_000))

  it('a new refresh token alone keeps the connection: only the token a request carries tells a new sign-in', async () => {
    const id = addHttp('Acme — alpha', TOKEN_A)
    const client = await session(id, 'acme-alpha')
    expect(textOf(await call(client, 'whoami'))).toBe('dataset alpha')
    store.setSecret(id, 'refresh', 'refresh-token-0b5e1c')
    expect(textOf(await call(client, 'whoami'))).toBe('dataset alpha')
    expect(stub.initialized('alpha')).toBe(1)
  })

  it('a call on the connection a new one replaced fails without touching the new one`s status', async () => {
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log, 'stdio-alpha-key')
    const a = await session(id, 'local-tool')
    const b = await session(id, 'local-tool')
    await Promise.all([a.listTools(), b.listTools()])
    // A call in flight on the first process; then a new secret, and B's call opens the second.
    const inFlight = call(a, 'slow', { ms: ms(10_000) })
    await vi.waitFor(() => expect(logLines(log).filter((line) => line.startsWith('slow '))).toHaveLength(1), { timeout: ms(5_000) })
    store.setSecret(id, 'env:STUB_API_KEY', 'stdio-other-key')
    expect(textOf(await call(b, 'whoami'))).toMatch(/^dataset none;/u)
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
    // The first process dies under the call it still runs: that call fails, the status stays the new connection's.
    const [first] = spawned(log)
    process.kill(first ?? -1)
    const failed = await inFlight
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toMatch(/^Local tool: /u)
    expect(proxy.status(id)?.status).toEqual({ state: 'signed-in' })
    expect(textOf(await call(b, 'whoami'))).toMatch(/^dataset none;/u)
    expect(spawned(log)).toHaveLength(2)
  }, ms(20_000))
})

describe('an Integration removed from the Machine', () => {
  it('one with no secret stops answering too, and its process ends', async () => {
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log)
    const client = await session(id, 'local-tool')
    expect(textOf(await call(client, 'whoami'))).toMatch(/^dataset none;/u)
    store.remove(id)
    const answer = await call(client, 'whoami')
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toMatch(/^Local tool is no longer on this Machine/u)
    const [pid] = spawned(log)
    await vi.waitFor(() => expect(alive(pid ?? -1)).toBe(false), { timeout: ms(5_000) })
  }, ms(20_000))

  it('close(id) ends its connection at once', async () => {
    const log = join(root, 'spawned.log')
    const id = addStdio('Local tool', log)
    const client = await session(id, 'local-tool')
    await call(client, 'whoami')
    const [pid] = spawned(log)
    await proxy.close(id)
    await vi.waitFor(() => expect(alive(pid ?? -1)).toBe(false), { timeout: ms(5_000) })
  }, ms(20_000))
})

describe('an address with no MCP server', () => {
  it('a 404 to initialize says the address was not found, not that a session ended', async () => {
    const added = store.add({ service: 'custom', label: 'Wrong address', auth: 'bearer', transport: { kind: 'http', url: `${stub.url}/nowhere` } })
    store.setSecret(added.id, 'access', TOKEN_A)
    const client = await session(added.id, 'wrong-address')
    const listed = client.listTools()
    await expect(listed).rejects.toThrow(/Wrong address: the address was not found/u)
    await expect(listed).rejects.not.toThrow(/session/u)
    expect(proxy.status(added.id)?.status).toMatchObject({ state: 'error' })
  })
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
