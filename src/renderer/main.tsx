import { StrictMode, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { installArchiveToasts } from './canvas/archive-toast'
import { Canvas } from './canvas/Canvas'
import { guardFileDrops } from './drop-guard'
// Loaded at start: the e2e hook of the Run history screen is set while the app's scripts run (open.ts).
import './flight-recorder/open'
import { installGettingStartedNotice } from './getting-started/notice'
import { windowMachine } from './ipc'
import { useMachines } from './machines/useMachines'
import { RunHistoryView } from './flight-recorder/RunHistoryView'
import { installStopToasts } from './flight-recorder/stop-toast'
import { markPlatform } from './platform'
import { PipelineBoard } from './pipeline/PipelineBoard'
import { activeProject, useLinked, useProjects } from './projects/useProjects'
import { setView, useNavigation } from './session/navigation'
import { installQuestionToasts } from './session/question-toast'
import { SessionView } from './session/SessionView'
import { ToastRegion } from './toast/ToastRegion'
import { installUpdateToasts } from './update/toasts'

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
  // The app version is the second line of the Harness toolbar item (shell/toolbar/HarnessStatus.tsx).
  // The toasts of the window (toast/ToastRegion.tsx) are drawn on <body>, above every view.
  return (
    <>
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
        pipeline={<PipelineBoard project={active} />}
        history={<RunHistoryView activeProjectId={active?.id} />}
      />
      <ToastRegion projectId={active?.id} />
    </>
  )
}

const container = document.getElementById('root')
if (container) {
  // Before the first render: the styles and the key handlers read the system from <html>
  // (platform.ts, worfy-windows ticket 11).
  markPlatform()
  // The toasts of the automatic archive: subscribed before the first render, so no batch is missed
  // while the Canvas loads (canvas/archive-toast.ts).
  installArchiveToasts()
  // A question of a Session that is not on screen comes as a toast (worfy-ui ticket 17).
  installQuestionToasts()
  // The toast of an Autopilot Run that stops, with "Open history" (worfy-flight-recorder ticket 20).
  installStopToasts()
  // A file dropped where nothing takes it does not open in the window (worfy-ui ticket 28).
  guardFileDrops()
  // An existing user hears of Getting started once, in a toast of the corner (worfy-onboarding ticket 08).
  installGettingStartedNotice()
  // The sticky toasts of Update: a ready build, an Available update, a failed build, a Harness out of
  // date and the end of the last restart (worfy-update ticket 07).
  installUpdateToasts()
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
