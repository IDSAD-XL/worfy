import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp, type LaunchOptions } from './helpers'
import { ms } from '../time-scale'

// Screenshots and clips of the app under test that can stay as Evidence of a Ticket (worfy-evidence
// ticket 11). Both come from Playwright of the fixture build only: `page.screenshot` of its window and
// `recordVideo` of `_electron.launch`, never a capture of the screen through the OS.
//
// Where the files go: with WORFY_EVIDENCE=<epic>/<NN> (or options.evidence) into .scratch/<epic>/evidence/
// of this worktree (or options.root), named <NN>-<what>…, and the `ticket evidence` command that records
// each of them is printed, with the item number and the scrub date left for whoever checks the pixels;
// without it into the output folder of the running test, so a run on CI leaves nothing in the
// repository. A file of that name git already tracks is refused: a rerun must not replace a checked
// picture unseen. Every file written passes harness/bin/evidence-check (its metadata, and for a clip
// its sound, size and duration) before the helper returns; on any error no file it wrote is left.

/** The longest clip the privacy check accepts (harness/bin/evidence-check): a hard limit of the scenario. */
export const CLIP_MAX_SECONDS = 60
/** The largest clip the privacy check accepts: 8 MB. */
export const CLIP_MAX_BYTES = 8 * 1024 * 1024
/** The size of a clip unless the caller gives one: the window size the e2e tests use. */
export const CLIP_SIZE = { width: 1280, height: 800 }
/**
 * The longest side of a contact sheet: the largest surface Chromium draws a page on. Its frames are at
 * their own size (1:1, the window's CSS pixels), so the text on them is as readable as in the window.
 */
export const SHEET_MAX_SIDE = 16384
/** The room around and between the frames of the sheet, and the height of the caption under each. */
export const SHEET_GAP = 8
export const SHEET_CAPTION = 22
/** One frame of the sheet per second of the scenario: real seconds of the clip, not a limit of the run. */
const FRAME_EVERY_MS = 1000
/**
 * How long one frame may take: Playwright's own timeout of the screenshot, and a bound of the helper over
 * it. On macOS CI the screenshot of a window destroyed meanwhile never settled, its timeout notwithstanding,
 * and the run hung until the test's timeout and then the worker's teardown (worfy-polish ticket 60).
 */
const FRAME_TIMEOUT_MS = ms(5_000)
const FRAME_BOUND_MS = ms(6_000)
/** While a frame is taken, main is asked this often whether the recorded window still exists. */
const WINDOW_POLL_MS = 250
/** How long main may take to answer that; no answer in time counts as "still there", the frame's bound then decides. */
const WINDOW_ASK_MS = ms(2_000)
/** How long the hidden window may take to draw the contact sheet. */
const SHEET_TIMEOUT_MS = ms(30_000)
/** How long Playwright may take to name the file of the clip; it knows it from the start of the recording. */
const VIDEO_PATH_TIMEOUT_MS = ms(10_000)

export type Theme = 'light' | 'dark'

/** Where the files of one run go, and the Ticket whose Evidence they are (null: the test's own output). */
export interface EvidenceTarget {
  dir: string
  /** The worktree that holds .scratch; the git repository a tracked file is looked up in. */
  root: string
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
  if (value === undefined || value.trim() === '') return { dir: outputDir(), root, prefix: '', ticket: null }
  const match = WORFY_EVIDENCE.exec(value.trim())
  if (!match) throw new Error(`WORFY_EVIDENCE must be <epic>/<NN>, as worfy-evidence/11, got "${value}"`)
  const [, epic, nn] = match as unknown as [string, string, string]
  const epicDir = join(root, '.scratch', epic)
  if (!existsSync(epicDir)) throw new Error(`WORFY_EVIDENCE names Epic "${epic}", but there is no folder .scratch/${epic} in ${root}`)
  return { dir: join(epicDir, 'evidence'), root, prefix: `${nn}-`, ticket: { epic, nn, issues: join(epicDir, 'issues') } }
}

/** Where the helpers write: the Ticket of `evidence` (WORFY_EVIDENCE by default) under `root` (this worktree). */
export interface EvidenceOptions {
  evidence?: string
  root?: string
}

