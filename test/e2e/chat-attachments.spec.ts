import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// Attachments in the Orchestrator's chat (worfy-ui ticket 28) against the built app, on the fake
// agent with test/fixtures/agent-scripts/message-input.jsonl. A png and a pdf dropped on the
// transcript (not the input field) become chips; the sent message shows a thumbnail, loaded from
// main's copy by worfy-image:// through the window's CSP, and a «PDF» chip, without paths; a click
// opens the image at full size. After a restart the history, read from the transcript Claude Code
// would have written for that message (WORFY_AGENT_LOG records it whole), shows the same.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

/** A real PNG, `width` × `height`, a gradient: one the window can decode and draw. */
function png(width: number, height: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const byte of bytes) c = (table[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.concat(
    Array.from({ length: height }, (_, y) => Buffer.from([0, ...Array.from({ length: width }, (_, x) => [Math.round((x / width) * 255), Math.round((y / height) * 255), 160]).flat()])),
  )
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const IMAGE = png(320, 200)
const PDF = Buffer.from('%PDF-1.4\n% a pdf the test only carries\n')

type Call = { kind: string; text?: string; content?: unknown }

let scratch: string
let dataDir: string
let claudeHome: string
let project: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-chat-attachments-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  project = join(scratch, 'alpha')
  mkdirSync(claudeHome)
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  mkdirSync(project)
  execFileSync('git', ['-C', project, 'init', '-q'])
  writeFileSync(join(project, 'README.md'), 'alpha\n')
  execFileSync('git', ['-C', project, 'add', '.'])
  execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'maintenance.auto=false', 'commit', '-qm', 'init'])
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

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** The session id the Orchestrator's Node keeps, to resume after a restart. */
async function orchestratorSessionId(window: Page): Promise<string> {
  const result = (await window.evaluate((projectId) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke('layout.get', { projectId }), PROJECT)) as {
    value?: { layout: { nodes: { kind: string; data: { sessionId?: string } }[] } }
  }
  return result.value?.layout.nodes.find((node) => node.kind === 'orchestrator')?.data.sessionId ?? ''
}

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

/** Drags the png and the pdf over the transcript and, when `drop`, drops them there. Page code as a string: the e2e tsconfig has no DOM types. */
const dragOnTranscript = (window: Page, drop: boolean) =>
  window.evaluate(`(() => {
    const target = document.querySelector('.w-shell__view[data-view="session"] [data-testid="transcript"]')
    const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes(${JSON.stringify(IMAGE.toString('base64'))})], 'diagram.png', { type: 'image/png' }))
    data.items.add(new File([bytes(${JSON.stringify(PDF.toString('base64'))})], 'Quarterly report.pdf', { type: 'application/pdf' }))
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
    if (${drop}) target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })()`)

/** The decoded width of an <img>: 0 when the window could not load or draw it. */
const naturalWidth = (image: Locator) => image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth)

/** The sent message: a thumbnail and a «PDF» chip (`file`: its text), no paths and no attachment lines. */
async function expectPreviews(view: Locator, file: string): Promise<Locator> {
  const row = view.getByTestId('transcript-prompt').filter({ has: view.page().getByTestId('message-attachments') })
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('message-file')).toHaveText(file)
  const thumbnail = row.getByTestId('message-image').locator('img')
  await expect(thumbnail).toHaveAttribute('alt', 'diagram.png')
  await expect.poll(() => naturalWidth(thumbnail)).toBe(320)
  const box = await thumbnail.boundingBox()
  // At most 160 px on the longer side, proportions kept.
  expect(Math.round(box?.width ?? 0)).toBe(160)
  expect(Math.round(box?.height ?? 0)).toBe(100)
  const text = (await row.textContent()) ?? ''
  expect(text).toContain('see the attached')
  expect(text).not.toContain(scratch)
  expect(text).not.toMatch(/Attached (files|images)/)
  return row
}

