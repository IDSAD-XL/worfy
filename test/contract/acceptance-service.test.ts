// The Acceptance service in main (worfy-acceptance ticket 01): src/main/acceptance/service.ts over the real workflow hub
// (src/main/workflow/watch.ts) and the stub epic-status of test/fixtures/workflow-stub, which watches the Ticket files of
// two temporary Projects; its channels src/main/ipc/acceptance.ts registered through registerIpc (the wrapper the app
// uses) over a mocked `electron`. `acceptance.get` answers the queue of both Projects at once, without a Project in the
// request; an edit of a Ticket file gives `acceptance.changed`; a decision marked "Sent" is kept in the Project's data
// folder, outlives the service, turns "Not recorded yet" after 24 hours and goes once the Ticket file has an
// `owner-check` line with the same verdict. No gh or git runs and nothing is written into the Projects' folders.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptanceHub, AcceptanceService } from '../../src/main/acceptance/service'
import type { WorkflowHub } from '../../src/main/workflow/watch'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AcceptanceRow, AcceptanceState } from '../../src/shared/ipc/acceptance'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))

const WORKFLOW_STUB = join(__dirname, '..', 'fixtures', 'workflow-stub')
const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const HOUR = 60 * 60 * 1000

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

interface FakeWindow {
  /** A string id is a Linked machine's client (src/main/link/caller.ts, isRemoteCall). */
  id: number | string
  sent: AcceptanceState[]
  send: (channel: string, payload: unknown) => void
  once: (event: string, listener: () => void) => void
  isDestroyed: () => boolean
}

function makeWindow(id: number | string): FakeWindow {
  const sent: AcceptanceState[] = []
  return {
    id,
    sent,
    send: (channel, payload) => {
      if (channel === `${IPC_CHANNEL_PREFIX}acceptance.changed`) sent.push(payload as AcceptanceState)
    },
    once: () => undefined,
    isDestroyed: () => false,
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
}

function ticketText(num: number, status: string, done: string[], extra: string[] = []): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, ...extra, 'Blocked by: —', '', '## Done when', '', ...done, ''].join('\n')
}

/** A Project of Epic `demo` in a git repository without `origin`: the hub reads its working tree. */
function makeProject(root: string, tickets: Record<string, string>): void {
  const issues = join(root, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(root, '.scratch', 'demo', 'spec.md'), '# Demo epic\n')
  for (const [name, text] of Object.entries(tickets)) writeFileSync(join(issues, name), text)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'epic')
}

/** Every file under `dir`, `.git` included, with its size, time and content hash. */
function treeState(dir: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        state.set(path, `${stats.size}:${stats.mtimeMs}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`)
      }
    }
  }
  walk(dir)
  return state
}

let scratch: string
let alpha: string
let beta: string
let home: string
let data: string
let now: number
let hub: WorkflowHub
let services: AcceptanceService[]
/** The Projects kept on this Machine only. */
let localOnly: Set<string>
/** Every gh call of the run, one line each: a stand-in first on PATH. */
let ghLog: string
let savedPath: string | undefined
let handlers: Map<string, Listener>
let Service: typeof import('../../src/main/acceptance/service').AcceptanceService

const projects = () => [
  { id: ALPHA, name: 'Alpha', path: alpha },
  { id: BETA, name: 'Beta', path: beta },
]

function makeService(over: AcceptanceHub = hub): AcceptanceService {
  const service = new Service({ hub: over, projects, dataDir: (id) => join(data, id) }, { now: () => now, tickMs: ms(60_000) })
  services.push(service)
  return service
}

async function register(service: AcceptanceService): Promise<void> {
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  const module = await import('../../src/main/ipc/acceptance')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './acceptance.ts': () => Promise.resolve(module.acceptanceHandlers(() => service, () => localOnly)) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
}

