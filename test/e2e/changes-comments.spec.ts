import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// Comments on lines of the Changes Node (worfy-changes-view ticket 05) in the built app, on the fake agent
// (test/fixtures/agent-scripts/message-input.jsonl), over a git repository the test builds in a temporary folder: Epic
// demo-cart with Ticket 04, whose branch changes src/cart.ts and adds src/discount.ts; the branch is checked out nowhere,
// so Changes reads it against its merge-base with the local main. No Session is bound to the Ticket, so «To» is the
// Orchestrator (spec, Q2).
//
// The card's Changes button opens the Node; a comment on a line by «+» in its gutter and one on a range (a click, a
// click with Shift, the key c) go into the tray; a reload of the window keeps them; Send gives the fake agent one
// message with the section «Comments on lines of the diff (2)», the paths, the lines and the code; the comments stay dim
// on their lines; the block of the message in the Orchestrator's chat opens Changes on its line.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'demo-cart-000003c0'
const EPIC = 'demo-cart'

type Call = { kind: string; text?: string; narrator?: boolean }

let scratch: string
let log: string
test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-changes-comments-')))
  log = join(scratch, 'agent.log')
})
test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function write(repo: string, path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

const lines = (count: number, make: (index: number) => string): string => `${Array.from({ length: count }, (_, index) => make(index)).join('\n')}\n`

/** The repository and Ticket 04's branch, the Claude home whose epic-status prints the Epic, and the data folder. */
function prepare(): { env: Record<string, string>; repo: string } {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo-cart')
  mkdirSync(repo, { recursive: true })
  write(repo, `.scratch/${EPIC}/spec.md`, '# Demo cart\n')
  write(repo, `.scratch/${EPIC}/issues/04-cart-total.md`, '# 04 — Ticket 4\n\nType: task\nStatus: claimed\nBlocked by: —\n')
  write(repo, 'src/cart.ts', lines(12, (index) => (index === 4 ? '  taxRate: number' : `export const line${index} = ${index}`)))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'checkout', '-q', '-b', `${EPIC}/04`)
  write(repo, 'src/cart.ts', lines(13, (index) => (index === 4 ? '  discount?: Discount' : index === 12 ? 'const MAX_DISCOUNT_SHARE = 0.5' : `export const line${index} = ${index}`)))
  write(repo, 'src/discount.ts', lines(4, (index) => `export const discount${index} = ${index}`))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'discounts')
  git(repo, 'checkout', '-q', 'main')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: EPIC, num: 4, slug: 'cart-total', title: '04 — Ticket 4', statusRaw: 'claimed — 2026-11-20', state: 'work', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo-cart', path: repo }], activeId: PROJECT }))
  return { env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'message-input', WORFY_AGENT_LOG: log }, repo }
}

/** What the fake agent got, message by message (WORFY_AGENT_LOG); the Live summary's calls are not the Session's. */
const messages = (): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'message' && call.narrator !== true)
    : []

/** The row of a line of `path` on a side, in the Node's Inline diff. */
const row = (node: Locator, path: string, line: number, side: 'old' | 'new' = 'new'): Locator => node.locator(`[data-testid="changes-hunk"][data-path="${path}"] [data-testid="changes-line"][data-side="${side}"][data-line="${line}"]`)

async function openNode(window: Page): Promise<Locator> {
  const button = window.locator('[data-testid="ticket-node"][data-ticket="4"]').getByTestId('action-changes')
  await expect(button).toHaveAttribute('aria-disabled', 'false', { timeout: ms(15_000) })
  await button.click()
  const node = window.locator(`[data-testid="changes-node"][data-ticket="${EPIC}/04"]`)
  await expect(node).toBeVisible({ timeout: ms(15_000) })
  return node
}

