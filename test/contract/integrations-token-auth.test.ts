// Sign-in with a token (worfy-integrations ticket 04; ADR-0111) against the stub service of
// test/fixtures/integrations/: `integrations.setSecret` keeps the token and checks it with the service's
// `initialize`; the answer is the status, never the token. Two Integrations on one address sign in each with its own
// token; Sign out removes every `<id>:*` key. The token is in no file of the data folder but secrets.json, in no
// channel answer and in nothing main logs. Real folders, a real HTTP server on 127.0.0.1, no Electron, no real service.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerModule } from '../../src/main/ipc/index'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { basicSecret, checkSignIn, connectionHeaders, offerGhToken, signInWithGhToken, signOut, stdioLaunch } from '../../src/main/integrations/auth/tokens'
import { INTEGRATION_SECRETS_FILE, IntegrationStore } from '../../src/main/integrations/store'
import type { GhRunner } from '../../src/main/github/prs'
import { createLinkIpc, LinkPeer, notOpenRefusal } from '../../src/main/link/ipc-adapter'
import { settingsPath } from '../../src/main/projects/settings'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import type { Integration } from '../../src/shared/integrations/types'
import { startHttpStub, type HttpStub } from '../fixtures/integrations/http-stub'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

// The module's default export subscribes to the app's quit (ticket 06): Electron's app, which a test has not.
vi.mock('electron', () => ({ app: { on: () => undefined } }))

const ALPHA = 'tok-ALPHA-SECRET-0123456789'
const BETA = 'tok-BETA-SECRET-9876543210'
const WRONG = 'tok-WRONG-SECRET-5555555555'
const DENIED = 'tok-DENIED-SECRET-4444444444'
const API_TOKEN = 'atl-API-TOKEN-SECRET-3333'
const HEADER_TOKEN = 'hdr-SECRET-2222222222'
const GH_TOKEN = 'gh-fake-SECRET-token-1111'
const DENIAL = 'Your organisation does not allow this app'
const ALL_SECRETS = [ALPHA, BETA, WRONG, DENIED, API_TOKEN, HEADER_TOKEN, GH_TOKEN]

let root: string
let stub: HttpStub
let logged: string[]

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-token-')))
  stub = await startHttpStub({
    bearer: { [ALPHA]: 'alpha', [BETA]: 'beta', [GH_TOKEN]: 'gh' },
    basic: { [`me@example.test:${API_TOKEN}`]: 'basic' },
    header: { name: 'X-Api-Key', values: { [HEADER_TOKEN]: 'header' } },
    forbidden: { [DENIED]: DENIAL },
  })
  logged = []
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    })
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await stub.close()
  removeTestTree(root)
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

interface Bench {
  module: HandlerModule
  store: IntegrationStore
  data: string
  call: (channel: string, input: unknown) => Promise<unknown>
  add: (label: string, auth: Integration['auth'], headerName?: string) => Promise<string>
}

function bench(): Bench {
  const data = join(root, 'worfy-data')
  const store = new IntegrationStore(join(data, 'integrations'))
  const projects = [{ id: 'p1', name: 'One' }]
  const dataDir = (id: string): string => join(data, 'projects', id)
  mkdirSync(dataDir('p1'), { recursive: true })
  writeFileSync(settingsPath(dataDir('p1')), `${JSON.stringify(defaultProjectSettings('plugin'))}\n`)
  const module = integrationsHandlers({ store: () => store, projects: { list: () => projects, dataDir } })
  const call = async (channel: string, input: unknown): Promise<unknown> => {
    const handler = module.find((entry) => entry.channel.name === channel)
    if (handler === undefined) throw new Error(`no handler for ${channel}`)
    return handler.handle(handler.channel.input.parse(input), { event: {} as never })
  }
  const add = async (label: string, auth: Integration['auth'], headerName?: string): Promise<string> => {
    const added = (await call('integrations.add', {
      projectId: 'p1',
      service: 'custom',
      label,
      auth,
      transport: { kind: 'http', url: stub.url },
      ...(headerName === undefined ? {} : { headerName }),
    })) as { integration: { id: string } }
    return added.integration.id
  }
  return { module, store, data, call, add }
}

