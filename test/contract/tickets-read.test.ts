// The `tickets.read` channel in main: src/main/ipc/tickets.ts registered through registerIpc (the
// same wrapper the app uses) over a mocked `electron`, against Ticket files in a temporary folder.
// The Project's layout is a stand-in for the `profile` call (src/main/workflow/folder.ts): Full mode
// with the Tickets under the repository, and Silent mode with them in a Workflow folder outside it.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessOf, IPC_CHANNEL_PREFIX, useOf, type IpcResult } from '../../src/shared/ipc/channels'
import { ticketsRead } from '../../src/shared/ipc/tickets'
import type { ProjectLayout } from '../../src/main/workflow/folder'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

const PROJECT_ID = 'repo-00000033'

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), openExternal: vi.fn() } }))

const layouts = vi.hoisted(() => ({ byRoot: new Map<string, ProjectLayout>() }))
vi.mock('../../src/main/workflow/folder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/workflow/folder')>()
  return {
    ...actual,
    projectLayouts: () => ({
      get: (root: string) => {
        const layout = layouts.byRoot.get(root)
        if (layout === undefined) throw new Error(`no layout for ${root}`)
        return Promise.resolve(layout)
      },
    }),
  }
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let repo: string
let workflow: string
let outside: string
let handlers: Map<string, Listener>

const full = (root: string): ProjectLayout => ({ root, mode: 'full', workflowFolder: root, ticketsRoot: join(root, '.scratch'), repos: [], workspace: null, reason: null, failed: false })
const silent = (root: string, folder: string): ProjectLayout => ({ root, mode: 'silent', workflowFolder: folder, ticketsRoot: join(folder, '.scratch'), repos: [], workspace: null, reason: null, failed: false })

async function call(input: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + 'tickets.read')
  if (!listener) throw new Error('no handler for tickets.read')
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function refused(input: unknown, reason: RegExp): Promise<void> {
  const result = await call(input)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(reason)
}

const ticket = (epic: string, num: number, slug: string) => ({ projectId: PROJECT_ID, epic, num, slug })

