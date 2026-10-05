import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { Canvas } from './canvas/Canvas'
import { activeProject, useProjects } from './projects/useProjects'
import { setView, useNavigation } from './session/navigation'
import { SessionView } from './session/SessionView'

export function App() {
  // The toolbar shows the active Project and its branch; the list itself is the sidebar's
  // Projects section (shell/sidebar/ProjectsSection.tsx).
  const active = activeProject(useProjects())
  const project = active ? { name: active.name, branch: active.branch ?? '—' } : undefined
  // The view is the app's, not the shell's: a double click on a Session's Node switches to the
  // Session view (session/navigation.ts).
  const view = useNavigation((store) => store.view)
  // The app version is a toolbar item (shell/toolbar/AppVersion.tsx).
  return (
    <AppShell
      project={project}
      view={view}
      onViewChange={setView}
      canvas={<Canvas projectId={active?.id} />}
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
