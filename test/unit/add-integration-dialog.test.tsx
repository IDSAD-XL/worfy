import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '../../src/shared/integrations/types'
import type { IntegrationListItem, MachineIntegration } from '../../src/shared/ipc/integrations'
import { flush } from './kit-window'

// Add integration (worfy-integrations ticket 08): the catalogue without Slack (owner's answer Q6), «Use in this
// Project» for an Integration of the Machine the Project does not use, the Label unique on the Machine, the token
// fields of each way to sign in (Atlassian's e-mail and token with the admin's condition, GitHub's gh account), and a
// custom server over http or stdio with the Secret mark of a variable. main is replaced and records what it was asked.

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  answers: {} as Record<string, Answer | ((input: unknown) => Answer)>,
  calls: [] as { channel: string; input: unknown }[],
}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => {
    main.calls.push({ channel, input })
    const set = main.answers[channel]
    return Promise.resolve(set === undefined ? { ok: false, error: `no answer for ${channel}` } : typeof set === 'function' ? set(input) : set)
  },
  invokeOn: () => Promise.resolve({ ok: false, error: 'not over the link' }),
  subscribe: () => () => undefined,
  windowMachine: () => null,
  hasPreloadBridge: () => false,
}))

const { AddIntegrationDialog } = await import('../../src/renderer/integrations/AddIntegrationDialog')

const PROJECT = { id: 'demo-00000001', name: 'demo' }
const NEW_ID = 'ffff0001'
const integration = (id: string, label: string, service = 'custom'): Integration => ({
  id,
  service,
  label,
  transport: { kind: 'http', url: 'http://127.0.0.1:4100/mcp' },
  auth: 'bearer',
  headerName: null,
  signIn: null,
})
const asked = (channel: string): unknown[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)

function open(props: { items?: IntegrationListItem[]; machineItems?: MachineIntegration[]; service?: string } = {}) {
  const onDone = vi.fn()
  render(<AddIntegrationDialog project={PROJECT} items={props.items ?? []} machineItems={props.machineItems ?? []} service={props.service} onClose={() => undefined} onDone={onDone} />)
  return { onDone }
}
const form = (): HTMLElement => screen.getByTestId('add-integration-form')
const pick = (name: string): void => {
  fireEvent.click(within(screen.getByTestId('add-integration-catalogue')).getByText(name))
}
const save = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId('add-integration-save'))
  await flush()
}

beforeEach(() => {
  main.calls.length = 0
  main.answers = {
    'integrations.add': (input) => ({ ok: true, value: { integration: { ...integration(NEW_ID, (input as { label: string }).label), ...(input as object) }, project: { id: NEW_ID, enabled: true, tools: 'all', autopilot: false } } }),
    'integrations.setSecret': { ok: true, value: { status: { state: 'signed-in' } } },
    'integrations.tools': { ok: true, value: { status: { state: 'signed-in' }, tools: [{ name: 'whoami', readOnly: true, size: 100 }], hidden: [] } },
    'integrations.ghOffer': { ok: true, value: { offer: null } },
  }
})
afterEach(cleanup)

describe('the catalogue', () => {
  it('lists the services of the first version and a custom server, without Slack', () => {
    open()
    const names = [...screen.getByTestId('add-integration-catalogue').querySelectorAll('button')].map((button) => button.dataset.key)
    expect(names).toEqual(['atlassian', 'linear', 'notion', 'sentry', 'github', 'figma', 'custom'])
    expect(screen.getByTestId('add-integration-catalogue').textContent).not.toMatch(/slack/iu)
  })

  it('puts an Integration of the Machine the Project does not use on top: «Use in this Project», with where it is used', async () => {
    const other = integration('aaaa0001', 'Jira — client A', 'atlassian')
    const { onDone } = open({
      items: [{ integration: other, project: null }],
      machineItems: [
        {
          integration: other,
          status: { state: 'signed-in' },
          projects: [
            { id: 'p2', name: 'client-a-web', enabled: true },
            { id: 'p3', name: 'client-a-api', enabled: true },
          ],
        },
      ],
    })
    main.answers['integrations.setEnabled'] = { ok: true, value: { project: { id: other.id, enabled: true, tools: 'all', autopilot: false } } }
    const reuse = screen.getByTestId('add-integration-reuse')
    expect(reuse.textContent).toContain('Use in this Project: Jira — client A')
    expect(reuse.textContent).toContain('(used in 2 Projects: client-a-web, client-a-api)')
    fireEvent.click(within(reuse).getByRole('button', { name: 'Use in this Project' }))
    await flush()
    // One tick, no second sign-in.
    expect(asked('integrations.setEnabled')).toEqual([{ projectId: PROJECT.id, id: other.id, enabled: true }])
    expect(asked('integrations.setSecret')).toEqual([])
    expect(onDone).toHaveBeenCalledOnce()
  })
})

