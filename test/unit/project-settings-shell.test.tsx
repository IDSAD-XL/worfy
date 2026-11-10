import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettings } from '../../src/renderer/shell/ProjectSettings'

// The shell of a Project's Terminals in "Project settings…" (worfy-windows ticket 10). The field is
// there only when the Machine of the Project has shells to choose from (terminal.shells): on Windows.
// "Team reviewer" of the same dialog (worfy-human-review ticket 09): its states and buttons.
// main is replaced: what it answers is set by each test, and what it was asked is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
  /** When set, answers terminal.shells instead of `answers`. */
  shells: undefined as (() => Promise<Answer>) | undefined,
  /** The read-only hint by Machine ('' — this Machine), as useReadOnly() answers it (worfy-link ticket 25). */
  readOnly: {} as Record<string, string>,
}))
const answer = (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
  if (channel === 'terminal.shells' && main.shells !== undefined) return main.shells()
  return Promise.resolve(main.answers[channel] ?? { ok: false, error: `no answer for ${channel}` })
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(undefined, channel, input),
  invokeOn: (machine: string | null, channel: string, input?: unknown) => answer(machine, channel, input),
  windowMachine: () => null,
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useReadOnly: (machine: string | null) => main.readOnly[machine ?? ''] ?? null,
}))

const TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '', prReply: '' }
const WINDOWS_SHELLS = [
  { id: 'powershell', label: 'PowerShell (pwsh)', found: true },
  { id: 'git-bash', label: 'Git Bash', found: true },
]
const PROJECT = { id: 'demo-00000001', name: 'demo' }

async function open(props: { machine?: string | null } = {}) {
  const onClose = vi.fn()
  render(<ProjectSettings project={PROJECT} onClose={onClose} {...props} />)
  // The settings and the shells arrive.
  await act(async () => {})
  return { onClose }
}
const save = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
}
const saved = (): unknown => main.calls.find((call) => call.channel === 'projects.settings.set')?.input

// The field is the shared Select: a button named by its label, with the chosen shell in data-value,
// and a listbox that is in the document only while it is open. The open list takes the label's
// name too, so the button is found by its test id.
const shell = (): HTMLElement => screen.getByTestId('project-settings-shell')
const chosen = (): string | null => shell().getAttribute('data-value')
const shellList = (): HTMLElement | null => screen.queryByRole('listbox', { name: 'Terminal shell' })
const shellOptions = (): (string | null)[] => {
  fireEvent.click(shell())
  const rows = within(screen.getByRole('listbox', { name: 'Terminal shell' }))
    .getAllByRole('option')
    .map((option) => option.textContent)
  fireEvent.click(shell())
  return rows
}
const chooseShell = (label: string): void => {
  fireEvent.click(shell())
  fireEvent.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => {
  main.calls.length = 0
  main.shells = undefined
  main.readOnly = {}
  main.answers = {
    'projects.settings.get': { ok: true, value: { actionTemplates: TEMPLATES } },
    'projects.settings.set': { ok: true, value: { actionTemplates: TEMPLATES } },
    'terminal.shells': { ok: true, value: WINDOWS_SHELLS },
    'projects.reviewer.get': { ok: true, value: { status: 'none' } },
  }
})

