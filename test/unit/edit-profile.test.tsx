// "Edit profile" of Project settings (worfy-polish ticket 78, src/renderer/projects/EditProfile.tsx): the
// button opens the form with the values main read for every field of PROFILE_EDIT_FIELDS, `mode` and the
// Workflow folder are shown without an input, an edit is checked by the Harness and its refusal shows
// under the field, Save sends the values with the fingerprint read, a refused fingerprint reads the
// Profile again with "The profile changed since you opened it", and the GitHub account changes through
// the account step of "Add project", where only a pick changes the form. A Project shared read-only or of a
// Linked machine shows the form without Save. main is replaced: what it answers is set by each test, and what
// it was asked is recorded; the check answers as bin/profile-set --check does.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_CHANGED, PROFILE_EDIT_FIELDS, type ProfileEditRead } from '../../src/shared/ipc/profile-edit'
import { ms } from '../time-scale'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  /**
   * The answer of each channel; a list is answered in turn, the last one again once it runs out; a function
   * answers from the input, or with a promise the test settles.
   */
  answers: {} as Record<string, Answer | Answer[] | ((input: unknown) => Answer | Promise<Answer>)>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
  /** What useReadOnly says: the reason a Project is shared read-only, or null. */
  readOnly: null as string | null,
}))
const answer = (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
  const given = main.answers[channel]
  if (typeof given === 'function') return Promise.resolve(given(input))
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
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => main.readOnly }))

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
/**
 * profileEdit.check as `bin/profile-set --check` answers for these fields (test/contract/profile-edit.test.ts runs the
 * real one): an empty verify and a ticket path without NN are refused, null in either is not (it is "none").
 */
function harnessCheck(input: unknown): Answer {
  const values = (input as { values: Record<string, unknown> }).values
  const issues: { path: string; message: string }[] = []
  if (values['commands.verify'] === '') issues.push({ path: 'commands.verify', message: 'must not be empty' })
  const path = values['tickets.path']
  if (typeof path === 'string' && !path.includes('NN')) issues.push({ path: 'tickets.path', message: 'must match the pattern "NN"' })
  return { ok: true, value: issues }
}
/** An answer the test gives when it chooses: what runs meanwhile is what the person sees while main works. */
function later(): { answer: () => Promise<Answer>; settle: (value: Answer) => void } {
  let settle: (value: Answer) => void = () => undefined
  const promise = new Promise<Answer>((resolve) => {
    settle = resolve
  })
  return { answer: () => promise, settle: (value) => settle(value) }
}
const ACCOUNTS = { status: 'accounts', repos: [{ host: 'github.com', slug: 'shop/shop' }], skipped: [] }
const FIXED_FP = `sha256:${'c'.repeat(64)}`
const READ: ProfileEditRead = { available: true, name: 'shop', values: VALUES, fixed: { mode: 'full', 'workflow.folder': null }, fixedFingerprint: FIXED_FP, interrupted: false, severalRepos: false, fingerprint: FP }
const SILENT_READ: ProfileEditRead = { ...READ, fixed: { mode: 'silent', 'workflow.folder': '/work/shop-workflow' }, fixedFingerprint: `sha256:${'d'.repeat(64)}` }

beforeEach(() => {
  main.calls.length = 0
  main.readOnly = null
  main.answers = {
    'projects.settings.get': { ok: true, value: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '' } } },
    'terminal.shells': { ok: true, value: [] },
    'projects.reviewer.get': { ok: true, value: { status: 'none' } },
    'profileEdit.read': { ok: true, value: READ },
    'profileEdit.check': harnessCheck,
    'profileEdit.write': { ok: true, value: { status: 'saved', fingerprint: FP2, warning: null } },
  }
})
afterEach(cleanup)

