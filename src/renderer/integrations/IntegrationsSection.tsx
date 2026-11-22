// Project settings → Integrations (worfy-integrations ticket 08; spec, the user's path through the screens, 1–3 and
// 5–10; ADR-0111): the group «worfy integrations» — a row per Integration the Project has an entry for, with its
// status, the price of its tools after the Project's filter (cost.ts), the Tools filter, «Enabled in this Project»,
// «Available to Autopilot» and the menu «…» — and the group «From Claude Code» (ClaudeServers.tsx). The look is the
// prototype Card of ticket 02.
//
// What is asked of main: integrations.list and integrations.status once, then integrations.tools for each enabled
// row that has its secrets (nothing is asked after a failed list). Every change goes to main at once — there is no
// Save here — and the row shows main's answer.
//
// A Linked machine (spec, decided without the owner, 3; ADR-0111, 8): with read-only access the list and the statuses
// show and nothing can be changed; with full access the ticks, the filter and Rename work, while Add integration, a
// token, Sign out and Remove — the `local` channels — are off with «on the Project's machine only».
//
// worfy-integrations ticket 09: an Integration that signs in with OAuth has Sign in on its row while it needs one, and
// Re-sign in in «…» — integrations.signIn, whose window opens on the Project's Machine, so a Linked machine with full
// access may press it too; the row reads checking meanwhile, then the site of the sign-in and the tools.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { catalogueEntry } from '../../shared/integrations/catalogue'
import type { Integration, IntegrationStatus, IntegrationTools, ProjectIntegration } from '../../shared/integrations/types'
import type { IpcResult } from '../../shared/ipc/channels'
import type { IntegrationListItem, IntegrationToolInfo, MachineIntegration } from '../../shared/ipc/integrations'
import { invoke, invokeOn, windowMachine } from '../ipc'
import { Button } from '../theme/Button'
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../theme/kit/Menu'
import { AddIntegrationDialog } from './AddIntegrationDialog'
import { ClaudeServers } from './ClaudeServers'
import { costText, filtered, filterName, hasReadOnlyHints, costOf, tokensText } from './cost'
import { ChooseToolsDialog, RemoveDialog, RenameDialog, TokenDialog } from './dialogs'
import { usesToken } from './model'
import './integrations.css'

export const ONLY_ON_PROJECT_MACHINE = "On the Project's machine only: a token never crosses the link."

export interface IntegrationsSectionProps {
  project: { id: string; name: string; path?: string }
  /** As ProjectSettingsProps.machine: undefined — the window's Machine, null — this one, an id — a Linked machine. */
  machine?: string | null
  /** Why the Project of a Linked machine is shared read-only; null with full access. */
  readOnly: string | null
}

/** What integrations.tools answered for a row, or that it is being asked. */
type ToolsAnswer = { state: 'checking' } | { state: 'known'; status: IntegrationStatus; tools: IntegrationToolInfo[] | null; hidden: string[] }

/** The dialog open over the section. */
type Open =
  { kind: 'add'; service?: string } | { kind: 'rename'; id: string } | { kind: 'remove'; id: string; projects: string[] } | { kind: 'choose'; id: string } | { kind: 'token'; id: string } | null

/** The text of a status on its flag. */
const STATUS_TEXT: Record<IntegrationStatus['state'], string> = { 'signed-in': 'Signed in', 'needs-sign-in': 'Sign-in needed', error: 'Error', checking: 'Checking' }

/** The host of an http Integration, the command of a stdio one: where it is when the sign-in names no site. */
function whereOf(integration: Integration): string {
  const { transport } = integration
  if (transport.kind === 'stdio') return `stdio · ${[transport.command, ...transport.args].join(' ')}`
  try {
    return new URL(transport.url).host
  } catch {
    return transport.url
  }
}

/** The line under the label: the site and the account when signed in, else why not. */
function subLine(integration: Integration, status: IntegrationStatus): string {
  switch (status.state) {
    case 'signed-in':
      return [integration.signIn?.site ?? whereOf(integration), integration.signIn?.account].filter((part): part is string => part !== null && part !== undefined && part !== '').join(' · ')
    case 'needs-sign-in':
      return 'Sign-in needed. Sessions get «Sign-in needed» from its tools.'
    case 'error':
      return `${whereOf(integration)} answered: ${status.message}`
    case 'checking':
      return 'Checking — initialize, tools/list…'
  }
}

