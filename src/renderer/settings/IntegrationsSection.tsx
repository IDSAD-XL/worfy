// Settings → Integrations (worfy-integrations ticket 08; spec, the decision, 2; ADR-0111, 2): every Integration of this
// Machine, its status, the Projects that use it, Sign out and Remove. An Integration no Project uses any more (its
// Projects removed or turned it off) shows «Not used in any Project», so it can be removed. The entries a Project
// keeps of an Integration the Machine no longer has (a Remove cut short) are named in one line with Clean up.
// Everything here is the Machine's own: the channels are `local`.
import { useEffect, useState } from 'react'
import { catalogueEntry } from '../../shared/integrations/catalogue'
import type { MachineIntegration } from '../../shared/ipc/integrations'
import { invoke } from '../ipc'
import { Button } from '../theme/Button'
import '../integrations/integrations.css'

export const order = 64
export const title = 'Integrations'

const STATUS_TEXT = { 'signed-in': 'Signed in', 'needs-sign-in': 'Sign-in needed', error: 'Error', checking: 'Checking' } as const

export default function IntegrationsSection() {
  const [items, setItems] = useState<MachineIntegration[]>()
  const [dangling, setDangling] = useState<{ projectId: string; name: string; count: number }[]>([])
  const [problem, setProblem] = useState<string>()
  const [confirm, setConfirm] = useState<{ id: string; projects: string[] } | null>(null)

  // Read again after a change: a new generation runs the effect once more.
  const [generation, setGeneration] = useState(0)
  const load = (): void => setGeneration((was) => was + 1)

  useEffect(() => {
    let active = true
    void invoke('integrations.machine').then((result) => {
      if (!active) return
      if (!result.ok) return setProblem(result.error)
      setProblem(undefined)
      setItems(result.value.items)
      setDangling(result.value.dangling)
    })
    return () => {
      active = false
    }
  }, [generation])

  const signOut = async (id: string): Promise<void> => {
    const result = await invoke('integrations.signOut', { id })
    if (!result.ok) return setProblem(result.error)
    load()
  }
  const remove = async (id: string, confirmed: boolean): Promise<void> => {
    const result = await invoke('integrations.remove', { id, confirmed })
    if (!result.ok) return setProblem(result.error)
    if (result.value.status === 'confirm') return setConfirm({ id, projects: result.value.projects })
    setConfirm(null)
    load()
  }
  const cleanUp = async (): Promise<void> => {
    const result = await invoke('integrations.cleanUp')
    if (!result.ok) return setProblem(result.error)
    load()
  }

  return (
    <div className="w-int w-int--settings" data-testid="settings-integrations">
      <p className="w-int__lead">The accounts worfy signs in to, kept on this Machine. A Project turns each one on in Project settings → Integrations.</p>
      {items === undefined ? null : items.length === 0 ? (
        <p className="w-int__note" data-testid="settings-integrations-empty">
          No Integrations on this Machine yet: add one in a Project&apos;s settings.
        </p>
      ) : (
        <table className="w-int-table">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Status</th>
              <th>Used in</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ integration, status, projects }) => {
              const used = projects.filter((project) => project.enabled)
              const off = projects.filter((project) => !project.enabled)
              return (
                <tr key={integration.id} data-testid="settings-integration" data-id={integration.id}>
                  <td>
                    <b>{integration.label}</b>
                    <div className="w-int__note">{catalogueEntry(integration.service)?.name ?? integration.service}</div>
                  </td>
                  <td data-testid="settings-integration-status">{status.state === 'error' ? `Error: ${status.message}` : STATUS_TEXT[status.state]}</td>
                  <td data-testid="settings-integration-used">
                    {used.length === 0 ? <span className="w-int__flag w-int__flag--off">Not used in any Project</span> : used.map((project) => project.name).join(', ')}
                    {off.length === 0 ? null : <div className="w-int__note">Off in {off.map((project) => project.name).join(', ')}</div>}
                  </td>
                  <td className="w-int__acts">
                    <Button disabled={status.state === 'needs-sign-in'} onClick={() => void signOut(integration.id)}>
                      Sign out
                    </Button>
                    <Button variant="danger" onClick={() => void remove(integration.id, false)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {confirm === null ? null : (
        <div className="w-int__warnline" role="group" aria-label="Remove the Integration" data-testid="settings-integration-confirm">
          Remove {items?.find((item) => item.integration.id === confirm.id)?.integration.label} from this Machine? It is enabled in {confirm.projects.join(', ')}.
          <span className="w-int__acts">
            <Button variant="danger" onClick={() => void remove(confirm.id, true)}>
              Remove
            </Button>
            <Button onClick={() => setConfirm(null)}>Keep</Button>
          </span>
        </div>
      )}
      {dangling.length === 0 ? null : (
        <div className="w-int__warnline" data-testid="settings-integrations-dangling">
          {dangling.map((each) => `${each.name} (${each.count})`).join(', ')} still name{dangling.length === 1 ? 's' : ''} Integrations no longer on this Machine: a removal was cut short.
          <span className="w-int__acts">
            <Button onClick={() => void cleanUp()}>Clean up</Button>
          </span>
        </div>
      )}
      {problem === undefined ? null : (
        <p role="alert" className="w-int__error">
          {problem}
        </p>
      )}
    </div>
  )
}
