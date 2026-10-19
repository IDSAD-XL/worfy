import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The colours of the Node kinds (ADR-0077): the `kind-*` roles of the Tokens table in
// docs/design/F-SPEC.md and their custom properties in tokens.css. Both files are read as shipped,
// so the check follows them: a token one of them lacks, a value that differs, or a colour that
// fails the contrast and colour-vision rules of ADR-0077, point 4, is red here.
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

/** Every custom property of a block with its raw value. */
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

/** The `kind-*` rows of the F-SPEC Tokens table: role, then the light and the dark cell. */
const specRows = [...spec.matchAll(/^\|\s*(kind-[a-z]+)\b[^|]*\|([^|]*)\|([^|]*)\|\s*$/gm)].map(([, role, light, dark]) => ({
  role: role ?? '',
  cells: { light: light ?? '', dark: dark ?? '' } as Record<Scheme, string>,
}))

/** `band #rrggbb` or `tint #rrggbb` of a cell; undefined when the cell has none. */
function cellValue(cell: string, part: 'band' | 'tint'): string | undefined {
  return new RegExp(`${part}\\s+(#[0-9a-f]{6})`, 'i').exec(cell)?.[1]?.toLowerCase()
}

/** The custom properties the F-SPEC rows call for: `--<role>` for a band (or a reference), `--<role>-tint` for a tint. */
function specTokenNames(): Set<string> {
  const names = new Set<string>()
  for (const { role, cells } of specRows) {
    names.add(`--${role}`)
    if (cellValue(cells.light, 'tint') !== undefined || cellValue(cells.dark, 'tint') !== undefined) names.add(`--${role}-tint`)
  }
  return names
}

const cssTokenNames = new Set([...lightBlock.keys(), ...darkBlock.keys()].filter((name) => name.startsWith('--kind-')))

/** The kinds with a colour of their own: a row with a band. */
const coloured = specRows.filter(({ cells }) => cellValue(cells.light, 'band') !== undefined).map(({ role }) => role)

// Colour maths. WCAG 2.x contrast; Machado, Oliveira & Fernandes 2009 simulation at full severity,
// applied to linear RGB; CIE L*a*b* (D65) and CIE76 ΔE.

function channels(hex: string): Rgb {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as unknown as Rgb
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia'
type Matrix = readonly [Rgb, Rgb, Rgb]

const MACHADO: Record<Vision, Matrix> = {
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
/** The status colours a kind colour must not pass for (ADR-0077, points 2 and 3: those hues are taken). */
const STATUS_TOKENS = ['--ready-dot', '--ready-text', '--working-dot', '--working-text', '--blocked-ring', '--blocked-text']

describe('colour helpers', () => {
  it('match the reference points', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(deltaE('#000000', '#ffffff', 'normal')).toBeCloseTo(100, 1)
    // Grey stays grey under every simulation: each row of a Machado matrix sums to 1.
    for (const vision of SIMULATED) expect(deltaE('#808080', '#808080', vision)).toBe(0)
    for (const vision of SIMULATED) for (const row of MACHADO[vision]) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 4)
  })

  it('reproduce the figures ADR-0077 recorded for its draft', () => {
    // Point 4: band to surface raised from 3.35:1 (Session, light) to 13.15:1 (Epic, dark, to surface);
    // the least ΔE of a pair of kinds 18.2 (Orchestrator and Epic, tritanopia, light).
    expect(contrast('#2b8bc6', '#f2f2f5')).toBeCloseTo(3.35, 2)
    expect(contrast('#f0e442', '#1b1a18')).toBeCloseTo(13.15, 2)
    expect(deltaE('#a0527f', '#9a7a00', 'tritanopia')).toBeCloseTo(18.2, 1)
  })
})

describe('kind tokens: tokens.css and the F-SPEC Tokens table', () => {
  it('F-SPEC has the four kind roles of ADR-0077', () => {
    expect(specRows.map(({ role }) => role).sort()).toEqual(['kind-epic', 'kind-orchestrator', 'kind-session', 'kind-subagent'])
    expect(coloured.sort()).toEqual(['kind-epic', 'kind-orchestrator', 'kind-session'])
  })

  it('tokens.css declares exactly the --kind-* tokens the table names', () => {
    expect([...cssTokenNames].sort()).toEqual([...specTokenNames()].sort())
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme}: every band and tint has the value of the table`, () => {
      for (const role of coloured) {
        const cells = specRows.find((row) => row.role === role)?.cells[scheme] ?? ''
        expect(hexOf(scheme, `--${role}`), `--${role}`).toBe(cellValue(cells, 'band'))
        expect(hexOf(scheme, `--${role}-tint`), `--${role}-tint`).toBe(cellValue(cells, 'tint'))
      }
    })
  }

  it('Subagent takes the colour of Session in both themes', () => {
    expect(lightBlock.get('--kind-subagent')).toBe('var(--kind-session)')
    expect(darkBlock.has('--kind-subagent')).toBe(false)
    const row = specRows.find(({ role }) => role === 'kind-subagent')
    expect(row?.cells.light).toMatch(/= kind-session/)
    expect(row?.cells.dark).toMatch(/= kind-session/)
  })
})

for (const scheme of ['light', 'dark'] as const) {
  describe(`kind tokens, ${scheme} theme (ADR-0077, point 4)`, () => {
    for (const role of coloured) {
      it(`--${role}: band at least 3:1 to surface and surface raised`, () => {
        for (const ground of ['--surface', '--surface-raised']) {
          const ratio = contrast(hexOf(scheme, `--${role}`), hexOf(scheme, ground))
          expect(ratio, `--${role} on ${ground}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_BAND_CONTRAST)
        }
      })

      it(`--${role}-tint: header text at least 4.5:1 on it`, () => {
        for (const text of ['--text', '--text-secondary', '--text-muted']) {
          const ratio = contrast(hexOf(scheme, text), hexOf(scheme, `--${role}-tint`))
          expect(ratio, `${text} on --${role}-tint: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      })

      it(`--${role}: no status colour (ΔE at least 15 to each)`, () => {
        for (const status of STATUS_TOKENS) {
          const distance = deltaE(hexOf(scheme, `--${role}`), hexOf(scheme, status), 'normal')
          expect(distance, `--${role} and ${status}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DELTA_E)
        }
      })
    }

    it('every pair of kind colours: ΔE at least 15 under protanopia, deuteranopia and tritanopia', () => {
      for (const [index, first] of coloured.entries()) {
        for (const second of coloured.slice(index + 1)) {
          for (const vision of SIMULATED) {
            const distance = deltaE(hexOf(scheme, `--${first}`), hexOf(scheme, `--${second}`), vision)
            expect(distance, `--${first} and --${second}, ${vision}: ΔE ${distance.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DELTA_E)
          }
        }
      }
    })
  })
}