/**
 * Refuses `files` of a Ticket that git already tracks under the target's root: a rerun would replace a
 * picture someone checked, and the privacy check asks for a new scrub: note only for an added file.
 * The test's own output, and a root outside git, are never refused.
 */
export function refuseTracked(target: EvidenceTarget, files: string[]): void {
  if (target.ticket === null) return
  const run = spawnSync('git', ['ls-files', '--', ...files], { cwd: target.root, encoding: 'utf8', timeout: ms(30_000) })
  const tracked = run.status === 0 ? run.stdout.split('\n').filter((line) => line.trim() !== '') : []
  if (tracked.length > 0) {
    throw new Error(`already committed: ${tracked.join(', ')}; give the new picture another name (what), or remove the old one in git first`)
  }
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
  removeAll(files)
  throw new Error(`evidence-check failed (exit ${String(run.status)}) on ${files.join(', ')}, removed:\n${run.stdout}${run.stderr}${run.error ? String(run.error) : ''}`)
}

function targetOfRun(options: EvidenceOptions): EvidenceTarget {
  return evidenceTarget(options.evidence ?? process.env.WORFY_EVIDENCE, () => test.info().outputDir, options.root ?? repoRoot)
}

/** Removes `files`, whatever they hold: on an error, no file the helpers wrote is left unchecked. */
const removeAll = (files: string[]): void => {
  for (const file of files) rmSync(file, { force: true })
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
export async function captureScreenshot(target: Page | Locator, what: string, options: EvidenceOptions & { themes?: Theme[] } = {}): Promise<string[]> {
  checkWhat(what)
  const themes = options.themes ?? ['light', 'dark']
  if (themes.length === 0) throw new Error('captureScreenshot: options.themes is empty')
  const run = targetOfRun(options)
  const fileOf = (theme: Theme): string => join(run.dir, `${run.prefix}${what}-${theme}.png`)
  refuseTracked(run, themes.map(fileOf))
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
    try {
      for (const theme of themes) {
        await page.emulateMedia({ colorScheme: theme })
        // Listed before it is written: a screenshot that fails half way is removed too.
        files.push(fileOf(theme))
        await target.screenshot({ path: fileOf(theme) })
      }
    } finally {
      await page.emulateMedia({ colorScheme: before })
    }
    keepIfPrivate(files)
  } catch (error) {
    removeAll(files)
    throw error
  }
  for (const file of files) announce(run, file, 'screenshot')
  return files
}

export interface ClipOptions extends EvidenceOptions {
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
  /** Frames on the contact sheet: one per second of the scenario, from second 0 (the app's start and quit are not on it). */
  frames: number
  /** How long the scenario ran. */
  seconds: number
  /** The size of a cell of the sheet: the largest frame (sheetCell), in CSS pixels of the window. */
  frame: { width: number; height: number }
}

