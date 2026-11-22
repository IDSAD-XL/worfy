// Settings → Integrations (src/renderer/settings/IntegrationsSection.tsx; worfy-integrations ticket 08, the review's
// debts in ticket 09): while the Machine's list of Integrations is set aside as unreadable, the line of orphans and
// Clean up wait, and a line says why, naming the file; an OAuth Integration that needs a sign-in has Sign in here too,
// through a Project that uses it. main is replaced: what it answers is set by each test, and what it was asked recorded.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '../../src/shared/integrations/types'
import { flush } from './kit-window'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({ answers: {} as Record<string, Answer>, calls: [] as { channel: string; input: unknown }[] }))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => {
    main.calls.push({ channel, input })
    return Promise.resolve(main.answers[channel] ?? { ok: false, error: `no answer for ${channel}` })
  },
  subscribe: () => () => undefined,
  windowMachine: () => null,
}))

const { default: IntegrationsSection } = await import('../../src/renderer/settings/IntegrationsSection')

const oauth: Integration = {
  id: 'oooo0005',
  service: 'atlassian',
  label: 'Jira — client A',
  transport: { kind: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
  auth: 'oauth',
  headerName: null,
  signIn: null,
}

beforeEach(() => {
  main.calls.length = 0
  main.answers = {}
})
afterEach(cleanup)

describe('Settings → Integrations', () => {
  it('says why Clean up waits while the Machine`s list is set aside, naming the file', async () => {
    main.answers['integrations.machine'] = { ok: true, value: { items: [], dangling: [], setAside: 'integrations.json.unreadable-2026-11-22T10-00-00' } }
    render(<IntegrationsSection />)
    await flush()
    const line = screen.getByTestId('settings-integrations-set-aside')
    expect(line.textContent).toContain('integrations.json.unreadable-2026-11-22T10-00-00')
    expect(line.textContent).toContain('Clean up')
    expect(screen.queryByRole('button', { name: 'Clean up' })).toBeNull()
  })

  it('has no such line while the list reads whole', async () => {
    main.answers['integrations.machine'] = { ok: true, value: { items: [], dangling: [], setAside: null } }
    render(<IntegrationsSection />)
    await flush()
    expect(screen.queryByTestId('settings-integrations-set-aside')).toBeNull()
  })

  it('Sign in of an OAuth Integration that needs it goes through a Project that uses it', async () => {
    main.answers['integrations.machine'] = {
      ok: true,
      value: { items: [{ integration: oauth, status: { state: 'needs-sign-in' }, projects: [{ id: 'alpha-0000000a', name: 'alpha', enabled: true }] }], dangling: [], setAside: null },
    }
    main.answers['integrations.signIn'] = { ok: true, value: { signIn: { account: null, site: null, at: '2026-11-22T10:00:00.000Z' } } }
    render(<IntegrationsSection />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await flush()
    expect(main.calls.find((call) => call.channel === 'integrations.signIn')?.input).toEqual({ projectId: 'alpha-0000000a', id: oauth.id })
  })
})
