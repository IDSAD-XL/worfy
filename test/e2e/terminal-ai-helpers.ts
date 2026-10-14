import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import type { FakeAnswer, FakeLogEntry } from '../../src/main/terminal-ai/fake-backend'

// What the e2e tests of Terminal AI share: a Terminal Node on a real zsh that reads nothing of the
// machine running the tests, what its screen shows, and the fake assist process.
//
// SHELL is the zsh of the machine and HOME a temporary folder with its own .zshrc, so no startup
// file and no history of the machine is read, and none is written. The model is the fake of
// src/main/terminal-ai/fake-backend.ts (launchApp sets WORFY_AGENT=fake): its answers come from a
// file the test writes, and every request it got is one line of a log the test reads. Claude Code
// is never started. A command a test types still carries a mark of its own.

/** The zsh of the machine: /bin/zsh on macOS. */
export const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
/** The Project of the sandbox. */
export const TERMINAL_AI_PROJECT = 'alpha-0000000a'
/** The prompt the sandbox's .zshrc sets, as the screen shows it. */
export const TERMINAL_AI_PROMPT = 'e2e% '

/** The folders and files of one test, and the environment that makes the app use them. */
export interface TerminalAiSandbox {
  /** The temporary folder everything below lives in. */
  scratch: string
  /** WORFY_DATA_DIR, with one Project (TERMINAL_AI_PROJECT) whose folder is `root`. */
  dataDir: string
  /** The folder of the Project: where a new Terminal starts. */
  root: string
  /** HOME of the app and of its shells: a .zshrc with a short prompt and a kept history, nothing else. */
  home: string
  /** Pass as `launchApp({ env })`. */
  env: Record<string, string>
  /** Writes the answers of the fake assist process; it reads the file anew on every request. */
  answers: (answers: FakeAnswer[]) => void
  /** The requests that reached the fake assist process, in the order they ended. */
  requests: () => FakeLogEntry[]
  /** Removes the sandbox; call after the app is closed. */
  remove: () => Promise<void>
}

/** A fresh sandbox; the fake has no answers until `answers()` is called. */
export function terminalAiSandbox(): TerminalAiSandbox {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-tai-')))
  const dataDir = join(scratch, 'data')
  const root = join(scratch, 'alpha')
  const home = join(scratch, 'home')
  const answersFile = join(scratch, 'answers.json')
  const logFile = join(scratch, 'requests.jsonl')
  mkdirSync(root)
  mkdirSync(home)
  mkdirSync(join(dataDir, TERMINAL_AI_PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: TERMINAL_AI_PROJECT, name: 'alpha', path: root }], activeId: TERMINAL_AI_PROJECT }))
  // A short prompt and a history that is kept: what a user's .zshrc usually sets.
  writeFileSync(join(home, '.zshrc'), `PS1='${TERMINAL_AI_PROMPT.replace('%', '%#')}'\nHISTSIZE=1000\nSAVEHIST=1000\n`)
  writeFileSync(answersFile, '[]')
  return {
    scratch,
    dataDir,
    root,
    home,
    env: {
      WORFY_DATA_DIR: dataDir,
      SHELL: ZSH,
      HOME: home,
      // Ubuntu's /etc/zsh/zshrc runs compinit unless this is set.
      skip_global_compinit: '1',
      WORFY_TERMINAL_AI_ANSWERS: answersFile,
      WORFY_TERMINAL_AI_LOG: logFile,
    },
    answers: (answers) => writeFileSync(answersFile, JSON.stringify(answers)),
    requests: () =>
      (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as FakeLogEntry),
    remove: () => rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  }
}

function invokeIn<T>(window: Page, channel: string, input: unknown): Promise<{ ok: boolean; value: T }> {
  return window.evaluate(
    ({ channel, input }) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: T }> } }).worfy.invoke(channel, input),
    { channel, input },
  ) as Promise<{ ok: boolean; value: T }>
}

/** Where the Orchestrator Node is moved to keep the top left of the Canvas empty: off the screen. */
const ORCHESTRATOR_AWAY = { x: 2400, y: 1600 }