const setSecret = (b: Bench, id: string, value: string): Promise<unknown> => b.call('integrations.setSecret', { id, part: 'access', value })

describe('integrations.setSecret checks the token with the service’s initialize', () => {
  it('a right token is signed-in: initialize reached the service with it, and the session it opened was ended', async () => {
    const b = bench()
    const id = await b.add('Stub — client A', 'bearer')
    expect(await setSecret(b, id, ALPHA)).toEqual({ status: { state: 'signed-in' } })
    expect(stub.log).toEqual([{ method: 'initialize', dataset: 'alpha' }])
    expect(stub.openSessions.size).toBe(0)
    expect(b.store.get(id)?.signIn).toMatchObject({ account: null, site: null })
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: { state: 'signed-in' } }] })
  })

  it('a wrong token needs sign-in, and the status says so afterwards too', async () => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    expect(await setSecret(b, id, WRONG)).toEqual({ status: { state: 'needs-sign-in' } })
    expect(stub.log).toEqual([{ method: 'initialize', dataset: 'unauthorized' }])
    expect(b.store.get(id)?.signIn).toBeNull()
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: { state: 'needs-sign-in' } }] })
  })

  it('a 403 with a text is an error with that text, and no token in it', async () => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    const answer = (await setSecret(b, id, DENIED)) as { status: { state: string; message: string } }
    expect(answer.status.state).toBe('error')
    expect(answer.status.message).toContain(DENIAL)
    expect(answer.status.message).not.toContain(DENIED)
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: answer.status }] })
  })

  it('two Integrations on one address of the stub are checked each with its own token', async () => {
    const b = bench()
    const first = await b.add('Stub — client A', 'bearer')
    const second = await b.add('Stub — client B', 'bearer')
    expect(await setSecret(b, first, ALPHA)).toEqual({ status: { state: 'signed-in' } })
    expect(await setSecret(b, second, BETA)).toEqual({ status: { state: 'signed-in' } })
    expect(stub.log.map((entry) => entry.dataset)).toEqual(['alpha', 'beta'])
    expect(connectionHeaders(b.store, first)).toEqual({ Authorization: `Bearer ${ALPHA}` })
    expect(connectionHeaders(b.store, second)).toEqual({ Authorization: `Bearer ${BETA}` })
  })

  it('Basic of an e-mail and an API token signs in and shows the e-mail as the account; a header of its own signs in too', async () => {
    const b = bench()
    const basic = await b.add('Jira by token', 'basic')
    expect(await setSecret(b, basic, basicSecret('me@example.test', API_TOKEN))).toEqual({ status: { state: 'signed-in' } })
    expect(b.store.get(basic)?.signIn?.account).toBe('me@example.test')
    const header = await b.add('Header server', 'header', 'X-Api-Key')
    expect(await setSecret(b, header, HEADER_TOKEN)).toEqual({ status: { state: 'signed-in' } })
    expect(stub.log.map((entry) => entry.dataset)).toEqual(['basic', 'header'])
  })

  it('an address nothing answers on is an error naming the address, not a crash', async () => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    await stub.close()
    const answer = (await setSecret(b, id, ALPHA)) as { status: { state: string; message: string } }
    expect(answer.status.state).toBe('error')
    expect(answer.status.message).toContain('127.0.0.1')
    expect(answer.status.message).not.toContain(ALPHA)
    stub = await startHttpStub({})
  })
})

