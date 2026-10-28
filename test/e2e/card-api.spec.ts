import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'
import { catScript } from '../harness-node'

// The Card API (ticket 26) against the built app: a Card fixture uses window.worfy — its own data
// survives a restart, `session.ask` goes through the confirmation dialog (replaced in main by the
// test) to the Orchestrator, and `workflow.get` reads the worfy-mvp Epic through a stub
// epic-status. Nothing is written into the Project's repository (ADR-0005).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const LABEL = '0000000a'
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'worfy-mvp-epic')

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string
let launched: LaunchedApp | undefined

const cardDir = (id: string) => join(dataDir, PROJECT, 'cards', id)
const dataFile = (id: string) => join(dataDir, PROJECT, 'card-data', `${id}.json`)
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

/**
 * A Card that counts its starts in its own data: it reads the count, shows it, and stores it plus
 * one. The page marks itself ready only after the store answered.
 */
const COUNTER_HTML = `<!doctype html><html><head><title>Counter</title></head><body><p id="v">…</p><script>
(async () => {
  const saved = await window.worfy.data.get()
  document.getElementById('v').textContent = JSON.stringify(saved)
  await window.worfy.data.set({ starts: (saved && saved.starts ? saved.starts : 0) + 1 })
  document.body.dataset.ready = 'yes'
})().catch((error) => { document.body.dataset.ready = 'error: ' + error.message })
</script></body></html>`

function cardNode(id: string, x: number) {
  return { id, kind: 'card', x, y: 360, w: 320, h: 220, hidden: false, locked: false, pinned: false, tags: [], data: {} }
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-card-api-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  repo = join(scratch, 'alpha')
  mkdirSync(repo)
  cpSync(FIXTURE, join(repo, '.scratch', 'worfy-mvp'), { recursive: true })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init')
  // epic-status answers with the fixture's own snapshot of the worfy-mvp Epic.
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(join(FIXTURE, 'epic-status.json')))
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [cardNode('c1', 40), cardNode('c2', 400)], viewport: { x: 0, y: 0, zoom: 1 } }))
  mkdirSync(cardDir('c1'), { recursive: true })
  writeFileSync(join(cardDir('c1'), 'index.html'), COUNTER_HTML)
  mkdirSync(cardDir('c2'), { recursive: true })
  writeFileSync(join(cardDir('c2'), 'index.html'), '<!doctype html><html><head><title>Board</title></head><body><p>Board</p><script>document.body.dataset.ready = "yes"</script></body></html>')
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const launch = () => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator' } })

/** The frame of a Card once its page marked itself ready. */
async function cardFrame(window: Page, cardId: string): Promise<Frame> {
  await expect(window.frameLocator(`[data-card-id="${cardId}"] iframe`).locator('body[data-ready="yes"]')).toHaveCount(1)
  const frame = window.frames().find((candidate) => candidate.url().startsWith(`worfy-card://${cardId}.${LABEL}/`))
  if (!frame) throw new Error(`no frame for Card ${cardId}`)
  return frame
}

test('a Card keeps its own data through window.worfy.data across a restart, in the Project data folder only', async () => {
  launched = await launch()
  let frame = await cardFrame(launched.window, 'c1')
  expect(await frame.evaluate("document.getElementById('v').textContent")).toBe('null')
  expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ starts: 1 })
  // The API the Card gets: data, ask and a read-only workflow, and nothing it can replace.
  expect(await frame.evaluate('Object.keys(window.worfy).join()')).toBe('data,ask,workflow')
  expect(await frame.evaluate('Object.keys(window.worfy.workflow).join()')).toBe('get,subscribe')
  expect(await frame.evaluate("(() => { try { window.worfy = null } catch {} return typeof window.worfy })()")).toBe('object')
  // Over 1 MB is refused, and the stored data stays as it was.
  expect(await frame.evaluate("window.worfy.data.set('x'.repeat(1024 * 1024)).then(() => 'stored', (error) => error.message)")).toMatch(/1048576 bytes/)
  expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ starts: 1 })

  await launched.close()
  launched = undefined
  launched = await launch()
  frame = await cardFrame(launched.window, 'c1')
  expect(await frame.evaluate("document.getElementById('v').textContent")).toBe('{"starts":1}')
  expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ starts: 2 })
  expect(existsSync(dataFile('c2'))).toBe(false)
  expect(git('status', '--porcelain')).toBe('')
})

