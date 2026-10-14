// `projects.hold` on the Machine of a Project (worfy-link ticket 09): a screen of a Linked machine
// shows a Project of this Machine, which then keeps its documents open (src/main/ipc/docs.ts) and
// opens its Orchestrator (src/main/agent/app-orchestrators.ts) as for its active Project — without
// changing the active Project; a client that leaves lets go. The real handler modules of projects
// and docs over registerIpc, a mocked `electron`, a temporary WORFY_DATA_DIR; the Orchestrators are
// replaced by a recorder (a real one would start a Session).
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { removeTestTree, saveLayoutNow } from '../remove'

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-projects-hold-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude-home')
  return { scratch }
})

const electron = vi.hoisted(() => ({ listeners: new Map<string, (() => void)[]>() }))

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => electron.listeners.set(event, [...(electron.listeners.get(event) ?? []), listener]),
    isPackaged: false,
    getAppPath: () => '/',
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
}))
// The app runs the Harness scripts with the login shell environment; a test does not start the
// login shell of the machine it runs on, so the scripts get this process's environment here.
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const opened = vi.hoisted(() => [] as string[])

vi.mock('../../src/main/agent/orchestrator', () => ({
  Orchestrators: class {
    open(projectId: string): Promise<unknown> {
      opened.push(projectId)
      return Promise.resolve({})
    }
    retain(): void {}
  },
}))

const ACTIVE = 'active-0000000a'
const SHOWN = 'shown-0000000b'

const dataDir = join(env.scratch, 'data')
for (const name of ['active', 'shown']) {
  mkdirSync(join(env.scratch, name), { recursive: true })
  writeFileSync(join(env.scratch, name, 'HANDOFF.md'), `# ${name}\n`)
}
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      { id: ACTIVE, name: 'active', path: realpathSync(join(env.scratch, 'active')) },
      { id: SHOWN, name: 'shown', path: realpathSync(join(env.scratch, 'shown')) },
    ],
    activeId: ACTIVE,
  }),
)

const { registerIpc } = await import('../../src/main/ipc/index')
const { docsHub } = await import('../../src/main/ipc/docs')
const { startOrchestrators } = await import('../../src/main/agent/app-orchestrators')
startOrchestrators()

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
const handlers = new Map<string, Listener>()
await registerIpc(
  { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
  {
    modules: {
      './projects.ts': () => import('../../src/main/ipc/projects').then((module) => module.default),
      './docs.ts': () => import('../../src/main/ipc/docs').then((module) => module.default),
    },
    isTrustedSender: (url) => url.startsWith('worfy-link://'),
  },
)

/** A client without a window, as the connection of a Linked machine is one (src/main/clients.ts). */
class LinkClient extends EventEmitter {
  private gone = false
  constructor(readonly id: string) {
    super()
  }
  send(): void {}
  isDestroyed(): boolean {
    return this.gone
  }
  destroy(): void {
    this.gone = true
    this.emit('destroyed')
  }
}

async function hold(client: LinkClient, screen: string, projectId: string | null): Promise<IpcResult<unknown>> {
  const listener = handlers.get(`${IPC_CHANNEL_PREFIX}projects.hold`)
  if (!listener) throw new Error('projects.hold is not registered')
  const event = { senderFrame: { url: 'worfy-link://0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11' }, sender: client } as unknown as IpcMainInvokeEvent
  return (await listener(event, { screen, projectId })) as IpcResult<unknown>
}

const activeOnDisk = (): string | null => (JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { activeId: string | null }).activeId

afterAll(async () => {
  await docsHub.closeAll()
  // The file left its folder in the temporary folder of the user (worfy-windows ticket 26).
  await saveLayoutNow()
  removeTestTree(env.scratch)
})

describe('projects.hold', () => {
  it('keeps the documents of a shown Project open and opens its Orchestrator; the active Project stays', async () => {
    const client = new LinkClient('link:0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11/1')
    expect(await hold(client, '7', SHOWN)).toEqual({ ok: true, value: { projectId: SHOWN } })
    await vi.waitFor(() => expect(docsHub.projects).toContain(SHOWN))
    await vi.waitFor(() => expect(opened).toContain(SHOWN))
    expect(activeOnDisk()).toBe(ACTIVE)

    // A second screen of the same client on the same Project, then the first lets go: still held.
    await hold(client, '8', SHOWN)
    await hold(client, '7', null)
    expect(docsHub.projects).toContain(SHOWN)
    // The last screen lets go: the documents close.
    await hold(client, '8', null)
    await vi.waitFor(() => expect(docsHub.projects).not.toContain(SHOWN))
  })

  it('a client that leaves lets go of every Project it held', async () => {
    const client = new LinkClient('link:0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11/2')
    await hold(client, '1', SHOWN)
    await vi.waitFor(() => expect(docsHub.projects).toContain(SHOWN))
    client.destroy()
    await vi.waitFor(() => expect(docsHub.projects).not.toContain(SHOWN))
    // Gone, it holds nothing any more.
    expect(await hold(client, '1', SHOWN)).toMatchObject({ ok: false })
    expect(docsHub.projects).not.toContain(SHOWN)
  })

  it('refuses a Project that is not on the list', async () => {
    const result = await hold(new LinkClient('link:0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11/3'), '1', 'nope-00000000')
    expect(result.ok).toBe(false)
  })
})
