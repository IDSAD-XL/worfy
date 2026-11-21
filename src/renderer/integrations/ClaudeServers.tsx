// The group «From Claude Code» of Project settings → Integrations (worfy-integrations ticket 08; spec, implementation
// decisions, the servers of Claude Code beside them; owner's answer Q9). The same servers Edit profile lists beside the
// Profile's MCP servers list (`mcp.allowed`): the names on the list, and the servers of Claude Code the newest
// Session of the Project on this Machine reported (user config, the Project's .mcp.json, claude.ai connectors), each
// with its status there and Allowed or Not allowed. Allow and «Turn off … in this Project» write the list as Edit
// profile does (profileEdit.read and profileEdit.write); nothing else changes it.
//
// When a server is of a service of the catalogue and an Integration of the same service is enabled in the Project,
// the row warns of two tool sets: two accounts' tools side by side, the agent may call the wrong one. «Add as
// integration» opens Add integration on that service; the list does not change by itself. A row carries no address
// (shared/agent/mcp-status.ts: the renderer never gets one), so the service is told by the server's name — the
// connector «claude.ai Atlassian», a server named «linear» or «jira…».
//
// Turning a server of Claude Code off here takes it out of the Sessions of the Project; the screen does not promise it
// saves context: what Claude Code keeps of a server it does not start is Claude Code's.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { WORFY_SERVER_NAMES, type McpServerRow } from '../../shared/agent/mcp-status'
import { catalogueEntry } from '../../shared/integrations/catalogue'
import type { ProfileEditRead } from '../../shared/ipc/profile-edit'
import { invoke } from '../ipc'
import { useOrchestratorViews } from '../canvas/nodes/orchestrator-view'
import { useProjects } from '../projects/useProjects'
import { McpStatusChip } from '../session/McpChip'
import { useSessionNodeViews } from '../session/node-sessions'
import { useLatestMcp } from '../session/store'
import { Button } from '../theme/Button'
import { serviceOfServer } from './model'

const FIELD = 'mcp.allowed'

const SOURCE_TEXT: Record<string, string> = { claudeai: 'claude.ai connector', user: 'user config', project: 'Project (.mcp.json)' }

export interface ClaudeServersProps {
  /** The Project's repository root. */
  path: string
  /** The Project is on a Linked machine: its Profile is written only there. */
  remote: boolean
  readOnly: boolean
  /** The services of the Integrations enabled in the Project, with their labels. */
  enabledServices: readonly { service: string; label: string }[]
  onAddAsIntegration: (service: string) => void
}

interface ServerRow {
  name: string
  source: string
  allowed: boolean
  row: McpServerRow | undefined
  service: string | null
}

/**
 * The MCP servers of the newest Session of the Project at `path` on this Machine — its Orchestrator or a Session Node —
 * as this window got them; null when it has none. The same rows Edit profile shows its status from (session/McpChip.tsx).
 */
function useProjectMcp(path: string): readonly McpServerRow[] | null {
  const projectId = useProjects()?.projects.find((project) => project.path === path)?.id
  const orchestrators = useOrchestratorViews()
  const nodes = useSessionNodeViews()
  const sessionIds = useMemo(() => {
    if (projectId === undefined) return []
    const views = [...Object.values(orchestrators), ...Object.values(nodes)].filter((view) => view.projectId === projectId)
    return views.flatMap((view) => (view.sessionId === null ? [] : [view.sessionId]))
  }, [projectId, orchestrators, nodes])
  return useLatestMcp(sessionIds)
}

