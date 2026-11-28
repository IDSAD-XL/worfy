// The verification paths in "Edit profile" (worfy-harness-guarantees ticket 02, src/renderer/projects/EditProfile.tsx):
// the files that judge work, as bin/profile resolves them — the Harness's defaults, then the Profile's globs — are
// listed read-only, with no input, and Save never sends them. A Harness that printed none (null), and a Machine
// whose worfy does not read them (the field absent), show why there is no list. main is replaced: the read is set
// by each test, and what Save sent is recorded.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_EDIT_FIELDS, type ProfileEditRead } from '../../src/shared/ipc/profile-edit'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  read: null as unknown,
  calls: [] as { channel: string; input: unknown }[],
}))
const answer = (channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ channel, input })
  if (channel === 'profileEdit.read') return Promise.resolve({ ok: true, value: main.read })
  if (channel === 'profileEdit.check') return Promise.resolve({ ok: true, value: [] })
  if (channel === 'profileEdit.write') return Promise.resolve({ ok: true, value: { status: 'saved', fingerprint: `sha256:${'b'.repeat(64)}`, warning: null } })
  return Promise.resolve({ ok: false, error: `no answer for ${channel}` })
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(channel, input),
  invokeOn: (_machine: string | null, channel: string, input?: unknown) => answer(channel, input),
  subscribe: () => () => undefined,
  windowMachine: () => null,
  hasPreloadBridge: () => false,
}))

const { EditProfile, VERIFICATION_MISSING, VERIFICATION_NOTE } = await import('../../src/renderer/projects/EditProfile')

const DEFAULTS = ['.github/workflows/**', '.github/actions/**', 'CLAUDE.md', 'AGENTS.md', '.claude/**', '.codex/**', '.mcp.json']
const ADDED = ['scripts/ci-*.mjs', 'test/quarantine/**']
const VALUES: Record<string, unknown> = Object.fromEntries(PROFILE_EDIT_FIELDS.map((field) => [field, null]))
Object.assign(VALUES, { title: 'Shop', 'commands.verify': 'make check', 'tickets.path': '.scratch/<epic>/issues/NN-*.md', 'workflow.finish': 'pr-green-ci' })
const READ: ProfileEditRead = {
  available: true,
  name: 'shop',
  values: VALUES,
  fixed: { mode: 'full', 'workflow.folder': null },
  fixedFingerprint: `sha256:${'c'.repeat(64)}`,
  interrupted: false,
  severalRepos: false,
  fingerprint: `sha256:${'a'.repeat(64)}`,
  verificationPaths: [...DEFAULTS, ...ADDED],
  verificationPathsMiss: null,
}

beforeEach(() => {
  main.calls.length = 0
  main.read = READ
})
afterEach(() => cleanup())

async function openForm(): Promise<HTMLElement> {
  render(<EditProfile project={{ name: 'shop', path: '/repos/shop' }} readOnly={null} onClose={() => undefined} onSaved={() => undefined} />)
  const form = await vi.waitFor(() => screen.getByTestId('edit-profile'))
  await vi.waitFor(() => within(form).getByLabelText('Title'))
  return form
}

describe('Edit profile: the verification paths', () => {
  it('lists the defaults, then the globs of the Profile, read-only', async () => {
    const form = await openForm()
    const section = within(form).getByRole('region', { name: 'Verification paths' })
    const list = within(section).getByRole('list', { name: 'Files that judge work' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([...DEFAULTS, ...ADDED])
    expect(within(section).queryAllByRole('textbox')).toEqual([])
    expect(within(section).queryAllByRole('combobox')).toEqual([])
    expect(within(section).queryAllByRole('button')).toEqual([])
    expect(within(section).getByText(VERIFICATION_NOTE)).toBeTruthy()
  })

  it('Save sends the fields of the form and no verification path', async () => {
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Shop 2' } })
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    await vi.waitFor(() => expect(save.disabled).toBe(false))
    await act(async () => {
      fireEvent.click(save)
    })
    const write = main.calls.find((call) => call.channel === 'profileEdit.write')?.input as { values: Record<string, unknown> } | undefined
    expect(write?.values.title).toBe('Shop 2')
    expect(Object.keys(write?.values ?? {}).filter((field) => field.startsWith('verification'))).toEqual([])
    expect(JSON.stringify(write)).not.toContain('scripts/ci-*.mjs')
  })

  it.each([
    ['the Harness refused the Profile', null, 'profile', VERIFICATION_MISSING.profile],
    ['the Harness does not know the field', null, 'harness', VERIFICATION_MISSING.harness],
    ['the read failed', null, 'failed', VERIFICATION_MISSING.failed],
    ['the Machine does not read them', undefined, undefined, VERIFICATION_MISSING.linked],
  ])('says why there is no list when %s', async (_case, verificationPaths, verificationPathsMiss, shown) => {
    const read: Record<string, unknown> = { ...READ, verificationPaths, verificationPathsMiss }
    if (verificationPaths === undefined) delete read.verificationPaths
    if (verificationPathsMiss === undefined) delete read.verificationPathsMiss
    main.read = read
    const form = await openForm()
    const section = within(form).getByRole('region', { name: 'Verification paths' })
    expect(within(section).queryByRole('list')).toBeNull()
    expect(within(section).getByTestId('edit-profile-verification-missing').textContent).toBe(shown)
  })

  it('review round 1: a broken profile field says to fix the field, a Linked machine without the field says to update worfy there', () => {
    expect(VERIFICATION_MISSING.profile).toContain('fix the profile field')
    expect(VERIFICATION_MISSING.linked).toContain('update worfy on that machine')
  })
})
