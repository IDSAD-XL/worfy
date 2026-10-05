import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { AppVersion } from './AppVersion'
import { activeProject, useProjects } from './projects/useProjects'

export function App() {
  // The toolbar shows the active Project and its branch; the list itself is the sidebar's
  // Projects section (shell/sidebar/ProjectsSection.tsx).
  const active = activeProject(useProjects())
  const project = active ? { name: active.name, branch: active.branch ?? '—' } : undefined
  // The Canvas view stays empty until ticket 05 fills it; until then it shows the app version.
  return <AppShell project={project} canvas={<AppVersion />} />
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
