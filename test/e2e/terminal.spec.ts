import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openSecondWindow, repoRoot, type LaunchedApp, type LaunchOptions } from './helpers'
import { childrenOf, chooseGitBash, printJoined, shellsOf, SIZE_EXPRESSION, WINDOWS, windowsProcessName } from './terminal-shell'

// The Terminal Node against the built app: "New terminal" in the Canvas context menu starts the
// user's shell in the Project root on a real pty; the Node's size is the pty's size; the output
// survives the Session view, a reload of the window and the Node scrolling away; closing the Node
// and quitting worfy leave no shell process behind. The shell is /bin/sh (SHELL below) with HOME
// in a temporary folder, so no rc file of the machine running the tests decides what the terminal
// prints, and no shell history of the machine is written. On Windows the shell is PowerShell, the
// default there (Q20), and one test runs Git Bash, chosen in the Project's settings; the commands
// typed are the ones of the shell that runs (terminal-shell.ts).

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

/** Where the Orchestrator Node is moved to keep the top left of the Canvas empty: off the screen. */
const ORCHESTRATOR_AWAY = { x: 2400, y: 1600 }

/**
 * Moves the Orchestrator Node off the screen through layout.apply, as a tool would. main creates
 * it in the top left of every Project's Canvas (it can be moved, not removed), where the terminals
 * of these tests go: a right click on a Node opens no Canvas menu, and a terminal on top of it
 * could not be grown with its resize handle on a small CI screen.
 */
async function moveOrchestratorAway(window: Page): Promise<boolean> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: { id: string; kind: string; x: number; y: number }[] } } }> } }).worfy.invoke(
        'layout.get',
        { projectId: id },
      ),
    PROJECT,
  )
  expect(result.ok).toBe(true)
  const orchestrators = result.value.layout.nodes.filter((n) => n.kind === 'orchestrator')
  for (const node of orchestrators) {
    if (node.x === ORCHESTRATOR_AWAY.x && node.y === ORCHESTRATOR_AWAY.y) continue
    expect(await invokeIn(window, 'layout.apply', { projectId: PROJECT, op: { op: 'move', id: node.id, ...ORCHESTRATOR_AWAY } })).toMatchObject({ ok: true })
  }
  return orchestrators.length > 0
}

/**
 * Right click on the Canvas at `at` (relative to the pane), then "New terminal". The spot must be
 * the empty plane. Nodes sit inside the pane element, so the click alone cannot tell whether it
 * hit one; the check below fails with a clear message instead of a missing menu.
 */
async function newTerminalAt(window: Page, at: { x: number; y: number }): Promise<void> {
  const pane = window.locator('.react-flow__pane')
  // Waits for main to create the Orchestrator Node (it may come after the window has loaded), so it
  // cannot appear under the new terminal later, and moves it on every try.
  await expect
    .poll(
      async () => {
        if (!(await moveOrchestratorAway(window))) return false
        return pane.evaluate((element, point) => {
          const box = element.getBoundingClientRect()
          // The e2e tsconfig has no DOM lib: the page's document is reached through the element.
          const { ownerDocument } = element as unknown as { ownerDocument: { elementFromPoint(x: number, y: number): unknown } }
          return ownerDocument.elementFromPoint(box.x + point.x, box.y + point.y) === element
        }, at)
      },
      { message: `no Orchestrator Node moved away, or the Canvas is not empty at ${at.x},${at.y}` },
    )
    .toBe(true)
  await pane.click({ button: 'right', position: at })
  const menu = window.getByRole('menu', { name: 'Canvas' })
  await menu.getByRole('menuitem', { name: 'New terminal' }).click()
  await expect(menu).toBeHidden()
}

