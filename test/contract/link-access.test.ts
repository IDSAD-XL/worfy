// What a Linked machine may do with the Projects of this Machine (worfy-link ticket 08; ADR-0052,
// point 6). Two Machines on the link bench (test/contract/link-bench.ts): A calls, B owns the
// Project. B serves the real handler modules of its Projects, Layout, hubs and Terminal over a
// mocked `electron`, a temporary WORFY_DATA_DIR and a temporary WORFY_CLAUDE_HOME; the connection's
// client joins B's real clients (src/main/broadcast.ts).
//
// Never run here: a real Claude Code or Agent SDK (agent.start is a counting stand-in), a native
// dialog or the OS shell (both mocked), the network beyond 127.0.0.1, Bonjour.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_PATH } from '../../src/main/agent/env'
import type { SessionRegistry } from '../../src/main/agent/session'
import { addClient, clients } from '../../src/main/broadcast'
import { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import { agentHandlers } from '../../src/main/ipc/agent'
import { checksHandlers, type ChecksService } from '../../src/main/ipc/checks'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { bindingsHandlers } from '../../src/main/ipc/bindings'
import { docsHub } from '../../src/main/ipc/docs'
import { pipelineHandlers } from '../../src/main/ipc/pipeline'
import { defineHandler, emit, registerIpc, type HandlerModule, type ModuleLoader } from '../../src/main/ipc/index'
import { terminalHandlers } from '../../src/main/ipc/terminal'
import { setViewState } from '../../src/main/ipc/view'
import { workflowHub } from '../../src/main/ipc/workflow'
import { BindingStore } from '../../src/main/layout/bindings'
import { layoutStore } from '../../src/main/layout/store'
import { LinkSender, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { LINK_PROTOCOL_VERSION } from '../../src/main/link/messages'
import { projectStore } from '../../src/main/projects/store'
import { HarnessScriptStartError, type ProfileRun } from '../../src/main/workflow/profile'
import { TerminalRegistry } from '../../src/main/terminal/pty'
import { autopilotStart } from '../../src/shared/ipc/autopilot'
import { cardApiConfirm } from '../../src/shared/ipc/card-api'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AccessLevel } from '../../src/shared/ipc/link'
import { limitsChanged } from '../../src/shared/ipc/limits'
import { notifyOpen } from '../../src/shared/ipc/notify'
import { trashList } from '../../src/shared/ipc/trash'
import type { LayoutOpInput } from '../../src/shared/layout/types'
import { LinkBench, type BenchMachine } from './link-bench'
import { windowsProfileEnv } from '../e2e/terminal-shell'
import { nodeScript } from '../harness-node'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the workflow hub takes the Claude home at import.
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-link-access-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude-home')
  return { scratch }
})

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
  openPath: vi.fn(async () => ''),
  openExternal: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: electron.showOpenDialog, showMessageBox: electron.showMessageBox },
  shell: { openPath: electron.openPath, openExternal: electron.openExternal },
}))
// The app runs the Harness scripts with the login shell environment; a test does not start the
// login shell of the machine it runs on, so the scripts get this process's environment here.
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const PROJECT = 'demo-0a1b2c3d'
const OTHER = 'other-0a1b2c3e'
const NODE = 'terminal-1'
const CLAUDE_HOME_FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'claude-home')

const dataDir = join(env.scratch, 'data')
const repo = join(env.scratch, 'demo')
const home = join(env.scratch, 'shell-home')
/** A folder outside every Project of B, with a file a Linked machine must not read. */
const outside = join(env.scratch, 'outside')
/** A second repository, not in B's list: what projects.add brings in. */
const second = join(env.scratch, 'second')
const attachmentsDir = join(env.scratch, 'attachments')

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo epic\n\ntext\n')
writeFileSync(join(repo, '.scratch', 'demo', 'issues', '01-first.md'), '# 01 — first\n\nStatus: open\n')
writeFileSync(join(repo, 'HANDOFF.md'), '# Handoff\n')
git(repo, 'init', '-q')
git(repo, 'add', '.')
git(repo, 'commit', '-q', '-m', 'init')
mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'secret.txt'), 'not a Project file')
// Inside the Project, a symbolic link that leads out of it.
symlinkSync(outside, join(repo, 'out-link'))
mkdirSync(join(second, 'src'), { recursive: true })
writeFileSync(join(second, 'README.md'), 'second')
git(second, 'init', '-q')
git(second, 'add', '.')
git(second, 'commit', '-q', '-m', 'init')
mkdirSync(join(dataDir, PROJECT), { recursive: true })
mkdirSync(join(dataDir, OTHER), { recursive: true })
// The workflow reader asks the Harness's epic-status (src/main/workflow/reader.ts); this stand-in
// answers with Ticket 01 of Epic `demo` in the state its file says. A Node script, as the Harness's
// own: worfy starts it as `node <script>`, and on Windows it runs no `#!/bin/sh` one (test/harness-node.ts).
mkdirSync(join(env.scratch, 'claude-home', 'bin'), { recursive: true })
writeFileSync(
  join(env.scratch, 'claude-home', 'bin', 'epic-status'),
  nodeScript(
    [
      "const statuses = fs.readFileSync('.scratch/demo/issues/01-first.md', 'utf8').split(/\\r?\\n/).filter((line) => line.startsWith('Status: '))",
      "const status = (statuses.at(-1) ?? '').slice('Status: '.length)",
      "const state = status.startsWith('blocked') ? 'blocked' : 'open'",
      "const ticket = { epic: 'demo', num: 1, slug: 'first', title: '01 first', statusRaw: status, state, blockedRaw: null, blockedNums: [], blockedParsed: true, ref: '.' }",
      "process.stdout.write(JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [ticket] }))",
    ].join('\n'),
  ),
  { mode: 0o755 },
)
mkdirSync(home, { recursive: true })
writeFileSync(
  join(dataDir, 'projects.json'),
  JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }, { id: OTHER, name: 'other', path: join(env.scratch, 'other') }], activeId: PROJECT }),
)
const projectsFileBefore = readFileSync(join(dataDir, 'projects.json'), 'utf8')
/**
 * The Project folder in the spelling the disk has: what B works in for A's call
 * (src/main/link/caller.ts). On Windows `repo` may be spelled otherwise — TEMP under the 8.3 short
 * name of a long account name (C:\Users\RUNNER~1\…), or on a subst drive — and the call is served
 * all the same, in this spelling.
 */
const realRepo = realpathSync.native(repo)

// ---- B's handlers ------------------------------------------------------------------------------