describe('two checks of one Integration at once (review round 2, 1)', () => {
  it.each([
    ['a wrong token', WRONG],
    ['a refused token', DENIED],
  ])('%s answered after a right one leaves the right one signed-in, with no foreign error', async (_what, slow) => {
    await stub.close()
    stub = await startHttpStub({ bearer: { [ALPHA]: 'alpha' }, forbidden: { [DENIED]: DENIAL }, hold: [slow] })
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    const first = setSecret(b, id, slow)
    await vi.waitFor(() => expect(stub.held(slow)).toBe(1))
    expect(await setSecret(b, id, ALPHA)).toEqual({ status: { state: 'signed-in' } })
    stub.release(slow)
    await first
    expect(b.store.secret(id, 'access')).toBe(ALPHA)
    expect(b.store.get(id)?.signIn).not.toBeNull()
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: { state: 'signed-in' } }] })
  })

  it('a Sign out during the check is not undone by the check’s answer', async () => {
    await stub.close()
    stub = await startHttpStub({ bearer: { [ALPHA]: 'alpha' }, hold: [ALPHA] })
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    const pending = setSecret(b, id, ALPHA)
    await vi.waitFor(() => expect(stub.held(ALPHA)).toBe(1))
    signOut(b.store, id)
    stub.release(ALPHA)
    await pending
    expect(b.store.get(id)?.signIn).toBeNull()
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: { state: 'needs-sign-in' } }] })
  })
})

describe('a failure on the way is not a refusal of the token (review rounds 2 and 3)', () => {
  it.each([503, 429])('%s on a re-check of the same token keeps the sign-in; on a new token it clears it, the error shown until a restart', async (code) => {
    const NEW = 'tok-NEW-UNCHECKED-SECRET-6666'
    await stub.close()
    stub = await startHttpStub({ bearer: { [ALPHA]: 'alpha', [NEW]: 'new' } })
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    await setSecret(b, id, ALPHA)
    const signedIn = b.store.get(id)?.signIn
    expect(signedIn).not.toBeNull()

    stub.unavailable.set(ALPHA, code)
    const again = (await setSecret(b, id, ALPHA)) as { status: { state: string; message: string } }
    expect(again.status.state).toBe('error')
    expect(again.status.message).toContain(String(code))
    expect(b.store.get(id)?.signIn).toEqual(signedIn)
    const restarted = integrationsHandlers({ store: () => b.store, projects: { list: () => [{ id: 'p1', name: 'One' }], dataDir: (p) => join(b.data, 'projects', p) } })
    const status = restarted.find((entry) => entry.channel.name === 'integrations.status')
    expect(await status?.handle({ projectId: 'p1' }, { event: {} as never })).toEqual({ statuses: [{ id, status: { state: 'signed-in' } }] })

    stub.unavailable.set(NEW, code)
    const fresh = (await setSecret(b, id, NEW)) as { status: { state: string; message: string } }
    expect(fresh.status.state).toBe('error')
    expect(b.store.get(id)?.signIn).toBeNull()
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({ statuses: [{ id, status: fresh.status }] })
    expect(await status?.handle({ projectId: 'p1' }, { event: {} as never })).toEqual({ statuses: [{ id, status: { state: 'needs-sign-in' } }] })
  })

  it('a 401 clears the sign-in', async () => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    await setSecret(b, id, ALPHA)
    expect(await setSecret(b, id, WRONG)).toEqual({ status: { state: 'needs-sign-in' } })
    expect(b.store.get(id)?.signIn).toBeNull()
  })
})

describe('a redirect is not followed with the sign-in (review round 2, 3)', () => {
  it('a 307 to another address is an error, and the other address never gets the header', async () => {
    const other = await startHttpStub({})
    try {
      await stub.close()
      stub = await startHttpStub({ redirectTo: other.url })
      const b = bench()
      const id = await b.add('Header server', 'header', 'X-Api-Key')
      const answer = (await setSecret(b, id, HEADER_TOKEN)) as { status: { state: string; message: string } }
      expect(answer.status.state).toBe('error')
      expect(answer.status.message).toMatch(/307/)
      expect(stub.log).toEqual([{ method: 'initialize', dataset: 'redirected' }])
      expect(other.log).toEqual([])
    } finally {
      await other.close()
    }
  })
})

