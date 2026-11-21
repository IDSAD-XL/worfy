// The small windows of Project settings → Integrations (worfy-integrations ticket 08; the prototype Card of ticket 02):
// Rename, Remove from Machine (with the Projects that still use the Integration), Choose tools, and the token of an
// Integration that needs sign-in. A secret typed here goes to main once, by integrations.setSecret; the window keeps it
// in its own state only while it is open and never shows it back.
import { useId, useState, type ReactNode } from 'react'
import { catalogueEntry } from '../../shared/integrations/catalogue'
import type { Integration, IntegrationStatus } from '../../shared/integrations/types'
import type { IntegrationToolInfo } from '../../shared/ipc/integrations'
import { Button } from '../theme/Button'
import { Dialog } from '../theme/kit/Dialog'
import { costOf, tokensText } from './cost'
import { keepSecrets, sameLabel, secretFields, secretsOf } from './model'

/** A window of these: a heading, the body and the buttons. */
function Small({ title, onClose, children, footer, testId }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; testId: string }) {
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-int-dialog" data-testid={testId}>
      <h3 id={titleId} className="w-int-dialog__title">
        {title}
      </h3>
      <div className="w-int-dialog__body">{children}</div>
      <div className="w-int-dialog__foot">{footer}</div>
    </Dialog>
  )
}

export function RenameDialog({
  integration,
  labels,
  onClose,
  onRename,
}: {
  integration: Integration
  labels: readonly string[]
  onClose: () => void
  onRename: (label: string) => Promise<string | null>
}) {
  const [label, setLabel] = useState(integration.label)
  const [problem, setProblem] = useState<string | null>(null)
  const fieldId = useId()
  const taken = labels.some((other) => !sameLabel(other, integration.label) && sameLabel(other, label))
  const bad = label.trim() === '' || taken
  return (
    <Small
      title={`Rename ${integration.label}`}
      onClose={onClose}
      testId="integration-rename-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={bad} onClick={() => void onRename(label.trim()).then(setProblem)}>
            Rename
          </Button>
        </>
      }
    >
      <label htmlFor={fieldId} className="w-int-field__label">
        Label
      </label>
      <input id={fieldId} className="w-int-field__input" value={label} aria-invalid={bad} onChange={(event) => setLabel(event.target.value)} />
      <span className={bad ? 'w-int__error' : 'w-int__note'}>
        {bad ? 'Needs a label no other Integration on this Machine has.' : 'New Sessions get the server under the new name; running Sessions keep the old one until Restart.'}
      </span>
      {problem === null ? null : (
        <span role="alert" className="w-int__error">
          {problem}
        </span>
      )}
    </Small>
  )
}

export function RemoveDialog({ integration, projects, onClose, onRemove }: { integration: Integration; projects: readonly string[]; onClose: () => void; onRemove: () => void }) {
  return (
    <Small
      title={`Remove ${integration.label} from this Machine?`}
      onClose={onClose}
      testId="integration-remove-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onRemove} data-testid="integration-remove-confirm">
            Remove
          </Button>
        </>
      }
    >
      <p className="w-int__note" data-testid="integration-remove-projects">
        It is enabled in {projects.join(', ')} too. Removing it signs out, deletes its secrets and takes it out of every Project of this Machine.
      </p>
    </Small>
  )
}

export function ChooseToolsDialog({
  integration,
  tools,
  filter,
  onClose,
  onChoose,
}: {
  integration: Integration
  tools: readonly IntegrationToolInfo[]
  filter: 'all' | 'read-only' | readonly string[]
  onClose: () => void
  onChoose: (names: string[]) => void
}) {
  const initial = filter === 'all' ? tools.map((tool) => tool.name) : filter === 'read-only' ? tools.filter((tool) => tool.readOnly === true).map((tool) => tool.name) : [...filter]
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(initial))
  const picked = tools.filter((tool) => chosen.has(tool.name))
  return (
    <Small
      title={`Choose tools — ${integration.label}`}
      onClose={onClose}
      testId="integration-choose-dialog"
      footer={
        <>
          <span className="w-int__note">
            {picked.length} of {tools.length} · {tokensText(costOf(picked).tokens)} tokens
          </span>
          <span className="w-int__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onChoose(tools.filter((tool) => chosen.has(tool.name)).map((tool) => tool.name))}>
            Use these tools
          </Button>
        </>
      }
    >
      <ul className="w-int-choose">
        {tools.map((tool) => (
          <li key={tool.name}>
            <label className="w-int__check">
              <input
                type="checkbox"
                checked={chosen.has(tool.name)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(tool.name)
                  else next.delete(tool.name)
                  setChosen(next)
                }}
              />
              <span className="w-mono">{tool.name}</span>
              <span className="w-int__note">{tool.readOnly === true ? 'read-only' : tool.readOnly === false ? 'writes' : ''}</span>
            </label>
          </li>
        ))}
      </ul>
    </Small>
  )
}

export function TokenDialog({ integration, onClose, onSignedIn }: { integration: Integration; onClose: () => void; onSignedIn: (status: IntegrationStatus) => void }) {
  const fields = secretFields(integration)
  const [values, setValues] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const baseId = useId()
  const entry = catalogueEntry(integration.service)
  const submit = async (): Promise<void> => {
    const parsed = secretsOf(fields, values)
    if ('problem' in parsed) return setProblem(parsed.problem)
    setBusy(true)
    const kept = await keepSecrets(integration.id, parsed.secrets)
    setBusy(false)
    if ('problem' in kept) return setProblem(kept.problem)
    if (kept.status.state === 'signed-in') return onSignedIn(kept.status)
    setProblem(kept.status.state === 'error' ? kept.status.message : 'The service did not take it: sign-in needed.')
  }
  return (
    <Small
      title={`Sign in — ${integration.label}`}
      onClose={onClose}
      testId="integration-token-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()} data-testid="integration-token-save">
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
        </>
      }
    >
      {fields.map((field, index) => (
        <div key={field.part} className="w-int-field">
          <label htmlFor={`${baseId}-${index}`} className="w-int-field__label">
            {field.label}
          </label>
          <input
            id={`${baseId}-${index}`}
            className="w-int-field__input w-mono"
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            value={values[field.part] ?? ''}
            onChange={(event) => setValues({ ...values, [field.part]: event.target.value })}
          />
        </div>
      ))}
      {entry?.tokenHint === null || entry?.tokenHint === undefined ? null : <span className="w-int__note">{entry.tokenHint}</span>}
      {problem === undefined ? null : (
        <span role="alert" className="w-int__error" data-testid="integration-token-problem">
          {problem}
        </span>
      )}
    </Small>
  )
}