describe('the shell of the Terminals in Project settings', () => {
  it('is not shown on a Machine with no shells to choose from, and saving sends the templates alone', async () => {
    main.answers['terminal.shells'] = { ok: true, value: [] }
    const { onClose } = await open()
    expect(screen.queryByLabelText('Terminal shell')).toBeNull()
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('is not shown when the Machine cannot say which shells it has', async () => {
    main.answers['terminal.shells'] = { ok: false, error: 'no handler' }
    await open()
    expect(screen.queryByLabelText('Terminal shell')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows PowerShell chosen when the Project has no choice saved, and saves no choice until the user makes one', async () => {
    await open()
    expect(chosen()).toBe('powershell')
    expect(shell().textContent).toBe('PowerShell (pwsh)')
    expect(shellOptions()).toEqual(['PowerShell (pwsh)', 'Git Bash'])
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })
  })

  it('saves Git Bash with the templates once it is chosen', async () => {
    await open()
    chooseShell('Git Bash')
    expect(chosen()).toBe('git-bash')
    expect(shellList()).toBeNull()
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } })
  })

  it('is a Select, not a native select element: a button with the test id and the name of its label', async () => {
    await open()
    expect(document.querySelector('select')).toBeNull()
    const field = screen.getByRole('combobox', { name: 'Terminal shell' })
    expect(field).toBe(shell())
    expect(field).toBe(screen.getByLabelText('Terminal shell'))
    expect(field.tagName).toBe('BUTTON')
    // The field has the look of the window's text fields.
    expect(field.style.height).toBe('var(--row-height)')
  })

  it('Esc on the open list of shells closes the list alone; the next Esc closes the window', async () => {
    const { onClose } = await open()
    fireEvent.click(shell())
    expect(shellList()).not.toBeNull()
    fireEvent.keyDown(shell(), { key: 'Escape' })
    expect(shellList()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(shell(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a press on the open list of shells does not close the window, though the list is drawn outside it', async () => {
    const { onClose } = await open()
    fireEvent.click(shell())
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Git Bash' }))
    fireEvent.click(screen.getByRole('option', { name: 'Git Bash' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(chosen()).toBe('git-bash')
    expect(screen.getByTestId('project-settings')).toBeTruthy()
  })

  it('shows the saved choice, says when that shell is not on the Machine, and sends it back with a changed template', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } }
    main.answers['terminal.shells'] = { ok: true, value: [WINDOWS_SHELLS[0], { id: 'git-bash', label: 'Git Bash', found: false }] }
    await open()
    expect(chosen()).toBe('git-bash')
    expect(shell().textContent).toBe('Git Bash — not found on this machine')
    expect(shellOptions()).toEqual(['PowerShell (pwsh)', 'Git Bash — not found on this machine'])
    fireEvent.change(screen.getByLabelText('Run wave'), { target: { value: '/wave {tickets}' } })
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: { ...TEMPLATES, runWave: '/wave {tickets}' }, terminalShell: 'git-bash' } })
  })

  it('keeps a saved choice on a Machine that shows no field', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } }
    main.answers['terminal.shells'] = { ok: true, value: [] }
    await open()
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } })
  })

  it('Reset to default puts the default templates back and leaves the chosen shell as it is', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: { shipTicket: 'my own {epic}', runWave: 'mine', gateQueue: '', prReply: '' }, terminalShell: 'git-bash' } }
    main.answers['projects.settings.defaults'] = { ok: true, value: { actionTemplates: TEMPLATES } }
    await open()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    })
    expect(chosen()).toBe('git-bash')
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } })
  })

  it('is not shown while the settings of the Project are not there, though the Machine has shells', async () => {
    main.answers['projects.settings.get'] = { ok: false, error: 'the settings could not be read' }
    await open()
    expect(screen.queryByLabelText('Terminal shell')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('the settings could not be read')
  })

  it('a save that fails keeps the window open with the choice as it was made', async () => {
    main.answers['projects.settings.set'] = { ok: false, error: 'the disk is full' }
    const { onClose } = await open()
    chooseShell('Git Bash')
    await save()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('the disk is full')
    expect(chosen()).toBe('git-bash')
  })

  it('drops the shells of a Project that is no longer the one shown: a late answer for the first does not bring the field back', async () => {
    // The first Project's Machine answers late; the second one's at once, with no shells.
    let late: (answer: Answer) => void = () => undefined
    const first = new Promise<Answer>((resolve) => (late = resolve))
    const shells = vi.fn<() => Promise<Answer>>().mockReturnValueOnce(first).mockResolvedValue({ ok: true, value: [] })
    main.shells = shells
    const onClose = vi.fn()
    const view = render(<ProjectSettings project={PROJECT} onClose={onClose} />)
    await act(async () => {})
    view.rerender(<ProjectSettings project={{ id: 'other-00000002', name: 'other' }} onClose={onClose} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Terminal shell')).toBeNull()
    await act(async () => {
      late({ ok: true, value: WINDOWS_SHELLS })
      await first
    })
    expect(shells).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('Terminal shell')).toBeNull()
  })

  it('asks the Machine of the Project for its shells, not the Machine of the window', async () => {
    await open({ machine: 'machine-m' })
    expect(main.calls.filter((call) => call.channel === 'terminal.shells')).toEqual([{ machine: 'machine-m', channel: 'terminal.shells', input: undefined }])
    expect(screen.getByLabelText('Terminal shell')).toBeTruthy()
  })

  it('on a Linked machine that shares the Project read-only, shows the settings with the reason and saves nothing (worfy-link ticket 25)', async () => {
    main.readOnly = { 'mini-machine': 'Mini gives this Machine read-only access' }
    main.answers['terminal.shells'] = { ok: true, value: [] }
    await open({ machine: 'mini-machine' })
    expect(screen.getByTestId('project-settings-read-only').textContent).toBe('Mini gives this Machine read-only access')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    // Enter in a template field saves as well; not here.
    const field = screen.getAllByRole('textbox')[0]!
    fireEvent.change(field, { target: { value: '/ship-ticket {epic} {NN} now' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    await save()
    expect(saved()).toBeUndefined()
  })

  it('a Linked machine with Full access saves as before, though another one is read-only', async () => {
    main.readOnly = { 'other-machine': 'Other gives this Machine read-only access' }
    main.answers['terminal.shells'] = { ok: true, value: [] }
    await open({ machine: 'mini-machine' })
    expect(screen.queryByTestId('project-settings-read-only')).toBeNull()
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })
  })
})

