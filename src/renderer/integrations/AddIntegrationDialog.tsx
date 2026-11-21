// Add integration (worfy-integrations ticket 08; spec, the user's path through the screens, 2–5; the prototype Card of
// ticket 02). First the catalogue (src/shared/integrations/catalogue.ts) with the way each service signs in, under the
// Integrations of this Machine the Project does not use yet — «Use in this Project: <label> (used in N Projects)»
// turns one on without a second sign-in (Q2). Then the service's form: the Label, unique on the Machine; the way to
// sign in and its token (Atlassian: e-mail and API token, the admin's condition and the token page; GitHub: a
// personal access token or the Project's gh account's token, with its scopes); a custom server's address, or its
// command, arguments and variables, each variable with a Secret mark. Saving adds the Integration, keeps its secrets
// (the token is checked by main, ticket 04) and asks the service for its tools (ticket 06): the last step shows both.
//
// Only on the Project's own Machine: every channel here but the tools is `local` (spec, decided without the owner, 3).
// Sign in through the service's page (OAuth, worfy-integrations ticket 09): its way adds the Integration, then opens the
// service's sign-in window (integrations.signIn), then asks for the tools as after a token; no token field for it.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { CATALOGUE, catalogueEntry, type CatalogueEntry } from '../../shared/integrations/catalogue'
import type { IntegrationAuth, IntegrationSecretPart, IntegrationStatus, IntegrationTransport } from '../../shared/integrations/types'
import type { IntegrationListItem, MachineIntegration } from '../../shared/ipc/integrations'
import { invoke } from '../ipc'
import { Button } from '../theme/Button'
import { Dialog } from '../theme/kit/Dialog'
import { costText } from './cost'
import { addressProblem, basicPair, firstWay, keepSecrets, offered, sameLabel, wayName } from './model'

export interface AddIntegrationDialogProps {
  project: { id: string; name: string }
  /** integrations.list of the Project: every Integration of the Machine, with the Project's entry or null. */
  items: readonly IntegrationListItem[]
  /** integrations.machine: where each Integration is used. */
  machineItems: readonly MachineIntegration[]
  /** A service to open the form of at once («Add as integration» of From Claude Code). */
  service?: string | undefined
  onClose: () => void
  /** Something changed: the section reads the list again. */
  onDone: () => void
  /**
   * The channels of the Project's Machine (IntegrationsSection's `call`): this Machine's bridge for its own Project,
   * also in a window of a Linked machine, where a bare `invoke` of a `project` channel goes to the window's Machine.
   */
  call?: typeof invoke
}

interface EnvRow {
  name: string
  value: string
  secret: boolean
}

type Step = { kind: 'catalogue' } | { kind: 'form'; entry: CatalogueEntry } | { kind: 'result'; label: string; status: IntegrationStatus | null; problem: string | null; tools: string | null }

