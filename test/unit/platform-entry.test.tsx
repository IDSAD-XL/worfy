// src/renderer/main.tsx writes the system on <html> before the first render (worfy-windows ticket
// 11): the styles and the key handlers read it from there. A file of its own, because the module
// renders the app into #root as it loads.
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the entry of the renderer', () => {
  it('writes the system of the user agent on <html>, and the app renders with the keys of that system', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38.0.0')
    // test/setup-dom.ts wrote macOS there.
    delete document.documentElement.dataset.platform
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    try {
      await act(async () => {
        await import('../../src/renderer/main')
      })
      expect(document.documentElement.dataset.platform).toBe('windows')
      expect(root.querySelector('[data-testid="palette-trigger"] kbd')?.textContent).toBe('Ctrl+K')
    } finally {
      root.remove()
    }
  }, 30_000)
})
