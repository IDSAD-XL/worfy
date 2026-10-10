import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// The system the renderer takes itself to run on (src/renderer/platform.ts) is macOS unless a test
// sets another one on <html>. jsdom's user agent says neither `Macintosh` nor `Windows`, so
// without this every jsdom test would run as Linux, on any machine, and a test that presses ⌘K
// would find Ctrl the primary modifier.
beforeEach(() => {
  document.documentElement.dataset.platform = 'mac'
})

// vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup()
})