/** Right click on an empty spot of the Canvas, then "New terminal". */
async function newTerminal(window: Page): Promise<Locator> {
  await newTerminalAt(window, { x: 80, y: 60 })
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
 * appears only in the output of pwd. The prompt of PowerShell does show it: there the output is
 * marked, and the mark is not in the typed line.
 */
async function expectPwdIsRoot(window: Page, node: Locator): Promise<void> {
  await node.getByTestId('terminal-screen').click()
  await window.keyboard.type(WINDOWS ? 'echo "cwd=$($PWD.Path)"' : 'pwd')
  await window.keyboard.press('Enter')
  await expect.poll(async () => (await screenText(node)).replace(/\n/g, ''), { timeout: 10_000 }).toContain(WINDOWS ? `cwd=${root}` : root)
}

/** Prints TERM_PROGRAM in the shell's own syntax. */
const PRINT_TERM_PROGRAM = WINDOWS ? 'echo "tp=$env:TERM_PROGRAM"' : 'echo "tp=$TERM_PROGRAM"'

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
  await run(window, node, `echo "${tag}-size=${SIZE_EXPRESSION}"`, new RegExp(`${tag}-size=\\d+x\\d+`))
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
    await run(window, node, PRINT_TERM_PROGRAM, /^tp=worfy$/m)

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
    await run(window, node, printJoined('mark', 'er-one'), /^marker-one$/m)
    const view = window.getByRole('group', { name: 'View', exact: true })
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
    await run(window, reloaded, printJoined('mark', 'er-two'), /^marker-two$/m)

    // Closing the Node removes it from the Layout and ends the shell.
    await reloaded.getByRole('button', { name: 'Close terminal' }).click()
    await expect(reloaded).toHaveCount(0)
    expect(await terminalNodes(window)).toEqual([])
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
  } finally {
    await launched.close()
  }
})

/**
 * What xterm.js has selected: the text it puts into a copy event. The event is dispatched on the
 * terminal with its own DataTransfer, so the system clipboard is not touched.
 */
async function selectionOf(node: Locator): Promise<string> {
  return node.locator('.xterm').evaluate((element) => {
    // The e2e tsconfig has no DOM lib: the page's constructors are reached through globalThis.
    const page = globalThis as unknown as {
      DataTransfer: new () => { getData(type: string): string }
      ClipboardEvent: new (type: string, init: { clipboardData: unknown; bubbles: boolean; cancelable: boolean }) => unknown
    }
    const clipboardData = new page.DataTransfer()
    ;(element as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(new page.ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }))
    return clipboardData.getData('text/plain')
  })
}

// The Canvas draws its Nodes inside a CSS transform: scale(zoom). xterm.js measures the mouse
// against the scaled box but divides by the unscaled cell size, so without a correction a drag
// selects other characters than the ones under the pointer.
for (const zoom of [0.5, 1.5]) {
  test(`at Canvas zoom ${zoom * 100}% a mouse drag from one character to another selects exactly those characters`, async () => {
    writeFileSync(
      join(dataDir, PROJECT, 'layout.json'),
      JSON.stringify({ nodes: [{ id: 'term', kind: 'terminal', x: 20, y: 20, w: 560, h: 340, data: {} }], viewport: { x: 0, y: 0, zoom } }),
    )
    const launched = await launch()
    try {
      const { window } = launched
      const node = window.getByTestId('terminal-node')
      await expect(node).toHaveAttribute('data-state', 'running')
      await expect(window.locator('.react-flow__viewport')).toHaveAttribute('style', new RegExp(`scale\\(${zoom}\\)`))

      const { cols } = await printSize(window, node, 'z')
      const line = 'sel-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      // Split by quotes, so only the output row holds the line in one piece.
      await run(window, node, printJoined('sel-', line.slice(4)), new RegExp(`^${line}`, 'm'))
      const screen = await node.locator('.xterm-screen').boundingBox()
      const row = await node.locator('.xterm-rows > div').filter({ hasText: new RegExp(`^${line}`) }).boundingBox()
      if (!screen || !row) throw new Error('no terminal screen or output row')
      // The row starts at column 0; a cell is the scaled screen width over the columns.
      const cell = screen.width / cols
      const at = (char: string, part: number) => ({ x: screen.x + (line.indexOf(char) + part) * cell, y: row.y + row.height / 2 })
      // From the left part of A to the right part of J: xterm.js selects A through J.
      const from = at('A', 0.25)
      const to = at('J', 0.75)
      await window.mouse.move(from.x, from.y)
      await window.mouse.down()
      await window.mouse.move(to.x, to.y, { steps: 8 })
      await window.mouse.up()
      expect(await selectionOf(node)).toBe('ABCDEFGHIJ')
      await window.screenshot({ path: test.info().outputPath(`terminal-selection-${zoom * 100}.png`) })
    } finally {
      await launched.close()
    }
  })
}

