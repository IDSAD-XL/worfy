// The pixel measures of the Browser layer e2e test (test/e2e/browser-layer.spec.ts): a PNG decoder
// and the reading of where the fixture page's edges are against the frame's on a capture of the
// window. Pure functions over decoded pixels, so test/unit/e2e-browser-pixels.test.ts checks them on
// drawn images, without a window.
import { inflateSync } from 'node:zlib'


export interface Image {
  width: number
  height: number
  /** RGBA, row by row. */
  data: Uint8Array
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG, the kind Chromium writes (PNG spec, sections 7 and 9). */
export function decodePng(png: Buffer): Image {
  let width = 0
  let height = 0
  let channels = 0
  const chunks: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]]
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, colour type ${color}, interlace ${interlace}`)
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') chunks.push(data)
    else if (type === 'IEND') break
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  let current = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels]! : 0
      const b = previous[i]!
      const c = i >= channels ? previous[i - channels]! : 0
      let value = line[i]!
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      current[i] = value & 255
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4
      out[to] = current[x * channels]!
      out[to + 1] = current[x * channels + 1]!
      out[to + 2] = current[x * channels + 2]!
      out[to + 3] = channels === 4 ? current[x * channels + 3]! : 255
    }
    ;[previous, current] = [current, previous]
  }
  return { width, height, data: out }
}

export type Weight = (r: number, g: number, b: number) => number
/** How much a pixel is the fixture page's magenta edge line. */
export const MAGENTA: Weight = (r, g, b) => Math.max(0, Math.min(r, b) - g - 20)
/** How much a pixel is the green outline the test puts around the frame's body. */
export const GREEN: Weight = (r, g, b) => Math.max(0, g - Math.max(r, b) - 20)
/** Whether a pixel is the fixture page's cream background (#fdf6e3). */
export const isCream = (r: number, g: number, b: number): boolean => Math.abs(r - 0xfd) <= 3 && Math.abs(g - 0xf6) <= 3 && Math.abs(b - 0xe3) <= 3

/** The weighted centre, in device pixels, of the pixels along one row (`axis` 'x') or one column ('y') between `from` and `to`; null when there are none. */
export function centroid(image: Image, axis: 'x' | 'y', fixed: number, from: number, to: number, weight: Weight): number | null {
  let sum = 0
  let total = 0
  for (let at = Math.max(0, Math.floor(from)); at <= Math.min((axis === 'x' ? image.width : image.height) - 1, Math.ceil(to)); at += 1) {
    const [x, y] = axis === 'x' ? [at, Math.round(fixed)] : [Math.round(fixed), at]
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
    const i = (y * image.width + x) * 4
    const w = weight(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)
    sum += w * at
    total += w
  }
  return total === 0 ? null : sum / total
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type Edge = 'left' | 'right' | 'top' | 'bottom'

/** Whether a pixel is the page's own: its cream, or its magenta edge line, also blended with what is next to it. */
export const isPage = (r: number, g: number, b: number): boolean =>
  (Math.abs(r - 0xfd) <= 6 && Math.abs(g - 0xf6) <= 6 && Math.abs(b - 0xe3) <= 6) || MAGENTA(r, g, b) > 40

/**
 * How far, in CSS pixels, the page's own edge is from the frame's edge on each `edges` side of
 * `body` (the frame's body in CSS pixels at the time of the capture), along the row or column
 * through the middle of the body. The frame's edge: the centre of the green outline the test puts
 * just outside the body, one line (`zoom` CSS px) wide, so the body's edge is half a line inward of
 * it. The page's edge: the outermost pixel of the page (cream or magenta), found from outside in.
 * 0 when the page sits exactly in the body; a pixel blended at the border counts as up to one device
 * pixel. The page's own magenta line is not used for the position: at zoom 0.25 the minified page
 * loses its last row and column of pixels, line and all. An edge where the outline or the page is
 * not found counts as Infinity.
 */
export function edgeErrors(image: Image, scale: number, body: Box, zoom: number, edges: readonly Edge[]): Record<Edge, number> {
  const reach = (6 * zoom + 3) * scale
  const mid = { x: (body.x + body.width / 2) * scale, y: (body.y + body.height / 2) * scale }
  const result = {} as Record<Edge, number>
  for (const edge of edges) {
    const vertical = edge === 'left' || edge === 'right'
    const outward = edge === 'left' || edge === 'top' ? -1 : 1
    const at = (edge === 'left' ? body.x : edge === 'right' ? body.x + body.width : edge === 'top' ? body.y : body.y + body.height) * scale
    const axis = vertical ? 'x' : 'y'
    const fixed = Math.round(vertical ? mid.y : mid.x)
    const green = centroid(image, axis, fixed, at - reach, at + reach, GREEN)
    let pageEdge: number | null = null
    // From outside in: the first pixel of the page; its outer side is the page's edge.
    for (let step = Math.ceil(reach); step >= -Math.ceil(reach) && pageEdge === null; step -= 1) {
      const index = Math.floor(at) + outward * step
      const [x, y] = vertical ? [index, fixed] : [fixed, index]
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const i = (y * image.width + x) * 4
      if (isPage(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)) pageEdge = outward < 0 ? index : index + 1
    }
    if (green === null || pageEdge === null) {
      result[edge] = Number.POSITIVE_INFINITY
      continue
    }
    // The green centre is half a line outside the body's edge; the page's edge should be on the body's edge.
    const greenCentre = green + 0.5
    result[edge] = Math.abs((outward * (greenCentre - pageEdge)) / scale - zoom / 2)
  }
  return result
}

/** Pixels of the page (its cream or its magenta line) outside `inside` (CSS px, widened by one device pixel). */
export function pagePixelsOutside(image: Image, scale: number, inside: Box): number {
  const left = inside.x * scale - 1
  const right = (inside.x + inside.width) * scale + 1
  const top = inside.y * scale - 1
  const bottom = (inside.y + inside.height) * scale + 1
  let count = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x >= left && x < right && y >= top && y < bottom) continue
      const i = (y * image.width + x) * 4
      const [r, g, b] = [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]
      if (isCream(r, g, b) || MAGENTA(r, g, b) > 60) count += 1
    }
  }
  return count
}

/**
 * Pixels of the page's cream inside `box` (CSS px), shrunk by `inset` CSS px: the rounded corners
 * of a Node or a menu leave the page visible in the corners of their bounding box.
 */
export function creamInside(image: Image, scale: number, box: Box, inset: number): number {
  let count = 0
  const pad = Math.ceil(inset * scale)
  for (let y = Math.ceil(box.y * scale) + pad; y < Math.floor((box.y + box.height) * scale) - pad; y += 1) {
    for (let x = Math.ceil(box.x * scale) + pad; x < Math.floor((box.x + box.width) * scale) - pad; x += 1) {
      const i = (y * image.width + x) * 4
      if (isCream(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)) count += 1
    }
  }
  return count
}

