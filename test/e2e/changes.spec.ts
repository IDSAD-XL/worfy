import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The Changes Node (worfy-changes-view ticket 03) in the built app, over a git repository the test builds in a
// temporary folder: Epic demo-cart with Ticket 04, whose branch changes, adds and deletes a few files, and Ticket 05,
// whose branch adds 300 files in 30 folders and a file of 2 100 lines. Both branches are checked out nowhere, so
// Changes reads each branch against its merge-base with the local main (the Project has no Profile). The workflow
// comes from an `epic-status` script under the temporary Claude home that prints a fixed answer; the fake agent
// (WORFY_AGENT=fake, as every e2e run) is never asked: the screen only reads git.
//
// The button Changes on the card of Ticket 04 puts the Node next to the card, and its files and lines are those of
// `git diff <merge-base>`; a second click goes to the same Node. Open changes of the Command palette opens Ticket 05's
// Node: its folders come folded, and the file of 2 100 lines comes folded as «Large diff».

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const PROJECT = 'demo-cart-000003c0'
const EPIC = 'demo-cart'
const nn = (num: number): string => String(num).padStart(2, '0')

let scratch: string
test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-changes-')))
})
test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

function write(repo: string, path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

const lines = (count: number, make: (index: number) => string): string => `${Array.from({ length: count }, (_, index) => make(index)).join('\n')}\n`

const TICKETS = [
  { num: 4, slug: 'cart-total' },
  { num: 5, slug: 'catalog' },
] as const

/** The repository, its two Ticket branches, the Claude home whose epic-status prints the Epic, and the data folder. */
function prepare(): { env: Record<string, string>; repo: string } {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo-cart')
  mkdirSync(repo, { recursive: true })
  write(repo, `.scratch/${EPIC}/spec.md`, '# Demo cart\n')
  for (const ticket of TICKETS) write(repo, `.scratch/${EPIC}/issues/${nn(ticket.num)}-${ticket.slug}.md`, `# ${nn(ticket.num)} — Ticket ${ticket.num}\n\nType: task\nStatus: claimed\nBlocked by: —\n`)
  write(repo, 'src/cart.ts', lines(12, (index) => (index === 4 ? '  taxRate: number' : `export const line${index} = ${index}`)))
  write(repo, 'src/legacy-tax.ts', lines(5, (index) => `export const tax${index} = 0.${index}`))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  // Ticket 04: one file changed, one added, one deleted.
  git(repo, 'checkout', '-q', '-b', `${EPIC}/04`)
  write(repo, 'src/cart.ts', lines(13, (index) => (index === 4 ? '  discount?: Discount' : index === 12 ? 'const MAX_DISCOUNT_SHARE = 0.5' : `export const line${index} = ${index}`)))
  write(repo, 'src/discount.ts', lines(4, (index) => `export const discount${index} = ${index}`))
  git(repo, 'rm', '-q', 'src/legacy-tax.ts')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'discounts')

  // Ticket 05: 300 files in 30 folders, and a file of 2 100 lines.
  git(repo, 'checkout', '-q', 'main')
  git(repo, 'checkout', '-q', '-b', `${EPIC}/05`)
  for (let index = 0; index < 300; index += 1) write(repo, `pkg/m${nn(index % 30)}/file-${String(index).padStart(3, '0')}.ts`, `export const value = ${index}\n`)
  write(repo, 'data/catalog.json', lines(2100, (index) => `  { "sku": "item-${index}" },`))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'catalog')
  git(repo, 'checkout', '-q', 'main')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map((ticket) => ({
        epic: EPIC,
        num: ticket.num,
        slug: ticket.slug,
        title: `${nn(ticket.num)} — Ticket ${ticket.num}`,
        statusRaw: 'claimed — 2026-11-19',
        state: 'work',
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo-cart', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.7 } }))
  return { env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome }, repo }
}

/** The lines `git diff <merge-base>` adds and deletes in `path`, as `+text` and `-text`. */
function gitLines(repo: string, mergeBase: string, branch: string, path: string): string[] {
  return git(repo, 'diff', '--no-color', mergeBase, branch, '--', path)
    .split('\n')
    .filter((line) => /^[+-]/u.test(line) && !/^(\+\+\+|---) /u.test(line))
}

/** The added and deleted lines the Node shows for `path`, Inline, as `+text` and `-text`. */
async function shownLines(node: ReturnType<Page['locator']>, path: string): Promise<string[]> {
  return node.locator(`[data-testid="changes-hunk"][data-path="${path}"] [data-testid="changes-line"]`).evaluateAll((rows) =>
    rows.flatMap((row) => {
      const kind = row.getAttribute('data-kind')
      const code = row.querySelector('.w-changes__code')?.textContent ?? ''
      return kind === 'add' ? [`+${code}`] : kind === 'del' ? [`-${code}`] : []
    }),
  )
}

test('Changes on the card puts the Node next to it with the files and lines of git diff <merge-base>; a second click goes to it; Open changes of the palette opens a Ticket of 300 files folded', async () => {
  test.setTimeout(ms(150_000))
  const { env, repo } = prepare()
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })

    // The card of Ticket 04 → Changes.
    const card = window.locator('[data-testid="ticket-node"][data-ticket="4"]')
    const button = card.getByTestId('action-changes')
    await expect(button).toHaveAttribute('aria-disabled', 'false', { timeout: ms(15_000) })
    await button.click()
    const node = window.locator(`[data-testid="changes-node"][data-ticket="${EPIC}/04"]`)
    await expect(node).toBeVisible({ timeout: ms(15_000) })

    // Next to the card: right of it, at its height.
    const cardBox = (await card.boundingBox())!
    const nodeBox = (await node.boundingBox())!
    expect(nodeBox.x).toBeGreaterThan(cardBox.x + cardBox.width)
    expect(Math.abs(nodeBox.y - cardBox.y)).toBeLessThan(8)

    // The files and lines are those of git diff against the merge-base with main.
    const mergeBase = git(repo, 'merge-base', 'main', `${EPIC}/04`)
    const expected = git(repo, 'diff', '--name-only', mergeBase, `${EPIC}/04`).split('\n').sort()
    const tree = node.getByTestId('changes-tree-file')
    await expect(tree).toHaveCount(expected.length, { timeout: ms(15_000) })
    expect((await tree.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-path') ?? ''))).sort()).toEqual(expected)
    await expect(node.getByTestId('changes-meta')).toContainText(`main ← ${EPIC}/04 · base ${mergeBase.slice(0, 7)} · 3 files`)
    for (const path of ['src/cart.ts', 'src/discount.ts', 'src/legacy-tax.ts']) {
      await expect(node.locator(`[data-testid="changes-hunk"][data-path="${path}"]`).first()).toBeVisible({ timeout: ms(15_000) })
      expect(await shownLines(node, path)).toEqual(gitLines(repo, mergeBase, `${EPIC}/04`, path))
    }
    await snapshotThemes(window, 'changes-node-inline')
    await node.getByTestId('changes-side-by-side').click()
    await expect(node.getByTestId('changes-diff')).toHaveAttribute('data-layout', 'side-by-side')
    await snapshotThemes(window, 'changes-node-side-by-side')
    await node.getByTestId('changes-inline').click()

    // A second click goes to the Node already there.
    await button.click()
    await expect(window.getByTestId('changes-node')).toHaveCount(1)

    // Open changes of the Command palette, for Ticket 05.
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill(`open changes ${EPIC}/05`)
    await expect(window.locator(`[data-testid="palette-option"][data-command="changes:${EPIC}/05"]`)).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const big = window.locator(`[data-testid="changes-node"][data-ticket="${EPIC}/05"]`)
    await expect(big).toBeVisible({ timeout: ms(20_000) })
    await expect(window.getByTestId('changes-node')).toHaveCount(2)

    // 301 files: the folders come folded; the diff draws only a window of the files.
    await expect(big.getByTestId('changes-file-count')).toHaveText('301', { timeout: ms(20_000) })
    const folders = big.getByTestId('changes-tree-folder')
    await expect(folders).toHaveCount(31)
    expect(await folders.evaluateAll((rows) => rows.every((row) => row.getAttribute('aria-expanded') === 'false'))).toBe(true)
    await expect(big.getByTestId('changes-tree-file')).toHaveCount(0)
    expect(await big.getByTestId('changes-file').count()).toBeLessThan(301)

    // The file of 2 100 lines comes folded; the filter narrows the tree to it.
    await big.getByTestId('changes-filter').fill('catalog')
    await expect(big.getByTestId('changes-filter-count')).toHaveText('1 of 301 files')
    await expect(big.getByTestId('changes-tree-file')).toHaveCount(1)
    await expect(big.locator('[data-testid="changes-note"][data-path="data/catalog.json"]')).toContainText('Large diff · 2100 lines · Show')
    await snapshotThemes(window, 'changes-node-large')
  } finally {
    await launched.close()
  }
})
