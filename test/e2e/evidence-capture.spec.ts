import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { catScript, loginProfileWithNode } from '../harness-node'
import {
  CLIP_MAX_BYTES,
  CLIP_MAX_SECONDS,
  captureScreenshot,
  checkWhat,
  contactSheet,
  evidenceTarget,
  ffmpegProblem,
  ffmpegRevision,
  keepIfPrivate,
  opaquePng,
  playwrightCore,
  playwrightFfmpegDir,
  pngPixels,
  pngSize,
  recordClip,
  saveClip,
  SHEET_CAPTION,
  SHEET_GAP,
  SHEET_MAX_SIDE,
  sheetCell,
  sheetLayout,
  ticketEvidenceCommand,
} from './evidence-capture'
import { canvasReady, innerSize, launchApp, repoRoot, type LaunchOptions } from './helpers'
import { ms } from '../time-scale'
import { WINDOW_BACKGROUND } from '../../src/main/window-frame'

// The Evidence helpers of e2e (worfy-evidence ticket 11): captureScreenshot gives a PNG per theme,
// recordClip a webm of the main window with its contact sheet, both from Playwright of the fixture
// build, and both pass harness/bin/evidence-check. A temporary Project with one Ticket, a temporary
// HOME, Claude home and Harness home; the fake agent. Without WORFY_EVIDENCE the files are only in the
// output of the test, and .scratch of this worktree stays as it was.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-000000e1'
const EPIC = 'demo'
const CARD = `.react-flow__node [data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="7"]`
const SIZE = { width: 1280, height: 800 }
/** A WORFY_EVIDENCE run writes into .scratch on purpose: the checks that it stays clean are for the others. */
const EVIDENCE_RUN = (process.env.WORFY_EVIDENCE ?? '').trim() !== ''

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-evidence-capture-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** A Project with Epic `demo` and its Ticket 07, as the Canvas shows it; the options of launchApp for it. */
function fixtureProject(): LaunchOptions {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '07-rate-limit.md'), ['# 07 — Rate limit', '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Что делаем', '', 'Limit the bids.', ''].join('\n'))
  const home = join(scratch, 'home')
  mkdirSync(home)
  loginProfileWithNode(home)
  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: EPIC, num: 7, slug: 'rate-limit', title: '07 — Rate limit', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  return {
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'),
      HARNESS_HOME: join(scratch, 'no-harness-home'),
      HOME: home,
      SHELL: '/bin/sh',
    },
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A 1 × 1 PNG, with a tEXt chunk of `text` when one is given. */
function png(text?: string): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])
  const idat = Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(text === undefined ? [] : [chunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1'))]),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** An 8-bit RGBA PNG of `pixels` ([r, g, b, a] each, row after row), every row unfiltered: written here, not by the helper. */
function rgbaPng(width: number, height: number, pixels: number[][]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows: number[] = []
  for (let y = 0; y < height; y++) rows.push(0, ...pixels.slice(y * width, (y + 1) * width).flat())
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The filter byte of each row of an 8-bit PNG with `channels` bytes a pixel. */
function rowFilters(file: Buffer, channels: number): number[] {
  const { width, height } = pngSize(file)
  const idat: Buffer[] = []
  for (let at = 8; at + 12 <= file.length; at += 12 + file.readUInt32BE(at)) {
    if (file.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(file.subarray(at + 8, at + 8 + file.readUInt32BE(at)))
  }
  const raw = inflateSync(Buffer.concat(idat))
  return Array.from({ length: height }, (_, y) => raw[y * (width * channels + 1)] ?? -1)
}

/**
 * The alpha of the pixels of `file` as Electron decodes them (nativeImage, Skia), not as the helper does:
 * how many pixels, how many have alpha below 255 and the lowest alpha, and how many have another alpha
 * than pngPixels reads. Only the alpha: Electron converts the colours by the ICC profile Chromium puts in
 * a screenshot, and the order of the colour bytes of a bitmap is the platform's.
 */
async function decoded(app: ElectronApplication, file: Buffer): Promise<{ pixels: number; translucent: number; lowest: number; differ: number }> {
  const ours = pngPixels(file).rgba
  const theirs = Buffer.from(
    await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).toBitmap().toString('base64'), file.toString('base64')),
    'base64',
  )
  expect(theirs.length).toBe(ours.length)
  let translucent = 0
  let lowest = 255
  let differ = 0
  for (let at = 3; at < theirs.length; at += 4) {
    const alpha = theirs[at] ?? 0
    if (alpha < 255) translucent++
    lowest = Math.min(lowest, alpha)
    if (alpha !== ours[at]) differ++
  }
  return { pixels: theirs.length / 4, translucent, lowest, differ }
}

/**
 * A 6 × 5 RGBA PNG Pillow wrote, its rows filtered Sub, Up, Sub, Up, Paeth: a reading of PNG filters
 * independent of the helper's own writing. PILLOW_PIXELS gives its pixels.
 */
const PILLOW_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAFCAYAAABmWJ3mAAAAQklEQVR42mPkZWdOSbSVNUXHTAw4AKOGnMh/EX4uBnTMhE1QhJ+LgeXD5YeMouw3dIVEb+gqK9/QVRW7oatqfkMXAH0iEVz9TGXjAAAAAElFTkSuQmCC'
const PILLOW_PIXELS = Array.from({ length: 30 }, (_, at) => {
  const [x, y] = [at % 6, Math.floor(at / 6)]
  if (y <= 1) return [(x * 97 + 13) % 256, (x * 61 + 7) % 256, (x * 29 + 3) % 256, (x * 53 + 100) % 256]
  if (y <= 3) return [(x + y) * 20, (x + y) * 15, (x + y) * 10, 255]
  return [(x * 37 + y * 11) % 256, (x * x * 7) % 256, (255 - x * 40 + 256) % 256, (x * 45) % 256]
})

/** The files of the test's output folder whose names start with `stem`. */
const filesOf = (stem: string): string[] => (existsSync(test.info().outputDir) ? readdirSync(test.info().outputDir).filter((name) => name.startsWith(stem)) : [])

/** What git reports for .scratch of this worktree. */
const scratchStatus = (): string => execFileSync('git', ['status', '--porcelain', '--', '.scratch'], { cwd: repoRoot, encoding: 'utf8' })

/** git for the fixture repository, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/**
 * harness/bin/evidence-check --changed over the tickets root of `repo`, against `base`, with an empty
 * Harness home (no registry, no personal list) and outside GitHub Actions.
 */
function evidenceCheckChanged(repo: string, base: string): { status: number | null; output: string } {
  const harnessHome = join(scratch, 'hh')
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  mkdirSync(join(harnessHome, 'user'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
  const env: NodeJS.ProcessEnv = { ...process.env, HARNESS_HOME: harnessHome, CLAUDE_GATE_CONFIG: join(harnessHome, 'gate', 'config.json') }
  for (const key of ['GITHUB_ACTIONS', 'CLAUDE_PROFILES_DIR', 'CLAUDE_TICKET_BIN', 'CLAUDE_PROFILE_BIN']) delete env[key]
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  const run = spawnSync(process.execPath, [join(repoRoot, 'harness', 'bin', 'evidence-check'), '--changed', '--root', '.scratch', '--base', base], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: ms(30_000),
  })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

test.describe('where the files go and what the helpers print', () => {
  test('without WORFY_EVIDENCE: the output folder of the test, no prefix and no ticket evidence command', () => {
    const output = join(scratch, 'out')
    for (const value of [undefined, '', '  ']) {
      const target = evidenceTarget(value, () => output, scratch)
      expect(target).toEqual({ dir: output, root: scratch, prefix: '', ticket: null })
      expect(ticketEvidenceCommand(target, join(output, 'x.png'), 'screenshot')).toBeNull()
    }
  })

  test('WORFY_EVIDENCE=<epic>/<NN>: .scratch/<epic>/evidence/ with the <NN>- prefix, and the command with the path from the Ticket file', () => {
    mkdirSync(join(scratch, '.scratch', 'worfy-evidence'), { recursive: true })
    const target = evidenceTarget('worfy-evidence/11', () => 'unused', scratch)
    expect(target.dir).toBe(join(scratch, '.scratch', 'worfy-evidence', 'evidence'))
    expect(target.prefix).toBe('11-')
    expect(ticketEvidenceCommand(target, join(target.dir, '11-card-drag.webm'), 'video')).toBe(
      "ticket evidence worfy-evidence 11 <item> video pass --ref '`../evidence/11-card-drag.webm`' --copy dev --scrub <YYYY-MM-DD>",
    )
    expect(ticketEvidenceCommand(target, join(target.dir, '11-tile-dark.png'), 'screenshot')).toBe(
      "ticket evidence worfy-evidence 11 <item> screenshot pass --ref '`../evidence/11-tile-dark.png`' --copy dev --scrub <YYYY-MM-DD>",
    )
  })

  test('a WORFY_EVIDENCE that is not <epic>/<NN>, or names an Epic with no folder, is an error', () => {
    for (const bad of ['worfy-evidence', 'worfy-evidence/1', 'worfy-evidence/eleven', '../x/11', 'a/b/11']) {
      expect(() => evidenceTarget(bad, () => 'unused', scratch), bad).toThrow(/WORFY_EVIDENCE must be <epic>\/<NN>/)
    }
    expect(() => evidenceTarget('no-such-epic/11', () => 'unused', scratch)).toThrow(/no folder \.scratch\/no-such-epic/)
  })

  test('a name of an Evidence file is lower-case words joined by dashes', () => {
    expect(checkWhat('card-drag')).toBe('card-drag')
    for (const bad of ['Card', 'card drag', 'card/drag', '-card', 'card-', '']) expect(() => checkWhat(bad), bad).toThrow(/not a name for an Evidence file/)
  })

  test('a file evidence-check rejects is an error and is removed; a clean one stays', () => {
    const clean = join(scratch, 'clean.png')
    writeFileSync(clean, png())
    keepIfPrivate([clean])
    expect(existsSync(clean)).toBe(true)
    const leaky = join(scratch, 'leaky.png')
    // A home folder path with a user name, put together from pieces (a stand-in user).
    writeFileSync(leaky, png(`/Us${'ers'}/jdoe/proj`))
    expect(() => keepIfPrivate([leaky])).toThrow(/evidence-check failed \(exit 1\) on .*leaky\.png, removed:[\s\S]*home-path/)
    expect(existsSync(leaky)).toBe(false)
  })

  test('the size of a PNG comes from its header; anything else is not a PNG', () => {
    expect(pngSize(png())).toEqual({ width: 1, height: 1 })
    expect(() => pngSize(Buffer.from('GIF89a and more bytes than a header'))).toThrow('not a PNG')
  })

  test('opaquePng: each translucent pixel laid over the background, as an RGB PNG; a picture with no translucent pixel stays as it is (worfy-evidence ticket 13)', () => {
    // Opaque red, blue at alpha 128, green at alpha 0, over #102030.
    const translucent = rgbaPng(3, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 128],
      [0, 255, 0, 0],
    ])
    const flat = opaquePng(translucent, '#102030')
    const read = pngPixels(flat)
    expect(read.alpha).toBe(false)
    expect([...read.rgba]).toEqual([255, 0, 0, 255, Math.round((16 * 127) / 255), Math.round((32 * 127) / 255), Math.round((255 * 128 + 48 * 127) / 255), 255, 16, 32, 48, 255])
    // Every pixel opaque, or no alpha channel at all (Windows and Linux): the very bytes come back.
    const opaque = rgbaPng(2, 1, [
      [1, 2, 3, 255],
      [4, 5, 6, 255],
    ])
    expect(opaquePng(opaque, '#102030')).toBe(opaque)
    const grey = png()
    expect(opaquePng(grey, '#102030')).toBe(grey)
    expect(() => opaquePng(translucent, 'black')).toThrow(/must be #rrggbb/)

    // A PNG another encoder wrote, rows filtered Sub, Up and Paeth: read as written.
    expect(rowFilters(Buffer.from(PILLOW_PNG, 'base64'), 4)).toEqual([1, 2, 1, 2, 4])
    expect([...pngPixels(Buffer.from(PILLOW_PNG, 'base64')).rgba]).toEqual(PILLOW_PIXELS.flat())

    // Noise, the same row again, and diagonal gradients: the rows the helper writes take more than one
    // filter (Up for a repeated row), and each pixel reads back as laid over the background.
    const width = 48
    const height = 24
    const pixels: number[][] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y % 4 === 0) pixels.push([(x * 7919 + y * 104729) % 256, (x * 31 + y * 17) % 256, (x * y) % 256, (x * 13) % 256])
        else if (y % 4 === 1) pixels.push([...(pixels[(y - 1) * width + x] ?? [])])
        else pixels.push([(x + y) * 3, (x + y) * 2, x + y, 255])
      }
    }
    const mixed = opaquePng(rgbaPng(width, height, pixels), '#f7f7f9')
    expect(new Set(rowFilters(mixed, 3))).toContain(2)
    expect(new Set(rowFilters(mixed, 3)).size).toBeGreaterThanOrEqual(2)
    const under = [0xf7, 0xf7, 0xf9]
    const expected = pixels.flatMap(([r, g, b, a]) => [...[r, g, b].map((c, i) => Math.round(((c ?? 0) * (a ?? 0) + (under[i] ?? 0) * (255 - (a ?? 0))) / 255)), 255])
    expect([...pngPixels(mixed).rgba]).toEqual(expected)
    expect(() => pngPixels(Buffer.from('GIF89a and more bytes than a header'))).toThrow('not a PNG')
  })

  test('the contact sheet: frames at their own size, a grid near square, never over the largest side', () => {
    const cell = { width: 1280 + SHEET_GAP, height: 800 + SHEET_CAPTION + SHEET_GAP }
    expect(sheetLayout(1, { width: 1280, height: 800 })).toEqual({ columns: 1, rows: 1, width: SHEET_GAP + cell.width, height: SHEET_GAP + cell.height })
    expect(sheetLayout(4, { width: 1280, height: 800 })).toEqual({ columns: 2, rows: 2, width: SHEET_GAP + 2 * cell.width, height: SHEET_GAP + 2 * cell.height })
    // A full minute: 61 frames of the default window.
    const minute = sheetLayout(61, { width: 1280, height: 800 })
    expect(minute).toEqual({ columns: 7, rows: 9, width: SHEET_GAP + 7 * cell.width, height: SHEET_GAP + 9 * cell.height })
    // 9 frames of 3100 × 5450: the near-square grid (4 columns, 3 rows) is taller than the largest side, 5 columns fit.
    expect(Math.ceil(Math.sqrt((9 * (5450 + SHEET_CAPTION + SHEET_GAP)) / (3100 + SHEET_GAP)))).toBe(4)
    expect(sheetLayout(9, { width: 3100, height: 5450 })).toEqual({ columns: 5, rows: 2, width: SHEET_GAP + 5 * (3100 + SHEET_GAP), height: SHEET_GAP + 2 * (5450 + SHEET_CAPTION + SHEET_GAP) })
    expect(SHEET_GAP + 5 * (3100 + SHEET_GAP)).toBeLessThanOrEqual(SHEET_MAX_SIDE)
    expect(() => sheetLayout(61, { width: 2560, height: 1600 })).toThrow(/61 frames of 2560 × 1600 px do not fit on one contact sheet of at most 16384 px a side: shorten the scenario/)
  })

  test('a cell of the contact sheet is as wide and as tall as the largest frame, whichever frame that is', () => {
    const sized = (width: number, height: number): Buffer => {
      const each = Buffer.from(png())
      each.writeUInt32BE(width, 16)
      each.writeUInt32BE(height, 20)
      return each
    }
    // Windows fits the new window into the screen first: the frame of second 0 is smaller than the rest.
    expect(sheetCell([{ second: 0, png: sized(1264, 735) }, { second: 1, png: sized(1280, 800) }])).toEqual({ width: 1280, height: 800 })
    expect(sheetCell([{ second: 0, png: sized(1300, 700) }, { second: 1, png: sized(1280, 800) }])).toEqual({ width: 1300, height: 800 })
    expect(() => sheetCell([])).toThrow('no frame was taken')
  })

  test('the ffmpeg of Playwright: where Playwright looks for it, and the install command when it is not there', () => {
    const revision = ffmpegRevision()
    const core = playwrightCore()
    const home = join(scratch, 'home')
    expect(playwrightFfmpegDir({ PLAYWRIGHT_BROWSERS_PATH: join(scratch, 'b') }, 'darwin', home, core)).toBe(join(scratch, 'b', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({ PLAYWRIGHT_BROWSERS_PATH: '0' }, 'linux', home, core)).toBe(join(core, '.local-browsers', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({}, 'darwin', home, core)).toBe(join(home, 'Library', 'Caches', 'ms-playwright', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({ LOCALAPPDATA: join(scratch, 'local') }, 'win32', home, core)).toBe(join(scratch, 'local', 'ms-playwright', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({}, 'win32', home, core)).toBe(join(home, 'AppData', 'Local', 'ms-playwright', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({ XDG_CACHE_HOME: join(scratch, 'xdg') }, 'linux', home, core)).toBe(join(scratch, 'xdg', 'ms-playwright', `ffmpeg-${revision}`))
    expect(playwrightFfmpegDir({}, 'linux', home, core)).toBe(join(home, '.cache', 'ms-playwright', `ffmpeg-${revision}`))
    const dir = join(scratch, 'b', `ffmpeg-${revision}`)
    expect(ffmpegProblem(dir)).toMatch(/^recordClip: Playwright's ffmpeg, which recordVideo needs, is not installed .*: run `pnpm exec playwright install ffmpeg`/)
    // A folder half downloaded is not an install either.
    mkdirSync(dir, { recursive: true })
    expect(ffmpegProblem(dir)).not.toBeNull()
    writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
    expect(ffmpegProblem(dir)).toBeNull()
  })

  test('saveClip: when the sheet cannot be written, the copied clip is removed too', () => {
    const video = join(scratch, 'video.webm')
    writeFileSync(video, 'not checked')
    const clip = join(scratch, '11-x.webm')
    // The folder of the sheet is a file: writing it fails after the clip is copied.
    writeFileSync(join(scratch, 'blocker'), '')
    expect(() => saveClip(video, png(), clip, join(scratch, 'blocker', '11-x.sheet.png'))).toThrow()
    expect(existsSync(clip)).toBe(false)
  })

  test('captureScreenshot: <NN>-<what>-<theme>.png in .scratch/<epic>/evidence/ of the root given; a failing second theme leaves no file', async () => {
    mkdirSync(join(scratch, '.scratch', 'demo'), { recursive: true })
    const shots: string[] = []
    const schemes: string[] = []
    const fake = (failOn: number): Locator => {
      const page = {
        evaluate: async () => false,
        emulateMedia: async ({ colorScheme }: { colorScheme: string }) => {
          schemes.push(colorScheme)
        },
      }
      return {
        page: () => page as unknown as Page,
        screenshot: async ({ path }: { path: string }) => {
          shots.push(path)
          const shot = png()
          writeFileSync(path, shot)
          if (shots.length === failOn) throw new Error('the window went away')
          return shot
        },
      } as unknown as Locator
    }
    const evidence = join(scratch, '.scratch', 'demo', 'evidence')
    const files = await captureScreenshot(fake(0), 'tile', { evidence: 'demo/11', root: scratch })
    expect(files).toEqual([join(evidence, '11-tile-light.png'), join(evidence, '11-tile-dark.png')])
    expect(files.every((file) => existsSync(file))).toBe(true)
    // The scheme the page had (light here) is put back.
    expect(schemes).toEqual(['light', 'dark', 'light'])

    shots.length = 0
    schemes.length = 0
    await expect(captureScreenshot(fake(2), 'broken', { evidence: 'demo/11', root: scratch })).rejects.toThrow('the window went away')
    expect(readdirSync(evidence).filter((name) => name.startsWith('11-broken'))).toEqual([])
    expect(schemes).toEqual(['light', 'dark', 'light'])
  })

  test('a file of that name git already tracks is refused, before anything is written or started', async () => {
    const root = join(scratch, 'tracked')
    const evidence = join(root, '.scratch', 'demo', 'evidence')
    mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, '11-drag.webm'), 'clip')
    writeFileSync(join(evidence, '11-tile-dark.png'), png())
    git(root, 'init', '-q')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'checked pictures')
    let ran = false
    await expect(
      recordClip('drag', async () => {
        ran = true
      }, { evidence: 'demo/11', root }),
    ).rejects.toThrow(/already committed: \.scratch\/demo\/evidence\/11-drag\.webm; give the new picture another name/)
    expect(ran).toBe(false)
    const untouched = { page: () => ({}) as Page, screenshot: async () => { ran = true } } as unknown as Locator
    await expect(captureScreenshot(untouched, 'tile', { evidence: 'demo/11', root })).rejects.toThrow(/already committed: \.scratch\/demo\/evidence\/11-tile-dark\.png/)
    expect(ran).toBe(false)
  })
})

test.describe('recordClip refuses before it starts anything', () => {
  test('a packaged, installed or stable copy: only the fixture build is recorded', async () => {
    let ran = false
    await expect(
      recordClip('x', async () => {
        ran = true
      }, { launch: { executablePath: join(scratch, 'worfy') } }),
    ).rejects.toThrow(/records only the fixture build/)
    expect(ran).toBe(false)
  })

  test('no ffmpeg of Playwright: the install command, not a hang on the first frame', async () => {
    const before = process.env.PLAYWRIGHT_BROWSERS_PATH
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(scratch, 'no-browsers')
    try {
      await expect(recordClip('x', async () => undefined)).rejects.toThrow(/Playwright's ffmpeg, which recordVideo needs, is not installed .*pnpm exec playwright install ffmpeg/)
    } finally {
      if (before === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
      else process.env.PLAYWRIGHT_BROWSERS_PATH = before
    }
  })

  test('limits above 60 s or 8 MB', async () => {
    expect(CLIP_MAX_SECONDS).toBe(60)
    expect(CLIP_MAX_BYTES).toBe(8 * 1024 * 1024)
    await expect(recordClip('x', async () => undefined, { limits: { seconds: 61 } })).rejects.toThrow(/limits\.seconds must be above 0 and at most 60/)
    await expect(recordClip('x', async () => undefined, { limits: { bytes: CLIP_MAX_BYTES + 1 } })).rejects.toThrow(/limits\.bytes must be above 0 and at most/)
  })
})

test('captureScreenshot: a PNG of the window in each theme, of a part of it, and only the themes asked for', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  const before = scratchStatus()
  const launched = await launchApp(fixtureProject())
  try {
    const { window } = launched
    const card = window.locator(CARD)
    await canvasReady(launched, { visible: [card], size: SIZE })
    const darkNow = (): Promise<boolean> =>
      window.evaluate(() => (globalThis as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia('(prefers-color-scheme: dark)').matches)
    const own = await darkNow()
    const [light, dark] = await captureScreenshot(window, 'canvas')
    expect(light).toBe(test.info().outputPath('canvas-light.png'))
    expect(dark).toBe(test.info().outputPath('canvas-dark.png'))
    const lightPng = readFileSync(light as string)
    const darkPng = readFileSync(dark as string)
    expect(pngSize(lightPng).width).toBeGreaterThan(0)
    // The themes differ on the pixels: emulateMedia reached the page.
    expect(lightPng.equals(darkPng)).toBe(false)
    // The scheme the page had is back after a run that ended on the dark theme, and after one on the other theme.
    expect(await darkNow()).toBe(own)
    await captureScreenshot(window, 'canvas-again', { themes: [own ? 'light' : 'dark'] })
    expect(await darkNow()).toBe(own)

    // No Tailscale CLI for the app under test (launch-env.ts): no tailnet name can reach a picture.
    const tailscale = await launched.app.evaluate(() => {
      const cli = process.env.WORFY_TAILSCALE
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      return { cli, exists: cli === undefined ? null : fs.existsSync(cli) }
    })
    expect(tailscale.cli).toBeTruthy()
    expect(tailscale.exists).toBe(false)

    // A full minute of frames fits on one sheet the app draws, at the size sheetLayout gives.
    const frame = await window.screenshot({ scale: 'css' })
    const sheetDir = join(scratch, 'sheet')
    mkdirSync(sheetDir)
    const sheet = await contactSheet(launched.app, Array.from({ length: 61 }, (_, second) => ({ second, png: frame })), sheetDir)
    const minute = sheetLayout(61, pngSize(frame))
    expect(pngSize(sheet)).toEqual({ width: minute.width, height: minute.height })
    // Frames of two sizes: the cells take the larger one, whichever comes first.
    const small = await card.screenshot({ scale: 'css' })
    const mixedDir = join(scratch, 'mixed')
    mkdirSync(mixedDir)
    const mixed = await contactSheet(launched.app, [{ second: 0, png: small }, { second: 1, png: frame }], mixedDir)
    const two = sheetLayout(2, pngSize(frame))
    expect(pngSize(mixed)).toEqual({ width: two.width, height: two.height })

    const only = await captureScreenshot(card, 'card', { themes: ['dark'] })
    expect(only).toEqual([test.info().outputPath('card-dark.png')])
    const box = await card.boundingBox()
    expect(pngSize(readFileSync(only[0] as string)).width).toBeLessThan(pngSize(lightPng).width)
    expect(box).not.toBeNull()
    expect(existsSync(test.info().outputPath('card-light.png'))).toBe(false)
    await expect(captureScreenshot(card, 'card', { themes: [] })).rejects.toThrow(/themes is empty/)
  } finally {
    await launched.close()
  }
  expect(scratchStatus()).toBe(before)
})

test('captureScreenshot and the contact sheet: no pixel with alpha below 255 in either theme, so nothing behind the picture shows through the sidebar (worfy-evidence ticket 13)', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  const launched = await launchApp(fixtureProject())
  try {
    const { window, app } = launched
    await canvasReady(launched, { visible: [window.locator(CARD)], size: SIZE })
    // The helper's own reading of a PNG is Electron's on a screenshot as Chromium writes it: on macOS one
    // with the translucent sidebar, elsewhere an opaque one.
    const raw = await window.screenshot()
    const asIs = await decoded(app, raw)
    expect(asIs.pixels).toBeGreaterThan(0)
    expect(asIs.differ, 'pixels whose alpha pngPixels reads otherwise than Electron').toBe(0)
    for (const file of await captureScreenshot(window, 'opaque')) {
      const seen = await decoded(app, readFileSync(file))
      expect(seen.pixels).toBeGreaterThan(0)
      expect(seen.translucent, `${file}: pixels with alpha below 255 (the lowest ${seen.lowest})`).toBe(0)
      expect(seen.differ).toBe(0)
    }

    // A frame of a clip is laid over the background of the theme it was taken in, not over the white of
    // the sheet: a frame with nothing opaque on it shows that background whole.
    const clear = rgbaPng(4, 4, Array.from({ length: 16 }, () => [255, 255, 255, 0]))
    const sheetDir = join(scratch, 'sheet')
    mkdirSync(sheetDir)
    const sheet = await contactSheet(
      app,
      [
        { second: 0, png: clear, theme: 'dark' },
        { second: 1, png: clear, theme: 'light' },
      ],
      sheetDir,
    )
    const read = pngPixels(sheet)
    const at = (x: number, y: number): string => '#' + [...read.rgba.subarray((y * read.width + x) * 4, (y * read.width + x) * 4 + 3)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const layout = sheetLayout(2, { width: 4, height: 4 })
    const second = SHEET_GAP + (layout.columns > 1 ? 4 + SHEET_GAP : 0)
    const secondY = SHEET_GAP + (layout.columns > 1 ? 0 : 4 + SHEET_CAPTION + SHEET_GAP)
    expect(at(SHEET_GAP + 1, SHEET_GAP + 1)).toBe(WINDOW_BACKGROUND.dark)
    expect(at(second + 1, secondY + 1)).toBe(WINDOW_BACKGROUND.light)
    const sheetSeen = await decoded(app, sheet)
    expect(sheetSeen.translucent).toBe(0)
  } finally {
    await launched.close()
  }
})

test('recordClip: a Ticket in focus mode and a card dragged with its Epic frame make a webm under 60 s and 8 MB with a frame a second on its sheet, and both pass evidence-check with a video line', async () => {
  test.setTimeout(ms(180_000))
  const before = scratchStatus()
  let moved = { x: 0, y: 0 }
  let inner = { width: 0, height: 0 }
  const recorded = await recordClip(
    'card-drag',
    async (launched) => {
      const { window } = launched
      const card = window.locator(CARD)
      await canvasReady(launched, { visible: [card], size: SIZE })
      inner = await innerSize(window)
      await card.dblclick()
      await expect(window.getByTestId('focus-mode')).toBeVisible()
      await window.waitForTimeout(800)
      await window.keyboard.press('Escape')
      await expect(window.getByTestId('focus-mode')).toHaveCount(0)
      // A Ticket card is not draggable on its own: it moves with its Epic frame, dragged by the frame's tag.
      const from = await card.boundingBox()
      const handle = await window.getByTestId(`rf__node-epic:${EPIC}`).locator('.w-epic__drag .w-epic__tag').boundingBox()
      if (from === null || handle === null) throw new Error('the card or the tag of its Epic frame has no box')
      const x = handle.x + 5
      const y = handle.y + 5
      await window.mouse.move(x, y)
      await window.mouse.down()
      for (let step = 1; step <= 20; step++) {
        await window.mouse.move(x + step * 12, y + step * 6)
        await window.waitForTimeout(60)
      }
      await window.mouse.up()
      const to = await card.boundingBox()
      if (to === null) throw new Error('the card has no box after the drag')
      moved = { x: to.x - from.x, y: to.y - from.y }
      await window.waitForTimeout(800)
    },
    { launch: fixtureProject() },
  )
  expect(moved.x).toBeGreaterThan(100)

  const prefix = EVIDENCE_RUN ? `${process.env.WORFY_EVIDENCE?.split('/')[1]}-` : ''
  if (!EVIDENCE_RUN) {
    expect(recorded.clip).toBe(test.info().outputPath('card-drag.webm'))
    expect(recorded.sheet).toBe(test.info().outputPath('card-drag.sheet.png'))
  }
  expect(recorded.clip.endsWith(`${prefix}card-drag.webm`)).toBe(true)
  expect(recorded.sheet.endsWith(`${prefix}card-drag.sheet.png`)).toBe(true)
  // A frame for each second of the scenario, from second 0.
  expect(Math.abs(recorded.frames - recorded.seconds)).toBeLessThanOrEqual(1)
  expect(recorded.seconds).toBeLessThan(CLIP_MAX_SECONDS)
  const clip = readFileSync(recorded.clip)
  expect(clip.subarray(0, 4).toString('hex')).toBe('1a45dfa3')
  expect(statSync(recorded.clip).size).toBeLessThan(CLIP_MAX_BYTES)
  const sheet = readFileSync(recorded.sheet)
  // Each frame at the window's own size (CSS pixels), not scaled down.
  expect(recorded.frame).toEqual(inner)
  const layout = sheetLayout(recorded.frames, inner)
  expect(pngSize(sheet)).toEqual({ width: layout.width, height: layout.height })

  // The privacy check of a branch: the clip and its sheet in the tickets root of a repository need a
  // video line with scrub:, and with it they pass.
  const repo = join(scratch, 'repo')
  const evidence = join(repo, '.scratch', 'demo', 'evidence')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(evidence, { recursive: true })
  mkdirSync(issues, { recursive: true })
  const ticket = join(issues, '11-demo.md')
  writeFileSync(ticket, '# 11 — Demo\n\n- [ ] (manual) The card follows the pointer.\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  copyFileSync(recorded.clip, join(evidence, '11-card-drag.webm'))
  copyFileSync(recorded.sheet, join(evidence, '11-card-drag.sheet.png'))
  const unmarked = evidenceCheckChanged(repo, 'HEAD')
  expect(unmarked.output).toContain('video needs a human check (no scrub: note)')
  expect(unmarked.status, unmarked.output).toBe(1)
  writeFileSync(ticket, `${readFileSync(ticket, 'utf8')}  - evidence: video pass · \`../evidence/11-card-drag.webm\` · mac dev · 0000000 · scrub: 2026-11-04\n`)
  const marked = evidenceCheckChanged(repo, 'HEAD')
  expect(marked.output).toContain('evidence-check: ok (')
  expect(marked.status, marked.output).toBe(0)

  if (!EVIDENCE_RUN) expect(scratchStatus()).toBe(before)
})

test('recordClip: a scenario that is over at once still has the frame of second 0 on its sheet, in .scratch/<epic>/evidence/ of the root given', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  mkdirSync(join(scratch, '.scratch', 'demo'), { recursive: true })
  const recorded = await recordClip('instant', async () => undefined, { evidence: 'demo/11', root: scratch })
  const evidence = join(scratch, '.scratch', 'demo', 'evidence')
  expect(recorded.clip).toBe(join(evidence, '11-instant.webm'))
  expect(recorded.sheet).toBe(join(evidence, '11-instant.sheet.png'))
  expect(recorded.frames).toBe(1)
  expect(pngSize(readFileSync(recorded.sheet)).width).toBe(SHEET_GAP + recorded.frame.width + SHEET_GAP)
  expect(existsSync(recorded.clip)).toBe(true)
})

test('recordClip: a frame of the sheet that cannot be taken is an error, and no clip is kept', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  await expect(
    recordClip('no-window', async ({ app }) => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy())
      await new Promise((done) => setTimeout(done, 2_000))
    }),
  ).rejects.toThrow(/a frame of the contact sheet failed/)
  expect(filesOf('no-window')).toEqual([])
})

test('recordClip: a frame that never comes back once the window is gone is the same error within seconds, and the app is ended', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  const seen: { child?: ChildProcess } = {}
  const started = Date.now()
  await expect(
    recordClip('frame-hangs', async (launched) => {
      // What macOS CI showed (worfy-polish ticket 60): the screenshot of a window destroyed meanwhile
      // never settled, its own timeout notwithstanding, so Playwright had not seen the page close either:
      // only main can tell. And a quit that never ends: the helper must kill the app.
      launched.window.screenshot = () => new Promise<Buffer>(() => undefined)
      Object.assign(launched.window, { once: () => launched.window })
      launched.app.close = () => new Promise<void>(() => undefined)
      seen.child = launched.app.process()
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy())
      await new Promise((done) => setTimeout(done, 2_000))
    }),
  ).rejects.toThrow(/a frame of the contact sheet failed: Error: the window was destroyed/)
  expect(Date.now() - started).toBeLessThan(ms(20_000))
  const { child } = seen
  if (child === undefined) throw new Error('the scenario never ran')
  expect(child.exitCode !== null || child.signalCode !== null, 'the app process has ended').toBe(true)
  expect(filesOf('frame-hangs')).toEqual([])
})