export function IntegrationsSection({ project, machine, readOnly }: IntegrationsSectionProps) {
  const call = useMemo<typeof invoke>(() => (machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)), [machine])
  const remote = (machine === undefined ? windowMachine() : machine) !== null
  const locked = readOnly !== null
  const [items, setItems] = useState<IntegrationListItem[]>()
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({})
  const [tools, setTools] = useState<Record<string, ToolsAnswer>>({})
  const [machineItems, setMachineItems] = useState<MachineIntegration[]>([])
  const [failure, setFailure] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const [open, setOpen] = useState<Open>(null)
  const [menu, setMenu] = useState<{ kind: 'filter' | 'more'; id: string } | null>(null)

  /** Asks the service for the tools of Integration `id` (Test, and the count of every enabled row). */
  const test = useCallback(
    async (id: string): Promise<void> => {
      setTools((was) => ({ ...was, [id]: { state: 'checking' } }))
      const result = await call('integrations.tools', { projectId: project.id, id })
      setTools((was) => ({ ...was, [id]: result.ok ? { state: 'known', ...result.value } : { state: 'known', status: { state: 'error', message: result.error }, tools: null, hidden: [] } }))
    },
    [call, project.id],
  )

  // Read again after Add integration and Remove: a new generation runs the effect below once more.
  const [generation, setGeneration] = useState(0)
  const reload = (): void => setGeneration((was) => was + 1)

  useEffect(() => {
    let active = true
    void Promise.all([call('integrations.list', { projectId: project.id }), call('integrations.status', { projectId: project.id })]).then(async ([list, status]) => {
      if (!active) return
      if (!list.ok || !status.ok) {
        // Nothing is asked of a service after a failed read.
        setFailure(list.ok ? (status.ok ? undefined : status.error) : list.error)
        return
      }
      setFailure(undefined)
      setItems(list.value.items)
      const known = Object.fromEntries(status.value.statuses.map((each) => [each.id, each.status]))
      setStatuses(known)
      // The Machine's view (used in N Projects) is local: a Linked machine's window does without it.
      if (!remote) {
        const all = await invoke('integrations.machine')
        if (active && all.ok) setMachineItems(all.value.items)
      }
      if (!active) return
      for (const item of list.value.items) {
        if (item.project?.enabled !== true) continue
        if (known[item.integration.id]?.state === 'needs-sign-in') continue
        void test(item.integration.id)
      }
    })
    return () => {
      active = false
    }
  }, [call, project.id, remote, test, generation])

  /** A change of the Project's entry, shown when main took it. */
  const change = async (id: string, apply: () => Promise<IpcResult<{ project: ProjectIntegration }>>): Promise<void> => {
    const result = await apply()
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    setProblem(undefined)
    setItems((was) => was?.map((item) => (item.integration.id === id ? { ...item, project: result.value.project } : item)))
    if (result.value.project.enabled && tools[id] === undefined && statuses[id]?.state !== 'needs-sign-in') void test(id)
  }
  const setEnabled = (id: string, enabled: boolean): Promise<void> => change(id, () => call('integrations.setEnabled', { projectId: project.id, id, enabled }))
  const setAutopilot = (id: string, autopilot: boolean): Promise<void> => change(id, () => call('integrations.setAutopilot', { projectId: project.id, id, autopilot }))
  const setFilter = (id: string, filter: IntegrationTools): Promise<void> => change(id, () => call('integrations.setTools', { projectId: project.id, id, tools: filter }))

  /** OAuth sign-in of Integration `id` in worfy's window (ticket 09): checking meanwhile, then its tools are asked. */
  const signIn = async (id: string): Promise<void> => {
    setTools((was) => ({ ...was, [id]: { state: 'checking' } }))
    const result = await call('integrations.signIn', { projectId: project.id, id })
    if (!result.ok) {
      setProblem(result.error)
      setTools((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key !== id)))
      return
    }
    setProblem(undefined)
    setItems((was) => was?.map((item) => (item.integration.id === id ? { ...item, integration: { ...item.integration, signIn: result.value.signIn } } : item)))
    setStatuses((was) => ({ ...was, [id]: { state: 'signed-in' } }))
    void test(id)
  }

  const signOut = async (id: string): Promise<void> => {
    const result = await invoke('integrations.signOut', { id })
    if (!result.ok) return setProblem(result.error)
    setStatuses((was) => ({ ...was, [id]: result.value.status }))
    setTools((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key !== id)))
  }

  const remove = async (id: string, confirmed: boolean): Promise<void> => {
    const result = await invoke('integrations.remove', { projectId: project.id, id, confirmed })
    if (!result.ok) return setProblem(result.error)
    if (result.value.status === 'confirm') {
      setOpen({ kind: 'remove', id, projects: result.value.projects })
      return
    }
    setOpen(null)
    reload()
  }

  const rows = (items ?? []).filter((item): item is IntegrationListItem & { project: ProjectIntegration } => item.project !== null)
  const statusOf = (id: string): IntegrationStatus => {
    const answer = tools[id]
    if (answer?.state === 'checking') return { state: 'checking' }
    if (answer?.state === 'known') return answer.status
    return statuses[id] ?? { state: 'checking' }
  }
  const toolsOf = (id: string): IntegrationToolInfo[] | null => {
    const answer = tools[id]
    return answer?.state === 'known' ? answer.tools : null
  }
  const usedIn = (id: string): string[] =>
    machineItems
      .find((each) => each.integration.id === id)
      ?.projects.filter((each) => each.enabled)
      .map((each) => each.name) ?? []
  const openOf = (id: string): (IntegrationListItem & { project: ProjectIntegration }) | undefined => rows.find((row) => row.integration.id === id)

  return (
    <section className="w-int" aria-label="Integrations" data-testid="integrations-section">
      <p className="w-int__lead">
        Integrations are accounts worfy signs in to for you — one per service and account, kept on this Machine. Sessions of <span className="w-mono">{project.name}</span> get the ones turned on here
        as MCP servers; Claude Code and Codex never see the sign-in.
      </p>
      <section className="w-int__group" aria-label="worfy integrations" data-testid="integrations-worfy">
        <div className="w-int__ghead">
          <h3>worfy integrations</h3>
          <span className="w-int__count">{rows.length}</span>
          <span className="w-int__spacer" />
          <Button
            variant="primary"
            disabled={locked || remote || items === undefined}
            title={remote ? ONLY_ON_PROJECT_MACHINE : undefined}
            onClick={() => setOpen({ kind: 'add' })}
            data-testid="integrations-add"
          >
            Add integration
          </Button>
        </div>
        {remote && !locked ? <p className="w-int__note">Add integration and tokens: {ONLY_ON_PROJECT_MACHINE}</p> : null}
        {failure !== undefined ? (
          <p role="alert" className="w-int__error" data-testid="integrations-failure">
            Integrations could not be read: {failure}
          </p>
        ) : items === undefined ? (
          <p className="w-int__note">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="w-int__empty" data-testid="integrations-empty">
            <b>No Integrations in {project.name} yet</b>
            <span>Add Jira, Linear, Notion… An account already on this Machine turns on here with one click, without a second sign-in.</span>
          </div>
        ) : (
          <ul className="w-int__rows">
            {rows.map(({ integration, project: entry }) => {
              const id = integration.id
              const status = statusOf(id)
              const list = toolsOf(id)
              const hints = list !== null && hasReadOnlyHints(list)
              const service = catalogueEntry(integration.service)?.name ?? integration.service
              const others = usedIn(id).filter((name) => name !== project.name)
              return (
                <li key={id} className={`w-int__row${entry.enabled ? '' : ' w-int__row--off'}`} data-testid="integration-row" data-id={id} data-status={status.state}>
                  <span className={`w-int__dot w-int__dot--${entry.enabled ? status.state : 'off'}`} role="img" aria-label={entry.enabled ? STATUS_TEXT[status.state] : 'Off in this Project'} />
                  <div className="w-int__main">
                    <div className="w-int__title">
                      <span className="w-int__label">{integration.label}</span>
                      <span className={`w-int__flag w-int__flag--${status.state}`} data-testid="integration-status">
                        {STATUS_TEXT[status.state]}
                      </span>
                      {entry.enabled ? null : <span className="w-int__flag w-int__flag--off">Off in this Project</span>}
                    </div>
                    <div className={`w-int__sub${status.state === 'error' || status.state === 'needs-sign-in' ? ' w-int__sub--bad' : ''}`} data-testid="integration-sub">
                      {service} · {subLine(integration, status)}
                    </div>
                    {others.length > 0 ? <div className="w-int__sub">Also used in {others.join(', ')}</div> : null}
                  </div>
                  <span className="w-int__cost" data-testid="integration-cost" title="Counted after this Project's Tools filter: what its Sessions get in every request to the model.">
                    {status.state === 'checking' ? 'counting…' : list === null ? '—' : costText(list, entry.tools)}
                  </span>
                  {status.state === 'needs-sign-in' ? (
                    integration.auth === 'oauth' ? (
                      <Button disabled={locked} title="Opens the service’s sign-in page in a worfy window on the Project’s Machine." onClick={() => void signIn(id)} data-testid="integration-sign-in">
                        Sign in
                      </Button>
                    ) : (
                      <Button
                        disabled={locked || remote || !usesToken(integration)}
                        title={remote ? ONLY_ON_PROJECT_MACHINE : usesToken(integration) ? undefined : 'This Integration has no sign-in worfy can do.'}
                        onClick={() => setOpen({ kind: 'token', id })}
                        data-testid="integration-sign-in"
                      >
                        Sign in
                      </Button>
                    )
                  ) : (
                    <Menu
                      open={menu?.kind === 'filter' && menu.id === id}
                      onOpenChange={(next) => setMenu(next ? { kind: 'filter', id } : null)}
                      label={`Tools of ${integration.label}`}
                      layer="dialogMenu"
                      trigger={
                        <button type="button" className="w-int__filter" disabled={locked} aria-label={`Tools of ${integration.label}: ${filterName(entry.tools)}`} data-testid="integration-filter">
                          {filterName(entry.tools)} ▾
                        </button>
                      }
                    >
                      <MenuRadioGroup value={entry.tools === 'all' || entry.tools === 'read-only' ? entry.tools : 'chosen'}>
                        <MenuRadioItem value="all" closeOnClick onClick={() => void setFilter(id, 'all')} testId="integration-filter-all">
                          <span>All</span>
                          <span className="w-int__menu-right">{list === null ? '—' : `${list.length} · ${tokensText(costOf(list).tokens)}`}</span>
                        </MenuRadioItem>
                        <MenuRadioItem value="read-only" closeOnClick disabled={!hints} onClick={() => void setFilter(id, 'read-only')} testId="integration-filter-read-only">
                          <span>
                            Read only
                            {hints ? null : (
                              <span className="w-int__why" data-testid="integration-read-only-why">
                                {list === null
                                  ? 'Known after the next successful check.'
                                  : `Not available: ${service} marks no tool read-only (no readOnlyHint), so worfy cannot tell reads from writes. Use Choose….`}
                              </span>
                            )}
                          </span>
                          <span className="w-int__menu-right">
                            {hints && list !== null ? `${filtered(list, 'read-only').length} · ${tokensText(costOf(filtered(list, 'read-only')).tokens)}` : '—'}
                          </span>
                        </MenuRadioItem>
                        <MenuRadioItem value="chosen" closeOnClick disabled={list === null} onClick={() => setOpen({ kind: 'choose', id })} testId="integration-filter-choose">
                          <span>Choose…</span>
                        </MenuRadioItem>
                      </MenuRadioGroup>
                    </Menu>
                  )}
                  <label className="w-int__check">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={locked}
                      aria-label={`Enabled in this Project: ${integration.label}`}
                      onChange={(event) => void setEnabled(id, event.target.checked)}
                    />
                    Enabled
                  </label>
                  <label className="w-int__check" title="Autopilot Sessions get this Integration only with this on. Autopilot never opens a sign-in window.">
                    <input
                      type="checkbox"
                      checked={entry.autopilot}
                      disabled={locked}
                      aria-label={`Available to Autopilot: ${integration.label}`}
                      onChange={(event) => void setAutopilot(id, event.target.checked)}
                    />
                    Autopilot
                  </label>
                  <Menu
                    open={menu?.kind === 'more' && menu.id === id}
                    onOpenChange={(next) => setMenu(next ? { kind: 'more', id } : null)}
                    label={`More for ${integration.label}`}
                    layer="dialogMenu"
                    align="end"
                    trigger={
                      <button type="button" className="w-int__more" aria-label={`More for ${integration.label}`} data-testid="integration-more">
                        …
                      </button>
                    }
                  >
                    <MenuItem disabled={!entry.enabled || statusOf(id).state === 'needs-sign-in'} onClick={() => void test(id)} testId="integration-test">
                      Test
                    </MenuItem>
                    <MenuItem disabled={locked} onClick={() => setOpen({ kind: 'rename', id })} testId="integration-rename">
                      Rename
                    </MenuItem>
                    {integration.auth === 'oauth' ? (
                      <MenuItem disabled={locked || statusOf(id).state === 'checking'} onClick={() => void signIn(id)} testId="integration-re-sign-in">
                        Re-sign in
                      </MenuItem>
                    ) : null}
                    <MenuItem disabled={locked || remote || statuses[id]?.state === 'needs-sign-in'} onClick={() => void signOut(id)} testId="integration-sign-out">
                      Sign out
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem disabled={locked} onClick={() => void setEnabled(id, !entry.enabled)} testId="integration-toggle">
                      {entry.enabled ? 'Disable in this Project' : 'Enable in this Project'}
                    </MenuItem>
                    <MenuItem disabled={locked || remote} onClick={() => void remove(id, false)} testId="integration-remove">
                      Remove from Machine…
                    </MenuItem>
                  </Menu>
                </li>
              )
            })}
          </ul>
        )}
        {problem !== undefined ? (
          <p role="alert" className="w-int__error" data-testid="integrations-problem">
            {problem}
          </p>
        ) : null}
      </section>

      {project.path === undefined || items === undefined ? null : (
        <ClaudeServers
          path={project.path}
          remote={remote}
          readOnly={locked}
          enabledServices={rows.filter((row) => row.project.enabled).map((row) => ({ service: row.integration.service, label: row.integration.label }))}
          onAddAsIntegration={(service) => setOpen({ kind: 'add', service })}
          call={call}
        />
      )}

      {open?.kind === 'add' ? (
        <AddIntegrationDialog
          project={project}
          items={items ?? []}
          machineItems={machineItems}
          service={open.service}
          call={call}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            setTools({})
            reload()
          }}
        />
      ) : null}
      {open?.kind === 'rename' && openOf(open.id) !== undefined ? (
        <RenameDialog
          integration={openOf(open.id)!.integration}
          labels={(items ?? []).map((item) => item.integration.label)}
          onClose={() => setOpen(null)}
          onRename={async (label) => {
            const result = await call('integrations.rename', { projectId: project.id, id: open.id, label })
            if (!result.ok) return result.error
            setItems((was) => was?.map((item) => (item.integration.id === open.id ? { ...item, integration: result.value.integration } : item)))
            setOpen(null)
            return null
          }}
        />
      ) : null}
      {open?.kind === 'remove' && openOf(open.id) !== undefined ? (
        <RemoveDialog integration={openOf(open.id)!.integration} projects={open.projects} onClose={() => setOpen(null)} onRemove={() => void remove(open.id, true)} />
      ) : null}
      {open?.kind === 'choose' && openOf(open.id) !== undefined ? (
        <ChooseToolsDialog
          integration={openOf(open.id)!.integration}
          tools={toolsOf(open.id) ?? []}
          filter={openOf(open.id)!.project.tools}
          onClose={() => setOpen(null)}
          onChoose={(names) => {
            setOpen(null)
            void setFilter(open.id, names)
          }}
        />
      ) : null}
      {open?.kind === 'token' && openOf(open.id) !== undefined ? (
        <TokenDialog
          integration={openOf(open.id)!.integration}
          onClose={() => setOpen(null)}
          onSignedIn={(status) => {
            setOpen(null)
            setStatuses((was) => ({ ...was, [open.id]: status }))
            if (status.state !== 'needs-sign-in') void test(open.id)
          }}
        />
      ) : null}
    </section>
  )
}
