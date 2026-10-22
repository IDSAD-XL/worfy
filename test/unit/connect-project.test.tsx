// The "Add project" dialog (worfy-harness ticket 24, src/renderer/projects/ConnectProject.tsx): the
// mode cards keep one border in both states, a field the Harness refused carries the blocked colour,
// and a check that could not run keeps "Connect" unavailable until a check runs again. The GitHub
// account step (worfy-harness ticket 25): the account chosen by default and the one the person
// picks go into the checked draft with their finish, and "Connect" waits for the accounts.
// Attribution: the form shows the value of the draft main gave it — for a Silent draft main sets
// off whatever the Session proposed (test/contract/projects-connect.test.ts), a Full draft carries
// the Session's value — the value the person picks is written as picked, and the mode cannot change
// under a draft.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectFolder, GithubAccountsStep, ProfileDraft } from '../../src/shared/ipc/projects'

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), invokeOn: vi.fn(), subscribe: vi.fn(() => () => undefined) }))
vi.mock('../../src/renderer/ipc', () => ipc)

const { ConnectProject } = await import('../../src/renderer/projects/ConnectProject')

const folder: ConnectFolder = { kind: 'git', root: '/repos/shop', repos: [{ name: 'shop', path: '/repos/shop' }], notice: null }
const draft: ProfileDraft = {
  profile: { name: 'shop', mode: 'silent', commands: { test: 'npm test' }, language: { reports: 'en', team: 'en', docs: 'en' }, attribution: 'off', workflow: { finish: 'local-green', folder: null } },
  rules: '# shop\n',
  gate: [{ key: 'shop', match: '/repos/shop', profile: 'shop', root: { fast: ['test'], full: ['test'] } }],
}
/** The draft of the same folder in Full mode, with the value the Session proposed. */
const fullDraft: ProfileDraft = { ...draft, profile: { ...draft.profile, mode: 'full', attribution: 'on' } }

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

