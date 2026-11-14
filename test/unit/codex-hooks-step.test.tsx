import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { codexHooksCommand, type HarnessHooksTrust, type HarnessStatus as Status } from '../../src/shared/ipc/harness'
import CodexHooksStep from '../../src/renderer/harness/CodexHooksStep'
import { HarnessStatus } from '../../src/renderer/shell/toolbar/HarnessStatus'
import { expectFocusKeptIn, flush } from './kit-window'

// worfy-multi-vendor ticket 39: the step "Approve the Harness hooks in Codex". It says what to open in
// Codex (/hooks), and "Check again" asks main (`harness.codexHooks`). The toolbar's Harness item opens it
// when an install or update in Codex leaves hooks to approve, and on a click of "Codex: approve hooks".
// worfy-polish ticket 54: step 1 names the Codex binary of this build, which main answers with
// (`harness.codexBinary`), as a command that starts it from the home folder, with a Copy button.

const globals = globalThis as { worfy?: WorfyBridge }

/** A preload bridge with scripted answers per channel and events the test sends. */
function fakeBridge(answers: Record<string, () => Promise<unknown>>) {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const calls: string[] = []
  globals.worfy = {
    invoke: (channel: string) => {
      calls.push(channel)
      const answer = answers[channel]
      return answer ? answer() : Promise.resolve({ ok: false, error: `${channel}: not in this test` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id: number) => handlers.delete(id),
  } as unknown as WorfyBridge
  return {
    calls,
    emit: (channel: string, payload: unknown) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
}

const ok = (value: unknown) => () => Promise.resolve({ ok: true, value })

const withCodex = (hooksToApprove: boolean): Status => ({
  state: { kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true },
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall: true,
  pluginDir: '/Users/someone/.claude/worfy-harness/plugin',
  dependencies: [],
  codex: { state: { kind: 'installed', version: '0.2.0+bbbbbbb' }, agentsDir: '/Users/someone/.codex/agents', hooksToApprove, skippedAgents: [] },
})

afterEach(() => {
  cleanup()
  delete globals.worfy
})

describe('CodexHooksStep', () => {
  it('names the step, what to open in Codex and the button that checks again', () => {
    fakeBridge({})
    render(<CodexHooksStep onClose={() => undefined} onStatus={() => undefined} />)
    const step = screen.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' })
    expect(step.textContent).toContain('a Codex Autopilot Run does not start')
    expect(screen.getByTestId('codex-hooks-step-steps').textContent).toContain('/hooks')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('')
  })

  it.each<[HarnessHooksTrust, string]>([
    ['not-approved', 'The Harness hooks are still off in Codex. Approve them in /hooks, then check again.'],
    ['unknown', 'worfy could not read the hooks from Codex. Check that the Harness is installed in Codex, then check again.'],
  ])('Check again answered %s: says so, keeps the button, and hands on the status main answered', async (trust, text) => {
    const status = withCodex(true)
    const main = fakeBridge({ 'harness.codexHooks': ok({ trust, status }) })
    const onStatus = vi.fn()
    render(<CodexHooksStep onClose={() => undefined} onStatus={onStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('Asking Codex…')
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').getAttribute('data-trust')).toBe(trust))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe(text)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expect(onStatus).toHaveBeenCalledWith(status)
    expect(main.calls).toEqual(['harness.codexBinary', 'harness.codexHooks'])
  })

  it('Check again answered approved: says the Run can start, and Done closes the step', async () => {
    fakeBridge({ 'harness.codexHooks': ok({ trust: 'approved', status: withCodex(false) }) })
    const onClose = vi.fn()
    render(<CodexHooksStep onClose={onClose} onStatus={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').getAttribute('data-trust')).toBe('approved'))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toContain('a Codex Autopilot Run can start')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a check that fails says so; Escape closes the step', async () => {
    fakeBridge({ 'harness.codexHooks': () => Promise.resolve({ ok: false, error: 'main is gone' }) })
    const onClose = vi.fn()
    render(<CodexHooksStep onClose={onClose} onStatus={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('The check failed: main is gone'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

const MAC_BINARY = '/Applications/worfy.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'
const WINDOWS_BINARY = 'C:\\Program Files\\worfy\\resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'

describe('step 1: the Codex binary of this build (worfy-polish ticket 54)', () => {
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard
  })

  it('shows the command main answers with, from the home folder, and Copy puts it on the clipboard', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (text: string) => (written.push(text), Promise.resolve()) }, configurable: true })
    const main = fakeBridge({ 'harness.codexBinary': ok({ path: MAC_BINARY, windows: false }) })
    render(<CodexHooksStep onClose={() => undefined} onStatus={() => undefined} />)
    const command = await screen.findByTestId('codex-hooks-step-command')
    expect(command.textContent).toBe(`cd ~ && '${MAC_BINARY}'`)
    expect(screen.getByTestId('codex-hooks-step-steps').textContent).toContain('Terminal')
    expect(screen.getByTestId('codex-hooks-step-steps').textContent).not.toContain('Open Codex in a terminal: codex')
    fireEvent.click(screen.getByRole('button', { name: 'Copy the command' }))
    await vi.waitFor(() => expect(written).toEqual([`cd ~ && '${MAC_BINARY}'`]))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy the command' }).textContent).toBe('Copied'))
    expect(main.calls).toEqual(['harness.codexBinary'])
  })

  it('on Windows the command is for PowerShell, the path in double quotes', async () => {
    fakeBridge({ 'harness.codexBinary': ok({ path: WINDOWS_BINARY, windows: true }) })
    render(<CodexHooksStep onClose={() => undefined} onStatus={() => undefined} />)
    const command = await screen.findByTestId('codex-hooks-step-command')
    expect(command.textContent).toBe(`cd ~; & "${WINDOWS_BINARY}"`)
    expect(screen.getByTestId('codex-hooks-step-steps').textContent).toContain('PowerShell')
  })

  it.each([
    ['main finds no Codex binary in this build', ok({ path: null, windows: false })],
    ['main cannot be asked', () => Promise.resolve({ ok: false, error: 'main is gone' })],
  ])('%s: says so plainly, with no command and no Copy', async (_case, answer) => {
    fakeBridge({ 'harness.codexBinary': answer })
    render(<CodexHooksStep onClose={() => undefined} onStatus={() => undefined} />)
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-steps').textContent).toContain('worfy could not find the Codex of this build'))
    expect(screen.queryByTestId('codex-hooks-step-command')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy the command' })).toBeNull()
  })
})

describe('codexHooksCommand', () => {
  it('quotes the path for a POSIX shell, a quote inside it too', () => {
    expect(codexHooksCommand('/Applications/worfy.app/codex', false)).toBe("cd ~ && '/Applications/worfy.app/codex'")
    expect(codexHooksCommand("/Users/someone/Apps/it's worfy.app/codex", false)).toBe("cd ~ && '/Users/someone/Apps/it'\\''s worfy.app/codex'")
  })

  it('quotes the path for PowerShell and escapes what PowerShell expands inside double quotes', () => {
    expect(codexHooksCommand('C:\\Program Files\\worfy\\codex.exe', true)).toBe('cd ~; & "C:\\Program Files\\worfy\\codex.exe"')
    expect(codexHooksCommand('C:\\Users\\someone\\a$b\\x`y\\codex.exe', true)).toBe('cd ~; & "C:\\Users\\someone\\a`$b\\x``y\\codex.exe"')
  })
})

describe('the step from the toolbar Harness item', () => {
  it('opens by itself when an install in Codex leaves hooks to approve, and once approved the item no longer asks', async () => {
    const main = fakeBridge({
      'harness.state': ok(withCodex(false)),
      'harnessMigration.offer': ok({ offered: false }),
      'harness.codexHooks': ok({ trust: 'approved', status: withCodex(false) }),
    })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-text')
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    // An install from this window, another one or the first-run screen: `harness.changed`.
    act(() => main.emit('harness.changed', withCodex(true)))
    expect(screen.getByTestId('codex-hooks-step')).toBeTruthy()
    expect(screen.getByTestId('harness-codex').textContent).toBe('Codex: approve hooks')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.queryByTestId('harness-codex')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
  })

  it('a window that opens while hooks wait does not open the step; "Codex: approve hooks" does, and closed, a status that still asks does not reopen it', async () => {
    const main = fakeBridge({ 'harness.state': ok(withCodex(true)), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-codex')
    // The first status only seeds the window: a new window, a reload or another screen opens no dialog.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20))
    })
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    act(() => main.emit('harness.changed', withCodex(true)))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    fireEvent.click(screen.getByTestId('harness-codex'))
    expect(screen.getByTestId('codex-hooks-step')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    act(() => main.emit('harness.changed', withCodex(true)))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    fireEvent.click(screen.getByTestId('harness-codex'))
    expect(screen.getByTestId('codex-hooks-step')).toBeTruthy()
  })
})

// worfy-ui-kit ticket 07: the step is a modal window of the kit (theme/kit/Dialog.tsx).
describe('the step as a window of the kit', () => {
  function Page({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Codex: approve hooks
        </button>
        {open ? (
          <CodexHooksStep
            onClose={() => {
              onClose?.()
              setOpen(false)
            }}
            onStatus={() => undefined}
          />
        ) : null}
      </>
    )
  }

  async function openStep(onClose?: () => void): Promise<{ opener: HTMLElement; step: HTMLElement }> {
    render(<Page onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Codex: approve hooks' })
    opener.focus()
    fireEvent.click(opener)
    await flush()
    return { opener, step: screen.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' }) }
  }

  it('takes the focus on opening, keeps Tab inside, and gives the focus back to its button on Esc and on Close', async () => {
    fakeBridge({ 'harness.codexBinary': ok({ path: MAC_BINARY, windows: false }) })
    const { opener, step } = await openStep()
    await screen.findByTestId('codex-hooks-step-command')
    expect(step.dataset.testid).toBe('codex-hooks-step')
    await expectFocusKeptIn(step)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    await flush()
    fireEvent.click(screen.getByTestId('codex-hooks-step-close'))
    await flush()
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('while Codex is asked, neither Esc nor a press on the backdrop closes it', async () => {
    fakeBridge({ 'harness.codexHooks': () => new Promise(() => undefined) })
    const onClose = vi.fn()
    const { step } = await openStep(onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('Asking Codex…')
    fireEvent.keyDown(step, { key: 'Escape' })
    fireEvent.mouseDown(step.parentElement!)
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('codex-hooks-step')).toBe(step)
  })
})