async function get(from: FakeWindow): Promise<AcceptanceState> {
  const listener = handlers.get(`${IPC_CHANNEL_PREFIX}acceptance.get`)
  if (!listener) throw new Error('no handler for acceptance.get')
  const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
  const result = (await listener(event, undefined)) as IpcResult<AcceptanceState>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const nameOf = (row: AcceptanceRow): string => `${row.ticket.projectName} ${String(row.ticket.num).padStart(2, '0')}${row.kind === 'item' ? `.${row.item.index}` : ''}`
const shape = (state: AcceptanceState | undefined): Record<string, string[]> => Object.fromEntries((state?.groups ?? []).map((group) => [group.group, group.rows.map(nameOf)]))
const rowOf = (state: AcceptanceState | undefined, name: string): AcceptanceRow | undefined => state?.groups.flatMap((group) => group.rows).find((row) => nameOf(row) === name)

const OWNER_PASS = '  - evidence: owner-check pass · 2026-11-23: works · mac stable · 94d475ba'
const OWNER_FAIL = '  - evidence: owner-check fail · 2026-11-23: no chip · mac stable · 94d475ba'

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-acceptance-')))
  alpha = join(scratch, 'alpha')
  beta = join(scratch, 'beta')
  data = join(scratch, 'data')
  home = join(scratch, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  symlinkSync(join(WORKFLOW_STUB, 'epic-status'), join(home, 'bin', 'epic-status'))
  process.env.STUB_LOG = join(scratch, 'stub-calls.log')
  writeFileSync(process.env.STUB_LOG, '')
  // A gh that only logs: the service must never start one.
  const bin = join(scratch, 'bin')
  mkdirSync(bin)
  ghLog = join(scratch, 'gh-calls.log')
  writeFileSync(ghLog, '')
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> '${ghLog}'\nexit 1\n`, { mode: 0o755 })
  savedPath = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
  localOnly = new Set()
  makeProject(alpha, {
    '01-first.md': ticketText(1, 'done 2026-11-22T10:00Z', ['- [ ] (manual) The chip shows the server.', '- [x] Unit test green.']),
    '02-second.md': ticketText(2, 'claimed 2026-11-22T10:00Z', ['- [ ] (manual) Not merged yet.']),
  })
  makeProject(beta, {
    '01-accept.md': ticketText(1, 'blocked 2026-11-22T10:00Z', ['- [x] (manual) Checked already.'], ['Blocked reason: choose a name', 'Waits: owner']),
    '02-failed.md': ticketText(2, 'done 2026-11-22T10:00Z', ['- [ ] (manual) Esc keeps the text.', OWNER_FAIL]),
  })
  now = Date.parse('2026-11-23T12:00:00Z')
  services = []
  vi.resetModules()
  const { WorkflowHub: Hub } = await import('../../src/main/workflow/watch')
  hub = new Hub({ claudeHome: home, env: () => Promise.resolve(process.env) })
  ;({ AcceptanceService: Service } = await import('../../src/main/acceptance/service'))
})

afterEach(async () => {
  for (const service of services) await service.stop()
  await hub.closeAll()
  delete process.env.STUB_LOG
  process.env.PATH = savedPath
  removeTestTree(scratch)
})

describe('acceptance.get', () => {
  it('answers the queue of both Projects in one answer, in groups, and writes nothing into their folders', async () => {
    const before = [treeState(alpha), treeState(beta)]
    const service = makeService()
    await register(service)
    const state = await get(makeWindow(1))
    expect(shape(state)).toEqual({
      ready: ['Alpha 01.1'],
      update: [],
      waits: ['Beta 01'],
      failed: ['Beta 02.1'],
      work: ['Alpha 02.1'],
      older: [],
    })
    expect(rowOf(state, 'Beta 01')).toMatchObject({ kind: 'ticket', ticket: { projectId: BETA, blockedReason: 'choose a name' } })
    const ready = rowOf(state, 'Alpha 01.1')
    expect(ready).toMatchObject({ kind: 'item', ticket: { projectId: ALPHA, epic: 'demo', num: 1, state: 'done' }, sent: null, stable: null })
    if (ready?.kind === 'item') expect(ready.prepared.map((item) => item.text)).toEqual(['Unit test green.'])
    expect([treeState(alpha), treeState(beta)]).toEqual(before)
    // One epic-status read of each working tree by the hub's watcher, none with --ref; asking again and marking a
    // decision read nothing more, and no gh ever runs.
    const reads = () => readFileSync(process.env.STUB_LOG!, 'utf8').split('\n').filter(Boolean)
    expect(reads()).toEqual(['.', '.'])
    await get(makeWindow(2))
    service.markSent(ALPHA, { epic: 'demo', num: 1, item: 1, verdict: 'pass' })
    await get(makeWindow(3))
    expect(reads()).toEqual(['.', '.'])
    expect(readFileSync(ghLog, 'utf8')).toBe('')
  })

  it('an edit of a Ticket file gives acceptance.changed with the new queue', async () => {
    const service = makeService()
    await register(service)
    const window = makeWindow(1)
    await get(window)
    const file = join(alpha, '.scratch', 'demo', 'issues', '01-first.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace('- [ ] (manual) The chip', '- [x] (manual) The chip'))
    await vi.waitFor(() => expect(shape(window.sent.at(-1)).ready).toEqual([]), { timeout: ms(15_000), interval: 50 })
    expect(shape(window.sent.at(-1)).work).toEqual(['Alpha 02.1'])
  })
})

describe('a Linked machine', () => {
  it('gets no row of a Project kept on this Machine only, neither in the answer nor in acceptance.changed', async () => {
    localOnly = new Set([BETA])
    // Beta's first read ends before Alpha's, as it may on a loaded machine: the queue the service computes in between
    // has Beta's rows only, and a Linked machine gets it without them.
    let betaOpened: Promise<unknown> = Promise.resolve()
    const service = makeService({
      open: (root, subscriber) => {
        const opened = hub.open(root, subscriber)
        if (root === beta) {
          betaOpened = opened
          return opened
        }
        return opened.then(async (model) => {
          await betaOpened
          await new Promise((settle) => setTimeout(settle, 0))
          return model
        })
      },
      close: (root, id) => hub.close(root, id),
      model: (root) => hub.model(root),
    })
    await register(service)
    const linked = makeWindow('link:machine-b/1')
    const window = makeWindow(1)
    const projectsOf = (state: AcceptanceState | undefined) => [...new Set(state?.groups.flatMap((group) => group.rows.map((row) => row.ticket.projectId)))].sort()
    expect(projectsOf(await get(linked))).toEqual([ALPHA])
    // A window of this Machine sees it.
    expect(projectsOf(await get(window))).toEqual([ALPHA, BETA])

    const betaFile = join(beta, '.scratch', 'demo', 'issues', '02-failed.md')
    writeFileSync(betaFile, readFileSync(betaFile, 'utf8').replace('# 02 — Ticket 2', '# 02 — Ticket two'))
    await vi.waitFor(() => expect(rowOf(window.sent.at(-1), 'Beta 02.1')?.ticket.title).toContain('Ticket two'), { timeout: ms(15_000), interval: 50 })
    const alphaFile = join(alpha, '.scratch', 'demo', 'issues', '01-first.md')
    writeFileSync(alphaFile, readFileSync(alphaFile, 'utf8').replace('- [ ] (manual) The chip', '- [x] (manual) The chip'))
    await vi.waitFor(() => expect(shape(linked.sent.at(-1)).ready).toEqual([]), { timeout: ms(15_000), interval: 50 })
    expect(projectsOf(linked.sent.at(-1))).toEqual([ALPHA])
    // Every event, a partial one from the first reads too: none carries a row of Beta.
    expect(linked.sent.length).toBeGreaterThan(1)
    for (const state of linked.sent) expect(projectsOf(state)).not.toContain(BETA)
  })
})

describe('Sent', () => {
  it('outlives a new instance of the service, turns Not recorded yet after 24 hours, and goes with an owner-check line of the same verdict', async () => {
    const first = makeService()
    await register(first)
    await get(makeWindow(1))
    first.markSent(ALPHA, { epic: 'demo', num: 1, item: 1, verdict: 'pass' })
    expect(rowOf(await get(makeWindow(1)), 'Alpha 01.1')).toMatchObject({ sent: { verdict: 'pass', state: 'sent' } })
    const saved = readFileSync(join(data, ALPHA, 'acceptance-sent.json'), 'utf8')
    // Project, Epic, Ticket, item, the hash of its text, verdict and time; never the owner's words or the item's text.
    expect(JSON.parse(saved)).toMatchObject({ sent: [{ projectId: ALPHA, epic: 'demo', num: 1, item: 1, verdict: 'pass', at: '2026-11-23T12:00:00.000Z' }] })
    expect(saved).not.toContain('chip')
    await first.stop()

    now += 25 * HOUR
    const second = makeService()
    await register(second)
    const window = makeWindow(2)
    expect(rowOf(await get(window), 'Alpha 01.1')).toMatchObject({ sent: { verdict: 'pass', state: 'not-recorded' } })

    // A line of the other verdict is not the one sent: the mark stays.
    const file = join(alpha, '.scratch', 'demo', 'issues', '01-first.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace('- [ ] (manual) The chip shows the server.', `- [ ] (manual) The chip shows the server.\n${OWNER_FAIL}`))
    await vi.waitFor(() => expect(shape(window.sent.at(-1)).failed).toContain('Alpha 01.1'), { timeout: ms(15_000), interval: 50 })
    expect(rowOf(window.sent.at(-1), 'Alpha 01.1')).toMatchObject({ sent: { verdict: 'pass' } })

    writeFileSync(file, readFileSync(file, 'utf8').replace(OWNER_FAIL, `${OWNER_FAIL}\n${OWNER_PASS}`))
    await vi.waitFor(() => expect(shape(window.sent.at(-1)).failed).toEqual(['Beta 02.1']), { timeout: ms(15_000), interval: 50 })
    expect(JSON.parse(readFileSync(join(data, ALPHA, 'acceptance-sent.json'), 'utf8'))).toEqual({ sent: [] })
  })

  it('a Fail sent on an item that already failed waits for a new fail line, not the old one', async () => {
    const service = makeService()
    await register(service)
    const window = makeWindow(1)
    await get(window)
    service.markSent(BETA, { epic: 'demo', num: 2, item: 1, verdict: 'fail' })
    const file = join(beta, '.scratch', 'demo', 'issues', '02-failed.md')
    // An unrelated edit of the Ticket: the old fail line is still the only one.
    writeFileSync(file, readFileSync(file, 'utf8').replace('# 02 — Ticket 2', '# 02 — Ticket two'))
    await vi.waitFor(() => expect(rowOf(window.sent.at(-1), 'Beta 02.1')?.ticket.title).toContain('Ticket two'), { timeout: ms(15_000), interval: 50 })
    expect(rowOf(window.sent.at(-1), 'Beta 02.1')).toMatchObject({ sent: { verdict: 'fail', state: 'sent' } })
    writeFileSync(file, readFileSync(file, 'utf8').replace(OWNER_FAIL, `${OWNER_FAIL}\n${OWNER_FAIL.replace('no chip', 'still no chip')}`))
    await vi.waitFor(() => expect(rowOf(window.sent.at(-1), 'Beta 02.1')).toMatchObject({ sent: null }), { timeout: ms(15_000), interval: 50 })
  })

  it('refuses to mark an item that does not wait for the owner', async () => {
    const service = makeService()
    await register(service)
    await get(makeWindow(1))
    expect(() => service.markSent(ALPHA, { epic: 'demo', num: 1, item: 2, verdict: 'pass' })).toThrow(/not a manual item that waits for the owner/)
    expect(() => service.markSent(ALPHA, { epic: 'demo', num: 9, item: 1, verdict: 'pass' })).toThrow(/no Ticket demo 09/)
  })
})