export function AddIntegrationDialog({ project, items, machineItems, service, onClose, onDone, call = invoke }: AddIntegrationDialogProps) {
  const preset = service === undefined ? undefined : catalogueEntry(service)
  const [step, setStep] = useState<Step>(preset === undefined ? { kind: 'catalogue' } : { kind: 'form', entry: preset })
  const titleId = useId()
  const reuse = items.filter((item) => item.project?.enabled !== true)
  const usedIn = (id: string): string[] =>
    machineItems
      .find((each) => each.integration.id === id)
      ?.projects.filter((each) => each.enabled)
      .map((each) => each.name) ?? []
  const [problem, setProblem] = useState<string>()

  const use = async (id: string): Promise<void> => {
    const result = await call('integrations.setEnabled', { projectId: project.id, id, enabled: true })
    if (!result.ok) return setProblem(result.error)
    onDone()
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-int-dialog w-int-dialog--wide" data-testid="add-integration">
      <div className="w-int-dialog__head">
        {step.kind === 'form' && preset === undefined ? (
          <Button quiet onClick={() => setStep({ kind: 'catalogue' })}>
            ← Catalogue
          </Button>
        ) : null}
        <h3 id={titleId} className="w-int-dialog__title">
          {step.kind === 'form' ? step.entry.name : 'Add integration'}
        </h3>
        <span className="w-mono w-int__note">{project.name}</span>
      </div>
      {step.kind === 'catalogue' ? (
        <div className="w-int-dialog__body">
          {reuse.length > 0 ? (
            <>
              <div className="w-int__sect">Already on this Machine</div>
              <ul className="w-int-reuse" data-testid="add-integration-reuse">
                {reuse.map((item) => {
                  const projects = usedIn(item.integration.id)
                  return (
                    <li key={item.integration.id} className="w-int-reuse__row">
                      <span>
                        Use in this Project: <b>{item.integration.label}</b>{' '}
                        <span className="w-int__note">
                          (used in {projects.length} Project
                          {projects.length === 1 ? '' : 's'}
                          {projects.length > 0 ? `: ${projects.join(', ')}` : ''})
                        </span>
                      </span>
                      <Button onClick={() => void use(item.integration.id)}>Use in this Project</Button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          <div className="w-int__sect">Catalogue</div>
          <ul className="w-int-catalogue" data-testid="add-integration-catalogue">
            {CATALOGUE.map((entry) => (
              <li key={entry.key}>
                <button type="button" className="w-int-catalogue__item" onClick={() => setStep({ kind: 'form', entry })} data-key={entry.key}>
                  <span className="w-int-catalogue__name">{entry.name}</span>
                  <span className="w-int__note">{entry.hint}</span>
                  <span className="w-int-catalogue__ways">
                    {entry.auth
                      .map((auth) => (auth === 'oauth' ? 'Sign in' : auth === 'none' ? null : 'API token'))
                      .filter((way, index, all) => way !== null && all.indexOf(way) === index)
                      .join(' · ')}
                  </span>
                  {entry.mayRefuse === null ? null : <span className="w-int__note">{entry.mayRefuse}</span>}
                </button>
              </li>
            ))}
          </ul>
          {problem === undefined ? null : (
            <p role="alert" className="w-int__error">
              {problem}
            </p>
          )}
          <div className="w-int-dialog__foot">
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : step.kind === 'form' ? (
        <ServiceForm entry={step.entry} project={project} labels={items.map((item) => item.integration.label)} onClose={onClose} onAdded={(result) => setStep({ kind: 'result', ...result })} call={call} />
      ) : (
        <div className="w-int-dialog__body" data-testid="add-integration-result">
          <p className="w-int__note">
            <b>{step.label}</b> is on this Machine and enabled in {project.name}.
          </p>
          <p data-testid="add-integration-result-status" data-status={step.status?.state ?? 'none'}>
            {step.problem !== null
              ? step.problem
              : step.status?.state === 'signed-in'
                ? `Signed in${step.tools === null ? '' : ` · ${step.tools}`}`
                : step.status?.state === 'error'
                  ? `The service answered: ${step.status.message}`
                  : 'Sign-in needed: the service did not take the sign-in.'}
          </p>
          <div className="w-int-dialog__foot">
            <Button variant="primary" onClick={onDone} data-testid="add-integration-done">
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

interface ServiceFormProps {
  entry: CatalogueEntry
  project: { id: string; name: string }
  labels: readonly string[]
  onClose: () => void
  onAdded: (result: { label: string; status: IntegrationStatus | null; problem: string | null; tools: string | null }) => void
  call: typeof invoke
}

function ServiceForm({ entry, project, labels, onClose, onAdded, call }: ServiceFormProps) {
  const ways = offered(entry)
  const custom = entry.server.kind === 'custom'
  const [label, setLabel] = useState(entry.defaultLabel)
  const [auth, setAuth] = useState<IntegrationAuth | 'gh'>(firstWay(ways))
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [headerName, setHeaderName] = useState('Authorization')
  const [kind, setKind] = useState<'http' | 'stdio'>('http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState<EnvRow[]>([])
  const [gh, setGh] = useState<{ account: string; warning: string } | null>(null)
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const id = useId()

  // The Project's gh account, offered for GitHub (ticket 04): asked once, never its token.
  useEffect(() => {
    if (entry.key !== 'github') return
    let active = true
    void call('integrations.ghOffer', { projectId: project.id }).then((result) => {
      if (active && result.ok) setGh(result.value.offer)
    })
    return () => {
      active = false
    }
  }, [call, entry.key, project.id])

  const taken = labels.find((other) => sameLabel(other, label))
  const stdio = custom && kind === 'stdio'
  const authNow: IntegrationAuth = auth === 'gh' ? 'bearer' : stdio ? 'none' : auth
  const urlProblem = custom && kind === 'http' && url !== '' ? addressProblem(url) : null

  const submit = async (): Promise<void> => {
    if (label.trim() === '') return setProblem('Needs a label.')
    if (taken !== undefined) return setProblem(`${taken} is already on this Machine. Labels are unique on the Machine.`)
    let transport: IntegrationTransport | undefined
    if (custom && kind === 'http') {
      const bad = addressProblem(url)
      if (bad !== null) return setProblem(bad)
      transport = { kind: 'http', url: url.trim() }
    }
    if (stdio) {
      if (command.trim() === '') return setProblem('Needs the command.')
      const named = env.filter((row) => row.name.trim() !== '')
      if (named.some((row) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(row.name.trim()))) return setProblem('A variable name is letters, digits and _, not starting with a digit.')
      transport = {
        kind: 'stdio',
        command: command.trim(),
        args: args.split(/\s+/u).filter((arg) => arg !== ''),
        env: Object.fromEntries(named.filter((row) => !row.secret).map((row) => [row.name.trim(), row.value])),
        secretEnv: named.filter((row) => row.secret).map((row) => row.name.trim()),
      }
    }
    const secrets: { part: IntegrationSecretPart; value: string }[] = []
    if (authNow === 'basic') {
      const pair = basicPair(email, token)
      if ('problem' in pair) return setProblem(pair.problem)
      secrets.push({ part: 'access', value: pair.value })
    } else if ((authNow === 'bearer' || authNow === 'header') && auth !== 'gh') {
      if (token === '') return setProblem('Needs the token.')
      secrets.push({ part: 'access', value: token })
    }
    if (authNow === 'header' && !/^[A-Za-z0-9-]+$/u.test(headerName)) return setProblem('A header name is letters, digits and -.')
    if (stdio) {
      for (const row of env.filter((each) => each.secret && each.name.trim() !== '')) {
        if (row.value === '') return setProblem(`Needs the value of ${row.name.trim()}.`)
        secrets.push({ part: `env:${row.name.trim()}`, value: row.value })
      }
    }
    setProblem(undefined)
    setBusy(true)
    const added = await call('integrations.add', {
      projectId: project.id,
      service: entry.key,
      label: label.trim(),
      auth: authNow,
      ...(transport === undefined ? {} : { transport }),
      ...(authNow === 'header' ? { headerName } : {}),
    })
    if (!added.ok) {
      setBusy(false)
      return setProblem(added.error)
    }
    const integrationId = added.value.integration.id
    let status: IntegrationStatus | null = null
    let failed: string | null = null
    if (auth === 'gh') {
      const signed = await call('integrations.ghSignIn', { projectId: project.id, id: integrationId })
      if (signed.ok) status = signed.value.status
      else failed = signed.error
    } else if (authNow === 'oauth') {
      // The service's sign-in window; a sign-in that did not finish leaves the Integration added, needing one.
      const signed = await call('integrations.signIn', { projectId: project.id, id: integrationId })
      if (signed.ok) status = { state: 'signed-in' }
      else failed = signed.error
    } else if (secrets.length > 0) {
      const kept = await keepSecrets(integrationId, secrets)
      if ('problem' in kept) failed = kept.problem
      else status = kept.status
    } else status = { state: 'signed-in' }
    let tools: string | null = null
    // The tools are asked only of an Integration whose sign-in held: nothing starts after a failure.
    if (failed === null && status?.state !== 'needs-sign-in') {
      const listed = await call('integrations.tools', { projectId: project.id, id: integrationId })
      if (listed.ok) {
        status = listed.value.status
        tools = listed.value.tools === null ? null : costText(listed.value.tools, 'all')
      }
    }
    setBusy(false)
    onAdded({ label: label.trim(), status, problem: failed, tools })
  }

  const field = (key: string, text: string, input: ReactNode, help?: ReactNode) => (
    <div className="w-int-field" key={key}>
      <label htmlFor={`${id}-${key}`} className="w-int-field__label">
        {text}
      </label>
      {input}
      {help === undefined ? null : <span className="w-int__note">{help}</span>}
    </div>
  )

  return (
    <div className="w-int-dialog__body" data-testid="add-integration-form" data-key={entry.key}>
      <span className="w-int__note">{entry.hint}</span>
      {entry.mayRefuse === null ? null : <span className="w-int__note">{entry.mayRefuse}</span>}
      {field(
        'label',
        'Label',
        <input id={`${id}-label`} className="w-int-field__input" value={label} aria-invalid={taken !== undefined} onChange={(event) => setLabel(event.target.value)} />,
        taken !== undefined ? <span className="w-int__error">{taken} is already on this Machine. Labels are unique on the Machine.</span> : 'Unique on this Machine: «Jira — client A».',
      )}
      {custom ? (
        <div className="w-int-field" role="radiogroup" aria-label="Server">
          <span className="w-int-field__label">Server</span>
          <label className="w-int__check">
            <input type="radio" name={`${id}-kind`} checked={kind === 'http'} onChange={() => setKind('http')} /> Address (streamable HTTP)
          </label>
          <label className="w-int__check">
            <input type="radio" name={`${id}-kind`} checked={kind === 'stdio'} onChange={() => setKind('stdio')} /> Command worfy starts (stdio)
          </label>
        </div>
      ) : null}
      {custom && kind === 'http'
        ? field(
            'url',
            'Address',
            <input id={`${id}-url`} className="w-int-field__input w-mono" value={url} placeholder="https://…" aria-invalid={urlProblem !== null} onChange={(event) => setUrl(event.target.value)} />,
            urlProblem ?? 'worfy holds the connection; Sessions get worfy’s server under the label’s name.',
          )
        : null}
      {stdio ? (
        <>
          {field(
            'command',
            'Command',
            <input id={`${id}-command`} className="w-int-field__input w-mono" value={command} onChange={(event) => setCommand(event.target.value)} />,
            'worfy starts the process itself; secrets go into its environment, never into its arguments.',
          )}
          {field('args', 'Arguments', <input id={`${id}-args`} className="w-int-field__input w-mono" value={args} onChange={(event) => setArgs(event.target.value)} />, 'Separated by spaces.')}
          <div className="w-int-field" aria-label="Environment variables" role="group">
            <span className="w-int-field__label">Environment variables</span>
            {env.map((row, index) => (
              <div key={index} className="w-int-env">
                <input
                  className="w-int-field__input w-mono"
                  aria-label="Variable name"
                  value={row.name}
                  onChange={(event) => setEnv(env.map((each, at) => (at === index ? { ...each, name: event.target.value } : each)))}
                />
                <input
                  className="w-int-field__input w-mono"
                  aria-label={`Value of ${row.name || 'the variable'}`}
                  type={row.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={row.value}
                  onChange={(event) => setEnv(env.map((each, at) => (at === index ? { ...each, value: event.target.value } : each)))}
                />
                <label className="w-int__check">
                  <input type="checkbox" checked={row.secret} onChange={(event) => setEnv(env.map((each, at) => (at === index ? { ...each, secret: event.target.checked } : each)))} /> Secret
                </label>
                <Button quiet aria-label={`Remove ${row.name || 'the variable'}`} onClick={() => setEnv(env.filter((_each, at) => at !== index))}>
                  ×
                </Button>
              </div>
            ))}
            <Button quiet onClick={() => setEnv([...env, { name: '', value: '', secret: false }])}>
              Add variable
            </Button>
            <span className="w-int__note">A value marked Secret goes to worfy’s secret store, not to the Integration’s list.</span>
          </div>
        </>
      ) : (
        <div className="w-int-field" role="radiogroup" aria-label="Sign-in">
          <span className="w-int-field__label">Sign-in</span>
          {ways.map((way) => (
            <label key={way} className="w-int__check">
              <input type="radio" name={`${id}-auth`} checked={auth === way} onChange={() => setAuth(way)} /> {wayName(entry, way)}
            </label>
          ))}
          {gh === null ? null : (
            <label className="w-int__check">
              <input type="radio" name={`${id}-auth`} checked={auth === 'gh'} onChange={() => setAuth('gh')} /> The token of the gh account {gh.account}
            </label>
          )}
          {auth === 'gh' && gh !== null ? (
            <span className="w-int__warn" data-testid="add-integration-gh-warning">
              {gh.warning}
            </span>
          ) : null}
        </div>
      )}
      {authNow === 'header' && !stdio
        ? field('header', 'Header name', <input id={`${id}-header`} className="w-int-field__input w-mono" value={headerName} onChange={(event) => setHeaderName(event.target.value)} />)
        : null}
      {authNow === 'basic'
        ? field('email', 'E-mail', <input id={`${id}-email`} className="w-int-field__input" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />)
        : null}
      {!stdio && auth !== 'gh' && authNow !== 'none' && authNow !== 'oauth'
        ? field(
            'token',
            authNow === 'header' ? `${headerName || 'Header'} value` : 'API token',
            <input
              id={`${id}-token`}
              className="w-int-field__input w-mono"
              type="password"
              autoComplete="off"
              value={token}
              placeholder="Paste the token"
              onChange={(event) => setToken(event.target.value)}
            />,
            <>
              {entry.tokenHint ?? 'The value goes to worfy’s secret store.'}
              {entry.tokenUrl === null ? null : (
                <>
                  {' '}
                  <Button variant="link" onClick={() => void invoke('shell.openExternal', { url: entry.tokenUrl ?? '' })}>
                    Where to get a token
                  </Button>
                </>
              )}
            </>,
          )
        : null}
      {entry.tokenNote !== null && (authNow === 'basic' || authNow === 'bearer') && auth !== 'gh' ? (
        <span className="w-int__warn" data-testid="add-integration-token-note">
          {entry.tokenNote.text}{' '}
          <Button variant="link" onClick={() => void invoke('shell.openExternal', { url: entry.tokenNote?.url ?? '' })}>
            How to turn it on
          </Button>
        </span>
      ) : null}
      {problem === undefined ? null : (
        <p role="alert" className="w-int__error" data-testid="add-integration-problem">
          {problem}
        </p>
      )}
      <div className="w-int-dialog__foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()} data-testid="add-integration-save">
          {authNow === 'oauth' ? (busy ? 'Signing in…' : wayName(entry, 'oauth')) : busy ? 'Checking…' : 'Add'}
        </Button>
      </div>
    </div>
  )
}
