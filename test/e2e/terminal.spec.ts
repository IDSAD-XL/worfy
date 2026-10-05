import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchOptions } from './helpers'

// The Terminal Node against the built app: "New terminal" in the Canvas context menu starts the
// user's shell in the Project root on a real pty; the Node's size is the pty's size; the output
// survives the Session view, a reload of the window and the Node scrolling away; closing the Node
// and quitting worfy leave no shell process behind. The shell is /bin/sh (SHELL below), so no rc
// file of the machine running the tests decides what the terminal prints.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let root: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-term-')))
  dataDir = join(scratch, 'data')
  root = join(scratch, 'alpha')
  mkdirSync(root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (options: LaunchOptions = {}) => launchApp({ ...options, env: { WORFY_DATA_DIR: dataDir, SHELL: '/bin/sh', ...options.env } })

/** True while a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface StateNode {
  id: string
  kind: string
  w: number
  h: number
}

async function terminalNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke(
        'layout.get',
        { projectId: id },
      ),
    PROJECT,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes.filter((node) => node.kind === 'terminal')
}

/** Right click on an empty spot of the Canvas, then "New terminal". */
async function newTerminal(window: Page): Promise<Locator> {
  await window.locator('.react-flow__pane').click({ button: 'right', position: { x: 80, y: 60 } })
  const menu = window.getByRole('menu', { name: 'Canvas' })
  await menu.getByRole('menuitem', { name: 'New terminal' }).click()
  await expect(menu).toBeHidden()
  const node = window.getByTestId('terminal-node')
  await expect(node).toHaveCount(1)
  await expect(node).toHaveAttribute('data-state', 'running')
  return node
}

async function pidOf(node: Locator): Promise<number> {
  const pid = Number(await node.getAttribute('data-pid'))
  expect(pid).toBeGreaterThan(0)
  return pid
}

/** What the terminal shows; xterm.js draws spaces as no-break spaces. */
async function screenText(node: Locator): Promise<string> {
  return (await node.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')
}

/**
 * Runs `pwd` and waits for the Project root. A long path wraps over several rows of the screen,
 * so the rows are joined first; the prompt of /bin/sh does not show the folder, so the root
 * appears only in the output of pwd.
 */
async function expectPwdIsRoot(window: Page, node: Locator): Promise<void> {
  await node.getByTestId('terminal-screen').click()
  await window.keyboard.type('pwd')
  await window.keyboard.press('Enter')
  await expect.poll(async () => (await screenText(node)).replace(/\n/g, ''), { timeout: 10_000 }).toContain(root)
}

/** Types a command into the terminal and waits until the screen matches `expected`. */
async function run(window: Page, node: Locator, command: string, expected: RegExp): Promise<void> {
  await node.getByTestId('terminal-screen').click()
  await window.keyboard.type(command)
  await window.keyboard.press('Enter')
  await expect.poll(() => screenText(node), { timeout: 10_000 }).toMatch(expected)
}

/** The last `cols=N rows=M` the shell printed. */
async function lastSize(node: Locator): Promise<{ cols: number; rows: number }> {
  const matches = [...(await screenText(node)).matchAll(/size=(\d+)x(\d+)/g)]
  const last = matches.at(-1)
  if (!last) throw new Error('no size on the screen')
  return { cols: Number(last[1]), rows: Number(last[2]) }
}

async function printSize(window: Page, node: Locator, tag: string): Promise<{ cols: number; rows: number }> {
  // The output differs from the echoed command line (`$(…)`), so the regex matches only the output.
  await run(window, node, `echo "${tag}-size=$(tput cols)x$(tput lines)"`, new RegExp(`${tag}-size=\\d+x\\d+`))
  return lastSize(node)
}

async function drag(window: Page, from: Locator, dx: number, dy: number): Promise<void> {
  const box = await from.boundingBox()
  if (!box) throw new Error('the element has no box')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
  await window.mouse.up()
}

test('New terminal starts the shell in the Project root; resize, Session view and reload keep it; closing the Node ends it', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const pid = await pidOf(node)
    expect(alive(pid)).toBe(true)
    expect(await terminalNodes(window)).toMatchObject([{ kind: 'terminal', w: 560, h: 340 }])

    // `pwd` prints the Project root; TERM_PROGRAM is worfy.
    await expectPwdIsRoot(window, node)
    await run(window, node, 'echo "tp=$TERM_PROGRAM"', /^tp=worfy$/m)

    // The pty has the size the Node shows, and follows a resize of the Node.
    const before = await printSize(window, node, 'a')
    expect(before.cols).toBeGreaterThan(40)
    await node.locator('.w-terminal__header').click()
    await drag(window, window.locator('.react-flow__resize-control.handle.bottom.right'), 240, 120)
    await expect.poll(async () => (await terminalNodes(window))[0]?.w ?? 0).toBeGreaterThan(700)
    const after = await printSize(window, node, 'b')
    expect(after.cols).toBeGreaterThan(before.cols + 20)
    expect(after.rows).toBeGreaterThan(before.rows + 4)

    // Session view and back: the output is still there and the terminal is fitted to the Node
    // again (xterm.js cannot measure itself while the Canvas is display:none).
    await run(window, node, 'echo mark""er-one', /^marker-one$/m)
    const view = window.getByRole('group', { name: 'View' })
    await view.getByRole('button', { name: 'Session' }).click()
    await expect(node).toBeHidden()
    await view.getByRole('button', { name: 'Canvas' }).click()
    await expect(node).toBeVisible()
    expect(await screenText(node)).toMatch(/^marker-one$/m)
    expect(await printSize(window, node, 'c')).toEqual(after)
    expect(await pidOf(node)).toBe(pid)

    // The Node resized while the Canvas is hidden (by main, as a tool would): the terminal is
    // fitted when the Canvas shows again, not while it has no size.
    await view.getByRole('button', { name: 'Session' }).click()
    await expect(node).toBeHidden()
    const [stored] = await terminalNodes(window)
    if (!stored) throw new Error('no terminal node')
    const resized = await window.evaluate(
      ({ projectId, id }) =>
        (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean }> } }).worfy.invoke('layout.apply', {
          projectId,
          op: { op: 'resize', id, w: 480, h: 260 },
        }),
      { projectId: PROJECT, id: stored.id },
    )
    expect(resized.ok).toBe(true)
    await view.getByRole('button', { name: 'Canvas' }).click()
    await expect(node).toBeVisible()
    const shrunk = await printSize(window, node, 'd')
    expect(shrunk.cols).toBeLessThan(before.cols)
    expect(shrunk.cols).toBeGreaterThan(40)
    await window.screenshot({ path: test.info().outputPath('terminal.png') })

    // A reload of the window attaches to the same shell and redraws its output.
    await window.reload()
    const reloaded = window.getByTestId('terminal-node')
    await expect(reloaded).toHaveAttribute('data-state', 'running')
    expect(await pidOf(reloaded)).toBe(pid)
    await expect.poll(() => screenText(reloaded)).toMatch(/^marker-one$/m)
    await run(window, reloaded, 'echo mark""er-two', /^marker-two$/m)

    // Closing the Node removes it from the Layout and ends the shell.
    await reloaded.getByRole('button', { name: 'Close terminal' }).click()
    await expect(reloaded).toHaveCount(0)
    expect(await terminalNodes(window)).toEqual([])
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
  } finally {
    await launched.close()
  }
})

