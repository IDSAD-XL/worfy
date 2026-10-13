// The .ico container (worfy-windows ticket 12): the Windows icon of worfy is a set of PNGs packed
// into one file. Plain Node, no tool of any system: scripts/make-icons.mjs packs build/icon.ico with
// packIco on a Mac, and test/unit/ico.test.ts and test/contract/make-icons.test.ts read it back with
// readIco on any system.
//
// Every image is stored as the PNG it is. Windows Vista and later read a PNG entry at any size, and
// electron-builder and NSIS copy the entries into worfy.exe and the installer as they are.

import { Buffer } from 'node:buffer'

const PNG_SIGNATURE = '89504e470d0a1a0a'
const DIR_BYTES = 6
const ENTRY_BYTES = 16
/** The largest side an .ico entry can name; it is written as 0. */
const MAX_SIDE = 256

/** Width and height from the IHDR chunk, or null when the data is not a PNG. */
export function pngSizeOf(data) {
  if (data.length < 24 || data.toString('hex', 0, 8) !== PNG_SIGNATURE) return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** The colour type of a PNG with red, green, blue and alpha. */
const RGBA = 6

/**
 * How a PNG stores its pixels, from its IHDR chunk: the bits per channel and the colour type. Null
 * when the data is not a PNG with a whole IHDR.
 */
export function pngFormatOf(data) {
  if (pngSizeOf(data) === null || data.length < 33 || data.toString('latin1', 12, 16) !== 'IHDR') return null
  return { bitDepth: data.readUInt8(24), colourType: data.readUInt8(25) }
}

/** Why a PNG cannot be an entry that says "32 bits per pixel", or null: it must be RGBA with 8 bits per channel. */
function notRgba8(png) {
  const format = pngFormatOf(png)
  if (format === null) return 'has no whole IHDR chunk'
  if (format.bitDepth !== 8 || format.colourType !== RGBA) return `is not an 8-bit RGBA PNG (bit depth ${format.bitDepth}, colour type ${format.colourType})`
  return null
}

/**
 * An .ico of the given PNGs (Buffers), in the order given. Each must be a square PNG of 1 to 256 px
 * with 8-bit RGBA pixels, since its entry says 32 bits per pixel; anything else throws, with
 * `names[index]` in the message when names are given.
 */
export function packIco(pngs, names = []) {
  if (pngs.length === 0) throw new Error('an .ico needs at least one image')
  const sizes = pngs.map((png, index) => {
    const name = names[index] ?? `image ${index + 1}`
    const size = pngSizeOf(png)
    if (size === null) throw new Error(`${name} is not a PNG`)
    if (size.width !== size.height) throw new Error(`${name} is not square: ${size.width}×${size.height}`)
    if (size.width < 1 || size.width > MAX_SIDE) throw new Error(`${name} is ${size.width} px: an .ico entry is 1 to ${MAX_SIDE} px`)
    const reason = notRgba8(png)
    if (reason !== null) throw new Error(`${name} ${reason}: an entry of the .ico says 32 bits per pixel`)
    return size.width
  })
  const header = Buffer.alloc(DIR_BYTES + ENTRY_BYTES * pngs.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach((png, index) => {
    const at = DIR_BYTES + ENTRY_BYTES * index
    const side = sizes[index] === MAX_SIDE ? 0 : sizes[index]
    header.writeUInt8(side, at) // width
    header.writeUInt8(side, at + 1) // height
    header.writeUInt8(0, at + 2) // colours in the palette: none
    header.writeUInt8(0, at + 3) // reserved
    header.writeUInt16LE(1, at + 4) // colour planes
    header.writeUInt16LE(32, at + 6) // bits per pixel
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs])
}

/**
 * The images of an .ico made of PNG entries, in file order: `px` is the side the directory names,
 * `png` the data. Throws when the data is not such a file: a wrong header, an entry that runs past
 * the end, an entry that is not a PNG, a PNG whose size is not the one its entry names, an entry
 * that does not say 32 bits per pixel, a PNG that is not 8-bit RGBA, or an entry whose palette,
 * reserved byte or colour planes are not the 0, 0 and 1 that packIco writes.
 */
export function readIco(data) {
  if (data.length < DIR_BYTES || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) throw new Error('not an .ico: the header is wrong')
  const count = data.readUInt16LE(4)
  if (count === 0) throw new Error('not an .ico: it holds no image')
  if (data.length < DIR_BYTES + ENTRY_BYTES * count) throw new Error('not an .ico: the directory runs past the end of the file')
  return Array.from({ length: count }, (_, index) => {
    const at = DIR_BYTES + ENTRY_BYTES * index
    const px = data.readUInt8(at) || MAX_SIDE
    const height = data.readUInt8(at + 1) || MAX_SIDE
    const bytes = data.readUInt32LE(at + 8)
    const offset = data.readUInt32LE(at + 12)
    if (offset + bytes > data.length) throw new Error(`entry ${index + 1} of the .ico runs past the end of the file`)
    const png = data.subarray(offset, offset + bytes)
    const size = pngSizeOf(png)
    if (size === null) throw new Error(`entry ${index + 1} of the .ico is not a PNG`)
    if (size.width !== px || size.height !== height) throw new Error(`entry ${index + 1} of the .ico names ${px}×${height} px, and its PNG is ${size.width}×${size.height}`)
    const bits = data.readUInt16LE(at + 6)
    if (bits !== 32) throw new Error(`entry ${index + 1} of the .ico says ${bits} bits per pixel, not 32`)
    const [colours, reserved, planes] = [data.readUInt8(at + 2), data.readUInt8(at + 3), data.readUInt16LE(at + 4)]
    if (colours !== 0 || reserved !== 0 || planes !== 1) {
      throw new Error(`entry ${index + 1} of the .ico names a palette of ${colours} colours, a reserved byte of ${reserved} and ${planes} colour planes: an entry of a PNG with 32 bits per pixel names 0, 0 and 1`)
    }
    const reason = notRgba8(png)
    if (reason !== null) throw new Error(`the PNG of entry ${index + 1} of the .ico ${reason}`)
    return { px, png }
  })
}
