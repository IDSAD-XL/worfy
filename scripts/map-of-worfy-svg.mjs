// The Map of worfy as two static SVG files for README.md (worfy-guide ticket 21):
// docs/images/map-of-worfy-light.svg and docs/images/map-of-worfy-dark.svg, which README.md shows in a
// <picture> by the theme of the page. GitHub shows an SVG as an image: no CSS of the app, no script,
// no links, no web fonts. So this script draws the Guide's diagram again from the same data — the
// blocks, frames, captions and Edges of src/renderer/guide/topics/map-of-worfy/spec.ts, the English
// labels of its en.json, the geometry of src/renderer/guide/scene/model.ts and the colours of
// scene-colours.ts — and writes every colour into the file as a hex value, read from
// src/renderer/theme/tokens.css and src/renderer/guide/guide.css for each theme.
//
// What differs from the live diagram (src/renderer/guide/scene/LivingScene.tsx): the SVG stands on a
// ground of its own (--surface), so its text has a known background on any page; every Edge label is
// shown at once, since nothing can be lit; there are no moving dots and no step player.
// test/unit/map-of-worfy-svg.test.tsx fails when the committed files differ from what this script
// writes, and when a text of either file is below 4.5:1 against its ground.
//
// Run: node scripts/map-of-worfy-svg.mjs (Node 24 strips the types of the .ts files it imports).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { MAP_SPEC } from '../src/renderer/guide/topics/map-of-worfy/spec.ts'
import { CHIP_HEIGHT, HEADER_HEIGHT, NODE_HEIGHT, NODE_WIDTH, TAB_HEIGHT, boxOf, edgeId, edgeShape, noteLines } from '../src/renderer/guide/scene/model.ts'
import { GROUP_COLOURS } from '../src/renderer/guide/scene-colours.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

export const SCHEMES = ['light', 'dark']
/** Where the two files go, relative to the repository. */
export const svgPath = (scheme) => `docs/images/map-of-worfy-${scheme}.svg`

/** The system fonts of macOS, Windows and Linux: an SVG shown as an image loads no web font. */
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif"
/** The arrowhead of LivingScene.tsx, its tip at the origin, pointing right. */
const ARROW = 'M 0 0 L -9 -4.5 L -7 0 L -9 4.5 Z'
/** How wide a character of an 11 px Edge label is taken to be, and the pill's padding, as in LivingScene.tsx. */
const LABEL_CHAR_WIDTH = 6.2
const LABEL_PADDING = 14

/** The body of the first `{…}` block after `marker`, nested blocks included. */
function blockAfter(css, marker) {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`no "${marker}"`)
  const open = css.indexOf('{', start + marker.length - 1)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`unbalanced block after "${marker}"`)
}

const declarations = (block) => new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))

const DARK = '@media (prefers-color-scheme: dark)'

/** The custom properties of the app in `scheme`: tokens.css, then the Guide's own of guide.css. */
function propertiesOf(scheme) {
  const tokensCss = read('src/renderer/theme/tokens.css')
  const guideCss = read('src/renderer/guide/guide.css')
  const light = new Map([...declarations(blockAfter(tokensCss, ':root {')), ...declarations(blockAfter(guideCss, '.w-guide {'))])
  if (scheme === 'light') return light
  return new Map([...light, ...declarations(blockAfter(tokensCss, DARK)), ...declarations(blockAfter(blockAfter(guideCss, DARK), '.w-guide {'))])
}

/** A colour: `#rrggbb` and its opacity. */
function parseColour(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex !== null) return { hex: `#${hex[1].toLowerCase()}`, opacity: 1 }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value)
  if (rgba === null) throw new Error(`not a #rrggbb or rgba() colour: ${value}`)
  const hexOf = rgba.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')
  return { hex: `#${hexOf}`, opacity: Number(rgba[4]) }
}

/** `color-mix(in srgb, <colour> <share>, <ground>)` of two #rrggbb colours. */
export function mix(colour, share, ground) {
  const channels = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const [c, g] = [channels(colour), channels(ground)]
  return `#${c.map((value, index) => Math.round(value * share + g[index] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

/** The palette of one theme, every value a #rrggbb colour. */
function paletteOf(scheme) {
  const properties = propertiesOf(scheme)
  const colour = (name) => {
    const value = properties.get(name)
    if (value === undefined) throw new Error(`${scheme}: no ${name}`)
    return parseColour(value)
  }
  const hex = (name) => colour(name).hex
  const groups = Object.fromEntries(
    Object.entries(GROUP_COLOURS).map(([group, value]) => {
      const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
      if (name === undefined) throw new Error(`${group}: ${value} is not a var()`)
      return [group, hex(name)]
    }),
  )
  return {
    surface: hex('--surface'),
    canvas: hex('--canvas'),
    canvasDot: hex('--canvas-dot'),
    border: hex('--border'),
    borderStrong: hex('--border-strong'),
    text: hex('--text'),
    textSecondary: hex('--text-secondary'),
    textMuted: hex('--text-muted'),
    edge: colour('--guide-edge'),
    groups,
  }
}

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const attributes = (values) =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}="${typeof value === 'string' ? escape(value) : value}"`)
    .join(' ')

