// Settings → Pipeline (src/renderer/settings/PipelineSection.tsx, worfy-pipeline ticket 08): the
// editor of a Project's Pipeline over the real renderer IPC client and a fake preload of this
// Machine. main answers `pipeline.read` and `pipeline.write` as bin/profile-set would through
// src/main/ipc/pipeline.ts; the write itself, and its refusal to a Linked machine, are checked in
// test/contract/link-access.test.ts and harness/bin/tests/profile-set.test.sh.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineEditorRead, PipelineWriteResult } from '../../src/shared/ipc/pipeline'
import type { PipelineStage } from '../../src/shared/workflow/pipeline'

const ROOT = '/work/demo'
const FINGERPRINT = `sha256:${'1'.repeat(64)}`
const NEW_FINGERPRINT = `sha256:${'2'.repeat(64)}`

const PIPELINE: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'ci' }, { kind: 'check', name: 'windows' }, { kind: 'gate-merge' }, { kind: 'done' }]

interface FakeMain {
  reads: number
  writes: unknown[]
  /** What the next `pipeline.read` answers. */
  read: PipelineEditorRead
  /** What the next `pipeline.write` answers. */
  write: PipelineWriteResult
  calls: string[]
}

/** A Ticket of the snapshot, standing on `stage` with `passed` behind it. */
const ticket = (num: number, stage: string, kind: string, passed: string[]) => ({
  epic: 'demo',
  num,
  stage,
  index: 0,
  kind,
  passed,
  skipped: [],
  blocked: null,
  rework: false,
  sub: null,
  waits: 'agent',
  enteredAt: null,
})

/** This Machine's preload: the Pipeline editor's channels, the Stages, and the Harness item of the toolbar. */
function preload(read: PipelineEditorRead): FakeMain {
  const main: FakeMain = { reads: 0, writes: [], read, write: { status: 'saved', fingerprint: NEW_FINGERPRINT, warning: null }, calls: [] }
  const answer = (value: unknown) => Promise.resolve({ ok: true, value } as never)
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      main.calls.push(channel)
      switch (channel) {
        case 'pipeline.read':
          main.reads += 1
          return answer(main.read)
        case 'pipeline.write':
          main.writes.push(input)
          return answer(main.write)
        case 'pipeline.get':
          return answer({
            root: ROOT,
            pipeline: [],
            tickets: [
              // Two Tickets in work have the mark of Check «windows»: one passed it, one stands on it.
              ticket(1, 'gate-merge', 'gate-merge', ['queued', 'implementing', 'ci', 'check/windows']),
              ticket(2, 'check/windows', 'check', ['queued', 'implementing', 'ci']),
              // A Done Ticket passed it too, and a Queued one did not: neither is in work.
              ticket(3, 'done', 'done', ['queued', 'implementing', 'ci', 'check/windows', 'gate-merge']),
              ticket(4, 'queued', 'queued', []),
            ],
            error: null,
          })
        case 'pipeline.close':
          return answer({ closed: true })
        case 'harness.state':
          return answer({ state: { kind: 'outdated', from: '0.1.0', to: '0.2.0' }, bundledVersion: '0.2.0', canInstall: true, pluginDir: '/h/plugin', dependencies: [] })
        case 'app.version':
          return answer({ version: '0.2.0' })
        case 'harnessMigration.offer':
          return answer({ offered: false })
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
      }
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

const custom = (pipeline: PipelineStage[] = PIPELINE): PipelineEditorRead => ({ available: true, custom: true, pipeline, fingerprint: FINGERPRINT })

beforeEach(() => {
  // usePipeline keeps its copy in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(read: PipelineEditorRead, linkedMachine: string | null = null) {
  const main = preload(read)
  const section = await import('../../src/renderer/settings/PipelineSection')
  const view = render(<section.PipelineEditor root={ROOT} linkedMachine={linkedMachine} />)
  await screen.findByTestId(read.available ? 'settings-pipeline' : 'pipeline-too-old')
  return { main, view, section }
}

const kinds = (): string[] => screen.getAllByTestId('pipeline-stage').map((row) => row.dataset.kind ?? '')
const save = (): HTMLButtonElement => screen.getByTestId<HTMLButtonElement>('pipeline-save')
const type = (label: string, text: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } })
}

