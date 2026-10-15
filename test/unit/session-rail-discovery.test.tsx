import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globProbe, type GlobProbe } from './glob-probe'

// Proves that the real src/renderer/session/rail/index.ts finds rail blocks through
// import.meta.glob, the same way test/unit/shell-discovery.test.tsx does for the shell: the test
// copies index.ts, unedited, into a temporary mirror of the repository whose rail/ holds the real
// block files plus one probe block (./glob-probe.tsx, ADR-0036), imports the copy and expects the
// probe in `railBlocks` next to the real blocks. A typo in the glob pattern, or a glob replaced by
// a hand-written list, turns this test red. Nothing is written into src/. SessionView.tsx passes
// `railBlocks` to the panel as it is; that the panel draws whatever blocks it gets is
// test/unit/session-view.test.tsx.

const PROBE = 'ZzVitestProbeBlock'
const probeSource = `export const order = 1000\nexport default function Probe() {\n  return <span>Rail probe from a file</span>\n}\n`

let probe: GlobProbe | undefined

beforeAll(async () => {
  probe = await globProbe({
    module: 'src/renderer/session/rail/index.ts',
    globDir: 'src/renderer/session/rail',
    probes: { [`${PROBE}.tsx`]: probeSource },
  })
})

afterAll(() => {
  probe?.remove()
})

describe('rail block discovery', () => {
  it('railBlocks holds a block file in rail/ that nothing imports by name', async () => {
    const { railBlocks } = (await import(/* @vite-ignore */ probe!.modulePath)) as typeof import('../../src/renderer/session/rail/index')
    const ids = railBlocks.map((block) => block.id)
    expect(railBlocks.map((block) => [block.id, block.order])).toContainEqual([PROBE, 1000])
    // The real blocks are found too: the copy's glob runs over the real directory's files.
    expect(ids).toEqual(expect.arrayContaining(['BindingRail', 'SubagentsRail']))
  })

  it('has no Limits block: the Limits live in the toolbar only', async () => {
    const { railBlocks } = (await import(/* @vite-ignore */ probe!.modulePath)) as typeof import('../../src/renderer/session/rail/index')
    expect(railBlocks.map((block) => block.id).sort()).toEqual(['BindingRail', 'SubagentsRail', PROBE].sort())
  })
})