test('at Canvas zoom 50% a drag that began in one terminal and goes over another selects in the first', async () => {
  // B comes first in the Layout, so it mounts first; it stands to the right of A and 60 px lower on
  // the screen, so the moves over B are corrected for the wrong row if B takes them.
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'b', kind: 'terminal', x: 620, y: 140, w: 560, h: 340, data: {} },
        { id: 'a', kind: 'terminal', x: 20, y: 20, w: 560, h: 340, data: {} },
      ],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    }),
  )
  const launched = await launch()
  try {
    const { window } = launched
    const a = window.locator('.react-flow__node[data-id="a"]').getByTestId('terminal-node')
    const b = window.locator('.react-flow__node[data-id="b"]').getByTestId('terminal-node')
    await expect(a).toHaveAttribute('data-state', 'running')
    await expect(b).toHaveAttribute('data-state', 'running')

    const { cols } = await printSize(window, a, 'z')
    const rows = WINDOWS ? '1..15 | % { "L$_-row" }' : 'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do echo "L$i-row"; done'
    await run(window, a, rows, /^L15-row$/m)
    const screen = await a.locator('.xterm-screen').boundingBox()
    const row = await a.locator('.xterm-rows > div').filter({ hasText: /^L12-row/ }).boundingBox()
    const overB = await b.getByTestId('terminal-screen').boundingBox()
    if (!screen || !row || !overB) throw new Error('no terminal screen or output row')
    const y = row.y + row.height / 2
    // The end point is over B's screen, level with A's row.
    expect(y).toBeGreaterThan(overB.y)
    expect(y).toBeLessThan(overB.y + overB.height)
    await window.mouse.move(screen.x + 0.25 * (screen.width / cols), y)
    await window.mouse.down()
    await window.mouse.move(overB.x + 40, y, { steps: 8 })
    await window.mouse.up()
    expect(await selectionOf(a)).toBe('L12-row')
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
    await run(window, node, printJoined('old', '-output'), /^old-output$/m)
    // A second terminal, with a job running in it.
    await newTerminalAt(window, { x: 700, y: 60 })
    const nodes = window.getByTestId('terminal-node')
    await expect(nodes).toHaveCount(2)
    await expect(nodes.nth(1)).toHaveAttribute('data-state', 'running')
    pids = [await pidOf(nodes.nth(0)), await pidOf(nodes.nth(1))]
    // The second shell ignores SIGHUP and waits for a job that ignores it too: the pty closing
    // with the app's process does not end it, only worfy's SIGKILL before it quits does. Windows has
    // no SIGHUP; the job there is a program (Start-Sleep would run inside PowerShell, no child).
    if (WINDOWS) await run(window, nodes.nth(1), 'ping -n 31 127.0.0.1 > $null', /ping -n 31/)
    else await run(window, nodes.nth(1), `trap '' HUP; sleep 30`, /sleep 30/)
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
    await run(window, node, printJoined('be', 'fore-exit'), /^before-exit$/m)
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

/** The terminal colors of design F (docs/design/F-SPEC.md, color table): background, text. */
const TERMINAL_COLORS = { light: ['rgb(29, 29, 31)', 'rgb(229, 229, 234)'], dark: ['rgb(11, 10, 9)', 'rgb(236, 232, 225)'] } as const

/** Screenshots of a window in the light and the dark appearance, the terminal's colors checked; then the system's appearance again. */
async function snapshots(window: Page, node: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const colors = () =>
      node.locator('.xterm-screen').evaluate((screen) => {
        const { getComputedStyle } = globalThis as unknown as { getComputedStyle(e: unknown): { backgroundColor: string; color: string } }
        const { parentElement, querySelector } = screen as unknown as { parentElement: unknown; querySelector(s: string): unknown }
        return [getComputedStyle(parentElement).backgroundColor, getComputedStyle(querySelector.call(screen, '.xterm-rows')).color]
      })
    await expect.poll(colors).toEqual([...TERMINAL_COLORS[scheme]])
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** The number of rows a terminal view draws: the size of that view. */
async function rowsOf(node: Locator): Promise<number> {
  return node.locator('.xterm-rows > div').count()
}

/** Size of the output the measurement prints, as in test/contract/terminal.test.ts. */
const MEASURED_BYTES = 10_000_000

/**
 * Prints 10 MB into the terminal from `window` and answers the time until every view in `views`
 * shows the marker printed after it.
 */
async function timeToMarker(window: Page, node: Locator, views: Locator[], tag: string): Promise<number> {
  const marker = new RegExp(`^${tag}-DONE$`, 'm')
  await node.getByTestId('terminal-screen').click()
  await window.keyboard.type(WINDOWS ? `'a' * ${MEASURED_BYTES}; ${printJoined(`${tag}-`, 'DONE')}` : `head -c ${MEASURED_BYTES} /dev/zero | tr '\\0' a; echo; echo "${tag}-""DONE"`)
  const started = Date.now()
  await window.keyboard.press('Enter')
  const seen = await Promise.all(
    views.map(async (view) => {
      await expect.poll(() => screenText(view), { timeout: 60_000, intervals: [50] }).toMatch(marker)
      return Date.now()
    }),
  )
  return Math.max(...seen) - started
}

/** The second window, whose size the test sets: the newest window of the app. */
async function setNewestWindowSize(launched: LaunchedApp, width: number, height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const newest = BrowserWindow.getAllWindows().reduce((a, b) => (a.id > b.id ? a : b))
      newest.setSize(size.width, size.height)
    },
    { width, height },
  )
}

