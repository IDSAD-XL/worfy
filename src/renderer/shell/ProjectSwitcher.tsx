import { Fragment, useRef, useState, type ReactElement } from 'react'
import type { ProjectView } from '../../shared/ipc/projects'
import { readableReason, windowMachine } from '../ipc'
import { activeProject, openProject, useProjects } from '../projects/useProjects'
import { Menu, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../theme/kit/Menu'
import { ALL_PROJECTS, setSidebarScope, useSidebarScope } from './sidebar-scope'

const allIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
)

const folderIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.4 1.5h5.6a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
  </svg>
)

const chevron = (
  <svg className="w-project-switcher__chevron" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

const check = (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
)

interface Choice {
  key: string
  label: string
  detail?: string
  icon: ReactElement
  checked: boolean
  /** The Project to open; none for «All Projects». */
  project?: ProjectView
}

/**
 * The Project switcher at the top of the sidebar (worfy-polish ticket 94, sidebar-scope.ts): «All
 * Projects» or one Project of the window's Machine. One Project is opened as a row of the Projects
 * section opens it; the sections then show that Project alone. The menu is the kit's Menu
 * (theme/kit/Menu.tsx, worfy-ui-kit ticket 11) under the button, as wide as it; it opens on the
 * answer in force.
 */
export function ProjectSwitcher() {
  const state = useProjects()
  const scope = useSidebarScope((store) => store.scope)
  const active = activeProject(state)
  const projects = state?.projects ?? []
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const one = scope === 'project' && active !== undefined
  const shown = one ? active.name : ALL_PROJECTS

  // The number of the last pick: an answer of openProject for an older one changes nothing.
  const picks = useRef(0)

  // One Project: the sidebar shows it alone once it is open — not before, so a refusal keeps the
  // answer the switcher had, and the sidebar never shows the Project that was open as the one chosen.
  const pickProject = (project: ProjectView) => {
    const pick = ++picks.current
    setFailure(null)
    if (project.id === active?.id) {
      setSidebarScope('project')
      return
    }
    void openProject(windowMachine(), project.id).then((refused) => {
      if (pick !== picks.current) return
      if (refused === undefined) setSidebarScope('project')
      else setFailure(`${project.name} could not be opened: ${readableReason(refused)}`)
    })
  }

  const pickAll = () => {
    picks.current += 1
    setSidebarScope('all')
    setFailure(null)
  }

  const choices: Choice[] = [
    { key: 'all', label: ALL_PROJECTS, icon: allIcon, checked: !one },
    ...projects.map((project) => ({ key: project.id, label: project.name, detail: project.branch ?? undefined, icon: folderIcon, checked: one && project.id === active.id, project })),
  ]

  const trigger = (
    <button
      type="button"
      className="w-project-switcher__button"
      aria-label={`Sidebar shows: ${shown}`}
      title={one ? `The sidebar shows ${active.name} alone` : 'The sidebar mixes all Projects'}
      data-testid="project-switcher"
      data-scope={one ? 'project' : 'all'}
    >
      <span className="w-project-switcher__icon">{one ? folderIcon : allIcon}</span>
      <span className="w-project-switcher__name">{shown}</span>
      {chevron}
    </button>
  )
  const change = (next: boolean) => {
    if (next) setFailure(null)
    setOpen(next)
  }

  return (
    <div className="w-project-switcher">
      <Menu open={open} onOpenChange={change} trigger={trigger} label="Sidebar shows" className="w-project-switcher__menu" testId="project-switcher-menu" focusOnOpen='[aria-checked="true"]'>
        <MenuRadioGroup value={choices.find((choice) => choice.checked)?.key ?? null}>
          {choices.map((choice, index) => (
            <Fragment key={choice.key}>
              {index === 1 ? <MenuSeparator className="w-project-switcher__separator" /> : null}
              <MenuRadioItem
                value={choice.key}
                closeOnClick
                className="w-project-switcher__item"
                data-testid="project-switcher-item"
                data-project={choice.key}
                title={choice.detail === undefined ? choice.label : `${choice.label} · ${choice.detail}`}
                onClick={() => (choice.project === undefined ? pickAll() : pickProject(choice.project))}
              >
                <span className="w-project-switcher__icon">{choice.icon}</span>
                <span className="w-project-switcher__label">{choice.label}</span>
                {choice.detail !== undefined ? (
                  // At most half of the item, so a long branch leaves the name the other half (worfy-polish ticket 111).
                  // shortcut: an inline style, because shell.css is being changed by another ticket; move it to
                  // `.w-project-switcher__detail` the next time shell.css is edited.
                  <span className="w-project-switcher__detail w-mono" style={{ maxWidth: '50%' }}>
                    {choice.detail}
                  </span>
                ) : null}
                <span className="w-project-switcher__check">{choice.checked ? check : null}</span>
              </MenuRadioItem>
            </Fragment>
          ))}
        </MenuRadioGroup>
      </Menu>
      {failure !== null ? (
        <p role="alert" className="w-project-switcher__failure" data-testid="project-switcher-failure">
          {failure}
        </p>
      ) : null}
    </div>
  )
}
