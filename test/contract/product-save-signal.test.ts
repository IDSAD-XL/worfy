// The save signal of a Product Session (src/main/product/save-signal.ts; Epic worfy-product-session,
// ticket 04) over a real git repository: changes under docs/product/ and `product_save` put one message
// with the changed files into the Orchestrator's queue; closing the Product Session's Node does the same;
// no changes, the same changes again, and Silent mode put none; git is asked nothing but `status`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { NodeSessions } from '../../src/main/agent/node-sessions'
import { MessageQueue } from '../../src/main/agent/queue'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import { mindMapToolCaller } from '../../src/main/mcp/mind-map-server'
import { SaveSignal, saveAnswer, type SaveSignalDeps } from '../../src/main/product/save-signal'
import { runGit } from '../../src/main/projects/store'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-0000000d'

let scratch: string
let repo: string
let registries: SessionRegistry[] = []

/** git in the fixture repository, with a fixed identity and no hooks of the machine. */
const git = (...args: string[]): string =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } })

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-save-signal-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, 'docs', 'product', 'roadmap'), { recursive: true })
  writeFileSync(join(scratch, 'gitconfig'), '')
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# Roadmap\n')
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'start')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(scratch, 'gitconfig'))
})

afterEach(() => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

/** A save signal over the fixture repository; the Orchestrator's queue is a MessageQueue of a busy Orchestrator. */
function signal(overrides: Partial<SaveSignalDeps> = {}) {
  const gitCalls: string[][] = []
  const queue = new MessageQueue(() => undefined)
  const save = new SaveSignal({
    projectRoot: () => repo,
    layout: () => Promise.resolve({ mode: 'full', failed: false }),
    git: (args) => (gitCalls.push([...args]), runGit(args)),
    unattended: () => false,
    send: (_projectId, text) => (queue.add(text), Promise.resolve()),
    ...overrides,
  })
  return { save, queue, gitCalls }
}

/** Every git call asked only `status`, in the Project root. */
function onlyStatus(calls: readonly string[][]): void {
  for (const call of calls) expect(call.slice(0, 3)).toEqual(['-C', repo, 'status'])
}

describe('the save signal', () => {
  it('changes under docs/product and product_save: one message in the Orchestrator\'s queue with the changed files and their topic', async () => {
    const { save, queue, gitCalls } = signal()
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# Roadmap\n\n## Destination\n')
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'mind-map.json'), '{"version":1,"nodes":[]}\n')
    // A change outside docs/product is not the Product Session's and is not named.
    writeFileSync(join(repo, 'README.md'), '# demo, edited\n')
    const call = mindMapToolCaller({ productFolder: join(repo, 'docs', 'product'), save: async () => saveAnswer(await save.signal(PROJECT)) })
    const answer = await call('product_save', {})
    expect(answer.isError).toBeFalsy()
    expect(answer.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('docs/product/roadmap/mind-map.json') as string })
    const { items } = queue.snapshot()
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toContain('Topics: roadmap')
    expect(items[0]!.text).toContain('- docs/product/roadmap/map.md (modified)')
    expect(items[0]!.text).toContain('- docs/product/roadmap/mind-map.json (new)')
    expect(items[0]!.text).toContain('docs PR')
    expect(items[0]!.text).not.toContain('README.md')
    onlyStatus(gitCalls)
    // Nothing was staged or committed.
    expect(git('status', '--porcelain')).toContain('?? docs/product/roadmap/mind-map.json')
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1')
  })

  it('two signals in a row without new changes make one message; a new edit makes the next one', async () => {
    const { save, queue, gitCalls } = signal()
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# Roadmap, edited\n')
    expect((await save.signal(PROJECT)).kind).toBe('sent')
    expect(await save.signal(PROJECT)).toMatchObject({ kind: 'already' })
    // Two at once: still one message.
    await Promise.all([save.signal(PROJECT), save.signal(PROJECT)])
    expect(queue.size).toBe(1)
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# Roadmap, edited again\n')
    expect((await save.signal(PROJECT)).kind).toBe('sent')
    expect(queue.size).toBe(2)
    onlyStatus(gitCalls)
  })

  it('no changes under docs/product: no message, and product_save answers "nothing to save"', async () => {
    const { save, queue, gitCalls } = signal()
    writeFileSync(join(repo, 'README.md'), '# demo, edited\n')
    const outcome = await save.signal(PROJECT)
    expect(outcome).toEqual({ kind: 'nothing' })
    expect(saveAnswer(outcome)).toBe('nothing to save')
    expect(queue.size).toBe(0)
    onlyStatus(gitCalls)
  })

  it('Silent mode: no message, no git at all, and the answer "Silent mode: nothing to save"', async () => {
    const { save, queue, gitCalls } = signal({ layout: () => Promise.resolve({ mode: 'silent', failed: false }) })
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# changed\n')
    const outcome = await save.signal(PROJECT)
    expect(saveAnswer(outcome)).toBe('Silent mode: nothing to save')
    expect(queue.size).toBe(0)
    expect(gitCalls).toEqual([])
  })

  it('an unknown mode or a running Autopilot sends nothing and says why', async () => {
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# changed\n')
    const unknown = signal({ layout: () => Promise.resolve({ mode: 'full', failed: true }) })
    expect((await unknown.save.signal(PROJECT)).kind).toBe('unknown')
    expect(unknown.queue.size).toBe(0)
    const autopilot = signal({ unattended: () => true })
    expect(saveAnswer(await autopilot.save.signal(PROJECT))).toMatch(/Autopilot runs the Orchestrator/)
    expect(autopilot.queue.size).toBe(0)
    // Once Autopilot is gone the same changes are sent: a refused signal is not remembered.
    let unattended = true
    const later = signal({ unattended: () => unattended })
    await later.save.signal(PROJECT)
    unattended = false
    expect((await later.save.signal(PROJECT)).kind).toBe('sent')
  })
})

