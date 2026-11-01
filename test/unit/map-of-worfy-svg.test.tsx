import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMES, renderMapSvg, svgPath } from '../../scripts/map-of-worfy-svg.mjs'
import { MAP_SPEC } from '../../src/renderer/guide/topics/map-of-worfy/spec'

// The Map of worfy in README.md (worfy-guide ticket 21): two SVG files that
// scripts/map-of-worfy-svg.mjs draws from the Guide's own diagram (spec.ts, en.json) with the colours
// of each theme written in. The committed files must be what the script writes now, so the picture
// cannot fall behind the diagram; every text must reach 4.5:1 on the ground it is drawn on; every
// arrow must be an Edge of spec.ts; and README.md must show the dark file on a dark page.
const root = join(import.meta.dirname, '../..')
const topic = JSON.parse(readFileSync(join(root, 'src/renderer/guide/topics/map-of-worfy/en.json'), 'utf8')) as { scene: { description: string; labels: Record<string, string> } }
const labels = topic.scene.labels

function luminance(hex: string): number {
  const linear = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

for (const scheme of SCHEMES) {
  describe(`the Map of worfy for README.md, ${scheme} theme`, () => {
    const { svg, texts } = renderMapSvg(scheme)

    it('the committed file is what scripts/map-of-worfy-svg.mjs writes (run it after a change to the Map)', () => {
      // Git for Windows may check the file out with CRLF line ends; the bytes that matter are the same.
      const committed = readFileSync(join(root, svgPath(scheme)), 'utf8').replaceAll('\r\n', '\n')
      expect(committed).toBe(svg)
    })

    it('every text reaches 4.5:1 against its ground', () => {
      expect(texts.length).toBeGreaterThan(0)
      for (const { text, fill, ground } of texts) {
        const ratio = contrast(fill, ground)
        expect(ratio, `"${text}": ${fill} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('shows every block, caption and Edge label of the Map, in English', () => {
      const shown = new Set(texts.map(({ text }) => text))
      const expected = [
        ...(MAP_SPEC.regions ?? []).map((region) => labels[region.label]),
        ...MAP_SPEC.blocks.flatMap((block) => [labels[block.id], block.shape === 'chip' ? undefined : labels[`${block.id}Note`]]),
        ...MAP_SPEC.edges.map((edge) => (edge.label === undefined ? undefined : labels[edge.label])),
      ].filter((text) => text !== undefined)
      for (const text of expected) expect(shown, text).toContain(text)
    })

    it('draws an arrow for each Edge of spec.ts and for nothing else', () => {
      const drawn = [...svg.matchAll(/data-edge="([^"]+)"/g)].map((match) => (match[1] ?? '').replace('-&gt;', '->'))
      expect(drawn).toEqual(MAP_SPEC.edges.map((edge) => `${edge.from}->${edge.to}`))
      // Every arrowhead, with or without a data-edge of its own, is placed by a rotate().
      expect(svg.match(/rotate\(/g)?.length ?? 0).toBe(MAP_SPEC.edges.length)
    })

    it('carries no link, script, web font or local path', () => {
      expect(svg).not.toMatch(/<script|<a |href=|@import|@font-face|url\((?!#)/)
      expect(svg).not.toMatch(/\/Users\/|\/home\/|~\/|[A-Z]:\\|file:/)
      // The name of the user who ran the script, as a whole word and of three letters or more: a shorter
      // name ("a", "on") is a word of the labels themselves.
      const user = userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (userInfo().username.length >= 3) expect(svg).not.toMatch(new RegExp(`\\b${user}\\b`, 'i'))
    })
  })
}

describe('README.md', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')

  it('shows the dark file on a dark page and the light one otherwise, in one <picture>', () => {
    const picture = /<picture>([\s\S]*?)<\/picture>/.exec(readme)?.[1] ?? ''
    expect(picture).toContain(`<source media="(prefers-color-scheme: dark)" srcset="${svgPath('dark')}">`)
    expect(picture).toMatch(new RegExp(`<img [^>]*src="${svgPath('light')}"`))
    // The alt text is the Map's own description, as a screen reader hears it in the Guide.
    const alt = /<img [^>]*alt="([^"]*)"/.exec(picture)?.[1]
    const escaped = topic.scene.description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    expect(alt).toBe(escaped)
  })
})
