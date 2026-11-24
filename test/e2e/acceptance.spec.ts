import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'
import { launchApp, repoRoot } from './helpers'
import { snapshotThemes } from './snapshots'

// The Acceptance view (worfy-acceptance ticket 05) in the built app on the fake agent (launch-env.ts), which records
// every message it gets (WORFY_AGENT_LOG) and never calls a model. One Project in a temporary folder, its Tickets from
// a fixed epic-status answer; worfy reads their Evidence from the files.
// - the tab carries the count of Ready to check and opens the view; two panes: the groups on the left, the selected
//   item on the right with its Evidence — a screenshot whose thumbnail loads and a clip of test/fixtures/evidence-clip/
//   that loads in place, with its contact sheet;
// - ↑ and ↓ move between the two items;
// - Pass sends the Project's "Record owner check" template to the Orchestrator (the fake agent's log), the item reads
//   "Sent" and the next one is selected; the Harness's own `ticket evidence` then writes the `owner-check` line into
//   the Ticket file, and the item leaves the queue without a restart;
// - screenshots of the two panes at 1280 and 1600 px in both themes (test-results/worfy-acceptance-05-screens).
// Every name and text is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'shop-0000000a'
const EPIC = 'shop'
const TICKET_SCRIPT = join(repoRoot, 'harness', 'bin', 'ticket')
const CLIP_FIXTURE = join(repoRoot, 'test', 'fixtures', 'evidence-clip')
const SCREENS = join(repoRoot, 'test-results', 'worfy-acceptance-05-screens')
// Not the plugin's default word for word: without the plugin Harness a saved default reads back as the old Harness's
// default, which is empty (migrateProjectSettings).
const TEMPLATE = '/owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}'
/** The platform the window's Machine has: the one a decision names at first. */
const PLATFORM = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-acceptance-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const line = (kind: string, ref: string) => `  - evidence: ${kind} pass · ${ref} · mac dev · bacbbcef · scrub: 2026-11-04`

