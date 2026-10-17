// electron.vite.config.ts points electron-vite at the dev bundle (scripts/dev-bundle.ts) for
// `pnpm dev` only, the command `serve`. A build — `pnpm build`, `pnpm package`, every
// `pnpm test:e2e` — never makes the bundle and never sets ELECTRON_EXEC_PATH.
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useDevBundle } = vi.hoisted(() => ({ useDevBundle: vi.fn() }))
vi.mock('../../scripts/dev-bundle', () => ({ useDevBundle }))

type ConfigFn = (env: { command: 'build' | 'serve'; mode: string }) => Record<string, unknown>
// Loaded by path: electron.vite.config.ts belongs to tsconfig.node.json, not to the test project.
const { default: config } = (await import(join(import.meta.dirname, '..', '..', 'electron.vite.config.ts'))) as { default: ConfigFn }

describe('electron.vite.config.ts and the dev bundle', () => {
  const before = process.env.ELECTRON_EXEC_PATH

  beforeEach(() => {
    useDevBundle.mockClear()
    delete process.env.ELECTRON_EXEC_PATH
  })

  afterEach(() => {
    if (before === undefined) delete process.env.ELECTRON_EXEC_PATH
    else process.env.ELECTRON_EXEC_PATH = before
  })

  it('a build neither makes the dev bundle nor sets ELECTRON_EXEC_PATH', () => {
    const resolved = config({ command: 'build', mode: 'production' })
    expect(useDevBundle).not.toHaveBeenCalled()
    expect('ELECTRON_EXEC_PATH' in process.env).toBe(false)
    expect(Object.keys(resolved).sort()).toEqual(['main', 'preload', 'renderer'])
  })

  it('`pnpm dev` (serve) asks for the dev bundle once', () => {
    const resolved = config({ command: 'serve', mode: 'development' })
    expect(useDevBundle).toHaveBeenCalledExactlyOnceWith()
    expect(Object.keys(resolved).sort()).toEqual(['main', 'preload', 'renderer'])
  })
})
