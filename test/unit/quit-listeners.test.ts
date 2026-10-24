// The limit of the app's listeners (src/main/quit-listeners.ts, worfy-polish ticket 36): each module
// of main subscribes to `will-quit` itself, and past ten Node logs MaxListenersExceededWarning. The
// limit is set before any of them subscribes and stays above how many there are.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const app = vi.hoisted(() => ({ setMaxListeners: vi.fn<(count: number) => void>() }))
vi.mock('electron', () => ({ app }))

const MAIN = join(__dirname, '..', '..', 'src', 'main')

/** The `.ts` files under `dir`, all levels. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('the will-quit listeners of main', () => {
  it('raises the limit of the app\'s listeners above the places that subscribe, with room for one Autopilot run per Project', async () => {
    const { QUIT_LISTENERS_MAX } = await import('../../src/main/quit-listeners')
    expect(app.setMaxListeners.mock.calls).toEqual([[QUIT_LISTENERS_MAX]])
    const places = sources(MAIN).reduce((count, file) => count + (readFileSync(file, 'utf8').match(/\.on\(\s*'will-quit'/g)?.length ?? 0), 0)
    expect(places).toBeGreaterThan(10)
    expect(places + 10).toBeLessThanOrEqual(QUIT_LISTENERS_MAX)
  })

  it('is set by the first module main imports, before any module that subscribes loads', () => {
    const imports = readFileSync(join(MAIN, 'index.ts'), 'utf8').match(/^import .*$/gm) ?? []
    expect(imports.filter((line) => !line.includes("'node:")).at(0)).toBe("import './quit-listeners'")
  })
})