/**
 * The Terminal of B: real shells (/bin/sh with an empty HOME; PowerShell on Windows), one per Node.
 * On Windows the environment keeps SystemRoot and windir: PowerShell does not start without them
 * (error 8009001d at loading its managed shell). It also names the empty HOME as the user's profile
 * (windowsProfileEnv): without USERPROFILE and APPDATA PowerShell falls back to the profile of the
 * signed-in user, read that user's $PROFILE and appended the typed commands to their PSReadLine
 * history (worfy-windows ticket 84).
 */
const windowsRoot: Record<string, string> = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '', windir: process.env.windir ?? process.env.SystemRoot ?? '' } : {}
const terminals = new TerminalRegistry({
  env: () => Promise.resolve({ ...windowsRoot, ...windowsProfileEnv(home), SHELL: '/bin/sh', PATH: SYSTEM_PATH, HOME: home, PS1: '$ ' }),
  killGraceMs: 1000,
})
const claudeHome = new ClaudeHomeRegistry({ home: CLAUDE_HOME_FIXTURE, listWorktrees: async () => [], isAlive: async () => false })
/** The change callbacks of the Claude home watchers: a test calls one to stand for a file change. */
const claudeHomeWatchers: ((change: { sessions: boolean; transcripts: string[] }) => void)[] = []
const watch = claudeHome.watch.bind(claudeHome)
vi.spyOn(claudeHome, 'watch').mockImplementation((root, onChange, options) => {
  claudeHomeWatchers.push(onChange)
  return watch(root, onChange, options)
})
const claudeHomeSubscriptions = new ClaudeHomeSubscriptions(claudeHome, new Set())
const bindings = new BindingStore((projectId) => join(dataDir, projectId))

/** Stand-ins that count their calls: a Session that would start Claude, a dialog of a Card. */
const calls = { agentStart: 0, trashList: 0, autopilotStart: 0 }
/** The folders the stand-in Session registry was asked to start Claude Code in. */
const startedIn: string[] = []
/** A Session registry that starts nothing: the real agent handlers run over it. */
const sessions = new Map<string, { cwd: string }>()
const fakeSessions = {
  start: (cwd: string) => {
    calls.agentStart += 1
    startedIn.push(cwd)
    const id = `session-${calls.agentStart}`
    sessions.set(id, { cwd })
    return { id }
  },
  get: (id: string) => {
    const session = sessions.get(id)
    if (session === undefined) throw new Error(`No Session ${id}`)
    return session
  },
} as unknown as SessionRegistry
/** The checks of a Project without gate or GitHub: what the guard lets through answers empty. */
const fakeChecks: ChecksService = {
  gate: { read: async () => [] } as unknown as ChecksService['gate'],
  prs: { read: async () => ({ pulls: [], gh: { available: false, error: null, intervalMs: 60_000 } }) } as unknown as ChecksService['prs'],
  worktrees: async () => [],
}
/**
 * The Profile the Pipeline editor's stand-in of bin/profile-set writes (worfy-pipeline ticket 08),
 * and the arguments of each run of the stand-in.
 */
const pipelineProfile = join(env.scratch, 'harness-home', 'projects', 'demo', 'profile.json')
mkdirSync(join(env.scratch, 'harness-home', 'projects', 'demo'), { recursive: true })
writeFileSync(pipelineProfile, '{"schema":2,"name":"demo","mode":"full"}\n')
const profileSetRuns: string[][] = []
/** bin/profile-set as the handler starts it: --read answers the default Pipeline, --set writes the Profile. */
/** What the stand-in does instead, for one test: an exit code of the script, or a failure to start it. */
let profileSetInstead: ((args: readonly string[]) => Promise<ProfileRun>) | null = null
const profileSetStandIn = async (args: readonly string[], stdin?: string): Promise<ProfileRun> => {
  profileSetRuns.push([...args])
  if (profileSetInstead !== null) return profileSetInstead(args)
  if (args.includes('--read')) return { code: 0, stdout: JSON.stringify({ pipeline: null, resolved: [{ kind: 'queued' }, { kind: 'done' }], fingerprint: null }), stderr: '' }
  const profile = JSON.parse(readFileSync(pipelineProfile, 'utf8')) as Record<string, unknown>
  writeFileSync(pipelineProfile, JSON.stringify({ ...profile, workflow: { pipeline: JSON.parse(stdin ?? 'null') } }))
  return { code: 0, stdout: JSON.stringify({ written: true, fingerprint: `sha256:${'a'.repeat(64)}`, warning: null }), stderr: '' }
}
/** The Stages are not what these tests look at: a hub that computes nothing. */
const pipelineHubStandIn = {
  open: async () => ({ root: repo, pipeline: [], tickets: [], error: null }),
  close: async () => true,
  drop: async () => undefined,
}

/** Holds trash.list until the test lets it go: a call that is running when access goes off. */
let holdTrashList: Promise<void> = Promise.resolve()

const realModule =
  (load: () => Promise<{ default: HandlerModule }>): ModuleLoader =>
  () =>
    load().then((module) => module.default)

const modules: Record<string, ModuleLoader> = {
  './link.ts': realModule(() => import('../../src/main/ipc/link')),
  './projects.ts': realModule(() => import('../../src/main/ipc/projects')),
  './layout.ts': realModule(() => import('../../src/main/ipc/layout')),
  './view.ts': realModule(() => import('../../src/main/ipc/view')),
  './shell.ts': realModule(() => import('../../src/main/ipc/shell')),
  './workflow.ts': realModule(() => import('../../src/main/ipc/workflow')),
  './docs.ts': realModule(() => import('../../src/main/ipc/docs')),
  './claude-home.ts': async () => claudeHomeHandlers(claudeHome, claudeHomeSubscriptions),
  './bindings.ts': async () => bindingsHandlers(() => bindings, () => claudeHome),
  './terminal.ts': async () =>
    terminalHandlers({
      registry: () => terminals,
      projectRoot: (projectId) => {
        if (projectId !== PROJECT) throw new Error(`No Project with id ${projectId}`)
        return repo
      },
      isTerminalNode: (projectId, nodeId) => projectId === PROJECT && nodeId === NODE,
    }),
  './agent.ts': async () =>
    agentHandlers(
      () => fakeSessions,
      { target: (cwd) => ({ projectRoot: repo, cwd, attachmentsDir }), pickFiles: async () => [] },
      () => undefined,
    ),
  './checks.ts': async () => checksHandlers(fakeChecks),
  './pipeline.ts': async () => pipelineHandlers({ hub: pipelineHubStandIn, profileSet: profileSetStandIn }),
  './stand-ins.ts': async () =>
    [
      // As src/main/ipc/card-api.ts does: a native dialog on the screen of the Machine called.
      defineHandler(cardApiConfirm, async () => {
        await electron.showMessageBox()
        return { send: false }
      }),
      // Starting Autopilot would start an Orchestrator Session: this stand-in only counts.
      defineHandler(autopilotStart, () => {
        calls.autopilotStart += 1
        throw new Error('the stand-in of autopilot.start ran')
      }),
      defineHandler(trashList, async () => {
        calls.trashList += 1
        await holdTrashList
        return { entries: [] }
      }),
    ] satisfies HandlerModule,
}

