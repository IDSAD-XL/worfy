// System actions in the UI of the Machine they are called from (worfy-link ticket 12; ADR-0053,
// Q14), on two linked built worfy A and B. B shares its Projects and runs the fake agent; A opens
// B's Project `beta`. Then, in A's window:
// - "+" of the Orchestrator's input field opens A's own file dialog (a hidden <input type="file">,
//   answered through Playwright's `filechooser`); the file goes to B as bytes, B keeps a copy in
//   its data folder and hands its path to B's agent. B's file dialog is never called.
// - an https:// link in B's HANDOFF opens in A's browser, not B's;
// - a double click on a Ticket Node opens focus mode on it with its file read on B, and its
//   "Open in editor" shows "File is on <B>": no editor opens on either Machine;
// - View ▸ Show Minimap of A hides the Minimap in A's window only: every screen has its own.
// Every system call is replaced in main of both apps by a recorder (dialog.showOpenDialog,
// shell.openExternal, shell.openPath): no macOS window opens. Bonjour is off, the link server
// listens on 127.0.0.1 (launchApp).
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { canvasReady, launchApp, linkThroughUi, machineIdOf, repoRoot, setProjectsAccess, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'
import { ms } from '../time-scale'

test.setTimeout(ms(240_000))

const BETA = 'beta-0000000b'
const EPIC = 'demo'
const SIZE = { width: 1400, height: 900 }
const PR_URL = 'https://example.com/worfy/pull/12'

/** Where the snapshots of ticket 12 are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/**
 * Takes the light and dark snapshot of `window` (test-results/e2e/snapshots/12-<name>/). With
 * WORFY_EVIDENCE=1 both are also kept as the ticket's evidence `12-<name>-{light,dark}.png`; an
 * ordinary run (gate full) leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `12-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `12-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `12-${name}-dark.png`))
}

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/**
 * B: a committed repository `beta` with HANDOFF.md (an https:// link) and Epic `demo` with one open
 * Ticket, an epic-status in B's Claude home that answers it, and the fake agent of the input field
 * that writes down every message it gets.
 */
function prepareB(scratch: string) {
  const repo = join(scratch, 'beta')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '01-ticket-1.md'), ['# 01 — Ticket 1', '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Что делаем', '', 'Written on B.', ''].join('\n'))
  writeFileSync(join(repo, 'HANDOFF.md'), ['# Handoff', '', `See [the PR](${PR_URL}).`, ''].join('\n'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const claudeHome = join(scratch, 'b-claude')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: EPIC, num: 1, slug: 'ticket-1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = join(scratch, 'b-data')
  mkdirSync(join(dataDir, BETA), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: BETA, name: 'beta', path: realpathSync.native(repo) }], activeId: BETA }))
  const log = join(scratch, 'b-agent.log')
  // B's login shell is /bin/sh with a HOME of its own: its .profile puts node on PATH for the
  // epic-status stand-in, and nothing reads the real home.
  const home = join(scratch, 'b-home')
  mkdirSync(home)
  loginProfileWithNode(home)
  return {
    repo,
    dataDir,
    log,
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: join(scratch, 'b-no-harness-home'), HOME: home, SHELL: '/bin/sh', WORFY_AGENT_SCRIPT: 'message-input', WORFY_AGENT_LOG: log },
  }
}

/** What the recorders of `app` saw: the file dialogs, the addresses and the files opened. */
interface Recorded {
  dialogs: number
  external: string[]
  paths: string[]
}

/** Replaces the file dialog and the OS shell in main of `app` with recorders. */
async function stubSystem(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    const seen = { dialogs: 0, external: [] as string[], paths: [] as string[] }
    ;(globalThis as unknown as { recorded: typeof seen }).recorded = seen
    dialog.showOpenDialog = (() => {
      seen.dialogs += 1
      return Promise.resolve({ canceled: true, filePaths: [] })
    }) as typeof dialog.showOpenDialog
    shell.openExternal = async (url: string) => {
      seen.external.push(url)
    }
    shell.openPath = async (path: string) => {
      seen.paths.push(path)
      return ''
    }
  })
}

