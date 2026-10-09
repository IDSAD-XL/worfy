// Choosing a folder of a Linked machine inside worfy (worfy-link ticket 11,
// src/renderer/projects/FolderBrowser.tsx), over the real renderer IPC client and a fake preload:
// `projects.browse` of Machine M goes out as `linked.invoke` and is answered from a table of folders.
// The paths of the table are in Windows form on purpose: the screen must not parse or rewrite them.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { BrowseAnswer } from '../../src/shared/ipc/projects'

const M = '22222222-2222-4222-8222-222222222222'

const folder = (name: string, path: string, extra: { hidden?: boolean; gitRepo?: boolean } = {}) => ({ name, path, hidden: extra.hidden ?? false, gitRepo: extra.gitRepo ?? false })

/** The folders of M by path; `null` is the start (its home folder). */
const TABLE: Record<string, BrowseAnswer> = {
  'C:\\Users\\me': {
    ok: true,
    path: 'C:\\Users\\me',
    parent: 'C:\\Users',
    truncated: false,
    folders: [folder('.config', 'C:\\Users\\me\\.config', { hidden: true }), folder('code', 'C:\\Users\\me\\code'), folder('locked', 'C:\\Users\\me\\locked')],
  },
  'C:\\Users\\me\\code': {
    ok: true,
    path: 'C:\\Users\\me\\code',
    parent: 'C:\\Users\\me',
    truncated: true,
    folders: [folder('shop', 'C:\\Users\\me\\code\\shop', { gitRepo: true })],
  },
  'C:\\Users\\me\\locked': { ok: false, path: 'C:\\Users\\me\\locked', parent: 'C:\\Users\\me', reason: 'No permission to read C:\\Users\\me\\locked' },
  'C:\\Users': { ok: true, path: 'C:\\Users', parent: 'C:\\', truncated: false, folders: [folder('me', 'C:\\Users\\me')] },
  'C:\\': { ok: true, path: 'C:\\', parent: null, truncated: false, folders: [folder('Users', 'C:\\Users')] },
}

/** The `path` of every browse M was asked for, in order. */
let asked: (string | null)[]
/** Answers held back by path: the test releases them. */
let held: Map<string, () => void>
let holdPaths: Set<string>
let failing: string | null

function bridge(): WorfyBridge {
  return {
    invoke: (channel, input) => {
      if (channel !== 'linked.invoke') return Promise.resolve({ ok: false, error: `unexpected ${channel}` })
      const call = input as { machine: string; channel: string; input: { path: string | null } }
      if (call.machine !== M || call.channel !== 'projects.browse') return Promise.resolve({ ok: false, error: `unexpected ${call.channel} on ${call.machine}` })
      asked.push(call.input.path)
      if (failing !== null) return Promise.resolve({ ok: true, value: { ok: false, error: failing } })
      const path = call.input.path ?? 'C:\\Users\\me'
      const answer = { ok: true, value: { ok: true, value: TABLE[path] } }
      if (!holdPaths.has(path)) return Promise.resolve(answer as never)
      return new Promise((resolve) => held.set(path, () => resolve(answer as never)))
    },
    on: () => 1,
    off: () => undefined,
  }
}

