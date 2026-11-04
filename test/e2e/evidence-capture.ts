import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp, type LaunchOptions } from './helpers'
import { ms } from '../time-scale'

// Screenshots and clips of the app under test that can stay as Evidence of a Ticket (worfy-evidence
// ticket 11). Both come from Playwright of the fixture build only: `page.screenshot` of its window and
// `recordVideo` of `_electron.launch`, never a capture of the screen through the OS.
//
// Where the files go: with WORFY_EVIDENCE=<epic>/<NN> into .scratch/<epic>/evidence/ of this worktree,
// named <NN>-<what>…, and the `ticket evidence` command that records each of them is printed, with the
// item number and the scrub date left for whoever checks the pixels; without the variable into the
// output folder of the running test, so a run on CI leaves nothing in the repository. Every file
// written passes harness/bin/evidence-check (its metadata, and for a clip its sound, size and
// duration) before the helper returns; one that does not is removed.

/** The longest clip the privacy check accepts (harness/bin/evidence-check): a hard limit of the scenario. */
export const CLIP_MAX_SECONDS = 60
/** The largest clip the privacy check accepts: 8 MB. */
export const CLIP_MAX_BYTES = 8 * 1024 * 1024
/** The size of a clip unless the caller gives one: the window size the e2e tests use. */
export const CLIP_SIZE = { width: 1280, height: 800 }
/** The width of one frame on the contact sheet; its height keeps the window's proportions. */
export const SHEET_FRAME_WIDTH = 320
/** Frames in a row of the contact sheet. */
export const SHEET_COLUMNS = 4
/** The room around and between the frames of the sheet, and the height of the caption under each. */
const SHEET_GAP = 8
const SHEET_CAPTION = 22
/** One frame of the sheet per second of the scenario: real seconds of the clip, not a limit of the run. */
const FRAME_EVERY_MS = 1000

export type Theme = 'light' | 'dark'

/** Where the files of one run go, and the Ticket whose Evidence they are (null: the test's own output). */
export interface EvidenceTarget {
  dir: string
  /** `<NN>-` for a Ticket, empty for the test's output. */
  prefix: string
  ticket: { epic: string; nn: string; issues: string } | null
}

const WORFY_EVIDENCE = /^([a-z0-9][a-z0-9._-]*)\/(\d{2,3})$/
const WHAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Reads WORFY_EVIDENCE (`value`): unset or empty — the output folder `outputDir` gives; `<epic>/<NN>` —
 * .scratch/<epic>/evidence/ under `root`, which must hold that Epic. Anything else is an error, so a
 * mistyped variable never writes somewhere unexpected.
 */
export function evidenceTarget(value: string | undefined, outputDir: () => string, root: string = repoRoot): EvidenceTarget {
  if (value === undefined || value.trim() === '') return { dir: outputDir(), prefix: '', ticket: null }
  const match = WORFY_EVIDENCE.exec(value.trim())
  if (!match) throw new Error(`WORFY_EVIDENCE must be <epic>/<NN>, as worfy-evidence/11, got "${value}"`)
  const [, epic, nn] = match as unknown as [string, string, string]
  const epicDir = join(root, '.scratch', epic)
  if (!existsSync(epicDir)) throw new Error(`WORFY_EVIDENCE names Epic "${epic}", but there is no folder .scratch/${epic} in ${root}`)
  return { dir: join(epicDir, 'evidence'), prefix: `${nn}-`, ticket: { epic, nn, issues: join(epicDir, 'issues') } }
}

/** The stem of the files: lower-case words joined by dashes (`card-drag`), so a name is the same on every OS. */
export function checkWhat(what: string): string {
  if (!WHAT.test(what)) throw new Error(`"${what}" is not a name for an Evidence file: lower-case words joined by dashes, as card-drag`)
  return what
}

/**
 * The command that records `file` as Evidence of the Ticket of `target`, or null when the file is the
 * test's own output. `<item>` and `<YYYY-MM-DD>` stay for whoever checks the pixels: the number of the
 * item it proves and the date of that check. The path is relative to the Ticket file, in backticks
 * inside single quotes (in double quotes the shell would run it).
 */
