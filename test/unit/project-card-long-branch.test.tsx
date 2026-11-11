// A Project on a long branch (worfy-polish ticket 111): its card in the Projects section keeps the name, and the
// branch stays on one line, is cut with an ellipsis and takes at most half of the line, the whole branch in its
// tooltip. The Project switcher's menu keeps the name the same way. jsdom does no layout, so the styles that make it
// so are what is checked here; the boxes are checked against the built app (test/e2e/sidebar-rail.spec.ts).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'

const LONG_BRANCH = 'feature/lantern-glass-polishing-and-wick-trimming'
const LANTERN = { id: 'lantern-0000000a', name: 'lantern', path: '/projects/lantern', branch: LONG_BRANCH }
const KETTLE = { id: 'kettle-0000000b', name: 'kettle', path: '/projects/kettle', branch: 'main' }
const LIST: ProjectsState = { projects: [LANTERN, KETTLE], activeId: LANTERN.id, revision: 1 }

beforeEach(() => {
  // useProjects and sidebar-scope keep their state in modules: every test starts with fresh ones.
  vi.resetModules()
  localStorage.clear()
  const bridge: WorfyBridge = {
    invoke: (channel) => Promise.resolve(channel === 'projects.list' ? { ok: true, value: LIST } : { ok: false, error: `no ${channel}` }),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

const truncates = (element: HTMLElement): void => {
  expect(element.style.whiteSpace).toBe('nowrap')
  expect(element.style.overflow).toBe('hidden')
  expect(element.style.textOverflow).toBe('ellipsis')
  expect(element.style.minWidth).toBe('0px')
}

describe('a Project card on a long branch', () => {
  it('keeps the name; the branch is one line cut with an ellipsis, at most half of the line, whole in its tooltip', async () => {
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
    render(<ProjectsSection />)
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(2))
    const card = screen.getAllByTestId('project-row').find((row) => row.getAttribute('data-project-id') === LANTERN.id)
    if (card === undefined) throw new Error('no card of lantern')

    const name = card.querySelector<HTMLElement>('.w-row__label')
    expect(name?.textContent).toBe('lantern')

    const branch = within(card).getByText(LONG_BRANCH)
    expect(branch.getAttribute('title')).toBe(LONG_BRANCH)
    truncates(branch)
    // Its box shrinks and never takes more than half of the line, so the name always has the other half.
    const trailing = branch.parentElement
    expect(trailing?.className).toBe('w-row__trailing')
    expect(trailing?.style.flex).toBe('0 1 auto')
    expect(trailing?.style.minWidth).toBe('0px')
    expect(trailing?.style.maxWidth).toBe('50%')
  })
})

describe('the Project switcher on a long branch', () => {
  it('gives the branch at most half of the item, so the name keeps the rest; the tooltip names both', async () => {
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { ProjectSwitcher } = await import('../../src/renderer/shell/ProjectSwitcher')
    render(<ProjectSwitcher />)
    fireEvent.click(screen.getByTestId('project-switcher'))
    const item = screen.getAllByTestId('project-switcher-item').find((each) => each.getAttribute('data-project') === LANTERN.id)
    if (item === undefined) throw new Error('no item of lantern')
    expect(item.getAttribute('title')).toBe(`lantern · ${LONG_BRANCH}`)
    expect(item.querySelector('.w-project-switcher__label')?.textContent).toBe('lantern')
    const detail = item.querySelector<HTMLElement>('.w-project-switcher__detail')
    expect(detail?.textContent).toBe(LONG_BRANCH)
    expect(detail?.style.maxWidth).toBe('50%')
  })
})