test('two comments — on a line and on a range — go to the Orchestrator as one message; they survive a reload; the block in the chat opens Changes on its line', async () => {
  test.setTimeout(ms(150_000))
  const { env, repo } = prepare()
  const head = git(repo, 'rev-parse', `${EPIC}/04`)
  const app = await launchApp({ env })
  try {
    const { window } = app
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await canvasReady(app, { size: { width: 1600, height: 1000 }, visible: [frame] })
    const node = await openNode(window)
    const tray = node.getByTestId('changes-tray')
    await expect(tray.getByTestId('changes-to')).toHaveText('Orchestrator', { timeout: ms(15_000) })

    // «+» in the gutter of a line.
    const target = row(node, 'src/cart.ts', 13)
    await expect(target).toBeVisible({ timeout: ms(15_000) })
    await target.hover()
    await target.getByTestId('changes-line-plus').click()
    let popover = window.getByTestId('changes-comment-popover')
    await expect(popover.getByTestId('changes-comment-where')).toHaveText('src/cart.ts:13 · new side')
    await popover.getByTestId('changes-comment-text').fill('Name the share in the config.')
    await popover.getByTestId('changes-comment-save').click()
    await expect(popover).toHaveCount(0)

    // A range: a click, a click with Shift, the key c.
    await expect(row(node, 'src/discount.ts', 1)).toBeVisible({ timeout: ms(15_000) })
    await row(node, 'src/discount.ts', 1).locator('.w-changes__code').click()
    await row(node, 'src/discount.ts', 3).locator('.w-changes__code').click({ modifiers: ['Shift'] })
    await window.keyboard.press('c')
    popover = window.getByTestId('changes-comment-popover')
    await expect(popover.getByTestId('changes-comment-where')).toHaveText('src/discount.ts:1–3 · new side')
    await popover.getByTestId('changes-comment-text').fill('One table instead of three constants.')
    await popover.getByTestId('changes-comment-save').click()
    await expect(popover).toHaveCount(0)

    await expect(tray.getByTestId('changes-tray-count')).toHaveText('2 comments on 2 files')
    await expect(node.getByTestId('changes-comment')).toHaveCount(2)
    // The tray with «To», for the ticket's result (not kept in the repository).
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await node.screenshot({ path: test.info().outputPath(`changes-tray-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // A reload of the window keeps the comments not sent yet.
    await window.reload()
    const again = window.locator(`[data-testid="changes-node"][data-ticket="${EPIC}/04"]`)
    await expect(again).toBeVisible({ timeout: ms(30_000) })
    await expect(again.getByTestId('changes-tray-count')).toHaveText('2 comments on 2 files', { timeout: ms(15_000) })
    await expect(again.getByTestId('changes-comment')).toHaveCount(2, { timeout: ms(15_000) })

    // Send: one message with both comments, their paths, lines and code. The Orchestrator's Node is out of sight (React
    // Flow does not draw it): Send reaches its Session through main, whatever it is doing.
    await again.getByTestId('changes-tray-text').fill('Fix both, then run the unit tests.')
    await again.getByTestId('changes-tray-send').click()
    await expect.poll(() => messages().length, { timeout: ms(20_000) }).toBe(1)
    expect(messages()[0]!.text).toBe(
      [
        `Comments on lines of the diff (2), branch ${EPIC}/04:`,
        '',
        `1. src/cart.ts:13 (new side, commit ${head.slice(0, 7)})`,
        '   > const MAX_DISCOUNT_SHARE = 0.5',
        '   Name the share in the config.',
        '',
        `2. src/discount.ts:1–3 (new side, commit ${head.slice(0, 7)})`,
        '   > export const discount0 = 0',
        '   > export const discount1 = 1',
        '   > export const discount2 = 2',
        '   One table instead of three constants.',
        '',
        'General:',
        'Fix both, then run the unit tests.',
      ].join('\n'),
    )
    await expect(again.getByTestId('changes-tray-count')).toHaveText('0 comments on 0 files')
    await expect(again.getByTestId('changes-comment')).toHaveCount(0)
    await expect(again.getByTestId('changes-comment-sent')).toHaveCount(2)

    // The block of the message in the Orchestrator's chat opens Changes on its line.
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('orchestrator')
    await window.locator('[data-testid="palette-option"][data-command="go-to:orchestrator"]').click()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    const block = view.getByTestId('quoted-prompt-code-block').filter({ hasText: 'src/discount.ts:1–3' })
    await expect(block).toBeVisible({ timeout: ms(15_000) })
    await block.getByTestId('quoted-prompt-code-source').click()
    await expect(again).toBeVisible({ timeout: ms(15_000) })
    await expect(row(again, 'src/discount.ts', 1)).toHaveAttribute('data-flash', 'true', { timeout: ms(5_000) })
    await expect(row(again, 'src/discount.ts', 1)).toBeInViewport()
  } finally {
    await app.close()
  }
})
