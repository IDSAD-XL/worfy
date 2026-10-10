// scripts/ico.mjs (worfy-windows ticket 12): the .ico of the Windows icon is PNGs packed by plain
// Node, so this runs on any system. The PNGs here are made in the test: a signature, an IHDR with
// the size, and nothing a reader of sizes needs beyond that.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface Ico {
  packIco: (pngs: Buffer[], names?: string[]) => Buffer
  readIco: (data: Buffer) => { px: number; png: Buffer }[]
  pngSizeOf: (data: Buffer) => { width: number; height: number } | null
}
const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'ico.mjs')
const { packIco, readIco, pngSizeOf } = (await import(pathToFileURL(SCRIPT).href)) as Ico

/** The start of a PNG of the given size, with `tail` bytes after the IHDR so that images differ in length. */
function png(width: number, height: number = width, tail = 0): Buffer {
  const data = Buffer.alloc(33 + tail, 0xab)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data, 0)
  data.writeUInt32BE(13, 8)
  data.write('IHDR', 12, 'latin1')
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return data
}

describe('packIco', () => {
  it('writes the header of an icon file and one directory entry per image, in the order given', () => {
    const images = [png(16, 16, 3), png(48, 48, 10), png(256)]
    const ico = packIco(images)
    // ICONDIR: reserved 0, type 1 (an icon), the number of images.
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3])
    const entry = (index: number) => {
      const at = 6 + 16 * index
      return {
        width: ico.readUInt8(at),
        height: ico.readUInt8(at + 1),
        colours: ico.readUInt8(at + 2),
        reserved: ico.readUInt8(at + 3),
        planes: ico.readUInt16LE(at + 4),
        bits: ico.readUInt16LE(at + 6),
        bytes: ico.readUInt32LE(at + 8),
        offset: ico.readUInt32LE(at + 12),
      }
    }
    const first = 6 + 16 * 3
    expect(entry(0)).toEqual({ width: 16, height: 16, colours: 0, reserved: 0, planes: 1, bits: 32, bytes: 36, offset: first })
    expect(entry(1)).toEqual({ width: 48, height: 48, colours: 0, reserved: 0, planes: 1, bits: 32, bytes: 43, offset: first + 36 })
    // A side of 256 px does not fit a byte: the format writes it as 0.
    expect(entry(2)).toEqual({ width: 0, height: 0, colours: 0, reserved: 0, planes: 1, bits: 32, bytes: 33, offset: first + 36 + 43 })
    expect(ico.length).toBe(first + 36 + 43 + 33)
    // Each image is stored as the PNG it is.
    expect(ico.subarray(first, first + 36).equals(images[0]!)).toBe(true)
    expect(ico.subarray(first + 36 + 43).equals(images[2]!)).toBe(true)
  })

  it('refuses what is not a square PNG of 1 to 256 px, naming the image', () => {
    expect(() => packIco([])).toThrow(/at least one image/)
    expect(() => packIco([Buffer.from('not a png at all, not a png at all')], ['mark-16.png'])).toThrow(/^mark-16\.png is not a PNG$/)
    expect(() => packIco([png(16), png(32, 24)])).toThrow(/^image 2 is not square: 32×24$/)
    expect(() => packIco([png(512)], ['icon-512.png'])).toThrow(/^icon-512\.png is 512 px/)
    expect(() => packIco([png(0)])).toThrow(/is 0 px/)
    expect(() => packIco([png(1), png(256)])).not.toThrow()
  })
})

describe('readIco', () => {
  it('reads back the sizes and the PNGs that packIco stored', () => {
    const images = [16, 24, 32, 48, 64, 128, 256].map((px, index) => png(px, px, index))
    const read = readIco(packIco(images))
    expect(read.map((each) => each.px)).toEqual([16, 24, 32, 48, 64, 128, 256])
    read.forEach((each, index) => expect(each.png.equals(images[index]!), `image ${index + 1}`).toBe(true))
  })

  it('refuses a file that is not an .ico of PNGs', () => {
    const ico = packIco([png(16), png(32)])
    expect(() => readIco(Buffer.alloc(4))).toThrow(/the header is wrong/)
    const cursor = Buffer.from(ico)
    cursor.writeUInt16LE(2, 2)
    expect(() => readIco(cursor)).toThrow(/the header is wrong/)
    const empty = Buffer.from(ico.subarray(0, 6))
    empty.writeUInt16LE(0, 4)
    expect(() => readIco(empty)).toThrow(/holds no image/)
    expect(() => readIco(ico.subarray(0, 20))).toThrow(/the directory runs past the end/)
    expect(() => readIco(ico.subarray(0, ico.length - 1))).toThrow(/^entry 2 of the \.ico runs past the end of the file$/)
    const wrongSize = Buffer.from(ico)
    wrongSize.writeUInt8(24, 6)
    expect(() => readIco(wrongSize)).toThrow(/^entry 1 of the \.ico names 24×16 px, and its PNG is 16×16$/)
    const notPng = Buffer.from(ico)
    notPng.writeUInt8(0, ico.readUInt32LE(6 + 12))
    expect(() => readIco(notPng)).toThrow(/^entry 1 of the \.ico is not a PNG$/)
  })
})

describe('pngSizeOf', () => {
  it('reads the size from the IHDR of a PNG, and answers null for anything else', () => {
    expect(pngSizeOf(png(48, 32))).toEqual({ width: 48, height: 32 })
    expect(pngSizeOf(Buffer.from('GIF89a'))).toBeNull()
    expect(pngSizeOf(png(48).subarray(0, 20))).toBeNull()
  })
})