const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height

/**
 * The Map of worfy in `scheme`: the SVG and every text in it with its colour and the colour of the
 * ground it is drawn on, for the contrast check of the test.
 */
export function renderMapSvg(scheme) {
  const spec = MAP_SPEC
  const topic = JSON.parse(read('src/renderer/guide/topics/map-of-worfy/en.json'))
  const labels = topic.scene.labels
  const palette = paletteOf(scheme)
  const texts = []
  const byId = new Map(spec.blocks.map((block) => [block.id, block]))
  const frames = spec.frames ?? []
  const groupOf = (block) => palette.groups[block.group]

  /** The ground under a point outside every block: the Epic frame's tint, the Canvas, or the SVG's own. */
  function groundAt(point) {
    let ground = palette.surface
    for (const frame of frames) {
      if (!inside(point, frame)) continue
      ground = frame.kind === 'canvas' ? palette.canvas : mix(groupOf(byId.get(frame.block)), 0.08, ground)
    }
    return ground
  }

  /** A <text>, recorded with its ground. */
  function text(content, { fill, ground, size, weight, x, y, anchor, spacing, lines }) {
    texts.push({ text: lines === undefined ? content : lines.join(' '), fill, ground })
    const head = `<text ${attributes({ x, y, fill, 'font-size': size, 'font-weight': weight, 'text-anchor': anchor, 'letter-spacing': spacing })}>`
    if (lines === undefined) return `${head}${escape(content)}</text>`
    return `${head}${lines.map((line, index) => `<tspan ${attributes({ x, dy: index === 0 ? 0 : 12 })}>${escape(line)}</tspan>`).join('')}</text>`
  }

  const out = []
  const { width, height } = spec
  const dark = scheme === 'dark'
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc" font-family="${escape(FONT)}">`,
    `<!-- Generated by scripts/map-of-worfy-svg.mjs from src/renderer/guide/topics/map-of-worfy/spec.ts and en.json (${scheme} theme). Do not edit by hand: run the script. -->`,
    `<title id="map-title">${escape(topic.title)}</title>`,
    `<desc id="map-desc">${escape(topic.scene.description)}</desc>`,
    '<defs>',
    `<pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1.1" fill="${palette.canvasDot}"/></pattern>`,
    // The light theme's shadow of a Node (guide.css, .w-guide-scene__block); the dark theme has none.
    dark
      ? ''
      : '<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="0.75" flood-color="#000000" flood-opacity="0.06"/><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.05"/></filter>',
    '</defs>',
    `<rect width="${width}" height="${height}" rx="14" fill="${palette.surface}"/>`,
  )

  // The captions of the areas, then the frames: what lies inside what.
  for (const region of spec.regions ?? []) {
    const point = { x: region.x, y: region.y }
    out.push(text(labels[region.label] ?? region.label, { fill: palette.textMuted, ground: groundAt(point), size: 11, weight: 600, spacing: '0.06em', ...point }))
  }
  for (const frame of frames) {
    const box = attributes({ x: frame.x, y: frame.y, width: frame.width, height: frame.height, rx: frame.kind === 'canvas' ? 14 : 10 })
    if (frame.kind === 'canvas') {
      out.push(`<rect ${box} fill="${palette.canvas}" stroke="${palette.borderStrong}" stroke-width="1.5"/>`, `<rect ${box} fill="url(#grid)"/>`)
    } else {
      const colour = groupOf(byId.get(frame.block))
      out.push(`<rect ${box} fill="${colour}" fill-opacity="0.08" stroke="${colour}" stroke-opacity="0.7" stroke-width="1.5"/>`)
    }
  }

  // The Edges, each with its arrowhead, in the colour of an Edge that is not lit.
  const edges = spec.edges.map((edge) => ({ edge, shape: edgeShape(byId.get(edge.from), byId.get(edge.to), edge) }))
  const edgeColour = attributes({ fill: 'none', stroke: palette.edge.hex, 'stroke-opacity': palette.edge.opacity === 1 ? undefined : palette.edge.opacity, 'stroke-width': 1.5 })
  const arrowColour = attributes({ fill: palette.edge.hex, 'fill-opacity': palette.edge.opacity === 1 ? undefined : palette.edge.opacity })
  for (const { edge, shape } of edges) {
    out.push(`<g data-edge="${escape(edgeId(edge))}"><path d="${shape.d}" ${edgeColour}/><path d="${ARROW}" transform="translate(${shape.tip.x} ${shape.tip.y}) rotate(${shape.angle})" ${arrowColour}/></g>`)
  }

  // The blocks: a Node, the tab of a frame, or a chip.
  for (const block of spec.blocks) {
    const title = labels[block.id] ?? block.id
    const note = labels[`${block.id}Note`] ?? ''
    const shape = block.shape ?? 'node'
    const colour = groupOf(block)
    const at = `translate(${block.x} ${block.y})`
    const part = []
    if (shape === 'node') {
      const header = mix(colour, 0.13, palette.surface)
      const lines = noteLines(note, NODE_WIDTH)
      part.push(
        `<rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${palette.surface}" stroke="${palette.borderStrong}" stroke-width="1"/>`,
        `<path d="M 0 8 a 8 8 0 0 1 8 -8 h ${NODE_WIDTH - 16} a 8 8 0 0 1 8 8 v ${HEADER_HEIGHT - 8} h ${-NODE_WIDTH} z" fill="${header}"/>`,
        `<line x1="0" y1="${HEADER_HEIGHT}" x2="${NODE_WIDTH}" y2="${HEADER_HEIGHT}" stroke="${palette.border}"/>`,
        `<circle cx="14" cy="${HEADER_HEIGHT / 2}" r="4" fill="${colour}"/>`,
        text(title, { fill: palette.text, ground: header, size: 13, weight: 650, x: 26, y: HEADER_HEIGHT / 2 + 4.5 }),
        lines.length === 1
          ? text(note, { fill: palette.textSecondary, ground: palette.surface, size: 11, x: 12, y: HEADER_HEIGHT + 20 })
          : text(note, { fill: palette.textSecondary, ground: palette.surface, size: 10.5, x: 12, y: HEADER_HEIGHT + 13, lines }),
      )
      out.push(`<g transform="${at}"${dark ? '' : ' filter="url(#shadow)"'} data-block="${block.id}">${part.join('')}</g>`)
      continue
    }
    const box = boxOf(block)
    if (shape === 'tab') {
      part.push(
        `<rect width="${box.width}" height="${TAB_HEIGHT}" rx="8" fill="${palette.surface}" stroke="${colour}" stroke-width="1.5"/>`,
        `<circle cx="14" cy="${TAB_HEIGHT / 2}" r="4.5" fill="${colour}"/>`,
        text(title, { fill: palette.text, ground: palette.surface, size: 14, weight: 700, x: 25, y: TAB_HEIGHT / 2 + 5 }),
      )
      if (note !== '') {
        const ground = groundAt({ x: block.x + box.width + 10, y: block.y + 11 })
        part.push(text(note, { fill: palette.textMuted, ground, size: 11, x: box.width + 10, y: 11 }))
      }
    } else {
      const tint = mix(colour, 0.16, palette.surface)
      part.push(
        `<rect width="${box.width}" height="${CHIP_HEIGHT}" rx="${CHIP_HEIGHT / 2}" fill="${tint}" stroke="${colour}" stroke-width="1.2" stroke-dasharray="4 3"/>`,
        `<circle cx="13" cy="${CHIP_HEIGHT / 2}" r="4" fill="${colour}"/>`,
        text(title, { fill: palette.text, ground: tint, size: 12, weight: 650, x: 23, y: CHIP_HEIGHT / 2 + 4.5 }),
      )
    }
    out.push(`<g transform="${at}" data-block="${block.id}">${part.join('')}</g>`)
  }

  // Every Edge label at once, in its pill at the middle of its curve.
  for (const { edge, shape } of edges) {
    const content = edge.label === undefined ? undefined : labels[edge.label]
    if (content === undefined) continue
    const pill = content.length * LABEL_CHAR_WIDTH + LABEL_PADDING
    out.push(
      `<g transform="translate(${shape.middle.x} ${shape.middle.y})" data-edge-label="${escape(edgeId(edge))}">` +
        `<rect x="${Math.round((-pill / 2) * 10) / 10}" y="-9.5" width="${Math.round(pill * 10) / 10}" height="19" rx="9.5" fill="${palette.surface}" stroke="${palette.borderStrong}" stroke-width="1"/>` +
        text(content, { fill: palette.textSecondary, ground: palette.surface, size: 11, weight: 500, x: 0, y: 4, anchor: 'middle' }) +
        '</g>',
    )
  }

  out.push('</svg>')
  return { svg: `${out.filter((line) => line !== '').join('\n')}\n`, texts }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const scheme of SCHEMES) {
    writeFileSync(join(root, svgPath(scheme)), renderMapSvg(scheme).svg)
    process.stdout.write(`wrote ${svgPath(scheme)}\n`)
  }
}