const recorded = (app: ElectronApplication): Promise<Recorded> => app.evaluate(() => (globalThis as unknown as { recorded: Recorded }).recorded)

/** Clicks View ▸ Show Minimap of `app` the way the menu does; answers whether it is checked now. */
async function toggleMinimapMenu(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('view.minimap')
    if (!item) throw new Error('View ▸ Show Minimap is missing')
    item.click()
    return item.checked
  })
}

/** The name A's link state gives Linked machine `id`. */
async function linkedName(window: Page, id: string): Promise<string> {
  const result = await window.evaluate(() =>
    (globalThis as unknown as { worfy: { invoke(channel: string): Promise<{ ok: boolean; value?: { linked: { id: string; name: string }[] } }> } }).worfy.invoke('link.state'),
  )
  const name = result.value?.linked.find((machine) => machine.id === id)?.name
  if (name === undefined) throw new Error(`no Linked machine ${id}`)
  return name
}

type Call = { kind: string; content?: unknown }

const messagesOf = (log: string): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'message')
    : []

/**
 * Whether Chromium of this Electron intercepts the file chooser over the DevTools protocol, which
 * is what Playwright's `filechooser` uses. Asked on a session of its own, switched off again, so a
 * "+" clicked later never opens a real macOS dialog when it does not.
 */
async function interceptsFileChooser(launched: LaunchedApp): Promise<boolean> {
  const session = await launched.app.context().newCDPSession(launched.window)
  try {
    await session.send('Page.setInterceptFileChooserDialog', { enabled: true })
    await session.send('Page.setInterceptFileChooserDialog', { enabled: false })
    return true
  } catch {
    return false
  } finally {
    await session.detach()
  }
}

