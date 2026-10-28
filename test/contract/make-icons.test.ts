// scripts/make-icons.mjs (`pnpm icons`, ticket 31): renders the iconset of the app icon from
// build/brand/*.svg with sips, packs it into an .icns with iconutil, and writes build/icon.png and
// build/icons.json next to it; and the Windows icon, build/icon.ico, of seven PNGs drawn the same
// way (worfy-windows ticket 12). The committed outputs must match the committed sources: an SVG
// changed without `pnpm icons` turns this test red. The committed icon.ico is read here on any
// system; the script itself runs on macOS only.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'make-icons.mjs')
const BUILD = join(REPO, 'build')
const BRAND = join(BUILD, 'brand')

// The table of the ticket: file of the iconset, its side in px, and the SVG it is drawn from.
const ICONSET = [
  { file: 'icon_16x16.png', px: 16, source: 'mark.svg' },
  { file: 'icon_16x16@2x.png', px: 32, source: 'mark.svg' },
  { file: 'icon_32x32.png', px: 32, source: 'mark.svg' },
  { file: 'icon_32x32@2x.png', px: 64, source: 'icon.svg' },
  { file: 'icon_128x128.png', px: 128, source: 'icon.svg' },
  { file: 'icon_128x128@2x.png', px: 256, source: 'icon.svg' },
  { file: 'icon_256x256.png', px: 256, source: 'icon.svg' },
  { file: 'icon_256x256@2x.png', px: 512, source: 'icon.svg' },
  { file: 'icon_512x512.png', px: 512, source: 'icon.svg' },
  { file: 'icon_512x512@2x.png', px: 1024, source: 'icon.svg' },
] as const

// The sizes of the Windows icon: the mark below 48 px, the full icon from 48 px on.
const ICO = [
  { px: 16, source: 'mark.svg' },
  { px: 24, source: 'mark.svg' },
  { px: 32, source: 'mark.svg' },
  { px: 48, source: 'icon.svg' },
  { px: 64, source: 'icon.svg' },
  { px: 128, source: 'icon.svg' },
  { px: 256, source: 'icon.svg' },
] as const

/** scripts/ico.mjs reads an .ico of PNG entries back, in file order. */
const { readIco } = (await import(pathToFileURL(join(REPO, 'scripts', 'ico.mjs')).href)) as { readIco: (data: Buffer) => { px: number; png: Buffer }[] }

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

interface Manifest {
  sources: Record<string, string>
  outputs: Record<string, string>
  iconset: { file: string; px: number; source: string }[]
  ico: { px: number; source: string }[]
  png: { file: string; px: number; source: string }
}
const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, 'icons.json'), 'utf8')) as Manifest

interface Pixels {
  width: number
  height: number
  /** RGBA, 0–255 each, of the pixel at (x, y). */
  at(x: number, y: number): [number, number, number, number]
}

/** A minimal PNG decoder: 8- or 16-bit RGB or RGBA, not interlaced — what sips and iconutil write. `file` is a path, or the data with its name in `path`. */
function decodePng(file: string | Buffer, path: string = typeof file === 'string' ? file : 'a PNG'): Pixels {
  const data = typeof file === 'string' ? readFileSync(file) : file
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('latin1', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]!
      colorType = body[9]!
      interlace = body[12]!
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    offset += 12 + length
  }
  if (![2, 6].includes(colorType) || ![8, 16].includes(bitDepth) || interlace !== 0) {
    throw new Error(`${path}: unsupported PNG (color type ${colorType}, bit depth ${bitDepth}, interlace ${interlace})`)
  }
  const channels = colorType === 6 ? 4 : 3
  const bpp = (channels * bitDepth) / 8
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[y * stride + i - bpp]! : 0
      const up = y > 0 ? out[(y - 1) * stride + i]! : 0
      const upLeft = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp]! : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      } else if (filter !== 0) throw new Error(`${path}: unknown PNG filter ${filter}`)
      out[y * stride + i] = (line[i]! + predictor) & 0xff
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const base = y * stride + x * bpp
      // A 16-bit sample is big-endian: its first byte is the 8-bit value.
      const step = bitDepth / 8
      const channel = (c: number): number => out[base + c * step]!
      return [channel(0), channel(1), channel(2), channels === 4 ? channel(3) : 255]
    },
  }
}

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(0, 24)
  expect(header.toString('latin1', 12, 16)).toBe('IHDR')
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

