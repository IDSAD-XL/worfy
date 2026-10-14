// The handlers of the `terminal` domain as the app wires them (the default export of
// src/main/ipc/terminal.ts), for what worfy-windows ticket 10 added: the shell of a new Terminal
// comes from the settings of its Project, and terminal.shells lists the shells found in the agent
// environment. The stores, the environment and the registry are replaced; the wiring is the real one.
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { TERMINAL_NODE_KIND } from '../../src/shared/ipc/terminal'
import { APP_URL } from '../app-url'

const PROJECT = 'demo-00000001'
const OTHER = 'other-00000002'

const seen = vi.hoisted(() => ({
  /** What each registry.open was given: the key and what its `shell` answers. */
  opens: [] as { key: string; cwd: string; shell: unknown }[],
  settingsRead: [] as string[],
  optionsFor: [] as unknown[],
}))

vi.mock('electron', () => ({ app: { on: vi.fn(), quit: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../src/main/clients', () => ({ clientOf: () => ({ isDestroyed: () => false, once: () => undefined }) }))
vi.mock('../../src/main/agent/env', async (original) => ({
  ...(await original<typeof import('../../src/main/agent/env')>()),
  agentEnv: () => Promise.resolve({ env: { MARK: 'the agent environment' } }),
}))
vi.mock('../../src/main/projects/store', () => ({
  projectStore: () => ({
    get: (id: string) => ({ id, path: `/projects/${id}` }),
    dataDir: (id: string) => `/data/${id}`,
    list: () => [{ id: 'demo-00000001' }, { id: 'other-00000002' }],
    onChange: () => undefined,
  }),
}))
vi.mock('../../src/main/layout/store', () => ({
  layoutStore: () => ({ get: () => ({ layout: { nodes: [{ id: 'node-1', kind: 'terminal' }] } }), onChange: () => undefined }),
}))
vi.mock('../../src/main/projects/settings', () => ({
  readProjectSettings: (dataDir: string) => {
    seen.settingsRead.push(dataDir)
    return { actionTemplates: { shipTicket: '', runWave: '' }, ...(dataDir === '/data/demo-00000001' ? { terminalShell: 'git-bash' } : {}) }
  },
}))
vi.mock('../../src/main/terminal/pty', async (original) => ({
  ...(await original<typeof import('../../src/main/terminal/pty')>()),
  terminalShellOptions: (env: unknown) => {
    seen.optionsFor.push(env)
    return [{ id: 'git-bash', label: 'Git Bash', found: false }]
  },
  TerminalRegistry: class {
    size = 0
    open(key: string, request: { cwd: string; shell?: () => unknown }) {
      // As the registry of Windows does when it starts the shell.
      seen.opens.push({ key, cwd: request.cwd, shell: request.shell?.() })
      return Promise.resolve({ pid: 4242, shell: 'bash.exe', replay: '', end: 0, started: true, exited: null })
    }
  },
}))

const { registerIpc } = await import('../../src/main/ipc/index')
const { default: terminalModule, terminalKey } = await import('../../src/main/ipc/terminal')

type Listener = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

async function wired() {
  const handlers = new Map<string, Listener>()
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as Listener) }, { modules: { './terminal.ts': () => Promise.resolve(terminalModule) }, isTrustedSender: (url) => url === APP_URL })
  return async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

beforeEach(() => {
  seen.opens.length = 0
  seen.settingsRead.length = 0
  seen.optionsFor.length = 0
})

describe('the terminal handlers as the app wires them', () => {
  it('uses the kind of a Terminal Node the mocked Layout has', () => {
    expect(TERMINAL_NODE_KIND).toBe('terminal')
  })

  it('terminal.open gives the registry the shell of the settings of that Project, read from its data folder', async () => {
    const call = await wired()
    expect((await call('terminal.open', { projectId: PROJECT, nodeId: 'node-1', cols: 80, rows: 24 })).ok).toBe(true)
    expect((await call('terminal.open', { projectId: OTHER, nodeId: 'node-1', cols: 80, rows: 24 })).ok).toBe(true)
    expect(seen.opens).toEqual([
      { key: terminalKey(PROJECT, 'node-1'), cwd: `/projects/${PROJECT}`, shell: 'git-bash' },
      { key: terminalKey(OTHER, 'node-1'), cwd: `/projects/${OTHER}`, shell: undefined },
    ])
    expect(seen.settingsRead).toEqual([`/data/${PROJECT}`, `/data/${OTHER}`])
  })

  it('terminal.shells lists the shells found in the agent environment', async () => {
    const call = await wired()
    expect(await call('terminal.shells')).toEqual({ ok: true, value: [{ id: 'git-bash', label: 'Git Bash', found: false }] })
    expect(seen.optionsFor).toEqual([{ MARK: 'the agent environment' }])
    // Listing reads no settings and starts nothing.
    expect(seen.settingsRead).toEqual([])
    expect(seen.opens).toEqual([])
  })
})
