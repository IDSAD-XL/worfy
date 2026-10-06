import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

/** RGBA of one pixel, read from an 8-bit, non-interlaced RGB or RGBA PNG, the kind Chromium writes. */
function pixelOf(file: string, x: number, y: number): number[] {
  const png = readFileSync(file)
  const chunks: Buffer[] = []
  let width = 0
  let channels = 0
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      expect([data[8], data[12]], 'bit depth 8, not interlaced').toEqual([8, 0])
      channels = data[9] === 6 ? 4 : 3
    }
    if (type === 'IDAT') chunks.push(data)
    at += 12 + length
  }
  // Undo the per-row filters (PNG spec, section 9) down to row y; each row depends on the one above.
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  let above = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let r = 0; r <= y; r++) {
    const filter = raw[r * (stride + 1)]
    const line = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1))
    row = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (row[i - channels] as number) : 0
      const b = above[i] as number
      const c = i >= channels ? (above[i - channels] as number) : 0
      const p = a + b - c
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter as number] as number
      row[i] = ((line[i] as number) + predicted) & 0xff
    }
    above = row
  }
  const pixel = Array.from(row.subarray(x * channels, x * channels + channels))
  return channels === 4 ? pixel : [...pixel, 255]
}

/** Perceived lightness of an RGBA pixel, 0 (black) to 255 (white). */
const lightness = ([r, g, b]: number[]): number => 0.299 * (r as number) + 0.587 * (g as number) + 0.114 * (b as number)

interface PageGlobals {
  devicePixelRatio: number
  matchMedia: (query: string) => { matches: boolean }
}

let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await launched.close()
})

test('one call of the snapshot helper writes a light and a dark PNG of the window, and they differ', async () => {
  const { app, window } = launched
  const sidebar = window.locator('.w-sidebar')
  await expect(sidebar).toBeVisible()

  const shots = await snapshotThemes(window, 'snapshot-helper')

  const folder = join(test.info().project.outputDir, 'snapshots', 'snapshot-helper')
  expect(shots).toEqual({ light: join(folder, 'light.png'), dark: join(folder, 'dark.png') })
  expect(existsSync(shots.light)).toBe(true)
  expect(existsSync(shots.dark)).toBe(true)
  expect(readFileSync(shots.light).equals(readFileSync(shots.dark))).toBe(false)

  // The sidebar is translucent over the window's native vibrancy, which a page screenshot does not
  // contain. In each PNG it must be opaque and in its theme's colours: light in light, dark in dark.
  const box = await sidebar.boundingBox()
  if (!box) throw new Error('the sidebar has no box')
  const scale = await window.evaluate(() => (globalThis as unknown as PageGlobals).devicePixelRatio)
  const x = Math.round((box.x + 8) * scale)
  const y = Math.round((box.y + box.height - 8) * scale)
  const light = pixelOf(shots.light, x, y)
  const dark = pixelOf(shots.dark, x, y)
  expect(light[3], 'sidebar alpha in the light PNG').toBe(255)
  expect(dark[3], 'sidebar alpha in the dark PNG').toBe(255)
  expect(lightness(light)).toBeGreaterThan(200)
  expect(lightness(dark)).toBeLessThan(60)

  // Afterwards the page follows the app's theme again, as it did before the call: switched to light
  // (the helper's last shot is dark, so a leftover emulation would keep the page dark) and back.
  const pageDark = (): Promise<boolean> =>
    window.evaluate(() => (globalThis as unknown as PageGlobals).matchMedia('(prefers-color-scheme: dark)').matches)
  try {
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await expect.poll(pageDark).toBe(false)
  } finally {
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system'
    })
  }
})

test('a snapshot name that is not a single folder name is refused', async () => {
  for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b']) {
    await expect(snapshotThemes(launched.window, name), name).rejects.toThrow(/snapshot name/)
  }
})