test('recordClip: a frame that never comes back from a window that is still there is the same error at the frame bound, and the app quits', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  const seen: { child?: ChildProcess } = {}
  const started = Date.now()
  await expect(
    recordClip('frame-stuck', async (launched) => {
      // Main says the window is alive, and the frames (CSS pixels) never come back: only the helper's own
      // bound ends the wait. The screenshot of the failure attachment (no scale) is left as it is.
      const screenshot = launched.window.screenshot.bind(launched.window)
      launched.window.screenshot = (options) => (options?.scale === 'css' ? new Promise<Buffer>(() => undefined) : screenshot(options))
      seen.child = launched.app.process()
      await new Promise((done) => setTimeout(done, 1_000))
    }),
  ).rejects.toThrow(/a frame of the contact sheet failed: Error: the screenshot did not finish within/)
  // The frame bound (6 s) and a quit, both times the scale: not the test's timeout.
  expect(Date.now() - started).toBeLessThan(ms(15_000))
  const { child } = seen
  if (child === undefined) throw new Error('the scenario never ran')
  expect(child.exitCode !== null || child.signalCode !== null, 'the app process has ended').toBe(true)
  expect(filesOf('frame-stuck')).toEqual([])
})

test('recordClip: a scenario over the limit is an error, and no clip is kept', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  await expect(
    recordClip('too-long', async ({ window }) => {
      await window.waitForTimeout(4_000)
    }, { limits: { seconds: 2 } }),
  ).rejects.toThrow(/the scenario ran longer than 2 s, the limit of a clip: no clip is kept/)
  expect(filesOf('too-long')).toEqual([])
})

test('recordClip: a clip over the size limit is an error with advice, and no clip is kept', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  await expect(
    recordClip('too-big', async ({ window }) => {
      await window.waitForTimeout(1_500)
    }, { limits: { bytes: 1024 } }),
  ).rejects.toThrow(/bytes, over the limit of 1024 bytes: give a smaller options\.size or a shorter scenario/)
  expect(filesOf('too-big')).toEqual([])
})

test('recordClip: a scenario that fails is the error, and no clip is kept', async () => {
  test.skip(EVIDENCE_RUN, 'a WORFY_EVIDENCE run records only the clips of the Ticket')
  await expect(
    recordClip('broken', async () => {
      throw new Error('the scenario broke')
    }),
  ).rejects.toThrow('the scenario broke')
  expect(filesOf('broken')).toEqual([])
})