/**
 * Which SVG a picture was drawn from. Only icon.svg has the lime satellite on its orbit, at
 * (89.6, 24.8) of the 120-unit mark; mark.svg has the dark squircle there. In both the mark is
 * placed at translate(100,100) scale(6.866667) of a 1024 canvas.
 */
function sourceOf(pixels: Pixels): 'icon.svg' | 'mark.svg' {
  const scale = pixels.width / 1024
  const x = Math.floor((100 + 89.6 * 6.866667) * scale)
  const y = Math.floor((100 + 24.8 * 6.866667) * scale)
  const [, g, b, a] = pixels.at(x, y)
  expect(a).toBe(255)
  // Lime #C8F25A has G − B = 152; the squircle #1B1A18 has 2.
  return g - b > 60 ? 'icon.svg' : 'mark.svg'
}

/**
 * The picture follows the macOS icon grid: a transparent corner and a transparent field at the
 * left edge (the body is 824 of 1024, 100 from each side), an opaque centre.
 */
function expectOnIconGrid(pixels: Pixels): void {
  const field = Math.floor((pixels.width * 100) / 1024 / 2)
  const centre = Math.floor(pixels.width / 2)
  expect(pixels.at(0, 0)[3]).toBe(0)
  expect(pixels.at(field, centre)[3]).toBe(0)
  expect(pixels.at(centre, centre)[3]).toBe(255)
}

function iconsetOf(icns: string, scratch: string, name: string): string {
  const iconset = join(scratch, `${name}.iconset`)
  const result = spawnSync('iconutil', ['-c', 'iconset', icns, '-o', iconset], { encoding: 'utf8' })
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return iconset
}

describe('build/icons.json against the committed sources and outputs', () => {
  const manifest = (): Manifest => readManifest(BUILD)

  it('holds the sha256 of build/brand/icon.svg and build/brand/mark.svg: change an SVG, run `pnpm icons`', () => {
    expect(manifest().sources).toEqual({ 'icon.svg': sha256(join(BRAND, 'icon.svg')), 'mark.svg': sha256(join(BRAND, 'mark.svg')) })
  })

  it('holds the sha256 of build/icon.icns, build/icon.ico and build/icon.png: they come from the script, not by hand', () => {
    expect(manifest().outputs).toEqual({
      'icon.icns': sha256(join(BUILD, 'icon.icns')),
      'icon.ico': sha256(join(BUILD, 'icon.ico')),
      'icon.png': sha256(join(BUILD, 'icon.png')),
    })
  })

  it('lists the ten sizes of the iconset, the seven of icon.ico and the 1024 px icon.png', () => {
    expect(manifest().iconset).toEqual(ICONSET)
    expect(manifest().ico).toEqual(ICO)
    expect(manifest().png).toEqual({ file: 'icon.png', px: 1024, source: 'icon.svg' })
  })
})

// The Windows icon is built on a Mac and committed; the installer is built from it on Windows.
describe('the committed build/icon.ico', () => {
  const entries = (): { px: number; png: Buffer }[] => readIco(readFileSync(join(BUILD, 'icon.ico')))

  it('is an icon file of seven PNGs: 16, 24, 32, 48, 64, 128 and 256 px', () => {
    const data = readFileSync(join(BUILD, 'icon.ico'))
    // ICONDIR: reserved 0, type 1 (an icon), the number of images.
    expect([data.readUInt16LE(0), data.readUInt16LE(2), data.readUInt16LE(4)]).toEqual([0, 1, 7])
    expect(entries().map((entry) => entry.px)).toEqual([16, 24, 32, 48, 64, 128, 256])
  })

  it('draws 16, 24 and 32 px from mark.svg and the larger sizes from icon.svg, each on the icon grid', () => {
    const drawn = entries().map((entry) => {
      const pixels = decodePng(entry.png, `the ${entry.px} px picture of icon.ico`)
      expectOnIconGrid(pixels)
      return { px: pixels.width, source: sourceOf(pixels) }
    })
    expect(drawn).toEqual(ICO)
  })
})

