import { describe, expect, it } from 'vitest'

describe('test runtime', () => {
  it('runs under the Node built into Electron', () => {
    // `pnpm test` starts vitest with ELECTRON_RUN_AS_NODE=1, so native modules built
    // for Electron's ABI load in tests exactly as they do in the main process.
    expect(process.versions.electron).toMatch(/^\d+\.\d+\.\d+/)
  })
})
