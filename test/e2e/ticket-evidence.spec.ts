import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { catScript } from '../harness-node'
import { canvasReady, expectSettledWithoutOverlaps, launchApp, repoRoot, ticketCardCuts } from './helpers'
import { ms } from '../time-scale'
import { canvasImageUrl, evidenceFileUrl } from '../../src/shared/images'

// The Evidence of a Ticket in the built app (worfy-evidence ticket 06). The cards carry the chip «Evidence n/m» —
// neutral, green, red — and the widest card, with a gate, a PR, CI, a verdict and Evidence, keeps every chip
// whole and does not reach the card below it. A double click opens focus mode with the Evidence matrix above
// the Ticket's text; a click on `PR #N` there asks main to open the PR's page on the repository of `origin`
// (`shell.openExternal` is a recorder, so no browser opens). A line the Harness's own `ticket evidence`
// writes into the file turns the chip into «Evidence 2/3» without a restart. A fixture Project in a
// temporary folder, the fake agent (launch-env.ts), `gh` the stand-in over a prs.json; the screenshots
// of the chips and the matrix in both themes go to the test's output.
//
// The second test (worfy-evidence ticket 12): a screenshot line's thumbnail in the matrix opens the image over the
// window, and a video line's clip — the fixture of test/fixtures/evidence-clip/, drawn from a pattern, no sound —
// plays in place from worfy-image://evidence-<project label>/ and seeks to its middle, which needs the protocol's
// 206 answers to a Range. Its Project's label is digits only (`00000006`): a Canvas image of it loads too, and
// the window's own URL parser takes the addresses of both stores, which it would refuse as `canvas.00000006`
// or `evidence.00000006` (an IPv4 address to Chromium).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-00000006'
const EPIC = 'demo'
const ORIGIN = 'https://github.com/example/demo.git'
const PAGE = 'https://github.com/example/demo'
const TICKET_SCRIPT = join(repoRoot, 'harness', 'bin', 'ticket')
const CLIP_FIXTURE = join(repoRoot, 'test', 'fixtures', 'evidence-clip')

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-ticket-evidence-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const line = (kind: string, verdict: string, ref: string, machine: string) => `  - evidence: ${kind} ${verdict} · ${ref} · ${machine} · bacbbcef`

/** A Ticket file whose done section has `items`: a checkbox line, then its Evidence lines. */
function ticketFile(num: number, status: string, items: readonly (readonly string[])[]): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Done when', '', ...items.flat(), '', '## Result', '', 'text', ''].join('\n')
}

const ticketJson = (num: number, status: string, state: string) => ({
  epic: EPIC,
  num,
  slug: `ticket-${num}`,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  statusRaw: status,
  state,
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
})

/** One item verified, one with no Evidence, one reviewed only: «Evidence 1/3», neutral. */
const ONE_OF_THREE = [
  ['- [x] Unit test of the chip', line('test-run', 'pass', '`pnpm test test/unit/evidence-matrix.test.tsx` exit 0', 'mac dev')],
  ['- [ ] The e2e test of the card'],
  ['- [ ] Reviewed', line('review', 'pass', 'PR #1234', '- -')],
]

/** Replaces main's `shell.openExternal` with a recorder of the addresses it is asked to open. */
async function recordOpenedUrls(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const urls: string[] = []
    ;(globalThis as unknown as { openedUrls: string[] }).openedUrls = urls
    shell.openExternal = async (url: string) => {
      urls.push(url)
    }
  })
}

const openedUrls = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls)