test('quitting worfy ends every shell; after a restart the Node starts a new shell in the same folder', async () => {
  const first = await launch()
  let pids: number[]
  try {
    const { window } = first
    const node = await newTerminal(window)
    await run(window, node, 'echo old""-output', /^old-output$/m)
    // A second terminal, with a job running in it.
    await window.locator('.react-flow__pane').click({ button: 'right', position: { x: 700, y: 60 } })
    await window.getByRole('menu', { name: 'Canvas' }).getByRole('menuitem', { name: 'New terminal' }).click()
    const nodes = window.getByTestId('terminal-node')
    await expect(nodes).toHaveCount(2)
    await expect(nodes.nth(1)).toHaveAttribute('data-state', 'running')
    await run(window, nodes.nth(1), 'sleep 600', /sleep 600/)
    pids = [await pidOf(nodes.nth(0)), await pidOf(nodes.nth(1))]
    expect(pids.every(alive)).toBe(true)
  } finally {
    await first.close()
  }
  await expect.poll(() => pids.filter(alive), { timeout: 10_000 }).toEqual([])

  const second = await launch()
  try {
    const { window } = second
    const nodes = window.getByTestId('terminal-node')
    await expect(nodes).toHaveCount(2)
    await expect(nodes.nth(0)).toHaveAttribute('data-state', 'running')
    const pid = await pidOf(nodes.nth(0))
    expect(pids).not.toContain(pid)
    await expectPwdIsRoot(window, nodes.nth(0))
    expect(await screenText(nodes.nth(0))).not.toContain('old-output')
  } finally {
    await second.close()
  }
})

/** electron-builder writes the .app to dist/mac-arm64/ or dist/mac/, depending on the arch. */
function packagedExecutable(): string {
  const distDir = join(repoRoot, 'dist')
  const apps = existsSync(distDir)
    ? readdirSync(distDir)
        .filter((name) => name.startsWith('mac'))
        .map((name) => join(distDir, name, 'worfy.app'))
        .filter((app) => existsSync(app))
    : []
  const [app, ...others] = apps
  if (app === undefined || others.length > 0) throw new Error(`Expected exactly one dist/mac*/worfy.app, found ${apps.length}. Run \`pnpm test:package\`.`)
  return join(app, 'Contents', 'MacOS', 'worfy')
}

test('the Terminal works in the packaged worfy.app (node-pty unpacked from app.asar)', { tag: '@packaged' }, async () => {
  const launched = await launch({ executablePath: packagedExecutable() })
  try {
    const { window } = launched
    expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const node = await newTerminal(window)
    await expectPwdIsRoot(window, node)
    await run(window, node, 'echo "tp=$TERM_PROGRAM"', /^tp=worfy$/m)
    await window.screenshot({ path: test.info().outputPath('packaged-terminal.png') })
    const pid = await pidOf(node)
    await node.getByRole('button', { name: 'Close terminal' }).click()
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
  } finally {
    await launched.close()
  }
})