export function ClaudeServers({ path, remote, readOnly, enabledServices, onAddAsIntegration }: ClaudeServersProps) {
  const rows = useProjectMcp(path)
  const [read, setRead] = useState<ProfileEditRead>()
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  const reread = useCallback(async (): Promise<ProfileEditRead | undefined> => {
    const result = await invoke('profileEdit.read', { root: path })
    if (!result.ok) {
      setProblem(result.error)
      return undefined
    }
    setRead(result.value)
    return result.value
  }, [path])

  useEffect(() => {
    if (remote) return
    let active = true
    void invoke('profileEdit.read', { root: path }).then((result) => {
      if (!active) return
      if (result.ok) setRead(result.value)
      else setProblem(result.error)
    })
    return () => {
      active = false
    }
  }, [remote, path])

  if (remote) {
    return (
      <section className="w-int__group" aria-label="From Claude Code" data-testid="integrations-claude">
        <div className="w-int__ghead">
          <h3>From Claude Code</h3>
        </div>
        <p className="w-int__note">The servers of Claude Code show on the Project&apos;s machine.</p>
      </section>
    )
  }

  const list = read?.available === true ? read.values[FIELD] : undefined
  const names = Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : null
  const servers: ServerRow[] = []
  const seen = new Set<string>()
  const push = (name: string, row: McpServerRow | undefined): void => {
    if (seen.has(name) || WORFY_SERVER_NAMES.includes(name)) return
    seen.add(name)
    servers.push({ name, source: row === undefined ? 'Profile list' : (SOURCE_TEXT[row.source] ?? row.source), allowed: names?.includes(name) ?? false, row, service: serviceOfServer(name) })
  }
  for (const row of rows ?? []) if (row.source === 'claudeai' || row.source === 'user' || row.source === 'project') push(row.name, row)
  for (const name of names ?? []) push(name, undefined)

  /** Writes the list with `name` on it or off it, as Edit profile's Save does. */
  const write = async (name: string, allow: boolean): Promise<void> => {
    setBusy(true)
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = await reread()
      if (now?.available !== true) break
      const current = now.values[FIELD]
      if (!Array.isArray(current)) break
      const next = allow ? [...new Set([...current, name])] : current.filter((each) => each !== name)
      const result = await invoke('profileEdit.write', { root: path, values: { ...now.values, [FIELD]: next }, expected: now.fingerprint })
      if (!result.ok) {
        setProblem(result.error)
        break
      }
      if (result.value.status === 'saved') {
        setProblem(undefined)
        await reread()
        break
      }
      setProblem(result.value.status === 'invalid' ? result.value.reason : 'The Profile changed meanwhile; try again.')
    }
    setBusy(false)
  }
  const locked = readOnly || busy || names === null

  return (
    <section className="w-int__group" aria-label="From Claude Code" data-testid="integrations-claude">
      <div className="w-int__ghead">
        <h3>From Claude Code</h3>
        <span className="w-int__count">{servers.length}</span>
        <span className="w-int__note">Servers and claude.ai connectors Claude Code knows. Allow puts the name on the Profile’s MCP servers list, as Edit profile does.</span>
      </div>
      {read?.available === false ? <p className="w-int__note">{read.reason}</p> : null}
      {read?.available === true && names === null ? <p className="w-int__note">The Profile has no MCP servers list: set one in Edit profile.</p> : null}
      {rows === null ? <p className="w-int__note">Start a Session in this Project to see every server Claude Code knows; until then only the Profile’s list shows.</p> : null}
      <ul className="w-int__rows">
        {servers.map((server) => {
          const twin = server.service === null ? undefined : enabledServices.find((each) => each.service === server.service)
          const short = (server.service === null ? undefined : catalogueEntry(server.service))?.defaultLabel ?? ''
          return (
            <li key={server.name} className="w-int__crow" data-testid="claude-server" data-name={server.name} data-allowed={server.allowed}>
              <div className="w-int__main">
                <div className="w-int__title">
                  <span className="w-mono">{server.name}</span>
                  {server.row === undefined ? null : <McpStatusChip status={server.row.status} />}
                </div>
                {twin !== undefined && !server.allowed ? (
                  <div className="w-int__sub w-int__sub--bad">
                    {twin.label} is already on here — allowing this gives a second {short} tool set.
                  </div>
                ) : null}
              </div>
              <span className="w-int__note">{server.source}</span>
              <span className={server.allowed ? 'w-int__allowed' : 'w-int__note'}>{server.allowed ? 'Allowed' : 'Not allowed'}</span>
              <span className="w-int__acts">
                {server.allowed ? null : (
                  <Button disabled={locked} onClick={() => void write(server.name, true)}>
                    Allow
                  </Button>
                )}
                {server.service === null ? null : (
                  <Button
                    title="Creates an Integration with the service's address and asks for its sign-in. The MCP servers list does not change by itself."
                    disabled={readOnly}
                    onClick={() => onAddAsIntegration(server.service!)}
                  >
                    Add as integration
                  </Button>
                )}
              </span>
              {twin !== undefined && server.allowed ? (
                <div className="w-int__warnline" role="note" data-testid="claude-server-twin">
                  <b>Two {short} tool sets in this Project.</b> {server.name} and the Integration {twin.label} are both on: Sessions get two sets of {short} tools and may use the wrong account.
                  <span className="w-int__acts">
                    <Button disabled={locked} onClick={() => void write(server.name, false)}>
                      Turn off {server.name} in this Project
                    </Button>
                  </span>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {problem === undefined ? null : (
        <p role="alert" className="w-int__error">
          {problem}
        </p>
      )}
    </section>
  )
}