export function ticketEvidenceCommand(target: EvidenceTarget, file: string, kind: 'screenshot' | 'video'): string | null {
  if (target.ticket === null) return null
  const ref = relative(target.ticket.issues, file).split(sep).join('/')
  return `ticket evidence ${target.ticket.epic} ${target.ticket.nn} <item> ${kind} pass --ref '\`${ref}\`' --copy dev --scrub <YYYY-MM-DD>`
}

/**
 * Runs harness/bin/evidence-check on `files`. Any finding, or a check that did not run, is an error that
 * names them, and then the files are removed: a file the check rejects is never left to be committed.
 */
export function keepIfPrivate(files: string[]): void {
  const run = spawnSync(process.execPath, [join(repoRoot, 'harness', 'bin', 'evidence-check'), ...files], { cwd: repoRoot, encoding: 'utf8', timeout: ms(30_000) })
  if (run.status === 0) return
  for (const file of files) rmSync(file, { force: true })
  throw new Error(`evidence-check failed (exit ${String(run.status)}) on ${files.join(', ')}, removed:\n${run.stdout}${run.stderr}${run.error ? String(run.error) : ''}`)
}

function targetOfRun(): EvidenceTarget {
  return evidenceTarget(process.env.WORFY_EVIDENCE, () => test.info().outputDir)
}

function announce(target: EvidenceTarget, file: string, kind: 'screenshot' | 'video'): void {
  const command = ticketEvidenceCommand(target, file, kind)
  if (command !== null) console.log(`[evidence] ${relative(repoRoot, file).split(sep).join('/')}\n  after checking its pixels: ${command}`)
}

const isPage = (target: Page | Locator): target is Page => 'mainFrame' in target

/**
 * Screenshots of `target` (the app's window or a part of it) in each theme of `options.themes` (both by
 * default), through `emulateMedia`; the scheme the page had before is restored afterwards. Files:
 * `<NN>-<what>-light.png`, `<NN>-<what>-dark.png`. Resolves with their paths.
 */
export async function captureScreenshot(target: Page | Locator, what: string, options: { themes?: Theme[] } = {}): Promise<string[]> {
  checkWhat(what)
  const themes = options.themes ?? ['light', 'dark']
  if (themes.length === 0) throw new Error('captureScreenshot: options.themes is empty')
  const run = targetOfRun()
  mkdirSync(run.dir, { recursive: true })
  const page = isPage(target) ? target : target.page()
  // The scheme the page has now, put back afterwards. Not emulateMedia({ colorScheme: null }): that is the
  // system's scheme, and Playwright starts the app emulating light, so on a Mac in dark mode the rest of the
  // test would run dark.
  const before: Theme = (await page.evaluate(() => (globalThis as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia('(prefers-color-scheme: dark)').matches))
    ? 'dark'
    : 'light'
  const files: string[] = []
  try {
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme })
      const file = join(run.dir, `${run.prefix}${what}-${theme}.png`)
      await target.screenshot({ path: file })
      files.push(file)
    }
  } finally {
    await page.emulateMedia({ colorScheme: before })
  }
  keepIfPrivate(files)
  for (const file of files) announce(run, file, 'screenshot')
  return files
}

export interface ClipOptions {
  /** How the app starts; `executablePath` is refused: only the fixture build is recorded. */
  launch?: LaunchOptions
  /** The size of the clip; 1280 × 800 by default. */
  size?: { width: number; height: number }
  /** Lower limits than the 60 s and 8 MB of the privacy check; higher ones are refused. */
  limits?: { seconds?: number; bytes?: number }
}

export interface Clip {
  clip: string
  sheet: string
  /** Frames on the contact sheet: one per second of the scenario, from second 0. */
  frames: number
  /** How long the scenario ran. */
  seconds: number
}

interface Frame {
  second: number
  png: Buffer
}

