import { render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Proves that the real Sidebar.tsx and Toolbar.tsx find their parts through import.meta.glob:
// the test drops one temporary file into src/renderer/shell/sidebar/ and one into toolbar/,
// imports a fresh copy of each module (the query string makes Vite transform it again, and the
// glob is expanded at transform time) and expects the new part in the rendered shell. A typo in
// a glob pattern, or a glob replaced by a hand-written list, turns this test red.

// This project type-checks test/**/*.tsx without Node's types (the renderer has none), so node:fs
// and node:process are loaded through computed specifiers and given the few signatures used here.
interface Fs {
  existsSync(path: string): boolean
  mkdirSync(path: string, options: { recursive: true }): unknown
  readdirSync(path: string): string[]
  rmSync(path: string, options: { force: true }): void
  rmdirSync(path: string): void
  writeFileSync(path: string, data: string): void
}

const probes = [
  { dir: 'sidebar', file: 'ZzVitestProbeSection.tsx', text: 'Sidebar probe from a file' },
  { dir: 'toolbar', file: 'ZzVitestProbe.tsx', text: 'Toolbar probe from a file' },
] as const
const probeSource = (text: string) => `export const order = 1000\nexport default function Probe() {\n  return <span>${text}</span>\n}\n`

let fs: Fs
/** src/renderer/shell as an absolute path; vitest runs with the repository root as cwd. */
let shellDir = ''
const createdDirs: string[] = []

function removeProbes(): void {
  for (const { dir, file } of probes) fs.rmSync(`${shellDir}/${dir}/${file}`, { force: true })
}

const nodeModule = async <T,>(name: string): Promise<T> => (await import(/* @vite-ignore */ ['node', name].join(':'))) as T

beforeAll(async () => {
  fs = await nodeModule<Fs>('fs')
  const { cwd } = await nodeModule<{ cwd(): string }>('process')
  shellDir = `${cwd()}/src/renderer/shell`
  removeProbes() // left behind by an interrupted run
  for (const probe of probes) {
    const dir = `${shellDir}/${probe.dir}`
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      createdDirs.push(dir)
    }
    fs.writeFileSync(`${dir}/${probe.file}`, probeSource(probe.text))
  }
})

afterAll(() => {
  removeProbes()
  for (const dir of createdDirs) {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
})

async function freshImport<T>(path: string): Promise<T> {
  const url = `${path}?discovery=${Date.now()}`
  return (await import(/* @vite-ignore */ url)) as T
}

describe('shell extension discovery', () => {
  it('Sidebar renders a section file it has never been told about', async () => {
    const { Sidebar } = await freshImport<{ Sidebar: ComponentType }>('../../src/renderer/shell/Sidebar.tsx')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation', { name: 'Sidebar' })
    expect(within(nav).getByText('Sidebar probe from a file').closest('[data-section]')?.getAttribute('data-section')).toBe('ZzVitestProbeSection')
  })

  it('Toolbar renders an item file it has never been told about', async () => {
    const { Toolbar } = await freshImport<{ Toolbar: ComponentType<Record<string, unknown>> }>('../../src/renderer/shell/Toolbar.tsx')
    render(<Toolbar view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} />)
    const header = screen.getByRole('banner')
    expect(within(header).getByText('Toolbar probe from a file').closest('[data-item]')?.getAttribute('data-item')).toBe('ZzVitestProbe')
  })
})
