import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewSessionVendor } from '../../src/renderer/session/NewSessionVendor'
import { VendorBadge } from '../../src/renderer/session/VendorBadge'
import { ProjectSettings } from '../../src/renderer/shell/ProjectSettings'
import { signInHint, vendorIcon, vendorLabel } from '../../src/shared/vendors/vendor'

// The Vendor in the interface (worfy-multi-vendor ticket 24): the VendorBadge — the Vendor's logo in the
// text colour and its text label (owner, 2026-11-03, reversing Q10 of the spec) —, the Vendor picker of
// "New session" and "Default vendor" in Project settings.
// main is replaced: what it answers is set by each test, and what it was asked is recorded.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as { channel: string; input: unknown }[],
}))
const answer = (channel: string, input: unknown): Promise<Answer> => {
  main.calls.push({ channel, input })
  return Promise.resolve(main.answers[channel] ?? { ok: false, error: `no answer for ${channel}` })
}
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => answer(channel, input),
  invokeOn: (_machine: string | null, channel: string, input?: unknown) => answer(channel, input),
  windowMachine: () => null,
  hasPreloadBridge: () => false,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))

beforeEach(() => {
  main.calls.length = 0
  main.answers = {}
})

/**
 * The start and the end of each logo's path in Simple Icons 15.22.0 (icons/claude.svg, icons/openai.svg),
 * written out here rather than taken from vendor.ts, so a swapped or redrawn logo fails.
 */
const LOGOS = {
  claude: { start: 'm4.7144 15.9555 4.7174-2.6471', end: '.2307-.2429 1.9064-1.3114Z', label: 'Claude Code' },
  codex: { start: 'M22.2819 9.8211a5.9847 5.9847', end: '2.9994l-2.5974 1.4997-2.6067-1.4997Z', label: 'Codex' },
} as const

/** The one path of a badge's logo; the logo is a single filled path, nothing else. */
const logoPath = (badge: HTMLElement): string => {
  const icon = within(badge).getByTestId('vendor-badge-icon')
  expect(icon.querySelectorAll('*').length).toBe(1)
  return icon.querySelector('path')?.getAttribute('d') ?? ''
}

describe('VendorBadge', () => {
  it.each(Object.entries(LOGOS))('%s: the Vendor\'s logo filled with the text colour, beside its text label', (vendor, logo) => {
    render(<VendorBadge vendor={vendor} />)
    const badge = screen.getByTestId('vendor-badge')
    expect(badge.textContent).toBe(logo.label)
    expect(badge.dataset.vendor).toBe(vendor)
    // The logo is decoration: the label names the Vendor. It is drawn in currentColor, so it follows the theme.
    const icon = within(badge).getByTestId('vendor-badge-icon')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(icon.getAttribute('fill')).toBe('currentColor')
    expect(icon.getAttribute('stroke')).toBeNull()
    const d = logoPath(badge)
    expect(d.startsWith(logo.start) && d.endsWith(logo.end), `the ${vendor} logo, got ${d.slice(0, 40)}…`).toBe(true)
    expect(d).toBe(vendorIcon(vendor))
    expect(badge.querySelector('img, image, use')).toBeNull()
  })

  it('takes its label from src/shared/vendors/vendor.ts; the short one has the whole name as its tooltip', () => {
    render(<VendorBadge vendor="claude" form="short" testId="short" />)
    render(<VendorBadge vendor="claude" testId="whole" />)
    expect(screen.getByTestId('short').textContent).toBe(vendorLabel('claude', 'short'))
    expect(screen.getByTestId('short').getAttribute('title')).toBe('Claude Code')
    expect(screen.getByTestId('whole').textContent).toBe('Claude Code')
    expect(screen.getByTestId('whole').getAttribute('title')).toBeNull()
  })

  it('the icon form is the logo alone: no text, the whole name as its accessible name and tooltip', () => {
    render(<VendorBadge vendor="claude" form="icon" />)
    const badge = screen.getByRole('img', { name: 'Claude Code' })
    expect(badge.dataset.testid).toBe('vendor-badge')
    expect(badge.textContent).toBe('')
    expect(badge.getAttribute('title')).toBe('Claude Code')
    expect(logoPath(badge).startsWith(LOGOS.claude.start)).toBe(true)
  })

  it('a Vendor of a later build shows its id beside a plain shape, neither Vendor\'s logo', () => {
    render(<VendorBadge vendor="gemini" />)
    const badge = screen.getByTestId('vendor-badge')
    expect(badge.textContent).toBe('gemini')
    const d = logoPath(badge)
    expect(d).not.toBe(vendorIcon('claude'))
    expect(d).not.toBe(vendorIcon('codex'))
  })
})