// worfy-windows ticket 61: a folder inside %TEMP% of Windows gets a warning on the Folder step, not an error.
describe('the Folder step', () => {
  const inTemp: ConnectFolder = { ...folder, root: 'C:/Users/a/AppData/Local/Temp/shop', insideTemp: true }

  it('a folder inside %TEMP% shows the warning with its reason and advice, and the draft can still be written', async () => {
    ipc.invoke.mockImplementation(() => new Promise(() => undefined))
    render(<ConnectProject folder={inTemp} harnessHome="/h" onClose={() => undefined} onConnected={() => undefined} onPickAnother={() => undefined} onFirstRun={() => undefined} />)
    const warning = screen.getByTestId('connect-temp-warning')
    expect(warning.closest('section')?.getAttribute('aria-label')).toBe('Folder')
    expect(warning.textContent).toContain('in %TEMP%')
    expect(warning.textContent).toContain('Storage Sense may delete files from it')
    expect(warning.textContent).toContain('Move the checkout to a folder outside %TEMP%')
    expect(warning.querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
    expect(screen.queryByTestId('connect-message')).toBeNull()
    const write = screen.getByRole('button', { name: 'Write draft' }) as HTMLButtonElement
    expect(write.disabled).toBe(false)
    fireEvent.click(write)
    await waitFor(() => expect(ipc.invoke.mock.calls.some(([channel, input]) => channel === 'projects.connect.draft' && (input as { root: string }).root === inTemp.root)).toBe(true))
  })

  it('a folder outside %TEMP% (no mark) shows no warning', () => {
    open()
    expect(screen.getByTestId('connect-folder').textContent).toBe('/repos/shop')
    expect(screen.queryByTestId('connect-temp-warning')).toBeNull()
  })
})

const NO_ORIGIN: GithubAccountsStep = { status: 'no-origin', reason: 'No GitHub origin: shop has no origin remote.' }

/** The dialog in its form: the draft, the account step's answer, and the check that answer started. */
async function toForm(issues: { path: string; kind: string; message: string }[], accounts: GithubAccountsStep | Promise<GithubAccountsStep> = NO_ORIGIN, mode: 'silent' | 'full' = 'silent') {
  ipc.invoke.mockImplementation((channel: string, input?: { mode?: string }) =>
    channel === 'projects.connect.draft'
      ? Promise.resolve({ ok: true, value: { status: 'draft', draft: input?.mode === 'full' ? fullDraft : draft, issues } })
      : channel === 'projects.connect.accounts'
        ? Promise.resolve(accounts).then((value) => ({ ok: true, value }))
        : Promise.resolve({ ok: true, value: { issues } }),
  )
  open()
  if (mode === 'full') fireEvent.click(screen.getByTestId('connect-mode-full').querySelector('input') as HTMLInputElement)
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

describe('attribution in the form', () => {
  const attribution = (): HTMLElement => screen.getByLabelText('Attribution')
  /** Chooses `value` in the Attribution field: a click on the field, then on the option. */
  const pickAttribution = (value: string): void => {
    fireEvent.click(attribution())
    const option = screen.getAllByRole('option').find((element) => element.getAttribute('data-value') === value)
    if (option === undefined) throw new Error(`no option ${value}`)
    fireEvent.click(option)
  }
  const draftCalls = (): { mode: string }[] => ipc.invoke.mock.calls.filter(([channel]) => channel === 'projects.connect.draft').map(([, input]) => input as { mode: string })
  const written = (): ProfileDraft | undefined => (ipc.invoke.mock.calls.find(([channel]) => channel === 'projects.connect.write')?.[1] as { draft: ProfileDraft } | undefined)?.draft

  it('a Silent draft shows off and Connect writes off', async () => {
    await toForm([])
    await checked()
    expect(draftCalls()).toMatchObject([{ mode: 'silent' }])
    expect(screen.getByTestId('connect-form-mode').textContent).toBe('silent')
    expect(attribution().getAttribute('data-value')).toBe('off')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(written()?.profile).toMatchObject({ mode: 'silent', attribution: 'off' })
  })

  it('a Full draft shows on and Connect writes on', async () => {
    await toForm([], NO_ORIGIN, 'full')
    await checked()
    expect(draftCalls()).toMatchObject([{ mode: 'full' }])
    expect(screen.getByTestId('connect-form-mode').textContent).toBe('full')
    expect(attribution().getAttribute('data-value')).toBe('on')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(written()?.profile).toMatchObject({ mode: 'full', attribution: 'on' })
  })

  it('the value the person picks is checked and written as picked, against the default of the mode', async () => {
    await toForm([])
    await checked()
    pickAttribution('on')
    await checked()
    expect(attribution().getAttribute('data-value')).toBe('on')
    expect(checkedDrafts().at(-1)?.profile).toMatchObject({ mode: 'silent', attribution: 'on' })
    // Another edit of the form leaves the picked value alone.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shop2' } })
    await checked()
    expect(attribution().getAttribute('data-value')).toBe('on')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(written()?.profile).toMatchObject({ name: 'shop2', mode: 'silent', attribution: 'on' })
  })

  it('the mode cannot change under a draft: no control of the form sets it, and every check and the write carry the mode of the draft', async () => {
    await toForm([])
    await checked()
    // No mode cards, no way back to them, and nothing a person could operate under the name "Mode".
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull()
    expect(screen.queryByRole('radio', { name: /Silent mode|Full mode/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryByLabelText('Mode')).toBeNull()
    const shown = screen.getByTestId('connect-form-mode')
    expect(shown.textContent).toBe('silent')
    expect(shown.getAttribute('tabindex')).toBeNull()
    expect(shown.getAttribute('role')).toBeNull()
    expect(shown.querySelector('input, select, button, [role], [tabindex], [contenteditable]')).toBeNull()

    // Operating the shown mode does nothing: no check is asked for, and the text stays.
    const before = checkedDrafts().length
    fireEvent.click(shown)
    fireEvent.keyDown(shown, { key: 'Enter' })
    fireEvent.keyDown(shown, { key: ' ' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await checked()
    expect(checkedDrafts()).toHaveLength(before)
    expect(screen.getByTestId('connect-form-mode').textContent).toBe('silent')

    // Edits of the other fields after that: each check, and then the write, still carry the draft's mode.
    pickAttribution('on')
    await checked()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shop2' } })
    await checked()
    expect(checkedDrafts().length).toBeGreaterThanOrEqual(2)
    expect(checkedDrafts().map((sent) => sent.profile.mode)).toEqual(checkedDrafts().map(() => 'silent'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(written()?.profile).toMatchObject({ mode: 'silent' })
    // One draft was asked for: nothing in the form asked for another one, in another mode.
    expect(draftCalls()).toMatchObject([{ mode: 'silent' }])
    expect(draftCalls()).toHaveLength(1)
  })

  it('a draft that failed, Back, the other mode: the form shows the value of the new draft', async () => {
    let attempt = 0
    ipc.invoke.mockImplementation((channel: string, input?: { mode?: string }) => {
      if (channel === 'projects.connect.draft') {
        attempt += 1
        if (attempt === 1) return Promise.resolve({ ok: true, value: { status: 'failed', reason: 'The draft Session failed: no answer', issues: [] } })
        return Promise.resolve({ ok: true, value: { status: 'draft', draft: input?.mode === 'full' ? fullDraft : draft, issues: [] } })
      }
      return Promise.resolve({ ok: true, value: channel === 'projects.connect.accounts' ? NO_ORIGIN : { issues: [] } })
    })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Write draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    // The mode step again: the controls the form of a draft does not have.
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeTruthy()
    expect(screen.getAllByRole('radio', { name: /Silent mode|Full mode/ })).toHaveLength(2)
    fireEvent.click(screen.getByTestId('connect-mode-full').querySelector('input') as HTMLInputElement)
    fireEvent.click(screen.getByRole('button', { name: 'Write draft' }))
    await screen.findByLabelText('Name')
    expect(draftCalls()).toMatchObject([{ mode: 'silent' }, { mode: 'full' }])
    expect(screen.getByTestId('connect-form-mode').textContent).toBe('full')
    expect(attribution().getAttribute('data-value')).toBe('on')
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