describe('Settings → Pipeline', () => {
  it('shows the Profile\'s Pipeline; Queued and Done stay first and last without Move or Remove', async () => {
    await mount(custom())
    expect(kinds()).toEqual(['queued', 'implementing', 'ci', 'check', 'gate-merge', 'done'])
    expect(screen.queryByLabelText('Remove Queued')).toBeNull()
    expect(screen.queryByLabelText('Move Done up')).toBeNull()
    expect(screen.getByLabelText<HTMLButtonElement>('Move Implementing up').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLButtonElement>('Move Gate & merge down').disabled).toBe(true)
    // Nothing changed yet: nothing to save.
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('pipeline-recompute').textContent).toBe('The Stage of every Ticket will be computed again.')
  })

  it('turns a kind on, moves a Stage and renames one; Save writes that Pipeline over the fingerprint it read', async () => {
    const { main } = await mount(custom())
    // On: Deploy, added before Done.
    fireEvent.click(screen.getByRole('combobox', { name: 'Stage to add' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Stage to add' })).getByRole('option', { name: 'Deploy' }))
    fireEvent.click(screen.getByTestId('pipeline-add'))
    expect(kinds()).toEqual(['queued', 'implementing', 'ci', 'check', 'gate-merge', 'deploy', 'done'])
    // Deploy is there now: the list no longer offers it.
    fireEvent.click(screen.getByRole('combobox', { name: 'Stage to add' }))
    expect(within(screen.getByRole('listbox', { name: 'Stage to add' })).queryByRole('option', { name: 'Deploy' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Stage to add' }), { key: 'Escape' })
    // Order: CI below Check «windows».
    fireEvent.click(screen.getByLabelText('Move CI down'))
    expect(kinds()).toEqual(['queued', 'implementing', 'check', 'ci', 'gate-merge', 'deploy', 'done'])
    // Rename, a threshold and an environment.
    type('Implementing label', 'Coding')
    type('CI stuck after', '45m')
    type('Deploy environment', 'production')
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await screen.findByTestId('pipeline-saved')
    expect(main.writes).toEqual([
      {
        root: ROOT,
        expected: FINGERPRINT,
        pipeline: [
          { kind: 'queued' },
          { kind: 'implementing', label: 'Coding' },
          { kind: 'check', name: 'windows' },
          { kind: 'ci', stuck_after: '45m' },
          { kind: 'gate-merge' },
          { kind: 'deploy', environment: 'production' },
          { kind: 'done' },
        ],
      },
    ])
    // The next write goes over the new fingerprint.
    type('Implementing label', 'Code')
    fireEvent.click(save())
    await waitFor(() => expect(main.writes).toHaveLength(2))
    expect(main.writes[1]).toMatchObject({ expected: NEW_FINGERPRINT })
  })

  it('a field that breaks a rule shows its error and nothing is written: stuck_after 0h, a Check without a name, a blank label', async () => {
    const { main } = await mount(custom())
    type('CI stuck after', '0h')
    expect(screen.getByTestId(/-stuck_after-error$/).textContent).toMatch(/from 1/)
    expect(screen.getByLabelText('CI stuck after').getAttribute('aria-invalid')).toBe('true')
    expect(save().disabled).toBe(true)
    fireEvent.click(save())

    type('CI stuck after', '2h')
    type('Implementing label', '   ')
    expect(screen.getByTestId(/-label-error$/).textContent).toMatch(/not empty/)
    expect(save().disabled).toBe(true)
    fireEvent.click(save())

    type('Implementing label', '')
    type('Check «windows» name', '')
    expect(screen.getByTestId(/-name-error$/).textContent).toMatch(/needs a name/)
    expect(save().disabled).toBe(true)
    fireEvent.click(save())

    // A Check added without a name is refused the same way.
    type('Check name', 'windows')
    fireEvent.click(screen.getByRole('combobox', { name: 'Stage to add' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Stage to add' })).getByRole('option', { name: 'Check' }))
    fireEvent.click(screen.getByTestId('pipeline-add'))
    expect(screen.getAllByTestId(/-name-error$/)).toHaveLength(1)
    expect(save().disabled).toBe(true)
    fireEvent.click(save())
    expect(main.writes).toEqual([])
  })

  it('two Checks of one name: the list error, nothing written', async () => {
    const { main } = await mount(custom())
    fireEvent.click(screen.getByRole('combobox', { name: 'Stage to add' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Stage to add' })).getByRole('option', { name: 'Check' }))
    fireEvent.click(screen.getByTestId('pipeline-add'))
    type('Check name', 'windows')
    expect(screen.getByTestId('pipeline-list-error').textContent).toMatch(/twice/)
    fireEvent.click(save())
    expect(main.writes).toEqual([])
  })

  it('shows the reason of bin/profile-set when it refuses what the form let through', async () => {
    const { main } = await mount(custom())
    main.write = { status: 'invalid', reason: '/h/projects/demo/profile.json: workflow.pipeline[2]: something new — not written' }
    type('CI label', 'Builds')
    fireEvent.click(save())
    expect((await screen.findByTestId('pipeline-invalid')).textContent).toBe('Not saved: /h/projects/demo/profile.json: workflow.pipeline[2]: something new — not written')
  })

  it('removing a Check with marks asks first and names 2 Tickets; Cancel keeps it, Remove takes it out', async () => {
    const { main } = await mount(custom())
    // The Stages come in through pipeline.get: wait for them.
    await waitFor(() => expect(main.calls).toContain('pipeline.get'))
    await act(async () => undefined)
    fireEvent.click(screen.getByLabelText('Remove Check «windows»'))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/Remove Check «windows»\? 2 Tickets have its mark or stand on it\./)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(kinds()).toContain('check')
    fireEvent.click(screen.getByLabelText('Remove Check «windows»'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    expect(kinds()).not.toContain('check')
    // A Stage that is not a Check goes without a question.
    fireEvent.click(screen.getByLabelText('Remove CI'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(kinds()).toEqual(['queued', 'implementing', 'gate-merge', 'done'])
    expect(main.writes).toEqual([])
  })

  it('Reset to default asks first, then calls the reset: pipeline null over the fingerprint read', async () => {
    const { main } = await mount(custom())
    main.write = { status: 'saved', fingerprint: null, warning: null }
    fireEvent.click(screen.getByTestId('pipeline-reset'))
    expect(main.writes).toEqual([])
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/Reset the Pipeline to the default\?/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await screen.findByTestId('pipeline-saved')
    expect(main.writes).toEqual([{ root: ROOT, expected: FINGERPRINT, pipeline: null }])
    expect(kinds()).toEqual(['queued', 'implementing', 'ci', 'agent-review', 'gate-merge', 'closing', 'done'])
    // The default Pipeline has nothing to reset.
    expect(screen.getByTestId<HTMLButtonElement>('pipeline-reset').disabled).toBe(true)
  })

  it('a conflict: the line and Reload, which reads the Pipeline again; the form\'s edits are not written', async () => {
    const { main } = await mount(custom())
    main.write = { status: 'conflict' }
    type('CI label', 'Builds')
    fireEvent.click(save())
    const conflict = await screen.findByTestId('pipeline-conflict')
    expect(conflict.textContent).toMatch(/The Pipeline has changed since it was read\. Reload it\./)
    // While the conflict stands, Save is off: the edits would go over a Pipeline nobody read.
    expect(save().disabled).toBe(true)
    expect(main.writes).toHaveLength(1)
    main.read = custom([{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'done' }])
    fireEvent.click(within(conflict).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(kinds()).toEqual(['queued', 'implementing', 'done']))
    expect(main.reads).toBe(2)
    expect(screen.queryByTestId('pipeline-conflict')).toBeNull()
  })

  it('a commit that failed: the write is taken and the warning names the reason', async () => {
    const { main } = await mount(custom())
    main.write = { status: 'saved', fingerprint: NEW_FINGERPRINT, warning: 'git commit failed: stub git: commit refused; the write stays' }
    type('CI label', 'Builds')
    fireEvent.click(save())
    expect((await screen.findByTestId('pipeline-commit-warning')).textContent).toMatch(/not committed.*commit refused/)
    // Taken: nothing left to save.
    expect(save().disabled).toBe(true)
  })

  it('a Harness without bin/profile-set: the line about the old Harness and the Update Harness button, no form', async () => {
    await mount({ available: false, reason: 'this Harness has no bin/profile-set' })
    expect(screen.getByText('The Harness is too old for the Pipeline editor.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Update Harness' })).toBeTruthy()
    expect(screen.queryByTestId('pipeline-save')).toBeNull()
    expect(screen.queryByTestId('pipeline-stage')).toBeNull()
  })

  it('a Project of a Linked machine: its Pipeline read-only, no buttons that write, and where to edit it', async () => {
    const { main } = await mount(custom(), 'Studio')
    expect(screen.getByTestId('pipeline-elsewhere').textContent).toBe('This Pipeline belongs to a Project of Studio. Edit it in worfy on Studio.')
    expect(screen.getAllByTestId('pipeline-readonly-stage').map((row) => row.textContent)).toEqual(['Queued', 'Implementing', 'CI', 'Check «windows»', 'Gate & merge', 'Done'])
    expect(screen.queryByTestId('pipeline-save')).toBeNull()
    expect(screen.queryByTestId('pipeline-reset')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(main.calls).not.toContain('pipeline.write')
  })

  it('a write main could not run: the reason, nothing taken', async () => {
    const { main } = await mount(custom())
    main.write = undefined as unknown as PipelineWriteResult
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const original = bridge.invoke
    bridge.invoke = (channel, input) => (channel === 'pipeline.write' ? Promise.resolve({ ok: false, error: 'pipeline.write: bin/profile-set --set failed (exit 9)' } as IpcResult<never>) : original(channel, input))
    type('CI label', 'Builds')
    fireEvent.click(save())
    expect((await screen.findByTestId('pipeline-failed')).textContent).toMatch(/exit 9/)
    expect(save().disabled).toBe(false)
  })
})