describe('the Vendor picker of New session', () => {
  const options = (): HTMLElement[] => screen.getAllByTestId('new-session-vendor-option')

  it('lists the Vendors in main\'s order, the default first and marked; one nobody is signed in to is inactive with the reason', async () => {
    main.answers['sessions.vendors'] = {
      ok: true,
      value: { defaultVendor: 'codex', choices: [{ vendor: 'codex', refusal: null }, { vendor: 'claude', refusal: null }] },
    }
    const onPick = vi.fn()
    render(<NewSessionVendor projectId="p" onPick={onPick} onClose={() => undefined} />)
    await act(async () => {})
    expect(main.calls).toEqual([{ channel: 'sessions.vendors', input: { projectId: 'p' } }])
    expect(options().map((option) => [option.dataset.vendor, option.textContent])).toEqual([
      ['codex', 'Codexdefault'],
      ['claude', 'Claude Code'],
    ])
    // The default takes the focus, so Enter picks it.
    expect(document.activeElement).toBe(options()[0])
    fireEvent.click(options()[1]!)
    expect(onPick).toHaveBeenCalledWith('claude')
  })

  it('a Vendor nobody is signed in to stays listed, inactive, its tooltip main\'s reason; a click picks nothing', async () => {
    main.answers['sessions.vendors'] = {
      ok: true,
      value: { defaultVendor: 'claude', choices: [{ vendor: 'claude', refusal: null }, { vendor: 'codex', refusal: signInHint('codex') }] },
    }
    const onPick = vi.fn()
    render(<NewSessionVendor projectId="p" onPick={onPick} onClose={() => undefined} />)
    await act(async () => {})
    const codex = options()[1]!
    expect(codex.getAttribute('aria-disabled')).toBe('true')
    expect(codex.getAttribute('title')).toBe('Sign in to Codex in Settings → Vendors')
    fireEvent.click(codex)
    expect(onPick).not.toHaveBeenCalled()
    expect(options()[0]!.getAttribute('aria-disabled')).toBeNull()
  })

  it('a Machine that does not answer the picker gets New session on its default Vendor, as before the picker', async () => {
    const onPick = vi.fn()
    render(<NewSessionVendor projectId="p" onPick={onPick} onClose={() => undefined} />)
    await act(async () => {})
    expect(onPick).toHaveBeenCalledWith(undefined)
  })

  it('Esc and a press outside close it', async () => {
    main.answers['sessions.vendors'] = { ok: true, value: { defaultVendor: 'claude', choices: [{ vendor: 'claude', refusal: null }] } }
    const onClose = vi.fn()
    render(<NewSessionVendor projectId="p" onPick={() => undefined} onClose={onClose} />)
    await act(async () => {})
    fireEvent.mouseDown(options()[0]!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Default vendor in Project settings', () => {
  const TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '' }
  const PROJECT = { id: 'demo-00000001', name: 'demo' }
  const field = (): HTMLElement => screen.getByTestId('project-settings-vendor')
  const choose = (label: string): void => {
    fireEvent.click(field())
    fireEvent.click(screen.getByRole('option', { name: label }))
  }
  async function open(saved: Record<string, unknown> = {}): Promise<void> {
    main.answers['projects.settings.get'] = { ok: true, value: { actionTemplates: TEMPLATES, ...saved } }
    main.answers['projects.settings.set'] = { ok: true, value: { actionTemplates: TEMPLATES } }
    render(<ProjectSettings project={PROJECT} onClose={() => undefined} />)
    await act(async () => {})
  }
  const save = async (): Promise<unknown> => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    return main.calls.find((call) => call.channel === 'projects.settings.set')?.input
  }

  it('offers none and every Vendor; none saved sends no field, a Vendor chosen sends it', async () => {
    await open()
    expect(field().getAttribute('data-value')).toBe('none')
    fireEvent.click(field())
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['None (Claude Code)', 'Claude Code', 'Codex'])
    fireEvent.click(field())
    expect(await save()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES } })

    main.calls.length = 0
    choose('Codex')
    expect(await save()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, defaultVendor: 'codex' } })
  })

  it('a saved Vendor shows chosen and is kept on Save; "None" clears it with null', async () => {
    await open({ defaultVendor: 'codex' })
    expect(field().getAttribute('data-value')).toBe('codex')
    expect(await save()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, defaultVendor: 'codex' } })

    main.calls.length = 0
    choose('None (Claude Code)')
    expect(await save()).toEqual({ id: PROJECT.id, settings: { actionTemplates: TEMPLATES, defaultVendor: null } })
  })
})