// worfy-human-review ticket 09: "Team reviewer" shows the state main reads from the Profile's private
// folder (projects.reviewer.get), "Build" or, once built, "Update" (ticket 10), and "Delete" behind a confirmation.
describe('Team reviewer in Project settings', () => {
  const section = (): HTMLElement => screen.getByTestId('team-reviewer')
  const stateText = (): string | null => screen.getByTestId('team-reviewer-state').textContent
  const button = (name: string): HTMLButtonElement => within(section()).getByRole('button', { name }) as HTMLButtonElement
  const press = async (name: string): Promise<void> => {
    await act(async () => {
      fireEvent.click(button(name))
    })
  }
  const asked = (channel: string) => main.calls.filter((call) => call.channel === channel)
  // Noon local time: the date the window shows is that day wherever the test runs.
  const BUILT_AT = new Date(2026, 10, 1, 12).toISOString()

  it('three states: not built, built with its date and pull requests, too little history', async () => {
    await open()
    expect(stateText()).toBe('Not built')
    expect(button('Build').disabled).toBe(false)
    expect(button('Delete').disabled).toBe(true)
    cleanup()

    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'built', builtAt: BUILT_AT, pullRequests: 214 } }
    await open()
    expect(stateText()).toBe('Built 2026-11-01, 214 PRs')
    expect(within(section()).queryByRole('button', { name: 'Build' })).toBeNull()
    expect(button('Update').disabled).toBe(false)
    expect(button('Delete').disabled).toBe(false)
    cleanup()

    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'short', substantive: 12, threshold: 30 } }
    await open()
    expect(stateText()).toBe('Too little history: 12 of 30')
    expect(button('Build').disabled).toBe(false)
    expect(button('Delete').disabled).toBe(false)
  })

  it('a Profile folder that cannot be found says why, without buttons', async () => {
    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'unavailable', reason: 'the folder is in no registered project' } }
    await open()
    expect(stateText()).toBe('Not available: the folder is in no registered project')
    expect(within(section()).queryAllByRole('button')).toEqual([])
  })

  it('"Build" starts the generator\'s Session for the Project and closes the window; a refusal stays on screen', async () => {
    main.answers['projects.reviewer.build'] = { ok: true, value: { nodeId: 'node-1', sessionId: 'session-1' } }
    const { onClose } = await open()
    await press('Build')
    expect(asked('projects.reviewer.build')).toEqual([{ machine: undefined, channel: 'projects.reviewer.build', input: { id: PROJECT.id } }])
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()

    main.answers['projects.reviewer.build'] = { ok: false, error: 'The Project is not in the list' }
    const refused = await open()
    await press('Build')
    expect(refused.onClose).not.toHaveBeenCalled()
    expect(within(section()).getByRole('alert').textContent).toBe('The Project is not in the list')
  })

  it('"Update" of a built reviewer starts the generator with refresh and closes the window (worfy-human-review ticket 10)', async () => {
    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'built', builtAt: BUILT_AT, pullRequests: 214 } }
    main.answers['projects.reviewer.build'] = { ok: true, value: { nodeId: 'node-1', sessionId: 'session-1' } }
    const { onClose } = await open()
    expect(within(section()).queryByRole('button', { name: 'Rebuild' })).toBeNull()
    await press('Update')
    expect(asked('projects.reviewer.build')).toEqual([{ machine: undefined, channel: 'projects.reviewer.build', input: { id: PROJECT.id, refresh: true } }])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('"Build" with an edit not saved keeps the window open with the edit, and says where the Session is', async () => {
    main.answers['projects.reviewer.build'] = { ok: true, value: { nodeId: 'node-1', sessionId: 'session-1' } }
    const { onClose } = await open()
    const field = screen.getAllByRole('textbox')[0]!
    fireEvent.change(field, { target: { value: '/ship-ticket {epic} {NN} now' } })
    await press('Build')
    expect(asked('projects.reviewer.build')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('/ship-ticket {epic} {NN} now')
    expect(within(section()).getByRole('status').textContent).toBe('The Session has started on the Canvas. Save or Cancel your changes to see it.')
  })

  it('"Build" and "Delete" of a Project on a Linked machine go to that Machine', async () => {
    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'built', builtAt: BUILT_AT, pullRequests: 4 } }
    main.answers['projects.reviewer.build'] = { ok: true, value: { nodeId: 'node-1', sessionId: 'session-1' } }
    main.answers['projects.reviewer.delete'] = { ok: true, value: { status: 'none' } }
    await open({ machine: 'mini-machine' })
    await press('Delete')
    await press('Delete')
    expect(asked('projects.reviewer.delete')).toEqual([{ machine: 'mini-machine', channel: 'projects.reviewer.delete', input: { id: PROJECT.id } }])
    await press('Build')
    expect(asked('projects.reviewer.build')).toEqual([{ machine: 'mini-machine', channel: 'projects.reviewer.build', input: { id: PROJECT.id } }])
  })

  it('"Delete" asks first: "Keep" deletes nothing, "Delete" erases and shows the state after', async () => {
    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'built', builtAt: BUILT_AT, pullRequests: 214 } }
    main.answers['projects.reviewer.delete'] = { ok: true, value: { status: 'none' } }
    await open()
    await press('Delete')
    const confirm = within(section()).getByRole('group', { name: 'Delete the team reviewer' })
    expect(confirm.textContent).toContain('Delete the team reviewer? Its files in the Profile folder are erased.')
    await press('Keep')
    expect(asked('projects.reviewer.delete')).toEqual([])
    expect(stateText()).toBe('Built 2026-11-01, 214 PRs')

    await press('Delete')
    await press('Delete')
    expect(asked('projects.reviewer.delete')).toEqual([{ machine: undefined, channel: 'projects.reviewer.delete', input: { id: PROJECT.id } }])
    expect(stateText()).toBe('Not built')
    expect(button('Build').disabled).toBe(false)
  })

  it('on a Linked machine asks that Machine; shared read-only, the state shows without buttons', async () => {
    main.answers['projects.reviewer.get'] = { ok: true, value: { status: 'built', builtAt: BUILT_AT, pullRequests: null } }
    await open({ machine: 'mini-machine' })
    expect(asked('projects.reviewer.get')).toEqual([{ machine: 'mini-machine', channel: 'projects.reviewer.get', input: { id: PROJECT.id } }])
    expect(stateText()).toBe('Built 2026-11-01')
    expect(button('Update').disabled).toBe(false)
    cleanup()

    main.readOnly = { 'mini-machine': 'Mini gives this Machine read-only access' }
    await open({ machine: 'mini-machine' })
    expect(stateText()).toBe('Built 2026-11-01')
    expect(within(section()).queryAllByRole('button')).toEqual([])
  })
})