export interface Frame {
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

/** `work`, or an error that names `what` once `limit` ms have passed without it settling. */
async function bounded<T>(work: Promise<T>, limit: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} did not finish within ${limit / 1000} s`)), limit)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

/** The width and height of a PNG, from its IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

export interface SheetLayout {
  columns: number
  rows: number
  width: number
  height: number
}

/**
 * The grid of a contact sheet of `frames` frames of `frame` size, each at its own size: about as many
 * columns as rows make a sheet near square, and then more columns while it is taller than
 * SHEET_MAX_SIDE. A grid that fits no way is an error that asks for a shorter clip.
 */
export function sheetLayout(frames: number, frame: { width: number; height: number }): SheetLayout {
  const cellWidth = frame.width + SHEET_GAP
  const cellHeight = frame.height + SHEET_CAPTION + SHEET_GAP
  const square = Math.ceil(Math.sqrt((frames * cellHeight) / cellWidth))
  for (let columns = Math.max(1, Math.min(frames, square)); columns <= frames; columns++) {
    const rows = Math.ceil(frames / columns)
    const width = SHEET_GAP + columns * cellWidth
    const height = SHEET_GAP + rows * cellHeight
    if (width > SHEET_MAX_SIDE) break
    if (height <= SHEET_MAX_SIDE) return { columns, rows, width, height }
  }
  throw new Error(
    `recordClip: ${frames} frames of ${frame.width} × ${frame.height} px do not fit on one contact sheet of at most ${SHEET_MAX_SIDE} px a side: shorten the scenario or give a smaller options.size`,
  )
}

/**
 * The size of a cell of the contact sheet: the largest frame's width and height. The frames of one
 * clip may differ: the frame of second 0 is taken before the scenario sizes the window, and Windows
 * fits a new window into the screen first.
 */
export function sheetCell(frames: Frame[]): { width: number; height: number } {
  if (frames.length === 0) throw new Error('recordClip: no frame was taken for the contact sheet')
  const sizes = frames.map((each) => pngSize(each.png))
  return { width: Math.max(...sizes.map((size) => size.width)), height: Math.max(...sizes.map((size) => size.height)) }
}

/**
 * The contact sheet of `frames`: a grid of cells (sheetCell, sheetLayout), each frame at its own size in
 * the top left of its cell with its second under it. The app draws it on a canvas in a window it never
 * shows and gives back the canvas as a PNG, so no image library is needed and the sheet is not bound
 * to the screen: a window, even an offscreen one, is cut to the screen on Windows. The frames are files
 * in `dir` the page loads.
 */
export async function contactSheet(app: ElectronApplication, frames: Frame[], dir: string): Promise<Buffer> {
  const cell = sheetCell(frames)
  const size = sheetLayout(frames.length, cell)
  const cells = frames.map((each, index) => {
    const name = `frame-${index}.png`
    writeFileSync(join(dir, name), each.png)
    return {
      src: name,
      second: each.second,
      x: SHEET_GAP + (index % size.columns) * (cell.width + SHEET_GAP),
      y: SHEET_GAP + Math.floor(index / size.columns) * (cell.height + SHEET_CAPTION + SHEET_GAP),
    }
  })
  const page = join(dir, 'sheet.html')
  writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>contact sheet</title>')
  const draw = `(async () => {
    const sheet = ${JSON.stringify({ width: size.width, height: size.height, cell, caption: SHEET_CAPTION, cells })}
    const canvas = document.createElement('canvas')
    canvas.width = sheet.width
    canvas.height = sheet.height
    const pen = canvas.getContext('2d')
    pen.fillStyle = '#fff'
    pen.fillRect(0, 0, sheet.width, sheet.height)
    pen.font = '14px monospace'
    pen.textAlign = 'center'
    pen.textBaseline = 'middle'
    for (const each of sheet.cells) {
      const image = new Image()
      image.src = each.src
      await image.decode()
      pen.drawImage(image, each.x, each.y)
      pen.strokeStyle = '#999'
      pen.strokeRect(each.x - 0.5, each.y - 0.5, image.naturalWidth + 1, image.naturalHeight + 1)
      pen.fillStyle = '#000'
      pen.fillText(each.second + ' s', each.x + sheet.cell.width / 2, each.y + sheet.cell.height + sheet.caption / 2)
    }
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
  })()`
  const drawn = app.evaluate(
    async ({ BrowserWindow }, { page, draw }) => {
      const window = new BrowserWindow({ show: false, width: 200, height: 200 })
      try {
        await window.loadFile(page)
        return (await window.webContents.executeJavaScript(draw)) as string
      } finally {
        window.destroy()
      }
    },
    { page, draw },
  )
  const base64 = await bounded(drawn, SHEET_TIMEOUT_MS, 'recordClip: drawing the contact sheet')
  const png = Buffer.from(base64, 'base64')
  if (png.length === 0) throw new Error('recordClip: the app drew an empty contact sheet')
  return png
}

/** The folder of playwright-core, the one @playwright/test runs on. */
export const playwrightCore = (): string => {
  const require = createRequire(import.meta.url)
  return dirname(require.resolve('playwright-core/package.json', { paths: [dirname(require.resolve('@playwright/test'))] }))
}

/** The revision of ffmpeg this Playwright downloads (browsers.json of playwright-core). */
export const ffmpegRevision = (): string => {
  const browsers = JSON.parse(readFileSync(join(playwrightCore(), 'browsers.json'), 'utf8')) as { browsers: Array<{ name: string; revision: string }> }
  const ffmpeg = browsers.browsers.find((each) => each.name === 'ffmpeg')
  if (ffmpeg === undefined) throw new Error('playwright-core/browsers.json names no ffmpeg')
  return ffmpeg.revision
}

/**
 * The folder Playwright installs its ffmpeg into, as Playwright finds it: PLAYWRIGHT_BROWSERS_PATH
 * (`0`: inside playwright-core), or ms-playwright in the cache folder of the system.
 */
export function playwrightFfmpegDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string, core: string): string {
  const browsers = env.PLAYWRIGHT_BROWSERS_PATH
  const base =
    browsers === '0'
      ? join(core, '.local-browsers')
      : browsers !== undefined && browsers !== ''
        ? resolve(browsers)
        : platform === 'win32'
          ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')
          : platform === 'darwin'
            ? join(home, 'Library', 'Caches', 'ms-playwright')
            : join(env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright')
  return join(base, `ffmpeg-${ffmpegRevision()}`)
}

/**
 * Why recordVideo cannot record here, or null: without Playwright's own ffmpeg the launch does not fail,
 * the window's screenshots hang instead (seen with Playwright 1.63), so this is asked before the launch.
 */
export function ffmpegProblem(dir: string): string | null {
  if (existsSync(join(dir, 'INSTALLATION_COMPLETE'))) return null
  return `recordClip: Playwright's ffmpeg, which recordVideo needs, is not installed (no ${dir}): run \`pnpm exec playwright install ffmpeg\` (pnpm test:e2e runs it first)`
}


