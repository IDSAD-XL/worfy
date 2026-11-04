// Makes the fixture clip of the Evidence matrix e2e (worfy-evidence ticket 12): clip.webm, 4 s at 10 frames a
// second, 160×90, no sound, and its contact sheet clip.sheet.png, a frame for each second with the second's
// number under it. Every pixel is drawn here from a pattern — a background colour for each second, a white bar
// that moves across, the second as a seven-segment digit — so nothing of a screen or a machine is in it. The
// frames are encoded by the ffmpeg Playwright installs (`playwright install ffmpeg`), which reads JPEG frames
// from a pipe only; Electron's nativeImage turns the drawn pixels into JPEG and PNG.
//
//   electron test/fixtures/evidence-clip/make-clip.cjs <ffmpeg of Playwright> <output folder>
//
// The files it made are in this folder; run it again only to change them, then run harness/bin/evidence-check
// on both.
/* global require, Buffer, process, console */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script that Electron runs as its main */
'use strict'
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { app, nativeImage } = require('electron')

const WIDTH = 160
const HEIGHT = 90
const FPS = 10
const SECONDS = 4
const LABEL = 20

/** Background of each second, as [b, g, r]: four colours a contact sheet tells apart. */
const BACKGROUNDS = [
  [0xb0, 0x60, 0x20],
  [0x30, 0x90, 0x30],
  [0x30, 0x40, 0xc0],
  [0x90, 0x30, 0x90],
]

/** The segments a digit lights: a b c d e f g. */
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg']

/** A BGRA bitmap of width × height, filled with one colour. */
function bitmap(width, height, [b, g, r]) {
  const pixels = Buffer.alloc(width * height * 4)
  for (let at = 0; at < pixels.length; at += 4) pixels.set([b, g, r, 0xff], at)
  return { width, height, pixels }
}

function rect(image, x, y, w, h, [b, g, r]) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + h); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(image.width, x + w); col += 1) image.pixels.set([b, g, r, 0xff], (row * image.width + col) * 4)
  }
}

/** A seven-segment digit, `size` pixels a segment, its top left at x, y. */
function digit(image, value, x, y, size, colour) {
  const t = Math.max(2, Math.round(size / 4))
  const segments = {
    a: [x, y, size, t],
    b: [x + size - t, y, t, size],
    c: [x + size - t, y + size, t, size],
    d: [x, y + 2 * size - t, size, t],
    e: [x, y + size, t, size],
    f: [x, y, t, size],
    g: [x, y + size - Math.floor(t / 2), size, t],
  }
  for (const name of DIGITS[value]) rect(image, ...segments[name], colour)
}

const WHITE = [0xff, 0xff, 0xff]
const BLACK = [0x10, 0x10, 0x10]

/** Frame `n` of the clip. */
function frame(n) {
  const second = Math.floor(n / FPS)
  const image = bitmap(WIDTH, HEIGHT, BACKGROUNDS[second % BACKGROUNDS.length])
  const span = WIDTH - 16
  rect(image, 4 + Math.round((span * n) / (FPS * SECONDS - 1)), 50, 8, 32, WHITE)
  digit(image, second, 8, 8, 14, WHITE)
  return image
}

/** The contact sheet: the first frame of every second, the second's number under it. */
function sheet() {
  const image = bitmap(WIDTH * SECONDS, HEIGHT + LABEL, [0xf0, 0xf0, 0xf0])
  for (let second = 0; second < SECONDS; second += 1) {
    const { pixels } = frame(second * FPS)
    for (let row = 0; row < HEIGHT; row += 1) pixels.copy(image.pixels, (row * image.width + second * WIDTH) * 4, row * WIDTH * 4, (row + 1) * WIDTH * 4)
    digit(image, second, second * WIDTH + WIDTH / 2 - 4, HEIGHT + 3, 7, BLACK)
  }
  return image
}

const encode = ({ width, height, pixels }) => nativeImage.createFromBitmap(pixels, { width, height })

async function main() {
  const [ffmpeg, out] = process.argv.slice(-2)
  writeFileSync(join(out, 'clip.sheet.png'), encode(sheet()).toPNG())
  const args = ['-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-y', '-an', '-c:v', 'vp8', '-b:v', '200k', '-fflags', '+bitexact', '-map_metadata', '-1', join(out, 'clip.webm')]
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'inherit', 'inherit'] })
  for (let n = 0; n < FPS * SECONDS; n += 1) child.stdin.write(encode(frame(n)).toJPEG(90))
  child.stdin.end()
  const code = await new Promise((resolve) => child.on('close', resolve))
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`)
}

app.whenReady().then(
  () => main().then(() => app.exit(0), (error) => {
    console.error(error)
    app.exit(1)
  }),
)
