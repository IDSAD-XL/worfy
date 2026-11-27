// worfy-update ticket 14: where the user sees the version. The version chip (in the footer since
// worfy-layout ticket 03) shows `v<major>.<minor>.<N>` with the full build version in its tooltip; Settings → General shows the number with the build
// version next to it; the Update texts (chip, Settings → Updates, toasts) name a version by its number
// where it is known. A build without a number (a shallow clone, no git) reads as before.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import GeneralSection from '../../src/renderer/settings/GeneralSection'
import type { HarnessStatusState } from '../../src/renderer/harness/useHarnessStatus'
import { VersionChip, VersionChipView } from '../../src/renderer/shell/footer/VersionChip'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'
import { useUpdateStore } from '../../src/renderer/update/store'
import { createUpdateToasts, READY_KEY, RESTART_RESULT_KEY, AVAILABLE_KEY } from '../../src/renderer/update/toasts'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const handlers: Record<string, () => Answer> = {}
const invoke = vi.fn((channel: string): Promise<Answer> => Promise.resolve((handlers[channel] ?? (() => ({ ok: false, error: `${channel}: not in this test` })))()))
;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge

const RUNNING = '0.3.0+aaaaaaa'
const NEW_SHA = 'b'.repeat(40)
const NEW = '0.3.0+bbbbbbb'

const snapshot = (over: Partial<UpdateSnapshot> = {}): UpdateSnapshot =>
  updateSnapshotSchema.parse({ enabled: true, checking: false, running: { commit: 'a'.repeat(40), version: RUNNING, number: 1187 }, ...over })

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  handlers['appSettings.get'] = () => ({ ok: true, value: { ...defaultAppSettings(), revision: 1 } })
  handlers['update.state'] = () => ({ ok: true, value: useUpdateStore.getState().snapshot })
  useUpdateStore.setState({ snapshot: null })
  resetToasts()
})
afterEach(() => {
  cleanup()
  resetToasts()
})

const NO_HARNESS: HarnessStatusState = { status: undefined, busy: false, busyText: 'Installing Harness…', failure: undefined, migration: false, onInstall: () => undefined, onEnable: () => undefined, enableFailure: undefined, onMigrate: undefined, onApproveHooks: () => undefined, harnessBehind: null, dialogs: null }

/** The footer's version chip for the version, its number and the Update snapshot given, without a Harness. */
function UpdateChip({ version, number, update }: { version: string; number?: number; update: UpdateSnapshot | null }) {
  return <VersionChipView version={{ version, number }} update={update} harness={NO_HARNESS} memoryShown={false} />
}

const chip = (): HTMLElement => screen.getByTestId('app-version')

describe('the version chip', () => {
  it('shows the number, and the build version with its commit in the tooltip', () => {
    render(<UpdateChip version={RUNNING} number={1187} update={null} />)
    expect(chip().textContent).toBe('v0.3.1187')
    expect(chip().getAttribute('title')).toBe(`worfy v0.3.1187\nworfy ${RUNNING}`)
  })

  it('marks a dirty build, and says why in the tooltip', () => {
    render(<UpdateChip version={`${RUNNING}.dirty`} number={1187} update={null} />)
    expect(chip().textContent).toBe('v0.3.1187.dirty')
    expect(chip().getAttribute('title')).toMatch(/uncommitted changes, not the same as its commit/)
  })

  it('without a number (a shallow clone, no git) is the build version as before, its tooltip the chip\'s name alone', () => {
    render(<UpdateChip version={RUNNING} update={null} />)
    expect(chip().textContent).toBe(`v${RUNNING}`)
    expect(chip().getAttribute('title')).toBe(`worfy v${RUNNING}`)
  })

  it('names an Available update by its number in the tooltip, with the build version of this copy on a second line', () => {
    render(<UpdateChip version={RUNNING} number={1187} update={snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 } })} />)
    expect(chip().textContent).toBe('v0.3.1187')
    expect(chip().getAttribute('title')).toBe(`worfy v0.3.1187 — worfy 0.3.1191 is available\nworfy ${RUNNING}`)
    cleanup()
    render(<UpdateChip version={RUNNING} number={1187} update={snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false } })} />)
    expect(chip().getAttribute('title')).toBe(`worfy v0.3.1187 — worfy ${NEW} is available\nworfy ${RUNNING}`)
  })

  it('keeps the Update tooltip a single line when the copy has no number: the line itself shows the build version', () => {
    render(<UpdateChip version={RUNNING} update={snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 } })} />)
    expect(chip().textContent).toBe(`v${RUNNING}`)
    expect(chip().getAttribute('title')).toBe(`worfy v${RUNNING} — worfy 0.3.1191 is available`)
  })

  it('names the build of that commit by the same number', () => {
    const update = snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 }, build: { phase: 'ready', sha: NEW_SHA, version: NEW } })
    render(<UpdateChip version={RUNNING} number={1187} update={update} />)
    expect(chip().getAttribute('title')).toBe(`worfy v0.3.1187 — worfy 0.3.1191 is ready — restart to update\nworfy ${RUNNING}`)
  })

  it("titles What's new with the number, before main answers and after", async () => {
    let answer: (value: Answer) => void = () => undefined
    handlers['update.whatsNew'] = () => ({ ok: true, value: { version: NEW, items: [], more: false, compareUrl: 'https://github.com/IDSAD-XL/worfy/compare/a...b' } })
    const pending = new Promise<Answer>((resolve) => (answer = resolve))
    invoke.mockImplementationOnce(() => pending)
    render(<UpdateChip version={RUNNING} number={1187} update={snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 } })} />)
    fireEvent.click(chip())
    fireEvent.click(screen.getByRole('button', { name: "What's new" }))
    expect(screen.getByRole('dialog', { name: "What's new in worfy 0.3.1191" })).toBeTruthy()
    await act(async () => {
      answer(handlers['update.whatsNew']!())
      await pending
    })
    expect(screen.getByRole('dialog', { name: "What's new in worfy 0.3.1191" })).toBeTruthy()
  })

  it('goes from app.version through the footer\'s VersionChip with its number', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true, number: 1187 } })
    render(<VersionChip />)
    expect((await screen.findByTestId('app-version')).textContent).toBe('v0.3.1187')
    cleanup()
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true } })
    render(<VersionChip />)
    expect((await screen.findByTestId('app-version')).textContent).toBe(`v${RUNNING}`)
  })
})

