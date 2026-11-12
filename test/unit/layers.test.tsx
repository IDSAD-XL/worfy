// The scale of layers (z-index, worfy-ui-kit ticket 02): named tokens in theme/tokens.css, the same
// values for inline styles in theme/layers.ts, and the first places that take them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PINNED_Z_INDEX } from '../../src/renderer/canvas/pinning'
import { LAYERS } from '../../src/renderer/theme/layers'

const read = (path: string): string => readFileSync(join(import.meta.dirname, '../../src/renderer', path), 'utf8')

/** `canvasOverlay` → `--z-canvas-overlay`. */
const tokenOf = (name: string): string => `--z-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

describe('the scale of layers', () => {
  const tokens = read('theme/tokens.css')

  it.each(Object.entries(LAYERS))('%s has the same value in tokens.css and in layers.ts', (name, value) => {
    expect(tokens).toContain(`${tokenOf(name)}: ${value};`)
  })

  it('tokens.css has no z-index token layers.ts does not know', () => {
    const declared = [...tokens.matchAll(/(--z-[a-z-]+):/g)].map((match) => match[1])
    expect(declared.sort()).toEqual(Object.keys(LAYERS).map(tokenOf).sort())
  })

  it('keeps the order the layers had: panel < popover < dialog < toast < a menu over a dialog < the top', () => {
    expect(LAYERS.panel).toBeLessThan(LAYERS.popover)
    expect(LAYERS.popover).toBeLessThan(LAYERS.dialog)
    // The Settings window (110) is a dialog too: the toasts stay above it.
    expect(LAYERS.dialog).toBeLessThan(LAYERS.toast)
    expect(LAYERS.toast).toBeGreaterThan(110)
    // The list of a Select opens over a dialog, over focus mode and over the Binding menu (2000).
    expect(LAYERS.dialogMenu).toBeGreaterThan(Math.max(LAYERS.toast, LAYERS.canvasOverlay, 2000))
    expect(LAYERS.top).toBeGreaterThan(Math.max(...Object.values(LAYERS).filter((value) => value !== LAYERS.top)))
  })
})

describe('the places on the scale', () => {
  it('the toasts take --z-toast', () => {
    expect(read('toast/toast.css')).toMatch(/\.w-toasts \{[^}]*z-index: var\(--z-toast\);/)
  })

  it('the list of a Select takes --z-dialog-menu', () => {
    expect(read('theme/select.css')).toMatch(/\.w-select-list \{[^}]*z-index: var\(--z-dialog-menu\);/)
  })

  it('a pinned Node takes the Canvas overlay layer', () => {
    expect(PINNED_Z_INDEX).toBe(LAYERS.canvasOverlay)
    expect(read('canvas/pinning.ts')).toContain('LAYERS.canvasOverlay')
  })

  it('none of them keeps a number of its own', () => {
    expect(read('toast/toast.css')).not.toMatch(/z-index: \d/)
    expect(read('theme/select.css')).not.toMatch(/z-index: \d/)
  })
})
