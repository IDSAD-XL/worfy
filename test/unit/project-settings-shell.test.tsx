import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettings } from '../../src/renderer/shell/ProjectSettings'

// The shell of a Project's Terminals in "Project settings…" (worfy-windows ticket 10). The field is
// there only when the Machine of the Project has shells to choose from (terminal.shells): on Windows.
// main is replaced: what it answers is set by each test, and what it was asked is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
  /** When set, answers terminal.shells instead of `answers`. */
  shells: undefined as (() => Promise<Answer>) | undefined,
}))
const answer = (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
  if (channel === 'terminal.shells' && main.shells !== undefined) return main.shells()
  return Promise.resolve(main.answers[channel] ?? { ok: false, error: `no answer for ${channel}` })
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(undefined, channel, input),
  invokeOn: (machine: string | null, channel: string, input?: unknown) => answer(machine, channel, input),
}))

const TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '' }
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
  main.answers = {
    'projects.settings.get': { ok: true, value: { actionTemplates: TEMPLATES } },
    'projects.settings.set': { ok: true, value: { actionTemplates: TEMPLATES } },
    'terminal.shells': { ok: true, value: WINDOWS_SHELLS },
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
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: { shipTicket: 'my own {epic}', runWave: 'mine' }, terminalShell: 'git-bash' } }
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
})
