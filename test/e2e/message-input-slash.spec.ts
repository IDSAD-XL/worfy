import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The input field's slash menu and attachments (ticket 20) against the built app, on the fake agent
// with test/fixtures/agent-scripts/message-input.jsonl: its head line gives the commands
// supportedCommands() answers, as Claude Code lists the user's skills. WORFY_AGENT_LOG makes the
// fake agent write down each user message whole, image blocks included. The file dialog behind
// "+" is replaced in main (dialog.showOpenDialog) so it answers without a window.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 3)])

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string } }
type Call = { kind: string; text?: string; content?: string | Block[] }

let scratch: string
let dataDir: string
let claudeHome: string
let project: string
let outside: string
let log: string

/** Every file under `dir` with its size and mtime, .git aside. */
const snapshot = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((path) => path !== '.git' && !path.startsWith(`.git${sep}`))
    .sort()
    .map((path) => `${path}:${statSync(join(dir, path)).size}:${statSync(join(dir, path)).mtimeMs}`)

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-message-input-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  project = join(scratch, 'alpha')
  outside = join(scratch, 'downloads')
  mkdirSync(claudeHome)
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  mkdirSync(project)
  mkdirSync(outside)
  execFileSync('git', ['-C', project, 'init', '-q'])
  writeFileSync(join(project, 'README.md'), 'alpha\n')
  execFileSync('git', ['-C', project, 'add', '.'])
  execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: project }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const messages = (): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'message')
    : []

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

test('the slash menu lists the skills, Tab puts one in; a pasted image, a dropped file and a picked file go with the message', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'message-input', WORFY_AGENT_LOG: log }
  const projectBefore = snapshot(project)
  const homeBefore = snapshot(claudeHome)
  const launched = await launchApp({ env })
  try {
    const { app, window } = launched
    const view = await openSession(window)
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })

    // `/sh` shows /ship-ticket; Tab puts it into the field.
    await field.fill('/sh')
    const menu = view.getByTestId('slash-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByTestId('slash-item')).toHaveText([/\/ship-ticket/])
    await expect(menu.getByTestId('slash-item').first()).toContainText('Carry one ticket of any registered project')
    await field.fill('/')
    await expect(menu.getByTestId('slash-item')).toHaveCount(4)
    await field.fill('/sh')
    await expect(menu.getByTestId('slash-item')).toHaveCount(1)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`slash-menu-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await field.press('Tab')
    await expect(field).toHaveValue('/ship-ticket ')
    await expect(menu).toHaveCount(0)
    // Escape closes the menu and does not touch the field.
    await field.fill('/ep')
    await expect(menu.getByTestId('slash-item')).toHaveText([/\/epic-wave/])
    await field.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(field).toHaveValue('/ep')

    // A pasted image becomes a chip and goes as an image block.
    await field.fill('what is on this screenshot?')
    await window.evaluate(`(() => {
      const field = document.querySelector('.w-shell__view[data-view="session"] textarea[aria-label="Message Orchestrator"]')
      const bytes = Uint8Array.from(atob(${JSON.stringify(PNG.toString('base64'))}), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })()`)
    await expect(view.getByTestId('attachment-chip')).toHaveText([/image\.png/])
    await field.press('Enter')
    await expect(view.getByTestId('attachment-chip')).toHaveCount(0)
    await expect.poll(() => messages().length).toBe(1)
    expect(messages()[0]?.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
      { type: 'text', text: 'what is on this screenshot?\n\nAttached images: image.png' },
    ])
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    // The sent message shows the image, not the line with its name: here a chip, as these bytes are no picture the window can draw.
    await expect(view.getByTestId('transcript-prompt').last().getByTestId('message-image-chip')).toHaveText(/image\.png/)
    await expect(view.getByTestId('transcript-prompt').last()).not.toContainText('Attached images')

    // A file from outside the Project, picked with "+", is copied into the Project's data folder and goes by its path.
    writeFileSync(join(outside, 'notes.txt'), 'meeting notes')
    writeFileSync(join(outside, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024, 1)]))
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
    }, [join(outside, 'notes.txt'), join(outside, 'huge.png')])
    await view.getByTestId('input-attach').click()
    await expect(view.getByTestId('attachment-chip')).toHaveText([/notes\.txt/])
    // The file over the limit is refused with a message; the message can still be sent.
    await expect(view.getByTestId('input-error')).toHaveText('huge.png is too large: images go up to 3.75 MB')

    // A dropped file joins it.
    // Page code as a string: the e2e tsconfig has no DOM types.
    await window.evaluate(`(() => {
      const box = document.querySelector('.w-shell__view[data-view="session"] [data-testid="message-input-box"]')
      const data = new DataTransfer()
      data.items.add(new File(['dropped log'], 'build.log', { type: 'text/plain' }))
      box.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
      box.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    })()`)
    await expect(view.getByTestId('attachment-chip')).toHaveText([/notes\.txt/, /build\.log/])
    await window.screenshot({ path: test.info().outputPath('attachments.png') })

    await field.fill('read these')
    await field.press('Enter')
    await expect.poll(() => messages().length).toBe(2)
    const sent = messages()[1]?.content
    expect(typeof sent).toBe('string')
    const match = /^read these\n\nAttached files: (\S+), (\S+)$/.exec(String(sent))
    expect(match).not.toBeNull()
    // The paths are the platform's own: `\` between folders on Windows, `/` on macOS.
    const attachments = join(dataDir, PROJECT, 'attachments')
    for (const [path, body] of [
      [match?.[1] ?? '', 'meeting notes'],
      [match?.[2] ?? '', 'dropped log'],
    ] as const) {
      expect(path.startsWith(`${attachments}${sep}`)).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(body)
    }
    expect(match?.[1]?.endsWith(`${sep}notes.txt`)).toBe(true)
    expect(match?.[2]?.endsWith(`${sep}build.log`)).toBe(true)
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(2)

    // worfy wrote nothing into the Project, nor into the Claude home.
    expect(execFileSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    expect(snapshot(project)).toEqual(projectBefore)
    expect(snapshot(claudeHome)).toEqual(homeBefore)
  } finally {
    await launched.close()
  }
})