// ---- the bench ---------------------------------------------------------------------------------

interface Received {
  channel: string
  payload: unknown
}

let bench: LinkBench | undefined
let a: BenchMachine
let b: BenchMachine
/** The IPC events A received over the connection from B. */
let received: Received[]
/** Every answer and event payload A saw, for the leak check. */
let seen: string[]
let bId: string

beforeEach(async () => {
  bench = new LinkBench({ ipcModules: modules, addClient })
  a = await bench.machine('alpha')
  b = await bench.machine('beta')
  await bench.link(a, b)
  bId = b.service.machine.id
  received = []
  seen = []
  a.service.on('ipc-event', ({ machineId, channel, payload }) => {
    if (machineId !== bId) return
    received.push({ channel, payload })
    seen.push(JSON.stringify(payload))
  })
  await a.service.connect(bId)
  calls.agentStart = 0
  startedIn.length = 0
  calls.trashList = 0
  calls.autopilotStart = 0
  claudeHomeWatchers.length = 0
  for (const spy of Object.values(electron)) spy.mockClear()
})

afterEach(async () => {
  const current = bench
  bench = undefined
  if (current === undefined) return
  // No token and no pairing code in the console output, an answer or an event A got.
  const leaks = current.leakedSecrets(seen)
  await current.close()
  await terminals.closeAll()
  await workflowHub.closeAll()
  await docsHub.closeAll()
  await claudeHomeSubscriptions.closeAll()
  expect(leaks).toEqual([])
})

afterAll(() => {
  removeTestTree(env.scratch)
})

/** A calls `channel` on B; the answer is kept for the leak check. */
async function callB(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const result = await a.service.call(bId, channel, input)
  seen.push(JSON.stringify(result))
  return result
}

const accessOff = { ok: false, error: 'Linked machines cannot work with the Projects of beta: access is off' }
const notOpen = (channel: string): IpcResult<unknown> => ({ ok: false, error: `${channel}: not open to Linked machines` })

/**
 * B's access for A: `off` turns B's switch "Linked machines can work with my Projects" off, `read`
 * and `all` turn it on with that level for A (worfy-link ticket 18).
 */
function setAccess(level: AccessLevel): void {
  b.service.settings.set({ projectsAccess: level !== 'off', machines: { [a.service.machine.id]: level } })
}

/** B's clients made for the connection from A: "link:<A's id>/<n>". */
function linkClientsOfB(): string[] {
  return clients
    .list()
    .map((client) => String(client.id))
    .filter((id) => id.startsWith(`link:${a.service.machine.id}/`))
}

/** Polls until `done` holds or `ms` pass (five seconds by default). */
async function until(done: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
}

/**
 * The longest wait for a shell of the Terminal: its prompt, then the answer to a line. The first
 * Windows PowerShell on a fresh Windows runner takes seconds to start.
 */
const SHELL_WAIT_MS = 30_000
/** A test that waits for a shell: three waits of SHELL_WAIT_MS at most, and the rest of the test. */
const SHELL_TEST_MS = 120_000
/**
 * The prompt of a shell in its output: `$ ` of /bin/sh (PS1 of the Terminal's environment above; `# `
 * when a login /bin/sh run as root takes PS1 from /etc/profile), `PS <folder>> ` of PowerShell. A line
 * is typed only after it: the shell then reads what it is given.
 */
const PROMPT = /[$#] |PS [^\r\n]*> /
/** The end of a shell's output, escapes written out, for a failure message: vitest cuts the value it shows. */
const tail = (output: string): string => JSON.stringify(output.slice(-1000))

const channelsReceived = (): string[] => received.map((event) => event.channel)
/** What A got of the Terminal's output. */
const outputOfA = (): string =>
  received
    .filter((event) => event.channel === 'terminal.output')
    .map((event) => (event.payload as { data: string }).data)
    .join('')
const note = (id: string): LayoutOpInput => ({ op: 'create', node: { id, kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: id } } }) as LayoutOpInput

// ---- the tests ---------------------------------------------------------------------------------

