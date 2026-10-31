import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot, type WhatsNew } from '../../src/shared/ipc/update'
import UpdateChip from '../../src/renderer/update/UpdateChip'

// worfy-update ticket 10: "What's new" from the version chip's menu. The item sits between "Update
// worfy" and "Later" and opens a popover under the chip: "What's new in worfy <version>", a line
// "<PR title> #<number>" for each PR (the number opens the PR in the system's browser), "…and more on
// GitHub" when the comparison was cut at 250 commits, and "Update worfy". A failure shows its reason.
// The titles are GitHub's text: shown as text, never as markup.

const SHA = 'b'.repeat(40)
const NEW = '0.5.0+bbbbbbb'
const COMPARE = `https://github.com/IDSAD-XL/worfy/compare/${'a'.repeat(40)}...${SHA}`

const snapshot = (fields: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({ ...updateSnapshotSchema.parse({ enabled: true, checking: false }), ...fields })
const withUpdate = (fields: Partial<UpdateSnapshot> = {}): UpdateSnapshot => snapshot({ available: { sha: SHA, version: NEW, quiet: false }, ...fields })

const ANSWER: WhatsNew = {
  version: NEW,
  items: [
    { title: 'feat(update): What\'s new after an Update <img src=x onerror="alert(1)">', number: 1130 },
    { title: 'fix(update): sticky toasts', number: 1124 },
  ],
  more: false,
  compareUrl: COMPARE,
}

const globals = globalThis as { worfy?: WorfyBridge }

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

/** A preload bridge that records each call; `whatsNew` is what main answers to update.whatsNew. */
function fakeBridge(whatsNew: Answer | Promise<Answer>) {
  const calls: { channel: string; input: unknown }[] = []
  globals.worfy = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input })
      if (channel === 'update.whatsNew') return Promise.resolve(whatsNew)
      if (channel === 'update.install') return Promise.resolve({ ok: true, value: snapshot() })
      if (channel === 'update.restart') return Promise.resolve({ ok: true, value: { outcome: 'waiting' } })
      if (channel === 'shell.openExternal') return Promise.resolve({ ok: true, value: { url: (input as { url: string }).url } })
      return Promise.resolve({ ok: false, error: `${channel}: not in this test` })
    },
    on: () => 0,
    off: () => undefined,
  } as unknown as WorfyBridge
  return calls
}

afterEach(() => {
  cleanup()
  delete globals.worfy
})

const chip = (): HTMLElement => screen.getByTestId('app-version')
const items = (): string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '')

/** Opens the chip's menu and chooses "What's new"; answers the popover once main has answered. */
async function openWhatsNew(): Promise<HTMLElement> {
  fireEvent.click(chip())
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: "What's new" }))
    await Promise.resolve()
  })
  return screen.getByRole('dialog', { name: `What's new in worfy ${NEW}` })
}

describe("What's new", () => {
  it('is the menu item between "Update worfy" and "Later", in every phase of the chip', () => {
    fakeBridge({ ok: true, value: ANSWER })
    const phases: Partial<UpdateSnapshot>[] = [
      {},
      { build: { phase: 'building', sha: SHA, version: NEW } },
      { build: { phase: 'ready', sha: SHA, version: NEW }, idle: true },
      { build: { phase: 'failed', sha: SHA, version: NEW } },
    ]
    const first = ['Update worfy', `Building worfy ${NEW}…`, 'Restart now', 'Update worfy']
    phases.forEach((fields, at) => {
      render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate(fields)} />)
      fireEvent.click(chip())
      expect(items()).toEqual([first[at], "What's new", 'Later'])
      cleanup()
    })
  })

  it('shows the heading, a line "<title> #<number>" for each PR, newest first, the titles as text; no "…and more" under 250 commits', async () => {
    const calls = fakeBridge({ ok: true, value: ANSWER })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    // The menu is gone; the popover asked main once.
    expect(screen.queryByRole('menu')).toBeNull()
    expect(calls.filter((call) => call.channel === 'update.whatsNew')).toHaveLength(1)
    expect(within(popover).getByRole('heading').textContent).toBe(`What's new in worfy ${NEW}`)
    const lines = within(popover).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent)).toEqual([`${ANSWER.items[0]!.title} #1130`, 'fix(update): sticky toasts #1124'])
    // A title is text: the markup in it is not an element.
    expect(popover.querySelector('img')).toBeNull()
    expect(within(popover).queryByText('…and more on GitHub')).toBeNull()
  })

  it('the number opens its PR in the system browser (shell.openExternal); "…and more on GitHub" opens the comparison page', async () => {
    const calls = fakeBridge({ ok: true, value: { ...ANSWER, more: true } })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    const opened = () => calls.filter((call) => call.channel === 'shell.openExternal').map((call) => (call.input as { url: string }).url)

    const number = within(popover).getByRole('link', { name: '#1124' })
    await act(async () => {
      fireEvent.click(number)
      await Promise.resolve()
    })
    expect(opened()).toEqual(['https://github.com/IDSAD-XL/worfy/pull/1124'])

    await act(async () => {
      fireEvent.click(within(popover).getByRole('link', { name: '…and more on GitHub' }))
      await Promise.resolve()
    })
    expect(opened()).toEqual(['https://github.com/IDSAD-XL/worfy/pull/1124', COMPARE])
  })

  it('"Update worfy" calls update.install and closes the popover', async () => {
    const calls = fakeBridge({ ok: true, value: ANSWER })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    await act(async () => {
      fireEvent.click(within(popover).getByRole('button', { name: 'Update worfy' }))
      await Promise.resolve()
    })
    expect(calls.map((call) => call.channel)).toEqual(['update.whatsNew', 'update.install'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('with a ready build the button is the chip\'s own: "Restart when idle" asks update.restart', async () => {
    const calls = fakeBridge({ ok: true, value: ANSWER })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate({ build: { phase: 'ready', sha: SHA, version: NEW }, idle: false })} />)
    const popover = await openWhatsNew()
    await act(async () => {
      fireEvent.click(within(popover).getByRole('button', { name: 'Restart when idle' }))
      await Promise.resolve()
    })
    expect(calls.at(-1)).toEqual({ channel: 'update.restart', input: { when: 'idle' } })
  })

  it('a failure shows its reason as text; no line, no button press needed', async () => {
    fakeBridge({ ok: false, error: "update.whatsNew failed: What's new could not be read from GitHub: GET /repos/IDSAD-XL/worfy/compare/a...b: fetch failed" })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    expect(within(popover).getByRole('alert').textContent).toBe("What's new could not be read from GitHub: GET /repos/IDSAD-XL/worfy/compare/a...b: fetch failed")
    expect(within(popover).queryAllByRole('listitem')).toEqual([])
  })

  it('while main reads: a line that says so; no PRs between the copies: a line that says so', async () => {
    let answer: (value: Answer) => void = () => undefined
    fakeBridge(new Promise<Answer>((done) => (answer = done)))
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    expect(within(popover).getByRole('status').textContent).toBe('Reading the pull requests on GitHub…')
    await act(async () => {
      answer({ ok: true, value: { ...ANSWER, items: [] } })
      await Promise.resolve()
    })
    expect(within(popover).getByRole('status').textContent).toBe('No pull requests between this copy and the new version.')
  })

  it('Escape closes it and gives the focus back to the chip', async () => {
    fakeBridge({ ok: true, value: ANSWER })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={withUpdate()} />)
    const popover = await openWhatsNew()
    fireEvent.keyDown(popover, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(chip())
  })
})
