// The `Runs` tab of the toolbar's View switch (worfy-flight-recorder ticket 28): the fourth tab, which
// opens the Run history of the active Project, is the pressed one on that screen, and is inactive, with
// a tooltip, when there is no Project.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openRunHistory } = vi.hoisted(() => ({ openRunHistory: vi.fn(() => Promise.resolve()) }))
vi.mock('../../src/renderer/flight-recorder/open', () => ({ openRunHistory }))

import { ToolbarView, type ShellView } from '../../src/renderer/shell/Toolbar'

const PROJECT = { id: 'auction-00000001', name: 'auction', branch: 'main' }

function renderToolbar(props: { project?: typeof PROJECT; view?: ShellView; onViewChange?: (view: ShellView) => void }) {
  render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} {...props} />)
  return within(screen.getByRole('group', { name: 'View' }))
}

afterEach(() => {
  cleanup()
  openRunHistory.mockClear()
})

describe('the Runs tab', () => {
  it('is the fourth tab, after Canvas, Session and Pipeline', () => {
    const tabs = renderToolbar({ project: PROJECT })
    expect(tabs.getAllByRole('button').map((tab) => tab.getAttribute('aria-label'))).toEqual(['Canvas', 'Session', 'Pipeline', 'Runs'])
  })

  it('opens the Run history of the active Project, and does not switch the view itself', () => {
    const onViewChange = vi.fn()
    const tabs = renderToolbar({ project: PROJECT, onViewChange })
    fireEvent.click(tabs.getByRole('button', { name: 'Runs' }))
    expect(openRunHistory).toHaveBeenCalledOnce()
    expect(openRunHistory).toHaveBeenCalledWith(PROJECT.id)
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('leaves the other tabs as they were: they switch the view and open nothing', () => {
    const onViewChange = vi.fn()
    const tabs = renderToolbar({ project: PROJECT, onViewChange })
    fireEvent.click(tabs.getByRole('button', { name: 'Pipeline' }))
    fireEvent.click(tabs.getByRole('button', { name: 'Canvas' }))
    expect(onViewChange.mock.calls).toEqual([['pipeline'], ['canvas']])
    expect(openRunHistory).not.toHaveBeenCalled()
  })

  it('is the pressed tab on the Run history screen, and only then', () => {
    const tabs = renderToolbar({ project: PROJECT, view: 'history' })
    const pressed = tabs.getAllByRole('button').filter((tab) => tab.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((tab) => tab.getAttribute('aria-label'))).toEqual(['Runs'])
    cleanup()
    const onCanvas = renderToolbar({ project: PROJECT, view: 'canvas' })
    expect(onCanvas.getByRole('button', { name: 'Runs' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('is inactive without a Project, with a tooltip that says what to do', () => {
    const tabs = renderToolbar({})
    const runs = tabs.getByRole('button', { name: 'Runs' }) as HTMLButtonElement
    expect(runs.disabled).toBe(true)
    expect(runs.title).toBe('Open a Project to see its Runs')
    fireEvent.click(runs)
    expect(openRunHistory).not.toHaveBeenCalled()
    // The other tabs stay usable.
    expect((tabs.getByRole('button', { name: 'Canvas' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('has the plain tooltip «Runs» when it is usable', () => {
    const tabs = renderToolbar({ project: PROJECT })
    expect((tabs.getByRole('button', { name: 'Runs' }) as HTMLButtonElement).title).toBe('Runs')
  })
})