describe('what the service says back is scrubbed of the token (review round 2, 2)', () => {
  it('a 403 that quotes a Bearer token, a Basic pair and a header token shows none of them', async () => {
    await stub.close()
    stub = await startHttpStub({ echoUnknown: true, header: { name: 'X-Api-Key', values: {} } })
    const b = bench()
    const bearer = await b.add('Bearer', 'bearer')
    const basic = await b.add('Basic', 'basic')
    const header = await b.add('Header', 'header', 'X-Api-Key')
    const answers = [
      (await setSecret(b, bearer, WRONG)) as { status: { state: string; message: string } },
      (await setSecret(b, basic, basicSecret('me@example.test', API_TOKEN))) as { status: { state: string; message: string } },
      (await setSecret(b, header, HEADER_TOKEN)) as { status: { state: string; message: string } },
    ]
    expect(answers.map((answer) => answer.status.state)).toEqual(['error', 'error', 'error'])
    expect(answers[0]?.status.message).toMatch(/is not allowed here/)
    const basic64 = Buffer.from(`me@example.test:${API_TOKEN}`, 'utf8').toString('base64')
    for (const secret of [WRONG, API_TOKEN, basic64, HEADER_TOKEN]) expect(JSON.stringify(answers)).not.toContain(secret)
  })

  it('a failure to reach the service that names the token shows no token', async () => {
    const integration: Integration = { id: 'unreach1', service: 'custom', label: 'Stub', transport: { kind: 'http', url: stub.url }, auth: 'bearer', headerName: null, signIn: null }
    const failing = (async () => {
      throw new Error(`connect failed while sending ${ALPHA}`)
    }) as typeof fetch
    const { status, transient } = await checkSignIn(integration, { Authorization: `Bearer ${ALPHA}` }, { fetch: failing })
    expect(status.state).toBe('error')
    expect(transient).toBe(true)
    expect(JSON.stringify(status)).toMatch(/Could not reach 127\.0\.0\.1/)
    expect(JSON.stringify(status)).not.toContain(ALPHA)
  })
})

describe('Atlassian refuses a token', () => {
  it('shows the service’s text and the admin page, not a bare error', async () => {
    const atlassian: Integration = {
      id: 'atl0001',
      service: 'atlassian',
      label: 'Jira',
      transport: { kind: 'http', url: stub.url },
      auth: 'bearer',
      headerName: null,
      signIn: null,
    }
    const { status } = await checkSignIn(atlassian, { Authorization: `Bearer ${DENIED}` })
    expect(status.state).toBe('error')
    const message = status.state === 'error' ? status.message : ''
    expect(message).toContain(DENIAL)
    expect(message).toContain('Admin → Rovo → Rovo MCP server → Authentication')
    expect(message).toMatch(/https:\/\/support\.atlassian\.com\//)
    expect(message).not.toContain(DENIED)
  })
})

describe('Sign out', () => {
  it('removes every <id>:* key and the sign-in, and the status needs sign-in', async () => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    const kept = await b.add('Stub — kept', 'bearer')
    await setSecret(b, id, ALPHA)
    await setSecret(b, kept, BETA)
    b.store.setSecret(id, 'refresh', 'refresh-SECRET')
    signOut(b.store, id)
    const secrets = JSON.parse(readFileSync(join(b.data, 'integrations', INTEGRATION_SECRETS_FILE), 'utf8')) as { secrets: Record<string, string> }
    expect(Object.keys(secrets.secrets).filter((key) => key.startsWith(`${id}:`))).toEqual([])
    expect(Object.keys(secrets.secrets)).toEqual([`${kept}:access`])
    expect(b.store.get(id)?.signIn).toBeNull()
    expect(await b.call('integrations.status', { projectId: 'p1' })).toEqual({
      statuses: [
        { id, status: { state: 'needs-sign-in' } },
        { id: kept, status: { state: 'signed-in' } },
      ],
    })
  })
})

