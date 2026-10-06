#!/usr/bin/env node
// Builds the app icon from the brand sources (ticket 31):
//
//   node scripts/make-icons.mjs [--out <dir>]     (pnpm icons)
//
// Renders the ten PNGs of a macOS iconset from build/brand/icon.svg and build/brand/mark.svg with
// `sips`, packs them into icon.icns with `iconutil -c icns`, and writes into <dir> (default build/):
//   icon.icns   — the bundle icon, electron-builder's mac.icon;
//   icon.png    — 1024 px from icon.svg, the Dock icon of `pnpm dev` (src/main/dock-icon.ts);
//   icons.json  — sha256 of both SVGs and of both outputs, and the list of sizes; the contract test
//                 test/contract/make-icons.test.ts turns red when an SVG changes without this script.
// The outputs are committed, so packaging does not depend on sips, iconutil or the installed macOS.
// The iconset itself lives in a temporary folder and is removed afterwards.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = join(repo, 'build', 'brand')

// The table of ticket 31. The mark has no orbit and thicker strokes, so it stays legible at 16 and
// 32 px (Finder list view, Spotlight); from 64 px on the full icon is drawn.
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
]
const PNG = { file: 'icon.png', px: 1024, source: 'icon.svg' }

// icon.svg places its 120-unit mark on the macOS icon grid: a 1024 canvas, a body of 824 centred,
// 100 of transparent field on each side. mark.svg is drawn edge to edge; it is wrapped the same way,
// or the small worfy icon in Finder would look larger than its neighbours.
const GRID_TRANSFORM = 'translate(100,100) scale(6.866667)'

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const usage = 'usage: make-icons [--out <dir>]'
  if (argv.length === 0) return join(repo, 'build')
  if (argv.length === 2 && argv[0] === '--out' && argv[1] !== '') return resolve(argv[1])
  fail(`unexpected arguments: ${argv.join(' ')}\n${usage}`)
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) fail(`could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${result.status}:\n${result.stderr}`)
  return result
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** mark.svg wrapped into a 1024 canvas with the same grid placement as icon.svg. */
function markOnGrid(markSvg) {
  const open = /<svg\b[^>]*>/.exec(markSvg)
  const close = markSvg.lastIndexOf('</svg>')
  if (open === null || close < open.index) fail('build/brand/mark.svg does not look like an <svg> document')
  // The grid transform maps 120 units onto the 824 px body; another viewBox would land off the grid.
  if (!/\bviewBox="0 0 120 120"/.test(open[0])) fail('build/brand/mark.svg must have viewBox="0 0 120 120", as icon.svg\'s mark does')
  const inner = markSvg.slice(open.index + open[0].length, close)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    `  <g transform="${GRID_TRANSFORM}">${inner}</g>`,
    '</svg>',
    '',
  ].join('\n')
}

/** Width and height from the IHDR chunk, or null when the file is not a PNG. */
function pngSize(path) {
  const header = readFileSync(path).subarray(0, 24)
  if (header.length < 24 || header.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

function render(svg, px, png) {
  run('sips', ['-s', 'format', 'png', '-z', String(px), String(px), svg, '--out', png])
  const size = pngSize(png)
  if (size === null || size.width !== px || size.height !== px) {
    fail(
      `sips did not rasterize ${svg} into a ${px}×${px} PNG (got ${size ? `${size.width}×${size.height}` : 'no PNG'}). ` +
        'Rendering SVG with sips needs a recent macOS; on an older one draw the PNGs some other way (ticket 31, "Итог").',
    )
  }
}

function main() {
  if (process.platform !== 'darwin') fail('needs macOS: the icon is rendered with sips and packed with iconutil')
  const out = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'worfy-icons-'))
  try {
    const sources = { 'icon.svg': join(brand, 'icon.svg'), 'mark.svg': join(work, 'mark-on-grid.svg') }
    writeFileSync(sources['mark.svg'], markOnGrid(readFileSync(join(brand, 'mark.svg'), 'utf8')))

    const iconset = join(work, 'icon.iconset')
    mkdirSync(iconset)
    for (const entry of ICONSET) render(sources[entry.source], entry.px, join(iconset, entry.file))
    const png = join(work, PNG.file)
    render(sources[PNG.source], PNG.px, png)
    const icns = join(work, 'icon.icns')
    run('iconutil', ['-c', 'icns', iconset, '-o', icns])

    mkdirSync(out, { recursive: true })
    copyFileSync(icns, join(out, 'icon.icns'))
    copyFileSync(png, join(out, PNG.file))
    const manifest = {
      sources: { 'icon.svg': sha256(join(brand, 'icon.svg')), 'mark.svg': sha256(join(brand, 'mark.svg')) },
      outputs: { 'icon.icns': sha256(join(out, 'icon.icns')), 'icon.png': sha256(join(out, PNG.file)) },
      iconset: ICONSET,
      png: PNG,
    }
    writeFileSync(join(out, 'icons.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    process.stdout.write(`make-icons: wrote icon.icns, icon.png and icons.json to ${out}\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`make-icons: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