/**
 * Keeps the recorded `video` as `clip` and `sheet` (the PNG) next to it, once both pass the privacy
 * check; on any error neither is left.
 */
export function saveClip(video: string, sheetPng: Buffer, clip: string, sheet: string): void {
  try {
    copyFileSync(video, clip)
    writeFileSync(sheet, sheetPng)
    keepIfPrivate([clip, sheet])
  } catch (error) {
    removeAll([clip, sheet])
    throw error
  }
}

/**
 * Starts the fixture build with `recordVideo`, runs `scenario` on it, closes the app and keeps the clip
 * of its main window as `<NN>-<what>.webm`, with its contact sheet `<NN>-<what>.sheet.png` next to it:
 * a screenshot of the main window every second while the scenario runs, at its own size. A scenario longer than 60 s
 * (or `limits.seconds`), a clip over 8 MB (or `limits.bytes`), a scenario that fails and a file the
 * privacy check rejects are errors, and then no file is kept. The clip also holds the app's start and
 * quit, a few seconds more than the scenario, and those are not on the sheet: one that comes out over
 * 60 s is a finding of the privacy check, so a scenario near the limit fails there.
 */
export async function recordClip(what: string, scenario: (launched: LaunchedApp) => Promise<void>, options: ClipOptions = {}): Promise<Clip> {
  checkWhat(what)
  if (options.launch?.executablePath !== undefined) {
    throw new Error('recordClip records only the fixture build (out/): a packaged, installed or stable copy shows the data of this machine')
  }
  const limits = limitsOf(options)
  const run = targetOfRun(options)
  const clip = join(run.dir, `${run.prefix}${what}.webm`)
  const sheet = join(run.dir, `${run.prefix}${what}.sheet.png`)
  refuseTracked(run, [clip, sheet])
  const problem = ffmpegProblem(playwrightFfmpegDir(process.env, process.platform, homedir(), playwrightCore()))
  if (problem !== null) throw new Error(problem)
  const work = mkdtempSync(join(tmpdir(), 'worfy-clip-'))
  try {
    const videoDir = join(work, 'video')
    const launched = await launchApp({ ...options.launch, recordVideo: { dir: videoDir, size: options.size ?? CLIP_SIZE } })
    let recorded: Recorded
    let windowGone = false
    try {
      recorded = await underLimit(launched, scenario, limits.seconds, work)
    } catch (error) {
      windowGone = error instanceof FrameFailed || launched.window.isClosed()
      throw error
    } finally {
      // The clip is complete only once the app has closed. With the window gone Playwright may still wait
      // on it, so the app is killed after a short quit: an app left running hangs the worker's teardown.
      await launched.close({ windowGone })
    }
    const bytes = statSync(recorded.video).size
    if (bytes > limits.bytes) {
      throw new Error(`recordClip: the clip is ${bytes} bytes, over the limit of ${limits.bytes} bytes: give a smaller options.size or a shorter scenario`)
    }
    mkdirSync(run.dir, { recursive: true })
    saveClip(recorded.video, recorded.sheet, clip, sheet)
    announce(run, clip, 'video')
    return { clip, sheet, frames: recorded.frames, seconds: recorded.seconds, frame: recorded.frame }
  } finally {
    // Electron helper processes may still hold the clip for a moment after the app exits.
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** A frame of the contact sheet that was not taken: the window is gone, or it does not answer. */
class FrameFailed extends Error {}

/** The id of the BrowserWindow in main that shows `page`, or undefined when main does not say in time. */
async function windowIdOf(app: ElectronApplication, page: Page): Promise<number | undefined> {
  const ask = app.evaluate(({ BrowserWindow }, url) => {
    const windows = BrowserWindow.getAllWindows().filter((each) => !each.isDestroyed())
    return (windows.find((each) => each.webContents.getURL() === url) ?? windows[0])?.id
  }, page.url())
  return bounded(ask, WINDOW_ASK_MS, 'asking main for the window').catch(() => undefined)
}

/**
 * Whether main says the window `id` is destroyed. An app that no longer answers Playwright is gone too;
 * one that does not answer in time is not taken for gone.
 */
async function windowDestroyed(app: ElectronApplication, id: number | undefined): Promise<boolean> {
  if (id === undefined) return false
  const ask = app.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id)
    return window === null || window.isDestroyed()
  }, id)
  ask.catch(() => undefined)
  return Promise.race([ask.catch(() => true), sleep(WINDOW_ASK_MS).then(() => false)])
}