test('a png and a pdf dropped on the Orchestrator transcript: chips, then a thumbnail and a PDF chip; the same after a restart', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'message-input', WORFY_AGENT_LOG: log }
  const ref = createHash('sha256').update(IMAGE).digest('hex')
  const copy = join(dataDir, 'attachments', 'images', `${ref}.png`)
  let sessionId: string
  const first = await launchApp({ env })
  try {
    const { window } = first
    // launchApp returns once the window is on screen, not once the Canvas and the sidebar have
    // rendered: under load (worfy-polish 47, the PC's gate full) the pane was not there yet, and
    // querySelector below gave null.
    await expect(window.locator('.react-flow__pane')).toBeVisible()
    await expect(window.locator('.w-sidebar-section').first()).toBeVisible()
    // Outside the chat — on the Canvas, on the sidebar — nothing takes a file, and the window does
    // not open it either: the drag and the drop of it are refused (dispatchEvent answers false).
    const refused = await window.evaluate(`(() => ['.react-flow__pane', '.w-sidebar-section'].map((selector) => {
      const target = document.querySelector(selector)
      const data = new DataTransfer()
      data.items.add(new File(['x'], 'outside.png', { type: 'image/png' }))
      const over = target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
      // 'none': nobody took the file (a target that takes it sets 'copy').
      const effect = data.dropEffect
      const drop = target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
      return { selector, over, effect, drop }
    }))()`)
    expect(refused).toEqual([
      { selector: '.react-flow__pane', over: false, effect: 'none', drop: false },
      { selector: '.w-sidebar-section', over: false, effect: 'none', drop: false },
    ])
    const view = await openSession(window)
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })

    // While the files are over the transcript the chat shows where they go.
    await dragOnTranscript(window, false)
    await expect(view.getByTestId('chat-drop-zone')).toHaveText('Drop files to attach')
    await window.screenshot({ path: test.info().outputPath('drop-target.png') })
    await dragOnTranscript(window, true)
    await expect(view.getByTestId('chat-drop-zone')).toHaveCount(0)
    await expect(view.getByTestId('attachment-chip')).toHaveText([/diagram\.png/, /Quarterly report\.pdf/])

    await field.fill('see the attached')
    await field.press('Enter')
    await expect.poll(() => messages().length).toBe(1)
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    // The size is known while the file is at hand.
    const row = await expectPreviews(view, `PDFQuarterly report.pdf${PDF.length} B`)
    // main kept one copy of the image, named by the hash of its bytes.
    expect(readFileSync(copy)).toEqual(IMAGE)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await row.screenshot({ path: test.info().outputPath(`previews-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // A click opens the image at full size; Escape closes it.
    await row.getByTestId('message-image').click()
    const overlay = window.getByTestId('image-overlay')
    await expect(overlay).toBeVisible()
    await expect.poll(() => naturalWidth(overlay.getByTestId('image-overlay-image'))).toBe(320)
    await window.screenshot({ path: test.info().outputPath('full-size.png') })
    await window.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
    // Escape went to the picture, not to the Session: no turn was interrupted.
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    sessionId = await orchestratorSessionId(window)
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
  } finally {
    await first.close()
  }

  // What Claude Code writes into its transcript for that message: the user message whole, as the fake agent got it.
  const sent = messages()[0]
  expect(Array.isArray(sent?.content)).toBe(true)
  const transcripts = join(claudeHome, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(transcripts, { recursive: true })
  const base = { sessionId, cwd: project, isSidechain: false, timestamp: '2026-10-25T10:00:00.000Z' }
  writeFileSync(
    join(transcripts, `${sessionId}.jsonl`),
    [
      JSON.stringify({ ...base, type: 'user', uuid: 'u1', message: { role: 'user', content: sent?.content } }),
      JSON.stringify({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'msg_a1', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'Seen.' }] } }),
    ].join('\n') + '\n',
  )

  const second = await launchApp({ env })
  try {
    const { window } = second
    const view = await openSession(window)
    // The history keeps the name, not the size.
    await expectPreviews(view, 'PDFQuarterly report.pdf')
    expect(readdirSync(join(dataDir, 'attachments', 'images'))).toEqual([`${ref}.png`])
  } finally {
    await second.close()
  }

  // Without main's copy the image shows as a chip with its name, not as a broken picture.
  await rm(copy)
  const third = await launchApp({ env })
  try {
    const view = await openSession(third.window)
    const row = view.getByTestId('transcript-prompt').filter({ has: view.page().getByTestId('message-attachments') })
    await expect(row.getByTestId('message-image-chip')).toHaveText('PNGdiagram.png')
    await expect(row.getByTestId('message-image')).toHaveCount(0)
    await expect(row.getByTestId('message-file')).toHaveText('PDFQuarterly report.pdf')
  } finally {
    await third.close()
  }
})