function limitsOf(options: ClipOptions): { seconds: number; bytes: number } {
  const seconds = options.limits?.seconds ?? CLIP_MAX_SECONDS
  const bytes = options.limits?.bytes ?? CLIP_MAX_BYTES
  if (!(seconds > 0 && seconds <= CLIP_MAX_SECONDS)) throw new Error(`recordClip: limits.seconds must be above 0 and at most ${CLIP_MAX_SECONDS}, got ${seconds}`)
  if (!(bytes > 0 && bytes <= CLIP_MAX_BYTES)) throw new Error(`recordClip: limits.bytes must be above 0 and at most ${CLIP_MAX_BYTES} (8 MB), got ${bytes}`)
  return { seconds, bytes }
}

const sleep = (wait: number): Promise<void> => new Promise((done) => setTimeout(done, Math.max(0, wait)))

/** The width and height of a PNG, from its IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** The size of a contact sheet of `frames` frames of `frame` proportions. */
export function sheetSize(frames: number, frame: { width: number; height: number }): { width: number; height: number; cell: number } {
  const cell = Math.round((SHEET_FRAME_WIDTH * frame.height) / frame.width)
  const rows = Math.ceil(frames / SHEET_COLUMNS)
  const columns = Math.min(frames, SHEET_COLUMNS)
  return { width: SHEET_GAP + columns * (SHEET_FRAME_WIDTH + SHEET_GAP), height: SHEET_GAP + rows * (cell + SHEET_CAPTION + SHEET_GAP), cell }
}

/**
 * The contact sheet of `frames`: a grid of them, SHEET_FRAME_WIDTH wide, each with its second under it.
 * Drawn by the app itself in a window it never shows (offscreen rendering) and taken with
 * `webContents.capturePage()`, so no image library is needed; the frames are files in `dir` the page loads.
 */
