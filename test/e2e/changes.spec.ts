import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The Changes view (worfy-changes-view tickets 03 and 08) in the built app, over a git repository the test builds in a
// temporary folder: Epic demo-cart with Ticket 04, whose branch changes, adds and deletes a few files, and Ticket 05,
// whose branch adds 300 files in 30 folders and a file of 2 100 lines. Ticket 04 also adds a TSX, a JSON and a Markdown
// file: the code of the diff takes the syntax colours of the GitHub themes, light and dark (ticket 10). Both branches are checked out nowhere, so
// Changes reads each branch against its merge-base with the local main (the Project has no Profile). The workflow
// comes from an `epic-status` script under the temporary Claude home that prints a fixed answer; the fake agent
// (WORFY_AGENT=fake, as every e2e run) is never asked: the screen only reads git.
//
// The Layout saved by an older version holds a Changes Node: main drops it when it reads the Layout. The button Changes
// on the card of Ticket 04 opens the Changes view over the whole main area, and its files and lines are those of
// `git diff <merge-base>`; «← Canvas» goes back to the Canvas. Open changes of the Command palette opens Ticket 05's
// view: its folders come folded, and the file of 2 100 lines comes folded as «Large diff».

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
  write(repo, 'src/Total.tsx', "import { sum } from './money'\n\n/** The total of the cart, in cents. */\nexport function Total({ items }: { items: number[] }) {\n  return <span className=\"total\">{sum(items)}</span>\n}\n")
  write(repo, 'config/discounts.json', '{\n  "maxShare": 0.5,\n  "stack": true,\n  "codes": ["SPRING", "VIP"]\n}\n')
  write(repo, 'docs/discounts.md', '# Discounts\n\nA cart takes **one** code; `maxShare` caps it.\n\n- SPRING — 10 %\n- VIP — 20 %\n')
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
  // A Changes Node an older version saved (ticket 03): this one drops it on reading the Layout (ticket 08).
  const oldNode = { id: `changes:${EPIC}/4`, kind: 'changes', x: 2000, y: 0, w: 960, h: 640, hidden: false, locked: false, pinned: false, tags: [], data: { ticket: { epic: EPIC, num: 4 } } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [oldNode], viewport: { x: 20, y: 20, zoom: 0.7 } }))
  return { env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome }, repo }
}

/** The lines `git diff <merge-base>` adds and deletes in `path`, as `+text` and `-text`. */
function gitLines(repo: string, mergeBase: string, branch: string, path: string): string[] {
  return git(repo, 'diff', '--no-color', mergeBase, branch, '--', path)
    .split('\n')
    .filter((line) => /^[+-]/u.test(line) && !/^(\+\+\+|---) /u.test(line))
}

/** The added and deleted lines the view shows for `path`, Inline, as `+text` and `-text`. */
async function shownLines(node: ReturnType<Page['locator']>, path: string): Promise<string[]> {
  return node.locator(`[data-testid="changes-hunk"][data-path="${path}"] [data-testid="changes-line"]`).evaluateAll((rows) =>
    rows.flatMap((row) => {
      const kind = row.getAttribute('data-kind')
      const code = row.querySelector('.w-changes__code')?.textContent ?? ''
      return kind === 'add' ? [`+${code}`] : kind === 'del' ? [`-${code}`] : []
    }),
  )
}

/** The ids of the Changes Nodes in the Layout main saved, sorted; null while the file does not read whole. */
function savedChanges(env: Record<string, string>): string[] | null {
  try {
    const layout = JSON.parse(readFileSync(join(env.WORFY_DATA_DIR!, PROJECT, 'layout.json'), 'utf8')) as { nodes: { id: string; kind: string }[] }
    return layout.nodes
      .filter((node) => node.kind === 'changes')
      .map((node) => node.id)
      .sort()
  } catch {
    // Read while main writes it: the next poll reads it whole.
    return null
  }
}