/** Moves the Orchestrator Node off the screen, as test/e2e/terminal.spec.ts does: the terminal goes where main puts it. */
async function moveOrchestratorAway(window: Page): Promise<boolean> {
  const result = await invokeIn<{ layout: { nodes: { id: string; kind: string; x: number; y: number }[] } }>(window, 'layout.get', { projectId: TERMINAL_AI_PROJECT })
  expect(result.ok).toBe(true)
  const orchestrators = result.value.layout.nodes.filter((node) => node.kind === 'orchestrator')
  for (const node of orchestrators) {
    if (node.x === ORCHESTRATOR_AWAY.x && node.y === ORCHESTRATOR_AWAY.y) continue
    expect(await invokeIn(window, 'layout.apply', { projectId: TERMINAL_AI_PROJECT, op: { op: 'move', id: node.id, ...ORCHESTRATOR_AWAY } })).toMatchObject({ ok: true })
  }
  return orchestrators.length > 0
}

/**
 * A new Terminal Node of the sandbox's Project (right click on an empty spot of the Canvas, then
 * "New terminal"), focused, with the first prompt of its zsh on the screen.
 */
export async function openTerminal(window: Page): Promise<Locator> {
  const at = { x: 80, y: 60 }
  const pane = window.locator('.react-flow__pane')
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
      { message: 'no Orchestrator Node moved away, or the Canvas is not empty where the terminal goes' },
    )
    .toBe(true)
  await pane.click({ button: 'right', position: at })
  const menu = window.getByRole('menu', { name: 'Canvas' })
  await menu.getByRole('menuitem', { name: 'New terminal' }).click()
  await expect(menu).toBeHidden()
  const node = window.getByTestId('terminal-node')
  await expect(node).toHaveCount(1)
  await expect(node).toHaveAttribute('data-state', 'running')
  await node.getByTestId('terminal-screen').click()
  await expect.poll(() => screenText(node), { timeout: 15_000 }).toContain(TERMINAL_AI_PROMPT)
  return node
}

/** What the terminal shows; xterm.js draws spaces as no-break spaces. */
export async function screenText(node: Locator): Promise<string> {
  return (await node.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')
}

/** The line being edited, with its prompt: the last line of the screen that starts with the prompt. Grey text is part of it. */
export async function editedLine(node: Locator): Promise<string> {
  const lines = (await screenText(node)).split('\n').filter((line) => line.startsWith(TERMINAL_AI_PROMPT))
  return (lines.at(-1) ?? '').replace(/\s+$/, '')
}

export interface GreyText {
  text: string
  /** The colour the grey cells are painted with; empty when there are none. */
  color: string
}

/**
 * The grey text on the screen, as xterm.js drew it: the cells with the bright black of the palette
 * (colour 8, the class xterm-fg-8 of its DOM renderer), and the colour they are painted with. The
 * colour is read from a grey cell the cursor is not on, when there is one.
 */
export async function greyText(node: Locator): Promise<GreyText> {
  return node.locator('.xterm-rows').evaluate((rows) => {
    const view = (rows as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string } } } }).ownerDocument.defaultView
    const cells = [
      ...(rows as unknown as { querySelectorAll(selector: string): Iterable<{ textContent: string | null; classList: { contains(name: string): boolean } }> }).querySelectorAll('.xterm-fg-8'),
    ]
    // Not the cell under the cursor: in a focused window xterm.js blinks the block cursor, and for
    // half of every second that cell is painted with the cursor's colour, which is the text's own.
    const first = cells.find((cell) => !cell.classList.contains('xterm-cursor')) ?? cells[0]
    return { text: cells.map((cell) => cell.textContent ?? '').join('').replace(/\u00a0/g, ' '), color: first === undefined ? '' : view.getComputedStyle(first).color }
  })
}

/** The colour of the text the user typed: the terminal's own foreground. */
export function typedColor(node: Locator): Promise<string> {
  return node.locator('.xterm-rows').evaluate((rows) => {
    const view = (rows as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string } } } }).ownerDocument.defaultView
    return view.getComputedStyle(rows).color
  })
}