async function bothThemes(window: Page, target: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await target.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('the Evidence chip on the cards, the matrix in focus mode, its PR link through shell.openExternal, and a written Evidence line without a restart', async () => {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo\n')
  // 06: the widest card — a worktree (gate), PR #1234 with CI failing and the REJECTED mark, and Evidence 1/3.
  writeFileSync(join(issues, '06-ticket-6.md'), ticketFile(6, 'claimed — 2026-11-04', ONE_OF_THREE))
  // 07: Evidence 1/3, the Ticket the test focuses and writes a line to.
  const file07 = join(issues, '07-ticket-7.md')
  writeFileSync(file07, ticketFile(7, 'open', ONE_OF_THREE))
  // 08: every item verified, green; 09: a failed item, red.
  writeFileSync(
    join(issues, '08-ticket-8.md'),
    ticketFile(8, 'open', [
      ['- [x] Unit test', line('test-run', 'pass', '`pnpm test` exit 0', 'mac dev')],
      ['- [x] CI green', line('ci-check', 'pass', 'https://github.com/example/demo/actions/runs/1', 'ci ci')],
    ]),
  )
  writeFileSync(
    join(issues, '09-ticket-9.md'),
    ticketFile(9, 'open', [
      ['- [x] Unit test', line('test-run', 'pass', '`pnpm test` exit 0', 'mac dev')],
      ['- [ ] CI green', line('ci-check', 'fail', 'https://github.com/example/demo/actions/runs/2', 'ci ci')],
    ]),
  )
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  git(repo, 'init', '-q')
  git(repo, 'remote', 'add', 'origin', ORIGIN)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/06', join(repo, '.claude', 'worktrees', '06'))

  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [ticketJson(6, 'claimed — 2026-11-04', 'work'), ticketJson(7, 'open', 'open'), ticketJson(8, 'open', 'open'), ticketJson(9, 'open', 'open')],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  // The gate knows this repository, so the worktree of 06 shows «gate: no data».
  mkdirSync(join(claudeHome, 'gate', 'state'), { recursive: true })
  writeFileSync(join(claudeHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo', pm: 'pnpm' }] }))

  // GitHub: PR #1234 on demo/06, CI failing, a review failure mark on its head commit.
  const ghDir = join(scratch, 'gh')
  mkdirSync(ghDir)
  writeFileSync(
    join(ghDir, 'prs.json'),
    JSON.stringify([
      {
        number: 1234,
        headRefName: 'demo/06',
        state: 'OPEN',
        url: `${PAGE}/pull/1234`,
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', context: 'review', state: 'FAILURE' },
        ],
        comments: [],
      },
    ]),
  )

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 1 } }))
  const harnessHome = join(scratch, 'no-harness-home')

  const launched = await launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: harnessHome, HARNESS_HOME: harnessHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: join(ghDir, 'calls.jsonl') },
  })
  try {
    const { app, window } = launched
    await recordOpenedUrls(app)
    const selector = (num: number) => `.react-flow__node [data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="${num}"]`
    const card = (num: number): Locator => window.locator(selector(num))
    await canvasReady(launched, { visible: [card(6), card(7), card(8), card(9)], size: { width: 1600, height: 1000 } })

    // The chip on every card, in its colour, with the counts as tooltip.
    const chip = (num: number) => card(num).getByTestId('evidence-chip')
    await expect(chip(7)).toHaveText('Evidence 1/3')
    await expect(chip(7)).toHaveAttribute('data-value', 'open')
    await expect(chip(7)).toHaveAttribute('title', '1 verified, 2 not verified, 0 failed')
    await expect(chip(8)).toHaveText('Evidence 2/2')
    await expect(chip(8)).toHaveAttribute('data-value', 'ready')
    await expect(chip(9)).toHaveText('Evidence 1/2')
    await expect(chip(9)).toHaveAttribute('data-value', 'blocked')
    await expect(chip(9)).toHaveAttribute('title', '1 verified, 0 not verified, 1 failed')

    // The widest card: five chips, every one whole, inside the card, and the cards do not overlap.
    await expect(card(6).getByTestId('checks-gate')).toHaveText('gate: no data')
    await expect(card(6).getByTestId('checks-pr')).toHaveText('PR #1234')
    await expect(card(6).getByTestId('checks-ci')).toHaveText('CI failing')
    await expect(card(6).getByTestId('checks-verdict')).toHaveText('REJECTED')
    await expect(chip(6)).toHaveText('Evidence 1/3')
    await expectSettledWithoutOverlaps(
      window,
      [6, 7, 8, 9].map((num) => ({ name: `Ticket ${num}`, selector: selector(num) })),
      'the Ticket cards do not overlap',
    )
    expect(await ticketCardCuts(card(6)), 'nothing is cut on the card with five chips').toEqual([])
    const inside = await card(6).evaluate((node) => {
      type Rect = { left: number; top: number; right: number; bottom: number }
      type El = { getBoundingClientRect(): Rect; querySelectorAll(selector: string): ArrayLike<El>; getAttribute(name: string): string | null }
      const box = (node as unknown as El).getBoundingClientRect()
      return Array.from((node as unknown as El).querySelectorAll('[data-testid^="checks-"], [data-testid="evidence-chip"], .w-ticket__actions'))
        .map((element) => ({ id: element.getAttribute('data-testid') ?? 'actions', rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom - 1)
        .map(({ id }) => id)
    })
    expect(inside, 'every chip and the actions end inside the card, above its border').toEqual([])

    await bothThemes(window, window.getByTestId('epic-frame'), 'evidence-chips')

    // Focus mode on 07: the matrix above the Ticket's text.
    await card(7).dblclick()
    const tile = window.getByTestId('focus-mode').getByTestId('focus-tile')
    await expect(tile).toHaveCount(1)
    const matrix = tile.getByTestId('evidence-matrix')
    await expect(matrix.getByRole('heading')).toHaveText('Evidence · 1 of 3 verified')
    await expect(matrix.getByTestId('evidence-state')).toHaveText(['Verified', 'Not verified: no evidence', 'Not verified: review only'])
    await expect(tile.getByTestId('ticket-body')).toContainText('Unit test of the chip')
    const order = await tile.evaluate((node) => {
      type El = { querySelector(selector: string): { compareDocumentPosition(other: unknown): number } | null }
      const root = node as unknown as El
      return root.querySelector('[data-testid="evidence-matrix"]')!.compareDocumentPosition(root.querySelector('[data-testid="ticket-body"]')) & 4
    })
    expect(order, 'the matrix comes before the text').toBe(4)
    await bothThemes(window, tile, 'evidence-matrix')

    // PR #N opens the PR's page on the repository of origin.
    await matrix.getByRole('link', { name: 'PR #1234' }).click()
    await expect.poll(() => openedUrls(app)).toEqual([`${PAGE}/pull/1234`])

    // The Harness writes an Evidence line for item 2: the chip and the matrix follow without a restart.
    const written = spawnSync(
      process.execPath,
      [TICKET_SCRIPT, 'evidence', EPIC, '07', '2', 'test-run', 'pass', '--ref', '`pnpm test:e2e test/e2e/ticket-evidence.spec.ts` exit 0', '--platform', 'mac', '--copy', 'dev', '--sha', 'bacbbcef', '--root', join(repo, '.scratch')],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, HARNESS_HOME: harnessHome } },
    )
    expect(written.status, written.stderr).toBe(0)
    await expect(tile.getByTestId('evidence-chip')).toHaveText('Evidence 2/3', { timeout: ms(15_000) })
    await expect(matrix.getByRole('heading')).toHaveText('Evidence · 2 of 3 verified')

    await window.keyboard.press('Escape')
    await expect(window.getByTestId('focus-mode')).toHaveCount(0)
    await expect(chip(7)).toHaveText('Evidence 2/3')
  } finally {
    await launched.close()
  }
})

