// src/renderer/main.tsx writes the system on <html> before the first render (worfy-windows ticket
// 11): the styles and the key handlers read it from there. A file of its own, because the module
// renders the app into #root as it loads.
import { act } from '@testing-library/react'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ms } from '../time-scale'

// The roots the module makes, so the test can unmount the app it started: Testing Library's cleanup
// only knows the trees of its own render(). A mounted app keeps its timers running (the toast stack
// places itself every 200 ms), and one that fired after the jsdom environment ended threw
// "document is not defined" as an unhandled error of the run.
const roots = vi.hoisted(() => [] as Root[])
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>): Root => {
      const root = actual.createRoot(...args)
      roots.push(root)
      return root
    },
  }
})

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
      act(() => {
        for (const each of roots.splice(0)) each.unmount()
      })
      root.remove()
    }
  }, ms(30_000))
})