beforeEach(() => {
  asked = []
  held = new Map()
  holdPaths = new Set()
  failing = null
  vi.resetModules()
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function open() {
  const { FolderBrowser } = await import('../../src/renderer/projects/FolderBrowser')
  const chosen = vi.fn<(path: string) => void>()
  const cancelled = vi.fn()
  render(<FolderBrowser machine={M} machineName="Mini" title="Add project" hint="Choose a folder." onChoose={chosen} onCancel={cancelled} />)
  await waitFor(() => expect(screen.getByTestId('folder-browser').getAttribute('data-loading')).toBe('no'))
  return { chosen, cancelled }
}

const shownPath = () => screen.getByTestId('folder-browser-path').textContent
const rows = () => screen.queryAllByTestId('folder-row').map((row) => row.textContent)
const rowNamed = (name: string) => screen.getAllByTestId('folder-row').find((row) => within(row).queryByText(name) !== null)!
const settled = () => waitFor(() => expect(screen.getByTestId('folder-browser').getAttribute('data-loading')).toBe('no'))

describe('FolderBrowser', () => {
  it('starts in the home folder of the Machine, goes into a folder and up by `parent`; Up is off at a root', async () => {
    await open()
    expect(asked).toEqual([null])
    expect(shownPath()).toBe('C:\\Users\\me')
    expect(rows()).toEqual(['code', 'locked'])

    fireEvent.click(within(rowNamed('code')).getByRole('button'))
    await waitFor(() => expect(shownPath()).toBe('C:\\Users\\me\\code'))
    expect(asked.at(-1)).toBe('C:\\Users\\me\\code')
    // A repository says so; a folder past the limit says the list is cut.
    expect(within(rowNamed('shop')).getByText('git')).toBeTruthy()
    expect(screen.getByTestId('folder-browser-truncated').textContent).toBe('Only the first 1 folders are shown.')

    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(shownPath()).toBe('C:\\Users\\me'))
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(shownPath()).toBe('C:\\Users'))
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(shownPath()).toBe('C:\\'))
    expect((screen.getByRole('button', { name: 'Up' }) as HTMLButtonElement).disabled).toBe(true)
    // Exactly the paths the answers gave: nothing was parsed or joined on this side.
    expect(asked).toEqual([null, 'C:\\Users\\me\\code', 'C:\\Users\\me', 'C:\\Users', 'C:\\'])
  })

  it('hidden folders are not shown until "Show hidden folders" is on', async () => {
    await open()
    expect(rows()).toEqual(['code', 'locked'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show hidden folders' }))
    expect(rows()).toEqual(['.config', 'code', 'locked'])
    expect(rowNamed('.config').getAttribute('data-hidden')).toBe('yes')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show hidden folders' }))
    expect(rows()).toEqual(['code', 'locked'])
  })

  it('"Choose" gives the `path` of the answer as it is: a path with backslashes passes unchanged', async () => {
    const { chosen } = await open()
    fireEvent.click(within(rowNamed('code')).getByRole('button'))
    await waitFor(() => expect(shownPath()).toBe('C:\\Users\\me\\code'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    expect(chosen).toHaveBeenCalledWith('C:\\Users\\me\\code')
    expect(chosen).toHaveBeenCalledTimes(1)
  })

  it('a folder that cannot be read shows its reason where the list was; Choose is off, Up leads out', async () => {
    const { chosen } = await open()
    fireEvent.click(within(rowNamed('locked')).getByRole('button'))
    await waitFor(() => expect(screen.getByTestId('folder-browser-error').textContent).toBe('No permission to read C:\\Users\\me\\locked'))
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('folder-browser-error'))
    expect(rows()).toEqual([])
    const choose = screen.getByRole('button', { name: 'Choose' }) as HTMLButtonElement
    expect(choose.disabled).toBe(true)
    fireEvent.click(choose)
    expect(chosen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(rows()).toEqual(['code', 'locked']))
  })

  it('a failed call (the Machine went away) shows the reason where the list was; Home asks again', async () => {
    failing = 'projects.browse: Mini is unreachable'
    const { FolderBrowser } = await import('../../src/renderer/projects/FolderBrowser')
    render(<FolderBrowser machine={M} machineName="Mini" title="Add project" hint="Choose a folder." onChoose={() => undefined} onCancel={() => undefined} />)
    await waitFor(() => expect(screen.getByTestId('folder-browser-error').textContent).toBe('Mini is unreachable'))
    expect((screen.getByRole('button', { name: 'Choose' }) as HTMLButtonElement).disabled).toBe(true)
    failing = null
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() => expect(rows()).toEqual(['code', 'locked']))
    expect(screen.queryByTestId('folder-browser-error')).toBeNull()
  })

  it('an answer that comes after a later click is dropped: the folder clicked last is shown', async () => {
    await open()
    holdPaths.add('C:\\Users\\me\\code')
    fireEvent.click(within(rowNamed('code')).getByRole('button'))
    fireEvent.click(within(rowNamed('locked')).getByRole('button'))
    await waitFor(() => expect(screen.queryByTestId('folder-browser-error')).not.toBeNull())
    await act(async () => held.get('C:\\Users\\me\\code')?.())
    await settled()
    expect(shownPath()).toBe('C:\\Users\\me\\locked')
    expect(screen.getByTestId('folder-browser-error').textContent).toBe('No permission to read C:\\Users\\me\\locked')
  })

  it('Escape and Cancel cancel', async () => {
    const { cancelled } = await open()
    fireEvent.keyDown(screen.getByTestId('folder-browser'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelled).toHaveBeenCalledTimes(2)
  })
})