test('one Terminal on two windows: both show the output, the second gets the replay, the pty has the size of the window that typed or clicked last; Restart and closing a window', async () => {
  test.setTimeout(240_000)
  const enforce = process.env.WORFY_PERF === '1'
  const launched = await launch()
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const pid = await pidOf(node)

    // The output with one window, measured before the second window opens.
    const oneWindowMs = await timeToMarker(window, node, [node], 'one')
    await run(window, node, `clear; ${printJoined('be', 'fore-second')}`, /^before-second$/m)

    // The second window, of another size, opened after the output: it attaches and shows the replay.
    const second = await openSecondWindow(launched)
    await setNewestWindowSize(launched, 980, 700)
    const onCanvas2 = second.locator('.react-flow__node').getByTestId('terminal-node')
    await expect(onCanvas2).toHaveAttribute('data-state', 'running')
    expect(await pidOf(onCanvas2)).toBe(pid)
    await expect.poll(() => screenText(onCanvas2)).toMatch(/^before-second$/m)

    // Output typed in window 1 shows in window 2.
    await run(window, node, printJoined('from', '-one'), /^from-one$/m)
    await expect.poll(() => screenText(onCanvas2)).toMatch(/^from-one$/m)

    // Window 2 shows the terminal in focus mode: its view fills the window, so it has another size.
    await second.locator('.react-flow__node .w-terminal__header').click()
    await second.keyboard.press('ControlOrMeta+Enter')
    const tile = second.getByTestId('focus-mode').getByTestId('focus-tile').getByTestId('terminal-node')
    await expect(tile).toHaveAttribute('data-state', 'running')
    await expect.poll(() => screenText(tile)).toMatch(/^from-one$/m)

    // The size follows the window that typed (and clicked) last.
    const sizeOne = await printSize(window, node, 'w1')
    expect(sizeOne.rows).toBe(await rowsOf(node))
    const sizeTwo = await printSize(second, tile, 'w2')
    expect(sizeTwo.rows).toBe(await rowsOf(tile))
    expect(sizeTwo.cols).toBeGreaterThan(sizeOne.cols)
    expect(await printSize(window, node, 'w1again')).toEqual(sizeOne)
    // A click alone takes the size: window 2 types a command that reads the size two seconds later,
    // and window 1 is clicked meanwhile, without typing.
    expect(await printSize(second, tile, 'w2again')).toEqual(sizeTwo)
    await tile.getByTestId('terminal-screen').click()
    await second.keyboard.type(`${WINDOWS ? 'Start-Sleep 2' : 'sleep 2'}; echo "late-size=${SIZE_EXPRESSION}"`)
    await second.keyboard.press('Enter')
    await node.getByTestId('terminal-screen').click()
    await expect.poll(() => screenText(tile), { timeout: 10_000 }).toMatch(/^late-size=\d+x\d+$/m)
    const late = /^late-size=(\d+)x(\d+)$/m.exec(await screenText(tile)) ?? []
    expect({ cols: Number(late[1]), rows: Number(late[2]) }).toEqual(sizeOne)
    // Window 2 sees the output laid out for window 1 until it types or clicks: Q14, no hint.
    await snapshots(window, node, 'two-windows-1')
    await snapshots(second, tile, 'two-windows-2')

    // The output with two windows: the time until both show the marker.
    const twoWindowsMs = await timeToMarker(window, node, [node, tile], 'two')
    console.log(`terminal 10 MB in the renderer: one window ${oneWindowMs} ms, two windows ${twoWindowsMs} ms`)
    test.info().annotations.push({ type: 'perf', description: `terminal10MB oneWindow=${oneWindowMs}ms twoWindows=${twoWindowsMs}ms` })
    if (enforce) expect(twoWindowsMs).toBeLessThanOrEqual(2 * oneWindowMs)

    // The shell exits in window 1; Restart there starts a new shell, and window 2 shows it running.
    await node.getByTestId('terminal-screen').click()
    await window.keyboard.type('exit 3')
    await window.keyboard.press('Enter')
    await expect(node).toHaveAttribute('data-state', 'exited')
    await expect(tile).toHaveAttribute('data-state', 'exited')
    await node.getByRole('button', { name: 'Restart' }).click()
    await expect(node).toHaveAttribute('data-state', 'running')
    const restarted = await pidOf(node)
    expect(restarted).not.toBe(pid)
    await expect(tile).toHaveAttribute('data-state', 'running')
    expect(await pidOf(tile)).toBe(restarted)
    await expect(onCanvas2).toHaveAttribute('data-state', 'running')
    await run(second, tile, printJoined('after', '-restart'), /^after-restart$/m)
    await expect.poll(() => screenText(node)).toMatch(/^after-restart$/m)

    // Window 1 closes: the shell lives on in window 2.
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().reduce((a, b) => (a.id < b.id ? a : b)).close())
    await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(alive(restarted)).toBe(true)
    expect(await pidOf(tile)).toBe(restarted)
    await run(second, tile, printJoined('still', '-here'), /^still-here$/m)
  } finally {
    await launched.close()
  }
})

