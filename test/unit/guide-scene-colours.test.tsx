import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GROUP_COLOURS } from '../../src/renderer/guide/scene-colours'

// The colours of the worfy Guide's diagrams (worfy-guide ticket 04, ADR-0090 point 10), read from the
// files as shipped: src/renderer/theme/tokens.css and src/renderer/guide/guide.css. The three groups
// without a kind-* band of their own (Machine, Project, Tools) get colours in guide.css; like the
// kind-* bands (test/unit/kind-tokens.test.ts) each must stay at least ΔE 15 from every status colour
// — --accent among them — and at least 3:1 against the grounds it is drawn on. Every text of a
// diagram must reach 4.5:1 on its ground, the tinted block header included, in both themes.
const root = join(import.meta.dirname, '../..')
const tokensCss = readFileSync(join(root, 'src/renderer/theme/tokens.css'), 'utf8')
const guideCss = readFileSync(join(root, 'src/renderer/guide/guide.css'), 'utf8')

type Scheme = 'light' | 'dark'
type Rgb = readonly [number, number, number]

/** The body of the first `{…}` block after `marker`, nested blocks included. */
function blockAfter(css: string, marker: string): string {
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

function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name ?? '', (value ?? '').trim()]))
}

const DARK = '@media (prefers-color-scheme: dark)'
const tokens: Record<Scheme, Map<string, string>> = {
  light: declarations(blockAfter(tokensCss, ':root {')),
  dark: new Map([...declarations(blockAfter(tokensCss, ':root {')), ...declarations(blockAfter(tokensCss, DARK))]),
}
const guideLight = declarations(blockAfter(guideCss, '.w-guide {'))
const guideDark = declarations(blockAfter(blockAfter(guideCss, DARK), '.w-guide {'))
const guide: Record<Scheme, Map<string, string>> = { light: guideLight, dark: new Map([...guideLight, ...guideDark]) }

/** The #rrggbb value of `name` in `scheme`, following one var() reference. */
function hexOf(scheme: Scheme, value: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  const resolved = reference === undefined ? value : (guide[scheme].get(reference) ?? tokens[scheme].get(reference))
  if (resolved === undefined || !/^#[0-9a-f]{6}$/i.test(resolved)) throw new Error(`${scheme}: ${value} is not a #rrggbb colour (${resolved})`)
  return resolved.toLowerCase()
}
const token = (scheme: Scheme, name: string): string => hexOf(scheme, `var(${name})`)

function channels(hex: string): Rgb {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as unknown as Rgb
}
const toLinear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/** CIE76 ΔE between two colours in CIE L*a*b* (D65). */
function deltaE(first: string, second: string): number {
  const lab = (hex: string): Rgb => {
    const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
    const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
    const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const [l1, a1, b1] = lab(first)
  const [l2, a2, b2] = lab(second)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** `color-mix(in srgb, <colour> <share>, <ground>)`: a mix of the encoded channels. */
function mix(colour: string, share: number, ground: string): string {
  const [c, g] = [channels(colour), channels(ground)]
  return `#${c.map((value, index) => Math.round((value * share + (g[index] ?? 0) * (1 - share)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const STATUS = ['--ready-dot', '--ready-text', '--working-dot', '--working-text', '--blocked-ring', '--blocked-text', '--accent']
const OWN_GROUPS = ['machine', 'project', 'tools'] as const

describe('the groups of the Guide diagrams', () => {
  it('has the six groups of the style; the three that match a kind take its band, the other three a Guide colour', () => {
    expect(Object.keys(GROUP_COLOURS).sort()).toEqual(['agents', 'harness', 'machine', 'project', 'tools', 'workflow'])
    expect(GROUP_COLOURS.workflow).toBe('var(--kind-epic)')
    expect(GROUP_COLOURS.agents).toBe('var(--kind-session)')
    expect(GROUP_COLOURS.harness).toBe('var(--kind-orchestrator)')
    for (const group of OWN_GROUPS) expect(GROUP_COLOURS[group]).toBe(`var(--guide-${group})`)
  })

  it('the header tint the style names is in guide.css', () => {
    expect(guideCss).toContain('color-mix(in srgb, var(--c) 13%, var(--surface))')
    // The chip of a computed thing (ticket 05), whose title the contrast check below reads on this tint.
    expect(guideCss).toContain('color-mix(in srgb, var(--c) 16%, var(--surface))')
  })
})

for (const scheme of ['light', 'dark'] as const) {
  describe(`the ${scheme} theme`, () => {
    for (const group of OWN_GROUPS) {
      it(`${group}: no status colour and no --accent (ΔE at least 15 to each)`, () => {
        for (const status of STATUS) {
          const distance = deltaE(hexOf(scheme, GROUP_COLOURS[group]), token(scheme, status))
          expect(distance, `${group} and ${status}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(15)
        }
      })

      it(`${group}: at least 3:1 to the grounds a dot or an outline of it is drawn on`, () => {
        for (const ground of ['--surface', '--surface-raised', '--canvas']) {
          const ratio = contrast(hexOf(scheme, GROUP_COLOURS[group]), token(scheme, ground))
          expect(ratio, `${group} on ${ground}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        }
      })
    }

    it('every pair of the six groups: ΔE at least 15', () => {
      const groups = Object.entries(GROUP_COLOURS)
      for (const [index, [first, firstColour]] of groups.entries()) {
        for (const [second, secondColour] of groups.slice(index + 1)) {
          const distance = deltaE(hexOf(scheme, firstColour), hexOf(scheme, secondColour))
          expect(distance, `${first} and ${second}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(15)
        }
      }
    })

    it('every text of a diagram reaches 4.5:1 on its ground', () => {
      const surface = token(scheme, '--surface')
      const pairs: [string, string, string][] = [
        // The note of a block, the label of a lit Edge and the step's caption: --text-secondary on --surface.
        ['--text-secondary on --surface', token(scheme, '--text-secondary'), surface],
        // The step buttons: the segments of the language switch.
        ['--text-secondary on --segment-track', token(scheme, '--text-secondary'), token(scheme, '--segment-track')],
        ['--text on --segment-thumb', token(scheme, '--text'), token(scheme, '--segment-thumb')],
      ]
      // The title of a block on its header: 13 % of the group's colour over --surface.
      for (const [group, colour] of Object.entries(GROUP_COLOURS)) {
        pairs.push([`--text on the ${group} header`, token(scheme, '--text'), mix(hexOf(scheme, colour), 0.13, surface)])
        // The title of a chip (ticket 05): 16 % of the group's colour over --surface.
        pairs.push([`--text on a ${group} chip`, token(scheme, '--text'), mix(hexOf(scheme, colour), 0.16, surface)])
      }
      // Ticket 05: the title of a frame's tab on --surface; the tab's note and an area's caption in
      // --text-muted, on the Guide's --surface outside the Canvas frame and on --canvas inside it.
      pairs.push(['--text on a tab', token(scheme, '--text'), surface])
      pairs.push(['--text-muted on --surface', token(scheme, '--text-muted'), surface])
      pairs.push(['--text-muted on --canvas', token(scheme, '--text-muted'), token(scheme, '--canvas')])
      for (const [what, text, ground] of pairs) {
        const ratio = contrast(text, ground)
        expect(ratio, `${what}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
}
