import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettings } from '../../src/renderer/shell/ProjectSettings'

// The shell of a Project's Terminals in "Project settings…" (worfy-windows ticket 10). The field is
// there only when the Machine of the Project has shells to choose from (terminal.shells): on Windows.
// main is replaced: what it answers is set by each test, and what it was asked is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as { machine: string | null | undefined; channel: string; input: unknown }[],
}))
const answer = (machine: string | null | undefined, channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ machine, channel, input })
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

beforeEach(() => {
  main.calls.length = 0
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
    const field = screen.getByLabelText<HTMLSelectElement>('Terminal shell')
    expect(field.value).toBe('powershell')
    expect([...field.options].map((option) => option.textContent)).toEqual(['PowerShell (pwsh)', 'Git Bash'])
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })
  })

  it('saves Git Bash with the templates once it is chosen', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Terminal shell'), { target: { value: 'git-bash' } })
    await save()
    expect(saved()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } })
  })

  it('shows the saved choice, says when that shell is not on the Machine, and sends it back with a changed template', async () => {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, terminalShell: 'git-bash' } }
    main.answers['terminal.shells'] = { ok: true, value: [WINDOWS_SHELLS[0], { id: 'git-bash', label: 'Git Bash', found: false }] }
    await open()
    const field = screen.getByLabelText<HTMLSelectElement>('Terminal shell')
    expect(field.value).toBe('git-bash')
    expect(field.selectedOptions[0]?.textContent).toBe('Git Bash — not found on this machine')
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

  it('asks the Machine of the Project for its shells, not the Machine of the window', async () => {
    await open({ machine: 'machine-m' })
    expect(main.calls.filter((call) => call.channel === 'terminal.shells')).toEqual([{ machine: 'machine-m', channel: 'terminal.shells', input: undefined }])
    expect(screen.getByLabelText('Terminal shell')).toBeTruthy()
  })
})