// The script draws with sips and packs with iconutil, programs of macOS: Windows and Linux have
// neither, so `pnpm icons` is run on a Mac and its outputs are committed. What it committed —
// icons.json and icon.ico — is checked above on every system. The Mac runs this in every gate.
describe.skipIf(process.platform !== 'darwin')('scripts/make-icons.mjs (macOS only: sips and iconutil)', () => {
  let scratch: string
  let out: string
  /** The temporary folder of the script's run: it makes the folder it renders in there. */
  let temporary: string
  let run: ReturnType<typeof spawnSync> & { stdout: string; stderr: string }

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-icons-')))
    out = join(scratch, 'out')
    temporary = join(scratch, 'tmp')
    mkdirSync(temporary)
    run = spawnSync(scriptNode(), [SCRIPT, '--out', out], { encoding: 'utf8', env: { ...process.env, TMPDIR: temporary } })
  }, 120_000)

  afterAll(() => {
    removeTestTree(scratch)
  })

  it('writes icon.icns, icon.ico, icon.png and icons.json, and nothing else, into the output folder', () => {
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(readdirSync(out).sort()).toEqual(['icon.icns', 'icon.ico', 'icon.png', 'icons.json'])
  })

  // worfy-windows ticket 28: this removal had no test. Written on the PC, where this block does not run.
  it('removes the folder it rendered in: none of its name is left in the temporary folder', () => {
    expect(run.status).toBe(0)
    expect(readdirSync(temporary).filter((name) => name.startsWith('worfy-icons-'))).toEqual([])
  })

  it('writes the same icons.json as the committed one', () => {
    expect(readFileSync(join(out, 'icons.json'), 'utf8')).toBe(readFileSync(join(BUILD, 'icons.json'), 'utf8'))
  })

  it('packs the ten sizes into icon.icns: 16 and 32 px from mark.svg, from 64 px on from icon.svg, each on the icon grid', () => {
    const iconset = iconsetOf(join(out, 'icon.icns'), scratch, 'fresh')
    expect(readdirSync(iconset).sort()).toEqual(ICONSET.map((entry) => entry.file).sort())
    for (const entry of ICONSET) {
      const file = join(iconset, entry.file)
      expect(pngSize(file), entry.file).toEqual({ width: entry.px, height: entry.px })
      const pixels = decodePng(file)
      expectOnIconGrid(pixels)
      expect(sourceOf(pixels), entry.file).toBe(entry.source)
    }
  })

  it('packs the seven sizes into icon.ico: 16, 24 and 32 px from mark.svg, from 48 px on from icon.svg, each on the icon grid', () => {
    const drawn = readIco(readFileSync(join(out, 'icon.ico'))).map((entry) => {
      const pixels = decodePng(entry.png, `the ${entry.px} px picture of the fresh icon.ico`)
      expectOnIconGrid(pixels)
      return { px: pixels.width, source: sourceOf(pixels) }
    })
    expect(drawn).toEqual(ICO)
  })

  it('draws icon.png at 1024 px from icon.svg, on the icon grid', () => {
    const file = join(out, 'icon.png')
    expect(pngSize(file)).toEqual({ width: 1024, height: 1024 })
    const pixels = decodePng(file)
    expectOnIconGrid(pixels)
    expect(sourceOf(pixels)).toBe('icon.svg')
  })

  it('the committed build/icon.icns opens with iconutil and holds the ten sizes of the table', () => {
    const iconset = iconsetOf(join(BUILD, 'icon.icns'), scratch, 'committed')
    expect(readdirSync(iconset).sort()).toEqual(ICONSET.map((entry) => entry.file).sort())
    for (const entry of ICONSET) {
      const pixels = decodePng(join(iconset, entry.file))
      expect({ file: entry.file, width: pixels.width, source: sourceOf(pixels) }).toEqual({ file: entry.file, width: entry.px, source: entry.source })
    }
  })

  it('refuses an unknown argument with a non-zero exit code and a usage line', () => {
    const result = spawnSync(scriptNode(), [SCRIPT, '--outdir', out], { encoding: 'utf8', env: process.env })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('usage: make-icons')
    expect(existsSync(join(out, 'icon.icns'))).toBe(true)
  })
})