describe('closing a Product Session', () => {
  function harness(productClosed: (projectId: string) => void) {
    const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
    const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script: 'turn' }))
    registries.push(registry)
    const views: SessionNodeView[] = []
    const sessions = new NodeSessions({
      layout,
      projectPath: () => repo,
      registry,
      settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
      claude: () => Promise.resolve({ live: [], history: [] }),
      isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
      broadcast: () => undefined,
      publish: (view) => views.push(view),
      productClosed,
    })
    const until = (nodeId: string, state: SessionNodeView['state']) => vi.waitFor(() => expect(sessions.list(PROJECT).find((each) => each.nodeId === nodeId)?.state).toBe(state), { timeout: ms(2000) })
    return { sessions, until }
  }

  it("Close of a Product Session's Node puts the same message into the Orchestrator's queue; a plain Session's Close does not", async () => {
    const { save, queue, gitCalls } = signal()
    const pending: Promise<unknown>[] = []
    const h = harness((projectId) => void pending.push(save.signal(projectId)))
    writeFileSync(join(repo, 'docs', 'product', 'roadmap', 'map.md'), '# Roadmap, edited\n')

    const plain = await h.sessions.open(PROJECT)
    await h.until(plain.nodeId, 'idle')
    h.sessions.close(plain.nodeId)
    expect(pending).toHaveLength(0)

    const product = await h.sessions.open(PROJECT, undefined, 'product')
    await h.until(product.nodeId, 'idle')
    h.sessions.close(product.nodeId)
    await Promise.all(pending)
    expect(pending).toHaveLength(1)
    expect(queue.snapshot().items.map((item) => item.text)).toEqual([expect.stringContaining('- docs/product/roadmap/map.md (modified)')])
    onlyStatus(gitCalls)
  })

  it('a save signal that throws does not stop the Close', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness(() => {
      throw new Error('no Orchestrator')
    })
    const product = await h.sessions.open(PROJECT, undefined, 'product')
    await h.until(product.nodeId, 'idle')
    expect(() => h.sessions.close(product.nodeId)).not.toThrow()
    await h.until(product.nodeId, 'closed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
