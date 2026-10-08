import { StrictMode, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { Canvas } from './canvas/Canvas'
import { windowMachine } from './ipc'
import { useMachines } from './machines/useMachines'
import { activeProject, useLinked, useProjects } from './projects/useProjects'
import { setView, useNavigation } from './session/navigation'
import { SessionView } from './session/SessionView'

const styles = {
  column: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' },
  fill: { position: 'relative', flex: 1, minHeight: 0 },
  notice: {
    flex: 'none',
    padding: '6px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface-raised)',
    color: 'var(--blocked-text)',
    fontSize: 'var(--text-12)',
    lineHeight: '16px',
  },
} satisfies Record<string, CSSProperties>

/**
 * The Linked machine this window shows (worfy-link ticket 09): its name, and why its Projects
 * cannot be reached now — null when they can. Undefined in a window on this Machine.
 */
function useShownMachine(): { name: string; problem: string | null } | undefined {
  const machine = windowMachine()
  const link = useMachines()
  const linked = useLinked()
  if (machine === null) return undefined
  const record = link?.linked.find((candidate) => candidate.id === machine)
  const info = linked?.machines.find((candidate) => candidate.id === machine)
  const name = record?.name ?? 'The Linked machine'
  if (link !== undefined && record === undefined) return { name, problem: `${name} is no longer linked to this Machine` }
  if (record !== undefined && record.state !== 'online') return { name, problem: `${name} is unreachable` }
  if (info?.sharing === 'no') return { name, problem: `${name} stopped sharing its Projects` }
  return { name, problem: null }
}

export function App() {
  // The toolbar shows the active Project and its branch — with the Machine's name, when the window
  // shows a Linked machine; the list itself is the sidebar's Projects section
  // (shell/sidebar/ProjectsSection.tsx).
  const active = activeProject(useProjects())
  const shown = useShownMachine()
  const project = active ? { name: shown ? `${active.name} · ${shown.name}` : active.name, branch: active.branch ?? '—' } : undefined
  // The view is the app's, not the shell's: a double click on a Session's Node switches to the
  // Session view (session/navigation.ts).
  const view = useNavigation((store) => store.view)
  const canvas = <Canvas projectId={active?.id} />
  // The app version is a toolbar item (shell/toolbar/AppVersion.tsx).
  return (
    <AppShell
      project={project}
      view={view}
      onViewChange={setView}
      canvas={
        shown === undefined ? (
          canvas
        ) : (
          // Over the Canvas, why the Linked machine's Projects cannot be reached now; the window
          // loads again by itself once they can (useProjects.ts, acceptLinkedState).
          <div style={styles.column}>
            {shown.problem !== null ? (
              <div role="status" data-testid="linked-machine-notice" style={styles.notice}>
                {shown.problem}
              </div>
            ) : null}
            <div style={styles.fill}>{canvas}</div>
          </div>
        )
      }
      session={<SessionView projectId={active?.id} projectName={active?.name} />}
    />
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