describe('access off (the default)', () => {
  it('refuses projects.list with "access is off"; link.ping answers', async () => {
    expect(b.service.settings.get().projectsAccess).toBe(false)
    expect(await callB('projects.list')).toEqual(accessOff)
    expect(await callB('link.ping')).toEqual({ ok: true, value: { id: bId, name: 'beta', protocol: LINK_PROTOCOL_VERSION, build: '0.2.0+bench' } })
    // The connection has no client among B's clients: no broadcast of B reaches A.
    expect(linkClientsOfB()).toEqual([])
  })

  it('refuses reading and writing alike, and what starts processes on B: no handler runs', async () => {
    const before = layoutStore().get(PROJECT).layout.nodes.length
    for (const [channel, input] of [
      ['layout.get', { projectId: PROJECT }],
      ['layout.apply', { projectId: PROJECT, op: note('off-1') }],
      ['agent.start', { cwd: repo }],
      ['terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 }],
      ['shell.openExternal', { url: 'https://example.com' }],
      ['projects.pickFolder', undefined],
      ['link.state', undefined],
      ['link.setAccess', { projectsAccess: true }],
      ['nobody.declares.this', undefined],
    ] as const) {
      expect(await callB(channel, input), channel).toEqual(accessOff)
    }
    expect(calls.agentStart).toBe(0)
    expect(terminals.size).toBe(0)
    expect(electron.openExternal).not.toHaveBeenCalled()
    expect(electron.showOpenDialog).not.toHaveBeenCalled()
    expect(layoutStore().get(PROJECT).layout.nodes.length).toBe(before)
    // A Linked machine cannot switch access on for itself.
    expect(b.service.settings.get().projectsAccess).toBe(false)
  })
})

describe('access on', () => {
  it('answers projects.list; layout.apply from A changes B\'s Layout, and A gets layout.changed', async () => {
    setAccess('all')
    const list = await callB('projects.list')
    expect(list).toMatchObject({ ok: true, value: { projects: expect.arrayContaining([expect.objectContaining({ id: PROJECT })]) } })

    expect(await callB('layout.apply', { projectId: PROJECT, op: note('from-a') })).toMatchObject({ ok: true })
    expect(layoutStore().get(PROJECT).layout.nodes.map((node) => node.id)).toContain('from-a')
    await until(() => channelsReceived().includes('layout.changed'))
    const change = received.find((event) => event.channel === 'layout.changed')
    expect(change?.payload).toMatchObject({ projectId: PROJECT, op: { op: 'create' } })
  })

  it('the connection joins B\'s clients as "link:<A>/<n>" when access goes on, leaves when it goes off, and comes back under a new id', async () => {
    setAccess('all')
    const first = linkClientsOfB()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatch(new RegExp(`^link:${a.service.machine.id}/\\d+$`))
    setAccess('off')
    expect(linkClientsOfB()).toEqual([])
    setAccess('all')
    const second = linkClientsOfB()
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first[0])
  })

  it('still refuses the `desktop` and `local` channels: no dialog, no OS shell, the active Project stays', async () => {
    setAccess('all')
    expect(await callB('projects.pickFolder')).toEqual(notOpen('projects.pickFolder'))
    expect(await callB('cardApi.confirm', { cardTitle: 'Card', recipientLabel: 'the Orchestrator', message: 'hi?' })).toEqual(notOpen('cardApi.confirm'))
    expect(await callB('shell.openExternal', { url: 'https://example.com' })).toEqual(notOpen('shell.openExternal'))
    expect(await callB('shell.openInEditor', { projectId: PROJECT, path: 'HANDOFF.md' })).toEqual(notOpen('shell.openInEditor'))
    expect(electron.showOpenDialog).not.toHaveBeenCalled()
    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(electron.openPath).not.toHaveBeenCalled()
    expect(electron.openExternal).not.toHaveBeenCalled()

    expect(await callB('projects.select', { id: OTHER })).toEqual(notOpen('projects.select'))
    expect(projectStore().active()?.id).toBe(PROJECT)
    expect(readFileSync(join(dataDir, 'projects.json'), 'utf8')).toBe(projectsFileBefore)

    // The link's own state, linking and the switch stay with B's screen.
    for (const channel of ['link.state', 'link.open', 'link.revoke', 'link.setAccess', 'view.get', 'app.version', 'notify.pending', 'limits.open']) {
      expect(await callB(channel, channel === 'link.revoke' ? { id: a.service.machine.id } : channel === 'link.setAccess' ? { projectsAccess: false } : undefined), channel).toEqual(notOpen(channel))
    }
    expect(b.service.isLinked(a.service.machine.id)).toBe(true)
    expect(b.service.settings.get().projectsAccess).toBe(true)
  })

  it('B\'s `local` events stay on B: view.changed reaches B\'s other clients, not the connection', async () => {
    setAccess('all')
    const watcher = { id: 'test:watcher', sent: [] as string[], send: (channel: string) => void watcher.sent.push(channel), isDestroyed: () => false, once: () => watcher }
    addClient(watcher)
    setViewState({ minimap: false })
    for (const client of clients.list()) {
      emit(client, notifyOpen, {})
      emit(client, limitsChanged, { windows: {} })
    }
    // A `project` event after them: once it arrived, the earlier ones would have too.
    expect(await callB('layout.apply', { projectId: PROJECT, op: note('after-view') })).toMatchObject({ ok: true })
    await until(() => channelsReceived().includes('layout.changed'))
    expect(watcher.sent).toContain(`${IPC_CHANNEL_PREFIX}view.changed`)
    expect(channelsReceived()).toEqual(['layout.changed'])
  })

  it('handlers that read event.sender serve the connection: workflow, docs, claude-home, bindings and terminal answer ok, and A gets their events', async () => {
    setAccess('all')
    expect(await callB('workflow.open', { root: repo })).toMatchObject({ ok: true })
    expect(await callB('docs.open', { projectId: PROJECT })).toMatchObject({ ok: true })
    expect(await callB('claudeHome.sessions', { projectRoot: repo })).toMatchObject({ ok: true })
    expect(await callB('bindings.get', { projectId: PROJECT })).toMatchObject({ ok: true })
    const opened = await callB('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 })
    expect(opened).toMatchObject({ ok: true, value: { started: true } })
    expect(workflowHub.roots).toEqual([realRepo])
    expect(docsHub.projects).toEqual([PROJECT])
    expect(claudeHomeSubscriptions.size).toBe(1)

    writeFileSync(join(repo, '.scratch', 'demo', 'issues', '01-first.md'), '# 01 — first\n\nStatus: blocked\n')
    writeFileSync(join(repo, 'HANDOFF.md'), '# Handoff\n\n- a line\n')
    expect(await callB('bindings.set', { projectId: PROJECT, sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'demo', num: 1 } })).toMatchObject({ ok: true })
    claudeHomeWatchers[0]?.({ sessions: true, transcripts: [] })
    await until(() => PROMPT.test(outputOfA()), SHELL_WAIT_MS)
    expect(outputOfA(), `the prompt of the shell, in ${tail(outputOfA())}`).toMatch(PROMPT)
    // Enter is `\r`, as a terminal sends it: the pty turns it into a line end for /bin/sh, and
    // PowerShell's line editor takes only `\r` as Enter. `$((40+2))` is 42 in both shells, so the
    // output has `link-42` while the echoed input does not.
    expect(await callB('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo link-$((40+2))\r' })).toEqual({ ok: true, value: undefined })

    const wanted = ['workflow.changed', 'docs.changed', 'bindings.changed', 'claudeHome.changed', 'terminal.output']
    await until(() => wanted.every((channel) => channelsReceived().includes(channel)) && outputOfA().includes('link-42'), SHELL_WAIT_MS)
    for (const channel of wanted) expect(channelsReceived(), channel).toContain(channel)
    expect(outputOfA(), tail(outputOfA())).toContain('link-42')
  }, SHELL_TEST_MS)
})

