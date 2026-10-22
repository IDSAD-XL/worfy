// How the Browser layer e2e test (test/e2e/browser-layer.spec.ts) reads the edges of the fixture page
// against the edges of the frame on a capture of the window: edgeErrors, test/e2e/browser-pixels.ts.
// The captures here are drawn, with the geometry of that test: a window of 1400 × 900 CSS px, which
// a display of scale 1.5 (Windows at 150 %) or 2 (a Retina Mac) captures as 1400 × 900 times the
// scale in device px, and a page of 638 × 410 CSS px scaled by the Canvas's zoom.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { edgeBound, edgeErrors, pagePixelsOutside, type Box, type Edge, type Image } from '../e2e/browser-pixels'

const WINDOW = { width: 1400, height: 900 }
/** The page's viewport in its own CSS px, as the e2e test reports it (`guestViewport`). */
const PAGE = { width: 638, height: 410 }
/** The width, in the page's CSS px, of the classic (not overlaid) scrollbar Chromium draws on Windows. */
const WINDOWS_SCROLLBAR = 15

type Rgb = readonly [number, number, number]
const CANVAS: Rgb = [0x1e, 0x1e, 0x1e]
const OUTLINE: Rgb = [0x00, 0xff, 0x00]
const CREAM: Rgb = [0xfd, 0xf6, 0xe3]
const LINE: Rgb = [0xff, 0x00, 0xff]
const TRACK: Rgb = [0xf1, 0xf1, 0xf1]
/** How far, per channel, the drawn cream strays from #fdf6e3: inside the measure's tolerance for the page's cream. */
const CREAM_NOISE = 4

/** A fixed offset in -`amplitude`..`amplitude` for channel `c` of the device pixel (x, y): the same on every run. */
const noiseAt = (x: number, y: number, c: number, amplitude: number): number =>
  amplitude === 0 ? 0 : (((x * 73856093) ^ (y * 19349663) ^ (c * 83492791)) >>> 0) % (2 * amplitude + 1) - amplitude

/**
 * Paints `box` (CSS px) in `color` over the image, each device pixel blended by how much of it the
 * box covers, and its colour off by up to `noise` per channel, as a real capture's colours are.
 */
function paint(image: Image, scale: number, box: Box, color: Rgb, noise = 0): void {
  const [left, right, top, bottom] = [box.x * scale, (box.x + box.width) * scale, box.y * scale, (box.y + box.height) * scale]
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(image.height, Math.ceil(bottom)); y += 1) {
    const cy = Math.min(bottom, y + 1) - Math.max(top, y)
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(image.width, Math.ceil(right)); x += 1) {
      const cover = cy * (Math.min(right, x + 1) - Math.max(left, x))
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c += 1) {
        const value = color[c]! + noiseAt(x, y, c, noise)
        image.data[i + c] = Math.max(0, Math.min(255, Math.round(value * cover + image.data[i + c]! * (1 - cover))))
      }
    }
  }
}

/**
 * A capture of the window at `scale` with the frame's body at `body` (CSS px) and the page in it at
 * `zoom`, as the e2e test draws it: the green outline one line (`zoom` CSS px) outside the body,
 * the page's cream, a scrollbar of `scrollbar` page CSS px at its right, and the page's magenta
 * line (`position: fixed; inset: 0`), which stops at the scrollbar; without `line`, no magenta line,
 * as a minified page loses it on a real capture (zoom 0.25), so the edge is read from the cream alone.
 */
function capture(scale: number, body: Box, zoom: number, scrollbar: number, line = true): Image {
  const image: Image = { width: WINDOW.width * scale, height: WINDOW.height * scale, data: new Uint8Array(WINDOW.width * scale * WINDOW.height * scale * 4).fill(255) }
  paint(image, scale, { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }, CANVAS)
  paint(image, scale, { x: body.x - zoom, y: body.y - zoom, width: body.width + 2 * zoom, height: body.height + 2 * zoom }, OUTLINE)
  paint(image, scale, body, CREAM, CREAM_NOISE)
  const bar = scrollbar * zoom
  if (bar > 0) paint(image, scale, { x: body.x + body.width - bar, y: body.y, width: bar, height: body.height }, TRACK)
  const inner = { ...body, width: body.width - bar }
  if (!line) return image
  paint(image, scale, { ...inner, width: zoom }, LINE)
  paint(image, scale, { ...inner, x: inner.x + inner.width - zoom, width: zoom }, LINE)
  paint(image, scale, { ...inner, height: zoom }, LINE)
  paint(image, scale, { ...inner, y: inner.y + inner.height - zoom, height: zoom }, LINE)
  return image
}