async function contactSheet(app: ElectronApplication, frames: Frame[], dir: string): Promise<Buffer> {
  const first = frames[0]
  // unreachable: the frame of second 0 is always taken (underLimit).
  if (first === undefined) throw new Error('recordClip: no frame was taken for the contact sheet')
  const size = sheetSize(frames.length, pngSize(first.png))
  const cells = frames.map((frame) => {
    const name = `frame-${frame.second}.png`
    writeFileSync(join(dir, name), frame.png)
    return `<figure><img src="${name}" width="${SHEET_FRAME_WIDTH}" height="${size.cell}"><figcaption>${frame.second} s</figcaption></figure>`
  })
  const page = join(dir, 'sheet.html')
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; background: #fff; }
body { display: grid; grid-template-columns: repeat(${SHEET_COLUMNS}, ${SHEET_FRAME_WIDTH}px); gap: ${SHEET_GAP}px; padding: ${SHEET_GAP}px; }
figure { margin: 0; }
img { display: block; outline: 1px solid #999; }
figcaption { height: ${SHEET_CAPTION}px; font: 13px/${SHEET_CAPTION}px monospace; color: #000; text-align: center; }
</style>${cells.join('')}`,
  )
  const base64 = await app.evaluate(
    async ({ BrowserWindow }, { page, width, height }) => {
      const window = new BrowserWindow({ show: false, width, height, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
      try {
        await window.loadFile(page)
        await window.webContents.executeJavaScript('Promise.all([...document.images].map((image) => image.decode()))')
        const image = await window.webContents.capturePage({ x: 0, y: 0, width, height })
        return image.toPNG().toString('base64')
      } finally {
        window.destroy()
      }
    },
    { page, width: size.width, height: size.height },
  )
  const png = Buffer.from(base64, 'base64')
  if (png.length === 0) throw new Error('recordClip: the app drew an empty contact sheet')
  return png
}

/**
 * Starts the fixture build with `recordVideo`, runs `scenario` on it, closes the app and keeps the clip
 * of its main window as `<NN>-<what>.webm`, with its contact sheet `<NN>-<what>.sheet.png` next to it:
 * a screenshot of the main window every second while the scenario runs. A scenario longer than 60 s
 * (or `limits.seconds`), a clip over 8 MB (or `limits.bytes`), a scenario that fails and a file the
 * privacy check rejects are errors, and then no file is kept. The clip also holds the app's start and
 * quit, a few seconds more than the scenario: one that comes out over 60 s is a finding of the privacy
 * check, so a scenario near the limit fails there.
 */
export async function recordClip(what: string, scenario: (launched: LaunchedApp) => Promise<void>, options: ClipOptions = {}): Promise<Clip> {
  checkWhat(what)
  if (options.launch?.executablePath !== undefined) {
    throw new Error('recordClip records only the fixture build (out/): a packaged, installed or stable copy shows the data of this machine')
  }
  const limits = limitsOf(options)
  const run = targetOfRun()
  const work = mkdtempSync(join(tmpdir(), 'worfy-clip-'))
  try {
    const videoDir = join(work, 'video')
    const launched = await launchApp({ ...options.launch, recordVideo: { dir: videoDir, size: options.size ?? CLIP_SIZE } })
    let recorded: { video: string; sheet: Buffer; frames: number; seconds: number }
    try {
      recorded = await underLimit(launched, scenario, limits.seconds, work)
    } finally {
      // The clip is complete only once the app has closed.
      await launched.close()
    }
    const bytes = statSync(recorded.video).size
    if (bytes > limits.bytes) {
      throw new Error(`recordClip: the clip is ${bytes} bytes, over the limit of ${limits.bytes} bytes: give a smaller options.size or a shorter scenario`)
    }
    mkdirSync(run.dir, { recursive: true })
    const clip = join(run.dir, `${run.prefix}${what}.webm`)
    const sheet = join(run.dir, `${run.prefix}${what}.sheet.png`)
    copyFileSync(recorded.video, clip)
    writeFileSync(sheet, recorded.sheet)
    keepIfPrivate([clip, sheet])
    announce(run, clip, 'video')
    return { clip, sheet, frames: recorded.frames, seconds: recorded.seconds }
  } finally {
    // Electron helper processes may still hold the clip for a moment after the app exits.
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** Runs `scenario` with a frame every second, within `seconds`; resolves with the clip's path and the sheet. */
async function underLimit(
  launched: LaunchedApp,
  scenario: (launched: LaunchedApp) => Promise<void>,
  seconds: number,
  work: string,
): Promise<{ video: string; sheet: Buffer; frames: number; seconds: number }> {
  const video = launched.window.video()
  if (video === null) throw new Error('recordClip: the window records no clip')
  const frames: Frame[] = []
  const start = Date.now()
  let running = true
  let frameError: unknown
  const framing = (async () => {
    // Second 0 always, however short the scenario: a sheet has at least one frame.
    for (let second = 0; second === 0 || running; second++) {
      await sleep(start + second * FRAME_EVERY_MS - Date.now())
      if (second > 0 && !running) return
      try {
        frames.push({ second, png: await launched.window.screenshot({ timeout: ms(5_000) }) })
      } catch (error) {
        frameError = error
        return
      }
    }
  })()
  const played = scenario(launched).then(() => 'done' as const)
  // The scenario still runs on after the limit; it fails once the app is closed, and that is not news.
  played.catch(() => undefined)
  let limit: NodeJS.Timeout | undefined
  try {
    const over = new Promise<'over'>((done) => (limit = setTimeout(() => done('over'), seconds * 1000)))
    const outcome = await Promise.race([played, over])
    if (outcome === 'over') throw new Error(`recordClip: the scenario ran longer than ${seconds} s, the limit of a clip: no clip is kept; shorten the scenario`)
  } finally {
    clearTimeout(limit)
    running = false
    await framing
  }
  const took = (Date.now() - start) / 1000
  if (frameError !== undefined) throw new Error(`recordClip: a frame of the contact sheet failed: ${String(frameError)}`)
  const sheetDir = join(work, 'sheet')
  mkdirSync(sheetDir, { recursive: true })
  const sheet = await contactSheet(launched.app, frames, sheetDir)
  // Asked while the app runs: Playwright knows the path from the start of the recording.
  return { video: await video.path(), sheet, frames: frames.length, seconds: took }
}
