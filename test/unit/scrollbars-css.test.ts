// The app's own thin scrollbar (worfy-polish ticket 170, src/renderer/theme/scrollbars.css): one
// `::-webkit-scrollbar` style for every scrolling container. Chromium skips `::-webkit-scrollbar` on an
// element that sets `scrollbar-width` or `scrollbar-color`, and `scrollbar-color` is inherited, so one such
// rule in a panel would bring the wide native scrollbar back there. The look itself is a manual check.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = join(import.meta.dirname, '../../src/renderer')

function sourcesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sourcesUnder(path)
    return /\.(css|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

/** The text without its comments, which may name the properties; a block comment keeps its line breaks. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, '')).replace(/\/\/.*$/gm, '')
}

const sources = sourcesUnder(RENDERER).map((path) => ({ file: relative(RENDERER, path), text: code(readFileSync(path, 'utf8')) }))

/** Every `file: line` whose code matches the pattern. */
function linesMatching(pattern: RegExp): string[] {
  return sources.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
  )
}

describe('the scrollbar style of the renderer', () => {
  it('is loaded by the entry point, right after the tokens', () => {
    const main = readFileSync(join(RENDERER, 'main.tsx'), 'utf8')
    expect(main).toMatch(/^import '\.\/theme\/tokens\.css'\nimport '\.\/theme\/scrollbars\.css'$/m)
  })

  it('styles every element and takes its colours from the tokens', () => {
    const css = readFileSync(join(RENDERER, 'theme/scrollbars.css'), 'utf8')
    expect(css).toContain('*::-webkit-scrollbar {')
    expect(css).toContain('var(--scrollbar-thumb)')
    expect(css).toContain('var(--scrollbar-thumb-hover)')
    expect(css).toContain('[data-scrolling]::-webkit-scrollbar-thumb')
  })

  it('is never switched off by scrollbar-color', () => {
    expect(linesMatching(/scrollbar-color|scrollbarColor/)).toEqual([])
  })

  it('meets scrollbar-width only where a scrollbar is hidden on purpose', () => {
    const widths = linesMatching(/scrollbar-width|scrollbarWidth/)
    expect(widths.filter((line) => !/(scrollbar-width:\s*none;|scrollbarWidth:\s*'none')/.test(line))).toEqual([])
  })
})