/**
 * A screenshot of the recorded window, in CSS pixels: the frame at the window's own size, whatever the
 * scale of the display. It fails at once when the page closes or main says the window is destroyed, and
 * at FRAME_BOUND_MS when the screenshot never settles.
 */
async function takeFrame(launched: LaunchedApp, windowId: number | undefined): Promise<Buffer> {
  const page = launched.window
  if (page.isClosed()) throw new Error('the window was closed')
  let over = false
  let onClose = (): void => undefined
  const gone = new Promise<never>((_, fail) => {
    onClose = () => fail(new Error('the window was closed'))
    page.once('close', onClose)
    void (async () => {
      while (!over) {
        await sleep(WINDOW_POLL_MS)
        if (!over && (await windowDestroyed(launched.app, windowId))) return fail(new Error('the window was destroyed'))
      }
    })()
  })
  try {
    return await bounded(Promise.race([page.screenshot({ scale: 'css', timeout: FRAME_TIMEOUT_MS }), gone]), FRAME_BOUND_MS, 'the screenshot')
  } finally {
    over = true
    page.off('close', onClose)
  }
}

interface Recorded {
  video: string
  sheet: Buffer
  frames: number
  seconds: number
  frame: { width: number; height: number }
}

/** Runs `scenario` with a frame every second, within `seconds`; resolves with the clip's path and the sheet. */
async function underLimit(
  launched: LaunchedApp,
  scenario: (launched: LaunchedApp) => Promise<void>,
  seconds: number,
  work: string,
): Promise<Recorded> {
  const video = launched.window.video()
  if (video === null) throw new Error('recordClip: the window records no clip')
  const windowId = await windowIdOf(launched.app, launched.window)
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
        frames.push({ second, png: await takeFrame(launched, windowId) })
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
    // A frame that failed ends the wait: without the window the scenario has nothing left to record.
    const outcome = await Promise.race([played, over, framing.then(() => 'frame' as const)])
    if (outcome === 'over') throw new Error(`recordClip: the scenario ran longer than ${seconds} s, the limit of a clip: no clip is kept; shorten the scenario`)
  } finally {
    clearTimeout(limit)
    running = false
    await framing
  }
  const took = (Date.now() - start) / 1000
  if (frameError !== undefined) throw new FrameFailed(`recordClip: a frame of the contact sheet failed: ${String(frameError)}`)
  const sheetDir = join(work, 'sheet')
  mkdirSync(sheetDir, { recursive: true })
  const sheet = await contactSheet(launched.app, frames, sheetDir)
  // Asked while the app runs: Playwright knows the path from the start of the recording.
  const path = await bounded(video.path(), VIDEO_PATH_TIMEOUT_MS, 'recordClip: the path of the clip')
  return { video: path, sheet, frames: frames.length, seconds: took, frame: sheetCell(frames) }
}
