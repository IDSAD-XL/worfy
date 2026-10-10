import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// The system the renderer takes itself to run on (src/renderer/platform.ts) is macOS unless a test
// sets another one on <html>: jsdom's user agent names the machine the tests run on, and a test
// that presses ⌘K must pass on a Mac, on Windows and in Linux CI alike.
beforeEach(() => {
  document.documentElement.dataset.platform = 'mac'
})

// vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup()
})