describe('switching access off', () => {
  it('in the middle of a subscription: A stops getting terminal.output, the next terminal.input is refused, link.ping answers, the hubs let go', async () => {
    setAccess('all')
    // A window of B keeps the shell open after A leaves it.
    const windowEvents: string[] = []
    const window = {
      id: 7,
      send: (channel: string, payload: unknown) => {
        if (channel === `${IPC_CHANNEL_PREFIX}terminal.output`) windowEvents.push((payload as { data: string }).data)
      },
      isDestroyed: () => false,
      once: () => window,
    }
    const windowCall = await windowIpc()
    expect(await windowCall('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 }, window)).toMatchObject({ ok: true })
    expect(await callB('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 })).toMatchObject({ ok: true, value: { started: false } })
    expect(await callB('workflow.open', { root: repo })).toMatchObject({ ok: true })
    expect(await callB('docs.open', { projectId: PROJECT })).toMatchObject({ ok: true })
    expect(await callB('claudeHome.sessions', { projectRoot: repo })).toMatchObject({ ok: true })

    await until(() => PROMPT.test(windowEvents.join('')), SHELL_WAIT_MS)
    expect(windowEvents.join(''), `the prompt of the shell, in ${tail(windowEvents.join(''))}`).toMatch(PROMPT)
    expect(await callB('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo before-$((1+1))\r' })).toMatchObject({ ok: true })
    await until(() => outputOfA().includes('before-2'), SHELL_WAIT_MS)
    expect(outputOfA(), tail(outputOfA())).toContain('before-2')

    setAccess('off')
    await until(() => workflowHub.roots.length === 0 && docsHub.projects.length === 0 && claudeHomeSubscriptions.size === 0)
    expect(workflowHub.roots).toEqual([])
    expect(docsHub.projects).toEqual([])
    expect(claudeHomeSubscriptions.size).toBe(0)

    expect(await callB('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo sneaky\r' })).toEqual(accessOff)
    expect(await windowCall('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo after-$((2+1))\r' }, window)).toMatchObject({ ok: true })
    await until(() => windowEvents.join('').includes('after-3'), SHELL_WAIT_MS)
    expect(windowEvents.join(''), tail(windowEvents.join(''))).toContain('after-3')
    // The shell kept running for B's window; nothing of it went to A, and A's input never reached it.
    expect(outputOfA(), tail(outputOfA())).not.toContain('after-3')
    expect(windowEvents.join(''), tail(windowEvents.join(''))).not.toContain('sneaky')
    expect(await callB('link.ping')).toMatchObject({ ok: true })
    // The connection stays: B still shows A online.
    expect(b.service.isConnected(a.service.machine.id)).toBe(true)
  }, SHELL_TEST_MS)

  it('lets a call that already runs finish; the next one is refused', async () => {
    setAccess('all')
    let release: () => void = () => undefined
    holdTrashList = new Promise((resolve) => {
      release = resolve
    })
    const running = callB('trash.list', { projectId: PROJECT })
    await until(() => calls.trashList === 1)
    setAccess('off')
    release()
    expect(await running).toEqual({ ok: true, value: { entries: [] } })
    expect(await callB('trash.list', { projectId: PROJECT })).toEqual(accessOff)
    expect(calls.trashList).toBe(1)
  })
})

// worfy-link ticket 18 (ADR-0066): B gives A read-only access. Each kind of channel: a `read` call
// answers and a `write` call is refused before its input is parsed, no handler running; a `read`
// event reaches A and Terminal output (a `write` event) does not.
describe('read-only access', () => {
  const readOnly = { ok: false, error: readOnlyRefusal('beta') }

  it('answers the `read` calls: projects.list, layout.get, and the subscriptions of workflow, docs and claude-home', async () => {
    setAccess('read')
    expect(await callB('projects.list')).toMatchObject({ ok: true, value: { projects: expect.arrayContaining([expect.objectContaining({ id: PROJECT })]) } })
    expect(await callB('layout.get', { projectId: PROJECT })).toMatchObject({ ok: true, value: { projectId: PROJECT } })
    expect(await callB('workflow.open', { root: repo })).toMatchObject({ ok: true })
    expect(await callB('docs.open', { projectId: PROJECT })).toMatchObject({ ok: true })
    expect(await callB('claudeHome.sessions', { projectRoot: repo })).toMatchObject({ ok: true })
    expect(await callB('link.ping')).toMatchObject({ ok: true })
    // The connection is among B's clients, so B's broadcasts of `read` events reach A.
    expect(linkClientsOfB()).toHaveLength(1)
  })

  it('refuses the `write` calls with the read-only text: no handler runs, the Layout and the Project list stay, no process starts', async () => {
    setAccess('read')
    const nodesBefore = JSON.stringify(layoutStore().get(PROJECT).layout.nodes)
    const projectsBefore = projectStore()
      .list()
      .map((project) => project.id)
    const fileBefore = readFileSync(join(dataDir, 'projects.json'), 'utf8')
    for (const [channel, input] of [
      ['layout.apply', { projectId: PROJECT, op: note('read-only-1') }],
      ['terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 }],
      ['agent.start', { cwd: repo }],
      ['agent.permission', { sessionId: 'session-1', requestId: 'r1', decision: { behavior: 'allow' } }],
      ['agent.answerQuestion', { sessionId: 'session-1', requestId: 'q1', answers: [{ selected: ['A'], other: null }] }],
      ['projects.add', { path: second }],
      ['autopilot.start', { projectId: PROJECT, epic: 'demo' }],
      // Refused before the input is parsed: an input outside the schema gets the same answer.
      ['layout.apply', { not: 'a layout op' }],
    ] as const) {
      expect(await callB(channel, input), channel).toEqual(readOnly)
    }
    expect(calls.agentStart).toBe(0)
    expect(calls.autopilotStart).toBe(0)
    expect(terminals.size).toBe(0)
    expect(JSON.stringify(layoutStore().get(PROJECT).layout.nodes)).toBe(nodesBefore)
    expect(
      projectStore()
        .list()
        .map((project) => project.id),
    ).toEqual(projectsBefore)
    expect(readFileSync(join(dataDir, 'projects.json'), 'utf8')).toBe(fileBefore)
    // `desktop` and `local` stay closed as before, with their own text.
    expect(await callB('projects.pickFolder')).toEqual(notOpen('projects.pickFolder'))
    expect(await callB('link.setMachineAccess', { id: a.service.machine.id, access: 'all' })).toEqual(notOpen('link.setMachineAccess'))
    expect(b.service.settings.levelOf(a.service.machine.id)).toBe('read')
  })

  it('logs a refusal with the channel and the Machine, never the input of the call', async () => {
    setAccess('read')
    const marker = 'input-marker-7f3a'
    expect(await callB('layout.apply', { projectId: PROJECT, op: note(marker) })).toEqual(readOnly)
    const captured = bench?.captured.join('\n') ?? ''
    expect(captured).toContain(`"layout.apply" from Machine ${a.service.machine.id} (alpha) refused: access is read-only`)
    expect(captured).not.toContain(marker)
  })

  it('A gets layout.changed of a change made on B\'s screen', async () => {
    setAccess('read')
    const window = { id: 7, send: () => undefined, isDestroyed: () => false, once: () => window }
    const windowCall = await windowIpc(['./layout.ts'])
    expect(await windowCall('layout.apply', { projectId: PROJECT, op: note('from-b-screen') }, window)).toMatchObject({ ok: true })
    await until(() => channelsReceived().includes('layout.changed'))
    expect(received.find((event) => event.channel === 'layout.changed')?.payload).toMatchObject({ projectId: PROJECT, op: { op: 'create' } })
  })

  it('lowered from all to read-only in the middle of work: the Terminal subscription goes, the next write is refused, link.ping answers', async () => {
    setAccess('all')
    const first = linkClientsOfB()
    // A window of B keeps the shell open after A leaves it (a shell only a Linked machine held
    // closes with it: ADR-0060, point 4).
    const windowEvents: string[] = []
    const window = {
      id: 8,
      send: (channel: string, payload: unknown) => {
        if (channel === `${IPC_CHANNEL_PREFIX}terminal.output`) windowEvents.push((payload as { data: string }).data)
      },
      isDestroyed: () => false,
      once: () => window,
    }
    const windowCall = await windowIpc()
    expect(await windowCall('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 }, window)).toMatchObject({ ok: true })
    expect(await callB('terminal.open', { projectId: PROJECT, nodeId: NODE, cols: 80, rows: 24 })).toMatchObject({ ok: true, value: { started: false } })
    await until(() => PROMPT.test(windowEvents.join('')), SHELL_WAIT_MS)
    expect(windowEvents.join(''), `the prompt of the shell, in ${tail(windowEvents.join(''))}`).toMatch(PROMPT)
    expect(await callB('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo before-$((3+4))\r' })).toMatchObject({ ok: true })
    await until(() => outputOfA().includes('before-7'), SHELL_WAIT_MS)
    expect(outputOfA(), tail(outputOfA())).toContain('before-7')

    setAccess('read')
    // A fresh client: what the old one subscribed to is gone, and A subscribes again.
    const second = linkClientsOfB()
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first[0])
    expect(await callB('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo sneaky\r' })).toEqual(readOnly)
    expect(await callB('link.ping')).toMatchObject({ ok: true })
    expect(await callB('projects.list')).toMatchObject({ ok: true })

    // The shell runs on for B's window; its output does not reach A any more.
    expect(await windowCall('terminal.input', { projectId: PROJECT, nodeId: NODE, data: 'echo after-$((4+5))\r' }, window)).toMatchObject({ ok: true })
    await until(() => windowEvents.join('').includes('after-9'), SHELL_WAIT_MS)
    expect(windowEvents.join(''), tail(windowEvents.join(''))).toContain('after-9')
    expect(outputOfA(), tail(outputOfA())).not.toContain('after-9')
    expect(windowEvents.join(''), tail(windowEvents.join(''))).not.toContain('sneaky')
    expect(b.service.isConnected(a.service.machine.id)).toBe(true)
  }, SHELL_TEST_MS)

  it('a call that already runs finishes when the level drops; raised back to all, a write answers again', async () => {
    setAccess('all')
    let release: () => void = () => undefined
    holdTrashList = new Promise((resolve) => {
      release = resolve
    })
    const running = callB('trash.list', { projectId: PROJECT })
    await until(() => calls.trashList === 1)
    setAccess('read')
    release()
    expect(await running).toEqual({ ok: true, value: { entries: [] } })
    expect(await callB('layout.apply', { projectId: PROJECT, op: note('while-read') })).toEqual(readOnly)
    setAccess('all')
    expect(await callB('layout.apply', { projectId: PROJECT, op: note('all-again') })).toMatchObject({ ok: true })
    expect(layoutStore().get(PROJECT).layout.nodes.map((node) => node.id)).toContain('all-again')
    expect(layoutStore().get(PROJECT).layout.nodes.map((node) => node.id)).not.toContain('while-read')
  })

  it('the switch off turns read-only off too: "access is off"; another Linked machine\'s level does not open it for A', async () => {
    setAccess('read')
    b.service.settings.set({ projectsAccess: false })
    expect(await callB('projects.list')).toEqual(accessOff)
    b.service.settings.set({ projectsAccess: true, machines: { '99999999-9999-4999-8999-999999999999': 'all' } })
    expect(await callB('projects.list')).toEqual(accessOff)
    expect(linkClientsOfB()).toEqual([])
  })
})

describe('the clients of a connection', () => {
  it('pass on only events of their own mark; a name no module declares is not sent', () => {
    const pushed: string[] = []
    const local = () => ({ id: bId, name: 'beta', protocol: 1, build: 'x' })
    const project = new LinkSender(a.service.machine.id, 'project', (channel) => pushed.push(`project ${channel}`), local)
    const link = new LinkSender(a.service.machine.id, 'link', (channel) => pushed.push(`link ${channel}`), local)
    for (const sender of [project, link]) {
      for (const channel of ['layout.changed', 'terminal.output', 'view.changed', 'notify.open', 'limits.changed', 'link.changed', 'nobody.declares.this']) {
        sender.send(IPC_CHANNEL_PREFIX + channel, {})
      }
    }
    expect(pushed).toEqual(['project layout.changed', 'project terminal.output'])
    project.destroy()
    project.send(`${IPC_CHANNEL_PREFIX}layout.changed`, {})
    expect(pushed).toHaveLength(2)
  })

  it('a read-only `project` client passes on `read` events only: Terminal output stays (worfy-link ticket 18)', () => {
    const pushed: string[] = []
    const local = () => ({ id: bId, name: 'beta', protocol: 1, build: 'x' })
    const reader = new LinkSender(a.service.machine.id, 'project', (channel) => pushed.push(channel), local, true)
    for (const channel of ['layout.changed', 'agent.event', 'terminal.output', 'terminal.exit', 'view.changed', 'nobody.declares.this']) {
      reader.send(IPC_CHANNEL_PREFIX + channel, {})
    }
    expect(pushed).toEqual(['layout.changed', 'agent.event', 'terminal.exit'])
  })

  it('refusals are logged with the channel and the Machine, never with a token or a code', async () => {
    expect(await callB('projects.list')).toEqual(accessOff)
    setAccess('all')
    expect(await callB('projects.pickFolder')).toEqual(notOpen('projects.pickFolder'))
    const captured = bench?.captured.join('\n') ?? ''
    expect(captured).toContain(`"projects.list" from Machine ${a.service.machine.id} (alpha) refused: access is off`)
    expect(captured).toContain(`"projects.pickFolder" from Machine ${a.service.machine.id} (alpha) refused: not open to Linked machines`)
    // The fingerprints of both Machines never reach A over a channel either.
    const fingerprints = [...a.service.linkedMachines(), ...b.service.linkedMachines()].map((machine) => machine.fingerprint)
    expect(fingerprints.every((fingerprint) => fingerprint.length > 0)).toBe(true)
    for (const fingerprint of fingerprints) expect(seen.join('\n')).not.toContain(fingerprint)
  })
})

describe('round 2: a Linked machine works inside the Projects of the list only', () => {
  /** A window of B: its webContents id is a number. */
  const window = { id: 7, send: () => undefined, isDestroyed: () => false, once: () => window }
  const outsideRefusal = /is outside the Projects of this Machine; a Linked machine works only inside them/

  it('agent.start in a folder outside every Project, or through a link out of one, is refused; inside it starts in the real folder', async () => {
    setAccess('all')
    for (const cwd of ['/', env.scratch, outside, join(repo, 'out-link'), `${repo}/../outside`]) {
      const result = await callB('agent.start', { cwd })
      expect(result.ok, cwd).toBe(false)
      expect(!result.ok && result.error, cwd).toMatch(outsideRefusal)
    }
    expect(calls.agentStart).toBe(0)
    expect(await callB('agent.start', { cwd: `${repo}/.scratch/../.scratch` })).toMatchObject({ ok: true })
    expect(startedIn).toEqual([join(realRepo, '.scratch')])

    // B's own window starts a Session wherever it likes, as before.
    const windowCall = await windowIpc(['./agent.ts'])
    expect(await windowCall('agent.start', { cwd: outside }, window)).toMatchObject({ ok: true })
    expect(startedIn).toEqual([join(realRepo, '.scratch'), outside])
  })

  it('agent.attach by path reads nothing outside the Projects for A; inside it attaches; B\'s window attaches as before', async () => {
    setAccess('all')
    const started = await callB('agent.start', { cwd: repo })
    const sessionId = (started as { ok: true; value: { sessionId: string } }).value.sessionId
    for (const path of [join(outside, 'secret.txt'), join(repo, 'out-link', 'secret.txt'), `${repo}/../outside/secret.txt`]) {
      const result = await callB('agent.attach', { sessionId, sources: [{ kind: 'path', path }] })
      expect(result.ok, path).toBe(false)
      expect(!result.ok && result.error, path).toMatch(outsideRefusal)
    }
    // Nothing was copied for the refused files.
    expect(() => readFileSync(join(attachmentsDir, 'secret.txt'))).toThrow()
    expect(seen.join('\n')).not.toContain('not a Project file')

    expect(await callB('agent.attach', { sessionId, sources: [{ kind: 'path', path: join(repo, 'HANDOFF.md') }] })).toMatchObject({
      ok: true,
      value: { results: [{ ok: true, attachment: { kind: 'file', name: 'HANDOFF.md', copied: false } }] },
    })

    const windowCall = await windowIpc(['./agent.ts'])
    expect(await windowCall('agent.attach', { sessionId, sources: [{ kind: 'path', path: join(outside, 'secret.txt') }] }, window)).toMatchObject({
      ok: true,
      value: { results: [{ ok: true, attachment: { kind: 'file', name: 'secret.txt', copied: true } }] },
    })
  })

  it('a root outside the Projects is refused for A on workflow, claude-home, bindings and checks; inside it answers; B\'s window as before, except checks', async () => {
    setAccess('all')
    const sessionId = '77777777-7777-4777-8777-777777777777'
    for (const [channel, input] of [
      ['workflow.open', { root: '/' }],
      ['workflow.open', { root: outside }],
      ['workflow.open', { root: join(repo, 'out-link') }],
      ['claudeHome.sessions', { projectRoot: '/' }],
      ['claudeHome.live', { projectRoot: env.scratch }],
      ['claudeHome.transcript', { projectRoot: '/', sessionId }],
      ['claudeHome.subagents', { projectRoot: outside, sessionId }],
      ['claudeHome.subagentTranscript', { projectRoot: '/', sessionId, agentId: 'a1' }],
      ['bindings.signals', { projectRoot: '/', sessionId }],
      ['checks.get', { root: '/', branches: [] }],
    ] as const) {
      const result = await callB(channel, input)
      expect(result.ok, `${channel} ${JSON.stringify(input)}`).toBe(false)
      expect(!result.ok && result.error, channel).toMatch(outsideRefusal)
    }
    expect(workflowHub.roots).toEqual([])
    expect(claudeHomeSubscriptions.size).toBe(0)

    expect(await callB('claudeHome.live', { projectRoot: repo })).toMatchObject({ ok: true })
    expect(await callB('bindings.signals', { projectRoot: repo, sessionId })).toMatchObject({ ok: true, value: { found: false } })
    expect(await callB('checks.get', { root: repo, branches: [] })).toMatchObject({ ok: true, value: { root: realRepo } })

    const windowCall = await windowIpc(['./claude-home.ts', './bindings.ts', './checks.ts'])
    expect(await windowCall('claudeHome.live', { projectRoot: outside }, window)).toMatchObject({ ok: true })
    expect(await windowCall('bindings.signals', { projectRoot: '/', sessionId }, window)).toMatchObject({ ok: true })
    // checks.get takes only a Project root or one of its repositories, from a window too (worfy-harness ticket 23).
    expect(await windowCall('checks.get', { root: outside, branches: [] }, window)).toMatchObject({ ok: false, error: expect.stringMatching(/neither the root of a Project nor one of its repositories/) })
    expect(await windowCall('checks.get', { root: repo, branches: [] }, window)).toMatchObject({ ok: true, value: { root: repo } })
  })

  it('projects.add and projects.remove from A leave B\'s active Project as it is; the active one is not removed; B\'s window switches as before', async () => {
    setAccess('all')
    const activeInFile = (): unknown => (JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { activeId: unknown }).activeId
    expect(projectStore().active()?.id).toBe(PROJECT)

    const added = await callB('projects.add', { path: second })
    expect(added).toMatchObject({ ok: true, value: { status: 'added' } })
    const secondId = (added as { ok: true; value: { project: { id: string } } }).value.project.id
    expect(projectStore().list().map((project) => project.id)).toContain(secondId)
    expect(projectStore().active()?.id).toBe(PROJECT)
    expect(activeInFile()).toBe(PROJECT)
    // Again, from a subfolder: the Project is already listed, and it is still not made active.
    expect(await callB('projects.add', { path: join(second, 'src') })).toMatchObject({ ok: true, value: { status: 'added' } })
    expect(activeInFile()).toBe(PROJECT)

    const removeActive = await callB('projects.remove', { id: PROJECT })
    expect(removeActive.ok).toBe(false)
    expect(!removeActive.ok && removeActive.error).toMatch(/is the active Project of this Machine/)
    expect(projectStore().find(PROJECT)).toBeDefined()
    expect(await callB('projects.remove', { id: secondId })).toMatchObject({ ok: true })
    expect(projectStore().find(secondId)).toBeUndefined()
    expect(activeInFile()).toBe(PROJECT)

    // B's own window: adding makes the Project active, removing the active one moves on.
    const windowCall = await windowIpc(['./projects.ts'])
    expect(await windowCall('projects.add', { path: second }, window)).toMatchObject({ ok: true, value: { status: 'added' } })
    expect(activeInFile()).toBe(secondId)
    expect(await windowCall('projects.remove', { id: secondId }, window)).toMatchObject({ ok: true })
    expect(activeInFile()).toBe(PROJECT)
  })
})

// worfy-pipeline ticket 08: the Pipeline is edited only on the Machine of its
// Project. The write is `local`: refused to a Linked machine with full access too, before any
// handler runs; the read is `project` and `read`.
describe('the Pipeline editor', () => {
  it('pipeline.write from a Linked machine with full access is refused: bin/profile-set does not run, profile.json stays; from B\'s window it reaches the handler', async () => {
    setAccess('all')
    profileSetRuns.length = 0
    const before = readFileSync(pipelineProfile, 'utf8')
    const input = { root: repo, expected: null, pipeline: [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'done' }] }
    expect(await callB('pipeline.write', input)).toEqual(notOpen('pipeline.write'))
    expect(await callB('pipeline.write', { ...input, pipeline: null })).toEqual(notOpen('pipeline.write'))
    expect(profileSetRuns).toEqual([])
    expect(readFileSync(pipelineProfile, 'utf8')).toBe(before)

    // A reads B's Pipeline: the editor shows it read-only in A's window of B.
    expect(await callB('pipeline.read', { root: repo })).toMatchObject({ ok: true, value: { available: true, custom: false, fingerprint: null } })
    expect(profileSetRuns).toEqual([['-C', realRepo, '--read']])
    expect(readFileSync(pipelineProfile, 'utf8')).toBe(before)

    const window = { id: 9, send: () => undefined, isDestroyed: () => false, once: () => window }
    const windowCall = await windowIpc(['./pipeline.ts'])
    expect(await windowCall('pipeline.write', input, window)).toMatchObject({ ok: true, value: { status: 'saved', warning: null } })
    expect(profileSetRuns.at(-1)).toEqual(['-C', realRepo, '--expect', 'null', '--set', '-'])
    expect(JSON.parse(readFileSync(pipelineProfile, 'utf8'))).toMatchObject({ name: 'demo', workflow: { pipeline: input.pipeline } })
    // A root that is no Project of B is refused from B's window too: a window of a Linked machine sends `local` channels to its own main.
    expect(await windowCall('pipeline.write', { ...input, root: outside }, window)).toMatchObject({ ok: false, error: expect.stringMatching(/is not a Project of this Machine/) })
    expect(profileSetRuns).toHaveLength(2)
  })

  it('the answers of bin/profile-set: exit 5 a conflict, exit 6 a busy lock, exit 1 the reason, no script a Harness too old, another code an error', async () => {
    // Read-only access is enough for the read.
    setAccess('read')
    const window = { id: 10, send: () => undefined, isDestroyed: () => false, once: () => window }
    const windowCall = await windowIpc(['./pipeline.ts'])
    const input = { root: repo, expected: `sha256:${'b'.repeat(64)}`, pipeline: null }
    try {
      profileSetInstead = async () => ({ code: 5, stdout: '{"conflict":true,"fingerprint":null}', stderr: 'profile-set: workflow.pipeline of x changed since it was read — not written' })
      expect(await windowCall('pipeline.write', input, window)).toEqual({ ok: true, value: { status: 'conflict' } })
      profileSetInstead = async () => ({ code: 6, stdout: '', stderr: 'profile-set: another profile-set is writing x (lock y) — not written; try again' })
      expect(await windowCall('pipeline.write', input, window)).toEqual({ ok: true, value: { status: 'busy' } })
      expect(profileSetRuns.at(-1)).toEqual(['-C', realRepo, '--expect', input.expected, '--reset'])
      profileSetInstead = async () => ({ code: 1, stdout: '', stderr: 'profile-set: /h/profile.json: workflow.pipeline[1]: check needs a name — not written\n' })
      expect(await windowCall('pipeline.write', input, window)).toEqual({ ok: true, value: { status: 'invalid', reason: '/h/profile.json: workflow.pipeline[1]: check needs a name — not written' } })
      profileSetInstead = async () => {
        throw new HarnessScriptStartError('ENOENT', 'no Harness script at /h/plugin/bin/profile-set')
      }
      expect(await windowCall('pipeline.write', input, window)).toEqual({ ok: true, value: { status: 'too-old' } })
      expect(await callB('pipeline.read', { root: repo })).toMatchObject({ ok: true, value: { available: false } })
      profileSetInstead = async () => ({ code: 3, stdout: '', stderr: 'profile: /x is not in a registered project\n' })
      expect(await windowCall('pipeline.write', input, window)).toMatchObject({ ok: false, error: expect.stringMatching(/--reset failed \(exit 3\): profile: \/x is not in a registered project/) })
      expect(await callB('pipeline.read', { root: repo })).toMatchObject({ ok: false, error: expect.stringMatching(/--read failed \(exit 3\)/) })
    } finally {
      profileSetInstead = null
    }
  })
})

/** B's own window over the same handler modules, as src/main/index.ts registers them on ipcMain. */
async function windowIpc(names: readonly string[] = ['./terminal.ts']) {
  type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
  const handlers = new Map<string, Listener>()
  const chosen = Object.fromEntries(names.map((name) => [name, modules[name]!]))
  await registerIpc({ handle: (channel, listener) => void handlers.set(channel, listener as Listener) }, { modules: chosen, isTrustedSender: () => true })
  return async (channel: string, input: unknown, sender: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: 'app://worfy' }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
}