describe('the token stays a secret', () => {
  it('is in no file of the data folder but secrets.json, in no channel answer and in nothing main logs', async () => {
    const b = bench()
    const answers: unknown[] = []
    const ids = [await b.add('One', 'bearer'), await b.add('Two', 'bearer'), await b.add('Three', 'bearer'), await b.add('Four', 'basic')]
    answers.push(await setSecret(b, ids[0] as string, ALPHA))
    answers.push(await setSecret(b, ids[1] as string, WRONG))
    answers.push(await setSecret(b, ids[2] as string, DENIED))
    answers.push(await setSecret(b, ids[3] as string, basicSecret('me@example.test', API_TOKEN)))
    answers.push(await b.call('integrations.list', { projectId: 'p1' }))
    answers.push(await b.call('integrations.status', { projectId: 'p1' }))
    const files = filesOf(b.data)
    expect(Object.keys(files)).toContain(join('integrations', 'integrations.json'))
    const basic64 = Buffer.from(`me@example.test:${API_TOKEN}`, 'utf8').toString('base64')
    for (const secret of [...ALL_SECRETS, basic64]) {
      for (const [file, text] of Object.entries(files)) expect(text, file).not.toContain(secret)
      expect(JSON.stringify(answers)).not.toContain(secret)
      expect(logged.join('\n')).not.toContain(secret)
    }
  })
})

describe('integrations.setSecret from a Linked machine', () => {
  const peers: LinkPeer[] = []

  afterEach(() => {
    for (const peer of peers.splice(0)) peer.close()
  })

  it.each(['read', 'all'] as const)('is refused at access %s, and nothing is kept or checked', async (level) => {
    const b = bench()
    const id = await b.add('Stub', 'bearer')
    const adapter = await createLinkIpc({ modules: { './integrations.ts': async () => b.module }, isLinked: () => true })
    const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
    peer.setAccess(level)
    peers.push(peer)
    expect(await adapter.call(peer, 'integrations.setSecret', { id, part: 'access', value: ALPHA }, 'Studio')).toEqual({ ok: false, error: notOpenRefusal('integrations.setSecret') })
    expect(b.store.hasSecret(id, 'access')).toBe(false)
    expect(stub.log).toEqual([])
  })
})