test('Changes on the card opens the view over the window with the files and lines of git diff <merge-base>; «← Canvas» goes back; Open changes of the palette opens a Ticket of 300 files folded; the old Changes Node is gone from the Layout', async () => {
  test.setTimeout(ms(150_000))
  const { env, repo } = prepare()
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })
    // main read the Layout an older version saved and dropped its Changes Node.
    await expect.poll(() => savedChanges(env), { timeout: ms(15_000) }).toEqual([])

    // The card of Ticket 04 → Changes.
    const card = window.locator('[data-testid="ticket-node"][data-ticket="4"]')
    const button = card.getByTestId('action-changes')
    await expect(button).toHaveAttribute('aria-disabled', 'false', { timeout: ms(15_000) })
    // The Ticket card with the Changes button, on the line of actions the layout gives it room for (ticket-card.ts).
    await snapshotThemes(window, 'changes-view-card')
    await button.click()
    const view = window.locator(`[data-testid="changes-view"][data-ticket="${EPIC}/04"]`)
    await expect(view).toBeVisible({ timeout: ms(15_000) })
    // Over the whole main area: the Canvas is hidden, and the view fills the place of the views under the toolbar.
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeHidden()
    const area = await window.locator('.w-shell__content').boundingBox()
    const box = await view.boundingBox()
    expect(area).not.toBeNull()
    expect(box).not.toBeNull()
    expect(Math.abs(box!.width - area!.width)).toBeLessThan(2)
    expect(Math.abs(box!.height - area!.height)).toBeLessThan(2)

    // The files and lines are those of git diff against the merge-base with main.
    const mergeBase = git(repo, 'merge-base', 'main', `${EPIC}/04`)
    const expected = git(repo, 'diff', '--name-only', mergeBase, `${EPIC}/04`).split('\n').sort()
    const tree = view.getByTestId('changes-tree-file')
    await expect(tree).toHaveCount(expected.length, { timeout: ms(15_000) })
    expect((await tree.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-path') ?? ''))).sort()).toEqual(expected)
    await expect(view.getByTestId('changes-meta')).toContainText(`main ← ${EPIC}/04 · base ${mergeBase.slice(0, 7)} · 6 files`)
    for (const path of ['src/cart.ts', 'src/discount.ts', 'src/legacy-tax.ts', 'src/Total.tsx', 'config/discounts.json', 'docs/discounts.md']) {
      await expect(view.locator(`[data-testid="changes-hunk"][data-path="${path}"]`).first()).toBeVisible({ timeout: ms(15_000) })
      expect(await shownLines(view, path)).toEqual(gitLines(repo, mergeBase, `${EPIC}/04`, path))
    }
    // The syntax colours (ticket 10): a keyword of the .ts file has a colour of its own, not that of plain text, in the
    // light and in the dark theme; the text of each line stayed that of git diff (shownLines above reads textContent).
    for (const path of ['src/cart.ts', 'src/Total.tsx', 'config/discounts.json', 'docs/discounts.md']) {
      await expect(view.locator(`[data-testid="changes-hunk"][data-path="${path}"] .w-changes__code[data-highlighted="true"]`).first()).toBeVisible({ timeout: ms(15_000) })
    }
    const keywordColours = async (): Promise<{ keyword: string | null; plain: string }> =>
      view.locator('[data-testid="changes-hunk"][data-path="src/cart.ts"]').first().evaluate((hunk) => {
        const page = globalThis as unknown as { getComputedStyle(of: unknown): { color: string } }
        const keyword = Array.from(hunk.querySelectorAll('.w-hl') as ArrayLike<{ textContent: string | null }>).find((token) => token.textContent === 'export')
        return { keyword: keyword === undefined ? null : page.getComputedStyle(keyword).color, plain: page.getComputedStyle(hunk.querySelector('.w-changes__code')).color }
      })
    const seen: Record<string, string | null> = {}
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme })
        const colours = await keywordColours()
        expect(colours.keyword).not.toBeNull()
        expect(colours.keyword).not.toBe(colours.plain)
        seen[colorScheme] = colours.keyword
      }
    } finally {
      await window.emulateMedia({ colorScheme: null })
    }
    // Each theme has its own keyword colour.
    expect(seen.light).not.toBe(seen.dark)
    await snapshotThemes(window, 'changes-view-inline')
    await view.getByTestId('changes-side-by-side').click()
    await expect(view.getByTestId('changes-diff')).toHaveAttribute('data-layout', 'side-by-side')
    await snapshotThemes(window, 'changes-view-side-by-side')
    await view.getByTestId('changes-inline').click()

    // Opening it put nothing into the Layout.
    expect(savedChanges(env)).toEqual([])

    // «← Canvas» goes back to the Canvas, the card where it was.
    await expect(view.getByTestId('changes-back')).toHaveText('← Canvas')
    await view.getByTestId('changes-back').click()
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    await expect(view).toBeHidden()
    await expect(button).toBeVisible()

    // Open changes of the Command palette, for Ticket 05.
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill(`open changes ${EPIC}/05`)
    await expect(window.locator(`[data-testid="palette-option"][data-command="changes:${EPIC}/05"]`)).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const big = window.locator(`[data-testid="changes-view"][data-ticket="${EPIC}/05"]`)
    await expect(big).toBeVisible({ timeout: ms(20_000) })

    // 301 files: the folders come folded; the diff draws only a window of the files.
    await expect(big.getByTestId('changes-file-count')).toHaveText('301', { timeout: ms(20_000) })
    const folders = big.getByTestId('changes-tree-folder')
    await expect(folders).toHaveCount(31)
    expect(await folders.evaluateAll((rows) => rows.every((row) => row.getAttribute('aria-expanded') === 'false'))).toBe(true)
    await expect(big.getByTestId('changes-tree-file')).toHaveCount(0)
    expect(await big.getByTestId('changes-file').count()).toBeLessThan(301)
    // The code of the files drawn is coloured; the diff, scrolled screen by screen to its end, keeps drawing a window
    // (ticket 10): the longest screen is noted for the ADR.
    await expect(big.locator('.w-changes__code[data-highlighted="true"]').first()).toBeVisible({ timeout: ms(15_000) })
    const scrolled = await big.getByTestId('changes-diff').evaluate(async (box) => {
      const page = globalThis as unknown as { requestAnimationFrame(callback: () => void): number }
      const frame = () => new Promise<void>((done) => page.requestAnimationFrame(() => page.requestAnimationFrame(() => done())))
      let longest = 0
      let steps = 0
      const started = performance.now()
      while (box.scrollTop + box.clientHeight < box.scrollHeight - 1 && steps < 400) {
        const at = performance.now()
        box.scrollTop += box.clientHeight
        await frame()
        longest = Math.max(longest, performance.now() - at)
        steps += 1
      }
      return { steps, longest: Math.round(longest), total: Math.round(performance.now() - started), drawn: Number(box.dataset.drawn) }
    })
    expect(scrolled.drawn).toBeLessThan(301)
    // The files at the end are read and coloured once there: the last of them (pkg/m29/file-299.ts) too.
    const startedLast = Date.now()
    await expect(big.locator('[data-testid="changes-hunk"][data-path="pkg/m29/file-299.ts"]')).toBeVisible({ timeout: ms(15_000) })
    const lastDrawnAfter = Date.now() - startedLast
    await expect(big.locator('[data-testid="changes-hunk"][data-path="pkg/m29/file-299.ts"] .w-changes__code[data-highlighted="true"]')).toBeVisible({ timeout: ms(15_000) })
    const measured = { ...scrolled, lastDrawnAfter, lastColouredAfter: Date.now() - startedLast }
    test.info().annotations.push({ type: 'ticket-10 300-file scroll', description: JSON.stringify(measured) })
    console.log(`[changes e2e] 300-file diff scrolled to its end: ${JSON.stringify(measured)}`)
    // No screen of the scroll waited on the colours: 18 ms measured, the bound leaves room for a slow runner.
    // unscaled: a time budget of the product (a step of the colours holds no screen), not a wait of the test
    expect(scrolled.longest).toBeLessThan(200)
    await big.getByTestId('changes-diff').evaluate((box) => {
      box.scrollTop = 0
    })

    // The file of 2 100 lines comes folded; the filter narrows the tree to it.
    await big.getByTestId('changes-filter').fill('catalog')
    await expect(big.getByTestId('changes-filter-count')).toHaveText('1 of 301 files')
    await expect(big.getByTestId('changes-tree-file')).toHaveCount(1)
    await expect(big.locator('[data-testid="changes-note"][data-path="data/catalog.json"]')).toContainText('Large diff · 2100 lines · Show')
    await snapshotThemes(window, 'changes-view-large')

    // Esc in the filter is the field's; on the view it goes back to the Canvas.
    await big.getByTestId('changes-filter').press('Escape')
    await expect(big).toBeVisible()
    // A click on the title takes the focus out of the field.
    await big.locator('.w-changes__title').click()
    await window.keyboard.press('Escape')
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    expect(savedChanges(env)).toEqual([])
  } finally {
    await launched.close()
  }
})
