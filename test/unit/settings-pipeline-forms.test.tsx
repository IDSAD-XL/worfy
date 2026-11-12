// The forms Settings → Pipeline opens over the Settings window (worfy-ui-kit ticket 07): "Move old
// Harness…" opens the move form (harness/MigrationForm.tsx) and "Codex: approve hooks" the step
// (harness/CodexHooksStep.tsx), from the Harness item under the line about a Harness too old for the
// Pipeline editor. Both were drawn on z-index 100, under the window (110): the window's guard of the
// keys took them for a layer below it, so their keys were stopped and Esc closed Settings. Both are
// windows of the kit now, drawn inside the window's layer after it: the form has the focus, Tab stays
// in it, Esc closes the form and leaves Settings open, and the next Esc closes Settings.
// The real Settings window with one section, the Pipeline editor, over a fake preload of this Machine.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { MigrationPlan } from '../../src/shared/ipc/harness-migration'
import { expectFocusKeptIn, flush } from './kit-window'

const plan: MigrationPlan = {
  offered: true,
  available: true,
  missing: [],
  claudeHome: '/Users/someone/.claude',
  harnessHome: '/Users/someone/.claude/worfy-harness',
  claudeJson: '/Users/someone/.claude.json',
  rows: [{ id: 'file:agents/scout.md', group: 'files', label: '~/.claude/agents/scout.md', detail: null, choices: ['remove', 'keep'], defaultChoice: 'remove', note: null }],
  claudeMd: null,
  profiles: [],
  warnings: [],
}

/** This Machine's preload: a Harness too old for the editor, one that offers a move and waits for its hooks in Codex. */
function preload(): void {
  const answers: Record<string, unknown> = {
    'pipeline.read': { available: false, reason: 'this Harness has no bin/profile-set' },
    'harness.state': {
      state: { kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true },
      bundledVersion: '0.2.0+bbbbbbb',
      canInstall: true,
      pluginDir: '/Users/someone/.claude/worfy-harness/plugin',
      dependencies: [],
      codex: { state: { kind: 'installed', version: '0.2.0+bbbbbbb' }, agentsDir: '/Users/someone/.codex/agents', hooksToApprove: true, skippedAgents: [] },
    },
    'app.version': { version: '0.2.0' },
    'harnessMigration.offer': { offered: true },
    'harnessMigration.plan': plan,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => Promise.resolve(channel in answers ? { ok: true, value: answers[channel] } : { ok: false, error: `no ${channel} here` }),
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
}

beforeEach(() => {
  // usePipeline keeps its copy in a module: every test starts with a fresh one.
  vi.resetModules()
  preload()
})

afterEach(async () => {
  cleanup()
  await flush()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Opens Settings on its Pipeline section and waits for the Harness item. */
async function openPipeline(): Promise<HTMLElement> {
  const { SettingsDialogView } = await import('../../src/renderer/settings/SettingsDialog')
  const { collectSections } = await import('../../src/renderer/settings/sections')
  const { PipelineEditor } = await import('../../src/renderer/settings/PipelineSection')
  const { openSettings } = await import('../../src/renderer/settings/settings-window')
  const sections = collectSections({ './PipelineSection.tsx': { default: () => <PipelineEditor root="/work/demo" linkedMachine={null} />, order: 10, title: 'Pipeline' } })
  render(<SettingsDialogView sections={sections} />)
  act(() => openSettings())
  await flush()
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  await within(settings).findByTestId('pipeline-too-old')
  return settings
}

/** The element right under <body> that holds `element`: its layer. */
function layerOf(element: Element): Element {
  let layer = element
  while (layer.parentElement !== document.body) layer = layer.parentElement!
  return layer
}

/** The form is drawn over the window: in the window's layer, after the window, not inside it. */
function expectOver(form: HTMLElement, settings: HTMLElement): void {
  expect(layerOf(form)).toBe(layerOf(settings))
  expect(settings.contains(form)).toBe(false)
  expect(settings.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

/** Esc in the form closes it alone, the focus goes back to its button; the next Esc closes Settings. */
async function expectEscapeClosesFormFirst(testId: string, opener: HTMLElement, settings: HTMLElement): Promise<void> {
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await flush()
  expect(screen.queryByTestId(testId)).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(settings)
  expect(document.activeElement).toBe(opener)
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await flush()
  expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
}

describe('Settings → Pipeline: the forms over the window', () => {
  it('"Move old Harness…": the form is over Settings and has the keys; Esc closes the form, not Settings', async () => {
    const settings = await openPipeline()
    const opener = await within(settings).findByTestId('harness-migrate')
    opener.focus()
    fireEvent.click(opener)
    await flush()
    const form = screen.getByTestId('migration-form')
    await within(form).findByTestId('migration-actions')
    expect(form.getAttribute('role')).toBe('dialog')
    expectOver(form, settings)
    await expectFocusKeptIn(form)
    await expectEscapeClosesFormFirst('migration-form', opener, settings)
  })

  it('"Codex: approve hooks": the step is over Settings and has the keys; Esc closes the step, not Settings', async () => {
    const settings = await openPipeline()
    const opener = await within(settings).findByTestId('harness-codex')
    opener.focus()
    fireEvent.click(opener)
    await flush()
    const step = screen.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' })
    expectOver(step, settings)
    await expectFocusKeptIn(step)
    await expectEscapeClosesFormFirst('codex-hooks-step', opener, settings)
  })
})