function ticketFile(num: number, title: string, items: readonly string[]): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — ${title}`, '', 'Type: task', 'Status: done', 'Blocked by: —', '', '## Done when', '', ...items, '', '## Result', '', 'text', ''].join('\n')
}

const ticketJson = (num: number, title: string) => ({
  epic: EPIC,
  num,
  slug: `ticket-${num}`,
  title: `${String(num).padStart(2, '0')} — ${title}`,
  statusRaw: 'done',
  state: 'done',
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
})

/** The messages the fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((each) => JSON.parse(each) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

test('the Acceptance tab: groups, an item with its screenshot and clip, ↑ ↓, Pass to the Orchestrator, the written line takes the item away; screenshots in both themes', async () => {
  test.setTimeout(ms(120_000))
  const repo = join(scratch, 'shop')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  const evidence = join(repo, '.scratch', EPIC, 'evidence')
  mkdirSync(issues, { recursive: true })
  mkdirSync(evidence)
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Shop\n')
  copyFileSync(join(CLIP_FIXTURE, 'clip.webm'), join(evidence, '03-clip.webm'))
  copyFileSync(join(CLIP_FIXTURE, 'clip.sheet.png'), join(evidence, '03-clip.sheet.png'))
  copyFileSync(join(CLIP_FIXTURE, 'clip.sheet.png'), join(evidence, '03-shot.png'))
  // 03: a test the agents proved, then the owner's check with a screenshot and a clip from a dev copy — not the
  // Stable copy its `needs:` names, so it still waits for the owner.
  const file03 = join(issues, '03-ticket-3.md')
  writeFileSync(
    file03,
    ticketFile(3, 'The cart badge', [
      '- [x] Unit test of the cart',
      '  - evidence: test-run pass · `pnpm test test/unit/cart.test.ts` exit 0 · mac dev · bacbbcef',
      '- [ ] (manual) Add an item to the cart → the badge shows **1**',
      '  - needs: mac stable',
      line('screenshot', '`../evidence/03-shot.png`'),
      line('video', '`../evidence/03-clip.webm`'),
    ]),
  )
  writeFileSync(join(issues, '04-ticket-4.md'), ticketFile(4, 'Search by code', ['- [ ] (manual) Search finds a product by its code', '  - needs: mac stable']))
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  git(repo, 'init', '-q')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/shop.git')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticketJson(3, 'The cart badge'), ticketJson(4, 'Search by code')] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'shop', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 1 } }))
  const harnessHome = join(scratch, 'no-harness-home')
  const log = join(scratch, 'agent.jsonl')

  const launched = await launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      WORFY_HARNESS_HOME: harnessHome,
      HARNESS_HOME: harnessHome,
      WORFY_AGENT_SCRIPT: 'orchestrator',
      WORFY_AGENT_LOG: log,
      // No Stable copy on this test's Machine: the queue names no commit for it, so the decision's sha is `-`, whatever
      // copy the machine running the test has installed.
      WORFY_UPDATE_STABLE: join(scratch, 'stable', process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app'),
    },
  })
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1600, height: 1000 })
    // The Project's templates with "Record owner check" set: without the plugin Harness its default is empty.
    const settings = (await bridgeCall(window, 'projects.settings.get', { id: PROJECT })).value as { actionTemplates: Record<string, string> }
    const set = await bridgeCall(window, 'projects.settings.set', { id: PROJECT, settings: { ...settings, actionTemplates: { ...settings.actionTemplates, ownerCheck: TEMPLATE } } })
    expect(set.ok, set.error).toBe(true)

    // The tab counts Ready to check and opens the view.
    const tab = window.getByTestId('acceptance-tab')
    await expect(tab).toHaveAttribute('title', 'Checks that wait for you')
    await expect(tab.getByTestId('acceptance-tab-count')).toHaveText('2', { timeout: ms(30_000) })
    await tab.click()
    const view = window.getByTestId('acceptance-view')
    await expect(view).toBeVisible()
    await expect(view.getByTestId('acceptance-group-title')).toHaveText(['▾ Ready to check · 2'])
    const pane: Locator = view.getByTestId('acceptance-pane')
    const rows = view.getByTestId('acceptance-row')
    await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true')
    await expect(pane).toContainText('shop · shop 03 — The cart badge')
    await expect(pane).toContainText('Item 2 of 2 · manual · needs mac stable')
    await expect(pane.getByTestId('acceptance-stable')).toHaveText('merged')
    await expect(pane.getByTestId('acceptance-text').locator('strong')).toHaveText('1')
    await expect(pane.getByTestId('acceptance-prepared')).toContainText('Prepared by the Orchestrator · 1 of 1 verified')

    // The Evidence of the item outside focus mode: the screenshot's thumbnail and the clip load, the sheet is offered.
    const matrix = pane.getByTestId('evidence-matrix')
    const thumb = matrix.getByTestId('evidence-thumb').locator('img')
    await expect.poll(() => thumb.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth), { timeout: ms(10_000) }).toBeGreaterThan(0)
    const video = matrix.getByTestId('evidence-video')
    await expect.poll(() => video.evaluate((node) => (node as unknown as { readyState: number }).readyState), { timeout: ms(10_000) }).toBeGreaterThanOrEqual(2)
    await expect(matrix.getByRole('link', { name: 'Contact sheet' })).toBeVisible()

    // Screenshots of the two panes, both widths, both themes.
    mkdirSync(SCREENS, { recursive: true })
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      const [list, shown] = await Promise.all([view.locator('.w-acc-list').boundingBox(), pane.boundingBox()])
      expect(list !== null && shown !== null && list.x + list.width <= shown.x + 1 && Math.abs(list.y - shown.y) < 2, 'the two panes side by side').toBe(true)
      const shots = await snapshotThemes(window, `acceptance-${width}`)
      for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `acceptance-${width}-${scheme}.png`))
      console.log(`acceptance ${width}: ${join(SCREENS, `acceptance-${width}-light.png`)} ${join(SCREENS, `acceptance-${width}-dark.png`)}`)
    }

    // ↑ ↓ move between the items.
    await rows.nth(0).focus()
    await window.keyboard.press('ArrowDown')
    await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true')
    await expect(pane).toContainText('shop 04 — Search by code')
    await window.keyboard.press('ArrowUp')
    await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true')

    // Pass: the template goes to the Orchestrator, the item reads Sent, the next one is selected.
    await pane.getByTestId('acceptance-words').fill('The badge shows 1')
    await pane.getByTestId('acceptance-pass').click()
    const sent = `/owner-check ${EPIC} 03 2 pass ${PLATFORM} stable -`
    await expect.poll(() => messages(log).find((text) => text.startsWith(sent)), { timeout: ms(30_000) }).toContain('The badge shows 1')
    await expect(rows.nth(0)).toContainText('Sent')
    await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true')

    // The skill's line, written by the Harness's own script: the item leaves the queue without a restart.
    const written = spawnSync(
      process.execPath,
      [TICKET_SCRIPT, 'evidence', EPIC, '03', '2', 'owner-check', 'pass', '--ref', '2026-11-24: The badge shows 1', '--platform', 'mac', '--copy', 'stable', '--sha', 'bacbbcef', '--root', join(repo, '.scratch')],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, HARNESS_HOME: harnessHome } },
    )
    expect(written.status, written.stderr).toBe(0)
    await expect(rows).toHaveCount(1, { timeout: ms(15_000) })
    await expect(rows.nth(0)).toContainText('shop 04')
    await expect(tab.getByTestId('acceptance-tab-count')).toHaveText('1')
    expect(readFileSync(file03, 'utf8')).toContain('owner-check pass')
  } finally {
    await launched.close()
  }
})
