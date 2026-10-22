// How the Browser layer e2e test (test/e2e/browser-layer.spec.ts) reads the edges of the fixture page
// against the edges of the frame on a capture of the window: edgeErrors, test/e2e/browser-pixels.ts.
// The captures here are drawn, with the geometry of that test: a window of 1400 × 900 CSS px, which
// a display of scale 1.5 (Windows at 150 %) or 2 (a Retina Mac) captures as 1400 × 900 times the
// scale in device px, and a page of 638 × 410 CSS px scaled by the Canvas's zoom.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { edgeErrors, type Box, type Edge, type Image } from '../e2e/browser-pixels'

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

/** Paints `box` (CSS px) in `color` over the image, each device pixel blended by how much of it the box covers. */
function paint(image: Image, scale: number, box: Box, color: Rgb): void {
  const [left, right, top, bottom] = [box.x * scale, (box.x + box.width) * scale, box.y * scale, (box.y + box.height) * scale]
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(image.height, Math.ceil(bottom)); y += 1) {
    const cy = Math.min(bottom, y + 1) - Math.max(top, y)
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(image.width, Math.ceil(right)); x += 1) {
      const cover = cy * (Math.min(right, x + 1) - Math.max(left, x))
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c += 1) image.data[i + c] = Math.round(color[c]! * cover + image.data[i + c]! * (1 - cover))
    }
  }
}

/**
 * A capture of the window at `scale` with the frame's body at `body` (CSS px) and the page in it at
 * `zoom`, as the e2e test draws it: the green outline one line (`zoom` CSS px) outside the body,
 * the page's cream, a scrollbar of `scrollbar` page CSS px at its right, and the page's magenta
 * line (`position: fixed; inset: 0`), which stops at the scrollbar.
 */
function capture(scale: number, body: Box, zoom: number, scrollbar: number): Image {
  const image: Image = { width: WINDOW.width * scale, height: WINDOW.height * scale, data: new Uint8Array(WINDOW.width * scale * WINDOW.height * scale * 4).fill(255) }
  paint(image, scale, { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }, CANVAS)
  paint(image, scale, { x: body.x - zoom, y: body.y - zoom, width: body.width + 2 * zoom, height: body.height + 2 * zoom }, OUTLINE)
  paint(image, scale, body, CREAM)
  const bar = scrollbar * zoom
  if (bar > 0) paint(image, scale, { x: body.x + body.width - bar, y: body.y, width: bar, height: body.height }, TRACK)
  const inner = { ...body, width: body.width - bar }
  paint(image, scale, { ...inner, width: zoom }, LINE)
  paint(image, scale, { ...inner, x: inner.x + inner.width - zoom, width: zoom }, LINE)
  paint(image, scale, { ...inner, height: zoom }, LINE)
  paint(image, scale, { ...inner, y: inner.y + inner.height - zoom, height: zoom }, LINE)
  return image
}

/**
 * The zooms of the e2e test; at 2 the frame runs past the window's bottom, so only its right and top
 * edges are read.
 * shortcut: no zoom 0.25 and no scale 1: there the outline and the page's line are under one device
 * pixel, and what the capture shows depends on how Chromium rasterises them, which `paint` does not
 * model; redo when a capture of the real window at those settings is at hand to model them on.
 */
const ZOOMS: readonly { zoom: number; edges: readonly Edge[] }[] = [
  { zoom: 0.5, edges: ['left', 'right', 'top', 'bottom'] },
  { zoom: 1, edges: ['left', 'right', 'top', 'bottom'] },
  { zoom: 2, edges: ['right', 'top'] },
]

/** The frame's body at `zoom`, its right edge 80.3 CSS px from the window's and its top 420.3 from the top: not on whole pixels, as on a real Canvas, and low enough that a row read in CSS px instead of device px misses the page. */
const bodyAt = (zoom: number): Box => ({ x: WINDOW.width - 80.3 - PAGE.width * zoom, y: 420.3, width: PAGE.width * zoom, height: PAGE.height * zoom })

/** What edgeErrors reads on a capture at `scale`, the scale computed the way the e2e test does: capture width over window width. */
function measure(scale: number, zoom: number, edges: readonly Edge[], scrollbar: number): Record<Edge, number> {
  const image = capture(scale, bodyAt(zoom), zoom, scrollbar)
  expect([image.width, image.height]).toEqual([WINDOW.width * scale, WINDOW.height * scale])
  return edgeErrors(image, image.width / WINDOW.width, bodyAt(zoom), zoom, edges)
}

describe('the edges of the fixture page against its frame on a capture (edgeErrors)', () => {
  for (const scale of [1.5, 2]) {
    for (const { zoom, edges } of ZOOMS) {
      it(`a page without a scrollbar sits in its frame within 1 px on every edge read, at scale ${scale} and zoom ${zoom}`, () => {
        const errors = measure(scale, zoom, edges, 0)
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
      for (const edge of edges.filter((edge) => edge !== 'right')) expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(1)
      expect(errors.right).toBe(Number.POSITIVE_INFINITY)
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
