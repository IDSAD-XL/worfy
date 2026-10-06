import { render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globProbe, type GlobProbe } from './glob-probe'

// Proves that the real Sidebar.tsx and Toolbar.tsx find their parts through import.meta.glob:
// the test copies each of them, unedited, into a temporary mirror of the repository whose
// sidebar/ (toolbar/) holds the real part files plus one probe file (./glob-probe.tsx, ADR-0036),
// imports the copy and expects the probe in the rendered shell. A typo in a glob pattern, or a
// glob replaced by a hand-written list, turns this test red. Nothing is written into src/.

const probeSource = (text: string) => `export const order = 1000\nexport default function Probe() {\n  return <span>${text}</span>\n}\n`

let sidebar: GlobProbe | undefined
let toolbar: GlobProbe | undefined

beforeAll(async () => {
  sidebar = await globProbe({
    module: 'src/renderer/shell/Sidebar.tsx',
    globDir: 'src/renderer/shell/sidebar',
    probes: { 'ZzVitestProbeSection.tsx': probeSource('Sidebar probe from a file') },
  })
  toolbar = await globProbe({
    module: 'src/renderer/shell/Toolbar.tsx',
    globDir: 'src/renderer/shell/toolbar',
    probes: { 'ZzVitestProbe.tsx': probeSource('Toolbar probe from a file') },
  })
})

afterAll(() => {
  sidebar?.remove()
  toolbar?.remove()
})

describe('shell extension discovery', () => {
  it('Sidebar renders a section file it has never been told about', async () => {
    const { Sidebar } = (await import(/* @vite-ignore */ sidebar!.modulePath)) as { Sidebar: ComponentType }
    render(<Sidebar />)
    const nav = screen.getByRole('navigation', { name: 'Sidebar' })
    expect(within(nav).getByText('Sidebar probe from a file').closest('[data-section]')?.getAttribute('data-section')).toBe('ZzVitestProbeSection')
  })

  it('Toolbar renders an item file it has never been told about', async () => {
    const { Toolbar } = (await import(/* @vite-ignore */ toolbar!.modulePath)) as { Toolbar: ComponentType<Record<string, unknown>> }
    render(<Toolbar view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} />)
    const header = screen.getByRole('banner')
    expect(within(header).getByText('Toolbar probe from a file').closest('[data-item]')?.getAttribute('data-item')).toBe('ZzVitestProbe')
  })
})