test('the matrix shows a screenshot over the window and plays a clip in place, seeking to its middle', async () => {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  const evidence = join(repo, '.scratch', EPIC, 'evidence')
  mkdirSync(issues, { recursive: true })
  mkdirSync(evidence)
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo\n')
  copyFileSync(join(CLIP_FIXTURE, 'clip.webm'), join(evidence, '12-clip.webm'))
  copyFileSync(join(CLIP_FIXTURE, 'clip.sheet.png'), join(evidence, '12-clip.sheet.png'))
  copyFileSync(join(CLIP_FIXTURE, 'clip.sheet.png'), join(evidence, '12-shot.png'))
  writeFileSync(
    join(issues, '12-ticket-12.md'),
    ticketFile(12, 'open', [
      ['- [ ] (manual) The matrix shows the screenshot', `${line('screenshot', 'pass', '`../evidence/12-shot.png`', 'mac dev')} · scrub: 2026-11-04`],
      ['- [ ] (manual) The clip plays', `${line('video', 'pass', '`../evidence/12-clip.webm`', 'mac dev')} · scrub: 2026-11-04`],
    ]),
  )

  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticketJson(12, 'open', 'open')] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  // A Canvas image of the same Project, whose label is digits only.
  const picture = `${'a'.repeat(32)}.png`
  mkdirSync(join(dataDir, PROJECT, 'images'))
  copyFileSync(join(CLIP_FIXTURE, 'clip.sheet.png'), join(dataDir, PROJECT, 'images', picture))
  const imageNode = { id: 'pic', kind: 'image', x: 40, y: 40, w: 320, h: 55, hidden: false, locked: false, pinned: false, tags: [], data: { file: picture, width: 640, height: 110, mime: 'image/png' } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [imageNode], viewport: { x: 40, y: 40, zoom: 1 } }))
  const harnessHome = join(scratch, 'no-harness-home')

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: harnessHome, HARNESS_HOME: harnessHome } })
  try {
    const { window } = launched
    const card = window.locator(`.react-flow__node [data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="12"]`)
    await canvasReady(launched, { visible: [card], size: { width: 1600, height: 1000 } })

    // The label 00000006 as the window parses it: the address of each store is a URL, the old spelling is not.
    const parsed = await window.evaluate(
      (urls) => urls.map((url) => URL.canParse(url)),
      [canvasImageUrl(PROJECT, picture, null)!, evidenceFileUrl(PROJECT, 'demo/evidence/12-shot.png', null)!, `worfy-image://canvas.00000006/${picture}`, 'worfy-image://evidence.00000006/x.png'],
    )
    expect(parsed).toEqual([true, true, false, false])
    const canvasPicture = window.locator('[data-testid="image-node"][data-node-id="pic"]').getByRole('img', { name: 'Image' })
    await expect(canvasPicture).toHaveAttribute('src', `worfy-image://canvas-00000006/${picture}`)
    await expect(canvasPicture).toHaveJSProperty('naturalWidth', 640)

    await card.dblclick()
    const tile = window.getByTestId('focus-mode').getByTestId('focus-tile')
    const matrix = tile.getByTestId('evidence-matrix')
    await expect(matrix.getByRole('heading')).toHaveText('Evidence · 2 of 2 verified')

    // The screenshot: a thumbnail that loaded, and the image over the window on a click.
    const thumb = matrix.getByTestId('evidence-thumb').locator('img')
    await expect.poll(() => thumb.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)
    await matrix.getByTestId('evidence-thumb').click()
    const overlay = window.getByTestId('image-overlay-image')
    await expect.poll(() => overlay.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(640)
    await expect(window.getByTestId('image-overlay').getByRole('button', { name: 'Open in default app' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('image-overlay')).toHaveCount(0)
    await expect(window.getByTestId('focus-mode')).toHaveCount(1)

    // The clip: its metadata and a first frame load, it plays, and it seeks to its middle.
    const video = matrix.getByTestId('evidence-video')
    type Media = { readyState: number; currentTime: number; duration: number; paused: boolean; play(): Promise<void>; pause(): void; addEventListener(type: string, listener: () => void, options: { once: boolean }): void }
    await expect.poll(() => video.evaluate((node) => (node as unknown as Media).readyState), { timeout: ms(10_000) }).toBeGreaterThanOrEqual(2)
    const duration = await video.evaluate((node) => (node as unknown as Media).duration)
    expect(duration, 'the fixture clip is 4 s long').toBeGreaterThan(3.5)
    expect(duration).toBeLessThan(4.5)
    await video.evaluate((node) => (node as unknown as Media).play())
    await expect.poll(() => video.evaluate((node) => (node as unknown as Media).currentTime), { timeout: ms(10_000) }).toBeGreaterThan(0.3)
    const middle = await video.evaluate(
      (node, to) =>
        new Promise<number>((resolve) => {
          const media = node as unknown as Media & { currentTime: number }
          media.pause()
          media.addEventListener('seeked', () => resolve(media.currentTime), { once: true })
          media.currentTime = to
        }),
      duration / 2,
    )
    expect(Math.abs(middle - duration / 2), 'the clip seeks to its middle').toBeLessThan(0.25)
    await expect.poll(() => video.evaluate((node) => (node as unknown as Media).readyState)).toBeGreaterThanOrEqual(2)

    // The contact sheet over the window.
    await matrix.getByRole('link', { name: 'Contact sheet' }).click()
    await expect.poll(() => overlay.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(640)
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('image-overlay')).toHaveCount(0)

    await bothThemes(window, matrix, 'evidence-preview')
  } finally {
    await launched.close()
  }
})