describe('the form of a service', () => {
  it('refuses a Label another Integration of the Machine has, without case', async () => {
    open({ items: [{ integration: integration('aaaa0001', 'Linear — Client A', 'linear'), project: { id: 'aaaa0001', enabled: true, tools: 'all', autopilot: false } }] })
    pick('Linear')
    expect((within(form()).getByLabelText('Label') as HTMLInputElement).value).toBe('Linear')
    fireEvent.change(within(form()).getByLabelText('Label'), { target: { value: 'linear — client a' } })
    expect(form().textContent).toContain('is already on this Machine. Labels are unique on the Machine.')
    fireEvent.change(within(form()).getByLabelText('API token'), { target: { value: 'typed-value' } })
    await save()
    expect(asked('integrations.add')).toEqual([])
  })

  it('Atlassian: e-mail and API token become one pair, with the admin’s condition and the token page shown', async () => {
    open()
    pick('Jira and Confluence')
    // Both ways of the service (worfy-integrations ticket 09): its sign-in page, and the API token, which is picked.
    expect(within(form()).getByRole('radio', { name: 'Sign in with Atlassian' })).toHaveProperty('disabled', false)
    expect(within(form()).getByRole('radio', { name: 'API token (e-mail and token)' })).toHaveProperty('checked', true)
    expect(screen.getByTestId('add-integration-token-note').textContent).toContain('organization admin turned on API token sign-in')
    expect(within(form()).getByRole('button', { name: 'Where to get a token' })).toBeTruthy()
    fireEvent.change(within(form()).getByLabelText('Label'), { target: { value: 'Jira — client A' } })
    fireEvent.change(within(form()).getByLabelText('E-mail'), { target: { value: 'person@example.com' } })
    fireEvent.change(within(form()).getByLabelText('API token'), { target: { value: 'typed-value' } })
    await save()
    expect(asked('integrations.add')).toEqual([{ projectId: PROJECT.id, service: 'atlassian', label: 'Jira — client A', auth: 'basic' }])
    expect(asked('integrations.setSecret')).toEqual([{ id: NEW_ID, part: 'access', value: 'person@example.com:typed-value' }])
    // Then the check and the number of tools.
    expect(asked('integrations.tools')).toEqual([{ projectId: PROJECT.id, id: NEW_ID }])
    expect(screen.getByTestId('add-integration-result-status').textContent).toBe('Signed in · 1 tool · ~26 tokens')
  })

  it('GitHub: offers the token of the Project’s gh account with its warning, and signs in with it', async () => {
    main.answers['integrations.ghOffer'] = { ok: true, value: { offer: { account: 'octo-bot', scopes: ['repo'], warning: 'This is the token of the gh account octo-bot: it has the scopes repo.' } } }
    main.answers['integrations.ghSignIn'] = { ok: true, value: { status: { state: 'signed-in' } } }
    open()
    pick('GitHub')
    await flush()
    fireEvent.click(within(form()).getByRole('radio', { name: /The token of the gh account octo-bot/u }))
    expect(screen.getByTestId('add-integration-gh-warning').textContent).toContain('scopes repo')
    expect(within(form()).queryByLabelText('API token')).toBeNull()
    await save()
    expect(asked('integrations.add')).toEqual([{ projectId: PROJECT.id, service: 'github', label: 'GitHub', auth: 'bearer' }])
    expect(asked('integrations.ghSignIn')).toEqual([{ projectId: PROJECT.id, id: NEW_ID }])
    expect(asked('integrations.setSecret')).toEqual([])
  })

  it('a custom server over http takes an https address, or http on this computer, and a header of its own', async () => {
    open()
    pick('Custom server')
    fireEvent.change(within(form()).getByLabelText('Label'), { target: { value: 'Builds' } })
    fireEvent.change(within(form()).getByLabelText('Address'), { target: { value: 'http://builds.example.com/mcp' } })
    expect(form().textContent).toContain('Only https:// addresses (http:// only on this computer).')
    fireEvent.change(within(form()).getByLabelText('Address'), { target: { value: 'http://127.0.0.1:4100/mcp' } })
    fireEvent.click(within(form()).getByRole('radio', { name: 'A header of its own' }))
    fireEvent.change(within(form()).getByLabelText('Header name'), { target: { value: 'X-Api-Key' } })
    fireEvent.change(within(form()).getByLabelText('X-Api-Key value'), { target: { value: 'typed-value' } })
    await save()
    expect(asked('integrations.add')).toEqual([
      { projectId: PROJECT.id, service: 'custom', label: 'Builds', auth: 'header', transport: { kind: 'http', url: 'http://127.0.0.1:4100/mcp' }, headerName: 'X-Api-Key' },
    ])
    expect(asked('integrations.setSecret')).toEqual([{ id: NEW_ID, part: 'access', value: 'typed-value' }])
  })

  it('a custom server over stdio: a variable marked Secret goes to the secret store, the others into its transport', async () => {
    open()
    pick('Custom server')
    fireEvent.click(within(form()).getByRole('radio', { name: 'Command worfy starts (stdio)' }))
    fireEvent.change(within(form()).getByLabelText('Label'), { target: { value: 'Logs' } })
    fireEvent.change(within(form()).getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.change(within(form()).getByLabelText('Arguments'), { target: { value: 'logs-mcp  --stdio' } })
    for (let index = 0; index < 2; index++) fireEvent.click(within(form()).getByRole('button', { name: 'Add variable' }))
    const names = within(form()).getAllByLabelText('Variable name')
    fireEvent.change(names[0]!, { target: { value: 'LOG_LEVEL' } })
    fireEvent.change(names[1]!, { target: { value: 'LOGS_TOKEN' } })
    fireEvent.change(within(form()).getByLabelText('Value of LOG_LEVEL'), { target: { value: 'info' } })
    fireEvent.change(within(form()).getByLabelText('Value of LOGS_TOKEN'), { target: { value: 'typed-value' } })
    const secret = within(form()).getAllByRole('checkbox', { name: 'Secret' })[1]!
    fireEvent.click(secret)
    expect((within(form()).getByLabelText('Value of LOGS_TOKEN') as HTMLInputElement).type).toBe('password')
    await save()
    expect(asked('integrations.add')).toEqual([
      {
        projectId: PROJECT.id,
        service: 'custom',
        label: 'Logs',
        auth: 'none',
        transport: { kind: 'stdio', command: 'npx', args: ['logs-mcp', '--stdio'], env: { LOG_LEVEL: 'info' }, secretEnv: ['LOGS_TOKEN'] },
      },
    ])
    expect(asked('integrations.setSecret')).toEqual([{ id: NEW_ID, part: 'env:LOGS_TOKEN', value: 'typed-value' }])
    // No value of a variable is in the Integration's transport once it is marked Secret.
    expect(JSON.stringify(asked('integrations.add'))).not.toContain('typed-value')
  })

  it('asks the service nothing when keeping the token failed', async () => {
    main.answers['integrations.setSecret'] = { ok: false, error: 'the secret store could not be written' }
    open()
    pick('Linear')
    fireEvent.change(within(form()).getByLabelText('API token'), { target: { value: 'typed-value' } })
    await save()
    expect(asked('integrations.tools')).toEqual([])
    expect(screen.getByTestId('add-integration-result-status').textContent).toBe('the secret store could not be written')
  })
})

// worfy-integrations ticket 09: «Sign in with Atlassian» adds the Integration and opens the service's sign-in window
// (integrations.signIn); then the check and the tools, as after a token. No token field for it.
describe('Sign in with the service', () => {
  it('Atlassian: «Sign in with Atlassian» adds, signs in in worfy`s window, then checks and counts the tools', async () => {
    main.answers['integrations.signIn'] = { ok: true, value: { signIn: { account: null, site: null, at: '2026-11-22T10:00:00.000Z' } } }
    open()
    pick('Jira and Confluence')
    fireEvent.click(within(form()).getByRole('radio', { name: 'Sign in with Atlassian' }))
    expect(within(form()).queryByLabelText('API token')).toBeNull()
    expect(screen.getByTestId('add-integration-save').textContent).toBe('Sign in with Atlassian')
    fireEvent.change(within(form()).getByLabelText('Label'), { target: { value: 'Jira — client A' } })
    await save()
    await flush()
    expect(asked('integrations.add')).toEqual([{ projectId: PROJECT.id, service: 'atlassian', label: 'Jira — client A', auth: 'oauth' }])
    expect(asked('integrations.signIn')).toEqual([{ projectId: PROJECT.id, id: NEW_ID }])
    expect(asked('integrations.setSecret')).toEqual([])
    expect(asked('integrations.tools')).toEqual([{ projectId: PROJECT.id, id: NEW_ID }])
    expect(screen.getByTestId('add-integration-result-status').textContent).toBe('Signed in · 1 tool · ~26 tokens')
  })

  it('a sign-in that did not finish leaves the Integration added, needing a sign-in, and asks the service nothing', async () => {
    main.answers['integrations.signIn'] = { ok: false, error: 'Jira — client A: The sign-in was ended.' }
    open()
    pick('Jira and Confluence')
    fireEvent.click(within(form()).getByRole('radio', { name: 'Sign in with Atlassian' }))
    await save()
    await flush()
    expect(asked('integrations.tools')).toEqual([])
    expect(screen.getByTestId('add-integration-result').textContent).toContain('The sign-in was ended.')
  })
})