test('on Windows, Git Bash chosen in the settings starts in the Project root; closing the Node ends it', async () => {
  test.skip(!WINDOWS, 'the shell setting is read on Windows only')
  chooseGitBash(join(dataDir, PROJECT))
  const launched = await launch()
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const pid = await pidOf(node)
    const mainPid = launched.app.process().pid ?? 0
    expect(shellsOf(mainPid)).toEqual([pid])
    expect(windowsProcessName(pid)).toBe('bash.exe')
    // PowerShell would print an empty tp= here: $TERM_PROGRAM is no variable of its own.
    await run(window, node, 'unset HISTFILE; echo "tp=$TERM_PROGRAM"', /^tp=worfy$/m)
    // A long path wraps over several rows: they are joined, as in expectPwdIsRoot.
    await run(window, node, 'echo "cwd=$(cygpath -w "$PWD")"', /^cwd=/m)
    await expect.poll(async () => (await screenText(node)).replace(/\n/g, '')).toContain(`cwd=${root}`)
    await node.getByRole('button', { name: 'Close terminal' }).click()
    await expect(node).toHaveCount(0)
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
    expect(shellsOf(mainPid)).toEqual([])
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
    await run(window, node, PRINT_TERM_PROGRAM, /^tp=worfy$/m)
    await window.screenshot({ path: test.info().outputPath('packaged-terminal.png') })
    const pid = await pidOf(node)
    await node.getByRole('button', { name: 'Close terminal' }).click()
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
  } finally {
    await launched.close()
  }
})