/**
 * The zooms of the e2e test; at 2 the frame runs past the window's bottom, so only its right and top
 * edges are read. Zoom 0.25 and scale 1 are not drawn. There the outline and the page's line are under one device pixel, and what the capture shows
 * depends on how Chromium rasterises them, which `paint` does not model:
 * shortcut: no zoom 0.25 and no scale 1, redo when a real capture at those settings is at hand to model.
 */
const ZOOMS: readonly { zoom: number; edges: readonly Edge[] }[] = [
  { zoom: 0.5, edges: ['left', 'right', 'top', 'bottom'] },
  { zoom: 1, edges: ['left', 'right', 'top', 'bottom'] },
  { zoom: 2, edges: ['right', 'top'] },
]

/** The frame's body at `zoom`, its right edge 80.3 CSS px from the window's and its top 420.3 from the top: not on whole pixels, as on a real Canvas, and low enough that a row read in CSS px instead of device px misses the page. */
const bodyAt = (zoom: number): Box => ({ x: WINDOW.width - 80.3 - PAGE.width * zoom, y: 420.3, width: PAGE.width * zoom, height: PAGE.height * zoom })

/** What edgeErrors reads on a capture at `scale`, the scale computed the way the e2e test does: capture width over window width. */
function measure(scale: number, zoom: number, edges: readonly Edge[], scrollbar: number, line = true): Record<Edge, number> {
  const image = capture(scale, bodyAt(zoom), zoom, scrollbar, line)
  expect([image.width, image.height]).toEqual([WINDOW.width * scale, WINDOW.height * scale])
  return edgeErrors(image, image.width / WINDOW.width, bodyAt(zoom), zoom, edges)
}

describe('the edges of the fixture page against its frame on a capture (edgeErrors)', () => {
  for (const scale of [1.5, 2]) {
    for (const { zoom, edges } of ZOOMS) {
      // Drawn exactly, the page is on the frame's edge: the e2e test's 1 px bound is for real
      // captures, here the reading must be within one device pixel.
      it(`a page without a scrollbar sits in its frame within one device pixel on every edge read, at scale ${scale} and zoom ${zoom}`, () => {
        const errors = measure(scale, zoom, edges, 0)
        for (const edge of edges) expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(1 / scale)
      })

      it(`a page that lost its magenta line is read from its cream within 1 px, at scale ${scale} and zoom ${zoom}`, () => {
        // Without the line, the pixel blended at the border is neither cream nor magenta, so the
        // reading may be off by up to one more device pixel: the e2e test's own 1 px bound.
        const errors = measure(scale, zoom, edges, 0, false)
        for (const edge of edges) expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(1)
      })
    }
  }

  // The failure of the e2e test on Windows at 150 % (worfy-windows ticket 97): left, top and bottom
  // within 1 px, the right edge not found at zooms 0.5, 1 and 2 (and 3.65 px off at 0.25, about the
  // scrollbar's 15 px times 0.25).
  for (const { zoom, edges } of ZOOMS) {
    it(`Windows' scrollbar at the page's right hides its right edge, and only that one, at scale 1.5 and zoom ${zoom}`, () => {
      const errors = measure(1.5, zoom, edges, WINDOWS_SCROLLBAR)
      for (const edge of edges.filter((edge) => edge !== 'right')) expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(1 / 1.5)
      // Off by more than the e2e test's bound: not found (Infinity), or found past the scrollbar.
      expect(errors.right).toBeGreaterThan(1)
    })
  }
})

