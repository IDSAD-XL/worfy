// The "Add project" dialog (worfy-harness ticket 24, src/renderer/projects/ConnectProject.tsx): the
// mode cards keep one border in both states, a field the Harness refused carries the blocked colour,
// and a check that could not run keeps "Connect" unavailable until a check runs again.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectFolder, ProfileDraft } from '../../src/shared/ipc/projects'

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), invokeOn: vi.fn(), subscribe: vi.fn(() => () => undefined) }))
vi.mock('../../src/renderer/ipc', () => ipc)

const { ConnectProject } = await import('../../src/renderer/projects/ConnectProject')

const folder: ConnectFolder = { kind: 'git', root: '/repos/shop', repos: [{ name: 'shop', path: '/repos/shop' }], notice: null }
const draft: ProfileDraft = {
  profile: { name: 'shop', mode: 'silent', commands: { test: 'npm test' }, language: { reports: 'en', team: 'en', docs: 'en' }, attribution: 'on', workflow: { finish: 'local-green', folder: null } },
  rules: '# shop\n',
  gate: [{ key: 'shop', match: '/repos/shop', profile: 'shop', root: { fast: ['test'], full: ['test'] } }],
}

const open = () =>
  render(<ConnectProject folder={folder} harnessHome="/h" onClose={() => undefined} onConnected={() => undefined} onPickAnother={() => undefined} onFirstRun={() => undefined} />)

beforeEach(() => {
  ipc.invoke.mockReset()
})

afterEach(cleanup)

describe('the mode cards', () => {
  it('both cards set the same border longhands; the chosen one only changes its colour', () => {
    open()
    const silent = screen.getByTestId('connect-mode-silent')
    const full = screen.getByTestId('connect-mode-full')
    expect(silent.style.borderColor).toBe('var(--accent)')
    expect(full.style.borderColor).toBe('var(--border)')
    expect(full.style.borderStyle).toBe('solid')
    expect(full.style.border).not.toContain('currentcolor')
    fireEvent.click(full.querySelector('input') as HTMLInputElement)
    expect(full.style.borderColor).toBe('var(--accent)')
    expect(silent.style.borderColor).toBe('var(--border)')
  })
})

describe('the form', () => {
  async function toForm(issues: { path: string; kind: string; message: string }[]) {
    ipc.invoke.mockImplementation((channel: string) =>
      channel === 'projects.connect.draft' ? Promise.resolve({ ok: true, value: { status: 'draft', draft, issues } }) : Promise.resolve({ ok: true, value: { issues: [] } }),
    )
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Write draft' }))
    await screen.findByLabelText('Name')
  }

  it('a field the Harness refused has the blocked colour on its border; a valid one does not', async () => {
    await toForm([{ path: 'profile.name', kind: 'conflict', message: 'the name is taken' }])
    const name = screen.getByLabelText('Name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.style.borderColor).toBe('var(--blocked-text)')
    expect(name.className).toContain('w-connect-input')
    const test = screen.getByLabelText('test')
    expect(test.getAttribute('aria-invalid')).toBeNull()
    expect(test.style.borderColor).toBe('var(--border-strong)')
  })

  it('a check that could not run keeps Connect unavailable and says so; the next check that runs clears it', async () => {
    await toForm([])
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(connect.disabled).toBe(false)

    ipc.invoke.mockImplementation(() => Promise.resolve({ ok: false, error: 'main is gone' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shop2' } })
    await waitFor(() => expect(screen.getByTestId('connect-message').textContent).toContain('The draft could not be checked'), { timeout: 2000 })
    expect(connect.disabled).toBe(true)
    // Clicking it anyway writes nothing.
    await act(async () => {
      fireEvent.click(connect)
      await Promise.resolve()
    })
    expect(ipc.invoke.mock.calls.some(([channel]) => channel === 'projects.connect.write')).toBe(false)

    ipc.invoke.mockImplementation(() => Promise.resolve({ ok: true, value: { issues: [] } }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shop3' } })
    await waitFor(() => expect(connect.disabled).toBe(false), { timeout: 2000 })
    expect(screen.queryByTestId('connect-message')).toBeNull()
  })
})
