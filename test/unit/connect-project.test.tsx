// The "Add project" dialog (worfy-harness ticket 24, src/renderer/projects/ConnectProject.tsx): the
// mode cards keep one border in both states, a field the Harness refused carries the blocked colour,
// and a check that could not run keeps "Connect" unavailable until a check runs again. The GitHub
// account step (worfy-harness ticket 25): the account chosen by default and the one the person
// picks go into the checked draft with their finish, and "Connect" waits for the accounts.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectFolder, GithubAccountsStep, ProfileDraft } from '../../src/shared/ipc/projects'

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

const NO_ORIGIN: GithubAccountsStep = { status: 'no-origin', reason: 'No GitHub origin: shop has no origin remote.' }

/** The dialog in its form: the draft, the account step's answer, and the check that answer started. */
async function toForm(issues: { path: string; kind: string; message: string }[], accounts: GithubAccountsStep | Promise<GithubAccountsStep> = NO_ORIGIN) {
  ipc.invoke.mockImplementation((channel: string) =>
    channel === 'projects.connect.draft'
      ? Promise.resolve({ ok: true, value: { status: 'draft', draft, issues } })
      : channel === 'projects.connect.accounts'
        ? Promise.resolve(accounts).then((value) => ({ ok: true, value }))
        : Promise.resolve({ ok: true, value: { issues } }),
  )
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Write draft' }))
  await screen.findByLabelText('Name')
}

/** Waits until the accounts have come and the check of the last edit has come back. */
const checked = async () => {
  await waitFor(() => expect(screen.queryByTestId('connect-github-loading')).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: /Connect/ }).closest('[role=dialog]')?.textContent).not.toContain('Checking the draft'), { timeout: 2000 })
}

/** The drafts the form sent to the check, in order. */
const checkedDrafts = (): ProfileDraft[] => ipc.invoke.mock.calls.filter(([channel]) => channel === 'projects.connect.check').map(([, input]) => (input as { draft: ProfileDraft }).draft)

describe('the form', () => {

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
    await checked()
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

  it('a failed write is not shown any more once the draft is edited: the footer then says what the new check says', async () => {
    await toForm([])
    await checked()
    ipc.invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'projects.connect.write' ? { ok: false, error: 'the write broke' } : { ok: false, error: 'main is gone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByTestId('connect-message').textContent).toContain('the write broke'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shop2' } })
    await waitFor(() => expect(screen.getByTestId('connect-message').textContent).toContain('The draft could not be checked'), { timeout: 2000 })
    expect(screen.getByTestId('connect-message').textContent).not.toContain('the write broke')
  })
})

describe('the GitHub account step', () => {
  const ACCOUNTS: GithubAccountsStep = {
    status: 'accounts',
    repos: [{ name: 'shop', host: 'github.com', slug: 'acme/shop' }],
    skipped: [],
    accounts: [
      { login: 'alice', host: 'github.com', active: true, state: 'success', push: true, finish: 'pr-green-ci', reason: null },
      { login: 'bob', host: 'github.com', active: false, state: 'success', push: false, finish: 'local-green', reason: 'bob has no write access to acme/shop: Tickets will close with the local finish.' },
    ],
    selected: 'alice',
  }

  it('the default account goes into the checked draft with its finish; picking another puts that one and its finish', async () => {
    await toForm([], ACCOUNTS)
    await checked()
    const rows = screen.getAllByTestId('connect-github-account')
    expect(rows.map((row) => row.dataset.login)).toEqual(['alice', 'bob'])
    expect((rows[0]?.querySelector('input') as HTMLInputElement).checked).toBe(true)
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ github: { account: 'alice' }, workflow: { finish: 'pr-green-ci', folder: null } })
    expect(screen.getByTestId('connect-github-reason').textContent).toBe('bob has no write access to acme/shop: Tickets will close with the local finish.')

    fireEvent.click(rows[1]?.querySelector('input') as HTMLInputElement)
    await checked()
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ github: { account: 'bob' }, workflow: { finish: 'local-green' } })
    fireEvent.click(screen.getByTestId('connect-github-none').querySelector('input') as HTMLInputElement)
    await checked()
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ github: { account: null }, workflow: { finish: 'local-green' } })
    // Connect writes the draft with the last choice.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const write = ipc.invoke.mock.calls.find(([channel]) => channel === 'projects.connect.write')
    expect((write?.[1] as { draft: ProfileDraft }).draft.profile).toMatchObject({ github: { account: null }, workflow: { finish: 'local-green' } })
  })

  it('Connect waits for the accounts', async () => {
    let answer: (step: GithubAccountsStep) => void = () => undefined
    await toForm([], new Promise<GithubAccountsStep>((resolve) => (answer = resolve)))
    expect(screen.getByTestId('connect-github-loading')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      answer(ACCOUNTS)
      await Promise.resolve()
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 })
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ github: { account: 'alice' } })
  })

  it('no gh: the reason, the first-run screen, and no account with the local finish', async () => {
    await toForm([], { status: 'no-gh', reason: 'gh not found (gh): install it with brew install gh; the first-run screen checks it.' })
    await checked()
    expect(screen.getByTestId('connect-github-no-gh').textContent).toContain('gh not found')
    expect(screen.getByRole('button', { name: 'First-run checks…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in with gh' })).toBeNull()
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ github: { account: null }, workflow: { finish: 'local-green' } })
  })
})