describe('the fixture page (test/fixtures/browser/page.html)', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'browser', 'page.html'), 'utf8')

  it('draws no scrollbar of its own, so its right edge is its own on every system', () => {
    expect(html).toMatch(/\bhtml\s*\{[^}]*scrollbar-width:\s*none/)
  })

  it('still scrolls: it is taller than any frame', () => {
    expect(html).toMatch(/\.tall\s*\{[^}]*height:\s*2400px/)
    expect(html).toContain('<div class="tall"></div>')
  })
})

/** An image of `width` × `height` device px of the Canvas's dark grey, with `cream` device pixels painted cream. */
function blank(width: number, height: number, cream: readonly (readonly [number, number])[] = []): Image {
  const image: Image = { width, height, data: new Uint8Array(width * height * 4) }
  for (let i = 0; i < width * height; i += 1) image.data.set([...CANVAS, 255], i * 4)
  for (const [x, y] of cream) image.data.set([...CREAM, 255], (y * width + x) * 4)
  return image
}
const block = (x0: number, y0: number, size: number): [number, number][] =>
  Array.from({ length: size * size }, (_, i) => [x0 + (i % size), y0 + Math.floor(i / size)])
/** A frame's body at the image's far corner, so the whole rest of the image is outside it. */
const FAR: Box = { x: 30, y: 30, width: 1, height: 1 }

describe('page pixels outside the frame, counted in 3 x 3 blocks (pagePixelsOutside)', () => {
  it('a lone cream pixel, a ClearType fringe on the app\'s text, is not the page', () => {
    expect(pagePixelsOutside(blank(20, 20, [[10, 10]]), 1, FAR)).toBe(0)
  })

  it('a stroke of cream two pixels wide is not the page either', () => {
    const stroke = Array.from({ length: 10 }, (_, i): [number, number] => [5 + (i % 2), 5 + Math.floor(i / 2)])
    expect(pagePixelsOutside(blank(20, 20, stroke), 1, FAR)).toBe(0)
  })

  it('a 3 x 3 block of cream counts its centre, a 5 x 5 block its inner 3 x 3', () => {
    expect(pagePixelsOutside(blank(20, 20, block(5, 5, 3)), 1, FAR)).toBe(1)
    expect(pagePixelsOutside(blank(20, 20, block(5, 5, 5)), 1, FAR)).toBe(9)
  })

  it('a block of the magenta line and the cream next to it counts as the page', () => {
    const image = blank(20, 20, block(5, 5, 3))
    image.data.set([...LINE, 255], (5 * 20 + 5) * 4)
    expect(pagePixelsOutside(image, 1, FAR)).toBe(1)
  })

  it('at the image\'s edge only the neighbours inside the image are checked: a leak cut by the window\'s edge still counts', () => {
    expect(pagePixelsOutside(blank(20, 20, [[0, 0]]), 1, FAR)).toBe(0)
    expect(pagePixelsOutside(blank(20, 20, block(9, 9, 2)), 1, FAR)).toBe(0)
    expect(pagePixelsOutside(blank(20, 20, block(0, 0, 2)), 1, FAR)).toBe(1)
    expect(pagePixelsOutside(blank(20, 20, block(18, 18, 2)), 1, FAR)).toBe(1)
  })

  it('the page inside the frame\'s body, widened by one device pixel, is not counted', () => {
    const image = blank(20, 20, block(4, 4, 8))
    expect(pagePixelsOutside(image, 1, { x: 5, y: 5, width: 6, height: 6 })).toBe(0)
    expect(pagePixelsOutside(image, 1, { x: 7, y: 7, width: 2, height: 2 })).toBe(6 * 6 - 4 * 4)
  })
})

describe('the bound on edgeErrors (edgeBound)', () => {
  it('is 1 px at a whole device scale and 1.5 px at a fractional one', () => {
    expect(edgeBound(1)).toBe(1)
    expect(edgeBound(2)).toBe(1)
    expect(edgeBound(2100 / 1400)).toBe(1.5)
    expect(edgeBound(1.25)).toBe(1.5)
  })
})
