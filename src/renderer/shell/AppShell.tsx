import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Toolbar, type ShellView, type ToolbarProject } from './Toolbar'
import './shell.css'

export interface AppShellProps {
  project?: ToolbarProject
  /** Content of the Canvas view (ticket 05). */
  canvas?: ReactNode
  /** Content of the Session view (ticket 33). */
  session?: ReactNode
}

/** The window of design F: sidebar, unified toolbar and the main area under it. */
export function AppShell({ project, canvas, session }: AppShellProps) {
  const [view, setView] = useState<ShellView>('canvas')
  const [sidebarVisible, setSidebarVisible] = useState(true)

  return (
    <div className="w-shell" data-testid="app-shell" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible ? <Sidebar /> : null}
      <div className="w-shell__main">
        <Toolbar
          project={project}
          view={view}
          onViewChange={setView}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
        />
        <main className={`w-shell__content w-shell__content--${view}`} aria-label={view === 'canvas' ? 'Canvas' : 'Session'}>
          {view === 'canvas' ? canvas : session}
        </main>
      </div>
    </div>
  )
}