/** Project settings, then "Edit profile…", and the Profile read. */
async function openForm(machine?: string): Promise<HTMLElement> {
  render(<ProjectSettings project={PROJECT} machine={machine} onClose={() => undefined} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile…' }))
  const form = await screen.findByTestId('edit-profile')
  await within(form).findByLabelText('Title')
  return form
}
const input = (form: HTMLElement, label: string): HTMLInputElement => within(form).getByLabelText(label) as HTMLInputElement
const calls = (channel: string): unknown[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)
/** The values of the last check: what the form would send. */
const lastCheck = (): Record<string, unknown> => (calls('profileEdit.check').at(-1) as { values: Record<string, unknown> }).values
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

  it('an edit is checked by the Harness; a cleared verify is sent empty, its refusal shows under the field and Save waits', async () => {
    const form = await openForm()
    fireEvent.change(input(form, 'verify'), { target: { value: '' } })
    await checked(form)
    // Empty, not null: null is "no check", which the Harness takes and would write.
    expect(calls('profileEdit.check')).toEqual([{ root: '/repos/shop', values: { ...VALUES, 'commands.verify': '' } }])
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

  it('a cleared ticket path is sent empty and refused at its field; a cleared optional text field is null', async () => {
    const form = await openForm()
    fireEvent.change(input(form, 'Ticket path'), { target: { value: '' } })
    await checked(form)
    expect(lastCheck()['tickets.path']).toBe('')
    const path = form.querySelector('[data-field="tickets.path"]') as HTMLElement
    expect(within(path).getByRole('alert').textContent).toBe('must match the pattern "NN"')
    expect(save(form).disabled).toBe(true)
    fireEvent.change(input(form, 'Ticket path'), { target: { value: 'tickets/NN-*.md' } })
    fireEvent.change(input(form, 'ADR folder'), { target: { value: '' } })
    await checked(form)
    expect(lastCheck()['docs.adr_dir']).toBeNull()
    expect(save(form).disabled).toBe(false)
  })

  it('a list field the Profile does not have stays absent when left empty; one it has is sent as an empty list', async () => {
    const form = await openForm()
    // skills.allowed is absent: [] would be "no skills", absent is "all of them".
    fireEvent.change(input(form, 'Skills allowed'), { target: { value: 'review' } })
    await checked(form)
    expect(lastCheck()['skills.allowed']).toEqual(['review'])
    fireEvent.change(input(form, 'Skills allowed'), { target: { value: ' , ' } })
    await checked(form)
    expect(lastCheck()['skills.allowed']).toBeNull()
    expect(form.textContent).toContain('No changes yet.')
    fireEvent.change(input(form, 'MCP servers'), { target: { value: '' } })
    await checked(form)
    expect(lastCheck()['mcp.allowed']).toEqual([])
  })

  it('Save is off while the write runs: no second write, and neither Escape nor a mousedown closes the form until it ends', async () => {
    const write = later()
    main.answers['profileEdit.write'] = write.answer
    const form = await openForm()
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    await act(async () => {
      fireEvent.click(save(form))
    })
    const saving = within(form).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    expect(saving.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(saving)
    })
    expect(calls('profileEdit.write')).toHaveLength(1)
    expect(input(form, 'Title').disabled).toBe(true)
    fireEvent.keyDown(input(form, 'Title'), { key: 'Escape' })
    fireEvent.mouseDown(input(form, 'Title'))
    fireEvent.mouseDown(form.parentElement as HTMLElement)
    expect(screen.getByTestId('edit-profile')).toBe(form)
    await act(async () => {
      write.settle({ ok: true, value: { status: 'saved', fingerprint: FP2, warning: null } })
    })
    expect(screen.queryByTestId('edit-profile')).toBeNull()
  })

  it('a mousedown inside the form keeps it open; one on the backdrop closes it', async () => {
    const form = await openForm()
    fireEvent.mouseDown(input(form, 'Title'))
    fireEvent.mouseDown(form)
    expect(screen.getByTestId('edit-profile')).toBe(form)
    fireEvent.mouseDown(form.parentElement as HTMLElement)
    expect(screen.queryByTestId('edit-profile')).toBeNull()
  })

  it('a Project shared read-only shows the form without Save, and its fields cannot be changed', async () => {
    main.readOnly = 'shared read-only by pc-1'
    const form = await openForm()
    expect(within(form).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(form).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(within(form).getByTestId('edit-profile-read-only').textContent).toBe('shared read-only by pc-1')
    expect(input(form, 'Title').disabled).toBe(true)
    expect(within(form).queryByRole('button', { name: 'Change account…' })).toBeNull()
  })

  it('a Project of a Linked machine is read from that machine and shown without Save: its Profile is written only there', async () => {
    const form = await openForm('pc-1')
    expect(main.calls.filter((call) => call.channel === 'profileEdit.read').map((call) => call.machine)).toEqual(['pc-1'])
    expect(within(form).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(form).getByTestId('edit-profile-read-only').textContent).toContain('Linked machine')
    expect(input(form, 'Title').disabled).toBe(true)
  })

  it('loading the accounts changes nothing: gh signed out keeps the account and the finish, and Save waits while they load', async () => {
    const accounts = later()
    main.answers['projects.connect.accounts'] = accounts.answer
    const form = await openForm()
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    expect(save(form).disabled).toBe(false)
    fireEvent.click(within(form).getByRole('button', { name: 'Change account…' }))
    // From the first moment of the read, not from its answer.
    expect(save(form).disabled).toBe(true)
    await act(async () => {
      accounts.settle({ ok: true, value: { ...ACCOUNTS, accounts: [], selected: null } })
    })
    const group = await within(form).findByRole('radiogroup', { name: 'GitHub account' })
    // The row marked is the account as written: gh does not list it, so none, not "No account".
    expect((within(group).getByRole('radio', { name: /No account/ }) as HTMLInputElement).checked).toBe(false)
    expect(within(form).getByTestId('edit-profile-account').textContent).toBe('shop-bot')
    expect(within(form).getByLabelText('Finish').getAttribute('data-value')).toBe('pr-green-ci')
    expect(calls('profileEdit.check')).toHaveLength(1)
    expect(save(form).disabled).toBe(false)
  })

  it('a refused fingerprint closes the account step, and Save works again on the Profile read again', async () => {
    main.answers['projects.connect.accounts'] = { ok: true, value: { ...ACCOUNTS, accounts: [], selected: null } }
    main.answers['profileEdit.read'] = [{ ok: true, value: READ }, { ok: true, value: { ...READ, fingerprint: FP2 } }]
    main.answers['profileEdit.write'] = { ok: true, value: { status: 'conflict' } }
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Change account…' }))
    await within(form).findByRole('radiogroup', { name: 'GitHub account' })
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    await act(async () => {
      fireEvent.click(save(form))
    })
    await waitFor(() => expect(calls('profileEdit.read')).toHaveLength(2))
    expect(within(form).queryByRole('radiogroup', { name: 'GitHub account' })).toBeNull()
    expect(within(form).getByRole('button', { name: 'Change account…' })).toBeTruthy()
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    expect(save(form).disabled).toBe(false)
  })

  it('Move to Silent mode: the confirmation says what moves, the move sends the fingerprint of mode and folder, and the form reads the Profile again', async () => {
    main.answers['profileEdit.read'] = [{ ok: true, value: READ }, { ok: true, value: SILENT_READ }]
    main.answers['profileEdit.move'] = { ok: true, value: { status: 'moved', mode: 'silent', folder: '/work/shop-workflow', files: 12, warning: null, ignored: [], recovered: null, qmd: [] } }
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    expect(within(form).getByTestId('move-workflow-summary').textContent).toContain('move out of the repository /repos/shop into the default Workflow folder beside the profile')
    expect(within(form).getByTestId('move-workflow-summary').textContent).toContain('lessons kept in the repository')
    fireEvent.change(within(form).getByTestId('move-workflow-folder'), { target: { value: '/work/shop-workflow' } })
    expect(within(form).getByTestId('move-workflow-summary').textContent).toContain('into the Workflow folder /work/shop-workflow:')
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(calls('profileEdit.move')).toEqual([{ root: '/repos/shop', to: 'silent', folder: '/work/shop-workflow', expected: FIXED_FP }])
    await waitFor(() => expect(within(form).getByTestId('edit-profile-mode').textContent).toBe('silent'))
    expect(within(form).getByTestId('edit-profile-message').textContent).toBe('Moved to Silent mode: 12 files, committed in the repository and in the Workflow folder.')
    expect(within(form).getByTestId('edit-profile-folder').textContent).toBe('/work/shop-workflow')
    expect(within(form).getByRole('button', { name: 'Move to Full mode…' })).toBeTruthy()
  })

  it('an empty Workflow folder moves to the default one, and a relative one is refused before main is asked', async () => {
    main.answers['profileEdit.move'] = { ok: true, value: { status: 'moved', mode: 'silent', folder: '/h/projects/shop/workflow', files: 1, warning: null, ignored: [], recovered: null, qmd: [] } }
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    fireEvent.change(within(form).getByTestId('move-workflow-folder'), { target: { value: 'relative/folder' } })
    expect(within(form).getByText('The Workflow folder must be an absolute path.')).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Move files' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(form).getByTestId('move-workflow-folder'), { target: { value: '' } })
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(calls('profileEdit.move')).toEqual([{ root: '/repos/shop', to: 'silent', folder: null, expected: FIXED_FP }])
  })

  it('a refused move shows the reason and leaves the mode as it was', async () => {
    main.answers['profileEdit.read'] = { ok: true, value: SILENT_READ }
    main.answers['profileEdit.move'] = { ok: true, value: { status: 'refused', reason: 'the repository has uncommitted changes: commit or stash them first — nothing moved' } }
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Full mode…' }))
    expect(within(form).getByTestId('move-workflow-summary').textContent).toContain('from the Workflow folder /work/shop-workflow back into the repository /repos/shop')
    expect(within(form).queryByTestId('move-workflow-folder')).toBeNull()
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(calls('profileEdit.move')).toEqual([{ root: '/repos/shop', to: 'full', folder: null, expected: SILENT_READ.available ? SILENT_READ.fixedFingerprint : '' }])
    expect(within(form).getByTestId('edit-profile-message').textContent).toBe('Not moved: the repository has uncommitted changes: commit or stash them first — nothing moved')
    expect(within(form).getByTestId('edit-profile-mode').textContent).toBe('silent')
    expect(calls('profileEdit.read')).toHaveLength(1)
  })

  it('while main moves the form says so and the button waits; a conflict reads the Profile again, busy asks to move again', async () => {
    const answer = later()
    main.answers['profileEdit.move'] = answer.answer as never
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    act(() => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(screen.getByText('Moving the workflow files…')).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Moving…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      answer.settle({ ok: true, value: { status: 'conflict' } })
    })
    await waitFor(() => expect(calls('profileEdit.read')).toHaveLength(2))
    expect(screen.queryByText('Moving the workflow files…')).toBeNull()
    expect(within(form).getByTestId('edit-profile-message').textContent).toBe(PROFILE_CHANGED)

    main.answers['profileEdit.move'] = { ok: true, value: { status: 'busy' } }
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(within(form).getByTestId('edit-profile-message').textContent).toBe('Another change of this profile is being written. Move again in a moment.')
    expect(calls('profileEdit.read')).toHaveLength(2)
  })

  it('a failed move whose rollback left something says what is left, and the form reads the Profile again', async () => {
    main.answers['profileEdit.move'] = { ok: true, value: { status: 'failed', reason: 'the commit in the Workflow folder failed', left: ['the repository: git reset --keep 1234567'] } }
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    expect(within(form).getByTestId('edit-profile-message').textContent).toBe(
      'The move failed and was not fully rolled back: the commit in the Workflow folder failed. Put right by hand: the repository: git reset --keep 1234567',
    )
    await waitFor(() => expect(calls('profileEdit.read')).toHaveLength(2))
  })

  it('a move names a rolled-back earlier move, the ignored files and the qmd collections that still index the old place', async () => {
    main.answers['profileEdit.read'] = [{ ok: true, value: { ...READ, interrupted: true } }, { ok: true, value: SILENT_READ }]
    main.answers['profileEdit.move'] = {
      ok: true,
      value: { status: 'moved', mode: 'silent', folder: '/work/shop-workflow', files: 3, warning: null, ignored: ['docs/adr/a.png'], recovered: 'rolled-back', qmd: ['shop-docs', 'shop-tickets'] },
    }
    const form = await openForm()
    expect(within(form).getByTestId('move-workflow-interrupted').textContent).toContain('The next move rolls it back first')
    fireEvent.click(within(form).getByRole('button', { name: 'Move to Silent mode…' }))
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Move files' }))
    })
    const text = within(form).getByTestId('edit-profile-message').textContent ?? ''
    expect(text).toContain('A move stopped half-way before was rolled back first.')
    expect(text).toContain('1 file is ignored by the .gitignore at the new place and committed all the same: docs/adr/a.png.')
    expect(text).toContain('The qmd collections shop-docs, shop-tickets still index the old place')
    await waitFor(() => expect(within(form).queryByTestId('move-workflow-interrupted')).toBeNull())
  })

  it('a Silent Project of several repositories gets no move to Full mode, one of a single repository does', async () => {
    main.answers['profileEdit.read'] = { ok: true, value: { ...SILENT_READ, severalRepos: true } }
    const form = await openForm()
    expect(within(form).queryByRole('button', { name: 'Move to Full mode…' })).toBeNull()
    expect(within(form).getByTestId('move-workflow').textContent).toContain('A Project of several repositories stays in Silent mode')
    cleanup()
    main.answers['profileEdit.read'] = { ok: true, value: SILENT_READ }
    const single = await openForm()
    expect(within(single).getByRole('button', { name: 'Move to Full mode…' })).toBeTruthy()
  })

  it('the move waits while the form has unsaved edits, and a Project of a Linked machine has no move', async () => {
    const form = await openForm()
    fireEvent.change(input(form, 'Title'), { target: { value: 'Shop' } })
    await checked(form)
    expect((within(form).getByRole('button', { name: 'Move to Silent mode…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(form).getByText('Save or cancel your edits first: the move reads the profile again.')).toBeTruthy()
    cleanup()
    const linked = await openForm('m-2')
    expect(within(linked).queryByTestId('move-workflow')).toBeNull()
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
