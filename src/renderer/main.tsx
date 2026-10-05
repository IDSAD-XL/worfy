import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { Canvas } from './canvas/Canvas'
import { activeProject, useProjects } from './projects/useProjects'

export function App() {
  // The toolbar shows the active Project and its branch; the list itself is the sidebar's
  // Projects section (shell/sidebar/ProjectsSection.tsx).
  const active = activeProject(useProjects())
  const project = active ? { name: active.name, branch: active.branch ?? '—' } : undefined
  // The app version is a toolbar item (shell/toolbar/AppVersion.tsx).
  return <AppShell project={project} canvas={<Canvas projectId={active?.id} />} />
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