describe('the token of the Project’s gh account', () => {
  const gh =
    (scopes: string | null): GhRunner =>
    async (args) => {
      if (args.join(' ') === 'auth token -u alice') return `${GH_TOKEN}\n`
      if (args.join(' ') === 'auth status --json hosts') {
        if (scopes === null) throw new Error('unknown flag: --json')
        return JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, host: 'github.com', login: 'alice', scopes }] } })
      }
      throw new Error(`unexpected gh ${args.join(' ')}`)
    }

  it('is offered with a warning naming its scopes, and never in the offer itself', async () => {
    const offer = await offerGhToken({ account: 'alice', run: gh('gist, read:org, repo, workflow'), root })
    expect(offer).toMatchObject({ account: 'alice', scopes: ['gist', 'read:org', 'repo', 'workflow'] })
    expect(offer?.warning).toMatch(/alice/)
    expect(offer?.warning).toMatch(/repo, workflow/)
    expect(JSON.stringify(offer)).not.toContain(GH_TOKEN)
    expect(await offerGhToken({ account: null, run: gh(null), root })).toBeNull()
    const unknown = await offerGhToken({ account: 'alice', run: gh(null), root })
    expect(unknown?.scopes).toBeNull()
    expect(unknown?.warning).toMatch(/scopes/)
  })

  it('keeps no copy for an Integration that does not sign in with a token (review round 2, 5)', async () => {
    const b = bench()
    const id = await b.add('OAuth server', 'oauth')
    await expect(signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })).rejects.toThrow(/Bearer/)
    expect(b.store.hasSecret(id, 'access')).toBe(false)
  })

  it('does not overwrite the e-mail and token of a Basic Integration (review round 3, 3)', async () => {
    const b = bench()
    const id = await b.add('Jira by token', 'basic')
    const pair = basicSecret('me@example.test', API_TOKEN)
    await setSecret(b, id, pair)
    await expect(signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })).rejects.toThrow(/Bearer/)
    expect(b.store.secret(id, 'access')).toBe(pair)
  })

  it('signs a GitHub Integration in with a copy in the secret store, the gh login as its account', async () => {
    const b = bench()
    const id = await b.add('GitHub', 'bearer')
    const status = await signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })
    expect(status).toEqual({ state: 'signed-in' })
    expect(b.store.secret(id, 'access')).toBe(GH_TOKEN)
    expect(b.store.get(id)?.signIn?.account).toBe('alice')
    expect(stub.log).toEqual([{ method: 'initialize', dataset: 'gh' }])
    expect(logged.join('\n')).not.toContain(GH_TOKEN)
  })

  // worfy-integrations ticket 08 (the low finding of ticket 04: `changed` of signInWithGhToken had no test).
  it.each([503, 429])('a new gh token the service answers %s for does not inherit the sign-in of the token before it', async (code) => {
    const b = bench()
    const id = await b.add('GitHub', 'bearer')
    await setSecret(b, id, ALPHA)
    expect(b.store.get(id)?.signIn).not.toBeNull()
    stub.unavailable.set(GH_TOKEN, code)
    const status = await signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })
    expect(status.state).toBe('error')
    expect(status.state === 'error' ? status.message : '').toContain(String(code))
    expect(b.store.secret(id, 'access')).toBe(GH_TOKEN)
    expect(b.store.get(id)?.signIn).toBeNull()
    expect(logged.join('\n')).not.toContain(GH_TOKEN)
  })

  it.each([503, 429])('the same gh token signed in again while the service answers %s keeps its sign-in', async (code) => {
    const b = bench()
    const id = await b.add('GitHub', 'bearer')
    expect(await signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })).toEqual({ state: 'signed-in' })
    const signedIn = b.store.get(id)?.signIn
    expect(signedIn?.account).toBe('alice')
    stub.unavailable.set(GH_TOKEN, code)
    const again = await signInWithGhToken({ store: b.store, id, account: 'alice', run: gh('repo'), root })
    expect(again.state).toBe('error')
    expect(b.store.get(id)?.signIn).toEqual(signedIn)
  })
})

describe('the secret variables of a stdio server', () => {
  it('reach the server through its environment, not its arguments', async () => {
    const store = new IntegrationStore(join(root, 'integrations'))
    const added = store.add({
      service: 'custom',
      label: 'Local tool',
      auth: 'none',
      transport: {
        kind: 'stdio',
        command: scriptNode(),
        args: [join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'integrations', 'stdio-stub.mjs')],
        env: {},
        secretEnv: ['STUB_API_KEY'],
      },
    })
    store.setSecret(added.id, 'env:STUB_API_KEY', 'stdio-alpha-key')
    const integration = store.get(added.id)
    if (integration === undefined) throw new Error('the Integration was not kept')
    const launch = stdioLaunch(integration, (part) => store.secret(added.id, part))
    expect(launch.args.join(' ')).not.toContain('stdio-alpha-key')
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'inherit'] })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      const first = new Promise<string>((resolve) => createInterface({ input: child.stdout }).once('line', resolve))
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
      const answer = JSON.parse(await first) as { result: { serverInfo: { name: string }; instructions: string } }
      expect(answer.result.serverInfo.name).toBe('stub-alpha')
      expect(answer.result.instructions).toBe('keyInArgs=false')
    } finally {
      child.stdin.end()
      await exited
    }
  }, ms(20_000))
})
