import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { WAIT_DEFAULT_TIMEOUT } from './scaled-waits'
import { ms } from './time-scale'

// Testing Library's waitFor and findBy* without a timeout of their own give up after its 1 s times
// the run's multiplier, as vi.waitFor does (test/scaled-waits.ts).
configure({ asyncUtilTimeout: ms(WAIT_DEFAULT_TIMEOUT) })

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