test('in a window of A on a Project of B: "+" picks with A\'s dialog and B keeps the copy; a link opens in A; a Ticket shows its file from B and its editor says where it is; the Minimap is A\'s own', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-link-12-')))
  const bSetup = prepareB(scratch)
  // A has a Project of its own, so its window starts on a Canvas.
  const own = join(scratch, 'alpha')
  mkdirSync(own)
  git(own, 'init', '-q')
  const aData = join(scratch, 'a-data')
  mkdirSync(aData)
  writeFileSync(join(aData, 'projects.json'), JSON.stringify({ projects: [{ id: 'alpha-0000000a', name: 'alpha', path: realpathSync.native(own) }], activeId: 'alpha-0000000a' }))
  // A file of A's own disk, picked with "+" in A.
  const picked = join(scratch, 'from-a', 'notes-of-a.txt')
  mkdirSync(join(scratch, 'from-a'))
  writeFileSync(picked, 'notes written on A')
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await stubSystem(a.app)
    await stubSystem(b.app)
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setProjectsAccess(b, true)
    const bName = await linkedName(a.window, bId)

    // A opens beta of B.
    const row = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${BETA}"]`)
    await row.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)

    // ── View ▸ Show Minimap: A's menu, A's window only ──
    await expect(a.window.getByRole('img', { name: 'Minimap' })).toBeVisible()
    await expect(b.window.getByRole('img', { name: 'Minimap' })).toBeVisible()
    expect(await toggleMinimapMenu(a.app)).toBe(false)
    await expect(a.window.getByRole('img', { name: 'Minimap' })).toHaveCount(0)
    await expect(b.window.getByRole('img', { name: 'Minimap' })).toBeVisible()
    expect(await toggleMinimapMenu(a.app)).toBe(true)
    await expect(a.window.getByRole('img', { name: 'Minimap' })).toBeVisible()

    // ── An https:// link of B's HANDOFF opens in A's browser ──
    const handoff = a.window.getByTestId('handoff-node')
    await expect(handoff.getByRole('link', { name: 'the PR' })).toBeVisible()
    await handoff.getByRole('link', { name: 'the PR' }).click()
    await expect.poll(async () => (await recorded(a.app)).external).toEqual([PR_URL])
    expect((await recorded(b.app)).external).toEqual([])
    await evidence(a.window, 'link')

    // ── A Ticket file of B: a double click shows it in focus mode, read on B; its editor gives the hint, no editor anywhere ──
    const ticket = a.window.locator('.react-flow__node [data-testid="ticket-node"][data-ticket="1"]')
    await canvasReady(a, { visible: [ticket] })
    await ticket.dblclick()
    const focusLayer = a.window.getByTestId('focus-mode')
    const focused = focusLayer.getByTestId('ticket-node')
    await expect(focused.getByTestId('ticket-body')).toContainText('Written on B.')
    await focused.getByRole('button', { name: 'Open in editor' }).click()
    // A toast of the window (worfy-ui ticket 16), over focus mode, not a line of the Ticket.
    const hint = a.window.getByRole('region', { name: 'Notifications' }).getByTestId('file-elsewhere')
    await expect(hint).toHaveText(`File is on ${bName}`)
    await expect(hint).toBeVisible()
    await expect(hint).toHaveAttribute('data-kind', 'info')
    await expect(focused.getByTestId('file-elsewhere')).toHaveCount(0)
    await evidence(a.window, 'file-elsewhere')
    expect((await recorded(a.app)).paths).toEqual([])
    expect((await recorded(b.app)).paths).toEqual([])
    await a.window.keyboard.press('Escape')
    await expect(focusLayer).toHaveCount(0)

    // ── "+" in the Orchestrator's Session of B ──
    const orchestrator = a.window.getByTestId('orchestrator-node')
    await expect(orchestrator.getByTestId('orchestrator-state')).toHaveText('idle', { timeout: ms(30_000) })
    await orchestrator.locator('.w-orchestrator__header').dblclick()
    const view = a.window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    const intercepts = await interceptsFileChooser(a)
    console.log(`file chooser of A: ${intercepts ? 'filechooser event of Playwright' : 'setInputFiles on the hidden input'}`)
    if (intercepts) {
      const [chooser] = await Promise.all([a.window.waitForEvent('filechooser'), view.getByTestId('input-attach').click()])
      expect(chooser.isMultiple()).toBe(true)
      await chooser.setFiles(picked)
      test.info().annotations.push({ type: 'file chooser', description: 'filechooser event of Playwright' })
    } else {
      // Without interception the click would open a real macOS dialog: the hidden input is filled directly.
      await view.getByTestId('input-attach-file').setInputFiles(picked)
      test.info().annotations.push({ type: 'file chooser', description: 'setInputFiles on the hidden input' })
    }
    await expect(view.getByTestId('attachment-chip')).toHaveText([/notes-of-a\.txt/])
    await field.fill('read this')
    await evidence(a.window, 'attach')
    expect((await recorded(b.app)).dialogs).toBe(0)
    expect((await recorded(a.app)).dialogs).toBe(0)

    await field.press('Enter')
    await expect(view.getByTestId('attachment-chip')).toHaveCount(0)
    await expect.poll(() => messagesOf(bSetup.log).length, { timeout: ms(15_000) }).toBe(1)
    const sent = String(messagesOf(bSetup.log)[0]?.content)
    const match = /^read this\n\nAttached files: (\S+)$/.exec(sent)
    expect(match, sent).not.toBeNull()
    const copy = match?.[1] ?? ''
    // B's copy, in B's data folder of the Project, with the bytes from A.
    expect(copy.startsWith(`${join(bSetup.dataDir, BETA, 'attachments')}${sep}`), copy).toBe(true)
    expect(copy.endsWith(`${sep}notes-of-a.txt`), copy).toBe(true)
    expect(readFileSync(copy, 'utf8')).toBe('notes written on A')
    // Nothing was written into B's repository.
    expect(execFileSync('git', ['-C', bSetup.repo, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    expect((await recorded(b.app)).dialogs).toBe(0)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
