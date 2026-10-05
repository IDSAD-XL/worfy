import { collectExtensions, type ShellExtension } from './registry'

// Each sidebar section is its own file, src/renderer/shell/sidebar/<Name>Section.tsx, with a
// default-exported component and `export const order = <number>`. This file never changes when a
// section is added.
const sections = collectExtensions(import.meta.glob('./sidebar/*Section.tsx', { eager: true }))

export interface SidebarViewProps {
  sections: readonly ShellExtension[]
}

export function SidebarView({ sections }: SidebarViewProps) {
  return (
    <nav aria-label="Sidebar" className="w-sidebar">
      {/* Room for the native traffic lights; dragging here moves the window. */}
      <div className="w-sidebar__titlebar" />
      <div className="w-sidebar__sections">
        {sections.map(({ id, Component }) => (
          <div key={id} className="w-sidebar__section" data-section={id}>
            <Component />
          </div>
        ))}
      </div>
    </nav>
  )
}

export function Sidebar() {
  return <SidebarView sections={sections} />
}
