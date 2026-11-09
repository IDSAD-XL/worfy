// "Edit profile" of Project settings (worfy-polish ticket 78, src/renderer/projects/EditProfile.tsx): the
// button opens the form with the values main read for every field of PROFILE_EDIT_FIELDS, `mode` and the
// Workflow folder are shown without an input, an edit is checked by the Harness and its refusal shows
// under the field, Save sends the values with the fingerprint read, a refused fingerprint reads the
// Profile again with "The profile changed since you opened it", and the GitHub account changes through
// the account step of "Add project". main is replaced: what it answers is set by each test, and what it
// was asked is recorded.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_EDIT_FIELDS, type ProfileEditRead } from '../../src/shared/ipc/profile-edit'
import { ms } from '../time-scale'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  /** The answer of each channel; a list is answered in turn, the last one again once it runs out. */
  answers: {} as Record<string, Answer | Answer[]>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
}))
const answer = (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
  const given = main.answers[channel]
  const next = Array.isArray(given) ? (given.length > 1 ? given.shift() : given[0]) : given
  return Promise.resolve(next ?? { ok: false, error: `no answer for ${channel}` })
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(undefined, channel, input),
  invokeOn: (machine: string | null, channel: string, input?: unknown) => answer(machine, channel, input),
  subscribe: () => () => undefined,
  windowMachine: () => null,
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

const { ProjectSettings } = await import('../../src/renderer/shell/ProjectSettings')

const FP = `sha256:${'a'.repeat(64)}`
const FP2 = `sha256:${'b'.repeat(64)}`
const PROJECT = { id: 'shop-00000001', name: 'shop', path: '/repos/shop' }
/** A value for every field: the field's own name for a text field, so each input shows which one it is. */
const VALUES: Record<string, unknown> = Object.fromEntries(PROFILE_EDIT_FIELDS.map((field) => [field, field]))
Object.assign(VALUES, {
  'commands.verify': 'make check',
  'tickets.path': '.scratch/<epic>/issues/NN-*.md',
  'workflow.finish': 'pr-green-ci',
  parallel: 'worktrees',
  'review.lenses': ['correctness', 'tests'],
  'review.ticket_lenses': ['correctness'],
  'mcp.allowed': ['plugin_worfy_qmd'],
  'skills.allowed': null,
  'github.account': 'shop-bot',
  'language.reports': 'en',
  'language.team': 'en',
  'language.docs': 'ru',
  attribution: 'off',
})
const READ: ProfileEditRead = { available: true, name: 'shop', values: VALUES, fixed: { mode: 'full', 'workflow.folder': null }, fingerprint: FP }

beforeEach(() => {
  main.calls.length = 0
  main.answers = {
    'projects.settings.get': { ok: true, value: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' } } },
    'terminal.shells': { ok: true, value: [] },
    'projects.reviewer.get': { ok: true, value: { status: 'none' } },
    'profileEdit.read': { ok: true, value: READ },
    'profileEdit.check': { ok: true, value: [] },
    'profileEdit.write': { ok: true, value: { status: 'saved', fingerprint: FP2, warning: null } },
  }
})
afterEach(cleanup)

/** Project settings, then "Edit profile…", and the Profile read. */
async function openForm(): Promise<HTMLElement> {
  render(<ProjectSettings project={PROJECT} onClose={() => undefined} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile…' }))
  const form = await screen.findByTestId('edit-profile')
  await within(form).findByLabelText('Title')
  return form
}
const input = (form: HTMLElement, label: string): HTMLInputElement => within(form).getByLabelText(label) as HTMLInputElement
const calls = (channel: string): unknown[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)
const save = (form: HTMLElement): HTMLButtonElement => within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement
/** Waits for the check of the last edit to come back. */
const checked = async (form: HTMLElement): Promise<void> => {
  await waitFor(() => expect(form.textContent).not.toContain('Checking with the Harness'), { timeout: ms(2000) })
}

describe('Edit profile', () => {
  it('opens with the current value of every field, mode and the Workflow folder shown without an input', async () => {
    const form = await openForm()
    expect(calls('profileEdit.read')).toEqual([{ root: '/repos/shop' }])
    expect(input(form, 'Title').value).toBe('title')
    expect(input(form, 'verify').value).toBe('make check')
    expect(input(form, 'test_one').value).toBe('commands.test_one')
    expect(input(form, 'Ticket path').value).toBe('.scratch/<epic>/issues/NN-*.md')
    for (const [label, field] of [
      ['Epic spec', 'tickets.spec'],
      ['Files section', 'tickets.trail_section'],
      ['Done section', 'tickets.done_section'],
      ['Ticket branch', 'tickets.branch'],
      ['ADR folder', 'docs.adr_dir'],
      ['ADR status label', 'docs.adr_status_label'],
      ['Feature pages', 'docs.feature_pages'],
      ['Glossary', 'docs.context.path'],
      ['State file', 'docs.handoff.path'],
      ['Root', 'worktree.root'],
      ['Base', 'worktree.base'],
      ['Implementer command', 'worktree.implementer'],
      ['Reviewer command', 'worktree.reviewer'],
    ] as const) {
      expect(input(form, label).value, label).toBe(field)
    }
    expect(input(form, 'Review lenses').value).toBe('correctness, tests')
    expect(input(form, 'Ticket lenses').value).toBe('correctness')
    expect(input(form, 'MCP servers').value).toBe('plugin_worfy_qmd')
    expect(input(form, 'Skills allowed').value).toBe('')
    expect(within(form).getByLabelText('Finish').getAttribute('data-value')).toBe('pr-green-ci')
    expect(within(form).getByLabelText('Parallel').getAttribute('data-value')).toBe('worktrees')
    expect(within(form).getByLabelText('Documents').getAttribute('data-value')).toBe('ru')
    expect(within(form).getByLabelText('Attribution').getAttribute('data-value')).toBe('off')
    expect(within(form).getByTestId('edit-profile-account').textContent).toBe('shop-bot')
    expect(within(form).getByTestId('edit-profile-name').textContent).toBe('shop')
    // mode and workflow.folder: text with the note, no input to change them.
    expect(within(form).getByTestId('edit-profile-mode').textContent).toBe('full')
    expect(within(form).getByTestId('edit-profile-folder').textContent).toBe('none: the files live in the repository')
    expect(within(form).getAllByText('Changed by moving the workflow files')).toHaveLength(2)
    expect(within(form).queryByLabelText('Mode')).toBeNull()
    expect(within(form).queryByLabelText('Workflow folder')).toBeNull()
    // Nothing edited: nothing to save.
    expect(save(form).disabled).toBe(true)
  })

  it('an edit is checked by the Harness; its refusal shows under the field and Save waits', async () => {
    main.answers['profileEdit.check'] = { ok: true, value: [{ path: 'commands.verify', message: 'must not be empty' }] }
    const form = await openForm()
    fireEvent.change(input(form, 'verify'), { target: { value: '' } })
    await checked(form)
    expect(calls('profileEdit.check')).toEqual([{ root: '/repos/shop', values: { ...VALUES, 'commands.verify': null } }])
    const verify = form.querySelector('[data-field="commands.verify"]') as HTMLElement
    expect(within(verify).getByRole('alert').textContent).toBe('must not be empty')
    expect(input(form, 'verify').getAttribute('aria-invalid')).toBe('true')
    expect(input(form, 'verify').getAttribute('aria-describedby')).toBe(within(verify).getByRole('alert').id)
    expect(save(form).disabled).toBe(true)
  })

  it('Save writes the edited values with the fingerprint read, and Project settings says it was saved', async () => {
    const form = await openForm()
    fireEvent.change(input(form, 'Ticket path'), { target: { value: 'tickets/NN-*.md' } })
    await checked(form)
    expect(save(form).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(save(form))
    })
    expect(calls('profileEdit.write')).toEqual([{ root: '/repos/shop', values: { ...VALUES, 'tickets.path': 'tickets/NN-*.md' }, expected: FP }])
    expect(screen.queryByTestId('edit-profile')).toBeNull()
    expect(screen.getByTestId('project-settings-profile-saved').textContent).toBe('Profile saved.')
  })

  it('a value the write refuses shows its reason under the field, and nothing closes', async () => {
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'invalid', reason: 'workflow.finish: must be one of', issues: [{ path: 'tickets.path', message: 'must match the pattern "NN"' }] } }
    const form = await openForm()
    fireEvent.change(input(form, 'Ticket path'), { target: { value: 'tickets/*.md' } })
    await checked(form)
    await act(async () => {
      fireEvent.click(save(form))
    })
    const path = form.querySelector('[data-field="tickets.path"]') as HTMLElement
    expect(within(path).getByRole('alert').textContent).toBe('must match the pattern "NN"')
    expect(screen.getByTestId('edit-profile')).toBe(form)
  })

  it('a stranger fingerprint is refused with "The profile changed since you opened it", and the form reads the Profile again', async () => {
    const now: ProfileEditRead = { ...READ, values: { ...VALUES, 'commands.verify': 'make verify' }, fingerprint: FP2 }
    main.answers['profileEdit.read'] = [{ ok: true, value: READ }, { ok: true, value: now }]
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'conflict' } }
    const form = await openForm()
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    await act(async () => {
      fireEvent.click(save(form))
    })
    expect(within(form).getByTestId('edit-profile-message').textContent).toContain('The profile changed since you opened it')
    await waitFor(() => expect(input(form, 'verify').value).toBe('make verify'))
    expect(input(form, 'Title').value).toBe('title')
    expect(calls('profileEdit.read')).toHaveLength(2)
    // The next Save goes with the fingerprint read again.
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'saved', fingerprint: FP, warning: null } }
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    await act(async () => {
      fireEvent.click(save(form))
    })
    expect((calls('profileEdit.write')[1] as { expected: string }).expected).toBe(FP2)
  })

  it('the GitHub account changes through the account step, which keeps the current account and sets the finish of the one picked', async () => {
    main.answers['projects.connect.accounts'] = {
      ok: true,
      value: {
        status: 'accounts',
        repos: [{ host: 'github.com', slug: 'shop/shop' }],
        skipped: [],
        selected: 'other',
        accounts: [
          { login: 'other', host: 'github.com', active: true, state: 'success', push: false, finish: 'local-green', reason: 'no push access' },
          { login: 'shop-bot', host: 'github.com', active: false, state: 'success', push: true, finish: 'pr-green-ci', reason: null },
        ],
      },
    }
    const form = await openForm()
    expect(calls('projects.connect.accounts')).toEqual([])
    fireEvent.click(within(form).getByRole('button', { name: 'Change account…' }))
    const group = await within(form).findByRole('radiogroup', { name: 'GitHub account' })
    expect(calls('projects.connect.accounts')).toEqual([{ root: '/repos/shop' }])
    // The Profile's account stays picked, not the step's default.
    expect((within(group).getByRole('radio', { name: /shop-bot/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(group).getByRole('radio', { name: /other/ }))
    await checked(form)
    expect(within(form).getByTestId('edit-profile-account').textContent).toBe('other')
    expect(within(form).getByLabelText('Finish').getAttribute('data-value')).toBe('local-green')
  })

  it('Escape closes Edit profile alone, and the focus goes back to its button', async () => {
    const form = await openForm()
    // The window's own Escape handlers (focus mode, the Canvas) listen above React's root: the key stops at the dialog.
    const window = vi.fn()
    document.addEventListener('keydown', window)
    try {
      fireEvent.keyDown(input(form, 'Title'), { key: 'Escape' })
    } finally {
      document.removeEventListener('keydown', window)
    }
    expect(window).not.toHaveBeenCalled()
    expect(screen.queryByTestId('edit-profile')).toBeNull()
    expect(screen.getByTestId('project-settings')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit profile…' }))
  })

  it('a Harness without the general --field shows why, and no form', async () => {
    main.answers['profileEdit.read'] = { ok: true, value: { available: false, reason: "this Harness's bin/profile-set does not write these Profile fields; update the Harness" } }
    render(<ProjectSettings project={PROJECT} onClose={() => undefined} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile…' }))
    expect((await screen.findByTestId('edit-profile-failed')).textContent).toContain('update the Harness')
    expect(screen.queryByLabelText('Title')).toBeNull()
  })
})