function writeTicket(ticketsRoot: string, epic: string, file: string, text: string): string {
  const dir = join(ticketsRoot, epic, 'issues')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), text)
  return join(dir, file)
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-tickets-')))
  repo = join(scratch, 'repo')
  workflow = join(scratch, 'workflow')
  outside = join(scratch, 'outside')
  mkdirSync(repo)
  mkdirSync(workflow)
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.md'), 'not the Project')
  layouts.byRoot.clear()
  layouts.byRoot.set(repo, full(repo))

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'repo', path: repo }], activeId: PROJECT_ID }))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './tickets.ts': () => import('../../src/main/ipc/tickets').then((module) => module.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

describe('tickets.read', () => {
  it('is a read-only Project channel, so a window on a Linked machine reads the file on that Machine', () => {
    expect(ticketsRead.name).toBe('tickets.read')
    expect(accessOf('tickets.read')).toBe('project')
    expect(useOf('tickets.read')).toBe('read')
  })

  it('reads a Ticket of the Project in Full mode by number and slug, and answers with its real path', async () => {
    const file = writeTicket(join(repo, '.scratch'), 'e', '07-rate-limit.md', '# 07 — Rate limit\n\nStatus: open\n\nThe body.\n')
    writeTicket(join(repo, '.scratch'), 'e', '07-other.md', '# 07 — Other\n')
    expect(await call(ticket('e', 7, 'rate-limit'))).toStrictEqual({ ok: true, value: { path: file, text: '# 07 — Rate limit\n\nStatus: open\n\nThe body.\n' } })
  })

  it('finds the file by the number as epic-status reads it: 007 and 7 are Ticket 7', async () => {
    const file = writeTicket(join(repo, '.scratch'), 'e', '007-s.md', 'seven')
    expect(await call(ticket('e', 7, 's'))).toStrictEqual({ ok: true, value: { path: file, text: 'seven' } })
  })

  it('reads a Ticket of a Silent Project from the Tickets root of its Workflow folder, outside the repository', async () => {
    layouts.byRoot.set(repo, silent(repo, workflow))
    // A file of the same name in the repository is not the Ticket in Silent mode.
    writeTicket(join(repo, '.scratch'), 'e', '01-a.md', 'the repository copy')
    const file = writeTicket(join(workflow, '.scratch'), 'e', '01-a.md', 'the Workflow folder copy')
    expect(await call(ticket('e', 1, 'a'))).toStrictEqual({ ok: true, value: { path: file, text: 'the Workflow folder copy' } })
  })

  it('refuses a Ticket file that is a link out of the Project and its Workflow folder', async () => {
    mkdirSync(join(repo, '.scratch', 'e', 'issues'), { recursive: true })
    symlinkSync(join(outside, 'secret.md'), join(repo, '.scratch', 'e', 'issues', '01-a.md'))
    await refused(ticket('e', 1, 'a'), /outside the Project/)
  })

  it('refuses an issues folder that is a link out of the Project', async () => {
    mkdirSync(join(outside, 'issues'))
    writeFileSync(join(outside, 'issues', '01-a.md'), 'not the Project')
    mkdirSync(join(repo, '.scratch', 'e'), { recursive: true })
    symlinkSync(join(outside, 'issues'), join(repo, '.scratch', 'e', 'issues'))
    await refused(ticket('e', 1, 'a'), /Ticket folder of e cannot be read: .*outside the Project/)
  })

  it('reads a link from the Tickets into another file of the same Project', async () => {
    writeFileSync(join(repo, 'notes.md'), 'kept elsewhere in the Project')
    mkdirSync(join(repo, '.scratch', 'e', 'issues'), { recursive: true })
    symlinkSync(join(repo, 'notes.md'), join(repo, '.scratch', 'e', 'issues', '01-a.md'))
    expect(await call(ticket('e', 1, 'a'))).toStrictEqual({ ok: true, value: { path: join(repo, 'notes.md'), text: 'kept elsewhere in the Project' } })
  })

  it.each([
    ['..', /epic/],
    ['.', /epic/],
    ['e/../../outside', /epic/],
    ['..\\outside', /epic/],
    ['', /epic/],
  ])('refuses the Epic name %j before any file is read', async (epic, reason) => {
    await refused(ticket(epic, 1, 'a'), reason)
  })

  it('refuses a slug that names a file in another folder: only the entries of the issues folder are matched', async () => {
    writeTicket(join(repo, '.scratch'), 'e', '01-a.md', 'a')
    await refused(ticket('e', 1, '../../../outside/secret'), /does not exist/)
  })

  it('refuses a Ticket that is not there, and an Epic without an issues folder', async () => {
    writeTicket(join(repo, '.scratch'), 'e', '01-a.md', 'a')
    await refused(ticket('e', 2, 'b'), /e\/issues\/02-b\.md does not exist/)
    await refused(ticket('none', 1, 'a'), /Ticket folder of none cannot be read: .*does not exist/)
  })

  it('refuses a Ticket file over 1 MB and reads one of exactly 1 MB', async () => {
    writeTicket(join(repo, '.scratch'), 'e', '01-big.md', 'x'.repeat(1024 * 1024 + 1))
    await refused(ticket('e', 1, 'big'), /larger than 1048576 bytes/)
    writeTicket(join(repo, '.scratch'), 'e', '02-edge.md', 'x'.repeat(1024 * 1024))
    const result = await call(ticket('e', 2, 'edge'))
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.value as { text: string }).text).toHaveLength(1024 * 1024)
  })

  it('refuses a folder named like a Ticket', async () => {
    mkdirSync(join(repo, '.scratch', 'e', 'issues', '01-a.md'), { recursive: true })
    await refused(ticket('e', 1, 'a'), /is not a file/)
  })

  it('answers with the reason when where the workflow lives is unknown', async () => {
    writeTicket(join(repo, '.scratch'), 'e', '01-a.md', 'a')
    layouts.byRoot.set(repo, { ...full(repo), failed: true, reason: 'the profile script failed with exit code 127' })
    await refused(ticket('e', 1, 'a'), /could not ask the Harness where the workflow of this Project lives: the profile script failed with exit code 127/)
  })

  it('refuses an unknown Project', async () => {
    await refused({ ...ticket('e', 1, 'a'), projectId: 'nope-00000000' }, /nope-00000000/)
  })
})
