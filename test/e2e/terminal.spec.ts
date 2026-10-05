import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchOptions } from './helpers'

// The Terminal Node against the built app: "New terminal" in the Canvas context menu starts the
// user's shell in the Project root on a real pty; the Node's size is the pty's size; the output
// survives the Session view, a reload of the window and the Node scrolling away; closing the Node
// and quitting worfy leave no shell process behind. The shell is /bin/sh (SHELL below) with HOME
// in a temporary folder, so no rc file of the machine running the tests decides what the terminal
// prints, and no shell history of the machine is written.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let root: string
let home: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-term-')))
  dataDir = join(scratch, 'data')
  root = join(scratch, 'alpha')
  home = join(scratch, 'home')
  mkdirSync(root)
  mkdirSync(home)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (options: LaunchOptions = {}) => launchApp({ ...options, env: { WORFY_DATA_DIR: dataDir, SHELL: '/bin/sh', HOME: home, ...options.env } })

/** True while a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The pids of the processes whose parent is `pid`. */
function childrenOf(pid: number): number[] {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

/** The pids of the `sh` processes whose parent is `pid`: the shells worfy's main process runs. */
function shellsOf(pid: number): number[] {
  try {
    return execFileSync('pgrep', ['-x', '-P', String(pid), 'sh'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

function invokeIn(window: Page, channel: string, input: unknown): Promise<{ ok: boolean; error?: string }> {
  return window.evaluate(
    ({ channel, input }) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; error?: string }> } }).worfy.invoke(channel, input),
    { channel, input },
  )
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
  const mainPid = first.app.process().pid ?? 0
  let pids: number[] = []
  const jobs: number[] = []
  let closing: Promise<void> | undefined
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
    pids = [await pidOf(nodes.nth(0)), await pidOf(nodes.nth(1))]
    // The second shell ignores SIGHUP and waits for a job that ignores it too: the pty closing
    // with the app's process does not end it, only worfy's SIGKILL before it quits does.
    await run(window, nodes.nth(1), `trap '' HUP; sleep 30`, /sleep 30/)
    await expect.poll(() => childrenOf(pids[1] ?? 0).length).toBe(1)
    jobs.push(...childrenOf(pids[1] ?? 0))
    expect(pids.every(alive)).toBe(true)

    closing = first.close()
    // worfy quits only after its shells have exited: once its main process is gone, so are they.
    // (Waiting for close() instead would not tell: it resolves only when the app's output pipes
    // close, and a surviving shell keeps them open until its job ends.)
    await expect.poll(() => alive(mainPid), { timeout: 15_000 }).toBe(false)
    expect(pids.filter(alive)).toEqual([])
  } finally {
    for (const pid of [...pids, ...jobs]) if (alive(pid)) process.kill(pid, 'SIGKILL')
    await (closing ?? first.close())
  }

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

test('a Terminal Node removed from the Layout by another route, or its Project removed, ends its shell', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    // Removed through layout.apply, as a tool would: no terminal.close is sent.
    const node = await newTerminal(window)
    const pid = await pidOf(node)
    const [stored] = await terminalNodes(window)
    if (!stored) throw new Error('no terminal node')
    expect(await invokeIn(window, 'layout.apply', { projectId: PROJECT, op: { op: 'remove', id: stored.id } })).toMatchObject({ ok: true })
    await expect(node).toHaveCount(0)
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)

    // The Project removed from the list takes its shell with it.
    const second = await newTerminal(window)
    const secondPid = await pidOf(second)
    expect(await invokeIn(window, 'projects.remove', { id: PROJECT })).toMatchObject({ ok: true })
    await expect.poll(() => alive(secondPid), { timeout: 10_000 }).toBe(false)
  } finally {
    await launched.close()
  }
})

test('a shell that exited stays exited across a reload of the window; Restart starts a new one', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const pid = await pidOf(node)
    const mainPid = launched.app.process().pid ?? 0
    // The shells run as children of main, so a shell started behind the user's back would show here.
    expect(shellsOf(mainPid)).toEqual([pid])
    await run(window, node, 'echo be""fore-exit', /^before-exit$/m)
    await node.getByTestId('terminal-screen').click()
    await window.keyboard.type('exit 3')
    await window.keyboard.press('Enter')
    await expect(node).toHaveAttribute('data-state', 'exited')
    await expect(node.getByText('exit 3', { exact: true })).toBeVisible()
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)

    // The Node mounts again: it shows the exit and the last output, and starts nothing.
    await window.reload()
    const reloaded = window.getByTestId('terminal-node')
    await expect(reloaded).toHaveAttribute('data-state', 'exited')
    await expect(reloaded.getByText('exit 3', { exact: true })).toBeVisible()
    await expect.poll(() => screenText(reloaded)).toMatch(/^before-exit$/m)
    expect(shellsOf(mainPid)).toEqual([])

    // Restart starts a new shell in the Project root.
    await reloaded.getByRole('button', { name: 'Restart' }).click()
    await expect(reloaded).toHaveAttribute('data-state', 'running')
    const restarted = await pidOf(reloaded)
    expect(restarted).not.toBe(pid)
    expect(alive(restarted)).toBe(true)
    await expectPwdIsRoot(window, reloaded)
  } finally {
    await launched.close()
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
