import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Proves that the real src/renderer/session/rail/index.ts finds rail blocks through
// import.meta.glob, the same way test/unit/shell-discovery.test.tsx does for the shell: the test
// drops one temporary block file into rail/, imports a fresh copy of index.ts (the query string
// makes Vite transform it again, and the glob is expanded at transform time) and expects the new
// block in `railBlocks`. A typo in the glob pattern, or a glob replaced by a hand-written list,
// turns this test red. SessionView.tsx passes `railBlocks` to the panel as it is; that the panel
// draws whatever blocks it gets is test/unit/session-view.test.tsx.

// This project type-checks test/**/*.tsx without Node's types (the renderer has none), so node:fs
// and node:process are loaded through computed specifiers and given the few signatures used here.
interface Fs {
  rmSync(path: string, options: { force: true }): void
  writeFileSync(path: string, data: string): void
}

const PROBE = 'ZzVitestProbeBlock'
const probeSource = `export const order = 1000\nexport default function Probe() {\n  return <span>Rail probe from a file</span>\n}\n`

let fs: Fs
let probePath = ''

const nodeModule = async <T,>(name: string): Promise<T> => (await import(/* @vite-ignore */ ['node', name].join(':'))) as T

beforeAll(async () => {
  fs = await nodeModule<Fs>('fs')
  const { cwd } = await nodeModule<{ cwd(): string }>('process')
  // vitest runs with the repository root as cwd.
  probePath = `${cwd()}/src/renderer/session/rail/${PROBE}.tsx`
  fs.writeFileSync(probePath, probeSource)
})

afterAll(() => {
  fs.rmSync(probePath, { force: true })
})

describe('rail block discovery', () => {
  it('railBlocks holds a block file in rail/ that nothing imports by name', async () => {
    const url = `../../src/renderer/session/rail/index.ts?discovery=${Date.now()}`
    const { railBlocks } = (await import(/* @vite-ignore */ url)) as typeof import('../../src/renderer/session/rail/index')
    expect(railBlocks.map((block) => [block.id, block.order])).toContainEqual([PROBE, 1000])
  })
})