// «Product Session may also write here» of Project settings (worfy-polish ticket 82): one row per folder
// «Always allow in <folder>» added, each with «Remove»; a removal goes out with Save, and a Save without
// one does not send the list, so a folder added meanwhile stays.
describe('the folders a Product Session may also write in, in Project settings', () => {
  const FOLDERS = ['/repo/context/strong', '/repo/notes']
  const list = (): HTMLElement => screen.getByTestId('product-write-folders')
  const rows = (): (string | null)[] => within(list()).queryAllByTestId('product-write-folder').map((row) => row.querySelector('code')?.textContent ?? null)

  it('says there are none when the list is empty or absent', async () => {
    await open()
    expect(within(list()).getByTestId('product-write-folders-empty').textContent).toBe('No folders yet.')
    expect(rows()).toEqual([])
  })

  it('lists each folder with Remove; Save after a removal sends the folder removed, not the list left, and closes', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, productWriteFolders: FOLDERS } }
    const { onClose } = await open()
    expect(rows()).toEqual(FOLDERS)
    fireEvent.click(within(list()).getByRole('button', { name: `Remove ${FOLDERS[0]}` }))
    expect(rows()).toEqual([FOLDERS[1]])
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, productWriteFoldersRemoved: [FOLDERS[0]] } })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('the hint names "Always allow in" in plain quotes, and a long path wraps rather than losing its end', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, productWriteFolders: FOLDERS } }
    await open()
    expect(list().textContent).toContain('"Always allow in"')
    expect(list().textContent).not.toMatch(/[«»]/)
    const path = within(list()).getAllByTestId('product-write-folder')[0]?.querySelector('code')
    expect(path?.style.overflowWrap).toBe('anywhere')
    expect(path?.style.textOverflow).toBe('')
  })

  it('a Save without a removal does not send the list', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, productWriteFolders: FOLDERS } }
    await open()
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })
  })

  it('a removal not saved counts as an edit: "Build" of the team reviewer then keeps the window open', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, productWriteFolders: FOLDERS } }
    main.answers['projects.reviewer.build'] = { ok: true, value: null }
    const { onClose } = await open()
    fireEvent.click(within(list()).getByRole('button', { name: `Remove ${FOLDERS[1]}` }))
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('team-reviewer')).getByRole('button', { name: 'Build' }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shared read-only, the rows show and Remove is off', async () => {
    main.readOnly = { 'mini-machine': 'Read-only' }
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, productWriteFolders: FOLDERS } }
    await open({ machine: 'mini-machine' })
    expect(rows()).toEqual(FOLDERS)
    expect((within(list()).getByRole('button', { name: `Remove ${FOLDERS[0]}` }) as HTMLButtonElement).disabled).toBe(true)
  })
})
