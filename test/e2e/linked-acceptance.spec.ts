// The Acceptance view in a window on a Linked machine (worfy-acceptance ticket 07) on two built worfy: B keeps a
// Project whose done Ticket has a manual item for Windows; B gives A Read only. A opens B's Project, and its Acceptance
// tab shows B's queue: the item, where to check it, and Pass and Fail inactive with "<B> gives this Machine read-only
// access". The item names the build of the PC, or that no PC is connected. Full access on B makes Pass active, and Pass
// goes to the Orchestrator of the Project on B (the fake agent's log on B).
//
// Screenshots of the view at 1280 px in both themes: test-results/worfy-acceptance-07-screens/. Every name and text is
// invented.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, repoRoot, showSidebarSection, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'
import { ms } from '../time-scale'

test.setTimeout(ms(180_000))

const ALPHA = 'alpha-0000000a'
const SHOP = 'shop-00000007'
const EPIC = 'shop'
const SIZE = { width: 1280, height: 800 }
const HINT = /^.+ gives this Machine read-only access$/
const SCREENS = join(repoRoot, 'test-results', 'worfy-acceptance-07-screens')
// Not the plugin's default word for word: without the plugin Harness a saved default reads back as the old Harness's
// default, which is empty (migrateProjectSettings).
const TEMPLATE = '/owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

/** The messages B's fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((each) => JSON.parse(each) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/**
 * B: a committed repository `shop` with Epic `shop` and a done Ticket 07 whose manual item is checked on Windows; an
 * epic-status in B's Claude home that answers it; the fake agent records what B's Orchestrator gets.
 */
function prepareB(scratch: string) {
  const repo = join(scratch, 'shop')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Shop\n')
  writeFileSync(
    join(issues, '07-ticket-7.md'),
    ['# 07 — The cart on the PC', '', 'Type: task', 'Status: done', 'Blocked by: —', '', '## Done when', '', '- [ ] (manual) Add an item to the cart on the PC → the badge shows 1', '  - needs: windows stable', '', '## Result', '', 'text', ''].join('\n'),
  )
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
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
      tickets: [{ epic: EPIC, num: 7, slug: 'ticket-7', title: '07 — The cart on the PC', statusRaw: 'done', state: 'done', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = dataFolder(join(scratch, 'b-data'), [{ id: SHOP, name: 'shop', path: realpathSync.native(repo) }])
  mkdirSync(join(dataDir, SHOP), { recursive: true })
  writeFileSync(join(dataDir, SHOP, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 1 } }))
  const home = join(scratch, 'b-home')
  mkdirSync(home, { recursive: true })
  // B's login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the Node stubs.
  loginProfileWithNode(home)
  const harnessHome = join(scratch, 'b-no-harness')
  const log = join(scratch, 'b-agent.jsonl')
  return {
    log,
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: harnessHome, HARNESS_HOME: harnessHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log, SHELL: '/bin/sh', HOME: home },
  }
}

/** Opens the Acceptance tab of `window` unless its view shows already (a window loads again when the level changes). */
async function openAcceptance(window: Page): Promise<Locator> {
  const view = window.getByTestId('acceptance-view')
  if (!(await view.isVisible())) await window.getByTestId('acceptance-tab').click()
  await expect(view).toBeVisible()
  return view
}

test("Acceptance in a window on a Linked machine: B's queue in A, Read only — Pass and Fail inactive with the hint; Full access — Pass reaches B's Orchestrator", async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-acceptance-07-')))
  const alpha = join(scratch, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, 'init', '-q')
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: ALPHA, name: 'alpha', path: realpathSync.native(alpha) }])
  const bSetup = prepareB(scratch)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    // B's "Record owner check" template: without the plugin Harness its default is empty.
    const settings = (await bridgeCall(b.window, 'projects.settings.get', { id: SHOP })).value as { actionTemplates: Record<string, string> }
    const set = await bridgeCall(b.window, 'projects.settings.set', { id: SHOP, settings: { ...settings, actionTemplates: { ...settings.actionTemplates, ownerCheck: TEMPLATE } } })
    expect(set.ok, set.error).toBe(true)
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)

    // On B: access on, and A's level Read only.
    const settingsDialog = await openMachinesSettings(b)
    await settingsDialog.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settingsDialog.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)

    // A opens shop of B: the window loads on B.
    await showSidebarSection(a.window, 'Projects')
    const shopRow = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${SHOP}"]`)
    await expect(shopRow).toContainText('shop', { timeout: ms(20_000) })
    await shopRow.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))

    // The Acceptance tab of A's window is B's queue.
    await expect(a.window.getByTestId('acceptance-tab').getByTestId('acceptance-tab-count')).toHaveText('1', { timeout: ms(30_000) })
    const view = await openAcceptance(a.window)
    await expect(view.getByTestId('acceptance-group-title')).toHaveText(['▾ Ready to check · 1'])
    const pane = view.getByTestId('acceptance-pane')
    await expect(pane).toContainText('shop · shop 07 — The cart on the PC')
    await expect(pane).toContainText('Item 1 of 1 · manual · needs windows stable')
    // Where it is checked: B's build when B is the PC; here B runs on this computer, so no PC is connected.
    await expect(pane.getByTestId('acceptance-linked-build')).toHaveText(process.platform === 'win32' ? /^PC build: .+ \(.+\)$/ : 'PC not connected')
    // Read only: Pass and Fail stay on screen, inactive, with the hint.
    for (const verdict of ['pass', 'fail']) {
      const button = pane.getByTestId(`acceptance-${verdict}`)
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await expect(button).toHaveAttribute('title', HINT)
    }
    await pane.getByTestId('acceptance-pass').click({ force: true })

    mkdirSync(SCREENS, { recursive: true })
    const shots = await snapshotThemes(a.window, 'acceptance-07-linked-read-only')
    for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `linked-read-only-1280-${scheme}.png`))
    console.log(`linked acceptance 1280: ${join(SCREENS, 'linked-read-only-1280-light.png')} ${join(SCREENS, 'linked-read-only-1280-dark.png')}`)
    expect(messages(bSetup.log).filter((text) => text.startsWith('/owner-check'))).toEqual([])

    // Full access on B: Pass is active again, and the decision reaches the Orchestrator of the Project on B.
    const again = await openMachinesSettings(b)
    await chooseLevel(b.window, again.getByTestId(`link-machine-access-${aId}`), 'all')
    await closeSettings(b.window)
    await expect(async () => {
      const shown = await openAcceptance(a.window)
      await expect(shown.getByTestId('acceptance-pass')).toHaveAttribute('aria-disabled', 'false', { timeout: ms(2_000) })
    }).toPass({ timeout: ms(30_000) })
    await a.window.getByTestId('acceptance-words').fill('The badge shows 1')
    await a.window.getByTestId('acceptance-pass').click()
    await expect.poll(() => messages(bSetup.log).find((text) => text.startsWith(`/owner-check ${EPIC} 07 1 pass `)), { timeout: ms(30_000) }).toMatch(/^\/owner-check shop 07 1 pass (mac|windows|linux) stable \S+\n\nOwner's words:\n> The badge shows 1$/)
    await expect(a.window.getByTestId('acceptance-row').first()).toContainText('Sent', { timeout: ms(15_000) })
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
