import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Reads the tokens straight from the stylesheet the app ships, so the check follows the file.
const css = readFileSync(join(import.meta.dirname, '../../src/renderer/theme/tokens.css'), 'utf8')

/** The body of the `{ … }` block that opens after `marker`. */
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

/** Every `--shadow-*` declaration of a block, comments dropped, value with its whitespace collapsed. */
function shadowTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of code.matchAll(/(--shadow-[\w-]+)\s*:\s*([^;]*);/g)) {
    const [, name, value] = match
    if (name && value !== undefined) tokens[name] = value.replace(/\s+/g, ' ').trim()
  }
  return tokens
}

const themes = {
  light: shadowTokens(blockAfter(':root {')),
  dark: shadowTokens(blockAfter('@media (prefers-color-scheme: dark)')),
}

describe('shadow tokens', () => {
  it('both themes define the same shadow tokens, and there are some', () => {
    expect(Object.keys(themes.light).length).toBeGreaterThan(0)
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
  })

  // Rules put a shadow token into a comma-separated box-shadow list (the done stack in
  // epic-frame.css, the accent ring of a selected Node in canvas.css and node-chrome.css).
  // `none` is not allowed inside such a list, so the browser drops the whole declaration and the
  // stack's second card and the ring disappear. A theme without a shadow uses a transparent one.
  for (const [theme, tokens] of Object.entries(themes)) {
    it(`${theme}: no shadow token is "none", so every token is valid inside a box-shadow list`, () => {
      const none = Object.entries(tokens)
        .filter(([, value]) => /(^|[\s,])none([\s,]|$)/i.test(value))
        .map(([name]) => name)
      expect(none).toEqual([])
    })
  }
})
