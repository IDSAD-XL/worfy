import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Reads the tokens straight from the stylesheet the app ships, so the check follows the file.
const css = readFileSync(join(import.meta.dirname, '../../src/renderer/theme/tokens.css'), 'utf8')

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match
    if (name && value) tokens[name] = value
  }
  return tokens
}

function blockAfter(marker: string, from = 0): string {
  const start = css.indexOf(marker, from)
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

const light = tokensIn(blockAfter(':root {'))
const dark = { ...light, ...tokensIn(blockAfter('@media (prefers-color-scheme: dark)')) }

/** Relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

const grounds = ['--bg', '--canvas', '--sidebar', '--toolbar', '--surface', '--surface-raised']
const textPairs = ['--text', '--text-secondary', '--text-muted'].flatMap((text) => grounds.map((ground) => [text, ground] as const))
const otherPairs = [
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--primary-text', '--primary'],
  ['--ready-text', '--ready-bg'],
  ['--working-text', '--working-bg'],
  ['--blocked-text', '--blocked-bg'],
  ['--done-text', '--done-bg'],
  ['--terminal-text', '--terminal-bg'],
  // Colour 8 of the terminal palette (bright black): zsh draws the Terminal AI Suggestion in it.
  ['--terminal-dim', '--terminal-bg'],
] as const

describe('contrast helper', () => {
  it('matches the WCAG reference points', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })
})

for (const [scheme, tokens] of [['light', light], ['dark', dark]] as const) {
  describe(`${scheme} theme`, () => {
    it('defines every token the checks below use', () => {
      for (const [foreground, background] of [...textPairs, ...otherPairs]) {
        expect(tokens[foreground], foreground).toMatch(/^#[0-9a-f]{6}$/i)
        expect(tokens[background], background).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })

    it.each([...textPairs, ...otherPairs])('%s on %s has contrast of at least 4.5:1', (foreground, background) => {
      const ratio = contrast(tokens[foreground] ?? '', tokens[background] ?? '')
      expect(ratio, `${foreground} ${tokens[foreground]} on ${background} ${tokens[background]}`).toBeGreaterThanOrEqual(4.5)
    })

    // A Suggestion has to read as a suggestion, not as typed text: colour 8 sits between the
    // background and the text, and far enough from the text to tell the two apart.
    it('--terminal-dim is clearly dimmer than --terminal-text', () => {
      const [dim, text, ground] = [tokens['--terminal-dim'] ?? '', tokens['--terminal-text'] ?? '', tokens['--terminal-bg'] ?? '']
      expect(luminance(dim), `${dim} between ${ground} and ${text}`).toBeLessThan(luminance(text))
      expect(luminance(dim), `${dim} between ${ground} and ${text}`).toBeGreaterThan(luminance(ground))
      expect(contrast(dim, text), `${dim} against ${text}`).toBeGreaterThanOrEqual(1.6)
    })
  })
}

// The hover veil (--hover-veil, laid over every control under the pointer by the control rules of
// tokens.css): a hovered control must look different from the ground it stands on, and its text
// must stay readable on the darker or lighter ground the veil makes.
function veilIn(block: string): [number, number, number, number] {
  const match = /--hover-veil\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\s*;/.exec(block)
  if (!match) throw new Error('the block has no --hover-veil in rgba()')
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
}

/** `ground` with the veil laid over it, as the browser blends a translucent colour. */
function veiled(ground: string, [r, g, b, alpha]: [number, number, number, number]): string {
  const blend = (offset: number, over: number): string => {
    const under = Number.parseInt(ground.slice(offset, offset + 2), 16)
    return Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${blend(1, r)}${blend(3, g)}${blend(5, b)}`
}

for (const [scheme, veil] of [
  ['light', veilIn(blockAfter(':root {'))],
  ['dark', veilIn(blockAfter('@media (prefers-color-scheme: dark)'))],
] as const) {
  const tokens = scheme === 'light' ? light : dark
  describe(`${scheme} theme, a hovered control`, () => {
    it('blends the veil the way the browser does', () => {
      expect(veiled('#ffffff', [0, 0, 0, 0.5])).toBe('#808080')
      expect(veiled('#000000', [255, 255, 255, 0.25])).toBe('#404040')
    })

    it.each(grounds)('on %s stands out from the ground by a contrast of at least 1.07:1', (ground) => {
      const plain = tokens[ground] ?? ''
      expect(contrast(plain, veiled(plain, veil)), `${ground} ${plain} hovered`).toBeGreaterThanOrEqual(1.07)
    })

    it.each(textPairs)('keeps %s on a hovered %s at a contrast of at least 4.5:1', (foreground, ground) => {
      const hovered = veiled(tokens[ground] ?? '', veil)
      expect(contrast(tokens[foreground] ?? '', hovered), `${foreground} on ${ground} hovered (${hovered})`).toBeGreaterThanOrEqual(4.5)
    })
  })
}
