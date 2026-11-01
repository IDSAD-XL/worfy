import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The colours of the Run history timeline (worfy-flight-recorder ticket 18): the `span-*` rows of the
// "Run history" table of docs/design/F-SPEC.md and their custom properties in tokens.css, checked as
// test/unit/kind-tokens.test.ts checks the kind colours. Both files are read as shipped: a token one of
// them lacks, a value that differs, or a colour that fails the text contrast of 4.5:1 or the colour-vision
// rule, is red here.
const root = join(import.meta.dirname, '../..')
const css = readFileSync(join(root, 'src/renderer/theme/tokens.css'), 'utf8')
const spec = readFileSync(join(root, 'docs/design/F-SPEC.md'), 'utf8')

type Scheme = 'light' | 'dark'
type Rgb = readonly [number, number, number]

function blockAfter(marker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`tokens.css has no "${marker}"`)
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
  const found = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match
    if (name && value) found.set(name, value.trim())
  }
  return found
}

const lightBlock = declarations(blockAfter(':root {'))
const darkBlock = declarations(blockAfter('@media (prefers-color-scheme: dark)'))
const themes: Record<Scheme, Map<string, string>> = { light: lightBlock, dark: new Map([...lightBlock, ...darkBlock]) }

function hexOf(scheme: Scheme, name: string): string {
  const value = themes[scheme].get(name)
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${scheme}: ${name} is not a #rrggbb colour (${value})`)
  return value.toLowerCase()
}

// The "Run history" section of F-SPEC: its table only, not the Tokens table of the whole app.
const section = spec.slice(spec.indexOf('## Run history'), spec.indexOf('\n## ', spec.indexOf('## Run history') + 1))
const specRows = [...section.matchAll(/^\|\s*(span-[a-z]+)\b[^|]*\|([^|]*)\|([^|]*)\|\s*$/gm)].map(([, role, light, dark]) => ({
  role: role ?? '',
  cells: { light: light ?? '', dark: dark ?? '' } as Record<Scheme, string>,
}))

const PARTS = ['band', 'tint', 'stripe', 'text'] as const
type Part = (typeof PARTS)[number]

function cellValue(cell: string, part: Part): string | undefined {
  return new RegExp(`${part}\\s+(#[0-9a-f]{6})`, 'i').exec(cell)?.[1]?.toLowerCase()
}

/** The custom property of a part of a role: `--<role>` for a band or a text, `--<role>-<part>` for a tint or a stripe. */
const tokenOf = (role: string, part: Part): string => (part === 'band' || part === 'text' ? `--${role}` : `--${role}-${part}`)

/** The work kinds: their bars are filled with the band and carry a label in --span-label. */
const WORK = ['span-ticket', 'span-implementer', 'span-verifier', 'span-agent', 'span-ci', 'span-gate', 'span-script', 'span-orchestrator']
/** The kinds drawn as a tint with a band outline. */
const TINTED = ['span-run', 'span-wave', 'span-stage', 'span-wait']

// Colour maths, as test/unit/kind-tokens.test.ts: WCAG 2.x contrast; Machado, Oliveira & Fernandes 2009
// simulation at full severity on linear RGB; CIE L*a*b* (D65) and CIE76 ΔE.

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

type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia'
const MACHADO: Record<Vision, readonly [Rgb, Rgb, Rgb]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}
function simulate(hex: string, vision: Vision): Rgb {
  const linear = channels(hex).map(toLinear)
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return MACHADO[vision].map((row) => clamp(row[0] * (linear[0] ?? 0) + row[1] * (linear[1] ?? 0) + row[2] * (linear[2] ?? 0))) as unknown as Rgb
}
function lab([r, g, b]: Rgb): Rgb {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
function deltaE(a: string, b: string, vision: Vision): number {
  const [l1, a1, b1] = lab(simulate(a, vision))
  const [l2, a2, b2] = lab(simulate(b, vision))
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

const MIN_BAND_CONTRAST = 3
const MIN_TEXT_CONTRAST = 4.5
const MIN_DELTA_E = 15
const SIMULATED: Vision[] = ['protanopia', 'deuteranopia', 'tritanopia']
const GROUNDS = ['--bg', '--surface', '--surface-raised']
const TEXTS = ['--text', '--text-secondary']

describe('span tokens: tokens.css and the F-SPEC "Run history" table', () => {
  it('the table names the work kinds, the tinted kinds, the label, the problem and the hatch colours', () => {
    expect(specRows.map(({ role }) => role).sort()).toEqual([...WORK, ...TINTED, 'span-label', 'span-problem', 'span-hatch'].sort())
  })

  it('tokens.css declares exactly the --span-* tokens the table names, in both themes', () => {
    const named = new Set(specRows.flatMap(({ role, cells }) => PARTS.filter((part) => cellValue(cells.light, part) !== undefined).map((part) => tokenOf(role, part))))
    expect([...lightBlock.keys()].filter((name) => name.startsWith('--span-')).sort()).toEqual([...named].sort())
    expect([...darkBlock.keys()].filter((name) => name.startsWith('--span-')).sort()).toEqual([...named].sort())
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme}: every value is the table's`, () => {
      for (const { role, cells } of specRows) {
        for (const part of PARTS) {
          const value = cellValue(cells[scheme], part)
          if (value !== undefined) expect(hexOf(scheme, tokenOf(role, part)), `${tokenOf(role, part)} (${scheme})`).toBe(value)
        }
      }
    })
  }
})

for (const scheme of ['light', 'dark'] as const) {
  describe(`span tokens, ${scheme} theme`, () => {
    it('the label of a work bar is at least 4.5:1 on its band', () => {
      for (const role of WORK) {
        const ratio = contrast(hexOf(scheme, '--span-label'), hexOf(scheme, `--${role}`))
        expect(ratio, `--span-label on --${role}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      }
    })

    it('text and secondary text are at least 4.5:1 on every tint and on the Wait stripe', () => {
      for (const ground of [...TINTED.map((role) => `--${role}-tint`), '--span-wait-stripe']) {
        for (const text of TEXTS) {
          const ratio = contrast(hexOf(scheme, text), hexOf(scheme, ground))
          expect(ratio, `${text} on ${ground}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      }
    })

    it('every band and the hatch are at least 3:1 to the grounds a row is drawn on; the problem colour, a text, 4.5:1', () => {
      for (const ground of GROUNDS) {
        for (const role of [...WORK, ...TINTED, 'span-hatch']) {
          const ratio = contrast(hexOf(scheme, `--${role}`), hexOf(scheme, ground))
          expect(ratio, `--${role} on ${ground}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_BAND_CONTRAST)
        }
        const ratio = contrast(hexOf(scheme, '--span-problem'), hexOf(scheme, ground))
        expect(ratio, `--span-problem on ${ground}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      }
    })

    it('every pair of work bands: ΔE at least 15 under protanopia, deuteranopia and tritanopia', () => {
      for (const [index, first] of WORK.entries()) {
        for (const second of WORK.slice(index + 1)) {
          for (const vision of SIMULATED) {
            const distance = deltaE(hexOf(scheme, `--${first}`), hexOf(scheme, `--${second}`), vision)
            expect(distance, `--${first} and --${second}, ${vision}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DELTA_E)
          }
        }
      }
    })

    it('the problem colour is no work band: ΔE at least 15 to each', () => {
      for (const role of WORK) {
        const distance = deltaE(hexOf(scheme, '--span-problem'), hexOf(scheme, `--${role}`), 'normal')
        expect(distance, `--span-problem and --${role}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DELTA_E)
      }
    })
  })
}