test('a Card request that the worfy window posts to itself is ignored', async () => {
  launched = await launch()
  const { window } = launched
  const frame = await cardFrame(window, 'c1')
  // Right shape, but not from a Card frame: neither its source nor its origin is one. Which of the
  // two checks drops it is pinned by the contract tests (test/contract/card-bridge.test.ts).
  await window.evaluate(
    "window.postMessage({ type: 'worfy.request', requestId: 'x1', op: 'data.set', args: { value: { forged: true } } }, '*')",
  )
  // The forged message is queued in the window before this request of the Card, and main handles
  // the Card API calls in order with synchronous file I/O: had the forged write been taken, this
  // read would already see it.
  expect(await frame.evaluate('window.worfy.data.get()')).toEqual({ starts: 1 })
  expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ starts: 1 })
  expect(existsSync(dataFile('c2'))).toBe(false)
})

test('session.ask: "Cancel" sends nothing and answers canceled; "Send" reaches the Orchestrator; workflow.get reads the worfy-mvp Tickets', async () => {
  launched = await launch()
  const { app, window } = launched
  const frame = await cardFrame(window, 'c2')
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')

  // The dialog is replaced in main: it records what it was shown and answers with the given button.
  const answerWith = (button: number) =>
    app.evaluate(({ dialog }, response) => {
      const shown: unknown[] = []
      ;(globalThis as { shownDialogs?: unknown[] }).shownDialogs = shown
      dialog.showMessageBox = ((...args: unknown[]) => {
        shown.push(args.at(-1))
        return Promise.resolve({ response, checkboxChecked: false })
      }) as typeof dialog.showMessageBox
    }, button)
  const shownDialogs = () => app.evaluate(() => (globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? [])

  // Every message given to a Session shows up as a `prompt` agent event: record them from here on.
  await window.evaluate(() => {
    const store = globalThis as unknown as { worfy: { on(channel: string, handler: (payload: unknown) => void): number }; prompts: string[] }
    store.prompts = []
    store.worfy.on('agent.event', (payload) => {
      const { event } = payload as { event: { type: string; text?: string } }
      if (event.type === 'prompt' && event.text !== undefined) store.prompts.push(event.text)
    })
  })

  await answerWith(1)
  expect(await frame.evaluate("window.worfy.ask('Do not send this one')")).toEqual({ sent: false, canceled: true })
  const [canceled] = (await shownDialogs()) as { message: string; detail: string; buttons: string[] }[]
  expect(canceled?.buttons).toEqual(['Send', 'Cancel'])
  expect(canceled?.message).toBe('Card "Board" wants to send a message to the Orchestrator.')
  expect(canceled?.detail).toBe('Message from Card "Board" (c2):\n\nDo not send this one')

  await answerWith(0)
  expect(await frame.evaluate("window.worfy.ask('Is ticket 07 done?')")).toEqual({ sent: true })
  // The Orchestrator's turn on the fake agent: the message reached it.
  await expect(node.getByTestId('orchestrator-status-block')).toHaveCount(1)
  // The turn runs, so every message sent before it has been given to the Session: only the one the
  // user sent. Had "Cancel" sent its text, that would be the first prompt and this one queued.
  expect(await window.evaluate(() => (globalThis as unknown as { prompts: string[] }).prompts)).toEqual([
    'Message from Card "Board" (c2):\n\nIs ticket 07 done?',
  ])

  const snapshot = (await frame.evaluate('window.worfy.workflow.get()')) as {
    epics: { epic: string }[]
    tickets: { epic: string; num: number; state: string; blockedBy: number[]; wave: number | null }[]
    error: string | null
  }
  expect(snapshot.error).toBeNull()
  expect(snapshot.epics.map((epic) => epic.epic)).toEqual(['worfy-mvp'])
  expect(snapshot.tickets).toHaveLength(33)
  expect(snapshot.tickets.find((ticket) => ticket.num === 26)).toMatchObject({ epic: 'worfy-mvp', state: 'open', blockedBy: [10, 17, 24, 25], wave: 9 })
  expect(git('status', '--porcelain')).toBe('')
})