describe('Settings → General', () => {
  it('shows the number, the build version next to it, and the Update line by number', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true, number: 1187 } })
    act(() => useUpdateStore.setState({ snapshot: snapshot({ lastCheck: null }) }))
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-version').textContent).toBe('0.3.1187'))
    expect(screen.getByTestId('settings-build-version').textContent).toBe(`(${RUNNING})`)
    expect(screen.getByTestId('settings-updates-status').textContent).toBe('worfy 0.3.1187.')
  })

  it('shows the build version alone without a number, as before', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true } })
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-version').textContent).toBe(RUNNING))
    expect(screen.queryByTestId('settings-build-version')).toBeNull()
  })

  it('names this copy by number before the first check, from the snapshot of this run', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true, number: 1187 } })
    act(() => useUpdateStore.setState({ snapshot: snapshot({ running: null, lastCheck: null, current: { version: RUNNING, number: 1187 } }) }))
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-updates-status').textContent).toBe('worfy 0.3.1187.'))
  })

  it('names the previous copy of the roll back by its number, and by its build version without one', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true, number: 1187 } })
    act(() => useUpdateStore.setState({ snapshot: snapshot({ previous: { version: '0.3.0+ccccccc', number: 1180 } }) }))
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-updates-rollback-row').textContent).toContain('Return to worfy 0.3.1180. Automatic updates'))
    cleanup()
    act(() => useUpdateStore.setState({ snapshot: snapshot({ previous: { version: '0.3.0+ccccccc' } }) }))
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-updates-rollback-row').textContent).toContain('Return to worfy 0.3.0+ccccccc. Automatic updates'))
  })

  it('names an Available update by its number', async () => {
    handlers['app.version'] = () => ({ ok: true, value: { version: RUNNING, packaged: true, number: 1187 } })
    act(() => useUpdateStore.setState({ snapshot: snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 } }) }))
    render(<GeneralSection />)
    await waitFor(() => expect(screen.getByTestId('settings-updates-status').textContent).toBe('worfy 0.3.1191 is available.'))
  })
})

describe('the Update toasts', () => {
  const make = () => {
    const made = createUpdateToasts({ invoke: (() => Promise.resolve({ ok: false, error: 'not here' })) as never, openHealth: () => undefined, storage: undefined })
    made.autoUpdate(false)
    return made
  }
  const text = (key: string): string | undefined => toasts.getState().toasts.find((each) => each.id === key)?.text

  it('name the Available update and its build by number', () => {
    make().update(snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 } }))
    expect(text(AVAILABLE_KEY)).toBe('New worfy 0.3.1191 available')
    resetToasts()
    make().update(snapshot({ available: { sha: NEW_SHA, version: NEW, quiet: false, number: 1191 }, build: { phase: 'ready', sha: NEW_SHA, version: NEW } }))
    expect(text(READY_KEY)).toBe('worfy 0.3.1191 ready')
  })

  it('name the copy the restart started by the number of this run, before any check', () => {
    // `running` is still the copy before the restart; `current` is this run.
    make().update(
      snapshot({
        running: { commit: 'a'.repeat(40), version: RUNNING, number: 1187 },
        current: { version: NEW, number: 1191 },
        lastRestart: { ok: true, action: 'install', version: NEW },
      }),
    )
    expect(text(RESTART_RESULT_KEY)).toBe('worfy updated to 0.3.1191. The new Harness applies from the next Session.')
  })
})
